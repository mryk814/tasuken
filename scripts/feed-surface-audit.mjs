/**
 * Feed surface の目視・レイアウト監査（SNS型Feed 第1・2段階）
 *
 * 隔離した一時userDataでビルド済みアプリを起動し、SNS型の読む面を広幅と最小幅で確認する。
 * 「スクリーンショットを撮った」だけで終わらせず、投稿の描画・アバター・本文の大きさ・
 * 記事を開いて戻る操作・focusの戻り先・対応待ち件数（実データ）を実測して判定する。
 *
 *   npm run build && npm run audit:feed           # 開発用fixture（架空データ）で面の設計を確認
 *   npm run build && npm run audit:feed:live      # AIから届いた実データの投稿を読めるか確認
 *   npm run build && npm run audit:feed:bulk      # 100件以上の履歴を20件単位で読み進められるか確認
 *
 * `--live` では隔離workspaceへ実データの投稿を1件入れ、その投稿だけを読む。
 * 対応待ち（実データ）の件数が読む操作で変わらないこと、ブックマークが**再起動後**も
 * 残ることを実測する。fixtureは実データが無いときだけの開発用なので、
 * 投稿があるときの面にはfixtureを混ぜない。
 * `--bulk` では読み物の投稿を120件入れ、連続読込と読んでいる位置の保持を実測する。
 *
 * 出力先は output/playwright/feed-audit（`--live` は feed-audit-live、`--bulk` は feed-audit-bulk）。
 * 失敗時は終了コード1。
 */
import { _electron as electron } from "playwright";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { spawnSync } from "node:child_process";
import os from "node:os";
import path from "node:path";

const args = process.argv.slice(2);
const LIVE = args.includes("--live");
const BULK = args.includes("--bulk");
const NOTE_REF = args.includes("--note-ref");
const MEDIA = args.includes("--media");
/** 何も無いworkspaceでゼロ状態（0件の面と次の行動）を実測する。 */
const EMPTY = args.includes("--empty");
const OUT_DIR =
  args.find((arg) => !arg.startsWith("--")) ||
  (LIVE
    ? "output/playwright/feed-audit-live"
    : BULK
      ? "output/playwright/feed-audit-bulk"
      : NOTE_REF
        ? "output/playwright/feed-audit-note"
        : MEDIA
          ? "output/playwright/feed-audit-media"
          : EMPTY
            ? "output/playwright/feed-audit-empty"
            : "output/playwright/feed-audit");
/** 実効幅1680px超で右詳細を常設し、それ以下では重ねる（docs/responsive-layout.md）。 */
const SIZES = [
  { label: "wide-1536", width: 1536, height: 960 },
  { label: "mid-1280", width: 1280, height: 800 },
  { label: "min-980", width: 980, height: 680 },
];
const ZOOM_STORAGE_KEY = "tasken:shell:zoom-factor:v1";
/** 隔離workspaceに入れる判断の数（質問1・成果確認1・変更案1）。変更案は一覧行ではなく「提案の確認」パネルに出る。 */
const EXPECTED_UNRESOLVED = 3;
const EXPECTED_NEEDS_ROWS = 2;
/** 投稿の本文は読み物として16px以上にする。 */
const MIN_BODY_FONT_PX = 16;
const MIN_POSTS = 12;
/** 実データ投稿（`--feed-post`で用意する1件）の識別情報。 */
const LIVE_ARTICLE_TITLE = "「もう一度保存」に耐える設計";
const LIVE_FIGURE_LABEL = "図: 再送の流れ";
/** 実データ投稿へ残す返信（第3段階）。 */
const LIVE_REPLY_BODY = "サンプル数が少ないときも同じ見方でよい？";
/** 実データ投稿へ残すAIへの質問（第3段階）。 */
const LIVE_QUESTION_BODY = "この条件は25℃の比較にも同じように使えますか。";
/** 自分の投稿欄から載せるメモ（第3段階）。 */
const LIVE_OWN_POST_BODY = "条件を先に決めると、測り直しが減る。";
/** 隔離workspaceへ用意する質問とAIの返答（第3段階）。 */
const LIVE_SEEDED_QUESTION = "この条件は40℃の比較にも同じように使えますか。";
const LIVE_SEEDED_ANSWER = "40℃では裾が広がるため、平均ではなく幅だけで比べてください。";
/** 外部AIクリップボード往復の架空回答（外部送信なし、handoff §8-1/2）。 */
const LIVE_MANUAL_QUESTION = "外部AIへのコピー質問：ばらつきの判断材料は。";
const LIVE_MANUAL_ANSWER = "架空回答：3回以下のときは幅だけを見てください。";
const LIVE_MANUAL_SOURCE = "M365 Copilot";
const LIVE_MANUAL_COMMENT = "架空の一言：次も同じ表で見たい。";
/** 連続読込の実測（`--bulk`）で入れる投稿の件数と、1回の読み込み件数。 */
const BULK_POSTS = 120;
const FEED_PAGE_SIZE = 20;

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
// `--empty` は正本を一切用意しない。アプリが作る空のworkspaceでゼロ状態を実測する。
if (EMPTY) {
  mkdirSync(userDataDir, { recursive: true });
} else {
  const seeded = spawnSync(
    process.execPath,
    [
      "scripts/run-electron-node.mjs",
      "scripts/seed-feed-audit-workspace.mjs",
      userDataDir,
      ...(LIVE ? ["--feed-post"] : []),
      ...(MEDIA ? ["--feed-media"] : []),
      ...(BULK ? ["--bulk-posts", String(BULK_POSTS)] : []),
      ...(NOTE_REF ? ["--note-ref"] : []),
    ],
    { encoding: "utf8" },
  );
  if (seeded.status !== 0) {
    throw new Error(`Feed監査のworkspaceを用意できませんでした: ${seeded.stderr || seeded.stdout}`);
  }
}
const failures = [];

/** 検証用userDataでアプリを起動し、表示倍率を固定してから読み込み直す。 */
async function launchApp() {
  const app = await electron.launch({
    args: [".", "--disable-gpu", "--disable-gpu-compositing", `--user-data-dir=${userDataDir}`],
    env: { ...process.env, TASKEN_USER_DATA_DIR: userDataDir },
  });
  const page = await app.firstWindow();
  await page.waitForLoadState("domcontentloaded");
  await page.evaluate(
    ([key, value]) => window.localStorage.setItem(key, JSON.stringify(value)),
    [ZOOM_STORAGE_KEY, 1],
  );
  await page.reload();
  await page.waitForLoadState("domcontentloaded");
  await page.waitForTimeout(3000);
  return { app, page };
}

async function openFeed(page) {
  const navButton = page.locator(".sidebar button", { hasText: "Feed" }).first();
  if (!(await navButton.count())) {
    throw new Error("SidebarにFeedの入口がありません。");
  }
  await navButton.click();
  await page.waitForTimeout(1200);
}

