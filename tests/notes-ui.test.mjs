import assert from "node:assert/strict";
import { Buffer } from "node:buffer";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import vm from "node:vm";
import { build } from "esbuild";
import ts from "typescript";

import * as canonicalMarkdown from "../src/shared/canonicalMarkdown.mjs";

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
const draftIdentity = await importBundled(
  "src/renderer/src/features/workspace/lib/noteDraftIdentity.ts",
);
const draftQueue = await importBundled(
  "src/renderer/src/features/workspace/lib/noteDraftSaveQueue.ts",
);
const draftFlush = await importBundled(
  "src/renderer/src/features/workspace/lib/noteDraftFlushRegistry.ts",
);
const format = await importBundled("src/renderer/src/features/workspace/lib/format.ts");
const markdown = await importBundled("src/renderer/src/features/workspace/lib/markdown.ts");

// Exercise the real renderer event callbacks without opening Electron or copying
// their save decisions into the test. Only the editor/IPC boundary is a fixture.
function noteSaveHarness(syncState, { confirmOverwrite = true, holdSave = false } = {}) {
  const source = readFileSync("src/renderer/src/features/workspace/pages/NotesPage.tsx", "utf8");
  const tree = ts.createSourceFile(
    "NotesPage.tsx",
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX,
  );
  const functions = new Map();
  let saveButton;
  let saveCommand;
  let commandAssignment;
  let keyboardEffect;
  let selectedBodyEffect;
  let autosaveEffect;
  let saveEnabledDeclaration = "";
  function visit(node) {
    if (ts.isFunctionDeclaration(node) && node.name) functions.set(node.name.text, node);
    if (ts.isVariableDeclaration(node) && node.name.getText(tree) === "canSaveSelectedDraft") {
      saveEnabledDeclaration = `const ${node.getText(tree)};`;
    }
    if (ts.isJsxSelfClosingElement(node) && node.tagName.getText(tree) === "ActionButton") {
      if (
        node.attributes.properties.some(
          (attr) => attr.name?.getText(tree) === "action" && attr.initializer?.text === "notesSave",
        )
      )
        saveButton = node;
    }
    if (ts.isBinaryExpression(node) && node.left.getText(tree) === "commandActionsRef.current") {
      commandAssignment = node;
      saveCommand = node.right.properties.find(
        (property) => property.name?.getText(tree) === "save",
      )?.initializer;
    }
    if (
      ts.isCallExpression(node) &&
      node.expression.getText(tree) === "useEffect" &&
      node.arguments[0]?.getText(tree).includes('window.addEventListener("keydown", handleKeyDown)')
    ) {
      keyboardEffect = node.arguments[0];
    }
    if (
      ts.isCallExpression(node) &&
      node.expression.getText(tree) === "useEffect" &&
      node.arguments[0]?.getText(tree).includes("const previous = autosaveRef.current;")
    ) {
      selectedBodyEffect = node.arguments[0];
    }
    if (
      ts.isCallExpression(node) &&
      node.expression.getText(tree) === "useEffect" &&
      node.arguments[0]?.getText(tree).includes("void autoSaveDraft(autosaveRef.current)")
    ) {
      autosaveEffect = node.arguments[0];
    }
    ts.forEachChild(node, visit);
  }
  visit(tree);
  assert.ok(saveButton && saveCommand && keyboardEffect, "保存button・command・Ctrl+Sの実配線");
  const buttonExpression = (name) =>
    saveButton.attributes.properties
      .find((attr) => attr.name?.getText(tree) === name)
      .initializer.expression.getText(tree);
  const names = [
    "recordBody",
    "needsCanonicalMarkdownRetry",
    "currentDraftBodyForSelected",
    "captureCurrentDraftSnapshot",
    "persistDraftSnapshot",
    "cancelAutosaveTimer",
    "sameDraftSaveJob",
    "startDraftSaveQueue",
    "enqueueDraftSave",
    "saveQueuedDraft",
    "autoSaveDraft",
    "flushDraftSnapshot",
    "saveSelectedDraft",
  ];
  const note = {
    recordType: "note",
    id: "retry-note",
    title: "保存の再試行",
    version: 7,
    body_markdown: "内部へ保存済みの本文",
    properties_json: {
      canonical_markdown: { sync_state: syncState, canonical_path: "fixture/note.md" },
    },
  };
  const owner = draftIdentity.noteDraftOwner("note", note.id);
  const snapshot = draftIdentity.makeNoteDraftSnapshot(
    owner,
    note.body_markdown,
    note.body_markdown,
    note.version,
  );
  let editorBody = note.body_markdown;
  const records = new Map([[note.id, note]]);
  const listeners = new Map();
  const savedRequests = [];
  const messages = [];
  const timers = [];
  let releaseSave;
  const saveGate = holdSave
    ? new Promise((resolve) => {
        releaseSave = resolve;
      })
    : Promise.resolve();
  const context = {
    ...canonicalMarkdown,
    ...draftIdentity,
    ...draftQueue,
    ...draftFlush,
    str: format.str,
    selected: note,
    selectedOwner: owner,
    selectedBody: note.body_markdown,
    selectedOwnerKey: draftIdentity.noteDraftOwnerKey(owner),
    selectedOwnerKeyRef: { current: draftIdentity.noteDraftOwnerKey(owner) },
    draftSnapshotState: snapshot,
    draftDirty: false,
    draftBody: note.body_markdown,
    richEditorDirty: false,
    canonicalFileState: canonicalMarkdown.canonicalMarkdownFileState(syncState),
    mdxMarkdownSourceRef: {
      current: { ownerKey: draftIdentity.noteDraftOwnerKey(owner), getMarkdown: () => editorBody },
    },
    autosaveRef: { current: { selected: note, snapshot } },
    autosaveTimerRef: { current: null },
    selectedBodyRef: { current: snapshot },
    draftSaveQueuesRef: { current: new Map() },
    commandActionsRef: { current: {} },
    setDraftState: (message) => messages.push(message),
    setDraftOwner: (nextOwner) => {
      context.draftOwner = nextOwner;
    },
    setDraftBodyState: (body) => {
      context.draftBody = body;
    },
    setRichEditorDirty: (dirty) => {
      context.richEditorDirty = dirty;
    },
    setIndexedDraftBody: () => {},
    setDiffOpen: () => {},
    setSearchIndex: () => {},
    setAutoLinked: () => {},
    setRecentExtraction: () => {},
    normalizeRichEditorMarkdown: markdown.normalizeRichEditorMarkdown,
    setCanonicalSyncState: (state) => {
      context.canonicalFileState = state;
    },
    setToastRef: { current: (message) => messages.push(message) },
    setToast: (message) => messages.push(message),
    workspaceApi: { get: async (_type, id) => records.get(id) },
    saveEntityRef: {
      current: async (type, entity, options, documentSnapshot) => {
        savedRequests.push({ type, entity, options, documentSnapshot });
        if (documentSnapshot.expectedRevision !== records.get(entity.id).version)
          throw new Error("Noteが更新済みです。古い編集画面を閉じて再試行してください。");
        await saveGate;
        const saved = {
          ...entity,
          version: entity.version + 1,
          properties_json: {
            canonical_markdown: {
              ...entity.properties_json.canonical_markdown,
              sync_state: "in_sync",
            },
          },
        };
        records.set(saved.id, saved);
        return saved;
      },
    },
    window: {
      clearTimeout: () => {},
      confirm: () => confirmOverwrite,
      setTimeout: (callback) => {
        timers.push(callback);
        return timers.length;
      },
      addEventListener: (type, listener) => listeners.set(type, listener),
      removeEventListener: (type) => listeners.delete(type),
    },
  };
  const code = [
    ...names.filter((name) => functions.has(name)).map((name) => functions.get(name).getText(tree)),
    saveEnabledDeclaration,
    `globalThis.saveButtonDisabled = () => (${buttonExpression("disabled")});`,
    `globalThis.clickSave = () => (${buttonExpression("onClick")})();`,
    `${commandAssignment.getText(tree)};`,
    "globalThis.commandSave = commandActionsRef.current.save;",
    `globalThis.receiveSelectedBody = ${selectedBodyEffect.getText(tree)};`,
    `globalThis.scheduleAutosave = ${autosaveEffect.getText(tree)};`,
    `(${keyboardEffect.getText(tree)})();`,
  ].join("\n");
  vm.runInNewContext(ts.transpile(code, { target: ts.ScriptTarget.ES2022 }), context);
  return {
    context,
    note,
    savedRequests,
    messages,
    releaseSave,
    edit(body) {
      editorBody = body;
      context.draftBody = body;
      context.richEditorDirty = true;
      context.draftDirty = body !== context.selectedBody;
      context.draftSnapshotState = draftIdentity.makeNoteDraftSnapshot(
        owner,
        body,
        note.body_markdown,
        note.version,
      );
      context.autosaveRef.current = { selected: note, snapshot: context.draftSnapshotState };
    },
    receiveSavedBody(body, version, patch = {}) {
      context.selected = { ...note, ...patch, body_markdown: body, version };
      records.set(note.id, context.selected);
      context.selectedBody = body;
      context.receiveSelectedBody();
    },
    async startAutosave() {
      context.scheduleAutosave();
      assert.equal(timers.length, 1);
      timers[0]();
      await new Promise(setImmediate);
    },
    async finishSave() {
      releaseSave?.();
      await draftFlush.flushPendingNoteDraftSaves();
      await new Promise(setImmediate);
    },
    select(nextNote) {
      records.set(nextNote.id, nextNote);
      context.selected = nextNote;
      context.selectedOwner = draftIdentity.noteDraftOwner(nextNote.recordType, nextNote.id);
      context.selectedOwnerKey = draftIdentity.noteDraftOwnerKey(context.selectedOwner);
      context.selectedOwnerKeyRef.current = context.selectedOwnerKey;
      context.selectedBody = nextNote.body_markdown;
      context.receiveSelectedBody();
    },
    async save(entrypoint) {
      if (entrypoint === "button") {
        assert.equal(
          context.saveButtonDisabled(),
          false,
          "Markdownだけ未同期でも保存buttonを押せる",
        );
        await context.clickSave();
      } else if (entrypoint === "command") {
        await context.commandSave();
      } else {
        let prevented = false;
        listeners.get("keydown")({
          ctrlKey: true,
          key: "s",
          preventDefault: () => {
            prevented = true;
          },
        });
        assert.equal(prevented, true);
      }
      await draftFlush.flushPendingNoteDraftSaves();
      await new Promise(setImmediate);
    },
  };
}

