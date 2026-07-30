import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const workspaceSource = readFileSync("src/renderer/src/features/workspace/WorkspaceApp.tsx", "utf8");
const shellSource = readFileSync("src/renderer/src/features/workspace/components/shell.tsx", "utf8");
const cssSource = readFileSync("src/renderer/src/styles/app.css", "utf8");
const responsiveGuide = readFileSync("docs/responsive-layout.md", "utf8");

test("sidebar collapse is accessible and persisted as device UI state", () => {
  assert.match(workspaceSource, /usePersistentState\("shell:sidebar-collapsed:v1", false\)/);
  assert.match(workspaceSource, /is-sidebar-collapsed/);
  assert.match(shellSource, /aria-label=\{collapsed \? "サイドバーを広げる" : "サイドバーを畳む"\}/);
  assert.ok(
    shellSource.indexOf('className="sidebar-toggle"') < shellSource.indexOf('className="brand-mark"'),
    "sidebar toggle should stay before the brand content in both states",
  );
  assert.match(shellSource, /className="theme-dot theme-dot-all"/);
  assert.match(shellSource, /title=\{collapsed \? theme\.name : undefined\}/);
  assert.match(cssSource, /\.sidebar \{[^}]*overflow-x: hidden; overflow-y: auto;/);
  assert.match(cssSource, /\.app-shell\.is-sidebar-collapsed \.sidebar \{ padding-inline: var\(--space-3\); \}/);
  assert.match(cssSource, /\.app-shell\.is-sidebar-collapsed \.brand \{ justify-content: flex-start; \}/);
  assert.doesNotMatch(cssSource, /\.sidebar-toggle \{[^}]*margin-left:/);
  assert.match(cssSource, /\.app-shell\.is-sidebar-collapsed \.sidebar > \* \{ width: 100%; min-width: 0; \}/);
  assert.match(cssSource, /\.app-shell\.is-sidebar-collapsed \.sidebar \.nav-heading \{[^}]*overflow: hidden; visibility: hidden; white-space: nowrap; \}/);
  assert.match(cssSource, /\.app-shell\.is-sidebar-collapsed \.theme-nav > button \{ justify-content: center;/);
  assert.doesNotMatch(cssSource, /\.app-shell\.is-sidebar-collapsed \.utility-nav \{ margin-top: auto;/);
});

test("compact desktop layout protects the main work area", () => {
  assert.match(cssSource, /@media \(max-width: 1680px\)/);
  assert.match(cssSource, /\.context-pane \{ display: none; \}/);
  assert.match(cssSource, /\.drawer \{ position: fixed;/);
  assert.match(cssSource, /\.notes-workbench \{[^}]*minmax\(0, 1\.82fr\)/);
  assert.match(cssSource, /\.notes-page \{ width: min\(1600px, 100%\);/);
  assert.match(cssSource, /\.chat-refs-page \{ width: min\(1600px, 100%\);/);
  assert.match(workspaceSource, /window\.matchMedia\("\(max-width: 1680px\)"\)/);
  assert.match(workspaceSource, /document\.addEventListener\("pointerdown", onPointerDown, true\)/);
  assert.match(workspaceSource, /document\.addEventListener\("focusin", onFocusIn, true\)/);
  assert.match(workspaceSource, /if \(!\(await saveDirtyDrawerForm\(\)\) \|\| generation !== drawerGeneration\.current\) return;/);
});

test("viewport contract records physical and effective Windows sizes", () => {
  for (const size of ["1920 × 1200", "2560 × 1440", "1280 × 800", "1536 × 960"]) {
    assert.match(responsiveGuide, new RegExp(size));
  }
});