/** 第1段階の面（開発用fixture）を確認する。 */
async function auditFixtures(app, page) {
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
  // 投稿IDをアンカーにした閲覧位置復元の対象がある。
  if (!(await page.locator(".feed-timeline .feed-post").count())) {
    failures.push("閲覧位置を復元できる投稿アンカーがありません。");
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
    const readerParagraphs = await page
      .locator(".feed-reader-markdown .markdown-preview-content p, .feed-reader-text")
      .count();
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

  // 6. 対応待ちは実データ（隔離workspaceの判断3件）。変更案は一覧行ではなく「提案の確認」に出る。
  await page.locator(".feed-tabs button", { hasText: "対応待ち" }).first().click();
  await page.waitForTimeout(600);
  const unresolvedText = (await page.locator(".feed-tab-count").first().innerText()).trim();
  if (unresolvedText !== String(EXPECTED_UNRESOLVED)) {
    failures.push(`対応待ちの件数が${EXPECTED_UNRESOLVED}件ではありません（${unresolvedText}）。`);
  }
  const needsRows = await page.locator(".feed-needs-row").count();
  if (needsRows !== EXPECTED_NEEDS_ROWS) {
    failures.push(`対応待ちの行数が${EXPECTED_NEEDS_ROWS}件ではありません（${needsRows}）。`);
  }
  const proposalPanelText = await page.locator(".proposal-inbox-panel").first().innerText();
  if (!proposalPanelText.includes("測定手順のNoteを作る案")) {
    failures.push("対応待ちの「提案の確認」に変更案が出ていません。");
  }
  await page.screenshot({ path: `${OUT_DIR}/needs.png`, fullPage: true });

  /*
   * 6b. 右レール（Agent Desk集約）。
   * 判断とAIの動きを面移動なしで見られること、変更案が「提案の確認」の選択へ入ること、
   * 読み面を圧迫する幅では畳まれることを実測する（design-guide §21の1スロット）。
   */
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1536, 960));
  await page.waitForTimeout(700);
  const rail = page.locator(".feed-rail");
  if (!(await rail.isVisible())) {
    failures.push("広い幅（1536）でFeedの右レールが出ていません。");
  } else {
    const railText = (await rail.innerText()).replace(/\s+/g, " ");
    if (!railText.includes("対応キュー")) failures.push("右レールに「対応キュー」がありません。");
    if (!railText.includes("AI活動")) failures.push("右レールに「AI活動」がありません。");
    const railProposal = rail.locator(".context-row", { hasText: "Noteの変更案" }).first();
    if (!(await railProposal.count())) {
      failures.push("右レールの対応キューに変更案が出ていません。");
    } else {
      await railProposal.click();
      await page.waitForTimeout(500);
      const openedInPanel = await page
        .locator('.proposal-inbox-panel .proposal-row-select[aria-pressed="true"]')
        .count();
      if (!openedInPanel) {
        failures.push("右レールから変更案を開いても、「提案の確認」で選択されません。");
      }
    }
    await page.screenshot({ path: `${OUT_DIR}/rail-1536.png`, fullPage: true });
  }
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1280, 800));
  await page.waitForTimeout(700);
  if (await page.locator(".feed-rail").isVisible()) {
    failures.push("狭い幅（1280）でFeedの右レールが残っています（読み面を圧迫します）。");
  }

  /*
   * 6c. 右側の補助領域は1スロット（design-guide §21）。
   * 会話（Thread）を開いたらレールを譲り、読み面とスレッドの2列に戻る。
   */
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1536, 960));
  await page.waitForTimeout(700);
  await page.locator(".feed-tabs button", { hasText: "ホーム" }).first().click();
  await page.waitForTimeout(500);
  const threadSource = page.locator(".feed-post").first();
  const threadButton = threadSource.locator('button[aria-label^="返信"]').first();
  if (!(await threadButton.count())) {
    failures.push("会話を開く返信操作が投稿にありません。");
  } else {
    await threadButton.click();
    await page.waitForTimeout(600);
    if (!(await page.locator(".feed-thread-panel").isVisible())) {
      failures.push("返信を押しても会話（右スレッド）が開きません。");
    }
    if (await page.locator(".feed-rail").isVisible()) {
      failures.push("会話を開いても右レールが残っています（右側の補助領域が2枚重なっています）。");
    }
    const threadLayout = await page.evaluate(() => {
      const main = document.querySelector(".feed-main");
      const thread = document.querySelector(".feed-thread-panel");
      return {
        main: main ? Math.round(main.getBoundingClientRect().width) : 0,
        thread: thread ? Math.round(thread.getBoundingClientRect().width) : 0,
        scrolls: document.documentElement.scrollWidth > window.innerWidth + 1,
      };
    });
    if (threadLayout.scrolls) {
      failures.push("会話を開いたときに画面全体へ横スクロールが出ています。");
    }
    if (threadLayout.main < 320 || threadLayout.thread < 320) {
      failures.push(
        `会話を開いたときの列幅が足りません（読み面${threadLayout.main} / スレッド${threadLayout.thread}）。`,
      );
    }
    await page.screenshot({ path: `${OUT_DIR}/rail-thread-1536.png`, fullPage: true });
    await page.locator(".feed-thread-panel button", { hasText: "閉じる" }).first().click();
    await page.waitForTimeout(500);
    if (!(await page.locator(".feed-rail").isVisible())) {
      failures.push("会話を閉じても右レールが戻りません。");
    }
  }

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
  const bookmarkTarget = page.locator(".feed-post").first();
  const bookmarkedText = (
    await bookmarkTarget.locator(".feed-post-text").first().innerText()
  ).trim();
  await bookmarkTarget.locator('button[aria-label^="ブックマーク"]').first().click();
  await page.waitForTimeout(300);
  const afterBookmark = (await page.locator(".feed-tab-count").first().innerText()).trim();
  if (afterBookmark !== String(EXPECTED_UNRESOLVED)) {
    failures.push(`ブックマークで対応待ち件数が変わりました（${afterBookmark}）。`);
  }

  // 8b. ブックマーク面で保存した投稿だけを読み返せる。
  const bookmarksTab = page.locator(".feed-tabs button", { hasText: "ブックマーク" }).first();
  if (!(await bookmarksTab.count())) {
    failures.push("ブックマークの入口がありません。");
  } else {
    await bookmarksTab.click();
    await page.waitForTimeout(400);
    const savedFilter = page
      .locator('.feed-bookmark-filters button[aria-label="ブックマーク"]')
      .first();
    if (!(await savedFilter.count())) failures.push("ブックマークの絞り込みがありません。");
    const savedPosts = await page.locator(".feed-post").count();
    if (savedPosts !== 1) {
      failures.push(`保存済みの件数が1件ではありません（${savedPosts}件）。`);
    } else {
      const savedText = (
        await page.locator(".feed-post .feed-post-text").first().innerText()
      ).trim();
      if (savedText !== bookmarkedText) {
        failures.push("保存済みに出ている投稿が、ブックマークした投稿と違います。");
      }
    }
    if (
      (await page.locator(".feed-tab-count").first().innerText()).trim() !==
      String(EXPECTED_UNRESOLVED)
    ) {
      failures.push("保存済みの絞り込みで対応待ち件数が変わりました。");
    }
    await page.screenshot({ path: `${OUT_DIR}/saved.png`, fullPage: true });
    await page.locator(".feed-tabs button", { hasText: "ホーム" }).first().click();
    await page.waitForTimeout(300);
    if (!((await page.locator(".feed-post").count()) > 1)) {
      failures.push("ブックマーク面からホームへ戻れません。");
    }
  }

  // 8c. 「既知だった」は補助メニューから記録し、対応待ち件数を変えない。
  const menu = page.locator(".feed-post-more-menu").first();
  if (!(await menu.count())) {
    failures.push("投稿の補助メニューがありません。");
  } else {
    await menu.locator("summary").first().click();
    await page.waitForTimeout(200);
    const known = menu.locator("button", { hasText: "既知だった" }).first();
    if (!(await known.count())) {
      failures.push("補助メニューに「既知だった」がありません。");
    } else {
      await known.click();
      await page.waitForTimeout(400);
      const afterKnown = (await page.locator(".feed-tab-count").first().innerText()).trim();
      if (afterKnown !== String(EXPECTED_UNRESOLVED)) {
        failures.push(`「既知だった」で対応待ち件数が変わりました（${afterKnown}）。`);
      }
      const noticeLine = await page.locator(".feed-notice-line").first().innerText();
      if (!noticeLine.includes("既知だった")) {
        failures.push(`「既知だった」の案内が出ていません（${noticeLine}）。`);
      }
    }
  }

  // 9. 返信の下書きは投稿ごとに残り、スレッドを閉じても消えない。
  const replyTarget = page.locator(".feed-post").first();
  await replyTarget.locator('button[aria-label^="返信"]').first().click();
  await page.waitForTimeout(300);
  const draftText = "サンプル数を増やして同じ見方で比べたい";
  const threadDraft = page.locator(".feed-thread-panel .feed-reply textarea").first();
  await threadDraft.fill(draftText);
  await page.locator(".feed-thread-panel .feed-thread-head button").first().click();
  await page.waitForTimeout(300);
  if (await page.locator(".feed-thread-panel").count()) {
    failures.push("会話パネルを閉じられません。");
  }
  await replyTarget.locator('button[aria-label^="返信"]').first().click();
  await page.waitForTimeout(300);
  const restoredDraft = await page.locator(".feed-thread-panel .feed-reply textarea").inputValue();
  if (restoredDraft !== draftText) {
    failures.push(`返信の下書きが復元されません（${restoredDraft}）。`);
  }

  // 10. Feedを離れて戻っても、選択スレッド・返信下書き・表示位置の状態を戻せる。
  const notesNav = page.locator(".sidebar button", { hasText: "Notes" }).first();
  if (!(await notesNav.count())) {
    failures.push("FeedからNotesへ移動する導線がありません。");
  } else {
    await notesNav.click();
    await page.waitForTimeout(900);
    await openFeed(page);
    const restoredPanel = page.locator(".feed-thread-panel").first();
    if (!(await restoredPanel.count())) {
      failures.push("Feedへ戻っても選択中の会話が復元されません。");
    } else {
      const routeDraft = await restoredPanel.locator(".feed-reply textarea").inputValue();
      if (routeDraft !== draftText) {
        failures.push(`Feedへ戻った後に返信下書きが復元されません（${routeDraft}）。`);
      }
      await restoredPanel.locator(".feed-thread-head button").first().click();
    }
  }

  // 11. 暗い表示でも同じ面が読める（値の直書きが残っていれば片方だけ暗くなる）。
  await page.waitForTimeout(200);
  const viewMenu = page
    .locator(".titlebar-controls .titlebar-menu-anchor button", { hasText: "表示" })
    .first();
  if (!(await viewMenu.count())) {
    failures.push("表示メニューがありません。");
    return;
  }
  await viewMenu.click();
  await page.waitForTimeout(200);
  const darkToggle = page.locator(".titlebar-view-menu button", { hasText: "ダーク表示" }).first();
  if (!(await darkToggle.count())) {
    failures.push("暗い表示への切り替えがありません。");
    return;
  }
  await darkToggle.click();
  await page.waitForTimeout(800);
  const theme = await page.evaluate(() => document.documentElement.dataset.theme);
  if (theme !== "dark") failures.push(`暗い表示へ切り替わりません（${theme}）。`);
  const darkTone = await page.evaluate(() => {
    const luminance = (value) => {
      const match = /rgba?\(([^)]+)\)/u.exec(value || "");
      if (!match) return null;
      const parts = match[1].split(",").map((part) => Number(part.trim()));
      if (parts.length > 3 && parts[3] === 0) return null;
      return (0.2126 * parts[0] + 0.7152 * parts[1] + 0.0722 * parts[2]) / 255;
    };
    const text = document.querySelector(".feed-post-text");
    let surface = null;
    for (let node = text?.parentElement; node; node = node.parentElement) {
      surface = luminance(getComputedStyle(node).backgroundColor);
      if (surface !== null) break;
    }
    return { text: text ? luminance(getComputedStyle(text).color) : null, surface };
  });
  if (darkTone.text === null || darkTone.text < 0.5) {
    failures.push(`暗い表示で本文が明るい色になりません（${darkTone.text}）。`);
  }
  if (darkTone.surface === null || darkTone.surface > 0.3) {
    failures.push(`暗い表示で投稿の面が暗くなりません（${darkTone.surface}）。`);
  }
  for (const size of [SIZES[0], SIZES[2]]) {
    await app.evaluate(
      ({ BrowserWindow }, value) =>
        BrowserWindow.getAllWindows()[0].setSize(value.width, value.height),
      size,
    );
    await page.waitForTimeout(700);
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.screenshot({ path: `${OUT_DIR}/dark-${size.label}-home.png`, fullPage: true });
  }

  // 11. 読み上げの順序は 出所 → 本文 → 添付 → 反応。新着を自動で読み上げない。
  const readOrder = await page.evaluate(() => {
    const post = document.querySelector(".feed-post");
    if (!post) return null;
    const marks = [
      ".feed-author-name",
      ".feed-post-time",
      ".feed-post-text",
      ".feed-attachment",
      ".feed-reactions",
    ];
    const order = [];
    for (const node of post.querySelectorAll("*")) {
      const index = marks.findIndex((selector) => node.matches(selector));
      if (index >= 0 && !order.includes(index)) order.push(index);
    }
    const sorted = [...order].sort((a, b) => a - b);
    return {
      order,
      ascending: order.length > 1 && order.join(",") === sorted.join(","),
      liveRegions: document.querySelectorAll(
        ".feed-timeline [aria-live], .feed-timeline [role='status'], .feed-timeline [role='alert'], .feed-timeline [role='log']",
      ).length,
    };
  });
  if (!readOrder) {
    failures.push("読み上げ順を確かめる投稿がありません。");
  } else {
    if (!readOrder.ascending) {
      failures.push(
        `投稿の中の読み上げ順が 出所→本文→添付→反応 ではありません（${readOrder.order}）。`,
      );
    }
    if (readOrder.liveRegions > 0) {
      failures.push(`投稿の一覧に自動で読み上げる領域が${readOrder.liveRegions}件あります。`);
    }
  }

  /*
   * 12. 成果確認は報告の確認（採用・差戻し）へ入る（#599。#602の文言もここで読む）。
   * Agent DeskからFeedへ移した操作なので、実画面の一往復を確かめる。
   */
  await page.locator(".feed-tabs button", { hasText: "対応待ち" }).first().click();
  await page.waitForTimeout(600);
  const reviewRow = page
    .locator(".feed-needs-row", { hasText: "3条件の比較表を作成しました。" })
    .first();
  if (!(await reviewRow.count())) {
    failures.push("成果確認の行が対応待ちにありません。");
    return;
  }
  await reviewRow.locator("button", { hasText: "成果を確認" }).first().click();
  await page.waitForTimeout(500);
  const review = reviewRow.locator(".feed-review");
  if (!(await review.count())) {
    failures.push("「成果を確認」で報告の確認が開きません。");
    return;
  }
  const reviewLabels = await review.locator("dt").allInnerTexts();
  const expectedLabels = ["成果", "確認できたこと", "未確認事項", "Taskenへ反映する内容"];
  if (reviewLabels.join(",") !== expectedLabels.join(",")) {
    failures.push(`報告の確認の読み順が違います（${reviewLabels.join(",")}）。`);
  }
  const reviewText = (await review.innerText()).replace(/\s+/g, " ");
  for (const label of ["報告を採用", "Taskも完了する", "修正を依頼"]) {
    if (!reviewText.includes(label)) failures.push(`報告の確認に「${label}」がありません。`);
  }
  await page.screenshot({ path: `${OUT_DIR}/review-open.png`, fullPage: true });

  // 13. 報告だけを採用する。Taskは完了させない（採用と完了は別のCommand）。
  await review.locator("button", { hasText: "報告を採用" }).first().click();
  await page.waitForTimeout(2000);
  const acceptToast = (await page.locator(".toast").first().innerText()).replace(/\s+/g, " ");
  if (!acceptToast.includes("報告を採用しました")) {
    failures.push(`報告を採用した結果が読めません（${acceptToast}）。`);
  }
  const afterAccept = (await page.locator(".feed-tab-count").first().innerText()).trim();
  if (afterAccept !== String(EXPECTED_UNRESOLVED - 1)) {
    failures.push(
      `報告を採用しても対応待ちが${EXPECTED_UNRESOLVED - 1}件になりません（${afterAccept}）。`,
    );
  }
  await page.screenshot({ path: `${OUT_DIR}/review-accepted.png`, fullPage: true });

  // 14. Taskに紐づかない変更案も、同じ面から決着できる（却下）。正式データは作らない。
  await page.locator(".feed-tabs button", { hasText: "対応待ち" }).first().click();
  await page.waitForTimeout(500);
  const noteProposalRow = page
    .locator(".proposal-inbox-panel .proposal-row-select", { hasText: "測定手順のNoteを作る案" })
    .first();
  if (!(await noteProposalRow.count())) {
    failures.push("Taskに紐づかない変更案が「提案の確認」にありません。");
    return;
  }
  await noteProposalRow.click();
  await page.waitForTimeout(500);
  const rejectButton = page.locator(".proposal-inline-preview button", { hasText: "拒否" }).first();
  if (!(await rejectButton.count())) {
    failures.push("変更案を却下する操作が「提案の確認」にありません。");
    return;
  }
  await rejectButton.click();
  await page.waitForTimeout(2000);
  const afterReject = (await page.locator(".feed-tab-count").first().innerText()).trim();
  if (afterReject !== String(EXPECTED_UNRESOLVED - 2)) {
    failures.push(
      `変更案を却下しても対応待ちが${EXPECTED_UNRESOLVED - 2}件になりません（${afterReject}）。`,
    );
  }
  await page.screenshot({ path: `${OUT_DIR}/proposal-rejected.png`, fullPage: true });
}

