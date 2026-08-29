/**
 * 代表的な研究者の1日を、実ElectronのDebrief Activity画面で確認する。
 * 引数に実行ファイルを渡した場合はpackaged app、未指定の場合はdevelopment buildを使う。
 */
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { _electron as electron } from "playwright";

const executableArgument = process.argv[2] || "";
const packaged = Boolean(executableArgument);
const executablePath = packaged ? path.resolve(executableArgument) : "";
if (packaged && !fs.existsSync(executablePath)) {
  throw new Error("Tasken packaged executable was not found.");
}

const root = fs.mkdtempSync(path.join(os.tmpdir(), "tasken-activity-smoke-"));
fs.chmodSync(root, 0o700);
const databasePath = path.join(root, "research-desk.sqlite");
const outputDirectory = path.resolve(
  process.env.TASKEN_ACTIVITY_SMOKE_OUTPUT_DIR ||
    path.join("output", "playwright", "activity-packaged-smoke"),
);
const screenshotPath = path.join(
  outputDirectory,
  packaged ? "activity-packaged.png" : "activity-development.png",
);
const failureScreenshotPath = path.join(outputDirectory, "activity-failure.png");
const environment = {
  ...process.env,
  TASKEN_USER_DATA_DIR: root,
  TASKEN_DB_PATH: databasePath,
};
const activityPixelsPerHour = 44;
const expectedActivityRows = [
  {
    time: "08:30–11:00",
    origin: "Codex",
    title: "集中実験と解析",
    source: "Codex",
    theme: "llzo",
  },
  {
    time: "10:20–10:50",
    origin: "Claude Code",
    title: "解析ノートの補助確認",
    source: "Claude Code",
    theme: "llzo",
  },
  {
    time: "11:30",
    origin: "Tasken",
    title: "製造部レビュー資料を共有",
    source: null,
    theme: "aluminum",
  },
  {
    time: "12:15",
    origin: "Tasken",
    title: "製造部レビュー資料を共有",
    source: null,
    theme: "aluminum",
  },
  {
    time: "13:30–15:00",
    origin: "Codex",
    title: "製造条件の集中解析",
    source: "Codex",
    theme: "aluminum",
  },
  {
    time: "14:10–14:40",
    origin: "Cursor",
    title: "レビュー観点の補助解析",
    source: "Cursor",
    theme: "aluminum",
  },
  {
    time: "15:12–15:24",
    origin: "Tasken変更",
    title: "3件のActivity",
    source: null,
    theme: "aluminum",
  },
  {
    time: "16:30",
    origin: "Tasken",
    title: "候補バッチ #2を合成・焼成",
    source: null,
    theme: "llzo",
  },
  {
    time: "18:00",
    origin: "Tasken",
    title: "SHAPで高強度側の支配因子を説明",
    source: null,
    theme: "aluminum",
  },
];

let electronApp;
let page;

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function seedRepresentativeWorkspace() {
  const electronExecutable = process.platform === "win32" ? "electron.exe" : "electron";
  const electronPath = path.resolve("node_modules", "electron", "dist", electronExecutable);
  const seedScript = path.resolve("scripts", "seed-materials-informatics-workspace.mjs");
  if (!fs.existsSync(electronPath)) throw new Error("Electron executable was not found.");
  const result = spawnSync(electronPath, [seedScript, "--target", databasePath], {
    cwd: process.cwd(),
    env: {
      ...environment,
      ELECTRON_RUN_AS_NODE: "1",
      TASKEN_NODE_EXEC_PATH: process.execPath,
    },
    encoding: "utf8",
    maxBuffer: 10 * 1024 * 1024,
    windowsHide: true,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(
      `Activity fixture seed failed (${result.status ?? "unknown"}).\n${result.stdout}\n${result.stderr}`,
    );
  }
  const output = result.stdout.trim();
  const jsonStart = output.indexOf("{");
  const jsonEnd = output.lastIndexOf("}");
  if (jsonStart < 0 || jsonEnd < jsonStart)
    throw new Error("Activity fixture seed returned no JSON.");
  const seeded = JSON.parse(output.slice(jsonStart, jsonEnd + 1));
  assert.equal(seeded.representativeActivity?.date, "2026-08-28");
  assert.equal(seeded.representativeActivity?.session_times?.length, 4);
  assert.ok(seeded.representativeActivity?.event_times?.length >= 10);
  return seeded;
}

async function closeElectron() {
  if (!electronApp) return;
  const processHandle = electronApp.process();
  const closed = await Promise.race([
    electronApp.close().then(() => true),
    delay(10_000).then(() => false),
  ]);
  if (!closed && processHandle.exitCode === null) processHandle.kill();
  electronApp = undefined;
  assert.equal(closed, true, "Tasken did not close within ten seconds.");
}

function assertNear(actual, expected, tolerance, label) {
  assert.ok(
    Math.abs(actual - expected) <= tolerance,
    `${label}: expected ${expected} +/- ${tolerance}, received ${actual}`,
  );
}

function assertVisibleComputedColor(value, label) {
  const normalized = value.replaceAll(/\s+/g, " ").trim().toLowerCase();
  assert.ok(normalized, `${label} must have a computed color.`);
  assert.notEqual(normalized, "transparent", `${label} must not be transparent.`);
  assert.doesNotMatch(
    normalized,
    /^rgba\([^)]*,\s*0(?:\.0+)?\)$/,
    `${label} must not have zero alpha.`,
  );
  assert.doesNotMatch(normalized, /\/\s*0(?:\.0+)?\s*\)$/, `${label} must not have zero alpha.`);
}

