/**
 * Maintenanceの最小実験（#454後半 / O単位）の実画面監査。
 *
 * 隔離した一時userDataでビルド済みアプリを起動し、
 * 「前回不明の項目は次の目安を決めるから始まる」→ 次の目安の設定 → Todayには目安が近いものだけが出る →
 * 実施を記録（次の目安を提案）→ 利用者が指定した目安が保存される → 記録と次の目安を一緒に戻す →
 * Taskの期限違反として数えない → 削除と元に戻す → 再起動後の保持 までを実測する。
 *
 *   npm run build && npm run audit:maintenance
 *
 * 出力先は output/playwright/maintenance-audit。失敗時は終了コード1。
 * 正本は `docs/maintenance-experiment.md` と `docs/issue-design-plan-2026-09-20.md`。
 */
import { _electron as electron } from "playwright";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";

const OUT_DIR = process.argv[2] || "output/playwright/maintenance-audit";
const ZOOM_STORAGE_KEY = "tasken:shell:zoom-factor:v1";
const TARGET = "エアコン";
const ACTION = "フィルターを掃除する";
const INTERVAL_DAYS = 31;

function isoOffsetDays(days) {
  const date = new Date();
  date.setDate(date.getDate() + days);
  return [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, "0"),
    String(date.getDate()).padStart(2, "0"),
  ].join("-");
}

mkdirSync(OUT_DIR, { recursive: true });
const userDataDir = mkdtempSync(path.join(os.tmpdir(), "tasken-maintenance-audit-"));
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
  await page.locator(".sidebar button", { hasText: "Today" }).first().click();
  await page.waitForTimeout(900);
}

async function openMaintenanceSettings(page) {
  await page.locator(".sidebar button", { hasText: "Settings" }).first().click();
  await page.waitForTimeout(700);
  await page.locator(".settings-category-nav button", { hasText: "Maintenance" }).first().click();
  await page.waitForTimeout(400);
}

const panel = (page) => page.locator(".maintenance-panel").first();

async function withApp(run) {
  const session = await launchApp();
  try {
    return await run(session.page);
  } finally {
    await session.app.close();
  }
}

