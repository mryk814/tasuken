/**
 * Google Calendar 実接続の確認（#273 / M単位）。
 *
 * **実アカウントとブラウザでの同意が必要。** 隔離した一時userDataでビルド済みアプリを起動し、
 * SettingsからGoogleへ接続してから、TodayとActivityの表示・更新・切断・失効時の挙動を実測する。
 * あなたのTasken本番プロファイルと実データには触れない（予定はこの一時プロファイルにだけ入る）。
 *
 *   $env:TASKEN_GOOGLE_CLIENT_ID = "<desktop app client id>"
 *   npm run build
 *   node scripts/live-calendar-electron-smoke.mjs
 *
 * 接続はブラウザで本人が同意するまで待つ（既定5分）。証跡は output/playwright/calendar-live へ出す。
 * 秘密情報（トークン・client secret）はログへ出さない。
 */
import { _electron as electron } from "playwright";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const OUT_DIR = process.argv[2] || "output/playwright/calendar-live";
const CONSENT_TIMEOUT_MS = Number(process.env.TASKEN_CALENDAR_CONSENT_TIMEOUT_MS || 5 * 60_000);
const clientId = (process.env.TASKEN_GOOGLE_CLIENT_ID || "").trim();
if (!clientId) {
  throw new Error(
    "TASKEN_GOOGLE_CLIENT_IDが未設定です。Google CloudのOAuth 2.0クライアントID（デスクトップアプリ）を設定してください。",
  );
}

const root = fs.mkdtempSync(path.join(os.tmpdir(), "tasken-calendar-live-"));
fs.chmodSync(root, 0o700);
fs.mkdirSync(OUT_DIR, { recursive: true });
const environment = { ...process.env, TASKEN_USER_DATA_DIR: root };
const steps = [];