function assertFixtureThemeColors(rows) {
  for (const row of rows) {
    assert.ok(row.anchorColors.length > 0, `${row.time} ${row.title} must have a time anchor.`);
    for (const [index, color] of row.anchorColors.entries()) {
      assertVisibleComputedColor(color, `${row.time} ${row.title} anchor ${index + 1}`);
    }
    assert.equal(
      new Set(row.anchorColors).size,
      1,
      `${row.time} ${row.title} anchors must use one Theme color.`,
    );
    assertVisibleComputedColor(row.cardBorderColor, `${row.time} ${row.title} card border`);
    assertVisibleComputedColor(row.cardBackgroundColor, `${row.time} ${row.title} card background`);
  }

  const colorsByTheme = new Map();
  for (const expected of expectedActivityRows) {
    const row = rows.find(
      (candidate) => candidate.time === expected.time && candidate.title === expected.title,
    );
    assert.ok(row, `Fixture row was not found for Theme color: ${expected.time} ${expected.title}`);
    const colors = colorsByTheme.get(expected.theme) || { anchors: new Set(), cards: new Set() };
    colors.anchors.add(row.anchorColors[0]);
    colors.cards.add(row.cardBorderColor);
    colorsByTheme.set(expected.theme, colors);
  }
  for (const [theme, colors] of colorsByTheme) {
    assert.equal(colors.anchors.size, 1, `${theme} rows must share one computed anchor color.`);
    assert.equal(colors.cards.size, 1, `${theme} rows must share one computed card border color.`);
  }
  assert.ok(colorsByTheme.size >= 2, "The fixture must contain multiple Themes.");
  assert.ok(
    new Set([...colorsByTheme.values()].map((colors) => [...colors.anchors][0])).size >= 2,
    "Fixture Themes must render at least two computed anchor colors.",
  );
  assert.ok(
    new Set([...colorsByTheme.values()].map((colors) => [...colors.cards][0])).size >= 2,
    "Fixture Themes must render at least two computed card border colors.",
  );
}

function assertFixtureRowSources(rows) {
  assert.equal(
    rows.length,
    expectedActivityRows.length,
    "Activity calendar must render every fixture row exactly once.",
  );
  for (const expected of expectedActivityRows) {
    const matches = rows.filter(
      (row) =>
        row.time === expected.time &&
        row.origin === expected.origin &&
        row.title === expected.title,
    );
    assert.equal(
      matches.length,
      1,
      `Fixture row must match time/origin/title exactly once: ${expected.time} / ${expected.origin} / ${expected.title}`,
    );
    const [row] = matches;
    assert.equal(
      row.sourceCount,
      expected.source ? 1 : 0,
      `${expected.time} ${expected.title} must ${expected.source ? "show one AI source chip" : "show no source chip"}.`,
    );
    assert.equal(
      row.source,
      expected.source,
      `${expected.time} ${expected.title} must use the expected source label.`,
    );
  }
}

