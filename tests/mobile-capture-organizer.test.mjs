import assert from "node:assert/strict";
import { Buffer } from "node:buffer";
import test from "node:test";
import { build } from "esbuild";

const bundled = await build({
  entryPoints: ["src/main/gateway/mobile/captureOrganizer.ts"],
  bundle: true,
  platform: "node",
  format: "esm",
  write: false,
  logLevel: "silent",
});
const { createCaptureOrganizerFromEnvironment: create } = await import(
  `data:text/javascript;base64,${Buffer.from(bundled.outputFiles[0].text).toString("base64")}`
);
const secret = "fake-private-api-key";
const env = (provider = "openai", model = "test-model") => ({
  TASKEN_CAPTURE_LLM_PROVIDER: provider,
  TASKEN_CAPTURE_LLM_MODEL: model,
  TASKEN_CAPTURE_LLM_API_KEY: secret,
});
const input = {
  text: "明日は牛乳と卵を買う。",
  capturedAt: "2026-09-05T15:30:00Z",
  timeZone: "Asia/Tokyo",
  themeId: "home",
  themes: [{ id: "home", title: "生活" }],
};
const proposal = {
  title: "牛乳と卵を買う",
  themeId: "home",
  startDate: "2026-09-07",
  endDate: null,
  rangeSemantics: null,
  checklist: ["牛乳", "卵"],
  supplement: "",
  warnings: [],
};
const chat = (value = proposal) => ({
  choices: [{ finish_reason: "stop", message: { content: JSON.stringify(value) } }],
});
const json = (value) =>
  new Response(JSON.stringify(value), {
    headers: { "content-type": "application/json" },
  });

test("unset provider, key or model leaves organizer disabled without network", () => {
  for (const name of [
    "TASKEN_CAPTURE_LLM_PROVIDER",
    "TASKEN_CAPTURE_LLM_MODEL",
    "TASKEN_CAPTURE_LLM_API_KEY",
  ]) {
    assert.equal(
      create({ ...env(), [name]: "" }, () => assert.fail("network")),
      null,
    );
  }
});

for (const [provider, model, url, label] of [
  ["openai", "test-model", "https://api.openai.com/v1/chat/completions", "OpenAI"],
  [
    "azure",
    "deployment",
    "https://test-resource.openai.azure.com/openai/v1/chat/completions",
    "Azure OpenAI",
  ],
  ["opencode-zen", "kimi-k2.6", "https://opencode.ai/zen/v1/chat/completions", "OpenCode Zen"],
  ["opencode-go", "glm-5.3", "https://opencode.ai/zen/go/v1/chat/completions", "OpenCode Go"],
]) {
  test(`${provider} sends schema, separate untrusted data, recording-local day and bounded request`, async () => {
    let request;
    const organizer = create(
      {
        ...env(provider, model),
        TASKEN_CAPTURE_LLM_ENDPOINT: "https://test-resource.openai.azure.com/",
      },
      async (target, options) => {
        request = options;
        assert.equal(target, url);
        assert.equal(options.redirect, "error");
        assert.equal(options.method, "POST");
        assert.equal(options.headers.Authorization, `Bearer ${secret}`);
        assert.ok(options.signal instanceof AbortSignal);
        const body = JSON.parse(options.body);
        assert.equal(body.model, model);
        assert.equal(body.response_format.type, "json_schema");
        assert.equal(body.response_format.json_schema.strict, true);
        assert.equal(body.response_format.json_schema.schema.additionalProperties, false);
        assert.deepEqual(body.response_format.json_schema.schema.properties.themeId.enum, [
          null,
          "home",
        ]);
        assert.match(body.messages[0].content, /no date reference/);
        assert.equal(body.messages[1].role, "user");
        const data = JSON.parse(body.messages[1].content);
        assert.equal(data.capturedLocalDate, "2026-09-06");
        assert.equal(data.text, input.text);
        assert.ok(!options.body.includes(secret));
        return json(chat());
      },
    );
    assert.equal(organizer.providerLabel, label);
    assert.deepEqual(await organizer.organize(input), proposal);
    assert.equal(request.signal.aborted, true);
  });
}

test("Gemini uses native generateContent schema and header authentication", async () => {
  const organizer = create(env("gemini", "gemini-test"), async (url, options) => {
    assert.equal(
      url,
      "https://generativelanguage.googleapis.com/v1beta/models/gemini-test:generateContent",
    );
    assert.equal(options.headers["x-goog-api-key"], secret);
    assert.equal(options.headers.Authorization, undefined);
    assert.equal(options.redirect, "error");
    const body = JSON.parse(options.body);
    assert.equal(body.generationConfig.responseMimeType, "application/json");
    assert.equal(body.generationConfig.responseJsonSchema.type, "object");
    assert.equal(body.generationConfig.maxOutputTokens, 8192);
    assert.equal(JSON.parse(body.contents[0].parts[0].text).capturedLocalDate, "2026-09-06");
    return json({
      candidates: [
        {
          finishReason: "STOP",
          content: {
            parts: [{ thought: true, text: "not the answer" }, { text: JSON.stringify(proposal) }],
          },
        },
      ],
    });
  });
  assert.equal(organizer.providerLabel, "Gemini");
  assert.deepEqual(await organizer.organize(input), proposal);
});

