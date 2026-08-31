import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const todayPageSource = readFileSync(
  "src/renderer/src/features/workspace/pages/TodayPage.tsx",
  "utf8",
);
const todoPageSource = readFileSync(
  "src/renderer/src/features/workspace/pages/TodoPage.tsx",
  "utf8",
);
const activityPanelSource = readFileSync(
  "src/renderer/src/features/workspace/components/ActivityLogPanel.tsx",
  "utf8",
);

test("Today page stays focused on daily tasks instead of utility controls", () => {
  assert.match(todayPageSource, /openTodayTasksWindow/);
  assert.match(todayPageSource, /showTodayMiniWindow/);
  assert.match(todayPageSource, /今日やること/);
  assert.doesNotMatch(todayPageSource, /IconFlag/);
  assert.doesNotMatch(todayPageSource, /onTogglePriority/);
  assert.doesNotMatch(todayPageSource, />\+7d</);
  assert.doesNotMatch(todayPageSource, /ReminderPanel/);
  assert.doesNotMatch(todayPageSource, /TimeboxPanel/);
  assert.doesNotMatch(todayPageSource, /時間割/);
  assert.doesNotMatch(todayPageSource, /TASK_SHELF_OPTIONS\.map/);
});

test("Today page removes low-read metric cards from the main scan path", () => {
  assert.doesNotMatch(todayPageSource, /today-metrics/);
  assert.doesNotMatch(todayPageSource, /<Metric label="今日"/);
  assert.doesNotMatch(todayPageSource, /<Metric label="期限切れ"/);
  assert.doesNotMatch(todayPageSource, /metric-card panel metric-button/);
});

test("Today page keeps inbox and unscheduled work out of row sections", () => {
  assert.doesNotMatch(todayPageSource, /<h2>Inbox未整理<\/h2>/);
  assert.doesNotMatch(todayPageSource, /<h2>予定なし<\/h2>/);
});

test("Today candidate shelf is limited to the three useful lanes", () => {
  assert.match(todayPageSource, /<h3>期限切れ<\/h3>/);
  assert.match(todayPageSource, /<h3>今週<\/h3>/);
  assert.match(todayPageSource, /<h3>いつか<\/h3>/);
  assert.doesNotMatch(todayPageSource, /<h3>\{option\.label\}<\/h3>/);
  assert.doesNotMatch(todayPageSource, /shelfTaskRows/);
  assert.doesNotMatch(todayPageSource, /handleMoveShelfTaskToday/);
});

test("Today removes duplicate risk and current-location sections from the main page", () => {
  assert.doesNotMatch(todayPageSource, /<h2>期限切れ<\/h2>/);
  assert.doesNotMatch(todayPageSource, /<h2>期限が近い待ち<\/h2>/);
  assert.doesNotMatch(todayPageSource, /<h2>最近の現在地<\/h2>/);
  assert.match(todayPageSource, /<h2>今日の候補棚<\/h2>/);
});

test("Today shows a lightweight waiting list beside nearby milestones", () => {
  assert.match(todayPageSource, /today-lower-grid/);
  assert.match(todayPageSource, /近いマイルストーン/);
  assert.match(todayPageSource, /WaitingListRows/);
  assert.match(todayPageSource, /today-waiting-row/);
  assert.match(todayPageSource, /openWaitings/);
  assert.match(todayPageSource, /overdueWaitingCount/);
});

