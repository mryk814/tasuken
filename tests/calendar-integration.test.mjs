import assert from "node:assert/strict";
import { Buffer } from "node:buffer";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { build } from "esbuild";

import { calendarFixture, calendarPageTwo } from "./fixtures/calendar-fixture.mjs";

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
const calendarAdapter = await importBundled("src/main/services/calendarAdapter.ts");
const calendarService = await importBundled("src/main/services/calendarService.ts");

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
  assert.match(source, /sensitivity === "normal" \? event\.title : "予定あり"/);
  assert.match(source, /calendarName/);
  assert.match(source, /safeMeetingUrlFor/);
  assert.match(source, /event\.sensitivity !== "normal"/);
  assert.match(source, /会議を開く/);
  const calendarMeta = source.match(/function CalendarEventMeta[\s\S]*?\n}\n\nfunction TodayCalendarSection/);
  assert.ok(calendarMeta, "CalendarEventMeta source is present");
  assert.match(calendarMeta[0], /href=\{meetingUrl\}/);
  assert.match(calendarMeta[0], /target="_blank"/);
  assert.match(calendarMeta[0], /rel="noreferrer"/);
  assert.doesNotMatch(calendarMeta[0], /preventDefault|openPath/);
  assert.match(source, /カレンダーの接続状態を確認中/);
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
  assert.match(source, /openid profile email offline_access Calendars\.ReadBasic/);
  assert.match(source, /process\.env\.TASKEN_MICROSOFT_CLIENT_ID/);
  assert.match(source, /id_token/);
  assert.doesNotMatch(source, /PLACEHOLDER_CLIENT_ID/);
  assert.doesNotMatch(source, /User\.Read/);
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

function response(body, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    async json() {
      if (typeof body === "string") throw new Error("invalid json");
      return body;
    },
    async text() {
      return typeof body === "string" ? body : JSON.stringify(body);
    },
  };
}

function queuedFetcher(queue, requests = []) {
  return async (url, options) => {
    requests.push({ url, options });
    const next = queue.shift();
    if (!next) throw new Error("fixture response queue exhausted");
    return next;
  };
}

test("Calendar range uses explicit local timezone offsets", () => {
  const range = calendarTypes.buildCalendarRange("2026-08-08", "Asia/Tokyo");
  assert.equal(range.start, "2026-08-08T00:00:00+09:00");
  assert.equal(range.end, "2026-08-09T00:00:00+09:00");
});