test("invalid Azure origins and other OpenCode wire models fail before network without exposing settings", () => {
  for (const endpoint of [
    "http://test.openai.azure.com",
    "https://127.0.0.1",
    "https://test.openai.azure.com.evil.test",
    `https://${secret}@test.openai.azure.com`,
    "https://test.openai.azure.com/openai/v1/",
    `https://test.openai.azure.com/?key=${secret}`,
    "https://test.openai.azure.com:8443",
  ]) {
    assert.throws(
      () => create({ ...env("azure"), TASKEN_CAPTURE_LLM_ENDPOINT: endpoint }),
      (error) => {
        assert.ok(!String(error).includes(endpoint));
        assert.ok(!String(error).includes(secret));
        return true;
      },
    );
  }
  for (const [provider, model] of [
    ["unknown", secret],
    ["openai", "../path"],
    ["opencode-zen", "gpt-5.4"],
    ["opencode-go", "minimax-m3"],
  ]) {
    assert.throws(() => create(env(provider, model)), /設定が無効/);
  }
});

test("invalid request does not transmit and error does not quote input", async () => {
  const organizer = create(env(), async () => assert.fail("invalid input transmitted"));
  for (const data of [
    { ...input, text: "" },
    { ...input, text: secret.repeat(1000) },
    { ...input, capturedAt: "not-a-date" },
    { ...input, timeZone: secret },
    { ...input, themeId: "missing" },
    { ...input, themes: [...input.themes, ...input.themes] },
  ]) {
    await assert.rejects(organizer.organize(data), (error) => {
      assert.ok(!String(error).includes(secret));
      return /AIで整理できませんでした/.test(String(error));
    });
  }
});

test("strict local validation rejects invalid dates, foreign themes, bounds and extra properties", async () => {
  for (const changes of [
    { startDate: "2026-02-30" },
    { startDate: "2026-2-03" },
    { startDate: "2026-09-10", endDate: "2026-09-01" },
    { rangeSemantics: "ongoing" },
    { endDate: proposal.startDate, rangeSemantics: "ongoing" },
    { rangeSemantics: "invented" },
    { themeId: "not-a-candidate" },
    { title: " " },
    { title: "a".repeat(501) },
    { checklist: Array(21).fill("item") },
    { checklist: ["a".repeat(201)] },
    { checklist: [" "] },
    { supplement: "a".repeat(12001) },
    { warnings: Array(11).fill("warning") },
    { extra: true },
  ]) {
    const organizer = create(env(), async () => json(chat({ ...proposal, ...changes })));
    await assert.rejects(organizer.organize(input), /AIで整理できませんでした/);
  }
  const minimal = {
    ...proposal,
    themeId: null,
    startDate: null,
    endDate: null,
    checklist: [],
  };
  assert.deepEqual(await create(env(), async () => json(chat(minimal))).organize(input), minimal);
});

test("provider refusals, truncation, JSON errors and raw failures stay sanitized", async () => {
  for (const payload of [
    {
      choices: [{ finish_reason: "stop", message: { refusal: secret, content: "" } }],
    },
    {
      choices: [
        {
          finish_reason: "length",
          message: { content: JSON.stringify(proposal) },
        },
      ],
    },
    { choices: [{ finish_reason: "stop", message: { content: secret } }] },
    { error: { message: secret } },
  ]) {
    await assert.rejects(create(env(), async () => json(payload)).organize(input), (error) => {
      assert.ok(!String(error).includes(secret));
      assert.equal(error.cause, undefined);
      return true;
    });
  }
  for (const fetcher of [
    async () => new Response(secret, { status: 401 }),
    async () =>
      new Response(secret, {
        status: 302,
        headers: { location: `https://evil.test/${secret}` },
      }),
    async () => {
      throw new Error(`request with ${secret} failed`);
    },
  ]) {
    await assert.rejects(
      create(env(), fetcher).organize(input),
      (error) => !String(error).includes(secret),
    );
  }
  for (const payload of [
    {
      candidates: [
        {
          finishReason: "MAX_TOKENS",
          content: { parts: [{ text: JSON.stringify(proposal) }] },
        },
      ],
    },
    { promptFeedback: { blockReason: "SAFETY" } },
  ]) {
    await assert.rejects(
      create(env("gemini"), async () => json(payload)).organize(input),
      /AIで整理できませんでした/,
    );
  }
});

test("oversized declared and streamed responses are rejected and body is cancelled", async () => {
  await assert.rejects(
    create(
      env(),
      async () =>
        new Response("{}", {
          headers: { "content-length": String(256 * 1024 + 1) },
        }),
    ).organize(input),
  );
  let cancelled = false;
  const stream = new ReadableStream({
    pull(controller) {
      controller.enqueue(new Uint8Array(128 * 1024));
    },
    cancel() {
      cancelled = true;
    },
  });
  await assert.rejects(create(env(), async () => new Response(stream)).organize(input));
  assert.equal(cancelled, true);
});

test("request is aborted after 30 seconds without exposing provider errors", async (context) => {
  context.mock.timers.enable({ apis: ["setTimeout"] });
  let signal;
  const organizer = create(env(), async (_url, options) => {
    signal = options.signal;
    return new Promise((_resolve, reject) =>
      signal.addEventListener("abort", () => reject(new Error(secret))),
    );
  });
  const pending = organizer.organize(input);
  const rejection = assert.rejects(pending, (error) => !String(error).includes(secret));
  context.mock.timers.tick(29_999);
  assert.equal(signal.aborted, false);
  context.mock.timers.tick(1);
  await rejection;
  assert.equal(signal.aborted, true);
});
