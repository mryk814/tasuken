import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import { Buffer } from "node:buffer";

import { build } from "esbuild";

async function loadFlush() {
  const result = await build({
    entryPoints: [path.resolve("src/renderer/src/features/workspace/lib/mediaRecorderFlush.ts")],
    bundle: true,
    platform: "node",
    format: "esm",
    write: false,
    logLevel: "silent",
  });
  return import(`data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString("base64")}`);
}

test("pause flush waits past an already queued timeslice for the requestData event and quiet drain", async () => {
  const { waitForMediaRecorderDataFlush } = await loadFlush();
  const listeners = new Set();
  let eventCount = 0;
  const recorder = {
    addEventListener(_type, listener) { listeners.add(listener); },
    removeEventListener(_type, listener) { listeners.delete(listener); },
    requestData() {
      setTimeout(() => {
        eventCount += 1;
        for (const listener of listeners) listener(new Event("dataavailable"));
      }, 10);
    },
  };
  let resolved = false;
  const flushing = waitForMediaRecorderDataFlush(recorder, { quietMs: 20, timeoutMs: 200 }).then(() => { resolved = true; });
  eventCount += 1;
  for (const listener of listeners) listener(new Event("dataavailable"));
  await new Promise((resolve) => setTimeout(resolve, 25));
  assert.equal(resolved, false);
  await flushing;
  assert.equal(eventCount, 2);
  assert.equal(listeners.size, 0);
});

test("pause flush fails boundedly when requestData produces no event and removes its listener", async () => {
  const { waitForMediaRecorderDataFlush } = await loadFlush();
  const listeners = new Set();
  const recorder = {
    addEventListener(_type, listener) { listeners.add(listener); },
    removeEventListener(_type, listener) { listeners.delete(listener); },
    requestData() {},
  };
  await assert.rejects(waitForMediaRecorderDataFlush(recorder, { quietMs: 5, timeoutMs: 20 }), /時間内/);
  assert.equal(listeners.size, 0);
});
