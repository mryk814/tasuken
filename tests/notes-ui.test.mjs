import assert from "node:assert/strict";
import { Buffer } from "node:buffer";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { build } from "esbuild";

async function importBundled(relativePath) {
  const result = await build({
    entryPoints: [path.resolve(relativePath)],
    bundle: true,
    platform: "node",
    format: "esm",
    write: false,
    logLevel: "silent",
  });
  return import(`data:text/javascript;base64,${Buffer.from(result.outputFiles[0].contents).toString("base64")}`);
}

const notes = await importBundled("src/renderer/src/features/workspace/lib/notes.ts");

test("Notes defaults to Note and keeps deterministic date ordering", () => {
  assert.equal(notes.DEFAULT_NOTES_PREFS.scope, "note");
  assert.equal(notes.compactNotesBodyPreview("a\n\nb", 10), "a b");
  assert.equal(notes.compactNotesBodyPreview("123456789012345", 10), "1234567890…");
  const records = [
    { id: "same-b", created_at: "2026-07-01", updated_at: "2026-07-10" },
    { id: "same-a", created_at: "2026-07-01", updated_at: "2026-07-10" },
    { id: "old", created_at: "2026-07-02", updated_at: "2026-07-09" },
  ];
  assert.deepEqual(notes.sortNotesRecords(records, "updated_desc").map((record) => record.id), ["same-b", "same-a", "old"]);
  assert.deepEqual(notes.sortNotesRecords(records, "created_asc").map((record) => record.id), ["same-a", "same-b", "old"]);
});

test("Notes UI persists filter and sort preferences and exposes save-folder actions", () => {
  const source = readFileSync("src/renderer/src/features/workspace/pages/NotesPage.tsx", "utf8");
  assert.match(source, /usePersistentState<NotesPreferences>\("notes:prefs:v1", DEFAULT_NOTES_PREFS\)/);
  assert.match(source, /compareNotesRecords\(a, b, sortOrder\)/);
  assert.match(source, /aria-label="Notesの並び順"/);
  assert.match(source, /openMarkdownExportDirectory/);
  assert.match(source, /exportSelectedMarkdown\(false\)/);
  assert.match(source, /保存先フォルダを開く/);
  assert.match(source, /event\.key\.toLowerCase\(\) === "f"/);
  assert.doesNotMatch(source, /setSearchOpen\(\(current\) => !current\).*検索/s);
  assert.doesNotMatch(source, /整形を戻す|formatUndoBody/);
});

test("Notes theme filter, resizable list pane, and collapse are wired", () => {
  const source = readFileSync("src/renderer/src/features/workspace/pages/NotesPage.tsx", "utf8");
  assert.match(source, /aria-label="Themeで絞り込み"/);
  assert.match(source, /value="none">Themeなし/);
  assert.match(source, /themeId === "none"/);
  assert.match(source, /notes-resize-handle/);
  assert.match(source, /is-list-collapsed/);
  assert.match(source, /onPointerDown=\{handleResize\}/);
  assert.match(source, /toggleListCollapsed/);
  assert.match(source, /aria-orientation="vertical"/);

  assert.equal(notes.DEFAULT_NOTES_PREFS.themeId, "all");
  assert.equal(notes.DEFAULT_NOTES_PREFS.listWidth, null);
  assert.equal(notes.DEFAULT_NOTES_PREFS.listCollapsed, false);

  const styles = readFileSync("src/renderer/src/styles/app.css", "utf8");
  assert.match(styles, /\.notes-resize-handle/);
  assert.match(styles, /\.notes-workbench\.is-list-collapsed/);
});

test("Notes opens directly in Edit while filling a large list in idle batches", () => {
  const source = readFileSync("src/renderer/src/features/workspace/pages/NotesPage.tsx", "utf8");
  assert.match(source, /useState<PreviewMode>\("edit"\)/);
  assert.match(source, /NOTES_RENDER_BATCH_SIZE/);
  assert.match(source, /requestIdleCallback/);
  assert.match(source, /renderedRecords\.map/);
  assert.match(source, /compactNotesBodyPreview/);
  assert.match(source, /if \(!normalizedQuery\) return true/);
  assert.match(source, /lazy\(loadMarkdownRichEditor\)/);
  assert.doesNotMatch(source, /import \{[^}]*MarkdownRichEditor[^}]*\} from "\.\.\/components\/MarkdownRichEditor"/s);
});

test("micro memo date is a labeled top-level time element", () => {
  const source = readFileSync("src/renderer/src/features/workspace/pages/InboxPage.tsx", "utf8");
  const styles = readFileSync("src/renderer/src/styles/app.css", "utf8");
  assert.match(source, /className="micro-memo-card-meta"/);
  assert.match(source, /<time dateTime=\{memo\.captured_at\}/);
  assert.match(source, />記録 \{formatDate\(memo\.captured_at\)\}</);
  assert.match(styles, /\.micro-memo-card-meta[^\n]*justify-content: flex-start/);
});

