import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

const panelPath = path.resolve(
  "src/renderer/src/features/workspace/components/ActivityLogPanel.tsx",
);
const panelSource = readFileSync(panelPath, "utf8");

test("Activity calendar reapplies its initial scroll when the panel reopens", () => {
  assert.match(panelSource, /if \(!expanded \|\| !calendar\) return;/);
  assert.match(panelSource, /\[activityCalendarScrollKey, expanded, initialActivityTop\]/);
});

test("AI session detail retains labeled remaining work", () => {
  assert.match(panelSource, /expandedSession\.outcome\?\.remaining_work\.length/);
  assert.match(panelSource, /<span>残作業<\/span>/);
});
