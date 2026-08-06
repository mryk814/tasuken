/**
 * 狭幅レスポンシブ監査（#300）
 *
 * package版と同じビルド成果物をElectronで起動し、主要画面を幅・表示倍率ごとに走査する。
 * 「見た目が崩れていない」を目視だけに頼らず、テキストの行ボックスを実測して
 * 「日本語ラベルが一文字ずつ縦積みになっていないか」と「画面全体の横スクロールがないか」を判定する。
 *
 *   npm run build && npm run audit:responsive
 *
 * 崩れを検出した画面はスクリーンショットを出力し、終了コード1で終わる。
 * 実データを読むため、結果は利用者のワークスペース内容に依存する。
 */
import { _electron as electron } from "playwright";
import { mkdirSync } from "node:fs";

const OUT_DIR = process.argv[2] || "audit-shots";
const WIDTHS = [980, 1120, 1440];
const ZOOMS = [1, 1.3];
const ROUTES = ["Today", "Inbox", "Timeline", "Notes", "Knowledge", "Sketch", "Chat Refs", "Artifacts", "Settings"];
const ZOOM_STORAGE_KEY = "tasken:shell:zoom-factor:v1";

/** ページ内で実行する検出器。行ボックスを実測して縦積みだけを拾う。 */
function detectLayoutBreakage() {
  const stacked = [];
  const seen = new Set();
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  let node = walker.nextNode();
  while (node) {
    const text = (node.textContent || "").trim();
    const element = node.parentElement;
    if (text.length >= 2 && element && !seen.has(element)) {
      const style = getComputedStyle(element);
      if (style.visibility !== "hidden" && style.display !== "none") {
        const range = document.createRange();
        range.selectNodeContents(node);
        const rects = [...range.getClientRects()].filter((rect) => rect.width > 0 && rect.height > 0);
        if (rects.length >= 2) {
          const fontSize = parseFloat(style.fontSize) || 14;
          const widest = Math.max(...rects.map((rect) => rect.width));
          // 最も広い行でも2文字ぶんに満たない = 一文字ずつ縦に折り返している
          if (widest < fontSize * 2.2) {
            seen.add(element);
            stacked.push({
              text: text.slice(0, 24),
              lines: rects.length,
              widest: Math.round(widest),
              fontSize: Math.round(fontSize),
              selector: `${element.tagName.toLowerCase()}.${(element.className?.toString?.() || "").slice(0, 60)}`,
            });
          }
        }
      }
    }
    node = walker.nextNode();
  }
  const doc = document.scrollingElement;
  return { stacked, horizontalScroll: doc.scrollWidth > doc.clientWidth + 1 };
}

mkdirSync(OUT_DIR, { recursive: true });

const app = await electron.launch({ args: [".", "--disable-gpu", "--disable-gpu-compositing"] });
const page = await app.firstWindow();
await page.waitForLoadState("domcontentloaded");
await page.waitForTimeout(4000);

let failures = 0;

for (const zoom of ZOOMS) {
  await page.evaluate(([key, value]) => window.localStorage.setItem(key, JSON.stringify(value)), [ZOOM_STORAGE_KEY, zoom]);
  await page.reload();
  await page.waitForLoadState("domcontentloaded");
  await page.waitForTimeout(3500);

  for (const width of WIDTHS) {
    await app.evaluate(({ BrowserWindow }, size) => BrowserWindow.getAllWindows()[0].setSize(size, 780), width);
    await page.waitForTimeout(700);

    for (const route of ROUTES) {
      const navButton = page.locator(".sidebar button", { hasText: route }).first();
      if (!(await navButton.count())) continue;
      await navButton.click();
      await page.waitForTimeout(900);

      const result = await page.evaluate(detectLayoutBreakage);
      const label = `幅${width} 倍率${zoom} ${route}`;
      if (!result.stacked.length && !result.horizontalScroll) {
        console.log(`ok   ${label}`);
        continue;
      }
      failures += 1;
      console.log(`NG   ${label}: 横スクロール=${result.horizontalScroll} 縦積み=${result.stacked.length}`);
      for (const item of result.stacked) {
        console.log(`       "${item.text}" ${item.lines}行 最大幅${item.widest}px / 文字${item.fontSize}px  ${item.selector}`);
      }
      await page.screenshot({ path: `${OUT_DIR}/${width}-x${zoom}-${route.replace(/\W+/g, "")}.png` });
    }
  }
}

await app.close();

if (failures) {
  console.error(`\n${failures}件の画面でレイアウト崩れを検出しました。${OUT_DIR} のスクリーンショットを確認してください。`);
  process.exit(1);
}
console.log("\nすべての画面で縦積み・不要な横スクロールはありません。");
