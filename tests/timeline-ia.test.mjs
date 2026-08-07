import assert from "node:assert/strict";
import { Buffer } from "node:buffer";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { build } from "esbuild";

async function importBundled(relativePath) {
  const result = await build({
    entryPoints: [path.resolve(relativePath)],
    bundle: true,
    platform: "node",
    format: "esm",
    write: false,
    logLevel: "silent",
  });
  return import(`data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString("base64")}`);
}

const { timelineItemState } = await importBundled("src/renderer/src/features/workspace/lib/timeline.ts");
const timelinePageSource = readFileSync("src/renderer/src/features/workspace/pages/TimelinePage.tsx", "utf8");
const ganttSource = readFileSync("src/renderer/src/features/workspace/components/gantt.tsx", "utf8");
const stylesSource = readFileSync("src/renderer/src/styles/app.css", "utf8");

const TODAY = "2026-08-07";

test("Timeline itemの状態を日付と#309のsemanticsから一意に決める（#318）", () => {
  const at = (patch) => timelineItemState({ status: "todo", ...patch }, TODAY);

  assert.equal(at({ status: "done", planned_end: "2026-01-01" }), "completed");
  assert.equal(at({ status: "cancelled" }), "cancelled");
  // 終了日を過ぎた未完了だけを期限超過にする。
  assert.equal(at({ planned_start: "2026-07-01", planned_end: "2026-08-06" }), "overdue");
  // 完了は期限を過ぎていても完了のまま（期限超過へ落とさない）。
  assert.equal(at({ status: "done", planned_end: "2026-08-06" }), "completed");
  // 開始前は未着手。期限超過にしない。
  assert.equal(at({ planned_start: "2026-09-01", planned_end: "2026-09-30" }), "planned");
  assert.equal(at({ planned_start: "2026-08-01", planned_end: "2026-08-31" }), "active");
  // #309の日付範囲の意味を状態として区別する。
  assert.equal(at({ planned_start: "2026-08-01", planned_end: "2026-08-31", range_semantics: "ongoing" }), "ongoing");
  assert.equal(at({ planned_start: "2026-08-01", planned_end: "2026-08-31", range_semantics: "once_within_window" }), "execution_window");
  // 予定を持たない項目は未着手。
  assert.equal(at({}), "planned");
});

test("状態を色だけで伝えない（#312 / #318）", () => {
  // barはclass・記号・aria-label・tooltipへ同じ状態を配る。
  assert.match(ganttSource, /const state = timelineItemState\(barItem, today\);/);
  assert.match(ganttSource, /`is-state-\$\{state\}`/);
  assert.match(ganttSource, /data-state=\{state\}/);
  assert.match(ganttSource, /aria-label=\{`\$\{barItem\.title\}（\$\{stateLabel\}）`\}/);
  assert.match(ganttSource, /状態: \$\{stateLabel\}/);
  assert.match(ganttSource, /className="gantt-bar-state-mark"/);

  // 一覧側は語で読める。
  assert.match(timelinePageSource, /className=\{`timeline-state-chip is-state-\$\{timelineItemState\(item, today\)\}`\}/);
  assert.match(timelinePageSource, /TIMELINE_ITEM_STATE_LABELS\[timelineItemState\(item, today\)\]/);

  // 形（不透明度・線種・縞）も併用する。
  assert.match(stylesSource, /\.gantt-item-bar\.is-state-completed \{ opacity: \.62;/);
  assert.match(stylesSource, /\.gantt-item-bar\.is-state-cancelled \{[^}]*border-style: dotted;/);
  assert.match(stylesSource, /\.gantt-item-bar\.is-state-ongoing \{[\s\S]*?repeating-linear-gradient/);
  assert.match(stylesSource, /\.gantt-item-bar\.is-state-execution_window \{ border-style: dashed;/);
  // 期限超過は破壊的操作の赤ではなくwarning系にする。
  assert.match(stylesSource, /\.gantt-item-bar\.is-state-overdue \{[^}]*var\(--color-status-blocked-fg\)/);
});

test("Timelineのtoolbarを中長期の把握へ絞る（#318）", () => {
  // 期間を追加のquick-addは撤去する。
  assert.equal(/timeline-quick-add/.test(timelinePageSource), false);
  assert.equal(/期間を追加/.test(timelinePageSource), false);
  assert.equal(/addQuickPlan/.test(timelinePageSource), false);

  // 展開と折りたたみは一つのtoggleにする。
  assert.match(timelinePageSource, /setCollapsedThemes\(allThemesCollapsed \? \[\] : groupKeys\)/);
  assert.match(timelinePageSource, /\{allThemesCollapsed \? "すべて展開" : "すべて折りたたむ"\}/);

  // 週間は廃止せずmenuへ畳む。常設は中長期scaleだけ。
  assert.match(timelinePageSource, /const LONG_RANGE_ZOOM_PRESETS = ZOOM_PRESETS\.filter\(\(preset\) => preset\.id !== "week"\)/);
  assert.match(timelinePageSource, /const SHORT_RANGE_ZOOM_PRESETS = ZOOM_PRESETS\.filter\(\(preset\) => preset\.id === "week"\)/);
  assert.match(timelinePageSource, /\{label\}表示にする/);

  // 長いタイトルはellipsis + tooltipで読む。
  assert.match(timelinePageSource, /title=\{item\.title\}/);
  assert.match(stylesSource, /\.gantt-name > \.gantt-title-button \{[^}]*text-overflow: ellipsis;/);
});

test("スライド出力は画面のTimelineに合わせ、Activityを既定で混ぜない（#318）", () => {
  const dialogSource = readFileSync("src/renderer/src/features/workspace/components/SlideTimelineDialog.tsx", "utf8");

  assert.match(dialogSource, /const \[showActivity, setShowActivity\] = useState\(false\);/);
  assert.match(dialogSource, /const \[showCompleted, setShowCompleted\] = useState\(initialShowCompleted\);/);
  // Theme filterと表示期間は画面から引き継ぐ。
  assert.match(timelinePageSource, /initialThemeId=\{themeFilter\}/);
  assert.match(timelinePageSource, /initialStart=\{range\.start\}/);
  assert.match(timelinePageSource, /initialShowCompleted=\{showCompleted\}/);
});