test("Markdownだけ未同期のNoteは本文を変えず保存button・command・Ctrl+Sから再試行できる（#291）", async (t) => {
  for (const entrypoint of ["button", "command", "keyboard"]) {
    await t.test(entrypoint, async () => {
      const harness = noteSaveHarness("internal_ahead");
      await harness.save(entrypoint);
      assert.equal(harness.savedRequests.length, 1, "同じNoteの保存経路へ再試行を送る");
      const request = harness.savedRequests[0];
      assert.equal(request.type, "note");
      assert.equal(request.entity.body_markdown, harness.note.body_markdown);
      assert.equal(request.documentSnapshot.body, harness.note.body_markdown);
      assert.equal(request.documentSnapshot.expectedRevision, 7);
      assert.equal(harness.context.canonicalFileState, "synced");
      assert.ok(harness.messages.includes("すべての変更を保存しました"));
    });
  }
});

test("未同期の再試行は保存先復旧と競合確認を扱い、同期済みNoteを再保存しない（#291）", async (t) => {
  for (const state of ["unavailable", "conflict"]) {
    await t.test(state, async () => {
      const harness = noteSaveHarness(state);
      await harness.save("button");
      assert.equal(harness.savedRequests.length, 1);
      assert.equal(
        harness.savedRequests[0].options.canonicalMarkdown,
        state === "conflict" ? "overwrite" : undefined,
      );
      assert.equal(harness.context.canonicalFileState, "synced");
    });
  }
  const declined = noteSaveHarness("conflict", { confirmOverwrite: false });
  await declined.save("keyboard");
  assert.equal(
    declined.savedRequests[0].options.canonicalMarkdown,
    undefined,
    "確認を断ると外部Markdownを上書きしない",
  );
  const synced = noteSaveHarness("in_sync");
  assert.equal(synced.context.saveButtonDisabled(), true);
  await synced.save("command");
  await synced.save("keyboard");
  assert.equal(synced.savedRequests.length, 0);
});

