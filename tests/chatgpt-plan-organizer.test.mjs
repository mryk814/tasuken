import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createCipheriv, createDecipheriv, createSign, generateKeyPairSync } from "node:crypto";
import test from "node:test";
import { build } from "esbuild";

// #625: Tasken内部の入力整理をChatGPTの契約枠（Sign in with ChatGPT）で動かす経路。
const bundled = await build({
  stdin: {
    contents: `export { createCaptureOrganizerFromEnvironment, CaptureOrganizerUserError } from "./src/main/gateway/mobile/captureOrganizer.ts";
    export { CaptureOrganizerSettingsService } from "./src/main/services/captureOrganizerSettings.ts";
    export { ChatGptAccountService, CHATGPT_AUTH } from "./src/main/services/chatgptAccount.ts";`,
    resolveDir: process.cwd(),
  },
  bundle: true,
  platform: "node",
  format: "esm",
  write: false,
  logLevel: "silent",
});
const {
  createCaptureOrganizerFromEnvironment: create,
  CaptureOrganizerUserError,
  CaptureOrganizerSettingsService,
  ChatGptAccountService,
  CHATGPT_AUTH,
} = await import(
  `data:text/javascript;base64,${Buffer.from(bundled.outputFiles[0].text).toString("base64")}`
);

const secure = {
  isEncryptionAvailable: () => true,
  encryptString(value) {
    const cipher = createCipheriv("aes-256-ctr", Buffer.alloc(32, 7), Buffer.alloc(16, 3));
    return Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  },
  decryptString(value) {
    const decipher = createDecipheriv("aes-256-ctr", Buffer.alloc(32, 7), Buffer.alloc(16, 3));
    return Buffer.concat([decipher.update(value), decipher.final()]).toString("utf8");
  },
};
const capture = {
  text: "明日は牛乳を買う",
  capturedAt: "2026-10-06T03:00:00Z",
  timeZone: "Asia/Tokyo",
  themeId: null,
  themes: [],
};
const batch = {
  tasks: [
    {
      title: "牛乳を買う",
      themeId: null,
      startDate: "2026-10-07",
      endDate: null,
      rangeSemantics: null,
      checklist: [],
      supplement: "",
      warnings: [],
    },
  ],
  warnings: [],
};
const env = { TASKEN_CAPTURE_LLM_PROVIDER: "chatgpt", TASKEN_CAPTURE_LLM_MODEL: "gpt-plan-model" };

function sse(events) {
  return new Response(
    events.map((event) => `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`).join(""),
    { headers: { "Content-Type": "text/event-stream" } },
  );
}
function completed(text) {
  const half = Math.floor(text.length / 2);
  return sse([
    { type: "response.created", response: { status: "in_progress" } },
    { type: "response.output_text.delta", delta: text.slice(0, half) },
    { type: "response.output_text.delta", delta: text.slice(half) },
    {
      type: "response.completed",
      response: {
        status: "completed",
        output: [{ type: "message", content: [{ type: "output_text", text }] }],
      },
    },
  ]);
}
function errorResponse(status, code, param) {
  return new Response(JSON.stringify({ error: { code, param } }), { status });
}
function tokenSource(tokens = ["plan-token-1", "plan-token-2"]) {
  const calls = { get: 0, invalidate: 0, reauth: 0 };
  return {
    calls,
    getAccessToken: async () => tokens[Math.min(calls.get++, tokens.length - 1)],
    invalidateAccessToken: () => calls.invalidate++,
    markReauthRequired: () => calls.reauth++,
    isConnected: () => true,
  };
}

test("ChatGPT plan organizes through Responses with store false, stream true and strict schema", async () => {
  const requests = [];
  const source = tokenSource();
  const organizer = create(
    env,
    async (url, init) => {
      requests.push({ url, init, body: JSON.parse(init.body) });
      return completed(JSON.stringify(batch));
    },
    { chatgpt: source },
  );
  assert.equal(organizer.providerLabel, "ChatGPT");
  assert.deepEqual(await organizer.organize(capture), batch);
  assert.equal(requests.length, 1);
  const [{ url, init, body }] = requests;
  assert.equal(url, "https://api.openai.com/v1/responses");
  assert.equal(init.headers.Authorization, "Bearer plan-token-1");
  assert.equal(init.redirect, "error");
  assert.equal(body.model, "gpt-plan-model");
  assert.equal(body.store, false);
  assert.equal(body.stream, true);
  assert.equal(body.text.format.type, "json_schema");
  assert.equal(body.text.format.strict, true);
  assert.equal(body.input[0].role, "system");
  const data = JSON.parse(body.input[1].content[0].text);
  assert.equal(data.relativeDateAnchors.tomorrow, "2026-10-07");
  // APIキーを使わない経路。env にキーが無くても動き、Authorizationは契約のtokenだけ。
  assert.equal(JSON.stringify(requests).includes("TASKEN_CAPTURE_LLM_API_KEY"), false);
});

