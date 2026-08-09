import assert from "node:assert/strict";
import { Buffer } from "node:buffer";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { build } from "esbuild";

async function importBundled(relativePath) {
  const result = await build({
    entryPoints: [path.resolve(relativePath)],
    bundle: true,
    platform: "node",
    format: "esm",
    packages: "external",
    write: false,
    logLevel: "silent",
  });
  return import(`data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString("base64")}`);
}

const todaySource = readFileSync("src/renderer/src/features/workspace/pages/TodayPage.tsx", "utf8");
const mainSource = [
  readFileSync("src/main/index.ts", "utf8"),
  readFileSync("src/main/todayMiniController.ts", "utf8"),
].join("\n");
const preloadSource = readFileSync("src/preload/todayMini.ts", "utf8");
const htmlSource = readFileSync("src/renderer/today-mini.html", "utf8");
const contractsSource = readFileSync("src/shared/ipc/global.d.ts", "utf8");
const ipcContractsSource = readFileSync("src/shared/ipc/contracts.ts", "utf8");

test("Today no longer exposes the daily loop shelf or morning planning flow", () => {
  assert.doesNotMatch(todaySource, /DailyLoopPanel/);
  assert.doesNotMatch(todaySource, /buildDailyLoopSummary/);
  assert.doesNotMatch(todaySource, /handleDailyLoopStep/);
  assert.doesNotMatch(todaySource, /openDailyPlan/);
  assert.doesNotMatch(todaySource, /日次ループ/);
  assert.doesNotMatch(todaySource, /朝の計画/);
});

test("Today mini can snap and resize to the top right and fades strongly while inactive", () => {
  assert.match(mainSource, /function pinTopRight/);
  assert.match(mainSource, /screen\.getDisplayMatching/);
  assert.match(mainSource, /PINNED_WIDTH\s*=\s*360/);
  assert.match(mainSource, /PINNED_HEIGHT\s*=\s*560/);
  assert.match(mainSource, /setBounds\(/);
  assert.match(mainSource, /IPC\.todayMiniPinTopRight/);
  assert.match(mainSource, /INACTIVE_OPACITY\s*=\s*0\.5/);
  assert.match(mainSource, /setOpacity\(1\)/);
  assert.match(mainSource, /setOpacity\(INACTIVE_OPACITY\)/);
  assert.match(mainSource, /frame:\s*false/);
  assert.match(mainSource, /autoHideMenuBar:\s*true/);
  assert.match(preloadSource, /pinTopRight/);
  assert.match(preloadSource, /hide/);
  assert.match(contractsSource, /pinTopRight/);
  assert.match(contractsSource, /hide/);
  assert.match(htmlSource, /id="pin-top-right"/);
  assert.match(htmlSource, /id="close-window"/);
  assert.match(htmlSource, /window\.todayMiniApi\.pinTopRight/);
  assert.match(htmlSource, /window\.todayMiniApi\.hide/);
});

test("Today mini keeps the clean surface but uses Tasken tone and compact task metadata", () => {
  assert.match(htmlSource, /class="app-shell"/);
  assert.match(htmlSource, /class="mini-hero"/);
  assert.match(htmlSource, /id="today-date"/);
  assert.match(htmlSource, /var\(--color-accent\)/);
  assert.match(htmlSource, /var\(--color-accent-subtle-bg-strong\)/);
  assert.doesNotMatch(htmlSource, /--color-bg-top/);
  assert.doesNotMatch(htmlSource, /--color-panel/);
  assert.match(htmlSource, /aria-label="画面右上へ移動"/);
  assert.match(htmlSource, /aria-label="更新"/);
  assert.doesNotMatch(htmlSource, />右上へ<\/button>/);
  assert.doesNotMatch(htmlSource, />更新<\/button>/);
  assert.match(htmlSource, /class="add-task-bar"/);
  assert.match(htmlSource, /class="theme-dot"/);
  assert.match(htmlSource, /--theme-color/);
  assert.match(htmlSource, /function scheduleHint/);
  assert.match(htmlSource, /task\.scheduleLabel\s*!==\s*todayKey/);
  assert.match(htmlSource, /task\.hasReminder/);
  assert.match(htmlSource, /class="reminder-clock"/);
  assert.match(htmlSource, /window\.todayMiniApi\.addTask/);
  assert.match(preloadSource, /addTask/);
  assert.match(contractsSource, /addTask/);
  assert.match(readFileSync("src/shared/ipc/contracts.ts", "utf8"), /themeColor: string/);
  assert.match(readFileSync("src/shared/ipc/contracts.ts", "utf8"), /hasReminder: boolean/);
  assert.match(mainSource, /IPC\.todayMiniAddTask/);
  assert.match(mainSource, /themeColor:/);
  assert.match(mainSource, /hasReminder:/);
});

test("Today mini task追加は共通Theme pickerの選択をcanonical project_idへ渡す", () => {
  assert.match(ipcContractsSource, /todayMiniThemes: "today-mini:themes"/);
  assert.match(preloadSource, /listThemes/);
  assert.match(contractsSource, /listThemes\(\): Promise<TodayMiniThemeOption\[\]>/);
  assert.match(htmlSource, /createThemePicker/);
  assert.match(htmlSource, /id="add-task-theme-picker"/);
  assert.match(htmlSource, /window\.todayMiniApi\.listThemes/);
  assert.match(htmlSource, /themeId: addTaskThemePicker\.getValue\(\)/);
  assert.doesNotMatch(htmlSource, /<select[^>]+add-task-theme/);
  assert.match(mainSource, /themePickerOptions\(options\.repository\.list\("theme"\)/);
  assert.match(mainSource, /resolveTodayMiniThemeRef\(listThemeOptions\(\), themeId\)/);
  assert.doesNotMatch(mainSource, /project_id: canonicalThemeId\(null/);
});

test("Today miniのTheme IPC境界はpersonalまたは実在Themeだけを許可する", async () => {
  const theme = await importBundled("src/shared/todayMiniTheme.ts");
  const options = [
    { value: "theme-personal-default", kind: "personal" },
    { value: "theme-a", kind: "theme" },
    { value: "", kind: "none" },
  ];
  assert.equal(theme.resolveTodayMiniThemeRef(options, undefined).id, "theme-personal-default");
  assert.equal(theme.resolveTodayMiniThemeRef(options, "theme-a").id, "theme-a");
  assert.throws(() => theme.resolveTodayMiniThemeRef(options, "missing-theme"), /選択したThemeが見つかりません/);
  assert.equal(theme.resolveTodayMiniThemeRef(options, "").id, "theme-personal-default");
});
