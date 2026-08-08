import assert from "node:assert/strict";
import { Buffer } from "node:buffer";
import path from "node:path";
import test from "node:test";
import { build } from "esbuild";

const result = await build({
  entryPoints: [path.resolve("src/renderer/src/utils/usePreference.ts")],
  bundle: true,
  platform: "browser",
  format: "esm",
  write: false,
  logLevel: "silent",
});
const preference = await import(`data:text/javascript;base64,${Buffer.from(result.outputFiles[0].contents).toString("base64")}`);

test("a delayed A failure cannot rollback a newer optimistic B write", () => {
  assert.equal(preference.shouldRollbackPreferenceWrite({
    effectGeneration: 1,
    currentEffectGeneration: 1,
    writeSequence: 1,
    latestWriteSequence: 2,
    externalGeneration: 0,
    currentExternalGeneration: 0,
  }), false);
  assert.equal(preference.shouldRollbackPreferenceWrite({
    effectGeneration: 1,
    currentEffectGeneration: 1,
    writeSequence: 2,
    latestWriteSequence: 2,
    externalGeneration: 0,
    currentExternalGeneration: 0,
  }), true);
});

test("a newer cross-window revision invalidates an old rollback", () => {
  assert.equal(preference.shouldRollbackPreferenceWrite({
    effectGeneration: 1,
    currentEffectGeneration: 1,
    writeSequence: 1,
    latestWriteSequence: 1,
    externalGeneration: 0,
    currentExternalGeneration: 1,
  }), false);
});

test("a scope change invalidates a pending write from the previous Theme", () => {
  assert.equal(preference.shouldRollbackPreferenceWrite({
    effectGeneration: 1,
    currentEffectGeneration: 2,
    writeSequence: 1,
    latestWriteSequence: 1,
    externalGeneration: 0,
    currentExternalGeneration: 0,
  }), false);
});