test("ChatGPT provider without a connected account stays disabled", () => {
  assert.equal(
    create(env, async () => assert.fail("no network")),
    null,
  );
});

test("plan limit is reported as a normal state and never falls back to a paid API", async () => {
  for (const respond of [
    () => errorResponse(429, "subscription_sharing_usage_limit_exceeded"),
    () =>
      sse([
        {
          type: "response.failed",
          response: {
            status: "failed",
            error: { code: "subscription_sharing_usage_limit_exceeded" },
          },
        },
      ]),
  ]) {
    const urls = [];
    const organizer = create(
      { ...env, TASKEN_CAPTURE_LLM_API_KEY: "should-not-be-used" },
      async (url) => {
        urls.push(url);
        return respond();
      },
      { chatgpt: tokenSource() },
    );
    await assert.rejects(organizer.organize(capture), (error) => {
      assert.ok(error instanceof CaptureOrganizerUserError);
      assert.equal(error.reason, "plan_limit");
      assert.match(error.message, /自動で切り替えていません/);
      return true;
    });
    assert.deepEqual(urls, ["https://api.openai.com/v1/responses"]);
  }
});

test("expired access token is refreshed once; revoked user asks to reconnect", async () => {
  const source = tokenSource();
  const auths = [];
  const organizer = create(
    env,
    async (_url, init) => {
      auths.push(init.headers.Authorization);
      return auths.length === 1 ? errorResponse(401) : completed(JSON.stringify(batch));
    },
    { chatgpt: source },
  );
  assert.deepEqual(await organizer.organize(capture), batch);
  assert.deepEqual(auths, ["Bearer plan-token-1", "Bearer plan-token-2"]);
  assert.equal(source.calls.invalidate, 1);

  const revoked = tokenSource();
  const organizer2 = create(
    env,
    async () => errorResponse(401, "subscription_sharing_invalid_user"),
    { chatgpt: revoked },
  );
  await assert.rejects(organizer2.organize(capture), (error) => error.reason === "reauth_required");
  assert.equal(revoked.calls.reauth, 1);
});

test("unsupported structured output drops only the format and keeps local validation", async () => {
  const bodies = [];
  const organizer = create(
    env,
    async (_url, init) => {
      bodies.push(JSON.parse(init.body));
      return bodies.length === 1
        ? errorResponse(400, "subscription_sharing_unsupported_capability", "text.format")
        : completed("```json\n" + JSON.stringify(batch) + "\n```");
    },
    { chatgpt: tokenSource() },
  );
  assert.deepEqual(await organizer.organize(capture), batch);
  assert.equal(bodies.length, 2);
  assert.ok(bodies[0].text);
  assert.equal(bodies[1].text, undefined);

  // 形式を外しても、契約外の出力は採用しない。
  const invalid = create(
    env,
    async () => completed(JSON.stringify({ tasks: [{ title: "x" }], warnings: [] })),
    { chatgpt: tokenSource() },
  );
  await assert.rejects(invalid.organize(capture), /AIで整理できませんでした/);
});

test("stream without response.completed or with a failure is not treated as success", async () => {
  for (const events of [
    [{ type: "response.output_text.delta", delta: JSON.stringify(batch) }],
    [{ type: "response.incomplete", response: { status: "incomplete" } }],
    [{ type: "error", code: "server_error" }],
  ]) {
    const organizer = create(env, async () => sse(events), { chatgpt: tokenSource() });
    await assert.rejects(organizer.organize(capture), /AIで整理できませんでした/);
  }
});

function tempDir(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "tasken-chatgpt-"));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  return directory;
}

