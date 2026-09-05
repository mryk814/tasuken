import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createCipheriv, createDecipheriv } from "node:crypto";
import test from "node:test";
import { build } from "esbuild";

const bundled = await build({
  stdin: {
    contents: `export { CaptureOrganizerSettingsService } from "./src/main/services/captureOrganizerSettings.ts";
    export { MobileGatewayAdapter } from "./src/main/gateway/mobile/mobileGatewayAdapter.ts";`,
    resolveDir: process.cwd(),
  },
  bundle: true,
  platform: "node",
  format: "esm",
  write: false,
  logLevel: "silent",
});
const { CaptureOrganizerSettingsService, MobileGatewayAdapter } = await import(
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
const secret = "test-secret-should-never-be-returned";
const input = { provider: "openai", model: "gpt-4.1-mini", endpoint: "", apiKey: secret };
const proposal = {
  title: "牛乳を買う",
  themeId: null,
  startDate: null,
  endDate: null,
  rangeSemantics: null,
  checklist: [],
  supplement: "",
  warnings: [],
};
const capture = {
  text: "牛乳を買う",
  capturedAt: "2026-09-05T12:00:00Z",
  timeZone: "Asia/Tokyo",
  themeId: null,
  themes: [],
};
function setup(t, env = {}, storage = secure, files = fs) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "tasken-organizer-settings-"));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const requests = [];
  const fakeFetch = async (url, init) => {
    requests.push({ url, init, body: JSON.parse(init.body) });
    return new Response(
      JSON.stringify({
        choices: [{ finish_reason: "stop", message: { content: JSON.stringify(proposal) } }],
      }),
    );
  };
  return {
    directory,
    requests,
    fakeFetch,
    service: new CaptureOrganizerSettingsService(directory, storage, env, fakeFetch, files),
  };
}

test("read, encryption and clear failures retain saved configuration and never return raw errors", async (t) => {
  const { service, directory, fakeFetch } = setup(t);
  await service.saveSettings(input);
  const file = path.join(directory, "capture-organizer-settings.json");
  const before = fs.readFileSync(file, "utf8");
  const brokenEncryption = new CaptureOrganizerSettingsService(
    directory,
    {
      ...secure,
      encryptString() {
        throw new Error(secret);
      },
    },
    {},
    fakeFetch,
  );
  await assert.rejects(
    brokenEncryption.saveSettings(input),
    (error) => !String(error).includes(secret),
  );
  const brokenDelete = new CaptureOrganizerSettingsService(directory, secure, {}, fakeFetch, {
    ...fs,
    unlinkSync() {
      throw new Error(secret);
    },
  });
  await assert.rejects(brokenDelete.clearSettings(), (error) => !String(error).includes(secret));
  assert.equal(fs.readFileSync(file, "utf8"), before);
  const brokenRead = new CaptureOrganizerSettingsService(directory, secure, {}, fakeFetch, {
    ...fs,
    readFileSync() {
      throw new Error(secret);
    },
  });
  const unreadable = await brokenRead.getSettings();
  assert.equal(unreadable.source, "none");
  assert.ok(unreadable.configurationError);
  assert.equal(JSON.stringify(unreadable).includes(secret), false);
  assert.throws(
    () => brokenRead.createOrganizer(),
    (error) => !String(error).includes(secret),
  );
});

test("settings encrypt keys, survive restart, keep keys only for the same provider and endpoint, and clear", async (t) => {
  const { service, directory, requests, fakeFetch } = setup(t);
  assert.deepEqual(await service.getSettings(), {
    provider: "openai",
    model: "",
    endpoint: "",
    hasApiKey: false,
    source: "none",
    secureStorageAvailable: true,
  });
  const saved = await service.saveSettings(input);
  assert.equal(saved.source, "saved");
  assert.equal(saved.hasApiKey, true);
  assert.equal(JSON.stringify(saved).includes(secret), false);
  const file = path.join(directory, "capture-organizer-settings.json");
  assert.equal(fs.readFileSync(file, "utf8").includes(secret), false);
  const restarted = new CaptureOrganizerSettingsService(directory, secure, {}, fakeFetch);
  assert.deepEqual(await restarted.getSettings(), saved);
  await restarted.saveSettings({ ...input, model: "gpt-4.1", apiKey: "" });
  await restarted.organize(capture);
  assert.equal(requests.at(-1).init.headers.Authorization, `Bearer ${secret}`);
  assert.equal(requests.at(-1).body.model, "gpt-4.1");
  await assert.rejects(restarted.saveSettings({ ...input, provider: "gemini", apiKey: "" }));
  assert.equal((await restarted.getSettings()).provider, "openai");
  await restarted.saveSettings({
    provider: "azure",
    model: "deployment",
    endpoint: "https://resource.openai.azure.com/",
    apiKey: "azure-secret",
  });
  await restarted.saveSettings({
    provider: "azure",
    model: "deployment-2",
    endpoint: "https://RESOURCE.openai.azure.com",
    apiKey: "",
  });
  await assert.rejects(
    restarted.saveSettings({
      provider: "azure",
      model: "deployment",
      endpoint: "https://other.openai.azure.com",
      apiKey: "",
    }),
  );
  await restarted.organize(capture);
  assert.equal(requests.at(-1).init.headers.Authorization, "Bearer azure-secret");
  assert.equal(requests.at(-1).url, "https://resource.openai.azure.com/openai/v1/chat/completions");
  assert.equal((await restarted.clearSettings()).source, "none");
  assert.equal(fs.existsSync(file), false);
});

