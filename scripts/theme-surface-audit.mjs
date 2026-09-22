/**
 * Theme surface の目視・レイアウト監査（計画フェーズ4: ThemeとNotes）
 *
 * 隔離した一時userDataでビルド済みアプリを起動し、Themeの四面
 * （概要／タスク／投稿／Notes）を広幅と最小幅で確認する。
 * 「スクリーンショットを撮った」だけで終わらせず、次を実測して判定する。
 *
 * - 四面が同じ順で並び、選択状態と対応するpanelが一致する（role=tab / tabpanel）
 * - 概要だけがTheme intent・現在地・Recent AI workを見せ、技術設定は畳んである
 * - タスク／投稿／Notesが、それぞれの既存データ（Task・投稿・報告書）へ一度で届く
 * - 「記事を読む」がFeedへ渡り、会話を開く（Theme側で記事や会話を複製しない）
 * - タスクへ切り替えて別画面へ移動し、戻ると選んだ面が復元される
 * - どの面も横スクロールを出さない
 *
 *   npm run build && npm run audit:theme
 *
 * 出力先は output/playwright/theme-audit。失敗時は終了コード1。
 */
import { _electron as electron } from "playwright";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { spawnSync } from "node:child_process";
import os from "node:os";
import path from "node:path";

const OUT_DIR = "output/playwright/theme-audit";
const SIZES = [
  { label: "wide-1536", width: 1536, height: 960 },
  { label: "min-980", width: 980, height: 680 },
];
const ZOOM_STORAGE_KEY = "tasken:shell:zoom-factor:v1";
/** 隔離workspaceに入れるThemeと、その中身（`scripts/seed-theme-audit-workspace.mjs`）。 */
const THEME_NAME = "高分子材料評価";
const TAB_LABELS = ["概要", "タスク", "投稿", "Notes"];
const SEEDED_STATUS_SUMMARY = "25℃の比較が終わり、次は40℃の条件を決める段階です。";
const SEEDED_TASK_TITLE = "40℃の比較条件を決める";
const SEEDED_REPORT_TITLE = "週報（高分子材料評価）";
const SEEDED_KNOWLEDGE_TITLE = "温度を上げると裾が広がる";
const SEEDED_POST_BODY = "溶媒を替えた3条件を、同じ軸で並べ直しました。";
const SEEDED_POST_AUTHOR = "Codex";
const SEEDED_POST_KIND = "気づき";

