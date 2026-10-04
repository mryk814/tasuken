import assert from "node:assert/strict";
import test from "node:test";
import {
  agentSessionInterval,
  buildAgentDayLayout,
  agentDateText,
} from "../src/renderer/src/features/workspace/lib/agentWorkCalendar.ts";

const start = "2026-10-03T00:00:00Z";
const now = "2026-10-04T00:00:00Z";
const session = (extra = {}) => ({ id: "s", started_at: start, status: "unknown", ...extra });
test("JST date and midnight point do not depend on the browser timezone", () => {
  assert.equal(agentDateText(new Date("2026-10-02T15:00:00Z")), "2026-10-03");
  const layout = buildAgentDayLayout(
    [{ session: session({ started_at: "2026-10-02T15:00:00Z" }) }],
    "2026-10-03",
    now,
  );
  assert.equal(layout.length, 1);
  assert.equal(layout[0].start_minutes, 0);
});
test("unknown ends stay at last observation, never now or completed", () => {
  assert.deepEqual(agentSessionInterval(session(), now), { end: start, endLabel: "終了未確認" });
  assert.deepEqual(
    agentSessionInterval(session({ observation: { observed_until: "2026-10-03T01:00:00Z" } }), now),
    { end: "2026-10-03T01:00:00Z", endLabel: "最終観測" },
  );
  assert.equal(agentSessionInterval(session({ status: "active" }), now).end, now);
  assert.equal(
    agentSessionInterval(session({ status: "active", observation: { observed_until: start } }), now)
      .end,
    start,
  );
});
test("recorded end is capped by import observation and malformed ends do not expand the span", () => {
  assert.equal(agentSessionInterval(session({ ended_at: now }), now).endLabel, "記録末尾");
  assert.equal(
    agentSessionInterval(session({ ended_at: start, observation: { observed_until: start } }), now)
      .endLabel,
    "最終観測",
  );
  assert.equal(
    agentSessionInterval(session({ ended_at: now, observation: { observed_until: start } }), now)
      .end,
    start,
  );
  assert.equal(agentSessionInterval(session({ ended_at: "invalid" }), now).end, start);
});
test("JST day includes cross-midnight overlaps but unknown end does not occupy later days", () => {
  const rows = [
    {
      session: session({
        id: "overnight",
        started_at: "2026-10-02T14:30:00Z",
        ended_at: "2026-10-02T16:00:00Z",
      }),
    },
    {
      session: session({
        id: "overlap",
        started_at: "2026-10-02T15:00:00Z",
        ended_at: "2026-10-02T16:00:00Z",
      }),
    },
    { session: session({ id: "unknown", started_at: "2026-10-01T00:00:00Z" }) },
  ];
  const layout = buildAgentDayLayout(
    rows,
    "2026-10-03",
    now,
    Date.parse("2026-10-03T00:00:00+09:00"),
  );
  assert.deepEqual(layout.map((row) => row.id).sort(), ["overlap", "overnight"]);
  assert.ok(
    layout.every(
      (row) => row.lane_count === 2 && row.start_minutes === 0 && row.end_minutes === 60,
    ),
  );
});