/**
 * 第2段階の面（AIから届いた実データの投稿）を確認する。
 *
 * fixtureは実データが無いときだけの開発用なので、投稿があるときは混ざらない。
 * 読む操作が対応待ち（実データ）の件数を動かさないことも同じ画面で実測する。
 */
async function auditLivePost(page) {
  // 1. 実データの投稿だけを読む。返信は選んだ投稿の右スレッドで読む。
  const rootCount = await page.locator(".feed-posts .feed-post").count();
  if (rootCount !== 1) failures.push(`実データの投稿が1件ではありません（${rootCount}件）。`);
  const timelineText = await page.locator(".feed-timeline").innerText();
  for (const expected of [
    "保存をやり直しても、同じノートが増えないようにしました。",
    "効いたのは再送を止めることではなく、同じ依頼だと判別できることでした。",
    LIVE_ARTICLE_TITLE,
    LIVE_FIGURE_LABEL,
    "高分子材料評価",
  ]) {
    if (!timelineText.includes(expected))
      failures.push(`投稿に出ない文言があります（${expected}）。`);
  }
  const liveRoot = page.locator(".feed-posts .feed-post").first();
  await liveRoot.locator('button[aria-label^="返信"]').first().click();
  await page.waitForTimeout(400);
  const liveThread = page.locator(".feed-thread-panel").first();
  const liveThreadText = await liveThread.innerText();
  for (const expected of [LIVE_SEEDED_QUESTION, LIVE_SEEDED_ANSWER]) {
    if (!liveThreadText.includes(expected))
      failures.push(`スレッドに出ない文言があります（${expected}）。`);
  }
  const seededReplies = liveThread.locator(".feed-thread-posts .feed-post");
  if ((await seededReplies.count()) !== 2) {
    failures.push(`用意した質問と返答が2件ではありません（${await seededReplies.count()}件）。`);
  }
  if ((await liveThread.locator(".feed-thread-state", { hasText: "回答あり" }).count()) !== 1) {
    failures.push("返答が届いた質問が「回答あり」になっていません。");
  }
  if ((await liveThread.locator(".feed-thread-note", { hasText: "AIの返答" }).count()) !== 1) {
    failures.push("AIの返答がスレッドに出ていません。");
  }
  await liveThread.locator(".feed-thread-head button").first().click();
  await page.waitForTimeout(300);
  const author = (await page.locator(".feed-author-name").first().innerText()).trim();
  if (author !== "Codex") failures.push(`投稿者がCodexではありません（${author}）。`);
  const kind =
    (await page.locator(".feed-post-kind").first().getAttribute("aria-label")) ||
    (await page.locator(".feed-post-kind").first().innerText()).trim();
  if (kind !== "気づき") failures.push(`投稿の種類が気づきではありません（${kind}）。`);
  const bodyFont = await page.evaluate(() => {
    const element = document.querySelector(".feed-post-text");
    return element ? parseFloat(getComputedStyle(element).fontSize) : 0;
  });
  if (!(bodyFont >= MIN_BODY_FONT_PX)) {
    failures.push(`本文が${MIN_BODY_FONT_PX}px未満です（${bodyFont}px）。`);
  }
  await page.screenshot({ path: `${OUT_DIR}/live-home.png`, fullPage: true });

  // 2. 添えたAI記事を、投稿から開いて読める。
  const readDraft = page.locator(".feed-attachment button", { hasText: "記事を読む" }).first();
  if (!(await readDraft.count())) {
    failures.push("実データの投稿に記事を読む操作がありません。");
  } else {
    await readDraft.click();
    await page.waitForTimeout(400);
    if (!(await page.locator(".feed-reader").isVisible()))
      failures.push("AI記事の読書面が開きません。");
    const readerParagraphs = await page
      .locator(".feed-reader-markdown .markdown-preview-content p, .feed-reader-text")
      .count();
    if (readerParagraphs < 2)
      failures.push(`AI記事の本文が短すぎます（${readerParagraphs}段落）。`);
    await page.screenshot({ path: `${OUT_DIR}/live-reader.png` });
    await page.locator(".feed-reader button", { hasText: "戻る" }).first().click();
    await page.waitForTimeout(400);
    if (await page.locator(".feed-reader").count()) failures.push("AI記事を閉じられません。");
  }

  // 3. 学びタブにも出る（気づきは読む投稿）。返信と返答では水増ししない。
  await page.locator(".feed-tabs button", { hasText: "学び" }).first().click();
  await page.waitForTimeout(400);
  const learnCount = await page.locator(".feed-post").count();
  if (learnCount !== 1) failures.push(`学びタブに実データの投稿が出ません（${learnCount}件）。`);

  // 4. 読むことは判断ではない。対応待ち（実データ）は3件のまま。
  await page.locator(".feed-tabs button", { hasText: "対応待ち" }).first().click();
  await page.waitForTimeout(600);
  const unresolvedText = (await page.locator(".feed-tab-count").first().innerText()).trim();
  if (unresolvedText !== String(EXPECTED_UNRESOLVED)) {
    failures.push(
      `投稿の閲覧で対応待ちが${EXPECTED_UNRESOLVED}件ではなくなりました（${unresolvedText}）。`,
    );
  }
  const needsRows = await page.locator(".feed-needs-row").count();
  if (needsRows !== EXPECTED_NEEDS_ROWS) {
    failures.push(`対応待ちの行数が${EXPECTED_NEEDS_ROWS}件ではありません（${needsRows}）。`);
  }
  const liveProposalPanelText = await page.locator(".proposal-inbox-panel").first().innerText();
  if (!liveProposalPanelText.includes("測定手順のNoteを作る案")) {
    failures.push("対応待ちの「提案の確認」に変更案が出ていません。");
  }
  await page.screenshot({ path: `${OUT_DIR}/live-needs.png`, fullPage: true });

  // 5. ブックマークを付ける（保存はEntityとして行われる）。対象は実データの投稿。
  await page.locator(".feed-tabs button", { hasText: "ホーム" }).first().click();
  await page.waitForTimeout(400);
  const aiPost = page.locator(".feed-posts .feed-post", { hasText: LIVE_ARTICLE_TITLE }).first();
  const bookmark = aiPost.locator('button[aria-label^="ブックマーク"]').first();
  await bookmark.click();
  await page.waitForTimeout(1200);
  if ((await bookmark.getAttribute("aria-pressed")) !== "true") {
    failures.push("ブックマークを付けられません。");
  }
  const afterBookmark = (await page.locator(".feed-tab-count").first().innerText()).trim();
  if (afterBookmark !== String(EXPECTED_UNRESOLVED)) {
    failures.push(`ブックマークで対応待ち件数が変わりました（${afterBookmark}）。`);
  }
  await page.screenshot({ path: `${OUT_DIR}/live-bookmark.png`, fullPage: true });

  // 6. 記事の草稿を「Noteに保存」で正式Noteにする。投稿と読んだ印は変わらない。
  const saveNote = page.locator(".feed-attachment button", { hasText: "Noteに保存" }).first();
  if (!(await saveNote.count())) {
    failures.push("実データの投稿にNoteに保存の操作がありません。");
    return;
  }
  await saveNote.click();
  await page.waitForTimeout(1500);
  const openNote = page.locator(".feed-attachment button", { hasText: "Noteで読む" }).first();
  if (!(await openNote.count())) failures.push("Noteに保存の後、Noteへの導線が出ません。");
  const postsAfterSave = await page.locator(".feed-posts .feed-post").count();
  if (postsAfterSave !== 1) failures.push(`Noteに保存で投稿が消えました（${postsAfterSave}件）。`);
  const countAfterSave = (await page.locator(".feed-tab-count").first().innerText()).trim();
  if (countAfterSave !== String(EXPECTED_UNRESOLVED)) {
    failures.push(`Noteに保存で対応待ち件数が変わりました（${countAfterSave}）。`);
  }
  const bookmarkAfterSave = await page
    .locator('button[aria-label^="ブックマーク"]')
    .first()
    .getAttribute("aria-pressed");
  if (bookmarkAfterSave !== "true") failures.push("Noteに保存でブックマークが外れました。");
  await page.screenshot({ path: `${OUT_DIR}/live-note-saved.png`, fullPage: true });

  // 7. 保存したNoteは既存のNote面から開ける。
  if (await openNote.count()) {
    await openNote.click();
    await page.waitForTimeout(800);
    if (!(await page.locator(".drawer", { hasText: LIVE_ARTICLE_TITLE }).count())) {
      failures.push("保存したNoteを開けません。");
    }
    await page.screenshot({ path: `${OUT_DIR}/live-note-open.png` });
    await page.keyboard.press("Escape");
    await page.waitForTimeout(500);
  }

  // 7b. 保存したAI記事は、Notesから作成元と元投稿を確認でき、元のFeed投稿へ戻れる。
  const notesNav = page.locator(".sidebar button", { hasText: "Notes" }).first();
  if (!(await notesNav.count())) {
    failures.push("SidebarにNotesの入口がありません。");
  } else {
    await notesNav.click();
    await page.waitForTimeout(1200);
    const savedRow = page.locator(".note-row-main", { hasText: LIVE_ARTICLE_TITLE }).first();
    if (!(await savedRow.count())) {
      failures.push("保存したAI記事がNotesの一覧にありません。");
    } else {
      await savedRow.click();
      await page.waitForTimeout(600);
      const originLine = page.locator(".note-origin-line").first();
      if (!(await originLine.count())) {
        failures.push("AIから保存したNoteに作成元の表示がありません。");
      } else {
        const originText = (await originLine.innerText()).trim();
        if (!originText.includes("書いた記事")) {
          failures.push(`作成元のAIが表示されていません（${originText}）。`);
        }
        if (!originText.includes("自分のNotes")) {
          failures.push(`所有の表示がありません（${originText}）。`);
        }
        const openOrigin = originLine.locator("button", { hasText: "元のFeed投稿を開く" }).first();
        if (!(await openOrigin.count())) {
          failures.push("元のFeed投稿へ戻る導線がありません。");
        } else {
          await page.screenshot({ path: `${OUT_DIR}/live-note-origin.png`, fullPage: true });
          await openOrigin.click();
          await page.waitForTimeout(1200);
          const backThread = page.locator(".feed-thread-panel").first();
          if (!(await backThread.count())) {
            failures.push("元のFeed投稿へ戻っても会話が開きません。");
          } else {
            // 会話が開いた投稿が記事の投稿かを、起点カードの押下状態で確かめる。
            const originCard = page.locator(".feed-post", { hasText: LIVE_ARTICLE_TITLE }).first();
            const threadPressed = await originCard
              .locator('button[aria-label^="返信"]')
              .first()
              .getAttribute("aria-pressed");
            if (threadPressed !== "true") {
              failures.push("戻った先が元の投稿ではありません。");
            }
            await page.screenshot({ path: `${OUT_DIR}/live-note-back.png`, fullPage: true });
          }
          // 次の手順は返信ボタンからスレッドを開く。開いたままだと閉じてしまうので戻しておく。
          const closeThreadButton = page.locator(".feed-thread-head button").first();
          if (await closeThreadButton.count()) {
            await closeThreadButton.click();
            await page.waitForTimeout(400);
          }
        }
      }
    }
  }

  // 8. 返信は保存され、右スレッドへ追加される。対応待ちは変わらない。
  const replyTarget = page.locator(".feed-post").first();
  await replyTarget.locator('button[aria-label^="返信"]').first().click();
  await page.waitForTimeout(400);
  const threadPanel = page.locator(".feed-thread-panel").first();
  await threadPanel.locator(".feed-reply textarea").fill(LIVE_REPLY_BODY);
  await threadPanel.getByRole("button", { name: "返信を残す", exact: true }).click();
  await page.waitForTimeout(1500);
  const thread = threadPanel.locator(".feed-thread-posts .feed-post");
  const threadCount = await thread.count();
  if (threadCount !== 3) {
    failures.push(`返信が3件ではありません（${threadCount}件）。`);
  }
  if (!(await threadPanel.innerText()).includes(LIVE_REPLY_BODY)) {
    failures.push("返信の本文が表示されていません。");
  }
  if (await threadPanel.locator(".feed-reply textarea").inputValue()) {
    failures.push("返信保存後に入力欄が空になっていません。");
  }
  const countAfterReply = (await page.locator(".feed-tab-count").first().innerText()).trim();
  if (countAfterReply !== String(EXPECTED_UNRESOLVED)) {
    failures.push(`返信で対応待ち件数が変わりました（${countAfterReply}）。`);
  }
  await page.screenshot({ path: `${OUT_DIR}/live-reply.png`, fullPage: true });

  // 9. 「AIに聞く」は依頼として残り、押した時点ではAIが動いたように見せない。
  await threadPanel.locator(".feed-reply textarea").fill(LIVE_QUESTION_BODY);
  await threadPanel.getByRole("button", { name: "AIに聞く", exact: true }).click();
  await page.waitForTimeout(1500);
  const requested = threadPanel.locator(".feed-thread-state", { hasText: "AIに依頼済み" });
  if ((await requested.count()) !== 1) {
    failures.push(
      `AIへの依頼が「AIに依頼済み」として出ていません（${await requested.count()}件）。`,
    );
  }
  // 回答済みは用意した質問だけ。新しい依頼は未回答のまま。
  if ((await threadPanel.locator(".feed-thread-state", { hasText: "回答あり" }).count()) !== 1) {
    failures.push("依頼しただけで回答ありとして表示されています。");
  }
  const countAfterAsk = (await page.locator(".feed-tab-count").first().innerText()).trim();
  if (countAfterAsk !== String(EXPECTED_UNRESOLVED)) {
    failures.push(`AIへの依頼で対応待ち件数が変わりました（${countAfterAsk}）。`);
  }
  await page.screenshot({ path: `${OUT_DIR}/live-question.png`, fullPage: true });
  await threadPanel.locator(".feed-thread-head button").first().click();
  await page.waitForTimeout(300);

  // 10. 自分の投稿欄は既存のMemo入力を再利用し、載せたものだけを読む。
  const composer = page.locator(".feed-compose textarea");
  if (!(await composer.count())) {
    failures.push("自分の投稿欄がありません。");
    return;
  }
  await composer.fill(LIVE_OWN_POST_BODY);
  await page.locator(".feed-compose button", { hasText: "Feedへ投稿" }).click();
  await page.waitForTimeout(1500);
  if (!(await page.locator(".feed-timeline").innerText()).includes(LIVE_OWN_POST_BODY)) {
    failures.push("自分の投稿がFeedへ出ていません。");
  }
  const rootsAfterPost = await page.locator(".feed-posts .feed-post").count();
  if (rootsAfterPost !== 2) {
    failures.push(`自分の投稿で投稿が2件ではありません（${rootsAfterPost}件）。`);
  }
  const countAfterPost = (await page.locator(".feed-tab-count").first().innerText()).trim();
  if (countAfterPost !== String(EXPECTED_UNRESOLVED)) {
    failures.push(`自分の投稿で対応待ち件数が変わりました（${countAfterPost}）。`);
  }
  await page.screenshot({ path: `${OUT_DIR}/live-own-post.png`, fullPage: true });

  // 削除するとFeedから消える。載せ直すと新しい投稿として戻る。
  await page
    .locator(".feed-post", { hasText: LIVE_OWN_POST_BODY })
    .first()
    .locator(".feed-reaction", { hasText: "削除" })
    .click();
  await page.waitForTimeout(1500);
  const rootsAfterRemove = await page.locator(".feed-posts .feed-post").count();
  if (rootsAfterRemove !== 1) {
    failures.push(`削除しても投稿が残っています（${rootsAfterRemove}件）。`);
  }
  if ((await page.locator(".feed-timeline").innerText()).includes(LIVE_OWN_POST_BODY)) {
    failures.push("削除した本文が残っています。");
  }
  await composer.fill(LIVE_OWN_POST_BODY);
  await page.locator(".feed-compose button", { hasText: "Feedへ投稿" }).click();
  await page.waitForTimeout(1500);
  const rootsReposted = await page.locator(".feed-posts .feed-post").count();
  if (rootsReposted !== 2) failures.push(`自分の投稿を載せ直せません（${rootsReposted}件）。`);

  // 11. 外部AIクリップボード往復は架空回答で一周できる（外部送信なし）。
  const externalTarget = page.locator(".feed-post", { hasText: LIVE_ARTICLE_TITLE }).first();
  await externalTarget.locator('button[aria-label^="返信"]').first().click();
  await page.waitForTimeout(400);
  const externalThread = page.locator(".feed-thread-panel").first();
  await externalThread.getByRole("button", { name: "外部AIに聞く", exact: true }).click();
  await page.waitForTimeout(400);
  const copyQuestion = externalThread.locator('[id^="feed-copy-q-"]');
  await copyQuestion.fill(LIVE_MANUAL_QUESTION);
  await externalThread.getByRole("button", { name: "コピーする", exact: true }).click();
  await page.waitForTimeout(1200);
  // コピー成否にかかわらず質問は残る。成功時は普段のAIへの案内が出る。
  if ((await copyQuestion.inputValue()) !== LIVE_MANUAL_QUESTION) {
    failures.push("コピー後に質問が残っていません。");
  }
  await page.screenshot({ path: `${OUT_DIR}/live-external-copy.png`, fullPage: true });

  await externalThread.getByRole("button", { name: "回答を貼り付け", exact: true }).click();
  await page.waitForTimeout(400);
  await externalThread.locator('[id^="feed-paste-a-"]').fill(LIVE_MANUAL_ANSWER);
  await externalThread.locator('[id^="feed-paste-q-"]').fill(LIVE_MANUAL_QUESTION);
  await externalThread.locator('[id^="feed-paste-s-"]').fill(LIVE_MANUAL_SOURCE);
  await externalThread.locator('[id^="feed-paste-c-"]').fill(LIVE_MANUAL_COMMENT);
  // 保存前プレビューで出所の区別が出る。
  if (!(await externalThread.locator(".feed-preview").innerText()).includes("自分が貼り付け")) {
    failures.push("貼り付けのプレビューに出所の区別が出ていません。");
  }
  await externalThread.getByRole("button", { name: "返信として保存", exact: true }).click();
  await page.waitForTimeout(1500);
  const threadAfterPaste = await externalThread.innerText();
  for (const expected of [LIVE_MANUAL_ANSWER, LIVE_MANUAL_QUESTION, LIVE_MANUAL_COMMENT]) {
    if (!threadAfterPaste.includes(expected)) {
      failures.push(`貼り付けた回答が表示されていません（${expected}）。`);
    }
  }
  if (!threadAfterPaste.includes(`自分が貼り付け · ${LIVE_MANUAL_SOURCE}`)) {
    failures.push("手動貼付と自動受信の区別が表示されていません。");
  }
  const countAfterPaste = (await page.locator(".feed-tab-count").first().innerText()).trim();
  if (countAfterPaste !== String(EXPECTED_UNRESOLVED)) {
    failures.push(`貼り付けで対応待ち件数が変わりました（${countAfterPaste}）。`);
  }
  await page.screenshot({ path: `${OUT_DIR}/live-external-paste.png`, fullPage: true });
  await externalThread.locator(".feed-thread-head button").first().click();
}

