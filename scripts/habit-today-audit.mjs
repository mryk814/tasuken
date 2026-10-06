/**
 * Habitの最小実験（#454後半 / O単位）の実画面監査。
 *
 * 隔離した一時userDataでビルド済みアプリを起動し、Habitの追加（Settings）→ Todayでの記録 →
 * 取消 → もう1回記録 → 履歴からの実施日修正 → 一時停止と再開 → 削除と元に戻す →
 * 再起動後の保持までを実測する。Habitが無いときにTodayへ空の案内を常設しないことも確認する。
 *
 *   npm run build && npm run audit:habit
 *
 * 出力先は output/playwright/habit-audit。失敗時は終了コード1。
 * 正本は `docs/habit-experiment.md` と `docs/issue-design-plan-2026-09-20.md` の「Habitの最小実験」。
 */
import { _electron as electron } from "playwright";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";

const OUT_DIR = process.argv[2] || "output/playwright/habit-audit";
const ZOOM_STORAGE_KEY = "tasken:shell:zoom-factor:v1";
const HABIT_TITLE = "読書";
const WEEKLY_TARGET = 3;

function isoDaysAgo(days) {
  const date = new Date();
  date.setDate(date.getDate() - days);
  return [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, "0"),
    String(date.getDate()).padStart(2, "0"),
  ].join("-");
}

/** 今週（月曜開始）の外へ出すための日付。 */
function lastWeekDate() {
  const date = new Date();
  const offset = (date.getDay() + 6) % 7;
  date.setDate(date.getDate() - offset - 3);
  return [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, "0"),
    String(date.getDate()).padStart(2, "0"),
  ].join("-");
}

mkdirSync(OUT_DIR, { recursive: true });
const userDataDir = mkdtempSync(path.join(os.tmpdir(), "tasken-habit-audit-"));
const failures = [];

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

async function openToday(page) {
  const nav = page.locator(".sidebar button", { hasText: "Today" }).first();
  if (!(await nav.count())) throw new Error("SidebarにTodayの入口がありません。");
  await nav.click();
  await page.waitForTimeout(900);
}

async function openHabitSettings(page) {
  await page.locator(".sidebar button", { hasText: "Settings" }).first().click();
  await page.waitForTimeout(700);
  await page.locator(".settings-category-nav button", { hasText: "Habits" }).first().click();
  await page.waitForTimeout(400);
}

// Settingsの管理面（追加・履歴・一時停止・削除）。
const habitPanel = (page) => page.locator(".habit-panel").first();
// Todayでは「今日やること」の中にTaskと同じ行で並ぶ（2026-10-06）。
const habitRow = (page) =>
  page.locator(".today-routine-list .routine-row", { hasText: HABIT_TITLE }).first();

async function progressText(page) {
  return (await habitPanel(page).locator(".habit-progress").first().innerText()).replace(
    /\s+/gu,
    " ",
  );
}

async function rowText(page) {
  return (await habitRow(page).innerText()).replace(/\s+/gu, " ");
}

async function withApp(run) {
  const session = await launchApp();
  try {
    return await run(session.page);
  } finally {
    await session.app.close();
  }
}

