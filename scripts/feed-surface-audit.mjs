/**
 * Feed surface の目視・レイアウト監査（SNS型Feed 第1段階）
 *
 * 隔離した一時userDataでビルド済みアプリを起動し、SNS型の読む面を広幅と最小幅で確認する。
 * 「スクリーンショットを撮った」だけで終わらせず、投稿の描画・アバター・本文の大きさ・
 * 記事を開いて戻る操作・focusの戻り先・対応待ち件数（実データ）を実測して判定する。
 *
 * 投稿は開発用fixture（架空データ）。対応待ちタブだけは実データなので、
 * 起動前に隔離workspaceを用意する（`scripts/seed-feed-audit-workspace.mjs`）。
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
/** 投稿の本文は読み物として16px以上にする。 */
const MIN_BODY_FONT_PX = 16;
const MIN_POSTS = 12;

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

  // 1. ホームは投稿が連続して読める。アバターと出所、本文の大きさを実測する。
  const postCount = await page.locator(".feed-post").count();
  if (postCount < MIN_POSTS) failures.push(`投稿が${MIN_POSTS}件未満です（${postCount}件）。`);
  const avatars = await page.locator(".feed-avatar").count();
  if (avatars < postCount)
    failures.push(`アバターが全投稿にありません（${avatars}/${postCount}）。`);
  const bodyFont = await page.evaluate(() => {
    const element = document.querySelector(".feed-post-text");
    return element ? parseFloat(getComputedStyle(element).fontSize) : 0;
  });
  if (!(bodyFont >= MIN_BODY_FONT_PX)) {
    failures.push(`本文が${MIN_BODY_FONT_PX}px未満です（${bodyFont}px）。`);
  }
  // 実装説明を読む面へ出さない。
  const implementationCopy = await page
    .locator(".feed-timeline", { hasText: "実データを表示" })
    .count();
  if (implementationCopy) failures.push("読む面に実装説明の文言が残っています。");
  // 反応欄がある。
  const reactions = await page.locator(".feed-reaction").count();
  if (reactions < postCount) failures.push(`反応欄が足りません（${reactions}）。`);
  // 添付（記事・引用・Task）がある。
  const attachments = await page.locator(".feed-attachment").count();
  if (attachments < 3) failures.push(`添付が${attachments}件しかありません。`);
  // 前回の閲覧位置が示されている。
  if (!(await page.locator(".feed-reading-edge").count())) {
    failures.push("前回の閲覧位置が表示されていません。");
  }
  // 末尾は仕事の完了と混同しない文言にする。
  const endText = (await page.locator(".feed-end").first().innerText()).trim();
  if (!endText.includes("ここまでの投稿を表示しました")) {
    failures.push(`末尾の文言が違います（${endText}）。`);
  }
  await page.screenshot({ path: `${OUT_DIR}/home.png`, fullPage: true });

  // 2. 長い投稿はもっと読むで展開し、固定高で切らない。
  const collapsibleHandle = await page
    .locator(".feed-post", { has: page.locator(".feed-more-text") })
    .first()
    .elementHandle();
  if (!collapsibleHandle) {
    failures.push("もっと読むが1件も出ていません。");
  } else {
    // 展開するとボタンが消えるため、同じ投稿のelementを掴んだまま段落数を数える。
    const before = await collapsibleHandle.$$eval(".feed-post-text", (nodes) => nodes.length);
    await collapsibleHandle.$eval(".feed-more-text", (node) => node.click());
    await page.waitForTimeout(300);
    const after = await collapsibleHandle.$$eval(".feed-post-text", (nodes) => nodes.length);
    if (!(after > before)) failures.push("もっと読むで段落が増えていません。");
    await page.screenshot({ path: `${OUT_DIR}/expanded.png`, fullPage: true });
  }

  // 3. 記事を開いて戻ると、起点の投稿へfocusが戻る。
  const readButton = page.locator(".feed-attachment button", { hasText: "記事を読む" }).first();
  if (!(await readButton.count())) {
    failures.push("記事を読む操作がありません。");
  } else {
    await readButton.click();
    await page.waitForTimeout(400);
    const readerVisible = await page.locator(".feed-reader").isVisible();
    if (!readerVisible) failures.push("記事の読書面が開きません。");
    const readerParagraphs = await page.locator(".feed-reader-text").count();
    if (readerParagraphs < 3) failures.push(`記事の本文が短すぎます（${readerParagraphs}段落）。`);
    await page.screenshot({ path: `${OUT_DIR}/reader.png` });
    await page.locator(".feed-reader button", { hasText: "戻る" }).first().click();
    await page.waitForTimeout(500);
    if (await page.locator(".feed-reader").count()) failures.push("記事を閉じられません。");
  }

  // 4. 新着は押すまで一覧へ割り込まない。
  const arrivals = page.locator(".feed-new-arrivals");
  if (!(await arrivals.count())) {
    failures.push("新着の保留表示がありません。");
  } else {
    const beforeCount = await page.locator(".feed-post").count();
    await arrivals.click();
    await page.waitForTimeout(400);
    const afterCount = await page.locator(".feed-post").count();
    if (!(afterCount > beforeCount)) {
      failures.push(`新しい投稿を反映しても件数が増えません（${beforeCount} → ${afterCount}）。`);
    }
  }

  // 5. 学びタブは読む投稿へ絞る。
  await page.locator(".feed-tabs button", { hasText: "学び" }).first().click();
  await page.waitForTimeout(500);
  const learnCount = await page.locator(".feed-post").count();
  if (!(learnCount > 0 && learnCount < postCount + 2)) {
    failures.push(`学びタブの件数が不自然です（${learnCount}）。`);
  }
  await page.screenshot({ path: `${OUT_DIR}/learn.png`, fullPage: true });

  // 6. 対応待ちは実データ（隔離workspaceの判断3件）。
  await page.locator(".feed-tabs button", { hasText: "対応待ち" }).first().click();
  await page.waitForTimeout(600);
  const unresolvedText = (await page.locator(".feed-tab-count").first().innerText()).trim();
  if (unresolvedText !== String(EXPECTED_UNRESOLVED)) {
    failures.push(`対応待ちの件数が${EXPECTED_UNRESOLVED}件ではありません（${unresolvedText}）。`);
  }
  const needsRows = await page.locator(".feed-needs-row").count();
  if (needsRows !== EXPECTED_UNRESOLVED) {
    failures.push(`対応待ちの行数が${EXPECTED_UNRESOLVED}件ではありません（${needsRows}）。`);
  }
  await page.screenshot({ path: `${OUT_DIR}/needs.png`, fullPage: true });

  // 7. 幅ごとの崩れ。投稿面は1列のまま、横スクロールを出さない。
  for (const size of SIZES) {
    await app.evaluate(
      ({ BrowserWindow }, value) =>
        BrowserWindow.getAllWindows()[0].setSize(value.width, value.height),
      size,
    );
    await page.waitForTimeout(700);
    await page.locator(".feed-tabs button", { hasText: "ホーム" }).first().click();
    await page.waitForTimeout(300);
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
    await page.screenshot({ path: `${OUT_DIR}/${size.label}-home.png`, fullPage: true });

    // 狭幅でも記事を読める。
    const narrowRead = page.locator(".feed-attachment button", { hasText: "記事を読む" }).first();
    await narrowRead.click();
    await page.waitForTimeout(400);
    if (!(await page.locator(".feed-reader").isVisible())) {
      failures.push(`${size.label}: 記事を開けません。`);
    }
    await page.screenshot({ path: `${OUT_DIR}/${size.label}-reader.png` });
    await page.locator(".feed-reader button", { hasText: "戻る" }).first().click();
    await page.waitForTimeout(300);
  }

  // 8. ブックマークは未解決件数を変えない。
  await page.locator(".feed-reaction", { hasText: "ブックマーク" }).first().click();
  await page.waitForTimeout(300);
  const afterBookmark = (await page.locator(".feed-tab-count").first().innerText()).trim();
  if (afterBookmark !== String(EXPECTED_UNRESOLVED)) {
    failures.push(`ブックマークで対応待ち件数が変わりました（${afterBookmark}）。`);
  }
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
console.log(`Feed監査: OK（SNS面 ${SIZES.length}幅、スクリーンショットは ${OUT_DIR}）`);
