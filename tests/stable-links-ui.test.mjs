import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

test("shared lineage panel presents typed links, backlinks and non-navigable diagnostics", () => {
  const panel = readFileSync("src/renderer/src/features/workspace/components/LineagePanel.tsx", "utf8");
  assert.match(panel, /buildStableLinkContext/);
  assert.match(panel, /<h4>リンク<\/h4>/);
  assert.match(panel, /<h4>Backlinks<\/h4>/);
  assert.match(panel, /<h4>リンク切れ<\/h4>/);
  assert.match(panel, /<h4>旧リンク（移行候補）<\/h4>/);
  assert.match(panel, /<h4>旧リンク（要確認）<\/h4>/);
  assert.match(panel, /item\.kind === "resolved"/);
  assert.match(panel, /disabled=\{!canOpen\}/);
  assert.match(panel, /type: \(item\.ref\.type === "project" \? "theme" : item\.ref\.type\)/);
});

test("major entity details including Conversation reuse the shared lineage panel", () => {
  const drawer = readFileSync("src/renderer/src/features/workspace/components/drawer.tsx", "utf8");
  const artifacts = readFileSync("src/renderer/src/features/workspace/components/artifacts.tsx", "utf8");
  for (const pattern of [
    /seed=\{\{ type: "resource", id: resourceId \}\}/,
    /conversation=\{isChatRef\}/,
    /seed=\{\{ type: "task", id: task\.id \}\}/,
    /seed=\{\{ type: "note", id: note\.id \}\}/,
    /seed=\{\{ type: "sketch", id: sketch\.id \}\}/,
    /seed=\{\{ type: "waiting", id: waiting\.id \}\}/,
    /seed=\{\{ type: "plan_node", id: planNode\.id \}\}/,
    /seed=\{\{ type: "capture_entry", id: entry\.id \}\}/,
    /seed=\{\{ type: "knowledge_node", id: node\.id \}\}/,
  ]) assert.match(drawer, pattern);
  assert.match(artifacts, /seed=\{\{ type: "artifact", id: artifact\.id \}\}/);
});
