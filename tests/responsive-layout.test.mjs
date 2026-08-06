import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const workspaceSource = readFileSync("src/renderer/src/features/workspace/WorkspaceApp.tsx", "utf8");
const shellSource = readFileSync("src/renderer/src/features/workspace/components/shell.tsx", "utf8");
const cssSource = readFileSync("src/renderer/src/styles/app.css", "utf8");
const mainSource = readFileSync("src/main/index.ts", "utf8");
const preloadSource = readFileSync("src/preload/index.ts", "utf8");
const ipcSource = readFileSync("src/main/ipc/registerIpc.ts", "utf8");
const responsiveGuide = readFileSync("docs/responsive-layout.md", "utf8");

test("sidebar collapse is accessible and persisted as device UI state", () => {
  assert.match(workspaceSource, /usePersistentState\("shell:sidebar-collapsed:v1", false\)/);
  assert.match(workspaceSource, /is-sidebar-collapsed/);
  assert.match(shellSource, /className="titlebar-sidebar-toggle"/);
  assert.match(shellSource, /aria-label=\{collapsed \? "サイドバーを広げる" : "サイドバーを畳む"\}/);
  assert.doesNotMatch(shellSource, /className="brand"/);
  assert.match(shellSource, /className="theme-dot theme-dot-all"/);
  assert.match(shellSource, /title=\{collapsed \? theme\.name : undefined\}/);
  assert.match(cssSource, /\.sidebar \{[^}]*overflow-x: hidden; overflow-y: auto;/);
  assert.match(cssSource, /\.app-shell\.is-sidebar-collapsed \.sidebar \{ padding-inline: var\(--space-3\); \}/);
  assert.match(cssSource, /\.app-shell\.is-sidebar-collapsed \.sidebar > \* \{ width: 100%; min-width: 0; \}/);
  assert.match(cssSource, /\.app-shell\.is-sidebar-collapsed \.sidebar \.nav-heading \{[^}]*overflow: hidden; visibility: hidden; white-space: nowrap; \}/);
  assert.match(cssSource, /\.app-shell\.is-sidebar-collapsed \.theme-nav > button \{ justify-content: center;/);
  assert.doesNotMatch(cssSource, /\.app-shell\.is-sidebar-collapsed \.utility-nav \{ margin-top: auto;/);
});

test("custom titlebar keeps native window controls and lightweight display help menus", () => {
  assert.match(mainSource, /titleBarStyle: "hidden"/);
  assert.match(mainSource, /titleBarOverlay: \{/);
  assert.match(cssSource, /\.app-frame \{[^}]*grid-template-rows: 40px minmax\(0, 1fr\)/);
  assert.match(cssSource, /\.app-titlebar \{[^}]*-webkit-app-region: drag;/);
  assert.match(cssSource, /\.titlebar-sidebar-toggle \{[^}]*-webkit-app-region: no-drag;/);
  assert.match(shellSource, /表示 <IconChevronDown/);
  assert.match(shellSource, /ヘルプ <IconChevronDown/);
  assert.match(shellSource, /ショートカット/);
  assert.match(shellSource, /設定を開く/);
  assert.match(workspaceSource, /usePersistentState\("shell:zoom-factor:v1", 1\)/);
  assert.match(workspaceSource, /"--app-content-zoom": zoomFactor/);
  assert.match(cssSource, /\.app-content-viewport > \.app-shell,[\s\S]*transform: scale\(var\(--app-content-zoom\)\);[\s\S]*transform-origin: top left;/);
  assert.doesNotMatch(cssSource, /zoom: var\(--app-content-zoom\)/);
  assert.doesNotMatch(preloadSource, /webFrame\.setZoomFactor/);
  assert.match(ipcSource, /window\.setTitleBarOverlay\(/);
});

test("compact desktop layout protects the main work area", () => {
  assert.match(cssSource, /@media \(max-width: 1680px\)/);
  assert.match(cssSource, /\.context-pane \{ display: none; \}/);
  assert.match(cssSource, /\.drawer \{ position: absolute;/);
  assert.match(cssSource, /\.notes-workbench \{[^}]*minmax\(0, 1fr\)/);
  assert.match(cssSource, /\.notes-page \{ width: min\(1600px, 100%\);/);
  assert.match(cssSource, /\.chat-refs-page \{ width: min\(1600px, 100%\);/);
  assert.match(cssSource, /\.sketch-library-page,[\s\S]*\.artifacts-page \{ width: min\(1600px, 100%\); \}/);
  assert.match(workspaceSource, /window\.matchMedia\("\(max-width: 1680px\)"\)/);
  assert.match(workspaceSource, /document\.addEventListener\("pointerdown", onPointerDown, true\)/);
  assert.match(workspaceSource, /document\.addEventListener\("focusin", onFocusIn, true\)/);
  assert.match(workspaceSource, /if \(!\(await saveDirtyDrawerForm\(\)\) \|\| generation !== drawerGeneration\.current\) return;/);
});

test("titlebar content owns one bounded height contract without nested viewport overflow", () => {
  assert.match(cssSource, /\.app-shell \{ position: relative; height: 100%; min-height: 0;/);
  assert.match(cssSource, /\.notes-page \{[^}]*height: 100%; min-height: 0;/);
  assert.match(cssSource, /\.drawer \{[^}]*height: 100%; min-height: 0;/);
  assert.match(cssSource, /\.context-pane \{[^}]*height: 100%; min-height: 0;/);
  assert.doesNotMatch(cssSource, /\.notes-page \{[^}]*height: 100vh;/);
  assert.doesNotMatch(cssSource, /\.drawer \{[^}]*height: 100vh;/);
  assert.doesNotMatch(cssSource, /\.context-pane \{[^}]*height: 100vh;/);
});

test("Sketch keeps the page rail separate from canvas tools and inside the titlebar viewport", () => {
  assert.match(cssSource, /\.app-shell\.is-canvas-route \.main-area \{[^}]*height: 100%;[^}]*overflow: hidden;/);
  assert.match(cssSource, /\.sketch-page \{[^}]*grid-template-columns: var\(--sketch-page-rail-width\) minmax\(0, 1fr\);/);
  assert.match(cssSource, /\.sketch-toolbar \{[^}]*grid-column: 2;[^}]*grid-row: 2;[^}]*overflow: visible;/);
  assert.match(cssSource, /\.sketch-page-rail \{[^}]*grid-column: 1;[^}]*grid-row: 2 \/ 4;/);
  assert.match(cssSource, /\.sketch-canvas-area \{[^}]*grid-column: 2;[^}]*grid-row: 3;/);
  assert.match(cssSource, /\.sketch-shape-popover \{[^}]*right: 0;[^}]*grid-template-columns: repeat\(5, 76px\);/);
});

test("Notes controls wrap as groups without stretching their labels", () => {
  assert.match(cssSource, /\.notes-page \.header-actions \{[^}]*flex-wrap: wrap;/);
  assert.match(cssSource, /\.notes-page \.header-actions > button \{[^}]*flex: 0 0 auto;[^}]*white-space: nowrap;/);
  assert.match(cssSource, /\.notes-page > \.filter-bar \{[^}]*flex-wrap: wrap;[^}]*justify-content: flex-start;/);
  assert.match(cssSource, /\.notes-page > \.filter-bar \.segmented button \{[^}]*flex: 0 0 auto;[^}]*white-space: nowrap;/);
});

