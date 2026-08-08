/**
 * Note別ウィンドウの狭幅レイアウト監査（#329）
 *
 * package版と同じビルド成果物をElectronで起動し、Noteを別ウィンドウへ切り離してから
 * 幅・表示倍率・Edit/Preview/Rawごとに走査する。
 *
 *   npm run build && npm run audit:note-window
 *
 * 「本文が見えているか」を目視に頼らず、本文要素の可視高さを実測して判定する。
 * 崩れを検出した組み合わせはスクリーンショットを出力し、終了コード1で終わる。
 */
import { _electron as electron } from "playwright";
import { mkdirSync } from "node:fs";
import os from "node:os";
import path from "node:path";

const OUT_DIR = process.argv[2] || "audit-shots/note-window";
// 560はBrowserWindowのminWidth（noteWindowController.ts）と揃える。
const WIDTHS = [980, 760, 700, 560];
const ZOOMS = [1, 1.25, 1.5];
const MODES = ["Edit", "Preview", "Raw"];
const WINDOW_HEIGHT = 720;
/** これを下回ると「本文が読めない」とみなす下限。 */
const MIN_BODY_HEIGHT = 120;
const ZOOM_STORAGE_KEY = "tasken:shell:zoom-factor:v1";
const AUDIT_NOTE_ID = "note-window-audit";

/** ページ内で実行する検出器。本文の可視高さと、崩れの兆候を実測する。 */
function inspectNoteWindow() {
  const doc = document.scrollingElement;
  const body = document.querySelector(".note-main-preview, textarea.note-main-editor-raw, .note-live-editor");
  const rect = body?.getBoundingClientRect();
  // 存在するだけでは足りない。実際に窓の中で見えている高さを測る。
  const bodyVisibleHeight = rect
    ? Math.round(Math.min(rect.bottom, window.innerHeight) - Math.max(rect.top, 0))
    : 0;

  // 日本語ラベルが一文字ずつ縦積みになっていないか。
  // 畳んだ一覧（幅0）の中身は見えないので対象外。
  const stacked = [];
  for (const button of document.querySelectorAll(".app-titlebar button, .notes-page button")) {
    if (button.closest(".notes-list-panel")) continue;
    const text = (button.textContent || "").trim();
    if (text.length < 2) continue;
    const box = button.getBoundingClientRect();
    if (box.width <= 0) continue;
    const fontSize = parseFloat(getComputedStyle(button).fontSize) || 14;
    if (box.height > fontSize * 2.6 && box.width < fontSize * 2.4) stacked.push(text.slice(0, 16));
  }

  return {
    bodyVisibleHeight,
    bodyPresent: Boolean(body),
    horizontalScroll: doc.scrollWidth > doc.clientWidth + 1,
    stacked,
  };
}

mkdirSync(OUT_DIR, { recursive: true });

const app = await electron.launch({
  args: [
    ".",
    "--disable-gpu",
    "--disable-gpu-compositing",
    `--user-data-dir=${path.join(os.tmpdir(), "tasken-note-window-audit")}`,
  ],
});
const mainWindow = await app.firstWindow();
await mainWindow.waitForLoadState("domcontentloaded");
await mainWindow.waitForTimeout(5000);

await mainWindow.evaluate(async (noteId) => {
  await window.api.entities.save("note", {
    id: noteId,
    title: "別ウィンドウ狭幅監査",
    body_markdown: [
      "# 見出し",
      "",
      "本文の一行目です。狭い幅でもここが読めることを確認します。",
      "",
      "- 箇条書き1",
      "- 箇条書き2",
      "",
      "| 列A | 列B |",
      "| --- | --- |",
      "| 1 | 2 |",
      "",
      "```",
      "const longCodeLineThatShouldScrollLocallyRatherThanBreakingThePage = true;",
      "```",
    ].join("\n"),
    note_type: "note",
    content_format: "markdown",
  });
}, AUDIT_NOTE_ID);
await mainWindow.waitForTimeout(600);
await mainWindow.evaluate((noteId) => window.api.app.openNoteWindow(noteId), AUDIT_NOTE_ID);
await mainWindow.waitForTimeout(3500);

const noteWindow = app.windows().find((window) => window.url().includes("window=note"));
if (!noteWindow) {
  console.error("Note別ウィンドウを開けませんでした。");
  await app.close();
  process.exit(1);
}
await noteWindow.waitForLoadState("domcontentloaded");
await noteWindow.waitForTimeout(2500);

const setNoteWindowSize = (width) => app.evaluate(({ BrowserWindow }, size) => {
  const target = BrowserWindow.getAllWindows().find((window) => window.webContents.getURL().includes("window=note"));
  target.setSize(size.width, size.height);
}, { width, height: WINDOW_HEIGHT });

let failures = 0;

for (const zoom of ZOOMS) {
  await noteWindow.evaluate(([key, value]) => window.localStorage.setItem(key, JSON.stringify(value)), [ZOOM_STORAGE_KEY, zoom]);
  await noteWindow.reload();
  await noteWindow.waitForLoadState("domcontentloaded");
  await noteWindow.waitForTimeout(3000);

  for (const width of WIDTHS) {
    await setNoteWindowSize(width);
    await noteWindow.waitForTimeout(700);

    for (const mode of MODES) {
      const tab = noteWindow.locator(".note-editor-mode-tabs button", { hasText: new RegExp(`^${mode}$`) }).first();
      if (!(await tab.count())) continue;
      await tab.click();
      // Editはリッチエディタを遅延読み込みするので、他modeより長めに待つ。
      await noteWindow.waitForTimeout(mode === "Edit" ? 1500 : 800);

      const result = await noteWindow.evaluate(inspectNoteWindow);
      const label = `幅${width} 倍率${zoom} ${mode}`;
      const broken = !result.bodyPresent
        || result.bodyVisibleHeight < MIN_BODY_HEIGHT
        || result.horizontalScroll
        || result.stacked.length > 0;
      if (!broken) {
        console.log(`ok   ${label}: 本文${result.bodyVisibleHeight}px`);
        continue;
      }
      failures += 1;
      console.log(`NG   ${label}: 本文${result.bodyVisibleHeight}px 存在=${result.bodyPresent} 横スクロール=${result.horizontalScroll} 縦積み=${result.stacked.length}`);
      for (const text of result.stacked) console.log(`       縦積み "${text}"`);
      await noteWindow.screenshot({ path: `${OUT_DIR}/${width}-x${zoom}-${mode}.png` });
    }
  }
}

await app.close();

if (failures) {
  console.error(`\n${failures}件の組み合わせでNote別ウィンドウのレイアウト崩れを検出しました。${OUT_DIR} のスクリーンショットを確認してください。`);
  process.exit(1);
}
console.log("\nすべての幅・倍率・modeで本文が残り、縦積み・不要な横スクロールはありません。");
