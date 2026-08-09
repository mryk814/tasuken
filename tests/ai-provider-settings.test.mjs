import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { build } from "esbuild";

const service = readFileSync("src/main/services/aiProviderService.ts", "utf8");
const settings = readFileSync("src/renderer/src/features/workspace/pages/SettingsPage.tsx", "utf8");

let aiProviderServiceModulePromise;

async function loadAiProviderService() {
  if (!aiProviderServiceModulePromise) {
    globalThis.__aiTestSafeStorage = {
      isEncryptionAvailable: () => true,
      encryptString: (value) => Buffer.from(`encrypted:${value}`, "utf8"),
      decryptString: (value) => value.toString("utf8").replace(/^encrypted:/, ""),
    };
    aiProviderServiceModulePromise = build({
      entryPoints: ["src/main/services/aiProviderService.ts"],
      bundle: true,
      format: "esm",
      platform: "node",
      outfile: "ai-provider-service.mjs",
      write: false,
      plugins: [{
        name: "stub-electron-safe-storage",
        setup(buildApi) {
          buildApi.onResolve({ filter: /^electron$/ }, () => ({ path: "electron-safe-storage-stub", namespace: "ai-test" }));
          buildApi.onLoad({ filter: /.*/, namespace: "ai-test" }, () => ({
            contents: "export const safeStorage = globalThis.__aiTestSafeStorage;",
            loader: "js",
          }));
        },
      }],
    }).then((result) => {
      const output = result.outputFiles?.[0]?.text;
      if (!output) throw new Error("AI provider service test bundle was empty");
      return import(`data:text/javascript;base64,${Buffer.from(output, "utf8").toString("base64")}`);
    });
  }
  return aiProviderServiceModulePromise;
}

function providerFixture(id) {
  return {
    id,
    label: "OpenAI",
    adapterKind: "openai-native",
    authKind: "api_key",
    endpoint: null,
    organization: null,
    project: null,
    region: null,
    deployment: null,
    apiSurface: "responses",
    requestTimeoutMs: 120_000,
    enabled: true,
    credentialRef: `ai-profile:${id}`,
  };
}

function configFixture(providers, models = []) {
  return {
    schemaVersion: 2,
    providers,
    models,
    defaultProviderProfileId: null,
    defaultModelProfileId: null,
  };
}

function writeConfig(userDataPath, value) {
  const configPath = path.join(userDataPath, "ai-provider.json");
  writeFileSync(configPath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  return configPath;
}

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
  assert.match(settings, /AI_SURFACES_BY_ADAPTER/);
  assert.match(settings, /function changeAiAdapter/);
  assert.match(service, /anthropic: \{ auth: \["api_key"\], surfaces: \["native"\] \}/);
  assert.match(service, /providers\.some\(\(provider\) => provider\.id === parsed\.defaultProviderProfileId && provider\.enabled\)/);
  assert.doesNotMatch(service, /providers\[0\]\?\.id/);
});

test("future schema fixture is rejected before legacy migration and duplicate IDs are refused", () => {
  const futureSchemaFixture = { schemaVersion: 3, providers: [], models: [] };
  const duplicateProviderFixture = { schemaVersion: 2, providers: [{ id: "same" }, { id: "same" }], models: [] };
  const duplicateModelFixture = { schemaVersion: 2, providers: [{ id: "provider" }], models: [{ id: "same" }, { id: "same" }] };
  assert.ok(futureSchemaFixture.schemaVersion > 2);
  assert.equal(duplicateProviderFixture.providers[0].id, duplicateProviderFixture.providers[1].id);
  assert.equal(duplicateModelFixture.models[0].id, duplicateModelFixture.models[1].id);
  assert.match(service, /schemaVersion > AI_CONFIG_SCHEMA_VERSION/);
  assert.match(service, /schemaVersionが新しすぎます。アプリを更新してください。設定ファイルは変更していません/);
  assert.match(service, /if \(schemaVersion === undefined \|\| schemaVersion === 1\)/);
  assert.match(service, /旧AI設定のprofile形式を移行できません/);
  assert.match(service, /if \(schemaVersion !== AI_CONFIG_SCHEMA_VERSION\)/);
  assert.match(service, /provider profileのidが重複しています/);
  assert.match(service, /model profileのidが重複しています/);
  assert.ok(service.indexOf("schemaVersionが新しすぎます") < service.indexOf("const migrated = migrateLegacyConfig"));
});

test("AI provider config read enforces future-version, legacy migration, and duplicate-ID boundaries", async () => {
  const { AiProviderService } = await loadAiProviderService();
  const userDataPath = mkdtempSync(path.join(tmpdir(), "tasken-ai-provider-config-"));
  try {
    const futurePath = writeConfig(userDataPath, { schemaVersion: 3, providers: [], models: [], defaultProviderProfileId: null, defaultModelProfileId: null });
    const futureBefore = readFileSync(futurePath);
    const futureMtime = statSync(futurePath).mtimeMs;
    const serviceForFuture = new AiProviderService(userDataPath, globalThis.__aiTestSafeStorage);
    assert.throws(() => serviceForFuture.getConfig(), /schemaVersionが新しすぎます/);
    assert.deepEqual(readFileSync(futurePath), futureBefore);
    assert.equal(statSync(futurePath).mtimeMs, futureMtime);

    const legacyPath = writeConfig(userDataPath, { provider: "openai", model: "legacy-model", apiKey: "legacy-secret" });
    const serviceForLegacy = new AiProviderService(userDataPath, globalThis.__aiTestSafeStorage);
    const migrated = serviceForLegacy.getConfig();
    assert.equal(migrated.schemaVersion, 2);
    assert.equal(migrated.models[0].model, "legacy-model");
    assert.equal(migrated.providers[0].credentialConfigured, true);
    const migratedFile = JSON.parse(readFileSync(legacyPath, "utf8"));
    assert.equal(migratedFile.apiKey, undefined);
    assert.equal(migratedFile.providers[0].encryptedCredential, Buffer.from("encrypted:legacy-secret", "utf8").toString("base64"));

    const duplicateProviderPath = writeConfig(userDataPath, configFixture([providerFixture("duplicate"), providerFixture("duplicate")]));
    const duplicateProviderBefore = readFileSync(duplicateProviderPath);
    assert.throws(() => new AiProviderService(userDataPath, globalThis.__aiTestSafeStorage).getConfig(), /provider profileのidが重複しています/);
    assert.deepEqual(readFileSync(duplicateProviderPath), duplicateProviderBefore);

    const modelA = { id: "duplicate-model", providerProfileId: "provider", model: "gpt-5.6", displayName: "GPT", capabilities: ["text"], contextLimit: null, outputLimit: null, costHint: null, lifecycle: "available" };
    const modelB = { ...modelA };
    const duplicateModelPath = writeConfig(userDataPath, configFixture([providerFixture("provider")], [modelA, modelB]));
    const duplicateModelBefore = readFileSync(duplicateModelPath);
    assert.throws(() => new AiProviderService(userDataPath, globalThis.__aiTestSafeStorage).getConfig(), /model profileのidが重複しています/);
    assert.deepEqual(readFileSync(duplicateModelPath), duplicateModelBefore);
  } finally {
    rmSync(userDataPath, { recursive: true, force: true });
  }
});
