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
