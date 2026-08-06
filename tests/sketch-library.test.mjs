import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (path) => readFileSync(path, "utf8");
const routes = read("src/renderer/src/pages/routes.ts");
const router = read("src/renderer/src/features/workspace/components/WorkspacePageRouter.tsx");
const app = read("src/renderer/src/features/workspace/WorkspaceApp.tsx");
const library = read("src/renderer/src/features/workspace/pages/SketchLibraryPage.tsx");
const editor = read("src/renderer/src/features/workspace/pages/SketchPage.tsx");
const notes = read("src/renderer/src/features/workspace/pages/NotesPage.tsx");
const drawer = read("src/renderer/src/features/workspace/components/drawer.tsx");
const inbox = read("src/renderer/src/features/workspace/pages/InboxPage.tsx");

test("Sketch is an independent Knowledge shelf with a dedicated editor route", () => {
  assert.match(routes, /sketch: \{ label: "Sketch" \}/);
  assert.match(routes, /knowledgeHubTabs = \[[^\]]*"sketch"/);
  assert.match(routes, /"sketch-editor":\s*"sketch"/);
  assert.match(router, /case "sketch":[\s\S]*?<SketchLibraryPage/);
  assert.match(router, /case "sketch-editor":[\s\S]*?<SketchPage/);
  assert.match(app, /route === "sketch-editor"/);
  assert.match(inbox, /navigate\("sketch-editor"\)/);
  assert.doesNotMatch(routes, /sketch:\s*"notes"/);
});

test("Sketch library owns discovery creation and opening", () => {
  assert.match(library, /usePersistentState<SketchLibraryPreferences>/);
  assert.match(library, /タイトル・Themeで検索/);
  assert.match(library, /Sketchの並び順/);
  assert.match(library, /openDrawer\(\{ type: "sketch", entity: sketch \}\)/);
  assert.match(library, /openDrawer\(\{[\s\S]*?type: "sketch",[\s\S]*?mode: "edit"/);
  assert.match(library, /entity: \{ \.\.\.draft, id: undefined \}/);
  assert.match(library, /navigate\("sketch-editor"\)/);
  assert.match(library, /navigate\("sketch-editor"\);\s*openDrawer\(\{ type: "sketch", entity: sketch \}\)/);
  assert.doesNotMatch(library, />開く<\/button>/);
});

test("Sketch metadata and deletion live in the detail-edit drawer", () => {
  assert.match(drawer, /type === "sketch"/);
  assert.doesNotMatch(drawer, /Sketchを開く/);
  assert.match(drawer, /SketchのThemeを更新しました/);
  assert.match(drawer, /saveEntity\("sketch",[\s\S]*?project_id: select\.value \|\| null/);
  assert.match(drawer, /fieldName="project_id"/);
  assert.match(drawer, /entityId && removeEntity[\s\S]*?removeEntity\(type as Parameters<RemoveEntity>\[0\], entity\)/);
  assert.doesNotMatch(editor, /Sketchを削除|deleteSketch/);
  assert.doesNotMatch(editor, /sketch-document-select|別のSketchを作る/);
  assert.match(editor, /navigate\("sketch"\)/);
});

test("Notes no longer creates or inventories Sketches", () => {
  assert.doesNotMatch(notes, /新しいSketch|notes-sketch-strip|createSketchDraft|openSketch/);
});
