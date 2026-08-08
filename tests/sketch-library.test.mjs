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
  // 作成も行選択も編集canvasへ直行する。詳細drawerを経由しない（#320）。
  assert.match(library, /navigate\("sketch-editor"\)/);
  assert.doesNotMatch(library, /openDrawer\(\{ type: "sketch", entity: sketch \}\)/);
  assert.doesNotMatch(library, />開く<\/button>/);
});

test("Sketchは作って即描き始められる（#320）", () => {
  const sketchLib = readFileSync("src/renderer/src/features/workspace/lib/sketch.ts", "utf8");

  // 作成前にtitle / Themeを聞かない。既定titleを付けて保存し、canvasを開く。
  assert.match(library, /async function startSketch\(mode: SketchCanvasMode, size: SketchPageSize\)/);
  assert.match(library, /await saveEntity\("sketch", draft, \{ quiet: true \}\)/);
  assert.match(library, /onClick=\{\(\) => void startSketch\("page", SKETCH_PAGE_PRESETS\.landscape\)\}/);
  assert.match(library, /export function defaultSketchTitle/);
  assert.match(sketchLib, /export const DEFAULT_SKETCH_TITLE = "無題のSketch"/);

  // 空Sketchを増やさない契約。削除ではなく開き直しで抑える。
  assert.match(sketchLib, /export function isDisposableSketch/);
  assert.match(library, /const reusable = \(data\.sketches as Sketch\[\]\)\.find\(/);
  assert.match(library, /if \(reusable\) \{/);

  // 用紙選択とInfiniteはmenuへ回し、主操作を短くする。
  assert.match(library, /label: "用紙を選んでPageを作成"/);
  assert.match(library, /label: "Infinite Canvasを作成"/);
});

test("Sketch canvasからmetadataを触れて、AI専用UIを常設しない（#320）", () => {
  const sketchPage = readFileSync("src/renderer/src/features/workspace/pages/SketchPage.tsx", "utf8");

  // `情報`をprimaryにせず、canvasを閉じずに設定できるmenuへ置く。
  assert.doesNotMatch(sketchPage, />情報<\/button>/);
  assert.match(sketchPage, /label="この Sketch"/);
  assert.match(sketchPage, /label: "タイトル・Themeを編集"/);

  // AI向け指示UIはSketch主画面から撤去する。
  assert.doesNotMatch(sketchPage, /AI向け指示/);
});

test("Sketch metadata and deletion live in the detail-edit drawer", () => {
  assert.match(drawer, /type === "sketch"/);
  assert.doesNotMatch(drawer, /Sketchを開く/);
  assert.match(drawer, /SketchのThemeを更新しました/);
  assert.match(drawer, /saveEntity\("sketch",[\s\S]*?project_id: canonicalThemeId\(select\.value, \{ defaultPersonal: true \}\)/);
  assert.match(drawer, /fieldName="project_id"/);
  assert.match(drawer, /entityId && removeEntity[\s\S]*?removeEntity\(type as Parameters<RemoveEntity>\[0\], entity\)/);
  assert.doesNotMatch(editor, /Sketchを削除|deleteSketch/);
  assert.doesNotMatch(editor, /sketch-document-select|別のSketchを作る/);
  assert.match(editor, /navigate\("sketch"\)/);
});

test("Notes no longer creates or inventories Sketches", () => {
  assert.doesNotMatch(notes, /新しいSketch|notes-sketch-strip|createSketchDraft|openSketch/);
});