test("保存応答で同じNoteの正本が進んでも保存中の追加入力を戻さない（#291）", async () => {
  const harness = noteSaveHarness("in_sync", { holdSave: true });
  harness.edit("応答した一つ前の本文");
  await harness.startAutosave();
  harness.edit("保存中に追加した最新の本文");
  await harness.finishSave();
  harness.receiveSavedBody("応答した一つ前の本文", 8);
  assert.equal(harness.context.draftBody, "保存中に追加した最新の本文");
  assert.equal(harness.context.richEditorDirty, true);
  assert.equal(harness.context.selectedBodyRef.current.body, "応答した一つ前の本文");
  assert.equal(harness.context.selectedBodyRef.current.expectedRevision, 8);
  await harness.save("command");
  assert.equal(harness.savedRequests[1].documentSnapshot.expectedRevision, 8);
  assert.equal(harness.savedRequests[1].documentSnapshot.body, "保存中に追加した最新の本文");
});

test("別writerの更新中に未保存本文があると元revisionで競合を検出する（#291）", async () => {
  const harness = noteSaveHarness("in_sync");
  harness.edit("v7から編集した本文");
  harness.receiveSavedBody("別writerのv8本文", 8);
  await harness.save("command");
  assert.equal(harness.savedRequests[0].documentSnapshot.expectedRevision, 7);
  assert.equal(harness.context.draftBody, "v7から編集した本文");
  assert.ok(harness.messages.some((message) => message.includes("Noteが更新済みです")));
});