test("malformed saved and environment settings remain repairable through settings API", async (t) => {
  const { service, directory } = setup(t, {
    TASKEN_CAPTURE_LLM_PROVIDER: "invalid-provider",
    TASKEN_CAPTURE_LLM_MODEL: "model",
    TASKEN_CAPTURE_LLM_API_KEY: secret,
  });
  assert.ok((await service.getSettings()).configurationError);
  const file = path.join(directory, "capture-organizer-settings.json");
  fs.writeFileSync(file, "malformed-json");
  assert.ok((await service.getSettings()).configurationError);
  assert.equal((await service.saveSettings(input)).source, "saved");
  assert.ok((await service.clearSettings()).configurationError);
  assert.equal(fs.existsSync(file), false);
  assert.equal((await service.saveSettings(input)).source, "saved");
});

test("saved settings override environment, blank key may reuse matching environment, clear restores environment", async (t) => {
  const env = {
    TASKEN_CAPTURE_LLM_PROVIDER: "openai",
    TASKEN_CAPTURE_LLM_MODEL: "env-model",
    TASKEN_CAPTURE_LLM_API_KEY: secret,
  };
  const { service, requests } = setup(t, env);
  assert.equal((await service.getSettings()).source, "environment");
  await service.saveSettings({ ...input, apiKey: undefined });
  await service.organize(capture);
  assert.equal(requests.at(-1).body.model, input.model);
  assert.equal((await service.clearSettings()).source, "environment");
  await service.organize(capture);
  assert.equal(requests.at(-1).body.model, "env-model");
});

test("unavailable encryption and atomic write failure preserve prior settings without leaking secrets", async (t) => {
  const { service, directory, fakeFetch } = setup(t);
  await service.saveSettings(input);
  const file = path.join(directory, "capture-organizer-settings.json");
  const before = fs.readFileSync(file, "utf8");
  for (const storage of [
    { ...secure, isEncryptionAvailable: () => false },
    { ...secure, getSelectedStorageBackend: () => "basic_text" },
  ]) {
    const unavailable = new CaptureOrganizerSettingsService(directory, storage, {}, fakeFetch);
    await assert.rejects(
      unavailable.saveSettings(input),
      (error) => !String(error).includes(secret) && !error.cause,
    );
  }
  const broken = new CaptureOrganizerSettingsService(directory, secure, {}, fakeFetch, {
    ...fs,
    renameSync() {
      throw new Error(secret);
    },
  });
  await assert.rejects(
    broken.saveSettings({ ...input, model: "different", apiKey: "replacement-secret" }),
    (error) => !String(error).includes(secret) && !error.cause,
  );
  assert.equal(fs.readFileSync(file, "utf8"), before);
  assert.deepEqual(fs.readdirSync(directory), ["capture-organizer-settings.json"]);
});

test("connection test sends one bounded fixed input without saving and redacts provider failures", async (t) => {
  const { service, directory, requests } = setup(t);
  assert.equal((await service.testConnection(input)).ok, true);
  assert.equal(requests.length, 1);
  assert.equal(requests[0].init.redirect, "error");
  const data = JSON.parse(requests[0].body.messages[1].content);
  assert.equal(data.text, "牛乳を買う");
  assert.deepEqual(data.themes, []);
  assert.deepEqual(fs.readdirSync(directory), []);
  const failing = new CaptureOrganizerSettingsService(directory, secure, {}, async () => {
    throw new Error(secret);
  });
  const result = await failing.testConnection(input);
  assert.equal(result.ok, false);
  assert.equal(JSON.stringify(result).includes(secret), false);
  assert.deepEqual(fs.readdirSync(directory), []);
});

test("existing Gateway reads newly saved settings and clear without recreation or Core writes", async (t) => {
  const { service, requests } = setup(t);
  const gateway = new MobileGatewayAdapter({
    getCaptureOrganizer: () => service.createOrganizer(),
    core: {
      status: async () => ({
        apiVersion: "1",
        capabilities: ["task.query", "task.command", "get_task_context"],
      }),
      listThemes: () => [],
      executeTaskCommand: () => {
        assert.fail("organizing must not write Core");
      },
    },
    state: {
      current: () => ({ serverId: "desktop", serverRevision: 1, generatedAt: capture.capturedAt }),
    },
  });
  const { themes: _themes, ...body } = capture;
  const request = () =>
    gateway.handle({
      method: "POST",
      path: "/v1/capture-organization",
      principal: {
        kind: "mobile_device",
        deviceId: "phone",
        scopes: ["mobile:read", "mobile:task-write"],
      },
      body,
    });
  assert.equal((await request()).body.error.code, "capability_unavailable");
  await service.saveSettings(input);
  assert.equal((await request()).status, 200);
  await service.saveSettings({ ...input, model: "gpt-4.1", apiKey: "" });
  assert.equal((await request()).status, 200);
  assert.equal(requests.at(-1).body.model, "gpt-4.1");
  await service.clearSettings();
  assert.equal((await request()).body.error.code, "capability_unavailable");
});
