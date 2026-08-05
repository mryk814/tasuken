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
    write: false,
    logLevel: "silent",
  });
  return import(`data:text/javascript;base64,${Buffer.from(result.outputFiles[0].contents).toString("base64")}`);
}

const calendarTypes = await importBundled("src/shared/calendar.ts");

test("Calendar shared types export correctly", () => {
  assert.ok(calendarTypes);
});

test("Calendar IPC channels are registered in contracts", () => {
  const source = readFileSync("src/shared/ipc/contracts.ts", "utf8");
  assert.match(source, /calendarStatus: "calendar:status"/);
  assert.match(source, /calendarConnect: "calendar:connect"/);
  assert.match(source, /calendarDisconnect: "calendar:disconnect"/);
  assert.match(source, /calendarEvents: "calendar:events"/);
});

test("Calendar namespace is exposed in ResearchDeskApi", () => {
  const source = readFileSync("src/shared/ipc/contracts.ts", "utf8");
  assert.match(source, /calendar: \{/);
  assert.match(source, /getStatus\(\): Promise<CalendarConnectionStatus>/);
  assert.match(source, /connect\(request: CalendarConnectRequest\): Promise<CalendarConnectionStatus>/);
  assert.match(source, /disconnect\(request: CalendarDisconnectRequest\): Promise<CalendarConnectionStatus>/);
  assert.match(source, /getEvents\(date: string\): Promise<CalendarEventsResult>/);
});

test("Preload bridges calendar IPC channels", () => {
  const source = readFileSync("src/preload/index.ts", "utf8");
  assert.match(source, /calendar: \{/);
  assert.match(source, /IPC\.calendarStatus/);
  assert.match(source, /IPC\.calendarConnect/);
  assert.match(source, /IPC\.calendarDisconnect/);
  assert.match(source, /IPC\.calendarEvents/);
});

test("TodayPage includes calendar section with 4-state UI", () => {
  const source = readFileSync("src/renderer/src/features/workspace/pages/TodayPage.tsx", "utf8");
  assert.match(source, /today-calendar-section/);
  assert.match(source, /calendarStatus/);
  assert.match(source, /calendarEvents/);
  assert.match(source, /今日の予定はありません/);
  assert.match(source, /予定を取得中/);
  assert.match(source, /Settingsで接続/);
  assert.match(source, /is-past/);
  assert.match(source, /is-next/);
  assert.match(source, /sensitivity === "private" \? "予定あり"/);
  assert.match(source, /aria-label="カレンダーを更新"/);
});

test("SettingsPage includes calendar connection panel", () => {
  const source = readFileSync("src/renderer/src/features/workspace/pages/SettingsPage.tsx", "utf8");
  assert.match(source, /calendar-settings-panel/);
  assert.match(source, /カレンダー連携/);
  assert.match(source, /Microsoftアカウントで接続/);
  assert.match(source, /接続を解除/);
  assert.match(source, /calendarConnect/);
  assert.match(source, /calendarDisconnect/);
});

test("CalendarService follows safeStorage encryption pattern", () => {
  const source = readFileSync("src/main/services/calendarService.ts", "utf8");
  assert.match(source, /encryptString/);
  assert.match(source, /decryptString/);
  assert.match(source, /isEncryptionAvailable/);
  assert.match(source, /calendar-provider\.json/);
  assert.match(source, /mode: 0o600/);
  assert.match(source, /Calendars\.Read/);
  assert.doesNotMatch(source, /Calendars\.ReadWrite/);
  assert.doesNotMatch(source, /Mail\./);
});

test("registerIpc handles calendar channels", () => {
  const source = readFileSync("src/main/ipc/registerIpc.ts", "utf8");
  assert.match(source, /IPC\.calendarStatus/);
  assert.match(source, /IPC\.calendarConnect/);
  assert.match(source, /IPC\.calendarDisconnect/);
  assert.match(source, /IPC\.calendarEvents/);
  assert.match(source, /calendar: CalendarService/);
});

test("CSS styles exist for calendar section", () => {
  const source = readFileSync("src/renderer/src/styles/app.css", "utf8");
  assert.match(source, /\.today-calendar-section/);
  assert.match(source, /\.today-calendar-event/);
  assert.match(source, /\.today-calendar-event\.is-past/);
  assert.match(source, /\.today-calendar-event\.is-next/);
  assert.match(source, /\.today-calendar-time/);
  assert.match(source, /\.today-calendar-allday/);
  assert.match(source, /tabular-nums/);
});
