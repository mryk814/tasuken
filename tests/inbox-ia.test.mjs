import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";

const routesSource = readFileSync("src/renderer/src/pages/routes.ts", "utf8");
const inboxPageSource = readFileSync("src/renderer/src/features/workspace/pages/InboxPage.tsx", "utf8");
const workspaceAppSource = readFileSync("src/renderer/src/features/workspace/WorkspaceApp.tsx", "utf8");

test("micro memos are folded into Inbox navigation instead of a separate nav item", () => {
  assert.doesNotMatch(routesSource, /\["micro-memos", "付箋メモ"\]/);
  assert.match(workspaceAppSource, /normalizeRoute/);
  assert.match(workspaceAppSource, /micro-memos/);
  assert.equal(existsSync("src/renderer/src/features/workspace/pages/MicroMemoPage.tsx"), false);
});

test("Inbox page has separate untriaged and micro memo lanes", () => {
  assert.match(inboxPageSource, /buildMicroMemoView/);
  assert.match(inboxPageSource, /付箋メモ/);
  assert.match(inboxPageSource, /Inboxへ送る/);
});

test("the title bar launcher reuses existing memo and today data without changing the route", () => {
  const shellSource = readFileSync("src/renderer/src/features/workspace/components/shell.tsx", "utf8");
  const selectorsSource = readFileSync("src/renderer/src/features/workspace/domain-model/selectors.ts", "utf8");
  const uiStoreSource = readFileSync("src/renderer/src/stores/uiStore.ts", "utf8");
  const styles = readFileSync("src/renderer/src/styles/app.css", "utf8");

  // 常設ボタンはMemoとTodayの2つだけ。Popoverはroute変更を伴わない。
  assert.match(shellSource, /function TitleBarLauncher/);
  assert.match(shellSource, /aria-haspopup="dialog"/);
  assert.match(shellSource, /event\.key === "Escape"/);
  assert.doesNotMatch(shellSource, /titlebar-launcher[\s\S]{0,400}navigate\(/);

  // 既存データを別Entityにせず、Memoはmicro_memo、Todayは今日のTaskを引く。
  assert.match(workspaceAppSource, /buildMicroMemoView\(domain\)/);
  assert.match(workspaceAppSource, /buildTodayTaskShortlist\(domain\)/);
  assert.match(workspaceAppSource, /kind: "micro_memo"/);

  // 完了しても行が消えないよう、shortlistは完了済みを含める。
  assert.match(selectorsSource, /export function buildTodayTaskShortlist/);
  assert.match(selectorsSource, /task\.state !== "cancelled"/);

  // すべてのMemoを開く導線は、Inboxの付箋メモレーンへ着地する。
  assert.match(uiStoreSource, /inboxLane: InboxLane/);
  assert.match(workspaceAppSource, /setInboxLane\("micro"\)/);
  assert.match(inboxPageSource, /useUiStore\(\(state\) => state\.inboxLane\)/);

  // Command Paletteからも同じ操作へ到達できる。
  assert.match(workspaceAppSource, /id: "open:memos"/);
  assert.match(workspaceAppSource, /id: "open:today-window"/);

  assert.match(styles, /\.titlebar-launcher button:focus-visible \{ outline: 2px solid var\(--color-focus\)/);
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
