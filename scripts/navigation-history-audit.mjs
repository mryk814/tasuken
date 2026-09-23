/**
 * 画面移動の目視・操作監査。
 *
 * 隔離した一時userDataでビルド済みアプリを起動し、タイトルバーの「前の画面」
 * 「次の画面」がroute単位の履歴どおりに動くことを実測する。選択状態や
 * ドロワーの復元までは対象にせず、各画面の既存の保持に任せる。
 *
 *   npm run build && npm run audit:navigation
 *
 * 出力先は output/playwright/navigation-audit。失敗時は終了コード1。
 */
import { _electron as electron } from "playwright";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";

const OUT_DIR = "output/playwright/navigation-audit";
const ZOOM_STORAGE_KEY = "tasken:shell:zoom-factor:v1";

mkdirSync(OUT_DIR, { recursive: true });
const userDataDir = mkdtempSync(path.join(os.tmpdir(), "tasken-navigation-audit-"));
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

function routeButton(page, label) {
  return page.locator(".sidebar button", { hasText: label }).first();
}

function backButton(page) {
  return page.locator('.app-titlebar button[aria-label^="前の画面に戻る"]').first();
}

function forwardButton(page) {
  return page.locator('.app-titlebar button[aria-label^="次の画面に進む"]').first();
}

async function activeRouteLabel(page) {
  return page.evaluate(
    () =>
      document.querySelector('.sidebar button[aria-current="page"]')?.getAttribute("aria-label") ??
      "",
  );
}

async function waitForActiveRoute(page, label) {
  await page.waitForFunction(
    (expected) =>
      document.querySelector('.sidebar button[aria-current="page"]')?.getAttribute("aria-label") ===
      expected,
    label,
  );
}

/**
 * route変更と履歴更新は別の描画で起きるため、ボタン状態が落ち着くまで待つ。
 * 固定待ちにしない。
 */
async function waitForRouteHistory(page, expectedBackLabel, expectedForward) {
  await page.waitForFunction(
    ([backLabel, forwardEnabled]) => {
      const back = document.querySelector('.app-titlebar button[aria-label^="前の画面に戻る"]');
      const forward = document.querySelector('.app-titlebar button[aria-label^="次の画面に進む"]');
      if (!(back instanceof HTMLButtonElement) || !(forward instanceof HTMLButtonElement)) {
        return false;
      }
      if (back.disabled === Boolean(backLabel)) return false;
      if (backLabel && back.getAttribute("aria-label") !== backLabel) return false;
      return forward.disabled === !forwardEnabled;
    },
    [expectedBackLabel, expectedForward],
  );
  await page.waitForTimeout(100);
}

async function goToRoute(page, label, expectedBackLabel, expectedForward = false) {
  await routeButton(page, label).click();
  await waitForActiveRoute(page, label);
  await waitForRouteHistory(page, expectedBackLabel, expectedForward);
}

async function travel(page, direction, label, expectedBackLabel, expectedForward = false) {
  if (direction === "back") {
    await backButton(page).click();
  } else {
    await forwardButton(page).click();
  }
  await waitForActiveRoute(page, label);
  await waitForRouteHistory(page, expectedBackLabel, expectedForward);
}

try {
  const { app, page } = await launchApp();
  try {
    if ((await activeRouteLabel(page)) !== "Today") {
      failures.push(`初期表示がTodayではありません（${await activeRouteLabel(page)}）。`);
    }
    if (await backButton(page).isEnabled()) failures.push("初期表示で戻るが押せてしまいます。");
    if (await forwardButton(page).isEnabled()) failures.push("初期表示で進むが押せてしまいます。");
    await page.screenshot({ path: `${OUT_DIR}/initial.png` });

    await goToRoute(page, "Feed", "前の画面に戻る（Today）");
    await goToRoute(page, "Notes", "前の画面に戻る（Feed）");
    if (!(await backButton(page).isEnabled())) failures.push("移動後に戻るが押せません。");
    if (await forwardButton(page).isEnabled()) failures.push("移動直後なのに進むが押せます。");

    await travel(page, "back", "Feed", "前の画面に戻る（Today）", true);
    if (!(await forwardButton(page).isEnabled())) failures.push("戻った後に進むが押せません。");
    await page.screenshot({ path: `${OUT_DIR}/after-back.png` });

    await travel(page, "forward", "Notes", "前の画面に戻る（Feed）");
    await page.screenshot({ path: `${OUT_DIR}/after-forward.png` });

    // 戻ってから別の画面へ進むと、進む側の履歴は消える。
    await travel(page, "back", "Feed", "前の画面に戻る（Today）", true);
    await goToRoute(page, "ToDo", "前の画面に戻る（Feed）");
    if (await forwardButton(page).isEnabled()) failures.push("分岐後も進むが残っています。");
    const actualBackLabel = await backButton(page).getAttribute("aria-label");
    if (actualBackLabel !== "前の画面に戻る（Feed）") {
      failures.push(`戻る先の画面名が表示されていません（${actualBackLabel}）。`);
    }
    await page.screenshot({ path: `${OUT_DIR}/after-branch.png` });
  } finally {
    await app.close();
  }
} finally {
  rmSync(userDataDir, { recursive: true, force: true });
}

if (failures.length) {
  console.error("画面移動監査で問題を検出しました。");
  for (const failure of failures) console.error(`  NG ${failure}`);
  console.error(`スクリーンショット: ${OUT_DIR}`);
  process.exit(1);
}

console.log(`画面移動監査: OK（スクリーンショットは ${OUT_DIR}）`);
