import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

const panelPath = path.resolve(
  "src/renderer/src/features/workspace/components/ActivityLogPanel.tsx",
);
const stylesPath = path.resolve("src/renderer/src/styles/app.css");
const panelSource = readFileSync(panelPath, "utf8");
const stylesSource = readFileSync(stylesPath, "utf8");

test("Activity calendar reapplies its initial scroll when the panel reopens", () => {
  assert.match(panelSource, /if \(!expanded \|\| !calendar\) return;/);
  assert.match(panelSource, /const ACTIVITY_CALENDAR_START_HOUR = 8;/);
  assert.match(panelSource, /const ACTIVITY_CALENDAR_END_HOUR = 19;/);
  assert.match(panelSource, /calendar\.scrollTop = initialActivityTop;/);
  assert.match(panelSource, /\[activityCalendarScrollKey, expanded, initialActivityTop\]/);
});

test("AI session detail retains labeled remaining work", () => {
  assert.match(panelSource, /expandedSession\.outcome\?\.remaining_work\.length/);
  assert.match(panelSource, /<span>残作業<\/span>/);
});

test("calendar blocks reduce visible metadata while detail and aria retain context", () => {
  assert.match(panelSource, /activityThemeSummary\(row\.theme_ids, themes\)/);
  assert.doesNotMatch(panelSource, /activity-calendar-event-time/);
  assert.doesNotMatch(panelSource, /activity-calendar-event-meta/);
  assert.match(panelSource, /activity-calendar-event-source/);
  assert.match(panelSource, /\{sourceMarker && \(/);
  assert.match(panelSource, /event && isAiActivityEvent\(event\)/);
  assert.match(panelSource, /event\.origin\?\.kind === "mcp"/);
  assert.match(panelSource, /"AI含む"/);
  assert.match(panelSource, /--activity-theme-color/);
  assert.match(panelSource, /isRange \? " is-range-event" : " is-point-event"/);
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
  assert.match(panelSource, /ACTIVITY_CALENDAR_POINT_MARK_MINUTES = 10/);
  assert.match(panelSource, /--activity-point-anchor-height/);
  assert.match(stylesSource, /--activity-time-rail-width: 10px/);
  assert.match(stylesSource, /height: max\(var\(--activity-anchor-height\), 1px\)/);
  assert.match(
    stylesSource,
    /\.activity-calendar-time-anchor\.is-point[\s\S]*?height: var\(--activity-point-anchor-height, 4px\)/,
  );
  assert.match(
    stylesSource,
    /\.activity-calendar-time-anchor\.is-point[\s\S]*?border-radius: var\(--radius-pill\) 0 0 var\(--radius-pill\)/,
  );
  assert.doesNotMatch(stylesSource, /clip-path: polygon\(0 50%, 100% 0, 100% 100%\)/);
  assert.match(stylesSource, /\.activity-calendar-event-button \{[\s\S]*?inset: 0;/);
  assert.match(stylesSource, /inset: 0 0 0 var\(--activity-time-rail-width\)/);
});

test("burst details use the full detail width and Task links open editing directly", () => {
  assert.match(
    stylesSource,
    /\.activity-timeline-detail-section\.activity-calendar-burst-detail\s*\{[^}]*grid-template-columns: minmax\(0, 1fr\)/s,
  );
  assert.match(panelSource, /mode: burstDrawerType === "task" \? "edit" : "view"/);
  assert.match(panelSource, /type: "task",\s*mode: "edit"/s);
  assert.match(panelSource, /mode: expandedDrawerType === "task" \? "edit" : "view"/);
  assert.match(panelSource, /"タスクを編集"/);
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
