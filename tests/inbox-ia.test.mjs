import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";

const routesSource = readFileSync("src/renderer/src/pages/routes.ts", "utf8");
const inboxPageSource = readFileSync("src/renderer/src/features/workspace/pages/InboxPage.tsx", "utf8");
const workspaceAppSource = readFileSync("src/renderer/src/features/workspace/WorkspaceApp.tsx", "utf8");

test("micro memos are folded into Inbox navigation instead of a separate nav item", () => {
  assert.doesNotMatch(routesSource, /\["micro-memos", "付箋メモ"\]/);
  assert.match(workspaceAppSource, /normalizeRoute/);
  assert.match(workspaceAppSource, /micro-memos/);
  assert.equal(existsSync("src/renderer/src/features/workspace/pages/MicroMemoPage.tsx"), false);
});

test("Inbox page has separate untriaged and micro memo lanes", () => {
  assert.match(inboxPageSource, /buildMicroMemoView/);
  assert.match(inboxPageSource, /付箋メモ/);
  assert.match(inboxPageSource, /Inboxへ送る/);
});