test("page headers move purpose copy into an info popover instead of a permanent subtitle", () => {
  const common = readFileSync("src/renderer/src/features/workspace/components/common.tsx", "utf8");
  const styles = readFileSync("src/renderer/src/styles/app.css", "utf8");

  // click / keyboardで開き、Escと外側クリックで閉じる。screen readerからも到達できる。
  assert.match(common, /export function PageInfo/);
  assert.match(common, /aria-label="この画面について"/);
  assert.match(common, /aria-expanded=\{open\}/);
  assert.match(common, /aria-controls=\{id\}/);
  assert.match(common, /event\.key === "Escape"/);
  assert.match(common, /closest\("\.page-info"\)/);
  assert.match(styles, /\.page-info-button:focus-visible \{ outline: 2px solid var\(--color-focus\)/);

  const boilerplate = [
    "ArtifactsPage", "ChatRefsPage", "ImportExportPage", "InboxPage", "KnowledgePage",
    "NotesPage", "ThemesPage", "TimelinePage", "TodayPage", "TodoPage", "WaitingPage",
  ];
  for (const page of boilerplate) {
    const source = readFileSync(`src/renderer/src/features/workspace/pages/${page}.tsx`, "utf8");
    const header = source.slice(source.indexOf("<PageHeader"));
    assert.doesNotMatch(header.slice(0, 400), /subtitle=/, `${page} は用途説明を常時表示しない`);
  }
  // Theme詳細の説明は利用者が書いたデータなので常時表示のまま残す。
  assert.match(readFileSync("src/renderer/src/features/workspace/pages/ThemePage.tsx", "utf8"), /subtitle=\{theme\.description\}/);
});

test("navigation, page headings and command palette share one canonical label", () => {
  const routes = readFileSync("src/renderer/src/pages/routes.ts", "utf8");
  const shell = readFileSync("src/renderer/src/features/workspace/components/shell.tsx", "utf8");
  const common = readFileSync("src/renderer/src/features/workspace/components/common.tsx", "utf8");
  const app = readFileSync("src/renderer/src/features/workspace/WorkspaceApp.tsx", "utf8");

  // 名称の正本は ROUTE_META だけ。Sidebarもページ見出しもここを引く。
  assert.match(routes, /export const ROUTE_META/);
  assert.match(routes, /"chat-refs": \{ label: "Chat Refs"/);
  assert.match(routes, /inbox: \{ label: "Inbox"/);
  assert.match(routes, /"ai-io": \{ label: "AI IO"/);
  assert.match(shell, /const label = routeLabel\(id\);/);
  assert.match(common, /routeLabel\(route\)/);
  assert.match(common, /ROUTE_ICONS\[route\]/);
  assert.match(app, /routeLabel\("inbox"\)/);

  // 説明語をページ名へ混ぜない。
  for (const forbidden of ["Inbox整理", "チャット参照", "AI連携"]) {
    for (const file of ["pages/InboxPage.tsx", "pages/ChatRefsPage.tsx", "pages/ImportExportPage.tsx"]) {
      const source = readFileSync(`src/renderer/src/features/workspace/${file}`, "utf8");
      const header = source.slice(source.indexOf("<PageHeader"), source.indexOf("<PageHeader") + 300);
      assert.doesNotMatch(header, new RegExp(forbidden), `${file} の見出しに ${forbidden} を書かない`);
    }
  }

  // 表示名を変えてもrouteとdeep linkは触らない。
  assert.match(routes, /"todo-done": "todo"/);
  assert.match(routes, /"chat-refs": "knowledge"/);
});

test("Notesは本文集中表示で一覧と補助行を畳み、縦領域を本文へ回す（#292）", () => {
  const page = readFileSync("src/renderer/src/features/workspace/pages/NotesPage.tsx", "utf8");
  const styles = readFileSync("src/renderer/src/styles/app.css", "utf8");

  assert.equal(notes.DEFAULT_NOTES_PREFS.documentFocus, false);
  // 切替状態は保存して次回も同じ表示で開く。
  assert.match(page, /documentFocus: !documentFocus/);
  assert.match(page, /is-document-focus/);
  // 集中表示では一覧ペインも畳む。
  assert.match(page, /listCollapsed \|\| documentFocus \? " is-list-collapsed"/);
  // Escで元へ戻せる。入力中は横取りしない。
  assert.match(page, /event\.key !== "Escape" \|\| target\?\.closest\("input, textarea, \[contenteditable=true\]"\)/);
  // ページ見出し・フィルタ・日付や出力先の補助行を畳む。
  assert.match(styles, /\.notes-page\.is-document-focus > \.page-header/);
  assert.match(styles, /\.notes-page\.is-document-focus \.note-export-handoff \{ display: none; \}/);
});
