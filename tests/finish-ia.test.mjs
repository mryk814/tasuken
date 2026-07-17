import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const workspaceAppSource = readFileSync("src/renderer/src/features/workspace/WorkspaceApp.tsx", "utf8");
const uiStoreSource = readFileSync("src/renderer/src/stores/uiStore.ts", "utf8");
const shellSource = readFileSync("src/renderer/src/features/workspace/components/shell.tsx", "utf8");

test("toast tone is explicit state instead of message-regex inference", () => {
  assert.match(uiStoreSource, /toastTone/);
  assert.match(uiStoreSource, /setToast\(message: string, tone\?: ToastTone\): void/);
  assert.doesNotMatch(workspaceAppSource, /function toastTone/);
  assert.doesNotMatch(workspaceAppSource, /toastTone\(toast/);
});

test("app opens Today when no route is specified", () => {
  assert.match(uiStoreSource, /location\.hash\.slice\(1\) \|\| "today"/);
});

test("sidebar count badges are limited to action-driving counts", () => {
  assert.doesNotMatch(shellSource, /notesCount/);
  assert.doesNotMatch(shellSource, /knowledgeCount/);
  assert.doesNotMatch(shellSource, /chatRefCount/);
  assert.match(shellSource, /overdueTasks/);
  assert.doesNotMatch(shellSource, /dueWaitings/);
  assert.match(shellSource, /knowledgeHealthIssueCount/);
  assert.match(shellSource, /knowledge:\s*knowledgeHealthIssueCount/);
  assert.match(shellSource, /"ai-io": proposalCount/);
});

test("shortcut dialog lists capture window and tray-oriented entries", () => {
  assert.match(shellSource, /Ctrl<\/kbd>\+<kbd>Shift<\/kbd>\+<kbd>N/);
  assert.match(shellSource, /Ctrl<\/kbd>\+<kbd>Shift<\/kbd>\+<kbd>\./);
  assert.match(shellSource, /トレイ/);
});