async function inspectActivityCalendar() {
  const calendar = page.getByLabel("Activity の時刻カレンダー");
  await calendar.waitFor();
  const rangeAnchors = page.locator(".activity-calendar-time-anchor.is-range");
  const pointAnchors = page.locator(".activity-calendar-time-anchor.is-point");
  const rangeRows = page.locator(".activity-calendar-event.is-range-event");
  const pointRows = page.locator(".activity-calendar-event.is-point-event");
  assert.ok((await rangeAnchors.count()) > 0, "Activity calendar must show range anchors.");
  assert.ok((await pointAnchors.count()) > 0, "Activity calendar must show point anchors.");
  assert.ok((await rangeRows.count()) > 0, "Activity calendar must show range cards.");
  assert.ok((await pointRows.count()) > 0, "Activity calendar must show point cards.");

  const windowMetrics = await calendar.evaluate((element) => ({
    scrollTop: element.scrollTop,
    clientHeight: element.clientHeight,
    scrollWidth: element.scrollWidth,
    clientWidth: element.clientWidth,
  }));
  assertNear(
    windowMetrics.scrollTop,
    8 * activityPixelsPerHour - 8,
    12,
    "Activity calendar 08:00 scroll origin",
  );
  const visibleEndHour =
    (windowMetrics.scrollTop + windowMetrics.clientHeight) / activityPixelsPerHour;
  assert.ok(
    visibleEndHour >= 18.5 && visibleEndHour <= 20,
    `Activity calendar must initially show through 19:00; received ${visibleEndHour.toFixed(2)}.`,
  );
  assert.ok(
    windowMetrics.scrollWidth <= windowMetrics.clientWidth + 1,
    "Activity calendar must not clip horizontally.",
  );
  const hourLabels = await page.locator(".activity-calendar-hour-label").allTextContents();
  assert.ok(hourLabels.includes("08:00"));
  assert.ok(hourLabels.includes("19:00"));

  const pointShape = await pointAnchors.first().evaluate((element) => {
    const style = getComputedStyle(element);
    const bounds = element.getBoundingClientRect();
    return {
      height: bounds.height,
      leftRadius: Number.parseFloat(style.borderTopLeftRadius),
      rightRadius: Number.parseFloat(style.borderTopRightRadius),
    };
  });
  assertNear(
    pointShape.height,
    (activityPixelsPerHour * 10) / 60,
    1.5,
    "10-minute point anchor height",
  );
  assert.ok(pointShape.leftRadius > 0, "Point anchor must be rounded on the left.");
  assert.equal(pointShape.rightRadius, 0, "Point anchor must stay square on the right.");

  const activityRows = await page.locator(".activity-calendar-event").evaluateAll((elements) =>
    elements.map((element) => {
      const button = element.querySelector(".activity-calendar-event-button");
      const title =
        element.querySelector(".activity-calendar-event-title")?.textContent?.trim() || "";
      const sourceChips = [...element.querySelectorAll(".activity-calendar-event-source")];
      const ariaParts = (button?.getAttribute("aria-label") || "").split("、");
      const cardStyle = button ? getComputedStyle(button, "::before") : null;
      return {
        time: ariaParts[0] || "",
        origin: ariaParts[2] || "",
        title,
        sourceCount: sourceChips.length,
        source: sourceChips[0]?.textContent?.trim() || null,
        anchorColors: [...element.querySelectorAll(".activity-calendar-time-anchor")].map(
          (anchor) => getComputedStyle(anchor).backgroundColor,
        ),
        cardBorderColor: cardStyle?.borderTopColor || "",
        cardBackgroundColor: cardStyle?.backgroundColor || "",
      };
    }),
  );
  assertFixtureRowSources(activityRows);
  assertFixtureThemeColors(activityRows);
  const themeColors = [...new Set(activityRows.flatMap((row) => row.anchorColors))];
  const cardThemeColors = [...new Set(activityRows.map((row) => row.cardBorderColor))];
  const sourceLabels = activityRows.flatMap((row) => (row.source ? [row.source] : []));

  return {
    rangeAnchors: await rangeAnchors.count(),
    pointAnchors: await pointAnchors.count(),
    themeColors,
    cardThemeColors,
    sourceLabels,
  };
}