test("Microsoft adapter paginates, projects recurrence, and redacts private details", async () => {
  const requests = [];
  const fetcher = queuedFetcher([
    response(calendarFixture.calendar),
    response({
      value: calendarFixture.events,
      "@odata.nextLink": "https://graph.microsoft.com/v1.0/me/calendarview?page=2",
    }),
    response(calendarPageTwo),
  ], requests);
  const adapter = new calendarAdapter.MicrosoftCalendarAdapter(fetcher);
  const range = calendarTypes.buildCalendarRange("2026-08-08", "Asia/Tokyo");
  const events = await adapter.listEvents("access-token", range);

  assert.equal(events.length, 5);
  assert.equal(requests.length, 3);
  assert.match(requests[0].url, /\/me\/calendar\?%24select=name$/);
  assert.match(requests[1].url, /startDateTime=2026-08-08T00%3A00%3A00%2B09%3A00/);
  assert.match(requests[1].url, /endDateTime=2026-08-09T00%3A00%3A00%2B09%3A00/);
  assert.match(requests[1].url, /%24top=1000/);
  assert.equal(requests[1].options.headers.Authorization, "Bearer access-token");
  assert.equal(requests[1].options.headers.Prefer, 'outlook.timezone="Asia/Tokyo"');
  assert.equal(events[0].calendarName, "研究予定");
  assert.equal(events[0].startTime, "2026-08-08T09:00:00.000+09:00");
  assert.equal(events[1].title, "非公開の予定");
  assert.equal(events[1].location, "");
  assert.equal(events[1].meetingUrl, "");
  assert.equal(events[1].seriesMasterId, "series-private");
  assert.equal(events[1].recurrence.pattern.type, "weekly");
  assert.equal(events[1].recurrence.range.endDate, "2026-08-29");
  assert.equal(events[2].meetingUrl, "");
  assert.equal(events[3].isAllDay, true);
  assert.equal(events[3].meetingUrl, "");
  assert.equal(events[4].title, "非公開の予定");
  assert.equal(events[4].location, "");
  assert.equal(events[4].meetingUrl, "");
  assert.match(events[0].meetingUrl, /^https:\/\//);
  const projected = JSON.stringify(events);
  assert.doesNotMatch(projected, /SECRET_EVENT_BODY|PRIVATE_EVENT_BODY|CONFIDENTIAL_EVENT_BODY/);
  assert.doesNotMatch(projected, /役員室|秘密の人事会議|取締役室|機密の経営会議/);
});

test("Microsoft adapter classifies organization constraints without exposing provider bodies", () => {
  const error = calendarAdapter.classifyCalendarProviderError(
    403,
    "AADSTS65001: admin consent required; secret=DO_NOT_SHOW",
  );
  assert.equal(error.code, "admin_approval_required");
  assert.doesNotMatch(error.message, /DO_NOT_SHOW|AADSTS65001/);
});

function fakeSafeStorage() {
  return {
    isEncryptionAvailable: () => true,
    encryptString: (value) => Buffer.from(`encrypted:${value}`, "utf8"),
    decryptString: (value) => {
      const decoded = value.toString("utf8");
      if (!decoded.startsWith("encrypted:")) throw new Error("invalid ciphertext");
      return decoded.slice("encrypted:".length);
    },
  };
}

function seedConnectedConfig(userDataPath, storage) {
  writeFileSync(
    path.join(userDataPath, "calendar-provider.json"),
    `${JSON.stringify({
      provider: "microsoft",
      accountName: "fixture@example.com",
      encryptedAccessToken: storage.encryptString("access-token").toString("base64"),
      tokenExpiresAt: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
      lastFetchedAt: "",
    }, null, 2)}\n`,
    "utf8",
  );
}

test("Calendar service caches fresh empty results and serves them stale after provider failure", async () => {
  const userDataPath = mkdtempSync(path.join(os.tmpdir(), "tasken-calendar-test-"));
  const storage = fakeSafeStorage();
  try {
    seedConnectedConfig(userDataPath, storage);
    const adapter = {
      provider: "microsoft",
      listEvents: async () => [],
    };
    const firstService = new calendarService.CalendarService(
      userDataPath,
      storage,
      async () => response({}),
      async () => {},
      { adapter, clientId: "test-client", timeZone: "Asia/Tokyo" },
    );
    const fresh = await firstService.getEvents("2026-08-08");
    assert.equal(fresh.stale, false);
    assert.deepEqual(fresh.events, []);
    assert.ok(fresh.fetchedAt);

    const failingService = new calendarService.CalendarService(
      userDataPath,
      storage,
      async () => response({}),
      async () => {},
      {
        adapter: {
          provider: "microsoft",
          listEvents: async () => { throw new Error("SECRET_EVENT_BODY token=secret"); },
        },
        clientId: "test-client",
        timeZone: "Asia/Tokyo",
      },
    );
    const stale = await failingService.getEvents("2026-08-08");
    assert.equal(stale.stale, true);
    assert.deepEqual(stale.events, []);
    assert.equal(stale.fetchedAt, fresh.fetchedAt);
    assert.equal(stale.errorCode, "unknown");
    assert.doesNotMatch(JSON.stringify(stale), /SECRET_EVENT_BODY|token=secret/);

    const configText = readFileSync(path.join(userDataPath, "calendar-provider.json"), "utf8");
    const cacheText = readFileSync(path.join(userDataPath, "calendar-cache.json"), "utf8");
    assert.doesNotMatch(configText, /access-token/);
    assert.doesNotMatch(cacheText, /SECRET_EVENT_BODY|token=secret/);

    await failingService.disconnect({ provider: "microsoft" });
    assert.equal(failingService.getStatus().connected, false);
    assert.equal(existsSync(path.join(userDataPath, "calendar-provider.json")), false);
    assert.equal(existsSync(path.join(userDataPath, "calendar-cache.json")), false);
  } finally {
    rmSync(userDataPath, { recursive: true, force: true });
  }
});

test("Calendar service rejects Microsoft connect when client ID is not configured", async () => {
  const userDataPath = mkdtempSync(path.join(os.tmpdir(), "tasken-calendar-config-"));
  try {
    const service = new calendarService.CalendarService(
      userDataPath,
      fakeSafeStorage(),
      async () => response({}),
      async () => {},
      { clientId: "", timeZone: "Asia/Tokyo" },
    );
    await assert.rejects(
      service.connect({ provider: "microsoft" }),
      (error) => error?.code === "not_configured" && !String(error.message).includes("PLACEHOLDER"),
    );
  } finally {
    rmSync(userDataPath, { recursive: true, force: true });
  }
});

function idTokenFor(name) {
  const payload = Buffer.from(JSON.stringify({ name }), "utf8")
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
  return `header.${payload}.signature`;
}

test("Calendar account switch clears memory cache before a failed first fetch", async () => {
  const userDataPath = mkdtempSync(path.join(os.tmpdir(), "tasken-calendar-switch-"));
  const storage = fakeSafeStorage();
  const oldEvent = {
    id: "account-a-event",
    title: "Account A only",
    startTime: "2026-08-08T09:00:00.000+09:00",
    endTime: "2026-08-08T10:00:00.000+09:00",
    startTimeZone: "Asia/Tokyo",
    endTimeZone: "Asia/Tokyo",
    isAllDay: false,
    location: "",
    meetingUrl: "",
    calendarName: "A",
    sensitivity: "normal",
    seriesMasterId: null,
    occurrenceType: "singleInstance",
    recurrence: null,
  };
  try {
    seedConnectedConfig(userDataPath, storage);
    const adapter = {
      provider: "microsoft",
      listEvents: async () => [oldEvent],
    };
    const fetcher = async (url, options = {}) => {
      assert.match(url, /oauth2\/v2\.0\/token$/);
      assert.match(options.body, /redirect_uri=http%3A%2F%2F127\.0\.0\.1%3A/);
      assert.match(options.body, /scope=openid\+profile\+email\+offline_access\+Calendars\.ReadBasic/);
      assert.doesNotMatch(options.body, /User\.Read/);
      return response({
        access_token: "account-b-access-token",
        refresh_token: "account-b-refresh-token",
        expires_in: 3600,
        id_token: idTokenFor("account-b@example.com"),
      });
    };
    const service = new calendarService.CalendarService(
      userDataPath,
      storage,
      fetcher,
      async (authorizeUrl) => {
        const authorize = new URL(authorizeUrl);
        assert.equal(authorize.searchParams.get("redirect_uri").startsWith("http://127.0.0.1:"), true);
        const callbackUrl = new URL(authorize.searchParams.get("redirect_uri"));
        callbackUrl.searchParams.set("state", authorize.searchParams.get("state"));
        callbackUrl.searchParams.set("code", "account-b-code");
        await fetch(callbackUrl);
      },
      { adapter, clientId: "test-client", timeZone: "Asia/Tokyo" },
    );
    const cachedA = await service.getEvents("2026-08-08");
    assert.deepEqual(cachedA.events, [oldEvent]);
    await service.connect({ provider: "microsoft" });
    assert.equal(service.getStatus().accountName, "account-b@example.com");

    adapter.listEvents = async () => { throw new Error("account B provider failure"); };
    const afterSwitchFailure = await service.getEvents("2026-08-08");
    assert.deepEqual(afterSwitchFailure.events, []);
    assert.equal(afterSwitchFailure.stale, false);
    assert.equal(afterSwitchFailure.errorCode, "unknown");
  } finally {
    rmSync(userDataPath, { recursive: true, force: true });
  }
});

test("OAuth callback ignores unrelated requests before accepting the matching state", async () => {
  const userDataPath = mkdtempSync(path.join(os.tmpdir(), "tasken-calendar-state-"));
  try {
    const service = new calendarService.CalendarService(
      userDataPath,
      fakeSafeStorage(),
      async (url, options = {}) => {
        assert.match(url, /oauth2\/v2\.0\/token$/);
        assert.match(options.body, /redirect_uri=http%3A%2F%2F127\.0\.0\.1%3A/);
        return response({ access_token: "state-test-token", expires_in: 3600, id_token: idTokenFor("state@example.com") });
      },
      async (authorizeUrl) => {
        const authorize = new URL(authorizeUrl);
        const redirectUri = authorize.searchParams.get("redirect_uri");
        const mismatchedError = new URL(redirectUri);
        mismatchedError.searchParams.set("state", "attacker-state");
        mismatchedError.searchParams.set("error", "access_denied");
        assert.equal((await fetch(mismatchedError)).status, 400);

        const missingState = new URL(redirectUri);
        assert.equal((await fetch(missingState)).status, 400);

        const missingCode = new URL(redirectUri);
        missingCode.searchParams.set("state", authorize.searchParams.get("state"));
        assert.equal((await fetch(missingCode)).status, 400);

        const validCallback = new URL(redirectUri);
        validCallback.searchParams.set("state", authorize.searchParams.get("state"));
        validCallback.searchParams.set("code", "state-test-code");
        assert.equal((await fetch(validCallback)).status, 200);
      },
      { clientId: "test-client", timeZone: "Asia/Tokyo" },
    );
    const status = await service.connect({ provider: "microsoft" });
    assert.equal(status.connected, true);
    assert.equal(status.accountName, "state@example.com");
  } finally {
    rmSync(userDataPath, { recursive: true, force: true });
  }
});
