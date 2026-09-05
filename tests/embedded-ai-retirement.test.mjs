import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { build } from "esbuild";

async function loadMigration() {
  const output = await build({
    entryPoints: ["src/main/services/embeddedAiRetirementMigration.ts"],
    bundle: true,
    format: "esm",
    platform: "node",
    write: false,
  });
  return import(
    `data:text/javascript;base64,${Buffer.from(output.outputFiles[0].text).toString("base64")}`
  );
}

function productionSources(directory) {
  const files = [];
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const filePath = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...productionSources(filePath));
    else if (/\.(?:[cm]?[jt]s|tsx)$/.test(entry.name)) files.push(filePath);
  }
  return files;
}

test("embedded AI retirement migration removes credential config and is idempotent", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "tasken-retire-embedded-ai-"));
  try {
    const configPath = path.join(root, "ai-provider.json");
    fs.writeFileSync(configPath, JSON.stringify({ encryptedCredential: "secret-ciphertext" }));
    const { applyEmbeddedAiRetirementMigration, EMBEDDED_AI_RETIREMENT_MIGRATION_VERSION } =
      await loadMigration();

    assert.deepEqual(applyEmbeddedAiRetirementMigration(root), {
      version: EMBEDDED_AI_RETIREMENT_MIGRATION_VERSION,
      credentialConfigRemoved: true,
    });
    assert.equal(fs.existsSync(configPath), false);
    assert.deepEqual(applyEmbeddedAiRetirementMigration(root), {
      version: EMBEDDED_AI_RETIREMENT_MIGRATION_VERSION,
      credentialConfigRemoved: false,
    });
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("embedded AI retirement migration fails closed when the exact credential path cannot be removed", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "tasken-retire-embedded-ai-failure-"));
  const configPath = path.join(root, "ai-provider.json");
  fs.mkdirSync(configPath);
  try {
    const { applyEmbeddedAiRetirementMigration } = await loadMigration();
    assert.throws(() => applyEmbeddedAiRetirementMigration(root));
    assert.equal(fs.statSync(configPath).isDirectory(), true);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("production source has no general embedded provider, Note stream, or transcription execution surface", () => {
  const forbidden =
    /api\.openai\.com|\/audio\/transcriptions|openai-native|openai-compatible|azure-openai|AiProviderService|ai:config-get|ai:note-stream|batch-transcription:(?:preview|run|cancel)|NoteAiDrawer/;
  const matches = productionSources("src").flatMap((filePath) => {
    if (filePath.endsWith(path.join("gateway", "mobile", "captureOrganizer.ts"))) return [];
    const lines = fs.readFileSync(filePath, "utf8").split(/\r?\n/);
    return lines.flatMap((line, index) =>
      forbidden.test(line) ? [`${filePath}:${index + 1}`] : [],
    );
  });
  assert.deepEqual(matches, []);
});
