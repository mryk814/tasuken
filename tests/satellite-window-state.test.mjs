import assert from "node:assert/strict";
import { Buffer } from "node:buffer";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { build } from "esbuild";

async function importBundled(relativePath) {
  const result = await build({
    entryPoints: [path.resolve(relativePath)],
    bundle: true,
    platform: "node",
    format: "esm",
    packages: "external",
    write: false,
    logLevel: "silent",
  });
  return import(`data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString("base64")}`);
}

const state = await importBundled("src/main/satelliteWindowState.ts");

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

// --- 配線（source assertion）: Electron依存部分はここで契約だけ固定する ---
const registrySource = readFileSync("src/main/satelliteWindowRegistry.ts", "utf8");
const memoStickySource = readFileSync("src/main/memoStickyController.ts", "utf8");
const mainSource = readFileSync("src/main/index.ts", "utf8");
const stickyHtml = readFileSync("src/renderer/memo-sticky.html", "utf8");
const viteConfig = readFileSync("electron.vite.config.ts", "utf8");

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
  assert.match(mainSource, /satelliteWindows\?\.broadcast\("workspace:changed", change\);/);
});

test("位置・サイズを覚え、画面外へ復元しない配線がある（#290）", () => {
  assert.match(registrySource, /clampBoundsToDisplays\(saved, displays\(\), \{ minWidth: spec\.minWidth, minHeight: spec\.minHeight \}\)/);
  assert.match(registrySource, /window\.on\("move", \(\) => scheduleSaveBounds\(entry\)\)/);
  assert.match(registrySource, /window\.on\("resize", \(\) => scheduleSaveBounds\(entry\)\)/);
  // 端末ごとの見え方なので、正本DBではなくuserData配下のJSONへ置く。
  assert.match(mainSource, /stateFilePath: path\.join\(app\.getPath\("userData"\), "satellite-windows\.json"\)/);
});

test("付箋は同じMemoの表示状態であり、別Entityを作らない（#298）", () => {
  // 保存先は常に元の capture_entry。付箋用のコピーを作らない。
  assert.match(memoStickySource, /options\.repository\.save\("capture_entry", \{ \.\.\.memo, text \}/);
  assert.match(memoStickySource, /const MEMO_KIND = "micro_memo";/);
  // 対象Memoはrenderer側の申告ではなく、ウィンドウの登録情報から特定する。
  assert.match(memoStickySource, /function memoIdOf\(event: Electron\.IpcMainInvokeEvent\): string \| null/);
  assert.match(memoStickySource, /options\.satelliteWindows\.keyOf\(window\)/);
  // ×は表示を閉じるだけで、Memoは削除しない。
  assert.match(memoStickySource, /return options\.satelliteWindows\.close\(\{ kind: "memo", entityId: memoId \}\)/);
  assert.doesNotMatch(memoStickySource, /repository\.remove/);
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
