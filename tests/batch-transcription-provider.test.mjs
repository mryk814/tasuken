import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { build } from "esbuild";

async function loadService() {
  globalThis.__batchSafeStorage = {
    isEncryptionAvailable: () => true,
    encryptString: (value) => Buffer.from(`encrypted:${value}`, "utf8"),
    decryptString: (value) => value.toString("utf8").replace(/^encrypted:/, ""),
  };
  const result = await build({
    entryPoints: ["src/main/services/aiProviderService.ts"],
    bundle: true,
    format: "esm",
    platform: "node",
    write: false,
    plugins: [{
      name: "batch-safe-storage",
      setup(buildApi) {
        buildApi.onResolve({ filter: /^electron$/ }, () => ({ path: "electron-stub", namespace: "batch-test" }));
        buildApi.onLoad({ filter: /.*/, namespace: "batch-test" }, () => ({
          contents: "export const safeStorage = globalThis.__batchSafeStorage;",
          loader: "js",
        }));
      },
    }],
  });
  return import(`data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text, "utf8").toString("base64")}`);
}

function storedConfig(model, options = {}) {
  const providerId = options.providerId || "provider-openai";
  return {
    schemaVersion: 2,
    providers: [{
      id: providerId,
      label: "OpenAI",
      adapterKind: options.adapterKind || "openai-native",
      authKind: "api_key",
      endpoint: options.endpoint || null,
      organization: null,
      project: null,
      region: null,
      deployment: null,
      apiSurface: "responses",
      requestTimeoutMs: 120_000,
      enabled: true,
      credentialRef: `ai-profile:${providerId}`,
      encryptedCredential: Buffer.from("encrypted:test-secret", "utf8").toString("base64"),
    }],
    models: [{
      id: "model-default",
      providerProfileId: providerId,
      model,
      displayName: model,
      capabilities: ["text"],
      contextLimit: null,
      outputLimit: null,
      costHint: null,
      lifecycle: "available",
    }],
    defaultProviderProfileId: providerId,
    defaultModelProfileId: "model-default",
  };
}

test("production binding mints only exact implemented transcription models without fallback", async (t) => {
  const { AiProviderService } = await loadService();
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "tasken-transcription-provider-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const configPath = path.join(root, "ai-provider.json");

  fs.writeFileSync(configPath, JSON.stringify(storedConfig("gpt-4o-transcribe")));
  const supported = new AiProviderService(root, globalThis.__batchSafeStorage).resolveBatchTranscriptionProvider();
  assert.equal(supported.binding.model_id, "gpt-4o-transcribe");
  assert.equal(supported.binding.capabilities.includes("batch_transcription"), true);
  assert.equal(typeof supported.provider.transcribe, "function");

  for (const unsupportedModel of ["gpt-5.6", "gpt-4o-transcribe-diarize", "custom-transcriber"] ) {
    fs.writeFileSync(configPath, JSON.stringify(storedConfig(unsupportedModel)));
    const unsupported = new AiProviderService(root, globalThis.__batchSafeStorage).resolveBatchTranscriptionProvider();
    assert.equal(unsupported.reason, "capability_missing");
    assert.equal(unsupported.provider, null);
    assert.deepEqual(unsupported.binding.capabilities, []);
  }
});

test("OpenAI batch adapter reads the verified descriptor once and normalizes only safe transcript fields", async (t) => {
  const { AiProviderService } = await loadService();
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "tasken-transcription-adapter-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.writeFileSync(path.join(root, "ai-provider.json"), JSON.stringify(storedConfig("whisper-1")));
  const audioPath = path.join(root, "audio.wav");
  fs.writeFileSync(audioPath, Buffer.from("RIFF-test-WAVE"));
  const descriptor = fs.openSync(audioPath, "r");
  t.after(() => fs.closeSync(descriptor));
  let calls = 0;
  const fetcher = async (url, init) => {
    calls += 1;
    assert.equal(url, "https://api.openai.com/v1/audio/transcriptions");
    assert.equal(init.headers.Authorization, "Bearer test-secret");
    assert.equal(init.body.get("model"), "whisper-1");
    const file = init.body.get("file");
    assert.equal(await file.text(), "RIFF-test-WAVE");
    return new Response(JSON.stringify({ text: "normalized transcript", language: "ja", provider_debug: "not projected" }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  };
  const context = new AiProviderService(root, globalThis.__batchSafeStorage, fetcher).resolveBatchTranscriptionProvider();
  const result = await context.provider.transcribe({
    source: { fileDescriptor: descriptor },
    fileSize: fs.statSync(audioPath).size,
    mimeType: "audio/wav",
    model: "whisper-1",
    language: "ja",
  });
  assert.equal(calls, 1);
  assert.deepEqual(result, { rawText: "normalized transcript", language: "ja" });
});

test("compact Artifact detail integration keeps cloud send behind explicit confirmation", () => {
  const panel = fs.readFileSync("src/renderer/src/features/workspace/components/BatchTranscriptionPanel.tsx", "utf8");
  const viewer = fs.readFileSync("src/renderer/src/features/workspace/components/ContentViewer.tsx", "utf8");
  const preload = fs.readFileSync("src/preload/index.ts", "utf8");
  assert.match(viewer, /<BatchTranscriptionPanel key=\{load\.artifact\.id\} artifactId=\{load\.artifact\.id\}/);
  assert.match(panel, /確認して実行/);
  assert.match(panel, /Cloudへ原音を送信/);
  assert.match(panel, /workspaceApi\.runBatchTranscription/);
  assert.match(panel, /latest\?\.status === "processing" \? latest\.operation_id/);
  assert.match(panel, /workspaceApi\.cancelBatchTranscription\(artifactId, operationId\)/);
  assert.ok(panel.indexOf("確認して実行") < panel.indexOf("workspaceApi.runBatchTranscription") || panel.includes("async function run"));
  assert.match(preload, /batchTranscription:\s*\{/);
  assert.doesNotMatch(preload, /batchTranscription[^}]+(?:path|bytes|credential)/s);
});