test("viewport contract records physical and effective Windows sizes", () => {
  for (const size of ["1920 × 1200", "2560 × 1440", "1280 × 800", "1536 × 960"]) {
    assert.match(responsiveGuide, new RegExp(size));
  }
});

test("狭幅でも日本語ラベルを一文字ずつ縦積みにしない共通契約がある（#300）", () => {
  // flex/gridの子は内容幅より小さく潰れるため、CJKの行内改行だけを止める。
  assert.match(
    cssSource,
    /\.primary-button, \.secondary-button, \.danger-button, \.text-button,\s*\n\.segmented button, \.toggle, \.tab, \.chip, \.badge,[\s\S]*?word-break: keep-all;\s*\n\s*overflow-wrap: normal;/,
  );
  // ツールバーは詰め込まず行送りする。
  assert.match(cssSource, /\.toolbar-row \{ display: flex; flex-wrap: wrap;/);
  assert.match(cssSource, /\.toolbar-row > \* \{ flex: 0 0 auto; \}/);
  // 見出しと操作が同じ行に収まらない場合も潰さず折り返す。
  assert.match(cssSource, /\.section-heading \{[^}]*flex-wrap: wrap;/);
  assert.match(cssSource, /\.inline-actions, \.form-actions \{ display: flex; flex-wrap: wrap;/);
  // 列幅が狭い空状態のボタンも潰れない。
  assert.match(cssSource, /\.empty-state > \.secondary-button \{[^}]*white-space: nowrap;/);
});

test("低頻度操作は常設のoverflow menuへ畳み、幅で位置を入れ替えない（#300）", () => {
  const commonSource = readFileSync("src/renderer/src/features/workspace/components/common.tsx", "utf8");
  const timelineSource = readFileSync("src/renderer/src/features/workspace/pages/TimelinePage.tsx", "utf8");

  // 共通コンポーネントとして1箇所に持つ。
  assert.match(commonSource, /export function ToolbarOverflow\(\{ label, ariaLabel, children \}/);
  assert.match(commonSource, /aria-haspopup="menu"/);
  assert.match(commonSource, /aria-expanded=\{open\}/);
  assert.match(commonSource, /role="menu"\s*\n\s*aria-label=\{ariaLabel\}/);
  // Escと外側クリックで閉じる。
  assert.match(commonSource, /if \(event\.key === "Escape"\) setOpen\(false\);/);
  assert.match(commonSource, /\?\.closest\("\.toolbar-overflow"\)\) setOpen\(false\)/);
  // 一度きりの操作だけ閉じ、表示切替は開いたままにする。
  assert.match(commonSource, /closest\("\[role=\\"menuitem\\"\]"\)\) setOpen\(false\)/);

  // Timelineは表示切替と一括開閉をメニューへ移し、主要な絞り込み・倍率は出したままにする。
  assert.match(timelineSource, /<section className="timeline-toolbar toolbar-row panel">/);
  assert.match(timelineSource, /<ToolbarOverflow label="表示" ariaLabel="タイムラインの表示切替">/);
  for (const label of ["完了タスク", "依存線", "イナズマ線", "すべて展開", "すべて折りたたむ"]) {
    assert.match(timelineSource, new RegExp(label));
  }
  assert.match(timelineSource, /<div className="segmented" aria-label="表示範囲">/);
  assert.match(timelineSource, /<div className="segmented" aria-label="表示倍率">/);
  assert.match(cssSource, /\.toolbar-overflow-menu \{/);
});

test("最小ウィンドウ幅を実装と文書の両方で固定する（#300）", () => {
  assert.match(mainSource, /minWidth: 980,/);
  assert.match(responsiveGuide, /最小ウィンドウ幅/);
  assert.match(responsiveGuide, /980/);
});

test("作業領域の内側にも不要な横スクロールを作らない（#300）", () => {
  // grid/flexの子は min-content 未満に縮まないため、min-width: 0 がないと
  // 中の固定幅要素が画面全体の横スクロールを引き起こす。
  assert.match(cssSource, /\.page \{[^}]*min-width: 0;/);
  assert.match(cssSource, /\.header-actions \{ display: flex; flex-wrap: wrap;/);

  // 段組みの切り替えはウィンドウ幅ではなく実際のpanel幅を基準にする。
  assert.match(cssSource, /\.page \{ container: page \/ inline-size;/);
  assert.match(cssSource, /@container page \(max-width: 760px\) \{[\s\S]*?\.sketch-library-row \{ grid-template-columns: 1fr; \}/);
  assert.match(cssSource, /@container page \(max-width: 720px\) \{[\s\S]*?\.settings-form label \{ grid-template-columns: minmax\(0, 1fr\);/);

  // 監査スクリプトは画面全体だけでなく内側のはみ出しも検出する。
  const auditSource = readFileSync("scripts/responsive-audit.mjs", "utf8");
  assert.match(auditSource, /INTENTIONAL_SCROLL/);
  assert.match(auditSource, /horizontalScroll: doc\.scrollWidth > doc\.clientWidth \+ 1 \|\| overflowing\.length > 0/);
});
