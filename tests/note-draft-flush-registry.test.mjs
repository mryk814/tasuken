import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import { build } from "esbuild";

async function importBundled(relativePath) {
  const result = await build({
    entryPoints: [path.resolve(relativePath)],
    bundle: true,
    platform: "node",
    format: "esm",
    write: false,
    logLevel: "silent",
  });
  return import(`data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString("base64")}`);
}

const registry = await importBundled("src/renderer/src/features/workspace/lib/noteDraftFlushRegistry.ts");

test("route unmount後のpending saveは、短いcurrent flushが先に終わっても終了ackを急がせない", async () => {
  let releaseOldRoute;
  const oldRoute = new Promise((resolve) => { releaseOldRoute = resolve; });
  registry.trackPendingNoteDraftSave(oldRoute);
  registry.trackPendingNoteDraftSave(Promise.resolve(true));

  let settled = false;
  const flushing = registry.flushPendingNoteDraftSaves().then((ok) => {
    settled = true;
    return ok;
  });
  await Promise.resolve();
  await Promise.resolve();
  assert.equal(settled, false);
  releaseOldRoute(true);
  assert.equal(await flushing, true);
  assert.equal(settled, true);
});

test("pending saveが失敗したときは終了flushも失敗を返す", async () => {
  registry.trackPendingNoteDraftSave(Promise.reject(new Error("save failed")));
  assert.equal(await registry.flushPendingNoteDraftSaves(), false);
});
