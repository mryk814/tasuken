import assert from "node:assert/strict";
import { Buffer } from "node:buffer";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { build } from "esbuild";

async function importBundled(relativePath, plugins = []) {
  const result = await build({
    entryPoints: [path.resolve(relativePath)],
    bundle: true,
    platform: "node",
    format: "esm",
    packages: "external",
    plugins,
    write: false,
    logLevel: "silent",
  });
  return import(`data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString("base64")}`);
}

const electronMockPlugin = {
  name: "mock-electron",
  setup(buildContext) {
    buildContext.onResolve({ filter: /^electron$/ }, () => ({ path: "electron", namespace: "mock-electron" }));
    buildContext.onLoad({ filter: /.*/, namespace: "mock-electron" }, () => ({
      loader: "js",
      contents: `
        export const screen = {
          getAllDisplays: () => [{ workArea: { x: 0, y: 0, width: 800, height: 600 } }],
        };
        export const ipcMain = { handle: () => {} };
        export class BrowserWindow {
          constructor(options = {}) {
            this.bounds = {
              x: options.x ?? 0,
              y: options.y ?? 0,
              width: options.width ?? 300,
              height: options.height ?? 200,
            };
            this.visible = false;
            this.destroyed = false;
            this.minimized = false;
            this.focused = false;
            this.webContents = { isLoading: () => false, send: () => {} };
          }
          isDestroyed() { return this.destroyed; }
          isVisible() { return this.visible; }
          isMinimized() { return this.minimized; }
          restore() { this.minimized = false; }
          show() { this.visible = true; }
          hide() { this.visible = false; }
          focus() { this.focused = true; }
          isFocused() { return this.focused; }
          getBounds() { return { ...this.bounds }; }
          setBounds(next) { this.bounds = { ...this.bounds, ...next }; }
          setTitle() {}
          loadURL() {}
          loadFile() {}
          setAlwaysOnTop() {}
          close() { this.destroyed = true; this.visible = false; }
          on() { return this; }
          once() { return this; }
          removeAllListeners() { return this; }
        }
      `,
    }));
  },
};

const state = await importBundled("src/main/satelliteWindowState.ts");
const memoPresentation = await importBundled("src/shared/memoPresentation.ts");
const registryModule = await importBundled("src/main/satelliteWindowRegistry.ts", [electronMockPlugin]);
const ipcRegistration = await importBundled("src/main/ipc/registerIpc.ts", [electronMockPlugin]);

function tempStatePath() {
  return path.join(mkdtempSync(path.join(tmpdir(), "tasken-satellite-")), "windows.json");
}

test("同じEntityは一意のキーになり、種類とIDを往復できる（#290）", () => {
  assert.equal(state.satelliteWindowKeyOf({ kind: "memo", entityId: "abc" }), "memo:abc");
  assert.deepEqual(state.parseSatelliteWindowKey("memo:abc"), { kind: "memo", entityId: "abc" });
  // UUIDのようにコロンを含まないIDだけでなく、余計な分割をしないことを確認する。
  assert.deepEqual(state.parseSatelliteWindowKey("note:a:b"), { kind: "note", entityId: "a:b" });
  // 未知の面やIDなしは受け付けない。
  assert.equal(state.parseSatelliteWindowKey("task:1"), null);
  assert.equal(state.parseSatelliteWindowKey("memo:"), null);
  assert.equal(state.parseSatelliteWindowKey("memo"), null);
});

test("壊れた位置情報は既定として扱い、ウィンドウを開けなくしない（#290）", () => {
  assert.equal(state.normalizeBounds(null), null);
  assert.equal(state.normalizeBounds({ x: 0, y: 0, width: 0, height: 100 }), null);
  assert.equal(state.normalizeBounds({ x: Number.NaN, y: 0, width: 10, height: 10 }), null);
  assert.deepEqual(
    state.normalizeBounds({ x: 10.4, y: 20.6, width: 300.2, height: 400.8 }),
    { x: 10, y: 21, width: 300, height: 401 },
  );
});