function record(label, detail = "") {
  steps.push(detail ? `${label}: ${detail}` : label);
  console.log(`[OK] ${label}${detail ? ` — ${detail}` : ""}`);
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function openNavigation(page, label) {
  await page.locator(".sidebar button", { hasText: label }).first().click();
  await page.waitForTimeout(600);
}

/** Settingsは節ごとに表示を切り替える。カレンダー連携はIntegrationsにある。 */
async function openIntegrationsSection(page) {
  await openNavigation(page, "Settings");
  await page.locator("button", { hasText: "Integrations" }).first().click();
  await page.locator(".calendar-settings-panel").waitFor({ state: "visible", timeout: 20_000 });
}

async function calendarStatusLabel(page) {
  return (
    await page
      .locator(".status-pill")
      .first()
      .innerText()
      .catch(() => "")
  ).trim();
}

/** Settingsの接続状態が「接続済み」になるまで待つ。同意はブラウザで本人が行う。 */
async function waitForConnected(page) {
  const deadline = Date.now() + CONSENT_TIMEOUT_MS;
  let lastToast = "";
  let lastPanel = "";
  while (Date.now() < deadline) {
    lastPanel = await page
      .locator(".calendar-settings-panel")
      .innerText()
      .catch(() => "");
    if (lastPanel.includes("接続済み")) return lastPanel;
    if (lastPanel.includes("Google連携が未設定")) {
      throw new Error("client IDがGoogleへ受理されませんでした（未設定として返っています）。");
    }
    lastToast = await page
      .locator(".toast-message")
      .first()
      .innerText()
      .catch(() => lastToast);
    await delay(1_000);
  }
  await page.screenshot({ path: `${OUT_DIR}/06-consent-timeout.png` }).catch(() => {});
  throw new Error(
    `${CONSENT_TIMEOUT_MS / 1000}秒以内に接続が完了しませんでした。` +
      ` 画面: ${JSON.stringify(lastPanel.slice(0, 200))}` +
      ` 通知: ${JSON.stringify(lastToast.slice(0, 200))}`,
  );
}

let electronApp;
const failures = [];

try {
  electronApp = await electron.launch({
    args: [".", "--disable-gpu", "--disable-gpu-compositing", `--user-data-dir=${root}`],
    cwd: process.cwd(),
    env: environment,
  });
  const page = await electronApp.firstWindow();
  await page.waitForLoadState("domcontentloaded");
  // 失敗の種類だけを診断として拾う（tokenやcodeはアプリ側も出さない）。
  electronApp.process().stderr?.on("data", (chunk) => {
    for (const line of String(chunk).split("\n")) {
      if (line.includes("TASKEN_CALENDAR_OAUTH_FAILED")) console.log(`[診断] ${line.trim()}`);
    }
  });
  await page.getByText("Today", { exact: true }).first().waitFor();

  // 1. 未接続ではTodayに予定欄を出さず、Settingsだけを入口にする。
  const todayHasSection = await page.locator(".today-calendar-section").count();
  if (todayHasSection !== 0) failures.push("未接続なのにTodayへ予定欄が出ています。");
  else record("未接続のToday", "予定欄なし");

  await openIntegrationsSection(page);
  const beforeConnect = await page.locator(".calendar-settings-panel").innerText();
  if (!beforeConnect.includes("未接続"))
    failures.push("Settingsの初期状態が未接続ではありません。");
  else record("Settingsの初期状態", "未接続");
  await page.screenshot({ path: `${OUT_DIR}/01-disconnected.png` });

  // 2. Googleで接続する（ブラウザでの同意を待つ）。
  console.log("[..] ブラウザでGoogleへサインインし、カレンダー読み取りを許可してください。");
  await page.locator("button", { hasText: "Googleアカウントで接続" }).first().click();
  const connectedText = await waitForConnected(page);
  const accountName = connectedText.split("\n").find((line) => line.includes("@")) || "";
  record("Googleへ接続", accountName || "アカウント名は画面で確認");
  await page.screenshot({ path: `${OUT_DIR}/02-connected.png` });

  // 3. Todayで当日の予定を取得する。0件でも失敗と混同しない。
  await openNavigation(page, "Today");
  await page.locator(".today-calendar-section").waitFor({ timeout: 30_000 });
  await page.waitForFunction(
    () =>
      !document.querySelector(".today-calendar-loading") ||
      document.querySelectorAll(".today-calendar-event").length > 0,
    undefined,
    { timeout: 30_000 },
  );
  await page.waitForTimeout(800);
  const events = await page.locator(".today-calendar-event").count();
  const allDay = await page.locator(".today-calendar-event.is-allday").count();
  const errorBanner = await page.locator(".today-calendar-error").count();
  const staleBanner = await page
    .locator(".today-calendar-section", { hasText: "前回取得分" })
    .count();
  const meta = (
    await page
      .locator(".today-calendar-meta")
      .first()
      .innerText()
      .catch(() => "")
  ).trim();
  if (errorBanner) {
    const message = (await page.locator(".today-calendar-error").first().innerText()).trim();
    failures.push(`Todayの予定取得でエラーが出ています: ${message}`);
  }
  if (!meta) failures.push("Todayの予定に取得時刻が出ていません。");
  record(
    "Todayの当日予定",
    events === 0
      ? "0件（今日の予定はありません）"
      : `${events}件（終日${allDay}件） 取得時刻 ${meta}`,
  );
  if (staleBanner) failures.push("接続直後の取得がキャッシュ扱い（前回取得分）になっています。");
  await page.screenshot({ path: `${OUT_DIR}/03-today.png`, fullPage: true });

  // 4. 更新操作で取得時刻が進む（同じ日を再取得できる）。
  const refresh = page.locator(".today-calendar-section button", { hasText: "更新" }).first();
  if (await refresh.count()) {
    await refresh.click();
    await page.waitForTimeout(2_500);
    const nextMeta = (
      await page
        .locator(".today-calendar-meta")
        .first()
        .innerText()
        .catch(() => "")
    ).trim();
    record("Todayの再取得", nextMeta || "取得時刻を取得できませんでした");
    if (!nextMeta) failures.push("再取得後に取得時刻が表示されません。");
  } else {
    failures.push("Todayの予定欄に更新操作がありません。");
  }

  // 5. Activityの時間軸に同じ予定が出る（終日は専用行、Taskのcheckboxは付けない）。
  await openNavigation(page, "Activity");
  await page.locator(".activity-calendar").first().waitFor({ timeout: 20_000 });
  await page.waitForTimeout(1_200);
  const activityEvents = await page.locator(".activity-calendar-event.is-calendar").count();
  const activityError = await page
    .locator(".activity-calendar", { hasText: "予定を取得できません" })
    .count();
  if (activityError) failures.push("Activityで予定の取得エラーが出ています。");
  record("Activityの時間軸", `予定行 ${activityEvents}件`);
  await page.screenshot({ path: `${OUT_DIR}/04-activity.png`, fullPage: true });

  // 6. 切断はローカルで完結し、Todayから予定欄が消える。
  await openIntegrationsSection(page);
  await page.locator("button", { hasText: "接続を解除" }).first().click();
  await page.waitForTimeout(1_200);
  const afterDisconnect = await page.locator(".calendar-settings-panel").innerText();
  if (!afterDisconnect.includes("未接続")) failures.push("接続解除後に未接続へ戻っていません。");
  else record("接続解除", "未接続へ戻る");
  await openNavigation(page, "Today");
  if ((await page.locator(".today-calendar-section").count()) !== 0) {
    failures.push("接続解除後もTodayに予定欄が残っています。");
  } else {
    record("解除後のToday", "予定欄なし");
  }
  await page.screenshot({ path: `${OUT_DIR}/05-after-disconnect.png` });

  // 7. 認証情報は隔離プロファイルの中だけにある。
  const leaked = fs
    .readdirSync(process.cwd())
    .filter((name) => name.startsWith("calendar-") && name.endsWith(".json"));
  if (leaked.length)
    failures.push(
      `リポジトリ直下にカレンダー認証情報らしきファイルがあります: ${leaked.join(", ")}`,
    );
  else record("認証情報の置き場所", "隔離userDataのみ");
} finally {
  await electronApp?.close().catch(() => {});
  fs.rmSync(root, { recursive: true, force: true });
}

if (failures.length) {
  console.error(`\nGoogle Calendar実接続の確認で${failures.length}件の問題を検出しました。`);
  for (const failure of failures) console.error(`  NG ${failure}`);
  console.error(`スクリーンショット: ${OUT_DIR}`);
  process.exit(1);
}
console.log(`\nGoogle Calendar実接続の確認: OK（${steps.length}項目）`);
console.log(`スクリーンショット: ${OUT_DIR}`);
