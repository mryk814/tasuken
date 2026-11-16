import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import { createLatestRequestGate } from "../src/shared/latestRequest.mjs";

const contracts = fs.readFileSync("src/shared/ipc/contracts.ts", "utf8");
const registerIpc = fs.readFileSync("src/main/ipc/registerIpc.ts", "utf8");
const preload = fs.readFileSync("src/preload/index.ts", "utf8");
const workspaceApi = fs.readFileSync("src/renderer/src/services/workspaceApi.ts", "utf8");

test("Context PreviewのIPCとData Healthの口が残っていない（#755 束8・束10a）", () => {
  // Context Previewを使っていたのはTaskの「AIへの依頼」の欄だけで、束10aでその欄ごと外した。
  for (const source of [contracts, registerIpc, preload, workspaceApi])
    assert.doesNotMatch(source, /aiContextPreview|AiContextPreview|ai-context:preview/);
  // Data Health（棚卸しの画面の診断）は外した（#755 束8）。IPC・preload・画面の口が残っていない。
  for (const source of [contracts, registerIpc, preload, workspaceApi])
    assert.doesNotMatch(source, /dataHealth|DataHealth|data-health/);
});

test("latest request gateはfilter切替後に遅着した古い結果を無効化する (#296)", async () => {
  const gate = createLatestRequestGate();
  let resolveOld;
  let resolveNew;
  const oldResult = new Promise((resolve) => {
    resolveOld = resolve;
  });
  const newResult = new Promise((resolve) => {
    resolveNew = resolve;
  });
  const committed = [];
  const run = async (promise) => {
    const requestId = gate.next();
    const value = await promise;
    if (gate.isCurrent(requestId)) committed.push(value);
  };
  const oldRun = run(oldResult);
  const newRun = run(newResult);
  resolveNew("new-filter");
  await newRun;
  resolveOld("old-filter");
  await oldRun;
  assert.deepEqual(committed, ["new-filter"]);
});