test("Today and related lists share overdue urgency styling", () => {
  assert.match(todayPageSource, /function dateUrgency/);
  assert.match(todayPageSource, /is-\$\{urgency\}/);
  assert.match(todayPageSource, /markDueToday=\{false\}/);
  assert.match(
    todayPageSource,
    /today-focus-hero.*is-overdue|is-overdue.*today-focus-hero|className=\{`today-focus-hero panel\$\{/,
  );
});

test("Task名は詳細を開き、そこから既存の編集・AI依頼準備へ進める", () => {
  assert.match(todayPageSource, /reminderMeta/);
  assert.match(todayPageSource, /IconClock/);
  assert.match(todoPageSource, /function openTaskDetail[\s\S]*?type: "task",\s*mode: "view"/);
  assert.match(
    todayPageSource,
    /function handleOpenExecutionWindowTask[\s\S]*?type: "task",\s*mode: "view"/,
  );
  assert.match(
    todayPageSource,
    /if \(row\.v2\.type === "task"\)[\s\S]*?type: "task",\s*mode: "view"/,
  );
  assert.match(
    todayPageSource,
    /function handleOpenPeriodTask[\s\S]*?type: "task",\s*mode: "view"/,
  );
  assert.match(
    todayPageSource,
    /function handleOpenCandidateTask[\s\S]*?type: "task",\s*mode: "view"/,
  );
});

test("Todayは日付範囲の意味ごとに扱いを分ける（#309）", () => {
  // 期間内に一度やるTaskと、継続中Taskを別のセクションで見せる。
  assert.match(todayPageSource, /<h2>期間内に対応<\/h2>/);
  assert.match(todayPageSource, /<h2>継続中<\/h2>/);
  assert.match(todayPageSource, /buildExecutionWindowTaskView/);
  assert.match(todayPageSource, /buildOngoingPeriodTaskView/);

  // 期間内に一度やるTaskは、一回の完了でTask全体が終わるのでcheckboxを残す。
  assert.match(todayPageSource, /todo-check-circle/);
  assert.match(todayPageSource, /handleCompleteExecutionWindow/);

  // 継続Taskは、共通の完了操作と「今日やることへ追加」に揃える。
  assert.match(todayPageSource, /handleFinishOngoingPeriod/);
  assert.match(todayPageSource, /onPlanToday=\{handleCreateTodayTask\}/);
  assert.doesNotMatch(todayPageSource, /handleRecordOngoingWork/);
  assert.doesNotMatch(todayPageSource, /handleExtendOngoingPeriod/);
});

test("Debrief surfaces generated Activity and configures automatic daily export", () => {
  assert.doesNotMatch(todayPageSource, /id="daily-activity"/);
  assert.match(activityPanelSource, /id="daily-activity"/);
  assert.match(activityPanelSource, /collectActivityLogEntries/);
  assert.match(activityPanelSource, /毎日自動出力/);
  assert.match(activityPanelSource, /activityLogAutoExportTime/);
  assert.match(activityPanelSource, /Rootを設定すると自動で出力先を作ります。/);
  assert.match(activityPanelSource, /アプリ停止中の未出力分は、次回起動時に日ごとに補完します/);
});

test("Settings exposes shared-folder sync status, manual sync, and conflict resolution", () => {
  const settingsSource = readFileSync(
    "src/renderer/src/features/workspace/pages/SettingsPage.tsx",
    "utf8",
  );
  assert.match(settingsSource, /端末間同期/);
  assert.match(settingsSource, /configureSharedSync/);
  assert.match(settingsSource, /runSharedSync/);
  assert.match(settingsSource, /resolveSharedSyncConflict/);
  assert.match(settingsSource, /同じデータが両端末で変更されています/);
  assert.match(settingsSource, /Note内のMarkdown画像を交換します/);
  assert.match(settingsSource, /lastMarkdownImagesReceived/);
});

test("Todayのprimary actionはTask追加ひとつにする（#316）", () => {
  const header = todayPageSource.slice(
    todayPageSource.indexOf('<PageHeader route="today">'),
    todayPageSource.indexOf("</PageHeader>"),
  );

  // 画面上部で強いのは「今日のTaskを追加」だけ。
  const primaries = header.match(/<Button variant="primary"/g) || [];
  assert.equal(primaries.length, 1);
  assert.match(header, /<Button variant="primary" onClick=\{\(\) => setShowAdd\(\(v\) => !v\)\}/);
  assert.match(header, /今日のTaskを追加/);

  // コピーとDebriefは常設buttonから外し、menuへ移す。
  assert.equal(/<IconClipboard size=\{16\} \/> コピー/.test(header), false);
  assert.equal(/<IconClipboard size=\{16\} \/> Activity/.test(header), false);
  assert.match(header, /id: "copy-today",\s+label: "Todayの内容をコピー"/);
  assert.match(header, /id: "goto-activity",\s+label: "Debriefへ移動"/);

  // Task作成時にThemeを選べる（#316のTask creation contract）。
  assert.match(
    todayPageSource,
    /<InlineAddPanel[\s\S]*?theme=\{addTheme\}[\s\S]*?themes=\{themes\}/,
  );
});

test("実行中のFocusはSidebar下部から確認・再開できる（#316）", () => {
  const shell = readFileSync("src/renderer/src/features/workspace/components/shell.tsx", "utf8");
  const app = readFileSync("src/renderer/src/features/workspace/WorkspaceApp.tsx", "utf8");
  const styles = readFileSync("src/renderer/src/styles/app.css", "utf8");

  // 右下floatingをやめ、Sidebar下部の常設領域へ移す。
  assert.equal(/focus-resume-chip/.test(app), false);
  assert.equal(/focus-resume-chip/.test(styles), false);
  assert.match(shell, /function SidebarFocus\(/);
  assert.match(
    shell,
    /<SidebarFocus focus=\{activeFocus\} collapsed=\{collapsed\} onOpen=\{openActiveFocus\} \/>/,
  );
  assert.match(styles, /\.sidebar-focus \{[\s\S]*?margin-top: auto;/);

  // 色だけでactiveを示さず、labelと経過時間を出す。
  assert.match(shell, /FOCUS/);
  assert.match(shell, /function elapsedFocusLabel\(/);
  // 動きを減らす設定ではpulseを止める。
  assert.match(
    styles,
    /@media \(prefers-reduced-motion: reduce\) \{\s*\.sidebar-focus-dot \{\s*animation: none;/,
  );

  // どの画面からでも開けるshortcutとcommandがある。
  assert.match(
    app,
    /event\.altKey && !event\.ctrlKey && !event\.metaKey && event\.key\.toLowerCase\(\) === "f"/,
  );
  assert.match(app, /id: "focus:resume"/);
  assert.match(
    shell,
    /<dt>\s*<kbd>Alt<\/kbd>\+<kbd>F<\/kbd>\s*<\/dt>\s*<dd>実行中のFocus Sessionを開く<\/dd>/,
  );
});

test("Focus UIは表示だけ閉じ、sessionを終了しない（#316）", () => {
  const dialog = readFileSync(
    "src/renderer/src/features/workspace/components/FocusSessionDialog.tsx",
    "utf8",
  );

  // 外側click / Escで閉じる。closeは表示を閉じるだけ（session終了は明示操作）。
  assert.match(dialog, /className="focus-session-backdrop"\s*\n\s*role="presentation"/);
  assert.match(dialog, /if \(event\.target === event\.currentTarget\) close\(\);/);
  assert.match(dialog, /if \(event\.key !== "Escape"\) return;/);
  // 終了確認を開いているときはそちらを先に閉じる。
  assert.match(dialog, /if \(endOpen\) \{[\s\S]*?setEndOpen\(false\);/);
});

test("Daily ScratchpadはMarkdownとして書けて確認できる（#316）", () => {
  const dialog = readFileSync(
    "src/renderer/src/features/workspace/components/DailyScratchpadDialog.tsx",
    "utf8",
  );
  const markdown = readFileSync("src/renderer/src/features/workspace/lib/markdown.ts", "utf8");

  // 本文はMarkdownが正本。書いた結果を確認できる。
  assert.match(dialog, /const \[mode, setMode\] = useState<"edit" \| "preview">\("edit"\)/);
  assert.match(dialog, /className="scratchpad-preview markdown-preview"/);
  // チェックリストを文字のまま出さない。
  assert.match(markdown, /gfmTaskListItem\(\),/);
  assert.match(markdown, /gfmTaskListItemFromMarkdown\(\),/);

  // 「選択をNoteへ」は撤去し、Task化だけ残す。
  assert.equal(/選択をNoteへ/.test(dialog), false);
  assert.match(dialog, /選択をTaskへ/);
});
