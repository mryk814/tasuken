import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const mainSource = readFileSync("src/renderer/src/main.tsx", "utf8");
const appCss = readFileSync("src/renderer/src/styles/app.css", "utf8");
const notesLayoutCss = readFileSync("src/renderer/src/styles/notes-layout.css", "utf8");

test("Notes preview keeps one scroll owner and bounded document-end spacing", () => {
  const appStylesIndex = mainSource.indexOf('import "./styles/app.css";');
  const notesStylesIndex = mainSource.indexOf('import "./styles/notes-layout.css";');

  assert.ok(appStylesIndex >= 0, "the shared application stylesheet must be loaded");
  assert.ok(
    notesStylesIndex > appStylesIndex,
    "the Notes layout correction must load after app.css so it wins the cascade",
  );

  assert.match(
    appCss,
    /\.note-preview-panel\s+\.note-main-preview\s*\{[^}]*overflow:\s*auto;/s,
    "the document preview should remain the vertical scroll owner",
  );
  assert.match(
    notesLayoutCss,
    /\.note-preview-panel\s+\.note-main-preview\s*\{[^}]*padding-bottom:\s*calc\(var\(--space-4\)\s*\+\s*var\(--space-3\)\);/s,
    "the preview should keep only a bounded token-based end inset",
  );
  assert.doesNotMatch(
    notesLayoutCss,
    /padding-bottom:\s*[^;]*(?:vh|dvh|svh|lvh)/,
    "the document end inset must not scale with viewport height",
  );
});

test("Notes images preserve their aspect ratio without a viewport-height ceiling", () => {
  assert.match(
    notesLayoutCss,
    /\.note-preview-panel\s+\.note-mdx-content\s+img,\s*\.note-preview-panel\s+\.note-main-preview\s+\.md-image\s+img\s*\{[^}]*height:\s*auto;[^}]*max-height:\s*none;[^}]*object-fit:\s*contain;/s,
    "editor and preview images should share the full-height rendering contract",
  );
  assert.doesNotMatch(
    notesLayoutCss,
    /(?:height|max-height):\s*[^;]*(?:vh|dvh|svh|lvh)/,
    "Notes image height must not be capped by viewport units",
  );
});
