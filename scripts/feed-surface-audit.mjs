/**
 * Feed surface の目視・レイアウト監査（#604前半 / #604後半）
 *
 * 隔離した一時userDataでビルド済みアプリを起動し、Feedを広幅と最小幅で確認する。
 * 「スクリーンショットを撮った」だけで終わらせず、行の描画・横スクロール・
 * 詳細スロットの出方・focusの戻り先を実測して判定する。
 *
 * #604後半では**実データ**を表示するため、起動前に隔離workspaceを用意する
 * （`scripts/seed-feed-audit-workspace.mjs`）。行がfixtureではなく
 * Desktopと同じ導出から出ていることを、件数と見送りの挙動で確かめる。
 *
 *   npm run build && npm run audit:feed
 *
 * 出力先は output/playwright/feed-audit。失敗時は終了コード1。
 */
import { _electron as electron } from "playwright";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { spawnSync } from "node:child_process";
import os from "node:os";
import path from "node:path";

const OUT_DIR = process.argv[2] || "output/playwright/feed-audit";
/** 実効幅1680px超で右詳細を常設し、それ以下では重ねる（docs/responsive-layout.md）。 */
const SIZES = [
  { label: "wide-1536", width: 1536, height: 960 },
  { label: "mid-1280", width: 1280, height: 800 },
  { label: "min-980", width: 980, height: 680 },
];
const ZOOM_STORAGE_KEY = "tasken:shell:zoom-factor:v1";
/** 隔離workspaceに入れる判断の数（質問1・成果確認1・変更案1）。 */
const EXPECTED_UNRESOLVED = 3;

function detectLayoutBreakage() {
  const overflowing = [];
  for (const element of document.querySelectorAll(".main-area, .main-area *")) {
    const style = getComputedStyle(element);
    if (style.display === "none" || style.visibility === "hidden") continue;
    if (element.scrollWidth > element.clientWidth + 1 && element.clientWidth > 0) {
      overflowing.push({
        selector: `${element.tagName.toLowerCase()}.${(element.className?.toString?.() || "").slice(0, 60)}`,
        scrollWidth: element.scrollWidth,
        clientWidth: element.clientWidth,
      });
    }
  }
  const stacked = [];
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  let node = walker.nextNode();
  while (node) {
    const text = (node.textContent || "").trim();
    const element = node.parentElement;
    if (text.length >= 2 && element) {
      const style = getComputedStyle(element);
      if (style.visibility !== "hidden" && style.display !== "none") {
        const range = document.createRange();
        range.selectNodeContents(node);
        const rects = [...range.getClientRects()].filter(
          (rect) => rect.width > 0 && rect.height > 0,
        );
        const fontSize = parseFloat(style.fontSize) || 14;
        if (rects.length >= 2 && Math.max(...rects.map((rect) => rect.width)) < fontSize * 2.2) {
          stacked.push({ text: text.slice(0, 24), selector: element.tagName.toLowerCase() });
        }
      }
    }
    node = walker.nextNode();
  }
  return {
    overflowing,
    stacked,
    documentScrolls: document.documentElement.scrollWidth > window.innerWidth + 1,
  };
}

mkdirSync(OUT_DIR, { recursive: true });
const userDataDir = mkdtempSync(path.join(os.tmpdir(), "tasken-feed-audit-"));
const seeded = spawnSync(
  process.execPath,
  ["scripts/run-electron-node.mjs", "scripts/seed-feed-audit-workspace.mjs", userDataDir],
  { encoding: "utf8" },
);
if (seeded.status !== 0) {
  throw new Error(`Feed監査のworkspaceを用意できませんでした: ${seeded.stderr || seeded.stdout}`);
}
const failures = [];

