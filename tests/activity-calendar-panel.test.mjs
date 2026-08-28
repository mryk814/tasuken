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

test("compact blocks retain time and the selected detail restates context", () => {
  assert.match(panelSource, /activity-calendar-event-compact-theme/);
  assert.doesNotMatch(panelSource, /activity-calendar-event\.is-tiny/);
  assert.match(panelSource, /ActivityThemeChips themeIds=\{expandedTimelineItem\.theme_ids\}/);
  assert.match(panelSource, /詳細を閉じる/);
  assert.match(panelSource, /is-selected/);
});

test("AI sessions remain AI work and empty days keep the calendar grid", () => {
  assert.match(panelSource, /display_kind: "ai_work" as const/);
  assert.match(panelSource, /関連活動に\{displayKindLabel\(typeFilter as ActivityTimelineItem/);
  assert.match(panelSource, /Activity の空の時刻カレンダー/);
});