/** 起動し直しても、投稿と読者の印、保存したNote、返信・AIへの依頼と返答、自分の投稿が残る。 */
async function auditLiveRestart(page) {
  const rootCount = await page.locator(".feed-posts .feed-post").count();
  if (rootCount !== 2) failures.push(`再起動後の投稿が2件ではありません（${rootCount}件）。`);
  const restartTarget = page.locator(".feed-post", { hasText: LIVE_ARTICLE_TITLE }).first();
  if (!(await page.locator(".feed-thread-panel").count())) {
    await restartTarget.locator('button[aria-label^="返信"]').first().click();
    await page.waitForTimeout(400);
  }
  const threadPanel = page.locator(".feed-thread-panel").first();
  const thread = threadPanel.locator(".feed-thread-posts .feed-post");
  const threadCount = await thread.count();
  if (threadCount !== 5) failures.push(`再起動後の返信が5件ではありません（${threadCount}件）。`);
  const threadText = await threadPanel.innerText();
  for (const expected of [
    LIVE_REPLY_BODY,
    LIVE_QUESTION_BODY,
    LIVE_SEEDED_ANSWER,
    LIVE_MANUAL_ANSWER,
    LIVE_MANUAL_QUESTION,
    LIVE_MANUAL_COMMENT,
  ]) {
    if (!threadText.includes(expected)) {
      failures.push(`再起動後に出ない文言があります（${expected}）。`);
    }
  }
  if (!threadText.includes(`自分が貼り付け · ${LIVE_MANUAL_SOURCE}`)) {
    failures.push("再起動後に手動貼付の区別が残っていません。");
  }
  if (
    (await threadPanel.locator(".feed-thread-state", { hasText: "AIに依頼済み" }).count()) !== 1
  ) {
    failures.push("再起動後にAIへの依頼が残っていません。");
  }
  if ((await threadPanel.locator(".feed-thread-state", { hasText: "回答あり" }).count()) !== 1) {
    failures.push("再起動後にAIの返答が残っていません。");
  }
  const persisted = await restartTarget
    .locator('button[aria-label^="ブックマーク"]')
    .first()
    .getAttribute("aria-pressed");
  if (persisted !== "true") failures.push("再起動後にブックマークが残っていません。");
  await threadPanel.locator(".feed-thread-head button").first().click();
  if (!(await page.locator(".feed-attachment button", { hasText: "Noteで読む" }).count())) {
    failures.push("再起動後に保存したNoteへの導線が残っていません。");
  }
  const persistedCount = (await page.locator(".feed-tab-count").first().innerText()).trim();
  if (persistedCount !== String(EXPECTED_UNRESOLVED)) {
    failures.push(`再起動後の対応待ち件数が違います（${persistedCount}）。`);
  }
  await page.screenshot({ path: `${OUT_DIR}/live-restart.png`, fullPage: true });

  // 実データのブックマークでも「保存済みのみ」で読み返せる（印はEntityとして残っている）。
  const bookmarksTab = page.locator(".feed-tabs button", { hasText: "ブックマーク" }).first();
  if (!(await bookmarksTab.count())) {
    failures.push("再起動後にブックマークの入口がありません。");
  } else {
    await bookmarksTab.click();
    await page.waitForTimeout(500);
    const savedRoots = await page.locator(".feed-posts .feed-post").count();
    if (savedRoots !== 1) {
      failures.push(`保存済みの絞り込みが実データで1件になりません（${savedRoots}件）。`);
    }
    if (!(await page.locator(".feed-timeline").innerText()).includes(LIVE_ARTICLE_TITLE)) {
      failures.push("保存済みに出ている投稿が、ブックマークした投稿と違います。");
    }
    await page.screenshot({ path: `${OUT_DIR}/live-saved.png`, fullPage: true });
    await page.locator(".feed-tabs button", { hasText: "ホーム" }).first().click();
    await page.waitForTimeout(300);
    if ((await page.locator(".feed-posts .feed-post").count()) !== 2) {
      failures.push("保存済みの絞り込みを解除できません。");
    }
  }

  // 補助メニューの「既知だった」も実データの投稿で記録でき、対応待ちは動かさない。
  const menu = page
    .locator(".feed-posts .feed-post", { hasText: LIVE_ARTICLE_TITLE })
    .locator(".feed-post-more-menu")
    .first();
  if (!(await menu.count())) {
    failures.push("実データの投稿に補助メニューがありません。");
  } else {
    await menu.locator("summary").first().click();
    await page.waitForTimeout(200);
    const known = menu.locator("button", { hasText: "既知だった" }).first();
    if (!(await known.count())) {
      failures.push("実データの投稿の補助メニューに「既知だった」がありません。");
    } else {
      await known.click();
      await page.waitForTimeout(1200);
      const knownNotice = await page.locator(".feed-notice-line").first().innerText();
      if (!knownNotice.includes("既知だった")) {
        failures.push(`「既知だった」の案内が出ていません（${knownNotice}）。`);
      }
      const countAfterKnown = (await page.locator(".feed-tab-count").first().innerText()).trim();
      if (countAfterKnown !== String(EXPECTED_UNRESOLVED)) {
        failures.push(`「既知だった」で対応待ち件数が変わりました（${countAfterKnown}）。`);
      }
    }
  }

  // 採用済みのNoteを削除すると参照先がないと分かり、元に戻すと同じ参照からまた読める。
  const openSaved = page.locator(".feed-attachment button", { hasText: "Noteで読む" }).first();
  if (!(await openSaved.count())) {
    failures.push("参照先を確かめるための「Noteで読む」がありません。");
    return;
  }
  await openSaved.click();
  await page.waitForTimeout(900);
  const noteDrawer = page.locator(".drawer", { hasText: LIVE_ARTICLE_TITLE }).first();
  if (!(await noteDrawer.count())) {
    failures.push("保存したNoteの詳細を開けません。");
    return;
  }
  await noteDrawer.locator("button", { hasText: "削除する" }).first().click();
  await page.waitForTimeout(1500);
  const missing = page.locator(".feed-attachment.is-missing").first();
  if (!(await missing.count())) {
    failures.push("Noteを削除しても、添付が参照先の不在を示していません。");
  } else {
    const message = await missing.innerText();
    if (!message.includes("参照先が削除されています")) {
      failures.push(`参照先がない案内が出ていません（${message}）。`);
    }
    if (await missing.locator("button", { hasText: "Noteに保存" }).count()) {
      failures.push("参照先がない添付に「Noteに保存」が残っています。");
    }
    if (!(await missing.locator("button", { hasText: "記事を読む" }).count())) {
      failures.push("参照先がない添付からAI記事を読めません。");
    }
  }
  await page.screenshot({ path: `${OUT_DIR}/live-note-missing.png`, fullPage: true });

  // 「元に戻す」は同じIDのNoteを戻すので、同じ参照からまた読める。
  const undo = page.locator(".toast button", { hasText: "元に戻す" }).first();
  if (!(await undo.count())) {
    failures.push("Noteの削除を元に戻す導線が出ていません。");
    return;
  }
  await undo.click();
  await page.waitForTimeout(1800);
  if (await page.locator(".feed-attachment.is-missing").count()) {
    failures.push("元に戻しても添付が参照先の不在を示したままです。");
  }
  if (!(await page.locator(".feed-attachment button", { hasText: "Noteで読む" }).count())) {
    failures.push("元に戻した後、同じ参照からNoteを開けません。");
  }
  await page.screenshot({ path: `${OUT_DIR}/live-note-restored.png`, fullPage: true });
}