test("settings save ChatGPT plan without an API key and do not count it as metered usage", async (t) => {
  const directory = tempDir(t);
  const account = tokenSource();
  const service = new CaptureOrganizerSettingsService(
    directory,
    secure,
    {},
    async () => completed(JSON.stringify(batch)),
    fs,
    account,
  );
  const planInput = {
    provider: "chatgpt",
    model: "gpt-plan-model",
    endpoint: "",
    vocabulary: "",
    apiKey: "ignored-key",
    monthlyRequestLimit: 5,
  };
  const saved = await service.saveSettings(planInput);
  assert.equal(saved.provider, "chatgpt");
  assert.equal(saved.hasApiKey, false);
  assert.equal(saved.monthlyRequestLimit, null);
  const stored = fs.readFileSync(path.join(directory, "capture-organizer-settings.json"), "utf8");
  assert.equal(stored.includes("ignored-key"), false);
  await service.organize(capture);
  await service.organize(capture);
  assert.equal((await service.getSettings()).monthlyRequestCount, 0);
  assert.equal(fs.existsSync(path.join(directory, "capture-organizer-usage.json")), false);
  assert.equal((await service.testConnection(planInput)).ok, true);

  const disconnected = new CaptureOrganizerSettingsService(directory, secure, {}, fetch, fs, {
    ...account,
    isConnected: () => false,
  });
  assert.deepEqual(await disconnected.testConnection(planInput), {
    ok: false,
    message: "先にChatGPTと接続してください。",
  });
});

test("metered API stops at the monthly request limit before sending and resets next month", async (t) => {
  const directory = tempDir(t);
  let now = new Date("2026-10-06T12:00:00+09:00");
  let sent = 0;
  const service = new CaptureOrganizerSettingsService(
    directory,
    secure,
    {},
    async () => {
      sent++;
      return new Response(
        JSON.stringify({
          choices: [{ finish_reason: "stop", message: { content: JSON.stringify(batch) } }],
        }),
      );
    },
    fs,
    undefined,
    () => now,
  );
  await service.saveSettings({
    provider: "openai",
    model: "gpt-test",
    endpoint: "",
    vocabulary: "",
    apiKey: "metered-secret",
    monthlyRequestLimit: 2,
  });
  await service.organize(capture);
  await service.organize(capture);
  await assert.rejects(service.organize(capture), (error) => {
    assert.equal(error.reason, "monthly_limit");
    assert.match(error.message, /上限（2回）/);
    return true;
  });
  assert.equal(sent, 2);
  const state = await service.getSettings();
  assert.equal(state.monthlyRequestLimit, 2);
  assert.equal(state.monthlyRequestCount, 2);
  now = new Date("2026-11-01T09:00:00+09:00");
  assert.equal((await service.getSettings()).monthlyRequestCount, 0);
  await service.organize(capture);
  assert.equal(sent, 3);
  await assert.rejects(
    service.saveSettings({
      provider: "openai",
      model: "gpt-test",
      endpoint: "",
      vocabulary: "",
      monthlyRequestLimit: 0,
    }),
  );
});

test("legacy saved API settings without a limit keep working", async (t) => {
  const directory = tempDir(t);
  fs.writeFileSync(
    path.join(directory, "capture-organizer-settings.json"),
    JSON.stringify({
      provider: "openai",
      model: "gpt-test",
      endpoint: "",
      vocabulary: "",
      encryptedApiKey: secure.encryptString("legacy-key").toString("base64"),
    }),
  );
  const service = new CaptureOrganizerSettingsService(directory, secure, {}, async (_url, init) => {
    assert.equal(init.headers.Authorization, "Bearer legacy-key");
    return new Response(
      JSON.stringify({
        choices: [{ finish_reason: "stop", message: { content: JSON.stringify(batch) } }],
      }),
    );
  });
  const state = await service.getSettings();
  assert.equal(state.provider, "openai");
  assert.equal(state.hasApiKey, true);
  assert.equal(state.monthlyRequestLimit, null);
  assert.deepEqual(await service.organize(capture), batch);
});

// --- Sign in with ChatGPT（loopback + PKCE + dynamic client） ---