mkdirSync(OUT_DIR, { recursive: true });
const userDataDir = mkdtempSync(path.join(os.tmpdir(), "tasken-theme-audit-"));
const seeded = spawnSync(
  process.execPath,
  ["scripts/run-electron-node.mjs", "scripts/seed-theme-audit-workspace.mjs", userDataDir],
  { encoding: "utf8" },
);
if (seeded.status !== 0) {
  throw new Error(`Theme監査のworkspaceを用意できませんでした: ${seeded.stderr || seeded.stdout}`);
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

/** SidebarのThemeを開く。Themeの入口は名前で選び、他のThemeを開かない。 */
async function openTheme(page) {
  const navButton = page.locator(".theme-nav button", { hasText: THEME_NAME }).first();
  if (!(await navButton.count())) {
    throw new Error(`SidebarにTheme「${THEME_NAME}」の入口がありません。`);
  }
  await navButton.click();
  await page.waitForTimeout(1200);
}

/** 面を選ぶ。tablistの中の同じ名前だけを押す。 */
async function selectTab(page, label) {
  await page.locator(".theme-tabs button[role='tab']", { hasText: label }).first().click();
  await page.waitForTimeout(400);
}

/** 選択中の面の名前。aria-selectedで判定し、見た目のclassでは判定しない。 */
async function selectedTab(page) {
  const selected = page.locator(".theme-tabs button[role='tab'][aria-selected='true']");
  if ((await selected.count()) !== 1) return `選択が${await selected.count()}件`;
  return (await selected.first().innerText()).trim();
}

/** 横スクロールの実測。Theme面そのものと、ウィンドウ全体を見る。 */
async function measureOverflow(page) {
  return page.evaluate(() => {
    const root = document.querySelector(".theme-page");
    return {
      page: root ? root.scrollWidth - root.clientWidth : 0,
      document: document.documentElement.scrollWidth - window.innerWidth,
    };
  });
}

/** 見出し・文言の可視を、面ごとに確かめる。 */
async function visibleText(page, selector, expected) {
  return page.locator(selector, { hasText: expected }).first().isVisible();
}

/** 1. 四面の並びと、押したタブと表示中のpanelの対応。 */
async function auditTabs(page) {
  const tabs = page.locator(".theme-tabs button[role='tab']");
  const count = await tabs.count();
  if (count !== TAB_LABELS.length) {
    failures.push(`タブが${TAB_LABELS.length}個ではありません（${count}個）。`);
    return;
  }
  const labels = [];
  for (let index = 0; index < count; index += 1) {
    labels.push((await tabs.nth(index).innerText()).trim());
  }
  if (labels.join("/") !== TAB_LABELS.join("/")) {
    failures.push(`タブの並びが違います（${labels.join("/")}）。`);
  }
  // 一度ずつ切り替え、押したタブが指すpanelだけが表示されることを確かめる。
  for (const label of TAB_LABELS) {
    await selectTab(page, label);
    if ((await selectedTab(page)) !== label) {
      failures.push(`${label}を押しても選択状態になりません（${await selectedTab(page)}）。`);
      continue;
    }
    const tab = page.locator(".theme-tabs button[role='tab'][aria-selected='true']").first();
    const tabId = await tab.getAttribute("id");
    const panelId = await tab.getAttribute("aria-controls");
    if (!panelId) {
      failures.push(`${label}のタブにaria-controlsがありません。`);
      continue;
    }
    const panel = page.locator(`#${panelId}`);
    if ((await panel.count()) !== 1) {
      failures.push(`${label}の面のpanelがありません（${panelId}）。`);
      continue;
    }
    if ((await panel.getAttribute("role")) !== "tabpanel") {
      failures.push(`${panelId}がtabpanelではありません。`);
    }
    if ((await panel.getAttribute("aria-labelledby")) !== tabId) {
      failures.push(`${panelId}のaria-labelledbyが、押したタブを指していません。`);
    }
  }
  await selectTab(page, "概要");
}

/** 2. 概要だけが日常の内容を見せ、技術設定は畳んである。 */
async function auditOverview(page) {
  if ((await selectedTab(page)) !== "概要") {
    failures.push(`初期表示が概要ではありません（${await selectedTab(page)}）。`);
  }
  if (!(await page.locator(".theme-intent-panel").first().isVisible())) {
    failures.push("概要にTheme intentが出ていません。");
  }
  if (!(await visibleText(page, ".theme-tab-panel h2", "現在地"))) {
    failures.push("概要に現在地が出ていません。");
  }
  if (!(await page.locator("#theme-panel-overview").innerText()).includes(SEEDED_STATUS_SUMMARY)) {
    failures.push("概要に最新の現在地の中身が出ていません。");
  }
  if (!(await visibleText(page, ".agent-work-panel h2", "Recent AI work"))) {
    failures.push("概要にRecent AI workが出ていません。");
  }
  // 「いま分かっていること」は出典つきで、押すと元の記録へ届く。
  const known = page.locator(".theme-known-panel");
  if (!(await known.first().isVisible())) {
    failures.push("概要に「いま分かっていること」が出ていません。");
  } else {
    const knownText = await known.innerText();
    for (const expected of [
      "現在地",
      "報告書",
      "Knowledge",
      SEEDED_REPORT_TITLE,
      SEEDED_KNOWLEDGE_TITLE,
    ]) {
      if (!knownText.includes(expected)) {
        failures.push(`「いま分かっていること」に${expected}が出ていません。`);
      }
    }
  }
  // 概要だけを見せる。他の面の内容はここへ混ざらない。
  for (const [selector, label] of [
    [".report-section h2", "報告書・重要文書"],
    [".task-sections-panel h2", "タスクセクション"],
    [".theme-post", "投稿"],
  ]) {
    if (await page.locator(selector).first().isVisible()) {
      failures.push(`概要に${label}が混ざっています。`);
    }
  }
  // RepositoryとAI Packは日常の概要より前に出さず、畳んだ先で同じ操作を使える。
  if (await page.locator(".theme-repository-panel").first().isVisible()) {
    failures.push("「連携と設定」を開く前にRepositoryが見えています。");
  }
  if (await page.locator(".theme-ai-pack-panel").first().isVisible()) {
    failures.push("「連携と設定」を開く前にAI Packが見えています。");
  }
  await page.screenshot({ path: `${OUT_DIR}/overview.png`, fullPage: true });

  const summary = page.locator(".theme-settings > summary").first();
  if (!(await summary.count())) {
    failures.push("「連携と設定」の折り畳みがありません。");
    return;
  }
  await summary.click();
  await page.waitForTimeout(400);
  if (!(await page.locator(".theme-repository-panel").first().isVisible())) {
    failures.push("「連携と設定」を開いてもRepositoryが出ません。");
  }
  if (!(await page.locator(".theme-repository-panel button", { hasText: "登録・変更" }).count())) {
    failures.push("Repositoryの「登録・変更」が残っていません。");
  }
  if (!(await visibleText(page, ".theme-ai-pack-panel h2", "M365向け AI Pack"))) {
    failures.push("「連携と設定」を開いてもAI Packが出ません。");
  }
  if (!(await page.locator(".theme-ai-pack-panel button", { hasText: "Preview" }).count())) {
    failures.push("AI PackのPreviewが残っていません。");
  }
  await page.screenshot({ path: `${OUT_DIR}/overview-settings.png`, fullPage: true });
  // 既定へ戻し、次の面と同じ条件で比べられるようにする。
  await summary.click();
  await page.waitForTimeout(300);
  if (await page.locator(".theme-repository-panel").first().isVisible()) {
    failures.push("「連携と設定」を畳めません。");
  }
}

/** 3. タスクの面。既存の未完了・完了とセクションへ一度で届く。 */
async function auditTasks(page) {
  if ((await selectedTab(page)) !== "タスク") {
    failures.push(`タスクの面が選ばれていません（${await selectedTab(page)}）。`);
  }
  if (!(await visibleText(page, ".theme-tab-panel h2", "未完了"))) {
    failures.push("タスクの面に未完了が出ていません。");
  }
  if (!(await page.locator("#theme-panel-tasks").innerText()).includes(SEEDED_TASK_TITLE)) {
    failures.push("タスクの面に未完了のTaskが出ていません。");
  }
  if (!(await visibleText(page, ".theme-tab-panel h2", "完了・やったこと"))) {
    failures.push("タスクの面に完了・やったことが出ていません。");
  }
  if (!(await visibleText(page, ".task-sections-panel h2", "タスクセクション"))) {
    failures.push("タスクの面にタスクセクションが出ていません。");
  }
  await page.screenshot({ path: `${OUT_DIR}/tasks.png`, fullPage: true });
}

/** 4. 投稿の面。Themeに紐づく投稿だけを短く読み、記事はFeedへ渡す。 */
async function auditPosts(page) {
  if ((await selectedTab(page)) !== "投稿") {
    failures.push(`投稿の面が選ばれていません（${await selectedTab(page)}）。`);
  }
  const post = page.locator(".theme-post").first();
  if (!(await post.count())) {
    failures.push("投稿の面にThemeの投稿が出ていません。");
    return;
  }
  const text = await post.innerText();
  for (const expected of [SEEDED_POST_BODY, SEEDED_POST_AUTHOR, SEEDED_POST_KIND]) {
    if (!text.includes(expected)) failures.push(`投稿の面に${expected}が出ていません。`);
  }
  const avatarClass = await post.locator(".feed-avatar").first().getAttribute("class");
  if (!avatarClass?.includes("feed-avatar-ai") || !avatarClass.includes("feed-avatar-codex")) {
    failures.push(`投稿のアバターがFeedと同じ出所表示ではありません（${avatarClass}）。`);
  }
  if (!(await post.locator(".feed-ai-badge").count())) {
    failures.push("AIの投稿にAI表記がありません。");
  }
  if (!/返信 \d+件/u.test(text)) {
    failures.push(`投稿に返信数が出ていません（${text.slice(0, 40)}）。`);
  }
  const readArticle = post.locator(".theme-post-foot button", { hasText: "記事を読む" }).first();
  if (!(await readArticle.count())) {
    failures.push("記事つきの投稿に「記事を読む」がありません。");
  }
  // 会話と記事の全文はFeedで読む。Theme側では複製しない。
  if (await page.locator(".theme-post .markdown-preview-content").count()) {
    failures.push("投稿の面に記事本文が描かれています。");
  }
  await page.screenshot({ path: `${OUT_DIR}/posts.png`, fullPage: true });

  if (await readArticle.count()) {
    await readArticle.click();
    await page.waitForTimeout(1500);
    if (!(await page.locator(".feed-page").first().isVisible())) {
      failures.push("「記事を読む」でFeedへ移動しません。");
    } else {
      const thread = page.locator(".feed-thread-panel").first();
      if (!(await thread.count())) {
        failures.push("「記事を読む」で元の投稿の会話が開きません。");
      } else if (!(await thread.innerText()).includes(SEEDED_POST_BODY)) {
        failures.push("開いた会話が、Themeで押した投稿ではありません。");
      }
    }
    await page.screenshot({ path: `${OUT_DIR}/handoff-thread.png`, fullPage: true });
    await openTheme(page);
    if ((await selectedTab(page)) !== "投稿") {
      failures.push(`Feedから戻ると選んだ面が復元されません（${await selectedTab(page)}）。`);
    }
  }
}

/** 5. Notesの面。報告書と最近のNote、Artifactへ一度で届く。 */
async function auditNotes(page) {
  if ((await selectedTab(page)) !== "Notes") {
    failures.push(`Notesの面が選ばれていません（${await selectedTab(page)}）。`);
  }
  if (!(await visibleText(page, ".report-section h2", "報告書・重要文書"))) {
    failures.push("Notesの面に報告書・重要文書が出ていません。");
  }
  if (!(await page.locator(".report-row", { hasText: SEEDED_REPORT_TITLE }).count())) {
    failures.push("Notesの面に用意した報告書が出ていません。");
  }
  if (!(await visibleText(page, ".theme-recent-notes h2", "最近のNote"))) {
    failures.push("Notesの面に最近のNoteが出ていません。");
  }
  await page.screenshot({ path: `${OUT_DIR}/notes.png`, fullPage: true });
}

/**
 * 6. 面の選択は画面を離れても残る。
 * タスクへ切り替え、別の画面へ移動して戻ったときに、同じ面が開くことを見る。
 */
async function auditTabRestore(page) {
  await selectTab(page, "タスク");
  const notesNav = page.locator(".sidebar button", { hasText: "Notes" }).first();
  if (!(await notesNav.count())) {
    failures.push("SidebarにNotesの入口がありません。");
    return;
  }
  await notesNav.click();
  await page.waitForTimeout(1200);
  await openTheme(page);
  if ((await selectedTab(page)) !== "タスク") {
    failures.push(`別画面から戻ると選んだ面が復元されません（${await selectedTab(page)}）。`);
  }
  if (!(await visibleText(page, ".theme-tab-panel h2", "未完了"))) {
    failures.push("別画面から戻ったタスクの面に未完了が出ていません。");
  }
  // 四面は移動後も同じように使える。
  for (const [label, heading] of [
    ["概要", "現在地"],
    ["投稿", "投稿"],
    ["Notes", "報告書・重要文書"],
  ]) {
    await selectTab(page, label);
    if (!(await visibleText(page, ".theme-tab-panel h2", heading))) {
      failures.push(`${label}の面へ戻れません。`);
    }
  }
}

/** 7. 幅ごとに、どの面も横へはみ出さない。 */
async function auditWidths(app, page) {
  for (const size of SIZES) {
    await app.evaluate(
      ({ BrowserWindow }, value) =>
        BrowserWindow.getAllWindows()[0].setSize(value.width, value.height),
      size,
    );
    await page.waitForTimeout(700);
    for (const label of TAB_LABELS) {
      await selectTab(page, label);
      await page.evaluate(() => window.scrollTo(0, 0));
      const overflow = await measureOverflow(page);
      if (overflow.page > 1) {
        failures.push(`${size.label}: ${label}の面が横へはみ出しています（${overflow.page}px）。`);
      }
      if (overflow.document > 1) {
        failures.push(`${size.label}: ${label}の面で画面全体に横スクロールがあります。`);
      }
      await page.screenshot({ path: `${OUT_DIR}/${size.label}-${label}.png`, fullPage: true });
    }
  }
}

try {
  const session = await launchApp();
  try {
    await openTheme(session.page);
    await auditTabs(session.page);
    await auditOverview(session.page);
    await selectTab(session.page, "タスク");
    await auditTasks(session.page);
    await selectTab(session.page, "投稿");
    await auditPosts(session.page);
    await selectTab(session.page, "Notes");
    await auditNotes(session.page);
    await auditTabRestore(session.page);
    await auditWidths(session.app, session.page);
  } finally {
    await session.app.close();
  }
} finally {
  rmSync(userDataDir, { recursive: true, force: true });
}

if (failures.length) {
  console.error(`Theme監査で${failures.length}件の問題を検出しました。`);
  for (const failure of failures) console.error(`  NG ${failure}`);
  console.error(`スクリーンショット: ${OUT_DIR}`);
  process.exit(1);
}
console.log(
  `Theme監査: OK（四面の切り替え、概要の投影、投稿からFeedへの受け渡し、タスクの復元、横はみ出しなし。スクリーンショットは ${OUT_DIR}）`,
);
