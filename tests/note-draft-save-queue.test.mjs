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

const queue = await importBundled("src/renderer/src/features/workspace/lib/noteDraftSaveQueue.ts");

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((nextResolve, nextReject) => {
    resolve = nextResolve;
    reject = nextReject;
  });
  return { promise, resolve, reject };
}

test("current saveのreject後もlatest snapshotを同じqueueでdrainする", async () => {
  const state = { current: null, latest: "first", inFlight: null };
  const first = deferred();
  const calls = [];
  const run = queue.startLatestSaveQueue(state, {
    save: async (job) => {
      calls.push(job);
      if (job === "first") return first.promise;
      return "latest-saved";
    },
  });
  await Promise.resolve();
  state.latest = "latest";
  first.reject(new Error("temporary failure"));

  assert.equal(await run, "latest-saved");
  assert.deepEqual(calls, ["first", "latest"]);
  assert.equal(state.current, null);
  assert.equal(state.latest, null);
  assert.equal(state.inFlight, null);
});

test("inFlightが消えた後に同一latestを再投入してもdrainを再起動する", async () => {
  const state = { current: null, latest: "same-job", inFlight: null };
  let attempts = 0;
  const first = queue.startLatestSaveQueue(state, {
    save: async () => {
      attempts += 1;
      throw new Error("first failure");
    },
  });
  await assert.rejects(first, /first failure/);
  assert.equal(state.inFlight, null);

  state.latest = "same-job";
  const retry = queue.startLatestSaveQueue(state, {
    save: async () => {
      attempts += 1;
      return "retried";
    },
  });
  assert.equal(await retry, "retried");
  assert.equal(attempts, 2);
  assert.equal(state.latest, null);
  assert.equal(state.inFlight, null);
});