test("本文が同じmetadata更新後も未保存本文を最新Theme・revisionと保存できる（#291）", async () => {
  const harness = noteSaveHarness("in_sync");
  harness.edit("Theme変更中に編集中の本文");
  harness.receiveSavedBody(harness.note.body_markdown, 8, { project_id: "updated-theme" });
  await harness.save("command");
  assert.equal(harness.savedRequests[0].documentSnapshot.expectedRevision, 8);
  assert.equal(harness.savedRequests[0].documentSnapshot.body, "Theme変更中に編集中の本文");
  assert.equal(harness.savedRequests[0].entity.project_id, "updated-theme");
  assert.equal(harness.context.canonicalFileState, "synced");
  assert.equal(
    harness.messages.some((message) => message.includes("Noteが更新済みです")),
    false,
  );
});

test("保存中に元本文へUndoした入力も保存応答で戻さない（#291）", async () => {
  const harness = noteSaveHarness("in_sync", { holdSave: true });
  harness.edit("保存中の変更本文");
  await harness.startAutosave();
  harness.edit(harness.note.body_markdown);
  harness.receiveSavedBody("保存中の変更本文", 8);
  await harness.finishSave();
  assert.equal(harness.context.draftBody, harness.note.body_markdown);
  assert.equal(harness.context.richEditorDirty, true);
  await harness.save("command");
  assert.equal(harness.savedRequests[1].documentSnapshot.body, harness.note.body_markdown);
  assert.equal(harness.savedRequests[1].documentSnapshot.expectedRevision, 8);
});

