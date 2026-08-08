import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const workspaceAppSource = readFileSync("src/renderer/src/features/workspace/WorkspaceApp.tsx", "utf8");
const uiStoreSource = readFileSync("src/renderer/src/stores/uiStore.ts", "utf8");
const shellSource = readFileSync("src/renderer/src/features/workspace/components/shell.tsx", "utf8");
const pageRouterSource = readFileSync("src/renderer/src/features/workspace/components/WorkspacePageRouter.tsx", "utf8");
const pageLoadersSource = readFileSync("src/renderer/src/features/workspace/workspacePageLoaders.ts", "utf8");

test("toast tone is explicit state instead of message-regex inference", () => {
  assert.match(uiStoreSource, /toastTone/);
  assert.match(uiStoreSource, /setToast\(message: string, tone\?: ToastTone\): void/);
  assert.doesNotMatch(workspaceAppSource, /function toastTone/);
  assert.doesNotMatch(workspaceAppSource, /toastTone\(toast/);
});

test("app opens Today when no route is specified", () => {
  assert.match(uiStoreSource, /location\.hash\.slice\(1\) \|\| "today"/);
});

test("workspace keeps Today immediate and loads the other pages outside the startup bundle", () => {
  assert.match(pageRouterSource, /import \{ TodayPage \} from "\.\.\/pages\/TodayPage"/);
  assert.doesNotMatch(pageRouterSource, /import \{ NotesPage \} from "\.\.\/pages\/NotesPage"/);
  assert.match(pageRouterSource, /lazyNamedPage<PageProps>/);
  assert.match(pageLoadersSource, /import\("\.\/pages\/NotesPage"\)/);
  assert.match(pageLoadersSource, /preloadWorkspacePagesWhenIdle/);
  assert.match(shellSource, /onMouseEnter=\{\(\) => preloadWorkspacePage\(id\)\}/);
});

test("sidebar navigation closes the drawer before changing pages", () => {
  assert.match(workspaceAppSource, /if \(!\(await saveDirtyDrawerForm\(\)\)\) return;\s+drawerGeneration\.current \+= 1;\s+setDrawer\(null\);\s+const normalized = normalizeRoute\(next\);/);
});

test("sidebar count badges are limited to action-driving counts", () => {
  assert.doesNotMatch(shellSource, /notesCount/);
  assert.doesNotMatch(shellSource, /knowledgeCount/);
  assert.doesNotMatch(shellSource, /chatRefCount/);
  assert.match(shellSource, /overdueTasks/);
  assert.doesNotMatch(shellSource, /dueWaitings/);
  assert.doesNotMatch(shellSource, /knowledgeHealthIssueCount/);
  assert.doesNotMatch(shellSource, /knowledge:\s*knowledgeHealthIssueCount/);
  assert.match(shellSource, /"ai-io": proposalCount/);
});

test("shortcut dialog lists capture window and tray-oriented entries", () => {
  assert.match(shellSource, /Ctrl<\/kbd>\+<kbd>Shift<\/kbd>\+<kbd>N/);
  assert.match(shellSource, /Ctrl<\/kbd>\+<kbd>Shift<\/kbd>\+<kbd>\./);
  assert.match(shellSource, /トレイ/);
});
