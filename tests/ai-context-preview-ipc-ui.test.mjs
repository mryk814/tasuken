import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import { createLatestRequestGate } from "../src/shared/latestRequest.mjs";

const contracts = fs.readFileSync("src/shared/ipc/contracts.ts", "utf8");
const registerIpc = fs.readFileSync("src/main/ipc/registerIpc.ts", "utf8");
const preload = fs.readFileSync("src/preload/index.ts", "utf8");
const workspaceApi = fs.readFileSync("src/renderer/src/services/workspaceApi.ts", "utf8");

test("Context Preview IPCはtyped requestだけをMainへ渡す (#296)", () => {
  assert.match(contracts, /aiContextPreview: "ai-context:preview"/);
  assert.match(
    contracts,
    /interface AiContextPreviewRequest\s*{\s*channel: AiContextPreviewChannel;\s*scope: AiContextPreviewScope;/s,
  );
  assert.doesNotMatch(
    contracts.match(/interface AiContextPreviewRequest[\s\S]*?\n}/)?.[0] || "",
    /path|content|query|relation/,
  );
  assert.match(registerIpc, /service\.getAiContextPreview\(request\)/);
  assert.match(preload, /ipcRenderer\.invoke\(IPC\.aiContextPreview, request\)/);
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