/**
 * 100件以上の履歴を連続して読めることを確認する（`--bulk`）。
 *
 * 20件単位で読み込み、読んでいる位置（先頭の投稿の文書内の位置）が動かないこと、
 * 同じ投稿を二度出さないこと、最後まで届いて「さらに読む」が消えることを実測する。
 */
async function auditBulk(page) {
  const initial = await page.locator(".feed-post").count();
  if (initial !== FEED_PAGE_SIZE) {
    failures.push(`最初に読める投稿が${FEED_PAGE_SIZE}件ではありません（${initial}件）。`);
  }
  const firstText = (await page.locator(".feed-post .feed-post-text").first().innerText()).trim();
  const firstOffsetBefore = await page.evaluate(
    () => document.querySelector(".feed-post")?.offsetTop ?? -1,
  );
  const more = page.locator(".feed-more");
  if (!(await more.count())) {
    failures.push("さらに読むがありません。");
    return;
  }
  const moreLabel = (await more.first().innerText()).trim();
  if (!moreLabel.includes(`次の${FEED_PAGE_SIZE}件`)) {
    failures.push(`さらに読むの案内が違います（${moreLabel}）。`);
  }

  let rounds = 0;
  while (await page.locator(".feed-more").count()) {
    if (rounds >= BULK_POSTS / FEED_PAGE_SIZE + 2) {
      failures.push("さらに読むを押しても読み込みが終わりません。");
      break;
    }
    await page.locator(".feed-more").first().click();
    await page.waitForTimeout(400);
    rounds += 1;
  }

  const total = await page.locator(".feed-post").count();
  if (total !== BULK_POSTS) {
    failures.push(`全${BULK_POSTS}件を読み込めません（${total}件）。`);
  }
  if (await page.locator(".feed-more").count()) {
    failures.push("全件を読み込んでも「さらに読む」が残っています。");
  }

  // 同じ投稿を二度出さない。並びは新しい順のまま。
  const paragraphs = await page.$$eval(".feed-post", (nodes) =>
    nodes.map((node) => node.querySelector(".feed-post-text")?.textContent?.trim() || ""),
  );
  const unique = new Set(paragraphs);
  if (unique.size !== paragraphs.length) {
    failures.push(`同じ投稿が重複して出ています（${paragraphs.length}件中${unique.size}件が別）。`);
  }
  if (paragraphs[0] !== firstText) {
    failures.push("先頭の投稿が読み進めで変わりました。");
  }
  if (!paragraphs[paragraphs.length - 1]?.includes(`投稿 ${BULK_POSTS} `)) {
    failures.push(
      `最後の投稿が最も古い投稿ではありません（${paragraphs[paragraphs.length - 1]}）。`,
    );
  }
  const firstOffsetAfter = await page.evaluate(
    () => document.querySelector(".feed-post")?.offsetTop ?? -1,
  );
  if (firstOffsetAfter !== firstOffsetBefore) {
    failures.push(
      `読み進めで先頭の投稿の位置が動きました（${firstOffsetBefore} → ${firstOffsetAfter}）。`,
    );
  }
  const endText = (await page.locator(".feed-end").first().innerText()).trim();
  if (!endText.includes("ここまでの投稿を表示しました")) {
    failures.push(`末尾の文言が違います（${endText}）。`);
  }
  await page.screenshot({ path: `${OUT_DIR}/bulk-end.png`, fullPage: true });
}

