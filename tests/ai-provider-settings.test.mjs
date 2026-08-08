import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const service = readFileSync("src/main/services/aiProviderService.ts", "utf8");
const settings = readFileSync("src/renderer/src/features/workspace/pages/SettingsPage.tsx", "utf8");

test("AI settings keeps loading, empty, error and retry states reachable", () => {
  assert.match(settings, /aiConfigState.*loading/);
  assert.match(settings, /aiConfigState === "empty"/);
  assert.match(settings, /aiConfigState === "error"/);
  assert.match(settings, /setAiConfigReloadToken/);
  assert.match(settings, /再試行/);
});

test("provider enablement and deletion are independent of credential presence", () => {
  assert.match(settings, /checked=\{aiEnabled\}/);
  assert.match(settings, /setAiEnabled\(event\.target\.checked\)/);
  assert.match(settings, /selectAiProvider\(config\.defaultProviderProfileId \|\| config\.providers\[0\]\?\.id \|\| "", config\)/);
  assert.match(settings, /selectedAiProvider && \(/);
  assert.match(settings, /このprovider profileを削除/);
  assert.match(service, /default providerは無効化できません/);
});

test("credential and provider API boundaries do not expose provider options or plaintext config projection", () => {
  assert.doesNotMatch(service, /providerOptions/);
  assert.match(service, /credentialConfigured: Boolean\(provider\.encryptedCredential\)/);
  assert.match(service, /redact\(error\.projection\.message, credential\)/);
  assert.match(service, /credentialは空欄にできません/);
  assert.match(service, /schemaVersion: AI_CONFIG_SCHEMA_VERSION/);
  assert.match(service, /endpointExposure: endpointExposure\(provider\.endpoint\)/);
  assert.match(service, /DEFAULT_REQUEST_TIMEOUT_MS = 120_000/);
  assert.match(service, /CONNECTION_TIMEOUT_MS = 30_000/);
  assert.match(settings, /Generation timeout \(sec\)/);
  assert.match(service, /providers\.some\(\(provider\) => provider\.id === parsed\.defaultProviderProfileId && provider\.enabled\)/);
  assert.doesNotMatch(service, /providers\[0\]\?\.id/);
});