const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
const jwk = { ...publicKey.export({ format: "jwk" }), kid: "test-kid", alg: "RS256", use: "sig" };
function idToken(claims) {
  const header = Buffer.from(JSON.stringify({ alg: "RS256", kid: "test-kid" })).toString(
    "base64url",
  );
  const payload = Buffer.from(JSON.stringify(claims)).toString("base64url");
  const signer = createSign("RSA-SHA256");
  signer.update(`${header}.${payload}`);
  return `${header}.${payload}.${signer.sign(privateKey).toString("base64url")}`;
}

function authHarness(t, overrides = {}) {
  const directory = tempDir(t);
  const posts = [];
  let issued = 0;
  let nonce = null;
  const state = { scope: CHATGPT_AUTH.scope, refreshError: null, ...overrides };
  const fakeFetch = async (url, init = {}) => {
    if (url === CHATGPT_AUTH.jwks) return new Response(JSON.stringify({ keys: [jwk] }));
    if (url === CHATGPT_AUTH.models)
      return new Response(
        JSON.stringify({
          models: [
            { slug: "gpt-plan-model", display_name: "Plan model", visibility: "list" },
            { slug: "hidden-model", visibility: "hide" },
          ],
        }),
      );
    const form = Object.fromEntries(new URLSearchParams(init.body));
    posts.push({ url, form });
    if (url === CHATGPT_AUTH.revoke) return new Response("{}");
    if (form.grant_type === "refresh_token" && state.refreshError)
      return new Response(JSON.stringify({ error: state.refreshError }), { status: 400 });
    if (form.grant_type === "refresh_token" && state.waitForRefresh) await state.waitForRefresh();
    issued++;
    return new Response(
      JSON.stringify({
        access_token: `access-${issued}`,
        refresh_token: `refresh-secret-${issued}`,
        id_token: idToken({
          iss: CHATGPT_AUTH.issuer,
          aud: "oaiapp_test",
          sub: "user-sub",
          email: "owner@example.test",
          nonce,
          exp: Math.floor(Date.now() / 1000) + 3600,
        }),
        expires_in: 3600,
        scope: state.scope,
      }),
    );
  };
  const opened = [];
  const service = new ChatGptAccountService(directory, secure, {
    fetchImpl: fakeFetch,
    openExternal: async (url) => {
      opened.push(url);
      const authorize = new URL(url);
      nonce = authorize.searchParams.get("nonce");
      const redirect = new URL(authorize.searchParams.get("redirect_uri"));
      redirect.searchParams.set("code", "auth-code");
      redirect.searchParams.set("state", authorize.searchParams.get("state"));
      if (authorize.searchParams.get("client_id") === CHATGPT_AUTH.dynamicClientId)
        redirect.searchParams.set("client_id", "oaiapp_test");
      if (state.callbackClientId) redirect.searchParams.set("client_id", state.callbackClientId);
      // ブラウザがloopbackへ戻ってくる動作。
      setTimeout(() => void fetch(redirect), 10);
    },
  });
  return { directory, posts, opened, service, state };
}

