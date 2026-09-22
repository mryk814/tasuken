/**
 * Today の日付操作の実動監査（#454）
 *
 * 一時userDataへ架空のTaskとScheduleを仕込んでからアプリを起動し、
 * 「扱う日を変更」が締切を動かさないこと、「期限の確認」が実行一覧と重複しないことを実測する。
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
seedTask("today-b", "評価条件の回答をまとめる", null, yesterday);
seedTask("today-c", "劣化試験の計画を立てる", tomorrow, yesterday);
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
  const deadlineTitles = await page.locator(".today-deadline-row").allInnerTexts();
  const joined = (list) => list.join("\n");

  // 1. 今日扱うと明示したTaskだけが実行一覧に丸ごと出る。
  if (!joined(executionTitles).includes("引張試験の結果を比較する")) {
    failures.push("今日扱うTaskが実行一覧にありません。");
  }
  // 2. 締切が今日以前で、今日扱うと明示していないTaskは「期限の確認」へ出る。
  for (const title of ["評価条件の回答をまとめる", "劣化試験の計画を立てる"]) {
    if (!joined(deadlineTitles).includes(title)) {
      failures.push(`「期限の確認」に ${title} がありません。`);
    }
    if (joined(executionTitles).includes(title)) {
      failures.push(`${title} が実行一覧と期限の確認に重複しています。`);
    }
  }
  // 3. 期限の確認は締切と、扱う日が決まっていればその日を併記する。
  if (!joined(deadlineTitles).includes(`締切 ${fmt(yesterday)}`)) {
    failures.push(`「期限の確認」に締切の日付が出ていません: ${joined(deadlineTitles)}`);
  }
  await page.screenshot({ path: `${OUT_DIR}/today-list.png`, fullPage: true });

  // 4. 実行一覧の「扱う日を変更」に5つの選択肢がある。
  const targetRow = page.locator(".today-task-row", { hasText: "引張試験の結果を比較する" });
  const menuButton = targetRow.locator(".today-date-button").first();
  if (!(await menuButton.count())) throw new Error("実行一覧から扱う日を変更できません。");
  await menuButton.click();
  await page.waitForTimeout(300);
  const menu = page.locator(".today-date-menu");
  if (!(await menu.isVisible())) failures.push("扱う日のメニューが開きません。");
  const menuLabels = (await menu.innerText()).replace(/\s+/g, " ");
  for (const label of ["今日", "明日", "来週", "日付を選ぶ", "今日の選択を外す"]) {
    if (!menuLabels.includes(label)) failures.push(`扱う日のメニューに「${label}」がありません。`);
  }
  await page.screenshot({ path: `${OUT_DIR}/today-date-menu.png` });
  await page.keyboard.press("Escape");
  await page.waitForTimeout(300);

  // 5. 「期限の確認」の「明日扱う」は today_date だけを変え、締切を動かさない。
  const deadlineRow = page.locator(".today-deadline-row", {
    hasText: "評価条件の回答をまとめる",
  });
  await deadlineRow.locator("button", { hasText: "明日扱う" }).first().click();
  await page.waitForTimeout(1200);

  // 「劣化試験」も明日扱いのため、行を限定して確かめる。
  const afterJoined = joined(
    await page
      .locator(".today-deadline-row", { hasText: "評価条件の回答をまとめる" })
      .allInnerTexts(),
  );
  if (!afterJoined.includes("評価条件の回答をまとめる")) {
    failures.push("明日扱いへ変えたTaskが期限の確認から消えました。");
  }
  if (!afterJoined.includes(`${fmt(tomorrow)}扱う`)) {
    failures.push(`扱う日の併記がありません: ${afterJoined}`);
  }
  if (!afterJoined.includes(`締切 ${fmt(yesterday)}`)) {
    failures.push("扱う日の変更で締切が動きました。");
  }

  const toast = page.locator(".toast");
  const toastText = (await toast.count()) ? await toast.innerText() : "";
  if (!toastText.includes("締切")) {
    failures.push(`締切が変わっていないことを説明していません: ${toastText}`);
  }
  if (!toastText.includes("元に戻す")) failures.push("Undoがトーストにありません。");
  await page.screenshot({ path: `${OUT_DIR}/today-after-change.png`, fullPage: true });

  // 6. Undoで扱う日が元に戻る。締切は最初から動いていない。
  await toast.locator("button", { hasText: "元に戻す" }).first().click();
  await page.waitForTimeout(1500);
  const undoToast = (await page.locator(".toast").count())
    ? await page.locator(".toast").innerText()
    : "";
  const undone = joined(
    await page
      .locator(".today-deadline-row", { hasText: "評価条件の回答をまとめる" })
      .allInnerTexts(),
  );
  if (undone.includes(`${fmt(tomorrow)}扱う`)) {
    failures.push(`Undoで扱う日が戻りません。トースト: ${undoToast} / 行: ${undone}`);
  }
  if (!undone.includes(`締切 ${fmt(yesterday)}`)) {
    failures.push("Undoで締切が変わりました。");
  }
  await page.screenshot({ path: `${OUT_DIR}/today-after-undo.png`, fullPage: true });

  // 7. 扱う日を明日へ変えると実行一覧から外れ、締切は動かない。
  const executionRow = page.locator(".today-task-row", { hasText: "引張試験の結果を比較する" });
  await executionRow.locator(".today-date-button").first().click();
  await page.waitForTimeout(300);
  await page.locator(".today-date-menu").locator("button", { hasText: "明日" }).first().click();
  await page.waitForTimeout(1200);
  const movedOut = joined(await page.locator(".today-task-list .today-task-row").allInnerTexts());
  if (movedOut.includes("引張試験の結果を比較する")) {
    failures.push("明日へ回したTaskが実行一覧に残っています。");
  }
  // 締切は未来のまま。期限超過ではないので「期限の確認」へは移らない。
  const movedIn = joined(await page.locator(".today-deadline-row").allInnerTexts());
  if (movedIn.includes("引張試験の結果を比較する")) {
    failures.push("締切が未来のTaskが期限の確認に出ています。");
  }
  // 締切そのものは動いていない。9月25日相当のTaskが今週の候補棚に残る。
  const movedDeadline = joined(
    await page.locator(".task-shelf-lane", { hasText: "今週" }).allInnerTexts(),
  );
  if (!movedDeadline.includes("引張試験の結果を比較する")) {
    failures.push(`扱う日の変更で締切の位置が動きました: ${movedDeadline}`);
  }

  // 8. 狭幅でも横スクロールを出さない。
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
