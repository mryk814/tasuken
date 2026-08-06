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