/**
 * 画像と外部リンクを添えた投稿（`--media`、計画フェーズ3）。
 *
 * ネットワークを使わずに再現できる四状態を実測する。
 * 画像あり・画像なし・リンク（取得失敗＝オフライン）・壊れた参照。
 * サムネイルが付く状態の取得そのものは `tests/feed-link-preview.test.mjs` で確かめる。
 */
async function auditMedia(page) {
  const posts = page.locator(".feed-posts .feed-post");
  const count = await posts.count();
  if (count !== 3) {
    failures.push(`メディア検証の投稿が3件ではありません（${count}件）。`);
    return;
  }
  // 並び順に依存せず、本文の手がかりから投稿を特定する。
  const imagePost = page
    .locator(".feed-post", { hasText: "引張試験の比較図を1枚にまとめました。" })
    .first();
  const linkPost = page
    .locator(".feed-post", { hasText: "公開されている資料を1本読みました。" })
    .first();
  const brokenPost = page
    .locator(".feed-post", { hasText: "古い実験ノートの図を参照しようとした" })
    .first();

  // 1. 画像あり: 実在するArtifactを参照し、imgとして描画される。
  if (!(await imagePost.count())) {
    failures.push("画像を添えた投稿が見つかりません。");
  } else {
    const imageMedia = imagePost.locator(".feed-media-image").first();
    if (!(await imageMedia.count())) {
      failures.push("画像を添えた投稿に画像の入口がありません。");
    } else {
      if (!(await imageMedia.locator(".feed-media-role").innerText()).includes("実測")) {
        failures.push("画像の役割（実測・作業成果）が表示されていません。");
      }
      const image = imageMedia.locator("img.feed-media-image-body").first();
      if (!(await image.count())) {
        failures.push("画像ありの投稿にimgがありません。");
      } else {
        const src = await image.getAttribute("src");
        if (!src?.startsWith("tasken-media://artifact/")) {
          failures.push(`画像の参照先が既存media経路ではありません（${src}）。`);
        }
        if (!(await image.getAttribute("alt"))) {
          failures.push("画像に代替テキストがありません。");
        }
        // 読み込みに失敗していないこと（壊れた参照の代替表示が出ていないこと）。
        await page.waitForTimeout(800);
        if (await imageMedia.locator(".feed-media-broken").count()) {
          failures.push("実在するArtifactの画像を表示できません。");
        }
        const naturalWidth = await image.evaluate((node) => node.naturalWidth || 0);
        if (!(naturalWidth > 0)) failures.push("画像の実体を読み込めませんでした。");
        // 切り抜きで情報を落とさない。
        const fit = await image.evaluate((node) => getComputedStyle(node).objectFit);
        if (fit !== "contain") failures.push(`画像の収め方がcontainではありません（${fit}）。`);
      }
      if (!(await imageMedia.locator(".feed-media-caption").count())) {
        failures.push("画像のキャプションが表示されていません。");
      }
    }
  }

  // 2. リンク: 取得できなくてもURL・ホスト名・投稿者の一言で読める。
  if (!(await linkPost.count())) {
    failures.push("外部リンクを添えた投稿が見つかりません。");
  } else {
    const linkMedia = linkPost.locator(".feed-media-link").first();
    if (!(await linkMedia.count())) {
      failures.push("外部リンクを添えた投稿にリンクカードがありません。");
    } else {
      await page.waitForTimeout(1200);
      const linkText = await linkMedia.innerText();
      if (!linkText.includes("example.invalid")) {
        failures.push(`リンクのホスト名が出ていません（${linkText}）。`);
      }
      if (!linkText.includes("https://example.invalid/measurement-variance")) {
        failures.push("リンクのURLが出ていません。");
      }
      if (!linkText.includes("少ない標本数でも判断できる条件がまとまっています。")) {
        failures.push("投稿者の一言が出ていません。");
      }
      if (!linkText.includes("ばらつきの見方（外部資料）")) {
        failures.push("投稿者が付けた題名が出ていません。");
      }
      if ((await linkMedia.locator("button", { hasText: "開く" }).count()) === 0) {
        failures.push("リンクを開く操作がありません。");
      }
      // 長いURL・題名で横へはみ出さない。
      const overflow = await linkMedia.evaluate((node) => node.scrollWidth - node.clientWidth);
      if (overflow > 1) failures.push(`リンクカードが横へはみ出しています（${overflow}px）。`);
      // 取得に失敗しても、他の投稿が読めている（波及しない）。
      if (!(await imagePost.locator("img.feed-media-image-body").count())) {
        failures.push("リンクの取得失敗が他の投稿へ波及しています。");
      }
      await linkMedia.scrollIntoViewIfNeeded();
      await page.waitForTimeout(300);
      await page.screenshot({ path: `${OUT_DIR}/media-link.png` });
    }
  }

  // 3. 壊れた参照: 投稿全体を失敗させず、一行の代替表示へ落とす。
  if (!(await brokenPost.count())) {
    failures.push("壊れた参照の投稿が見つかりません。");
  } else {
    const broken = brokenPost.locator(".feed-media-broken").first();
    if (!(await broken.count())) {
      failures.push("存在しないArtifactの参照に代替表示が出ていません。");
    } else {
      const text = await broken.innerText();
      if (!text.includes("画像を表示できません")) {
        failures.push(`壊れた参照の案内が不明確です（${text}）。`);
      }
      // 画像が読めなくても、投稿の本文はそのまま読める。
      const postText = await brokenPost.innerText();
      if (
        !postText.includes("図そのものより、どの条件で測ったかの記録が先に要ると分かりました。")
      ) {
        failures.push("壊れた参照の投稿でも本文が読めていません。");
      }
      await brokenPost.scrollIntoViewIfNeeded();
      await page.waitForTimeout(300);
      await page.screenshot({ path: `${OUT_DIR}/media-broken.png` });
    }
  }

  // 4. 画像がない投稿が同じ一覧に混ざっても、投稿面のリズムが崩れない。
  const sheet = page.locator(".feed-main").first();
  const sheetOverflow = await sheet.evaluate((node) => node.scrollWidth - node.clientWidth);
  if (sheetOverflow > 1) failures.push(`投稿面が横へはみ出しています（${sheetOverflow}px）。`);

  await page.screenshot({ path: `${OUT_DIR}/media-home.png`, fullPage: true });
}