// 1. 未使用のTodayへ空の案内を常設しない。
await withApp(async (page) => {
  await openToday(page);
  if (await panel(page).count()) {
    failures.push("手入れが無いのにTodayへ「手入れ」が出ています。");
  }

  // 2. Settingsで追加する。前回不明なのでTodayにはまだ出ない。
  await openMaintenanceSettings(page);
  const manage = panel(page);
  if (!(await manage.count())) failures.push("SettingsにMaintenanceの管理面がありません。");
  await manage.locator(".section-heading button", { hasText: "手入れを追加" }).first().click();
  await page.waitForTimeout(300);
  await page.locator(".maintenance-create input").nth(0).fill(TARGET);
  await page.locator(".maintenance-create input").nth(1).fill(ACTION);
  await page.locator(".maintenance-create input[type=number]").first().fill(String(INTERVAL_DAYS));
  await page.screenshot({ path: `${OUT_DIR}/settings-create.png`, fullPage: true });
  await page.locator(".maintenance-create button", { hasText: "追加する" }).first().click();
  await page.waitForTimeout(1200);
  const row = manage.locator(".maintenance-row").first();
  if (!(await row.count())) {
    failures.push("Settingsで手入れを追加できません。");
    return;
  }
  if (!(await row.locator(".maintenance-due").first().innerText()).includes("次の目安を決める")) {
    failures.push("前回不明の項目が「次の目安を決める」になっていません。");
  }
  if (await page.locator(".toast", { hasText: "期限" }).count()) {
    failures.push("追加しただけで期限の案内が出ています。");
  }

  // 3. 次の目安を決める（Todayには出さない）。
  await row.locator("input[type=date]").first().fill(isoOffsetDays(30));
  await row.locator("button", { hasText: "次の目安を決める" }).first().click();
  await page.waitForTimeout(1200);
  if (!(await row.locator(".maintenance-meta").first().innerText()).includes(isoOffsetDays(30))) {
    failures.push("決めた次の目安が保存されていません。");
  }
  await openToday(page);
  if (await panel(page).count()) {
    failures.push("目安が遠いのにTodayへ「手入れ」が出ています。");
  }

  // 4. 実施を記録する。次の目安は今日から推奨間隔で提案される。
  await openMaintenanceSettings(page);
  const recordRow = panel(page).locator(".maintenance-row").first();
  await recordRow.locator("button", { hasText: "実施を記録" }).first().click();
  await page.waitForTimeout(1500);
  const recordedMeta = await panel(page)
    .locator(".maintenance-row")
    .first()
    .locator(".maintenance-meta")
    .first()
    .innerText();
  if (!recordedMeta.includes(isoOffsetDays(0))) {
    failures.push(`前回実施日が今日になっていません（${recordedMeta}）。`);
  }
  if (!recordedMeta.includes(isoOffsetDays(INTERVAL_DAYS))) {
    failures.push(`次の目安が提案どおりではありません（${recordedMeta}）。`);
  }
  await page.screenshot({ path: `${OUT_DIR}/settings-recorded.png`, fullPage: true });

  // 5. 利用者が指定した次の目安は、その値を保存する。
  const manageRow2 = panel(page).locator(".maintenance-row").first();
  const explicitDue = isoOffsetDays(10);
  await manageRow2.locator("input[type=date]").nth(1).fill(explicitDue);
  await manageRow2.locator("button", { hasText: "実施を記録" }).first().click();
  await page.waitForTimeout(1500);
  const explicitMeta = await panel(page)
    .locator(".maintenance-row")
    .first()
    .locator(".maintenance-meta")
    .first()
    .innerText();
  if (!explicitMeta.includes(explicitDue)) {
    failures.push(`指定した次の目安が保存されていません（${explicitMeta}）。`);
  }
  // 同じ日の2回目は記録を増やさず、次の目安だけを更新する。
  const sameDayHistory = await panel(page)
    .locator(".maintenance-row")
    .first()
    .locator("button", { hasText: "履歴" })
    .first()
    .innerText();
  if (!sameDayHistory.includes("1件")) {
    failures.push(`同じ日の記録が増えています（${sameDayHistory}）。`);
  }

  // 6. 直前の記録を戻すと、実施記録と次の目安の両方が戻る。
  await panel(page).locator("button", { hasText: "直前の記録を戻す" }).first().click();
  await page.waitForTimeout(1500);
  const afterUndo = await panel(page)
    .locator(".maintenance-row")
    .first()
    .locator(".maintenance-meta")
    .first()
    .innerText();
  if (!afterUndo.includes(isoOffsetDays(INTERVAL_DAYS))) {
    failures.push(`戻した後の次の目安が元に戻っていません（${afterUndo}）。`);
  }
  const historyCount = await panel(page)
    .locator(".maintenance-row")
    .first()
    .locator("button", { hasText: "履歴" })
    .first()
    .innerText();
  if (!historyCount.includes("0件")) {
    failures.push(`戻した後の履歴が0件ではありません（${historyCount}）。`);
  }

  // 7. 目安を近くするとTodayに出る（目安が近いものだけを小さく出す）。
  const manageRow3 = panel(page).locator(".maintenance-row").first();
  await manageRow3.locator("input[type=date]").nth(1).fill(isoOffsetDays(2));
  await manageRow3.locator("button", { hasText: "実施を記録" }).first().click();
  await page.waitForTimeout(1500);
  await openToday(page);
  const todayPanel = panel(page);
  if (!(await todayPanel.count())) {
    failures.push("目安が近いのにTodayへ「手入れ」が出ません。");
    return;
  }
  const todayRow = todayPanel.locator(".maintenance-row").first();
  if (!(await todayRow.locator(".maintenance-due").first().innerText()).includes("あと2日")) {
    failures.push("Todayの目安表示が「あと2日」ではありません。");
  }
  await page.screenshot({ path: `${OUT_DIR}/today-due-soon.png`, fullPage: true });

  // 8. 目安を過ぎてもTaskの期限違反として数えない（Todayの期限の確認に出ない）。
  await openMaintenanceSettings(page);
  const overdueRow = panel(page).locator(".maintenance-row").first();
  await overdueRow.locator("input[type=date]").nth(1).fill(isoOffsetDays(-3));
  await overdueRow.locator("button", { hasText: "実施を記録" }).first().click();
  await page.waitForTimeout(1500);
  await panel(page)
    .locator(".maintenance-row")
    .first()
    .locator("button", { hasText: "履歴" })
    .first()
    .click();
  await page.waitForTimeout(300);
  await page.screenshot({ path: `${OUT_DIR}/settings-history.png`, fullPage: true });

  await openToday(page);
  const overdueTodayRow = panel(page).locator(".maintenance-row").first();
  if (
    !(await overdueTodayRow.locator(".maintenance-due").first().innerText()).includes(
      "過ぎています",
    )
  ) {
    failures.push("目安を過ぎた状態がTodayに出ていません。");
  }
  const deadlinePanel = page.locator(".today-deadline-panel").first();
  if (await deadlinePanel.count()) {
    const deadlineText = await deadlinePanel.innerText();
    if (deadlineText.includes(TARGET)) {
      failures.push("手入れの目安がTodayの「期限の確認」に出ています。");
    }
  }
  if ((await page.locator(".toast", { hasText: "期限" }).count()) > 0) {
    failures.push("手入れの目安が期限として案内されています。");
  }
  await page.screenshot({ path: `${OUT_DIR}/today-overdue-no-deadline.png`, fullPage: true });
});

