import assert from "node:assert/strict";
import { Buffer } from "node:buffer";
import path from "node:path";
import test from "node:test";

import { build } from "esbuild";

import { entityDefinitions } from "../src/shared/entityRegistry.mjs";

/**
 * Rendererの投影とRegistryの対応（#454後半で見つかった不具合の再発防止）。
 *
 * `projectWorkspaceData` は `WORKSPACE_ARRAY_KEYS` に載っているcollectionだけを画面へ渡す。
 * 新しいEntity種別をRegistryへ足したときにここを忘れると、保存はできるのに画面へ出ない
 * （HabitとFeedの印で実際に起きた）。Registryを正本として固定する。
 *
 * rendererのmoduleは拡張子なしのimportを持つため、esbuildでまとめてから読む。
 */
async function loadProjectionKeys() {
  const result = await build({
    stdin: {
      contents:
        'export { WORKSPACE_ARRAY_KEYS } from "./src/renderer/src/features/workspace/lib/workspaceProjection.ts";',
      resolveDir: process.cwd(),
    },
    bundle: true,
    platform: "node",
    format: "esm",
    write: false,
    logLevel: "silent",
  });
  const module = await import(
    `data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString("base64")}`
  );
  return module.WORKSPACE_ARRAY_KEYS;
}

test("rendererの投影はRegistryの全collectionを読む", async () => {
  const keys = new Set(await loadProjectionKeys());
  const missing = entityDefinitions
    .map((definition) => definition.collectionKey)
    .filter((collectionKey) => !keys.has(collectionKey));
  assert.deepEqual(
    missing,
    [],
    `WORKSPACE_ARRAY_KEYSに無いcollectionがあります: ${missing.join(", ")}`,
  );
});