/**
 * 既存Noteを参照する投稿を読めることを確認する（`--note-ref`）。
 *
 * 投稿はNoteの中身を複製せず、`payload.note_id` の参照だけを持つ。
 * 「Noteで読む」が既存のNote読書面を開くこと、Noteを消したら参照先の不在を示し、
 * 元に戻すと同じ参照からまた読めることを実測する。
 */
/**
 * 何も無いworkspaceのゼロ状態（design-guide §5）。
 *
 * 0件のセクションは枠を出さず、空の面には次の行動を1つ置く。
 * 投稿が無いときだけ開発用fixtureを出す既存の規則はそのまま実測する。
 */
async function auditEmpty(app, page) {
  // 1. 投稿が無いときは開発用fixtureを読み、投稿欄はそのまま出す。
  await page.locator(".feed-tabs button", { hasText: "ホーム" }).first().click();
  await page.waitForTimeout(500);
  if (!(await page.locator(".feed-post").count())) {
    failures.push("投稿が無いworkspaceでFeedが読めません（開発用fixtureが出ていません）。");
  }
  if (!(await page.locator("#feed-compose-body").count())) {
    failures.push("投稿が無いworkspaceで自分の投稿欄が出ていません。");
  }
  await page.screenshot({ path: `${OUT_DIR}/empty-home.png`, fullPage: true });

  // 2. 対応待ちは0件。空の面には次の行動を1つ置き、「提案の確認」は出さない。
  await page.locator(".feed-tabs button", { hasText: "対応待ち" }).first().click();
  await page.waitForTimeout(600);
  const needsPanel = page.locator("#feed-panel-needs");
  if (!(await needsPanel.count())) {
    failures.push("対応待ちの面が出ていません。");
    return;
  }
  const needsEmpty = needsPanel.locator(".empty-state").first();
  if (!(await needsEmpty.count())) {
    failures.push("対応待ちが0件のときの空状態が出ていません。");
  } else {
    const emptyText = (await needsEmpty.innerText()).replace(/\s+/g, " ");
    if (!emptyText.includes("いま対応する更新はありません")) {
      failures.push(`空状態の見出しが違います（${emptyText}）。`);
    }
    if (!(await needsEmpty.locator("button", { hasText: "ホームを読む" }).count())) {
      failures.push("対応待ちが0件の空状態に、次の行動（ホームを読む）がありません。");
    }
  }
  if (await page.locator(".proposal-inbox-panel").count()) {
    failures.push("確認する提案が無いのに「提案の確認」が出ています。");
  }
  if (await page.locator(".feed-needs-row").count()) {
    failures.push("対応待ちが0件なのに一覧行が出ています。");
  }

  // 3. 右レールも0件のセクションを出さず、空なら次の行動を1つ示す。
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1536, 960));
  await page.waitForTimeout(700);
  const rail = page.locator(".feed-rail");
  if (!(await rail.isVisible())) {
    failures.push("何も無いworkspaceでも、広い幅では右レールを出す（空状態を示す）。");
  } else {
    for (const heading of ["対応キュー", "AI活動", "今見るもの", "再発見"]) {
      if (await rail.locator("h2", { hasText: heading }).count()) {
        failures.push(`0件のセクション「${heading}」の枠が出ています。`);
      }
    }
    const railEmpty = rail.locator(".empty-state").first();
    if (!(await railEmpty.count())) {
      failures.push("右レールに何も無いときの空状態が出ていません。");
    } else if (!(await railEmpty.locator("button", { hasText: "タスクを見る" }).count())) {
      failures.push("右レールの空状態に、次の行動（タスクを見る）がありません。");
    }
  }
  await page.screenshot({ path: `${OUT_DIR}/empty-needs-rail.png`, fullPage: true });

  // 4. 空状態の導線が実際に移動する。
  const homeAction = needsEmpty.locator("button", { hasText: "ホームを読む" }).first();
  if (await homeAction.count()) {
    await homeAction.click();
    await page.waitForTimeout(500);
    if ((await page.locator("#feed-tab-home").getAttribute("aria-selected")) !== "true") {
      failures.push("空状態の「ホームを読む」でホームへ移動しません。");
    }
  }
}