test("モニター構成が変わっても画面外へ復元しない（#290）", () => {
  const limits = { minWidth: 240, minHeight: 200 };
  const primary = { x: 0, y: 0, width: 1920, height: 1040 };
  const secondary = { x: 1920, y: 0, width: 1280, height: 720 };

  // 副モニターを外した後の座標は、残った画面の中へ寄せる。
  const offscreen = { x: 2400, y: 200, width: 360, height: 400 };
  const restored = state.clampBoundsToDisplays(offscreen, [primary], limits);
  assert.ok(restored.x >= primary.x && restored.x + restored.width <= primary.x + primary.width);
  assert.ok(restored.y >= primary.y && restored.y + restored.height <= primary.y + primary.height);

  // 副モニターがあるうちは、そのまま副モニター側に残す。
  assert.deepEqual(state.clampBoundsToDisplays(offscreen, [primary, secondary], limits), offscreen);

  // 画面より大きいウィンドウは画面いっぱいまで縮める。
  const huge = state.clampBoundsToDisplays({ x: -100, y: -100, width: 4000, height: 3000 }, [secondary], limits);
  assert.deepEqual(huge, { x: 1920, y: 0, width: 1280, height: 720 });

  // 画面が極端に小さくても最小サイズは割らない（Editorが操作不能にならない）。
  const tiny = state.clampBoundsToDisplays({ x: 0, y: 0, width: 100, height: 100 }, [{ x: 0, y: 0, width: 120, height: 120 }], limits);
  assert.equal(tiny.width, limits.minWidth);
  assert.equal(tiny.height, limits.minHeight);

  // 画面が取得できない状況では触らない。
  assert.deepEqual(state.clampBoundsToDisplays(offscreen, [], limits), offscreen);
});

test("位置・サイズはEntityごとに覚え、忘れられる（#290）", () => {
  const filePath = tempStatePath();
  const store = state.createSatelliteWindowStateStore(filePath);
  const memo = { kind: "memo", entityId: "memo-1" };
  const note = { kind: "note", entityId: "note-1" };

  assert.equal(store.read(memo), null, "未保存なら既定位置で開く");
  store.write(memo, { x: 10, y: 20, width: 300, height: 400 });
  store.write(note, { x: 50, y: 60, width: 800, height: 600 });
  assert.deepEqual(store.read(memo), { x: 10, y: 20, width: 300, height: 400 });
  assert.deepEqual(store.read(note), { x: 50, y: 60, width: 800, height: 600 });

  // 別インスタンスからも読める（再起動後の復元）。
  assert.deepEqual(state.createSatelliteWindowStateStore(filePath).read(memo), { x: 10, y: 20, width: 300, height: 400 });

  store.forget(memo);
  assert.equal(store.read(memo), null);
  assert.deepEqual(store.read(note), { x: 50, y: 60, width: 800, height: 600 }, "他のEntityは消さない");
});

test("状態ファイルが壊れていても既定位置で開き直せる（#290）", () => {
  const filePath = tempStatePath();
  writeFileSync(filePath, "{ これはJSONではない", "utf8");
  const store = state.createSatelliteWindowStateStore(filePath);
  assert.equal(store.read({ kind: "memo", entityId: "memo-1" }), null);

  // 壊れたファイルへ書き込んでも例外にせず、以後は正しく読める。
  store.write({ kind: "memo", entityId: "memo-1" }, { x: 1, y: 2, width: 300, height: 400 });
  assert.deepEqual(store.read({ kind: "memo", entityId: "memo-1" }), { x: 1, y: 2, width: 300, height: 400 });
  assert.match(readFileSync(filePath, "utf8"), /"memo:memo-1"/);
});