test("sign-in registers a dynamic client over loopback PKCE and stores only an encrypted refresh token", async (t) => {
  const { directory, posts, opened, service } = authHarness(t);
  assert.equal(service.getState().status, "disconnected");
  const state = await service.signIn();
  assert.deepEqual(state, {
    status: "connected",
    email: "owner@example.test",
    secureStorageAvailable: true,
  });
  const authorize = new URL(opened[0]);
  assert.equal(authorize.origin + authorize.pathname, CHATGPT_AUTH.authorize);
  assert.equal(authorize.searchParams.get("client_id"), "dynamic_agent_client");
  assert.equal(authorize.searchParams.get("agent_name_hint"), "Tasken");
  assert.equal(authorize.searchParams.get("scope"), CHATGPT_AUTH.scope);
  assert.equal(authorize.searchParams.get("resource"), "https://api.openai.com/v1");
  assert.equal(authorize.searchParams.get("code_challenge_method"), "S256");
  assert.match(
    authorize.searchParams.get("redirect_uri"),
    /^http:\/\/127\.0\.0\.1:\d+\/auth\/callback$/,
  );
  const hostId = authorize.searchParams.get("ext_agent_host_id");
  assert.match(hostId, /^[0-9a-f-]{36}$/);
  const exchange = posts.find((post) => post.form.grant_type === "authorization_code");
  assert.equal(exchange.form.client_id, "oaiapp_test");
  assert.equal(exchange.form.code, "auth-code");
  assert.ok(exchange.form.code_verifier.length >= 43);
  assert.equal(exchange.form.redirect_uri, authorize.searchParams.get("redirect_uri"));

  const file = fs.readFileSync(path.join(directory, "chatgpt-account.json"), "utf8");
  assert.equal(file.includes("refresh-secret"), false);
  assert.equal(file.includes("access-"), false);
  assert.equal(await service.getAccessToken(), "access-1");
  assert.deepEqual(await service.listModels(), [
    { slug: "gpt-plan-model", displayName: "Plan model" },
  ]);

  // 失効を検知したらrefreshで置き換える。refresh tokenも一緒に更新する。
  service.invalidateAccessToken();
  assert.equal(await service.getAccessToken(), "access-2");
  const refresh = posts.find((post) => post.form.grant_type === "refresh_token");
  assert.deepEqual(refresh.form, {
    grant_type: "refresh_token",
    client_id: "oaiapp_test",
    refresh_token: "refresh-secret-1",
    resource: "https://api.openai.com/v1",
  });

  // 再接続では発行済みclient IDと同じhost IDを使い、agent_name_hintは付けない。
  await service.signIn();
  const again = new URL(opened[1]);
  assert.equal(again.searchParams.get("client_id"), "oaiapp_test");
  assert.equal(again.searchParams.get("agent_name_hint"), null);
  assert.equal(again.searchParams.get("ext_agent_host_id"), hostId);

  const disconnected = await service.disconnect();
  assert.equal(disconnected.status, "disconnected");
  const revoke = posts.find((post) => post.url === CHATGPT_AUTH.revoke);
  assert.equal(revoke.form.token_type_hint, "refresh_token");
  assert.equal(revoke.form.client_id, "oaiapp_test");
  await assert.rejects(service.getAccessToken(), (error) => error.reason === "not_connected");
});

test("unusable refresh token moves to reauth_required instead of failing silently", async (t) => {
  const { service, state } = authHarness(t);
  await service.signIn();
  state.refreshError = "refresh_token_reused";
  service.invalidateAccessToken();
  await assert.rejects(service.getAccessToken(), (error) => error.reason === "reauth_required");
  assert.equal(service.getState().status, "reauth_required");
  assert.equal(service.isConnected(), false);
});

test("sign-in without the direct plan scope is rejected and nothing is stored", async (t) => {
  const { directory, service } = authHarness(t, { scope: "openid profile email offline_access" });
  await assert.rejects(service.signIn(), /契約枠の利用を許可できませんでした/);
  assert.equal(service.isConnected(), false);
  assert.equal(fs.existsSync(path.join(directory, "chatgpt-account.json")), false);
});

test("disconnect prevents an in-flight refresh from restoring credentials", async (t) => {
  const { service, state, directory } = authHarness(t);
  await service.signIn();
  let release;
  let entered;
  const started = new Promise((resolve) => {
    entered = resolve;
  });
  state.waitForRefresh = () => {
    entered();
    return new Promise((resolve) => {
      release = resolve;
    });
  };
  service.invalidateAccessToken();
  const refreshing = service.getAccessToken();
  const rejected = assert.rejects(refreshing, (error) => error.reason === "not_connected");
  await started;
  await service.disconnect();
  release();
  await rejected;
  assert.equal(service.getState().status, "disconnected");
  assert.equal(
    JSON.parse(fs.readFileSync(path.join(directory, "chatgpt-account.json"), "utf8"))
      .encryptedRefreshToken,
    null,
  );
  await assert.rejects(service.getAccessToken(), (error) => error.reason === "not_connected");
});

test("returning sign-in rejects a different callback client ID before exchanging credentials", async (t) => {
  const { service, state, posts, directory } = authHarness(t);
  await service.signIn();
  const before = fs.readFileSync(path.join(directory, "chatgpt-account.json"), "utf8");
  state.callbackClientId = "oaiapp_other";
  await assert.rejects(service.signIn(), (error) => error.reason === "sign_in_failed");
  assert.equal(posts.filter((post) => post.form.grant_type === "authorization_code").length, 1);
  assert.equal(fs.readFileSync(path.join(directory, "chatgpt-account.json"), "utf8"), before);
});