test("新しい未保存入力がなければ同じNoteの外部更新・保存応答を受け入れる（#291）", () => {
  const external = noteSaveHarness("in_sync");
  external.receiveSavedBody("別ウィンドウで更新した本文", 8);
  assert.equal(external.context.draftBody, "別ウィンドウで更新した本文");
  assert.equal(external.context.richEditorDirty, false);
  const ownSave = noteSaveHarness("in_sync");
  ownSave.edit("今回保存した本文");
  ownSave.receiveSavedBody("今回保存した本文", 8);
  assert.equal(ownSave.context.draftBody, "今回保存した本文");
  assert.equal(ownSave.context.richEditorDirty, false);
});

test("Noteを切り替えると前の未保存本文をflushし、切替先の本文だけを表示する（#291）", async () => {
  const harness = noteSaveHarness("in_sync");
  harness.edit("切替前のNoteへ保存する本文");
  harness.select({
    ...harness.note,
    id: "next-note",
    body_markdown: "切替先だけの本文",
    version: 3,
  });
  await draftFlush.flushPendingNoteDraftSaves();
  await new Promise(setImmediate);
  assert.equal(harness.savedRequests.length, 1);
  assert.equal(harness.savedRequests[0].entity.id, "retry-note");
  assert.equal(harness.savedRequests[0].documentSnapshot.body, "切替前のNoteへ保存する本文");
  assert.equal(harness.context.draftBody, "切替先だけの本文");
  assert.equal(harness.context.richEditorDirty, false);
  assert.equal(harness.context.selectedBodyRef.current.owner.entityId, "next-note");
  assert.equal(harness.context.selectedBodyRef.current.expectedRevision, 3);
});

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
  assert.match(source, />\s*記録\s+\{formatDate\(memo\.captured_at\)\}\s*</);
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
  assert.match(routes, /id: "chat-refs",\s*label: "Chat Refs"/);
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
  assert.doesNotMatch(app, /id: "notes:selection-ai"|選択範囲をAIで編集/);
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
    /<span\s+className="note-draft-state"\s+role="status"\s+aria-live="polite">\s*\{saveStateLabel\}\s*<\/span>/,
  );
  assert.match(
    source,
    /<ToolbarMenu\s+label="この文書"\s+title="この文書に対する操作"\s+items=\{documentMenuItems\}\s*\/>/,
  );
  // Editorの段はmode切替と高頻度操作、派生出力はmenuへ。
  assert.match(
    source,
    /<ToolbarMenu\s+label="出力"\s+title="書き出しと保存先"\s+items=\{outputMenuItems\}\s*\/>/,
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
    /<ActionButton\s+action="notesSave"\s+compact\s+disabled=\{!canSaveSelectedDraft\}\s+onClick=\{saveSelectedDraft\}\s*\/>/,
  );

  // 派生出力は `保存` と呼ばない。
  assert.match(
    source,
    /label: markdownExporting \? "Markdownコピーを作成しています" : "Markdownコピーを作成"/,
  );
  assert.match(source, /label: pdfExporting \? "PDFを作成しています" : "PDFを作成"/);
  assert.equal(/\{markdownExporting \? "保存中" : "保存"\}/.test(source), false);

  // 保存状態は一時messageが無くても静止状態を言う。
  assert.match(source, /const saveStateLabel\s*=\s*draftState\s*\|\|\s*\(draftDirty/);
  assert.match(
    source,
    /noteSaveStateLabel\(\{ internalSaved: true, fileState: canonicalFileState \}\)/,
  );
});

test("AI iconはAIの操作にだけ使う（#312）", () => {
  const source = readFileSync("src/renderer/src/features/workspace/pages/NotesPage.tsx", "utf8");

  // Knowledge化はNotesの日常導線から撤去し、AI iconを流用する余地も残さない。
  assert.doesNotMatch(source, /Knowledge化|IconBulb/);
  // 内蔵AI実行導線はNotesから撤去する。
  assert.doesNotMatch(source, /Note AIを開く|AI Draft|DraftWorkspaceDialog|NoteAiDialog/);
});