test("状態ファイルに未知のキーや不正な値が混ざっても無視する（#290）", () => {
  const filePath = tempStatePath();
  writeFileSync(filePath, JSON.stringify({
    "memo:ok": { x: 1, y: 2, width: 300, height: 400 },
    "task:not-a-window": { x: 1, y: 2, width: 300, height: 400 },
    "memo:broken": { x: "1", y: 2, width: 300, height: 400 },
  }), "utf8");
  const store = state.createSatelliteWindowStateStore(filePath);
  assert.deepEqual(store.read({ kind: "memo", entityId: "ok" }), { x: 1, y: 2, width: 300, height: 400 });
  assert.equal(store.read({ kind: "memo", entityId: "broken" }), null);
});

function satelliteSpec() {
  return {
    title: "Memo",
    width: 300,
    height: 200,
    minWidth: 220,
    minHeight: 160,
    page: "memo-sticky",
    preload: "preload",
  };
}

function createTestRegistry() {
  const stateFilePath = tempStatePath();
  return {
    stateFilePath,
    registry: registryModule.createSatelliteWindowRegistry({
      stateFilePath,
      getAppIconPath: () => "",
      resolvePageUrl: () => ({ file: "memo-sticky.html" }),
    }),
  };
}

test("arrangeは非表示の非対象ウィンドウを占有矩形に含めない（#327）", () => {
  const { registry } = createTestRegistry();
  const hidden = registry.open({ kind: "today", entityId: "today" }, satelliteSpec());
  hidden.setBounds({ x: 16, y: 16 });
  const target = registry.open({ kind: "memo", entityId: "memo-target" }, satelliteSpec());

  registry.arrange([{ kind: "memo", entityId: "memo-target" }]);

  assert.deepEqual(target.getBounds(), { x: 16, y: 16, width: 300, height: 200 });
});

test("初回配置後は手動移動した新規ウィンドウを再配置しない（#327）", () => {
  const { registry, stateFilePath } = createTestRegistry();
  const fresh = registry.open({ kind: "memo", entityId: "memo-fresh" }, satelliteSpec());

  assert.equal(registry.arrange([{ kind: "memo", entityId: "memo-fresh" }]), 1);
  assert.deepEqual(
    state.createSatelliteWindowStateStore(stateFilePath).read({ kind: "memo", entityId: "memo-fresh" }),
    fresh.getBounds(),
  );
  fresh.setBounds({ x: 500, y: 300 });
  const moved = fresh.getBounds();

  assert.equal(registry.arrange([{ kind: "memo", entityId: "memo-fresh" }]), 0);
  assert.deepEqual(fresh.getBounds(), moved);
});

// --- 配線（source assertion）: Electron依存部分はここで契約だけ固定する ---
const registrySource = readFileSync("src/main/satelliteWindowRegistry.ts", "utf8");
const memoStickySource = readFileSync("src/main/memoStickyController.ts", "utf8");
const mainSource = readFileSync("src/main/index.ts", "utf8");
const noteWindowControllerSource = readFileSync("src/main/noteWindowController.ts", "utf8");
const notesPageSource = readFileSync("src/renderer/src/features/workspace/pages/NotesPage.tsx", "utf8");
const workspaceAppFlushSource = readFileSync("src/renderer/src/features/workspace/WorkspaceApp.tsx", "utf8");
const registerIpcSource = readFileSync("src/main/ipc/registerIpc.ts", "utf8");
const stickyHtml = readFileSync("src/renderer/memo-sticky.html", "utf8");
const viteConfig = readFileSync("electron.vite.config.ts", "utf8");
const cssSourceForNotes = readFileSync("src/renderer/src/styles/app.css", "utf8");
const shellSource = readFileSync("src/renderer/src/features/workspace/components/shell.tsx", "utf8");

