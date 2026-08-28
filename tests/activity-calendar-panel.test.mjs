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
  assert.match(panelSource, /activityThemeSummary\(row\.theme_ids, themes\)/);
  assert.match(panelSource, /<ActivityCompactTheme themeIds=\{row\.theme_ids\} themes=\{themes\}/);
  assert.doesNotMatch(panelSource, /activity-calendar-event\.is-tiny/);
  assert.match(panelSource, /<ActivityThemeChips\s+themeIds=\{expandedTimelineItem\.theme_ids\}/);
  assert.match(panelSource, /詳細を閉じる/);
  assert.match(panelSource, /is-selected/);
});

test("AI sessions remain AI work and empty days keep the calendar grid", () => {
  assert.match(panelSource, /display_kind: "ai_work" as const/);
  assert.match(
    panelSource,
    /関連活動に\s*\{displayKindLabel\(\s*typeFilter as ActivityTimelineItem/,
  );
  assert.match(panelSource, /Activity の空の時刻カレンダー/);
  assert.match(panelSource, /const datedEvents = events\.filter/);
  assert.match(panelSource, /hasSelectedDateActivity && hasActiveFilter/);
});

test("short events expose their exact time anchor independently from the content card", () => {
  assert.match(panelSource, /burstEvent\.anchor_top - row\.top/);
  assert.match(panelSource, /row\.anchor_offset/);
  assert.match(panelSource, /activity-calendar-time-anchor/);
});

test("mixed bursts keep their kind and origin aligned across card, aria label, and detail", () => {
  assert.match(panelSource, /mixed: "複数種別"/);
  assert.match(panelSource, /burstOriginLabel\(burst\.origin\)/);
  assert.match(panelSource, /displayKindLabel\(row\.display_kind\).*originText/s);
  assert.match(panelSource, /burstOriginLabel\(expandedTimelineItem\.origin\)/);
});

test("narrow detail behaves as a keyboard-contained dialog", () => {
  assert.match(panelSource, /window\.matchMedia\("\(max-width: 760px\)"\)/);
  assert.match(panelSource, /role=\{isNarrowActivity \? "dialog" : "region"\}/);
  assert.match(panelSource, /aria-modal=\{isNarrowActivity \|\| undefined\}/);
  assert.match(panelSource, /activityDetailRef\.current\?\.focus\(\)/);
  assert.match(panelSource, /\[expandedTimelineItemId, isNarrowActivity\]/);
  assert.match(panelSource, /activity-calendar-detail-backdrop/);
  assert.match(panelSource, /event\.key === "Escape"/);
});
