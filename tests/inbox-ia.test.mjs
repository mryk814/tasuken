import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
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

const routesSource = readFileSync("src/renderer/src/pages/routes.ts", "utf8");
const inboxPageSource = readFileSync("src/renderer/src/features/workspace/pages/InboxPage.tsx", "utf8");
const workspaceAppSource = readFileSync("src/renderer/src/features/workspace/WorkspaceApp.tsx", "utf8");

test("micro memos are folded into Inbox navigation instead of a separate nav item", () => {
  assert.doesNotMatch(routesSource, /\["micro-memos", "付箋メモ"\]/);
  assert.match(workspaceAppSource, /normalizeRoute/);
  assert.match(routesSource, /id: "micro-memos", parent: "inbox"/);
  assert.equal(existsSync("src/renderer/src/features/workspace/pages/MicroMemoPage.tsx"), false);
});

test("Inbox page has separate untriaged and micro memo lanes", () => {
  assert.match(inboxPageSource, /buildMicroMemoView/);
  assert.match(inboxPageSource, /付箋メモ/);
  assert.match(inboxPageSource, /Inboxへ送る/);
});

test("the title bar launcher directly controls satellite windows without a popover", () => {
  const shellSource = readFileSync("src/renderer/src/features/workspace/components/shell.tsx", "utf8");
  const styles = readFileSync("src/renderer/src/styles/app.css", "utf8");

  assert.match(shellSource, /function TitleBarLauncher/);
  assert.match(shellSource, /const todayLabel = launcher\.todayWindowOpen \? "今日やることを収納" : "今日やることを表示"/);
  assert.match(shellSource, /aria-label=\{todayLabel\}/);
  assert.match(shellSource, /aria-label="付箋を展開または収納"/);
  assert.match(shellSource, /aria-pressed=\{launcher\.todayWindowOpen\}/);
  assert.match(shellSource, /aria-pressed=\{launcher\.stickyWindowsShown\}/);
  assert.doesNotMatch(shellSource, /titlebar-popover/);
  assert.doesNotMatch(shellSource, /aria-haspopup="dialog"/);
  assert.doesNotMatch(shellSource, /titlebar-launcher[\s\S]{0,500}navigate\(/);

  // Command PaletteからもTop Barと同じwindow操作へ到達する。
  assert.match(workspaceAppSource, /id: "open:memos"/);
  assert.match(workspaceAppSource, /execute: \(\) => \{ void toggleStickyWindows\(\); \}/);
  assert.match(workspaceAppSource, /id: "open:today-window"/);
  assert.match(workspaceAppSource, /execute: toggleTodayWindow/);

  assert.match(styles, /\.titlebar-launcher button:focus-visible \{ outline: 2px solid var\(--color-focus\)/);
  assert.match(styles, /\.titlebar-launcher button\.is-active[\s\S]*box-shadow/);
});

test("Inboxを未整理Task候補へ絞る（#317）", () => {
  const header = inboxPageSource.slice(
    inboxPageSource.indexOf("<PageHeader route=\"inbox\">"),
    inboxPageSource.indexOf("</PageHeader>"),
  );

  // 使われていない入口は常設から外し、menuへ退避する（機能自体は残す）。
  assert.equal(/手書きで記録<\/button>/.test(header), false);
  assert.equal(/ファイルを記録<\/button>/.test(header), false);
  assert.equal(/チャットリンクを追加<\/button>/.test(header), false);
  assert.match(header, /label: "手書きで記録"/);
  assert.match(header, /label: "ファイルを記録"/);
  assert.match(header, /label: "チャットリンクを追加"/);

  // primaryはMemoひとつ。
  const primaries = header.match(/<Button variant="primary"/g) || [];
  assert.equal(primaries.length, 1);
  assert.match(header, /<IconPlus size=\{16\} \/>Memo<\/Button>/);

  // Quick Captureと同じcapture_entryへ保存し、保存先を分裂させない。
  assert.match(inboxPageSource, /function addMemo\(\) \{[\s\S]*?type: "capture_entry"/);
  assert.match(inboxPageSource, /kind: "micro_memo", content_type: "text", state: "untriaged"/);
});

test("Inbox itemの既定の行き先はTaskで、他種別はmenuへ畳む（#317）", () => {
  // 7種を同格のbuttonで常設しない。
  assert.equal(/INBOX_KIND_OPTIONS\.map\(\(\[value, label\]\) => \(\s*\n\s*<button/.test(inboxPageSource), false);
  assert.match(inboxPageSource, /className=\{draft\.output === "task" \? "is-selected" : ""\}/);
  assert.match(inboxPageSource, /items=\{INBOX_KIND_OPTIONS\.map\(\(\[value, label\]\) => \(\{/);
  // 内部コードを画面へ出さない。
  assert.match(inboxPageSource, /const INBOX_KIND_LABELS: Record<InboxKind, string>/);

  // 既存のfile / handwriting / chat-link Captureも一覧・整理できる（schemaは削除しない）。
  assert.match(inboxPageSource, /fileCaptureContentType/);
  assert.match(inboxPageSource, /captureArtifacts\(row\.entry\.id\)/);
});

test("ToDoは表から追加を撤去し、作成しただけで今日へ入れない（#317）", async () => {
  const todoPageSource = readFileSync("src/renderer/src/features/workspace/pages/TodoPage.tsx", "utf8");
  const ioSource = readFileSync("src/renderer/src/features/workspace/lib/io.ts", "utf8");

  assert.equal(/表から追加/.test(todoPageSource), false);
  assert.equal(/parseTaskTable/.test(todoPageSource), false);
  // 導線と一緒に使われなくなったparserも残さない。
  assert.equal(/parseTaskTable/.test(ioSource), false);

  // 「今日」へ入るのは明示のschedule日だけ。作成しただけでは入らない。
  const { isTodayRow } = await import("../src/renderer/src/features/workspace/lib/todoRows.js");
  const today = "2026-08-07";
  assert.equal(isTodayRow({ task: { id: "t1" } }, today), false);
  assert.equal(isTodayRow({ task: { id: "t2" }, schedule: { start_date: null, end_date: null } }, today), false);
  assert.equal(isTodayRow({ task: { id: "t3" }, schedule: { end_date: "2026-08-08" } }, today), false);
  assert.equal(isTodayRow({ task: { id: "t4" }, schedule: { end_date: today } }, today), true);
  assert.equal(isTodayRow({ task: { id: "t5" }, schedule: { start_date: today } }, today), true);
});

test("収録物はInboxの分類対象にせず、Studioの棚に並べる（#383）", async () => {
  const selectors = await importBundled("src/renderer/src/features/workspace/domain-model/selectors.ts");
  const domain = {
    capture_entries: [
      { id: "c1", state: "untriaged", kind: "inbox", content_type: "text", captured_at: "2026-08-10T00:00:00.000Z" },
      { id: "c2", state: "untriaged", kind: "voice_memo", content_type: "audio", captured_at: "2026-08-10T00:00:01.000Z" },
      { id: "c3", state: "untriaged", kind: "screen_capture", content_type: "video", captured_at: "2026-08-10T00:00:02.000Z" },
      { id: "c4", state: "archived", kind: "screen_capture", content_type: "video", captured_at: "2026-08-10T00:00:03.000Z" },
    ],
  };
  // Inboxは「あとで分類する受け取り」だけを持つ。録れたものは出さない。
  assert.deepEqual(selectors.buildInboxView(domain).entries.map((entry) => entry.id), ["c1"]);
  // Studioは録れたものを並べる。アーカイブ済みは棚から外す。
  assert.deepEqual(selectors.buildRecordingView(domain).entries.map((entry) => entry.id).sort(), ["c2", "c3"]);
});