test("同じEntityの切り離しウィンドウを二枚作らない（#290 / #298）", () => {
  // 既にあれば作らずに前面へ出す。黙って別Editorを開かないための契約。
  assert.match(registrySource, /const existing = get\(key\);\s*\n\s*if \(existing\) \{/);
  assert.match(registrySource, /reveal\(existing\);\s*\n\s*return existing;/);
  // window から key を逆引きできる（IPCが送り元Entityを特定するため）。
  assert.match(registrySource, /keyOf\(window\)/);
});

test("本体ウィンドウ判定を一箇所へ集約する（#290）", () => {
  // 補助ウィンドウを増やすたびに各所の除外条件へ書き足さない。
  assert.match(mainSource, /function isAuxiliaryWindow\(win: BrowserWindow\): boolean \{/);
  assert.match(mainSource, /return satelliteWindows\?\.has\(win\) === true;/);
  assert.match(mainSource, /\.find\(\(win\) => !isAuxiliaryWindow\(win\) && !win\.isDestroyed\(\)\)/);
  // 切り離しウィンドウにも同じ変更通知を配る（正本が分裂しない）。
  assert.match(mainSource, /satelliteWindows\?\.broadcast\(IPC\.workspaceChanged, change\);/);
});

test("Todayの表示状態はregistryのvisibility遷移を通知する（#327）", () => {
  assert.match(mainSource, /function isVisibleWindow\(win: BrowserWindow \| null\): boolean/);
  assert.match(mainSource, /todayOpen: isVisibleWindow\(todayMiniController\?\.getWindow\(\) \|\| null\)/g);
  assert.doesNotMatch(mainSource, /todayOpen: Boolean\(todayMiniController\?\.getWindow\(\)\)/);
  assert.match(registrySource, /const wasVisible = window\.isVisible\(\);/);
  assert.match(registrySource, /window\.show\(\);/);
  assert.match(registrySource, /window\.focus\(\);/);
  assert.match(registrySource, /if \(!wasVisible && window\.isVisible\(\)\) options\.onChanged\?\.\(\);/);
  assert.match(registrySource, /window\.hide\(\);/);
  assert.match(registrySource, /if \(wasVisible && !window\.isVisible\(\)\) options\.onChanged\?\.\(\);/);
  assert.match(registrySource, /focus\(key\)[\s\S]*reveal\(window\)/);
  assert.match(registrySource, /window\.on\("closed"[\s\S]*options\.onChanged\?\.\(\);/);
});

test("Top BarのToday／付箋はicon中心で状態を色だけに頼らない（#327）", () => {
  assert.match(shellSource, /aria-label="Todayウィンドウを表示"[\s\S]*title="Todayウィンドウを表示"[\s\S]*aria-pressed=\{launcher\.todayWindowOpen\}/);
  assert.match(shellSource, /aria-label="付箋を展開または収納"[\s\S]*title="付箋を展開または収納"[\s\S]*aria-pressed=\{launcher\.stickyWindowsShown\}/);
  assert.match(shellSource, /className="titlebar-launcher-state"/);
  assert.doesNotMatch(shellSource, />Today<\/span>/);
  assert.doesNotMatch(shellSource, />付箋<\/span>/);
  assert.match(cssSourceForNotes, /\.titlebar-launcher button \{ position: relative;[\s\S]*width: 30px/);
  assert.match(cssSourceForNotes, /\.titlebar-launcher button\.is-active \.titlebar-launcher-state \{ display: block; \}/);
});

test("位置・サイズを覚え、画面外へ復元しない配線がある（#290）", () => {
  assert.match(registrySource, /clampBoundsToDisplays\(saved, displays\(\), \{ minWidth: spec\.minWidth, minHeight: spec\.minHeight \}\)/);
  assert.match(registrySource, /window\.on\("move", \(\) => scheduleSaveBounds\(entry\)\)/);
  assert.match(registrySource, /window\.on\("resize", \(\) => scheduleSaveBounds\(entry\)\)/);
  // 端末ごとの見え方なので、正本DBではなくuserData配下のJSONへ置く。
  assert.match(mainSource, /stateFilePath: path\.join\(app\.getPath\("userData"\), "satellite-windows\.json"\)/);
});

test("Notesのdebounce/manual/route flushはowner queueと終了registryを共有する（#291 / #290）", () => {
  assert.match(notesPageSource, /window\.setTimeout\(\(\) => \{[\s\S]*\}, 1500\)/);
  assert.match(notesPageSource, /draftSaveQueuesRef/);
  assert.match(notesPageSource, /sameDraftSaveJob/);
  assert.match(notesPageSource, /cancelAutosaveTimer\(\);[\s\S]*flushDraftSnapshot/);
  assert.match(notesPageSource, /detail\.flush = flushDraftSnapshot/);
  assert.match(notesPageSource, /if \(pending\?\.snapshot\.dirty\) void saveQueuedDraft\(pending\)/);
  assert.match(notesPageSource, /const pageFlush = flushDraftSnapshot\(captureCurrentDraftSnapshot\(\)\)\.then/);
  assert.match(notesPageSource, /Promise\.all\(\[pageFlush, flushPendingNoteDraftSaves\(\)\]\)/);
  assert.match(notesPageSource, /ackNoteWindowFlush\(request\.requestId, pageOk && pendingOk\)/);
  assert.match(workspaceAppFlushSource, /Promise\.all\(\[pageFlush, flushPendingNoteDraftSaves\(\)\]\)/);
  assert.match(workspaceAppFlushSource, /respond\(pageOk && pendingOk\)/);
  assert.match(noteWindowControllerSource, /flushAndClose/);
  assert.match(noteWindowControllerSource, /IPC\.noteWindowFlushAck/);
  assert.match(noteWindowControllerSource, /event\.preventDefault\(\)/);
});

test("generic entity save IPCはMain内部timestampをRendererへ公開しない（#291）", () => {
  assert.match(registerIpcSource, /function normalizeIpcSaveOptions/);
  assert.match(registerIpcSource, /repository\.save\(entityType, entity, normalizeIpcSaveOptions\(options\)\)/);
  assert.doesNotMatch(registerIpcSource, /repository\.save\(entityType, entity, options\)/);
  assert.doesNotMatch(registerIpcSource, /updatedAt|__canonicalOperationAt/);
  assert.deepEqual(
    ipcRegistration.normalizeIpcSaveOptions({ reason: "manual", source: "renderer", quiet: true, __canonicalOperationAt: "1999-01-01T00:00:00.000Z" }),
    { reason: "manual", source: "renderer", quiet: true },
  );
});

test("付箋は同じMemoの表示状態であり、別Entityを作らない（#298）", () => {
  // 保存先は常に元の capture_entry。付箋用のコピーを作らない。
  assert.match(memoStickySource, /options\.repository\.save\("capture_entry", \{ \.\.\.memo, text \}/);
  assert.match(memoStickySource, /const MEMO_KIND = "micro_memo";/);
  // 対象Memoはrenderer側の申告ではなく、ウィンドウの登録情報から特定する。
  assert.match(memoStickySource, /function memoIdOf\(event: Electron\.IpcMainInvokeEvent\): string \| null/);
  assert.match(memoStickySource, /options\.satelliteWindows\.keyOf\(window\)/);
  // ×は表示を閉じるだけで、Memoは削除しない。削除は memo-sticky:delete という別の操作。
  const closeHandler = memoStickySource.slice(memoStickySource.indexOf("ipcMain.handle(IPC.memoStickyClose"));
  const closeBody = closeHandler.slice(0, closeHandler.indexOf("\n    });"));
  assert.match(closeBody, /return options\.satelliteWindows\.close\(\{ kind: "memo", entityId: memoId \}\)/);
  assert.doesNotMatch(closeBody, /repository\.remove/);
});

test("付箋ウィンドウは保存失敗でも入力を失わない（#298）", () => {
  assert.match(stickyHtml, /dirty = true;\s*\n\s*setState\(`保存できません/);
  // 本体側の変更で編集中の内容を上書きしない。
  assert.match(stickyHtml, /if \(!dirty\) \{\s*\n\s*textEl\.value = content\.text;/);
  // 閉じる・フォーカス喪失で未保存を残さない。
  assert.match(stickyHtml, /window\.addEventListener\("blur", \(\) => \{ if \(dirty\) void save\(\); \}\)/);
  // 参照用途のコピーとリンク導線。
  assert.match(stickyHtml, /aria-label="全文をコピー"/);
  assert.match(stickyHtml, /aria-label="常に手前に表示"/);
  assert.match(stickyHtml, /aria-label="付箋を閉じる。メモは残ります"/);
});

test("付箋ウィンドウがビルド対象に登録されている（#298）", () => {
  assert.match(viteConfig, /memoSticky: resolve\(__dirname, "src\/preload\/memoSticky\.ts"\)/);
  assert.match(viteConfig, /memoSticky: resolve\(__dirname, "src\/renderer\/memo-sticky\.html"\)/);
});

test("付箋を閉じる・アーカイブ・削除を別の操作として区別する（#298）", () => {
  const inboxSource = readFileSync("src/renderer/src/features/workspace/pages/InboxPage.tsx", "utf8");

  // 付箋ウィンドウ側: ×は閉じるだけ、アーカイブと削除はメニューへ。
  assert.match(stickyHtml, /aria-label="メモの操作"/);
  assert.match(stickyHtml, /role="menuitem" id="archive">アーカイブ</);
  assert.match(stickyHtml, /role="menuitem" id="delete" class="danger">メモを削除</);
  // 削除は取り消せないので確認する。閉じる操作には確認を出さない。
  assert.match(stickyHtml, /window\.confirm\("このメモを削除しますか。/);
  assert.match(memoStickySource, /ipcMain\.handle\(IPC\.memoStickyArchive/);
  assert.match(memoStickySource, /ipcMain\.handle\(IPC\.memoStickyDelete/);

  // Inbox側: アーカイブと削除を別ボタンで並べる。
  assert.match(inboxSource, /aria-label="付箋メモをアーカイブ"/);
  assert.match(inboxSource, /aria-label="付箋メモを削除"/);
  // すべて閉じてもMemoは削除しない。
  assert.match(inboxSource, /メモは残っています/);
});

test("付箋で開いているMemoを本体から区別できる（#298）", () => {
  const inboxSource = readFileSync("src/renderer/src/features/workspace/pages/InboxPage.tsx", "utf8");
  const cssSource = readFileSync("src/renderer/src/styles/app.css", "utf8");

  // 開閉状態の正本はMainのregistry。画面は購読するだけで自前に持たない。
  assert.match(inboxSource, /workspaceApi\.listOpenMemoStickies\(\)/);
  assert.match(inboxSource, /return workspaceApi\.onMemoStickyOpenChanged\(setOpenStickyIds\);/);
  assert.match(registrySource, /options\.onChanged\?\.\(\);/);

  // 色だけに頼らず語でも示す。
  assert.match(inboxSource, /micro-memo-floating-badge">付箋表示中/);
  assert.match(cssSource, /\.micro-memo-floating-badge \{/);
  // 既に浮いているMemoはボタンの意味が「前面へ出す」に変わる。
  assert.match(inboxSource, /openStickyIds\.includes\(memo\.id\) \? "付箋を前面に表示" : "付箋として表示"/);

  // 開いている付箋の一括操作。
  assert.match(inboxSource, /すべて前面へ/);
  assert.match(inboxSource, /すべて閉じる/);
  assert.match(memoStickySource, /ipcMain\.handle\(IPC\.memoStickyShowAll/);
  assert.match(memoStickySource, /ipcMain\.handle\(IPC\.memoStickyCloseAll/);
});

// --- 切り離しNote編集ウィンドウ（#290） ---
const windowModeSource = await importBundled("src/renderer/src/features/workspace/lib/windowMode.ts");

test("切り離しNoteウィンドウはクエリで判定する（#290）", () => {
  assert.deepEqual(windowModeSource.parseWindowMode("?window=note&noteId=abc"), { kind: "note", noteId: "abc" });
  // 本体はクエリなし。不完全な指定を切り離しとして扱わない。
  assert.deepEqual(windowModeSource.parseWindowMode(""), { kind: "main" });
  assert.deepEqual(windowModeSource.parseWindowMode("?window=note"), { kind: "main" });
  assert.deepEqual(windowModeSource.parseWindowMode("?noteId=abc"), { kind: "main" });
  assert.deepEqual(windowModeSource.parseWindowMode("?window=note&noteId=%20%20"), { kind: "main" });
});

test("Note編集ウィンドウはEditorを二重に実装せず本体と同じrendererを使う（#290）", () => {
  const noteWindowSource = readFileSync("src/main/noteWindowController.ts", "utf8");
  const workspaceAppSource = readFileSync("src/renderer/src/features/workspace/WorkspaceApp.tsx", "utf8");

  // 本体と同じindexを別モードで開く。専用Editorを作らない。
  assert.match(noteWindowSource, /page: "index",\s*\n\s*query: \{ window: "note", noteId \}/);
  assert.match(registrySource, /const search = spec\.query \? new URLSearchParams\(spec\.query\)\.toString\(\) : "";/);

  // 切り離しウィンドウは外枠だけ落とす。
  assert.match(workspaceAppSource, /const route = detachedNoteId \? "notes" : storedRoute;/);
  assert.match(workspaceAppSource, /\{!detachedNoteId && \(\s*\n\s*<Sidebar/);
  assert.match(workspaceAppSource, /route !== "sketch-editor" && !detachedNoteId \? \(/);
  // 狭幅でも高さの制約を失わないよう、Sidebarを積む760px以下のblockフォールバックへ落とさない（#329）。
  assert.match(cssSourceForNotes, /\.app-shell\.is-detached-window \{ display: grid; grid-template-columns: minmax\(0, 1fr\); \}/);
  // 一覧はgridの列を保ったまま畳む。display:noneにすると本文の列がずれる。
  assert.match(cssSourceForNotes, /\.app-shell\.is-detached-window \.notes-page \.notes-resize-handle \{ visibility: hidden; width: 0; \}/);
});

test("狭くしたNote別ウィンドウでも本文の領域が残る（#329）", () => {
  const shellSource = readFileSync("src/renderer/src/features/workspace/components/shell.tsx", "utf8");
  const workspaceAppSource = readFileSync("src/renderer/src/features/workspace/WorkspaceApp.tsx", "utf8");

  // 一覧を畳んでいるときは本文が唯一の列。760px以下でも積み上げず、列構成と高さの制約を保つ。
  assert.match(cssSourceForNotes, /\.notes-workbench\.is-list-collapsed \{ grid-template-columns: 0px auto minmax\(0, 1fr\) !important; \}/);
  assert.match(cssSourceForNotes, /\.notes-workbench\.is-list-collapsed \.note-preview-panel \{ min-height: 0; max-height: 100%; \}/);

  // 上部バーは幅が足りなくても縮めず畳む。縮めると日本語ラベルが一文字ずつ縦積みになる。
  assert.match(cssSourceForNotes, /\.app-titlebar > \*, \.titlebar-controls > \*, \.titlebar-launcher > \* \{ flex-shrink: 0; \}/);
  assert.match(cssSourceForNotes, /\.app-titlebar button, \.app-titlebar \.titlebar-brand \{ white-space: nowrap; \}/);

  // Sidebarが無いウィンドウで開閉トグルを出さない。
  assert.match(shellSource, /\{!detached && \(\s*\n\s*<button\s*\n\s*className="titlebar-sidebar-toggle"/);
  assert.match(workspaceAppSource, /detached=\{Boolean\(detachedNoteId\)\}/);

  // 見出しは上部が持つ。本文側で二重に出さない。
  assert.match(cssSourceForNotes, /\.notes-page\.is-detached-note \.note-preview-header h2 \{ display: none; \}/);
});

test("同じNoteを二つのEditorで黙って同時編集させない（#290）", () => {
  const notesSource = readFileSync("src/renderer/src/features/workspace/pages/NotesPage.tsx", "utf8");

  // 別ウィンドウが編集主体のあいだ、本体はPreviewへ固定して書き込ませない。
  assert.match(notesSource, /const detachedElsewhere = !detachedNoteId && Boolean\(selected && openNoteWindowIds\.includes\(selected\.id\)\)/);
  assert.match(notesSource, /if \(detachedElsewhere\) setPreviewMode\("preview"\);/);
  assert.match(notesSource, /このノートは別ウィンドウで編集中です。/);
  assert.match(notesSource, /disabled=\{detachedElsewhere\}/);
  // 常設buttonから「この文書」menuの項目へ移した（#331）。意味の切り替えは維持する。
  assert.match(notesSource, /openNoteWindowIds\.includes\(selected\.id\) \? "別ウィンドウを前面に出す" : "別ウィンドウで開く"/);
  // 切り離す前に本体の未保存分を確定させ、別ウィンドウが古い本文を読まないようにする。
  assert.match(notesSource, /const current = captureCurrentDraftSnapshot\(\);\s*\n\s*await flushDraftSnapshot\(current\);\s*\n\s*const opened = await workspaceApi\.openNoteWindow\(selected\.id\)/);
});

test("Noteウィンドウから本体へ表示を渡せる（#290）", () => {
  const noteWindowSource = readFileSync("src/main/noteWindowController.ts", "utf8");
  const workspaceAppSource = readFileSync("src/renderer/src/features/workspace/WorkspaceApp.tsx", "utf8");

  // 本体へ戻すと、本体で同じNoteを開き直してからウィンドウを閉じる。
  assert.match(noteWindowSource, /ipcMain\.handle\(IPC\.noteWindowReturnToMain/);
  assert.match(noteWindowSource, /mainWindow\.webContents\.send\(IPC\.workspaceOpenNote, noteId\)/);
  // 関連Entityは本体側で開き、Noteウィンドウ自体は閉じない。
  assert.match(noteWindowSource, /ipcMain\.handle\(IPC\.noteWindowOpenInMain/);
  assert.match(workspaceAppSource, /window\.api\?\.app\?\.onOpenNote\?\.\(/);
  assert.match(workspaceAppSource, /window\.api\?\.app\?\.onNavigate\?\.\(/);
  // 受け側は本体だけ。切り離しウィンドウは自分で自分を移動させない。
  assert.match(workspaceAppSource, /if \(detachedNoteId \|\| loadState !== "success"\) return undefined;/);
});

test("上部バーはPopoverを経由せずRegistryの衛星ウィンドウを操作する（#327）", () => {
  const shellSource = readFileSync("src/renderer/src/features/workspace/components/shell.tsx", "utf8");
  const workspaceAppSource = readFileSync("src/renderer/src/features/workspace/WorkspaceApp.tsx", "utf8");

  assert.match(shellSource, /todayWindowOpen: boolean;/);
  assert.match(shellSource, /stickyWindowsShown: boolean;/);
  assert.match(shellSource, /aria-pressed=\{launcher\.todayWindowOpen\}/);
  assert.match(shellSource, /aria-pressed=\{launcher\.stickyWindowsShown\}/);
  assert.doesNotMatch(shellSource, /titlebar-popover/);
  assert.match(workspaceAppSource, /workspaceApi\.getSatelliteWindowState\(\)/);
  assert.match(workspaceAppSource, /return workspaceApi\.onSatelliteWindowStateChanged\(applyState\);/);
  assert.match(workspaceAppSource, /workspaceApi\.showAllMemoStickies\(\)/);
  assert.match(workspaceAppSource, /workspaceApi\.closeAllMemoStickies\(\)/);
});

test("付箋表示対象は同じMemoのproperties_jsonへ保存し、閉じても状態を消さない（#327）", () => {
  const memo = { id: "memo-1", kind: "micro_memo", state: "untriaged", properties_json: { color: "amber" } };
  const marked = memoPresentation.markStickyMemoTarget(memo, true);
  assert.equal(memoPresentation.isStickyMemoTarget(marked), true);
  assert.equal(marked.properties_json.presentation, "floating");
  assert.equal(marked.properties_json.color, "amber");
  assert.equal(memoPresentation.isStickyMemoTarget({ ...marked, state: "archived" }), false);
  assert.equal(memoPresentation.isStickyMemoTarget({ ...marked, deleted_at: "2026-08-08T00:00:00Z" }), false);
});