// 1. Habitが無いTodayへ、空の設定案内を常設しない。
await withApp(async (page) => {
  await openToday(page);
  if (await page.locator(".today-routine-list .routine-row, .habit-panel").count()) {
    failures.push("Habitが無いのにTodayへ「続けること」が出ています。");
  }
  await page.screenshot({ path: `${OUT_DIR}/today-empty.png`, fullPage: true });

  // 2. Settingsで追加する（名前・週N回・週の区切りは月曜開始の案内）。
  await openHabitSettings(page);
  const settingsPanel = habitPanel(page);
  if (!(await settingsPanel.count())) failures.push("SettingsにHabitの管理面がありません。");
  await settingsPanel
    .locator(".section-heading button", { hasText: "続けることを追加" })
    .first()
    .click();
  await page.waitForTimeout(300);
  await page.locator(".habit-create input").first().fill(HABIT_TITLE);
  await page.locator(".habit-create select").first().selectOption("weekly");
  await page.waitForTimeout(200);
  const targetInput = page.locator(".habit-create input[type=number]").first();
  await targetInput.fill(String(WEEKLY_TARGET));
  await page.screenshot({ path: `${OUT_DIR}/settings-create.png`, fullPage: true });
  await page.locator(".habit-create button", { hasText: "追加する" }).first().click();
  await page.waitForTimeout(1200);
  if (!(await settingsPanel.locator(".habit-row", { hasText: HABIT_TITLE }).count())) {
    failures.push("SettingsでHabitを追加できません。");
  }

  // 3. Todayへ戻ると、Taskと同じ行で目標と今週の進みが出る。
  await openToday(page);
  if (!(await habitRow(page).count())) {
    failures.push("Habitを追加してもTodayに「続けること」の行が出ません。");
    return;
  }
  const initial = await rowText(page);
  if (!initial.includes(`週${WEEKLY_TARGET}回`) || !initial.includes(`今週0/${WEEKLY_TARGET}回`)) {
    failures.push(`追加直後の行が違います（${initial}）。`);
  }

  // 4. 丸を押すと1回記録され、丸が済みになる。
  await page.getByRole("button", { name: `${HABIT_TITLE}を1回記録` }).click();
  await page.waitForTimeout(1200);
  const once = await rowText(page);
  if (!once.includes(`今週1/${WEEKLY_TARGET}回`)) {
    failures.push(`1回記録のあとの進みが違います（${once}）。`);
  }
  if (!(await habitRow(page).evaluate((node) => node.classList.contains("is-done")))) {
    failures.push("記録後に丸が済みになっていません。");
  }
  await page.screenshot({ path: `${OUT_DIR}/today-recorded.png`, fullPage: true });

  // 5. 済みの丸をもう一度押すと、今日の記録を取り消す（Taskの完了を戻すのと同じ）。
  await page.getByRole("button", { name: `${HABIT_TITLE}の今日の記録を取り消す` }).click();
  await page.waitForTimeout(1200);
  const undone = await rowText(page);
  if (!undone.includes(`今週0/${WEEKLY_TARGET}回`)) {
    failures.push(`取消のあとの進みが違います（${undone}）。`);
  }

  // 6. 同じ日に「+1回」で2回目を記録すると、別の記録として2回になる。
  await page.getByRole("button", { name: `${HABIT_TITLE}を1回記録` }).click();
  await page.waitForTimeout(1000);
  await page.getByRole("button", { name: `${HABIT_TITLE}をもう1回記録` }).click();
  await page.waitForTimeout(1200);
  const twice = await rowText(page);
  if (!twice.includes("今日2回") || !twice.includes(`今週2/${WEEKLY_TARGET}回`)) {
    failures.push(`同じ日の2回目が別記録になっていません（${twice}）。`);
  }

  // 7. 履歴（Settings）から実施日を直すと、今週の数が変わる（記録は増えない）。
  await openHabitSettings(page);
  const panel = habitPanel(page);
  await panel.locator("button", { hasText: "履歴" }).first().click();
  await page.waitForTimeout(400);
  const rows = panel.locator(".habit-history-row");
  if ((await rows.count()) !== 2)
    failures.push(`履歴が2件ではありません（${await rows.count()}件）。`);
  await page.screenshot({ path: `${OUT_DIR}/settings-history.png`, fullPage: true });
  await rows.first().locator("input[type=date]").fill(lastWeekDate());
  await rows.first().locator("button", { hasText: "実施日を修正" }).click();
  await page.waitForTimeout(1200);
  const corrected = await progressText(page);
  if (!corrected.includes("今日1回") || !corrected.includes(`今週1/${WEEKLY_TARGET}回`)) {
    failures.push(`実施日の修正が今週の数へ反映されていません（${corrected}）。`);
  }
  if ((await rows.count()) !== 2) failures.push("実施日の修正で記録が増えています。");

  // 8. 一時停止するとTodayから外れ、再開すると戻る。過去の記録は変わらない。
  await panel.locator("button", { hasText: "一時停止" }).first().click();
  await page.waitForTimeout(1200);
  if (!(await panel.locator(".habit-state", { hasText: "一時停止中" }).count())) {
    failures.push("一時停止が表示されていません。");
  }
  if (!(await progressText(page)).includes(`今週1/${WEEKLY_TARGET}回`)) {
    failures.push("一時停止で過去の記録が変わりました。");
  }
  await openToday(page);
  if (await habitRow(page).count()) failures.push("一時停止中のHabitがTodayに残っています。");
  await openHabitSettings(page);
  await habitPanel(page).locator("button", { hasText: "再開" }).first().click();
  await page.waitForTimeout(1200);
  await openToday(page);
  if (!(await habitRow(page).count())) failures.push("再開してもTodayに戻りません。");
  await page.screenshot({ path: `${OUT_DIR}/today-paused-resumed.png`, fullPage: true });
});

// 9. 再起動しても記録と進みが残る。
await withApp(async (page) => {
  await openToday(page);
  if (!(await habitRow(page).count())) {
    failures.push("再起動後に「続けること」が消えています。");
    return;
  }
  const progress = await rowText(page);
  if (!progress.includes(`今週1/${WEEKLY_TARGET}回`)) {
    failures.push(`再起動後の進みが違います（${progress}）。`);
  }
  await page.screenshot({ path: `${OUT_DIR}/today-restart.png`, fullPage: true });

  // 10. 削除と元に戻す。削除するとTodayから消える。
  await openHabitSettings(page);
  await habitPanel(page).locator("button", { hasText: "削除" }).first().click();
  await page.waitForTimeout(1200);
  await openToday(page);
  if (await habitRow(page).count()) {
    failures.push("削除したHabitがTodayに残っています。");
  }
  const undo = page.locator(".toast button", { hasText: "元に戻す" }).first();
  if (!(await undo.count())) {
    failures.push("削除のUndoが出ていません。");
  } else {
    await undo.click();
    await page.waitForTimeout(1500);
    if (!(await habitRow(page).count())) {
      failures.push("削除を元に戻してもTodayに戻りません。");
    } else if (!(await rowText(page)).includes(`今週1/${WEEKLY_TARGET}回`)) {
      failures.push("元に戻したHabitの記録が戻っていません。");
    }
  }
  await page.screenshot({ path: `${OUT_DIR}/today-undo-delete.png`, fullPage: true });
});

rmSync(userDataDir, { recursive: true, force: true });

if (failures.length) {
  console.error(`Habit監査で${failures.length}件の問題を検出しました。`);
  for (const failure of failures) console.error(`  NG ${failure}`);
  console.error(`スクリーンショット: ${OUT_DIR}`);
  process.exit(1);
}
console.log(`Habit監査: OK（記録・取消・履歴の修正・一時停止・削除とUndo・再起動、${OUT_DIR}）`);
