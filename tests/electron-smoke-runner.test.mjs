import assert from "node:assert/strict";
import test from "node:test";
import { buildElectronSmokeArgs, createSmokePaths } from "../scripts/run-electron-smoke.mjs";

test("Electron smoke runner creates unique explicit userData and result paths", () => {
  const first = createSmokePaths("C:/temp", "ci");
  const second = createSmokePaths("C:/temp", "ci");
  assert.notEqual(first.runId, second.runId);
  for (const paths of [first, second]) {
    const args = buildElectronSmokeArgs(paths);
    assert.ok(args.includes("--smoke-test"));
    assert.ok(args.includes(`--smoke-run-id=${paths.runId}`));
    assert.ok(args.includes(`--user-data-dir=${paths.userDataDir}`));
    assert.ok(args.includes(`--smoke-result-path=${paths.resultPath}`));
  }
  assert.notEqual(first.userDataDir, second.userDataDir);
  assert.notEqual(first.resultPath, second.resultPath);
});
