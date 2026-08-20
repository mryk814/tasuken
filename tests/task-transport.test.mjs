import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  TASK_IPC_CHANNELS,
} from "../src/shared/contracts/task/public.ts";
import {
  LEGACY_TASK_IPC_CHANNELS,
} from "../src/shared/compatibility/taskIpc.ts";

test("Task IPC channel names have a feature contract owner", () => {
  assert.deepEqual(TASK_IPC_CHANNELS, {
    command: "task:command",
    query: "task:query",
    changed: "task:changed",
  });
});

test("aggregate IPC exposes an explicit compatibility alias without owning literals", () => {
  assert.equal(LEGACY_TASK_IPC_CHANNELS, TASK_IPC_CHANNELS);

  const ipcSource = readFileSync("src/shared/ipc/contracts.ts", "utf8");
  assert.match(ipcSource, /LEGACY_TASK_IPC_CHANNELS/);
  assert.doesNotMatch(ipcSource, /taskCommand:\s*"task:command"/);
  assert.doesNotMatch(ipcSource, /taskQuery:\s*"task:query"/);
  assert.doesNotMatch(ipcSource, /taskChanged:\s*"task:changed"/);
});

test("compatibility alias has a consumer-zero removal condition", () => {
  const compatibilitySource = readFileSync("src/shared/compatibility/taskIpc.ts", "utf8");
  assert.match(compatibilitySource, /Removal condition \(#407\/#406\)/);
  assert.match(compatibilitySource, /consumer inventory reaches zero/);
});
