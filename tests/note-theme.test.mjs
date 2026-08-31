import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { noteProjectId } from "../src/shared/themeRef.mjs";

test("Note Theme ownership prefers canonical project_id and reads legacy theme_id", () => {
  assert.equal(noteProjectId({ project_id: "theme-new", theme_id: "theme-old" }), "theme-new");
  assert.equal(noteProjectId({ theme_id: "theme-legacy" }), "theme-legacy");
  assert.equal(noteProjectId({ project_id: "  ", theme_id: "theme-old" }), null);
  assert.equal(noteProjectId({ project_id: null, theme_id: "theme-old" }), null);
  assert.equal(noteProjectId(null), null);
});

test("Note consumers use the canonical Theme resolver", () => {
  const files = [
    "src/main/core/services/knowledgeQueryService.ts",
    "src/main/services/snapshotService.mjs",
    "src/renderer/src/features/workspace/WorkspaceApp.tsx",
    "src/renderer/src/features/workspace/components/drawer.tsx",
    "src/renderer/src/features/workspace/lib/io.ts",
    "src/renderer/src/features/workspace/lib/noteExportArtifacts.ts",
    "src/renderer/src/features/workspace/pages/ThemePage.tsx",
  ];
  for (const file of files) {
    assert.match(readFileSync(file, "utf8"), /noteProjectId/);
  }
});

test("Theme group filtering keeps unscoped Notes in the canonical renderer projection", () => {
  const workspaceApp = readFileSync("src/renderer/src/features/workspace/WorkspaceApp.tsx", "utf8");
  assert.match(
    workspaceApp,
    /notes: fullData\.notes\.filter\(\(note\) => !noteProjectId\(note\) \|\| match\(noteProjectId\(note\)\)\),/,
  );
  assert.match(
    workspaceApp,
    /notes: fullDomain\.notes\.filter\(\(note\) => !noteProjectId\(note\) \|\| match\(noteProjectId\(note\)\)\),/,
  );
});
