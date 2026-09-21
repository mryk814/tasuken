import assert from "node:assert/strict";
import test from "node:test";

import {
  calendarFetchedLabel,
  calendarStateMessage,
  isCalendarReconnectCode,
  todayCalendarState,
} from "../src/renderer/src/features/workspace/lib/calendarState.ts";

/**
 * Todayのカレンダー欄の状態（#273）。
 *
 * 計画の5状態を型で固定し、**「まだ取得できていない」を0件と書かない**ことを守る。
 */

function result(overrides = {}) {
  return {
    provider: "google",
    events: [],
    fetchedAt: "2026-09-21T05:20:00.000Z",
    timeZone: "Asia/Tokyo",
    stale: false,
    ...overrides,
  };
}

function event(id) {
  return {
    id,
    title: "予定",
    isAllDay: false,
    startTime: "2026-09-21T01:00:00Z",
    endTime: "2026-09-21T02:00:00Z",
  };
}

test("未接続では予定欄を出さない", () => {
  assert.equal(todayCalendarState({ connected: false, loading: false, result: null }), "hidden");
  assert.equal(
    todayCalendarState({ connected: false, loading: false, result: result() }),
    "hidden",
  );
});

test("当日の取得成功で0件のときだけ「今日の予定はありません」", () => {
  const state = todayCalendarState({ connected: true, loading: false, result: result() });
  assert.equal(state, "empty");
  assert.equal(calendarStateMessage(state), "今日の予定はありません");
});

test("取得成功で予定があれば一覧を出す", () => {
  assert.equal(
    todayCalendarState({
      connected: true,
      loading: false,
      result: result({ events: [event("e1")] }),
    }),
    "events",
  );
});

test("更新中は前回の結果を保持したまま進行状態を示す", () => {
  // 結果があれば、更新中でも一覧は消さない（stateは結果の内容で決まる）。
  const state = todayCalendarState({
    connected: true,
    loading: true,
    result: result({ events: [event("e1")] }),
  });
  assert.equal(state, "events");
  // まだ一度も結果が無いときだけ取得中を出す。
  assert.equal(todayCalendarState({ connected: true, loading: true, result: null }), "loading");
  assert.equal(calendarStateMessage("loading"), "予定を取得中…");
});

test("offlineでキャッシュがあれば、前回取得分と「更新できません」を示す", () => {
  const state = todayCalendarState({
    connected: true,
    loading: false,
    result: result({
      events: [event("e1")],
      stale: true,
      error: "ネットワークに接続できません。",
      errorCode: "offline",
    }),
  });
  assert.equal(state, "stale");
  assert.equal(
    calendarFetchedLabel({ fetchedAt: "2026-09-21T05:20:00.000Z", stale: true, locale: "ja-JP" }),
    "最終更新 14:20／更新できません",
  );
});

test("取得履歴が無いまま空なら「予定を取得できません」とし、0件と書かない", () => {
  const state = todayCalendarState({
    connected: true,
    loading: false,
    result: result({ fetchedAt: "", events: [] }),
  });
  assert.equal(state, "unavailable");
  assert.equal(calendarStateMessage(state), "予定を取得できません");
  assert.notEqual(calendarStateMessage(state), calendarStateMessage("empty"));
});

test("取得に失敗し前回の結果も無いときは、接続のやり直しと再試行を分ける", () => {
  assert.equal(
    todayCalendarState({
      connected: true,
      loading: false,
      result: result({
        fetchedAt: "",
        error: "認証が必要です。",
        errorCode: "authentication_required",
      }),
    }),
    "reconnect",
  );
  assert.equal(
    todayCalendarState({
      connected: true,
      loading: false,
      result: result({
        fetchedAt: "",
        error: "サーバーが応答しません。",
        errorCode: "provider_unavailable",
      }),
    }),
    "error",
  );
  assert.equal(isCalendarReconnectCode("token_expired"), true);
  assert.equal(isCalendarReconnectCode("offline"), false);
  assert.equal(isCalendarReconnectCode(undefined), false);
});

test("取得時刻の表示は、更新できたときと できていないときを区別する", () => {
  assert.equal(
    calendarFetchedLabel({ fetchedAt: "2026-09-21T05:20:00.000Z", stale: false, locale: "ja-JP" }),
    "最終更新 14:20",
  );
  assert.equal(calendarFetchedLabel({ fetchedAt: "", stale: false }), "");
  assert.equal(calendarFetchedLabel({ fetchedAt: "not-a-date", stale: true }), "");
});
