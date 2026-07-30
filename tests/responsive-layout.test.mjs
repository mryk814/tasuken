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
});

test("compact desktop layout protects the main work area", () => {
  assert.match(cssSource, /@media \(max-width: 1680px\)/);
  assert.match(cssSource, /\.context-pane \{ display: none; \}/);
  assert.match(cssSource, /\.drawer \{ position: fixed;/);
  assert.match(cssSource, /\.notes-workbench \{[^}]*minmax\(0, 1\.82fr\)/);
  assert.match(cssSource, /\.notes-page \{ width: min\(1600px, 100%\);/);
  assert.match(cssSource, /\.chat-refs-page \{ width: min\(1600px, 100%\);/);
});

test("viewport contract records physical and effective Windows sizes", () => {
  for (const size of ["1920 × 1200", "2560 × 1440", "1280 × 800", "1536 × 960"]) {
    assert.match(responsiveGuide, new RegExp(size));
  }
});
