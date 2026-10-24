/**
 * Today の日付操作の実動監査（#454）
 *
 * 一時userDataへ架空のTaskとScheduleを仕込んでからアプリを起動し、
 * 「扱う日を変更」が締切を動かさないこと、締切当日のTaskが実行一覧に出ることを実測する。
 * 「期限の確認」セクションの廃止後（2026-09-24）は、締切の受け皿は
 * 実行一覧（締切当日）と候補棚「期限切れ」（締切過去）に分かれる。
 * スクリーンショットを撮るだけで終わらせず、保存後の値と表示を突き合わせる。
 *
 *   npm run build && npm run audit:today-dates
 *
 * Electron ABIのbetter-sqlite3でfixtureを仕込むため、`scripts/run-electron-node.mjs` 経由で実行する。
 */
import { _electron as electron } from "playwright";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";

// playwrightはprocess.envを引き継ぐ。起動するElectronがNodeモードにならないよう外す。
delete process.env.ELECTRON_RUN_AS_NODE;

const OUT_DIR = process.argv[2] || "output/playwright/today-date-audit";
const ZOOM_STORAGE_KEY = "tasken:shell:zoom-factor:v1";

function localDate(offsetDays = 0) {
  const date = new Date();
  date.setDate(date.getDate() + offsetDays);
  const pad = (value) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

const today = localDate(0);
const yesterday = localDate(-1);
const tomorrow = localDate(1);
const later = localDate(5);
/** 画面の formatDate と同じ表記。 */
const fmt = (value) => value.replace(/-/g, "/");

mkdirSync(OUT_DIR, { recursive: true });
const userDataDir = mkdtempSync(path.join(os.tmpdir(), "tasken-today-audit-"));
const failures = [];
const { WorkspaceDatabase } = await import("../src/main/repositories/workspaceRepository.mjs");

// 起動前に正本データを仕込む。アプリと同じschema・同じ保存経路を使う。
const seed = new WorkspaceDatabase(path.join(userDataDir, "research-desk.sqlite"));
seed.loadWorkspace();
const personalThemeId = "theme-personal-default";
function seedTask(id, title, todayDate, deadline, state = "todo") {
  seed.save("task", {
    id,
    title,
    state,
    project_id: personalThemeId,
    today_date: todayDate,
  });
  seed.save("schedule", {
    id: `schedule-${id}`,
    owner_type: "task",
    owner_id: id,
    end_date: deadline,
    date_kind: "deadline",
    confidence: "fixed",
    granularity: "day",
  });
}
seedTask("today-a", "引張試験の結果を比較する", today, later);
// 今日締切で今日扱うと明示していないTask。共通selectorのdueとして実行一覧に出る。
seedTask("today-b", "評価条件の回答をまとめる", null, today);
// 締切が過去のTask。実行一覧には出さず、候補棚「期限切れ」に出る。
seedTask("today-c", "劣化試験の計画を立てる", tomorrow, yesterday);
seedTask("today-d", "保全見積りの棚卸しをする", null, yesterday);
seed.db.close();

const app = await electron.launch({
  args: [".", "--disable-gpu", "--disable-gpu-compositing", `--user-data-dir=${userDataDir}`],
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
  await page.waitForTimeout(3500);

  const todayTab = page.locator(".sidebar button", { hasText: "Today" }).first();
  if (!(await todayTab.count())) throw new Error("SidebarにTodayの入口がありません。");
  await todayTab.click();
  await page.waitForTimeout(1200);

  const executionTitles = await page.locator(".today-task-list .today-task-row").allInnerTexts();
  const executionJoined = executionTitles.join("\n");
  const overdueShelf = page.locator(".task-shelf-lane", { hasText: "期限切れ" }).first();
  const shelfText = (await overdueShelf.innerText()).replace(/\s+/g, " ");

  // 1. 今日扱うと明示したTaskと、締切が当日のTask（明示なし）が実行一覧に出る。
  for (const title of ["引張試験の結果を比較する", "評価条件の回答をまとめる"]) {
    if (!executionJoined.includes(title)) {
      failures.push(`締切が今日のTask ${title} が実行一覧にありません。`);
    }
  }
  // 2. 締切が過去のTaskは実行一覧に出さず、候補棚「期限切れ」に出る。
  for (const title of ["劣化試験の計画を立てる", "保全見積りの棚卸しをする"]) {
    if (executionJoined.includes(title)) {
      failures.push(`締切が過去の ${title} が実行一覧に出ています。`);
    }
    if (!shelfText.includes(title)) {
      failures.push(`候補棚「期限切れ」に ${title} がありません。`);
    }
  }
  // 3. 候補棚に実行一覧のTaskを二重表示しない。
  for (const title of ["引張試験の結果を比較する", "評価条件の回答をまとめる"]) {
    if (shelfText.includes(title)) {
      failures.push(`${title} が実行一覧と候補棚に重複しています。`);
    }
  }
  // 4. 締切当日の行は当日の日付を持つ。
  const dueTodayRow = page.locator(".today-task-row", { hasText: "評価条件の回答をまとめる" });
  const dueTodayRowText = (await dueTodayRow.allInnerTexts()).join("\n");
  if (!dueTodayRowText.includes(fmt(today))) {
    failures.push(`締切当日の行に当日の日付が出ていません: ${dueTodayRowText}`);
  }
  await page.screenshot({ path: `${OUT_DIR}/today-list.png`, fullPage: true });

  // 5. 「扱う日を変更」の選択肢。扱う日が未設定の行には「今日の選択を外す」を出さない。
  const menu = page.locator(".today-date-menu");
  const menuButton = dueTodayRow.locator(".today-date-button").first();
  if (!(await menuButton.count())) throw new Error("実行一覧から扱う日を変更できません。");
  await menuButton.click();
  await page.waitForTimeout(300);
  if (!(await menu.isVisible())) failures.push("扱う日のメニューが開きません。");
  const unselectedMenu = (await menu.innerText()).replace(/\s+/g, " ");
  for (const label of ["今日", "明日", "来週", "日付を選ぶ"]) {
    if (!unselectedMenu.includes(label))
      failures.push(`扱う日のメニューに「${label}」がありません。`);
  }
  if (unselectedMenu.includes("今日の選択を外す")) {
    failures.push("扱う日が未設定の行に「今日の選択を外す」が出ています。");
  }
  await page.screenshot({ path: `${OUT_DIR}/today-date-menu.png` });
  await page.keyboard.press("Escape");
  await page.waitForTimeout(300);

  // 5b. 扱う日が設定済みの行には「今日の選択を外す」もある。
  const explicitRow = page.locator(".today-task-row", { hasText: "引張試験の結果を比較する" });
  await explicitRow.locator(".today-date-button").first().click();
  await page.waitForTimeout(300);
  const selectedMenu = (await menu.innerText()).replace(/\s+/g, " ");
  if (!selectedMenu.includes("今日の選択を外す")) {
    failures.push("扱う日が設定済みの行に「今日の選択を外す」がありません。");
  }
  await page.keyboard.press("Escape");
  await page.waitForTimeout(300);

  // 6. 「明日扱う」は today_date だけを変え、締切は動かさない。
  //    締切が当日のTaskは改めて締切当日になり続けるため、実行一覧に残る。
  await dueTodayRow.locator(".today-date-button").first().click();
  await page.waitForTimeout(300);
  await page.locator(".today-date-menu").locator("button", { hasText: "明日" }).first().click();
  await page.waitForTimeout(1200);
  const afterDeferJoined = (
    await page.locator(".today-task-list .today-task-row").allInnerTexts()
  ).join("\n");
  if (!afterDeferJoined.includes("評価条件の回答をまとめる")) {
    failures.push("締切当日のTaskが「明日扱う」で実行一覧から消えました。");
  }

  const toast = page.locator(".toast");
  const toastText = (await toast.count()) ? await toast.innerText() : "";
  if (!toastText.includes("締切"))
    failures.push(`締切が変わっていないことを説明していません: ${toastText}`);
  if (!toastText.includes("元に戻す")) failures.push("Undoがトーストにありません。");
  await page.screenshot({ path: `${OUT_DIR}/today-after-change.png`, fullPage: true });

  // 7. Undoで扱う日が元に戻る。締切は最初から動いていない。
  await toast.locator("button", { hasText: "元に戻す" }).first().click();
  await page.waitForTimeout(1500);
  const undoneJoined = (
    await page.locator(".today-task-list .today-task-row").allInnerTexts()
  ).join("\n");
  if (!undoneJoined.includes("評価条件の回答をまとめる")) {
    failures.push(`Undo後にTaskが実行一覧から消えました: ${undoneJoined}`);
  }
  await page.screenshot({ path: `${OUT_DIR}/today-after-undo.png`, fullPage: true });

  // 8. 扱う日を明日へ変えると締切が未来のTaskは実行一覧から外れ、締切は動かない。
  await explicitRow.locator(".today-date-button").first().click();
  await page.waitForTimeout(300);
  await page.locator(".today-date-menu").locator("button", { hasText: "明日" }).first().click();
  await page.waitForTimeout(1200);
  const movedOut = (await page.locator(".today-task-list .today-task-row").allInnerTexts()).join(
    "\n",
  );
  if (movedOut.includes("引張試験の結果を比較する")) {
    failures.push("明日へ回したTaskが実行一覧に残っています。");
  }
  // 締切そのものは動いていない。5日後のTaskが今週の候補棚に残る。
  const movedWeek = (
    await page.locator(".task-shelf-lane", { hasText: "今週" }).first().innerText()
  ).replace(/\s+/g, " ");
  if (!movedWeek.includes("引張試験の結果を比較する")) {
    failures.push(`扱う日の変更で締切の位置が動きました: ${movedWeek}`);
  }

  // 9. 狭幅でも横スクロールを出さない。
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(980, 680));
  await page.waitForTimeout(700);
  const overflowing = await page.evaluate(() => {
    const found = [];
    for (const element of document.querySelectorAll(".main-area, .main-area *")) {
      const style = getComputedStyle(element);
      if (style.display === "none" || style.visibility === "hidden") continue;
      if (element.scrollWidth > element.clientWidth + 1 && element.clientWidth > 0) {
        found.push(
          `${element.tagName.toLowerCase()}.${(element.className?.toString?.() || "").slice(0, 50)}`,
        );
      }
    }
    return found;
  });
  if (overflowing.length) failures.push(`狭幅で横あふれ: ${overflowing.join(", ")}`);
  await page.screenshot({ path: `${OUT_DIR}/today-min-980.png`, fullPage: true });
} finally {
  await app.close();
  rmSync(userDataDir, { recursive: true, force: true });
}

if (failures.length) {
  console.error(`Today日付監査で${failures.length}件の問題を検出しました。`);
  for (const failure of failures) console.error(`  NG ${failure}`);
  console.error(`スクリーンショット: ${OUT_DIR}`);
  process.exit(1);
}
console.log(`Today日付監査: OK（スクリーンショットは ${OUT_DIR}）`);
