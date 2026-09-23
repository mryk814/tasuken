import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const themePage = readFileSync("src/renderer/src/features/workspace/pages/ThemePage.tsx", "utf8");
const artifacts = readFileSync(
  "src/renderer/src/features/workspace/components/artifacts.tsx",
  "utf8",
);
const styles = readFileSync("src/renderer/src/styles/app.css", "utf8");

/** 画面に出る順で見出しを拾う。順序そのものが#321の契約。 */
function sectionHeadings(source) {
  return [...source.matchAll(/<h2>([^<]+)<\/h2>/g)].map((match) => match[1]);
}

test("Theme詳細は四面に分かれ、面ごとに読む順で状況を出す（#321、計画フェーズ4）", () => {
  const headings = sectionHeadings(themePage);

  // 面は 概要 → タスク → 投稿 → Notes の順に並べる。
  const tabOrder = ["概要", "タスク", "投稿", "Notes"];
  const tabIndexes = tabOrder.map((label) => themePage.indexOf(`label: "${label}"`));
  assert.ok(
    tabIndexes.every((index) => index >= 0),
    `四面のタブが揃っている: ${tabOrder.join(",")}`,
  );
  assert.deepEqual(
    [...tabIndexes].sort((a, b) => a - b),
    tabIndexes,
    "概要 → タスク → 投稿 → Notes の順にする",
  );

  // 概要面の見出しが最初に来る。
  const overview = ["いま分かっていること", "現在地", "次の仕事", "近いマイルストーン"];
  for (const heading of overview) {
    assert.ok(headings.indexOf(heading) >= 0, `概要の見出しが揃っている: ${headings.join(",")}`);
  }
  assert.ok(headings.indexOf("現在地") < headings.indexOf("未完了"), "概要をタスクより先に読む");

  // タスク面は 未完了 → 完了 → セクション。Notes面は 報告書 → Note。
  const taskIndexes = ["未完了", "完了・やったこと", "タスクセクション"].map((heading) =>
    headings.indexOf(heading),
  );
  assert.deepEqual(
    [...taskIndexes].sort((a, b) => a - b),
    taskIndexes,
    "タスク面は 未完了 → 完了 → セクション の順にする",
  );
  assert.ok(
    headings.indexOf("報告書・重要文書") < headings.indexOf("最近のNote"),
    "Notes面は報告書をNoteより先に読む",
  );

  // 読み取りの薄いmetric cardを主動線へ置かない。
  assert.doesNotMatch(themePage, /<Metric label="未完了"/);
  assert.doesNotMatch(themePage, /metric-grid home-metrics/);
});

test("Taskは未完了と完了を横並びにし、完了時刻を出す（#321）", () => {
  assert.match(themePage, /className="dashboard-grid theme-task-grid"/);
  // 完了はcheckbox一回で、drawerも開ける。
  assert.match(themePage, /className="theme-task-check"/);
  assert.match(themePage, /onClick=\{\(\) => void completeTask\(task\)\}/);
  assert.match(
    themePage,
    /buildCompleteTaskOperations\(task, schedulesMap\.get\(`task:\$\{task\.id\}`\)\)/,
  );
  assert.match(
    themePage,
    /<time\s+dateTime=\{str\(task\.completed_at \|\| task\.updated_at \|\| task\.created_at\)\}/,
  );
  assert.match(themePage, /function completedLabel\(task: Task\)/);
  // 完了は見えるが未完了より主張を弱める。
  assert.match(
    styles,
    /\.theme-task-list\.is-done \.theme-task-main > strong \{\s*color: var\(--color-text-secondary\)/,
  );
});

test("最近のNoteは本文の書き出しまで見せる（#321）", () => {
  assert.match(themePage, /notes\.filter\(\(note\) => noteProjectId\(note\) === theme\.id\)/);
  assert.match(themePage, /className="theme-note-card"/);
  assert.match(themePage, /compactNotesBodyPreview\(note\.body_markdown, 160\)/);
  assert.match(themePage, /NOTES_KIND_LABELS\[notesKindFromNoteType\(str\(note\.note_type\)\)\]/);
  // クリックでNote編集へ直接移動する。
  assert.match(themePage, /openDrawer\(\{ type: "note", mode: "edit", entity: note \}\)/);
  // 長すぎる本文は行数で省略する。
  assert.match(styles, /\.theme-note-card > p \{[\s\S]*?-webkit-line-clamp: 4;/);
});

test("ArtifactはTheme配下で生まれたものを新しい順に出し、元Noteを辿れる（#321）", () => {
  assert.match(themePage, /includeThemeArtifacts/);
  assert.match(themePage, /openDrawer=\{openDrawer\}/);
  // 直接添付だけでなくTheme配下のものも含める。
  assert.match(artifacts, /includeThemeArtifacts && themeId && entry\.theme_id === themeId/);
  // 最近追加・更新したものを優先する。
  assert.match(artifacts, /String\(b\.updated_at \|\| b\.created_at \|\| ""\)\.localeCompare/);
});

test("Overviewは全件一覧にせず上位だけ出す（#321）", () => {
  assert.match(themePage, /const REPORT_PREVIEW_LIMIT = 5;/);
  assert.match(themePage, /const TASK_PREVIEW_LIMIT = 7;/);
  assert.match(themePage, /const NOTE_PREVIEW_LIMIT = 4;/);
  assert.match(themePage, /reportNotes\.length > REPORT_PREVIEW_LIMIT/);
  assert.match(themePage, /すべて表示/);
});