async function assertNoHorizontalClipping() {
  const clipping = await page.evaluate(() => {
    const calendar = document.querySelector(".activity-calendar");
    const canvas = document.querySelector(".activity-calendar-canvas");
    const detail = document.querySelector(".activity-calendar-detail");
    const viewportWidth = document.documentElement.clientWidth;
    const canvasBounds = canvas?.getBoundingClientRect();
    const eventOverflow = [...document.querySelectorAll(".activity-calendar-event-button")].some(
      (element) => {
        const bounds = element.getBoundingClientRect();
        return Boolean(
          canvasBounds &&
          (bounds.left < canvasBounds.left - 1 || bounds.right > canvasBounds.right + 1),
        );
      },
    );
    const detailBounds = detail?.getBoundingClientRect();
    return {
      documentOverflow: document.documentElement.scrollWidth > viewportWidth + 1,
      pageOverflow:
        Boolean(document.querySelector(".debrief-page")) &&
        document.querySelector(".debrief-page").scrollWidth >
          document.querySelector(".debrief-page").clientWidth + 1,
      calendarOverflow: Boolean(calendar && calendar.scrollWidth > calendar.clientWidth + 1),
      eventOverflow,
      detailOverflow: Boolean(
        detail &&
        (detail.scrollWidth > detail.clientWidth + 1 ||
          detailBounds.left < -1 ||
          detailBounds.right > viewportWidth + 1),
      ),
    };
  });
  assert.deepEqual(clipping, {
    documentOverflow: false,
    pageOverflow: false,
    calendarOverflow: false,
    eventOverflow: false,
    detailOverflow: false,
  });
}

try {
  fs.mkdirSync(outputDirectory, { recursive: true });
  const seeded = seedRepresentativeWorkspace();
  electronApp = await electron.launch({
    ...(packaged ? { executablePath } : {}),
    args: [
      ...(packaged ? [] : ["."]),
      "--disable-gpu",
      "--disable-gpu-compositing",
      `--user-data-dir=${root}`,
    ],
    cwd: process.cwd(),
    env: environment,
  });
  page = await electronApp.firstWindow();
  await page.waitForLoadState("domcontentloaded");
  await electronApp.evaluate(({ BrowserWindow }) => {
    const [window] = BrowserWindow.getAllWindows();
    window?.setSize(1440, 720);
    window?.center();
  });
  await page.getByRole("button", { name: "Today", exact: true }).waitFor();
  await page.getByRole("button", { name: "Debrief", exact: true }).click();
  const activityDate = page.getByLabel("Activity対象日");
  await activityDate.waitFor();
  await activityDate.fill("2026-08-28");
  await page.locator(".activity-calendar-event").first().waitFor({ timeout: 15_000 });

  const calendarEvidence = await inspectActivityCalendar();
  const pointEventButton = page
    .locator(
      '.activity-calendar-event.is-point-event .activity-calendar-event-button[aria-label^="15:"]',
    )
    .first();
  assert.ok(
    (await pointEventButton.count()) > 0,
    "Representative 15:xx point Activity was not found.",
  );
  await pointEventButton.scrollIntoViewIfNeeded();
  await pointEventButton.click();
  const detail = page.getByLabel("選択した Activity の詳細");
  await detail.waitFor();
  const detailBounds = await detail.boundingBox();
  assert.ok(detailBounds && detailBounds.width >= 240, "Activity detail must keep a useful width.");
  await assertNoHorizontalClipping();

  const taskEditButton = detail.getByRole("button", { name: /^(タスクを編集|編集)$/ }).first();
  assert.ok((await taskEditButton.count()) > 0, "Activity detail must expose Task editing.");
  await taskEditButton.click();
  const taskForm = page.locator('.drawer-form[data-entity-type="task"]');
  await taskForm.waitFor();
  assert.match(await page.locator(".drawer .drawer-header").innerText(), /編集: タスク/);
  assert.ok((await taskForm.locator('input[name="title"]').inputValue()).trim().length > 0);
  await page.locator(".drawer .drawer-header").getByRole("button", { name: "閉じる" }).click();
  await taskForm.waitFor({ state: "detached" });

  await page.locator("#daily-activity").scrollIntoViewIfNeeded();
  await assertNoHorizontalClipping();
  await page.screenshot({ path: screenshotPath, fullPage: false });
  await closeElectron();

  console.log(
    JSON.stringify({
      mode: packaged ? "packaged" : "development",
      representativeDate: seeded.representativeActivity.date,
      calendarWindow: "08:00-19:00",
      ...calendarEvidence,
      taskEditOpened: true,
      horizontalClipping: false,
      screenshotPath,
    }),
  );
} catch (error) {
  if (page && !page.isClosed()) {
    await page.screenshot({ path: failureScreenshotPath, fullPage: false }).catch(() => undefined);
  }
  throw error;
} finally {
  if (electronApp) await closeElectron().catch(() => undefined);
  const tempRoot = path.resolve(os.tmpdir());
  const resolvedRoot = path.resolve(root);
  if (
    path.dirname(resolvedRoot) === tempRoot &&
    path.basename(resolvedRoot).startsWith("tasken-activity-smoke-")
  ) {
    fs.rmSync(resolvedRoot, { recursive: true, force: true });
  }
}
