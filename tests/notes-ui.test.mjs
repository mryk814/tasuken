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
  return import(
    `data:text/javascript;base64,${Buffer.from(result.outputFiles[0].contents).toString("base64")}`
  );
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
  assert.deepEqual(
    notes.sortNotesRecords(records, "updated_desc").map((record) => record.id),
    ["same-b", "same-a", "old"],
  );
  assert.deepEqual(
    notes.sortNotesRecords(records, "created_asc").map((record) => record.id),
    ["same-a", "same-b", "old"],
  );
});

test("Notes UI persists filter and sort preferences and exposes save-folder actions", () => {
  const source = readFileSync("src/renderer/src/features/workspace/pages/NotesPage.tsx", "utf8");
  assert.match(source, /usePreference\("notes\.preferences"\)/);
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
  assert.match(source, /ariaLabel="Themeで絞り込み"/);
  assert.match(source, /ThemePickerSelect/);
  assert.match(source, /themeId === ""/);
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
  assert.doesNotMatch(
    source,
    /import \{[^}]*MarkdownRichEditor[^}]*\} from "\.\.\/components\/MarkdownRichEditor"/s,
  );
});

test("micro memo date is a labeled top-level time element", () => {
  const source = readFileSync("src/renderer/src/features/workspace/pages/InboxPage.tsx", "utf8");
  const styles = readFileSync("src/renderer/src/styles/app.css", "utf8");
  assert.match(source, /className="micro-memo-card-meta"/);
  assert.match(source, /<time dateTime=\{memo\.captured_at\}/);
  assert.match(source, />記録 \{formatDate\(memo\.captured_at\)\}</);
  assert.match(styles, /\.micro-memo-card-meta\s*\{[\s\S]*?justify-content: flex-start/);
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
  assert.match(
    styles,
    /\.page-info-button:focus-visible\s*\{\s*outline: 2px solid var\(--color-focus\)/,
  );

  const boilerplate = [
    "ArtifactsPage",
    "ChatRefsPage",
    "ImportExportPage",
    "InboxPage",
    "KnowledgePage",
    "NotesPage",
    "ThemesPage",
    "TimelinePage",
    "TodayPage",
    "TodoPage",
    "WaitingPage",
  ];
  for (const page of boilerplate) {
    const source = readFileSync(`src/renderer/src/features/workspace/pages/${page}.tsx`, "utf8");
    const header = source.slice(source.indexOf("<PageHeader"));
    assert.doesNotMatch(header.slice(0, 400), /subtitle=/, `${page} は用途説明を常時表示しない`);
  }
  // Theme詳細の説明は利用者が書いたデータなので常時表示のまま残す。
  assert.match(
    readFileSync("src/renderer/src/features/workspace/pages/ThemePage.tsx", "utf8"),
    /subtitle=\{theme\.description\}/,
  );
});

test("navigation, page headings and command palette share one canonical label", () => {
  const routes = readFileSync("src/renderer/src/pages/routes.ts", "utf8");
  const shell = readFileSync("src/renderer/src/features/workspace/components/shell.tsx", "utf8");
  const common = readFileSync("src/renderer/src/features/workspace/components/common.tsx", "utf8");
  const app = readFileSync("src/renderer/src/features/workspace/WorkspaceApp.tsx", "utf8");

  // RouteDefinitionがlabel・description・iconの唯一の正本。Sidebarもページ見出しもここを引く。
  assert.match(routes, /export const ROUTE_DEFINITIONS/);
  assert.match(routes, /label: "Chat Refs"/);
  assert.match(routes, /label: "Inbox"/);
  assert.match(routes, /label: "AI Inbox"/);
  assert.match(shell, /const label = routeLabel\(id\);/);
  assert.match(common, /routeLabel\(route\)/);
  assert.match(routes, /export function routeIcon\(id: string\)/);
  assert.match(common, /routeIcon\(route\)/);
  assert.match(app, /routeLabel\("inbox"\)/);

  // 説明語をページ名へ混ぜない。
  for (const forbidden of ["Inbox整理", "チャット参照", "AI連携"]) {
    for (const file of [
      "pages/InboxPage.tsx",
      "pages/ChatRefsPage.tsx",
      "pages/ImportExportPage.tsx",
    ]) {
      const source = readFileSync(`src/renderer/src/features/workspace/${file}`, "utf8");
      const header = source.slice(
        source.indexOf("<PageHeader"),
        source.indexOf("<PageHeader") + 300,
      );
      assert.doesNotMatch(
        header,
        new RegExp(forbidden),
        `${file} の見出しに ${forbidden} を書かない`,
      );
    }
  }

  // 表示名を変えてもrouteとdeep linkは触らない。
  assert.match(routes, /aliases: \[\{ id: "todo-done" \}\]/);
  assert.match(routes, /id: "chat-refs", label: "Chat Refs"/);
});

test("Notesは本文集中表示で一覧と補助行を畳み、縦領域を本文へ回す（#292）", () => {
  const page = readFileSync("src/renderer/src/features/workspace/pages/NotesPage.tsx", "utf8");
  const styles = readFileSync("src/renderer/src/styles/app.css", "utf8");

  assert.equal(notes.DEFAULT_NOTES_PREFS.documentFocus, false);
  // 切替状態は保存して次回も同じ表示で開く。
  assert.match(page, /documentFocus: !documentFocus/);
  assert.match(page, /is-document-focus/);
  // 集中表示では一覧ペインも畳む。切り離しNoteウィンドウ（#290）も同じ畳み方を使う。
  assert.match(
    page,
    /listCollapsed \|\| documentFocus \|\| detachedNoteId \? " is-list-collapsed"/,
  );
  // Escで元へ戻せる。入力中は横取りしない。
  assert.match(
    page,
    /event\.key !== "Escape" \|\| target\?\.closest\("input, textarea, \[contenteditable=true\]"\)/,
  );
  // ページ見出し・フィルタ・日付や出力先の補助行を畳む。
  assert.match(styles, /\.notes-page\.is-document-focus > \.page-header/);
  assert.match(
    styles,
    /\.notes-page\.is-document-focus \.note-export-handoff\s*\{\s*display: none;/,
  );
});

test("Notesの作成導線が一つのprimary actionへ集約される（#313）", () => {
  const source = readFileSync("src/renderer/src/features/workspace/pages/NotesPage.tsx", "utf8");
  const menu = readFileSync(
    "src/renderer/src/features/workspace/components/NoteCreateMenu.tsx",
    "utf8",
  );

  // 種類ごとのbuttonを4つ常設しない。
  assert.equal(
    /<button className="primary-button" onClick=\{\(\) => addNote\("note"\)\}/.test(source),
    false,
  );
  assert.equal(
    /<button className="primary-button" onClick=\{\(\) => addPrompt\(\)\}/.test(source),
    false,
  );
  assert.match(
    source,
    /<NoteCreateMenu defaultKind=\{createDefaultKind\} onCreate=\{createRecord\} \/>/,
  );

  // 既定の種類は現在のfilterから決める。`すべて`ではNote。
  assert.match(source, /const createDefaultKind: NotesKind = scope === "all" \? "note" : scope;/);

  // dropdownから4種を選べ、keyboard / screen readerからも辿れる。
  assert.match(
    menu,
    /const CREATE_ORDER: NotesKind\[\] = \["note", "resource", "report", "prompt"\];/,
  );
  assert.match(menu, /aria-haspopup="menu"/);
  assert.match(menu, /aria-label="追加する種類を選ぶ"/);
  assert.match(menu, /role="menuitem"/);
});

test("本文を選択しただけでは変換toolbarを出さない（#313）", () => {
  const editor = readFileSync(
    "src/renderer/src/features/workspace/components/MarkdownRichEditor.tsx",
    "utf8",
  );
  const source = readFileSync("src/renderer/src/features/workspace/pages/NotesPage.tsx", "utf8");
  const app = readFileSync("src/renderer/src/features/workspace/WorkspaceApp.tsx", "utf8");

  // 選択そのものでpanelを開かない。開くのはタイトルを決める段だけ。
  assert.match(editor, /\{textSelection && extractionKind && \(/);
  assert.equal(/beginSelectionExtraction/.test(editor), false);
  assert.equal(/選択範囲から<\/span>/.test(editor), false);

  // 明示commandで呼ぶ。Command Paletteでfocusが移っても対象を見失わない。
  assert.match(editor, /selectionCommand\?: SelectionCommandRequest \| null;/);
  assert.match(editor, /lastSelectionRangeRef\.current = range\.cloneRange\(\);/);
  assert.match(source, /"selection-task": \(\) => requestSelectionCommand\("task"\)/);
  assert.match(app, /id: "notes:selection-task",\s*label: "選択範囲からTaskを作る"/);
  assert.match(app, /id: "notes:selection-ai",\s*label: "選択範囲をAIで編集"/);
});

test("本文の全文コピーは大きなbuttonから外す（#313）", () => {
  const source = readFileSync("src/renderer/src/features/workspace/pages/NotesPage.tsx", "utf8");

  // 大きなtext buttonは撤去。#331でoverflow menuの項目になった。
  assert.equal(/>本文をコピー</.test(source), false);
  assert.match(
    source,
    /id: "copy-body", label: "本文をすべてコピー", onSelect: \(\) => void copySelectedRaw\(\)/,
  );
});

test("Notesのtoolbarがpage / document / editor / outputへ分かれる（#331）", () => {
  const source = readFileSync("src/renderer/src/features/workspace/pages/NotesPage.tsx", "utf8");

  // 文書の段は「この文書を確定する」ことだけを扱う。
  assert.match(
    source,
    /<span className="note-draft-state" role="status" aria-live="polite">\{saveStateLabel\}<\/span>/,
  );
  assert.match(
    source,
    /<ToolbarMenu label="この文書" title="この文書に対する操作" items=\{documentMenuItems\} \/>/,
  );
  // Editorの段はmode切替と高頻度操作、派生出力はmenuへ。
  assert.match(
    source,
    /<ToolbarMenu label="出力" title="書き出しと保存先" items=\{outputMenuItems\} \/>/,
  );
  assert.match(source, /aria-label="本文を検索・置換"/);

  // 低頻度actionは同格buttonとして並べない。
  for (const removed of [
    />整形<\/button>/,
    />Draft Workspace<\/button>/,
    />AI編集<\/button>/,
    /Knowledge化\s*\n\s*<\/button>/,
    /別ウィンドウで開く"\}\s*\n\s*<\/button>/,
  ]) {
    assert.equal(removed.test(source), false, `${removed} は常設buttonから外れているはず`);
  }
});

test("`保存`はNote正本の確定だけに使い、派生出力と語彙を分ける（#331）", () => {
  const source = readFileSync("src/renderer/src/features/workspace/pages/NotesPage.tsx", "utf8");

  // 画面上で `保存` と表示されるbuttonは、内部Entityを確定する一つだけ。
  assert.match(
    source,
    /<ActionButton action="notesSave" compact disabled=\{!draftDirty\} onClick=\{saveSelectedDraft\} \/>/,
  );

  // 派生出力は `保存` と呼ばない。
  assert.match(
    source,
    /label: markdownExporting \? "Markdownコピーを作成しています" : "Markdownコピーを作成"/,
  );
  assert.match(source, /label: pdfExporting \? "PDFを作成しています" : "PDFを作成"/);
  assert.equal(/\{markdownExporting \? "保存中" : "保存"\}/.test(source), false);

  // 保存状態は一時messageが無くても静止状態を言う。
  assert.match(source, /const saveStateLabel = draftState\s*\n\s*\|\| \(draftDirty/);
  assert.match(
    source,
    /noteSaveStateLabel\(\{ internalSaved: true, fileState: canonicalFileState \}\)/,
  );
});

test("AI iconはAIの操作にだけ使う（#312）", () => {
  const source = readFileSync("src/renderer/src/features/workspace/pages/NotesPage.tsx", "utf8");

  // Knowledge化はNotesの日常導線から撤去し、AI iconを流用する余地も残さない。
  assert.doesNotMatch(source, /Knowledge化|IconBulb/);
  // AI Draftのように実際にAIへ渡す導線だけがAI iconを持つ。
  assert.match(source, /label: "Note AIを開く"/);
  assert.doesNotMatch(source, /AI Draft|DraftWorkspaceDialog|NoteAiDialog/);
});