async function auditNoteReference(page) {
  const post = page.locator(".feed-post").first();
  if (!(await post.count())) {
    failures.push("既存Noteを参照する投稿が出ていません。");
    return;
  }
  const attachment = post.locator(".feed-attachment").first();
  const text = (await attachment.innerText()).replace(/\s+/g, " ");
  // 題名はNoteの正本から出す。投稿が持つのは参照だけ。
  if (!text.includes("測定手順の標準化"))
    failures.push(`参照先Noteの題名が出ていません（${text}）。`);
  if (!text.includes("参照しているNote"))
    failures.push("参照しているNoteと分かる表示がありません。");
  if (text.includes("参照先が削除されています")) {
    failures.push("Noteがあるのに参照先の不在を示しています。");
  }
  const readNote = attachment.locator("button", { hasText: "Noteで読む" }).first();
  if (!(await readNote.count())) {
    failures.push("既存Noteを開く導線がありません。");
    return;
  }
  await page.screenshot({ path: `${OUT_DIR}/note-ref.png`, fullPage: true });

  await readNote.click();
  await page.waitForTimeout(900);
  const drawer = page.locator(".drawer", { hasText: "測定手順の標準化" }).first();
  if (!(await drawer.count())) {
    failures.push("既存のNote読書面を開けません。");
    return;
  }
  if (!(await drawer.innerText()).includes("温度を決めてから3回測る")) {
    failures.push("Noteの本文が読書面に出ていません。");
  }
  await page.screenshot({ path: `${OUT_DIR}/note-ref-open.png`, fullPage: true });

  // Noteを消すと参照先の不在を示し、元に戻すと同じ参照からまた読める。
  await drawer.locator("button", { hasText: "削除する" }).first().click();
  await page.waitForTimeout(1500);
  const missing = page.locator(".feed-attachment.is-missing").first();
  if (!(await missing.count())) {
    failures.push("Noteを消しても、添付が参照先の不在を示していません。");
  } else {
    const missingText = (await missing.innerText()).replace(/\s+/g, " ");
    if (!missingText.includes("参照先が削除されています")) {
      failures.push(`参照先がない案内が出ていません（${missingText}）。`);
    }
    if (await missing.locator("button", { hasText: "Noteで読む" }).count()) {
      failures.push("参照先が無いのにNoteを開く導線が残っています。");
    }
  }
  await page.screenshot({ path: `${OUT_DIR}/note-ref-missing.png`, fullPage: true });

  const undo = page.locator(".toast button", { hasText: "元に戻す" }).first();
  if (!(await undo.count())) {
    failures.push("Noteの削除を元に戻す導線が出ていません。");
    return;
  }
  await undo.click();
  await page.waitForTimeout(1800);
  if (await page.locator(".feed-attachment.is-missing").count()) {
    failures.push("元に戻しても添付が参照先の不在を示したままです。");
  }
  if (!(await post.locator("button", { hasText: "Noteで読む" }).count())) {
    failures.push("元に戻した後、同じ参照からNoteを開けません。");
  }
  await page.screenshot({ path: `${OUT_DIR}/note-ref-restored.png`, fullPage: true });
}

try {
  if (LIVE) {
    // 実データの投稿を読む → 終了 → 起動し直して保存を確認する。
    let session = await launchApp();
    try {
      await openFeed(session.page);
      await auditLivePost(session.page);
    } finally {
      await session.app.close();
    }
    session = await launchApp();
    try {
      await openFeed(session.page);
      await auditLiveRestart(session.page);
    } finally {
      await session.app.close();
    }
  } else if (BULK) {
    const session = await launchApp();
    try {
      await openFeed(session.page);
      await auditBulk(session.page);
    } finally {
      await session.app.close();
    }
  } else if (NOTE_REF) {
    const session = await launchApp();
    try {
      await openFeed(session.page);
      await auditNoteReference(session.page);
    } finally {
      await session.app.close();
    }
  } else if (MEDIA) {
    const session = await launchApp();
    try {
      await openFeed(session.page);
      await auditMedia(session.page);
    } finally {
      await session.app.close();
    }
  } else if (EMPTY) {
    const session = await launchApp();
    try {
      await openFeed(session.page);
      await auditEmpty(session.app, session.page);
    } finally {
      await session.app.close();
    }
  } else {
    const session = await launchApp();
    try {
      await openFeed(session.page);
      await auditFixtures(session.app, session.page);
    } finally {
      await session.app.close();
    }
  }
} finally {
  rmSync(userDataDir, { recursive: true, force: true });
}

if (failures.length) {
  console.error(`Feed監査で${failures.length}件の問題を検出しました。`);
  for (const failure of failures) console.error(`  NG ${failure}`);
  console.error(`スクリーンショット: ${OUT_DIR}`);
  process.exit(1);
}
console.log(
  `Feed監査: OK（${
    LIVE
      ? "実データ投稿"
      : BULK
        ? `連続読込${BULK_POSTS}件`
        : NOTE_REF
          ? "既存Noteの参照"
          : MEDIA
            ? "画像と外部リンクの四状態"
            : EMPTY
              ? "何も無いworkspaceのゼロ状態"
              : "開発用fixture"
  }、スクリーンショットは ${OUT_DIR}）`,
);