// 9. 再起動しても手入れと記録が残る。削除するとTodayから消え、元に戻すと戻る。
await withApp(async (page) => {
  await openMaintenanceSettings(page);
  const manage = panel(page);
  if (!(await manage.locator(".maintenance-row").count())) {
    failures.push("再起動後に手入れが消えています。");
    return;
  }
  const meta = await manage
    .locator(".maintenance-row")
    .first()
    .locator(".maintenance-meta")
    .first()
    .innerText();
  if (!meta.includes(isoOffsetDays(0))) {
    failures.push(`再起動後に前回実施日が変わっています（${meta}）。`);
  }
  await page.screenshot({ path: `${OUT_DIR}/settings-restart.png`, fullPage: true });

  await manage
    .locator(".maintenance-row")
    .first()
    .locator("button", { hasText: "削除" })
    .first()
    .click();
  await page.waitForTimeout(1200);
  await openToday(page);
  if (await panel(page).count()) {
    failures.push("削除した手入れがTodayに残っています。");
  }
  const undo = page.locator(".toast button", { hasText: "元に戻す" }).first();
  if (!(await undo.count())) {
    failures.push("削除のUndoが出ていません。");
  } else {
    await undo.click();
    await page.waitForTimeout(1500);
    await openMaintenanceSettings(page);
    if (!(await panel(page).locator(".maintenance-row").count())) {
      failures.push("削除を元に戻しても手入れが戻りません。");
    } else if (
      !(
        await panel(page)
          .locator(".maintenance-row")
          .first()
          .locator("button", { hasText: "履歴" })
          .first()
          .innerText()
      ).includes("1件")
    ) {
      failures.push("元に戻した手入れの実施記録が戻っていません。");
    }
  }
  await page.screenshot({ path: `${OUT_DIR}/settings-undo-delete.png`, fullPage: true });
});

rmSync(userDataDir, { recursive: true, force: true });

if (failures.length) {
  console.error(`Maintenance監査で${failures.length}件の問題を検出しました。`);
  for (const failure of failures) console.error(`  NG ${failure}`);
  console.error(`スクリーンショット: ${OUT_DIR}`);
  process.exit(1);
}
console.log(
  `Maintenance監査: OK（次の目安・実施の記録・指定した目安・Undo・Taskの期限に数えない・削除とUndo・再起動、${OUT_DIR}）`,
);
