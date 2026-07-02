import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const componentSource = readFileSync("src/renderer/src/features/workspace/components/InlineAddPanel.tsx", "utf8");
const pagePaths = [
  "src/renderer/src/features/workspace/pages/TodayPage.tsx",
  "src/renderer/src/features/workspace/pages/TodoPage.tsx",
  "src/renderer/src/features/workspace/pages/WaitingPage.tsx",
];

test("inline add panel is a shared component", () => {
  assert.match(componentSource, /export function InlineAddPanel/);
  assert.match(componentSource, /extraFields/);
});

test("Today, ToDo, and Waiting use the shared inline add panel", () => {
  for (const path of pagePaths) {
    const source = readFileSync(path, "utf8");
    assert.match(source, /InlineAddPanel/, `${path} should import and render InlineAddPanel`);
    assert.doesNotMatch(source, /style=\{\{ flex: 1 \}\}/, `${path} should not keep the legacy local add input layout`);
  }
});