const app = await electron.launch({
  args: [".", "--disable-gpu", "--disable-gpu-compositing", `--user-data-dir=${userDataDir}`],
  env: { ...process.env, TASKEN_USER_DATA_DIR: userDataDir },
});
try {
  const page = await app.firstWindow();
  await page.waitForLoadState("domcontentloaded");
  await page.evaluate(
    ([key, value]) => window.localStorage.setItem(key, JSON.stringify(value)),
    [ZOOM_STORAGE_KEY, 1],
  );
  await page.reload();
  await page.waitForLoadState("domcontentloaded");
  await page.waitForTimeout(3000);

  const navButton = page.locator(".sidebar button", { hasText: "Feed" }).first();
  if (!(await navButton.count())) {
    throw new Error("SidebarにFeedの入口がありません。");
  }
  await navButton.click();
  await page.waitForTimeout(1200);

  const rowCount = await page.locator(".feed-row").count();
  if (rowCount < 4) failures.push(`行が4件未満です（${rowCount}件）。`);
  // 実データのAI変更案だけが生成ラベルを持つ。
  const generatedLabels = await page.locator(".feed-generated").count();
  if (generatedLabels < 1) failures.push("AI生成の文字ラベルが表示されていません。");
  // 要対応の件数はDesktopと同じ導出から来る（隔離workspaceの判断3件）。
  const unresolvedText = (await page.locator(".feed-tab-count").first().innerText()).trim();
  if (unresolvedText !== String(EXPECTED_UNRESOLVED)) {
    failures.push(`要対応の件数が${EXPECTED_UNRESOLVED}件ではありません（${unresolvedText}）。`);
  }

  for (const size of SIZES) {
    await app.evaluate(
      ({ BrowserWindow }, value) =>
        BrowserWindow.getAllWindows()[0].setSize(value.width, value.height),
      size,
    );
    await page.waitForTimeout(700);
    await page.evaluate(() => window.scrollTo(0, 0));

    const layout = await page.evaluate(detectLayoutBreakage);
    if (layout.documentScrolls) failures.push(`${size.label}: 画面全体に横スクロールがあります。`);
    if (layout.overflowing.length) {
      failures.push(
        `${size.label}: 横あふれ ${layout.overflowing
          .map((item) => `${item.selector}(${item.scrollWidth}>${item.clientWidth})`)
          .join(", ")}`,
      );
    }
    if (layout.stacked.length) {
      failures.push(`${size.label}: 縦積み ${layout.stacked.map((item) => item.text).join(" / ")}`);
    }

    // 未選択時の右側は静かな空間にする。狭幅では常設せず、選んだときだけ重ねる。
    const twoColumn = await page.evaluate(() => {
      const layout = document.querySelector(".feed-layout");
      if (!layout) return false;
      return getComputedStyle(layout).gridTemplateColumns.trim().split(/\s+/).length > 1;
    });
    const emptyVisible = await page.locator(".feed-detail.is-empty").isVisible();
    if (twoColumn && !emptyVisible) {
      failures.push(`${size.label}: 広幅で未選択の静かな領域がありません。`);
    }
    if (!twoColumn && emptyVisible) {
      failures.push(`${size.label}: 狭幅で詳細が常設されています。`);
    }
    await page.screenshot({ path: `${OUT_DIR}/${size.label}-list.png` });

    // 行を選ぶと詳細が開き、Escapeで閉じて起点へfocusが戻る。
    const firstRow = page.locator(".feed-row-open").first();
    await firstRow.click();
    await page.waitForTimeout(400);
    if (!(await page.locator(".feed-detail:not(.is-empty)").isVisible())) {
      failures.push(`${size.label}: 行を選んでも詳細が開きません。`);
    }
    await page.screenshot({ path: `${OUT_DIR}/${size.label}-detail.png` });

    await page.keyboard.press("Escape");
    await page.waitForTimeout(400);
    if (await page.locator(".feed-detail:not(.is-empty)").isVisible()) {
      failures.push(`${size.label}: Escapeで詳細が閉じません。`);
    }
    const focusOnRow = await page.evaluate(() =>
      Boolean(document.activeElement?.classList?.contains("feed-row-open")),
    );
    if (!focusOnRow) failures.push(`${size.label}: 閉じた後に起点の行へfocusが戻りません。`);
  }

  // 「後で見る」は未解決件数を減らさない。実データの質問行で確かめる。
  const before = await page.locator(".feed-tabs button", { hasText: "対応待ち" }).innerText();
  await page
    .locator(".feed-row", { hasText: "測定温度が決まっていません" })
    .locator("button", { hasText: "後で見る" })
    .first()
    .click();
  await page.waitForTimeout(400);
  const after = await page.locator(".feed-tabs button", { hasText: "対応待ち" }).innerText();
  if (before.replace(/\s+/g, "") !== after.replace(/\s+/g, "")) {
    failures.push(`後で見るで要対応件数が変わりました（${before} → ${after}）。`);
  }
  // 行は消えても、未解決の判断は残っている。
  const stillCounted = (await page.locator(".feed-tab-count").first().innerText()).trim();
  if (stillCounted !== String(EXPECTED_UNRESOLVED)) {
    failures.push(
      `後で見るの後に要対応件数が${EXPECTED_UNRESOLVED}件ではありません（${stillCounted}）。`,
    );
  }

  await page.screenshot({ path: `${OUT_DIR}/after-defer.png`, fullPage: true });
} finally {
  await app.close();
  rmSync(userDataDir, { recursive: true, force: true });
}

if (failures.length) {
  console.error(`Feed監査で${failures.length}件の問題を検出しました。`);
  for (const failure of failures) console.error(`  NG ${failure}`);
  console.error(`スクリーンショット: ${OUT_DIR}`);
  process.exit(1);
}
console.log(`Feed監査: OK（${SIZES.length}幅、スクリーンショットは ${OUT_DIR}）`);
