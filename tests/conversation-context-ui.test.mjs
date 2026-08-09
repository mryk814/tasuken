import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const panel = fs.readFileSync("src/renderer/src/features/workspace/components/ConversationContextPanel.tsx", "utf8");
const viewer = fs.readFileSync("src/renderer/src/features/workspace/components/ContentViewer.tsx", "utf8");
const contracts = fs.readFileSync("src/shared/ipc/contracts.ts", "utf8");
const preload = fs.readFileSync("src/preload/index.ts", "utf8");
const ipc = fs.readFileSync("src/main/ipc/registerIpc.ts", "utf8");

test("Conversation Viewerから明示公開・更新・解除へ到達できる", () => {
  assert.match(viewer, /ConversationContextPanel/);
  assert.match(panel, /AI Contextへ保存/);
  assert.match(panel, /OneDriveへ公開済み/);
  assert.match(panel, /公開内容を更新/);
  assert.match(panel, /AI Contextから外す/);
  assert.match(panel, /会話全体/);
  assert.match(panel, /発言を選択/);
});

test("再読込の初回Previewはpersisted scopeを採用し、古い応答を捨てる", () => {
  assert.match(panel, /refresh\(undefined, undefined, true\)/);
  assert.match(panel, /usePersisted\s*\?\s*\{ conversationId: resource\.id \}/);
  assert.match(panel, /requestSequence/);
  assert.match(panel, /sequence !== requestSequence\.current/);
  assert.match(panel, /disabled=\{busy \|\| loading\}/);
});

test("Previewはpathと公開判断metadataをtyped resultで表示する", () => {
  for (const field of ["sourceUrl", "theme", "summary", "freshness", "authority", "aiVisibility"]) {
    assert.match(contracts, new RegExp(`${field}:`));
    assert.match(panel, new RegExp(`preview\\.${field}`));
  }
  assert.match(panel, /preview\.content/);
  assert.match(panel, /preview\.relativePath/);
  assert.match(panel, /preview\.blockingReasons/);
});

test("Conversation Context IPCはtyped namespaceでMainまで接続される", () => {
  assert.match(contracts, /conversationContext:\s*\{/);
  assert.match(preload, /conversationContext:\s*\{/);
  assert.match(ipc, /IPC\.conversationContextPreview/);
  assert.match(ipc, /IPC\.conversationContextPublish/);
  assert.match(ipc, /IPC\.conversationContextRemove/);
  assert.match(ipc, /notifyEntitiesChanged\(\["resource"\]\)/);
});

test("Renderer toastへraw exceptionやabsolute pathを展開しない", () => {
  assert.doesNotMatch(panel, /caught\.message|String\(caught\)/);
  assert.doesNotMatch(panel, /last_error/);
  assert.match(panel, /OneDriveの同期状態/);
});
