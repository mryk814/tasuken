import assert from "node:assert/strict";
import test from "node:test";

import {
  buildDailyDebriefEvidence,
  buildDailyReportRequest,
  dailyReportDate,
  isPassiveAgentSessionProposal,
  readTaskenDebrief,
} from "../src/renderer/src/features/workspace/lib/taskenDebrief.ts";

function domainFixture() {
  const hookSession = {
    id: "session-pending",
    source_session_id: "codex-source",
    started_at: "2026-08-25T10:00:00+09:00",
    ended_at: "2026-08-25T11:00:00+09:00",
    status: "completed",
    client_kind: "codex",
    intent: { summary: "Prepare the daily report" },
    outcome: {
      summary: "Protocol saved",
      decisions: [],
      changed_items: [],
      verification: [],
      remaining_work: [],
    },
    request_events: [{ observed_at: "2026-08-25T10:00:00+09:00", text: "Write protocol" }],
    response_checkpoints: [{ observed_at: "2026-08-25T11:00:00+09:00", text: "Saved as a Note" }],
  };
  const proposal = {
    id: "proposal-1",
    source_app: "tasken-session-hook:codex",
    payload_type: "agent_sessions",
    status: "pending",
    payload: { agent_sessions: [{ action: "capture", session: hookSession }] },
  };
  return {
    agent_sessions: [
      {
        ...hookSession,
        id: "session-canonical",
        source_session_id: "canonical-source",
        started_at: "2026-08-25T08:00:00+09:00",
        ended_at: "2026-08-25T09:00:00+09:00",
      },
    ],
    ai_proposals: [proposal],
  };
}

test("Daily Debrief keeps canonical sessions and passive hook proposals without duplicates", () => {
  const domain = domainFixture();
  const evidence = buildDailyDebriefEvidence(domain, "2026-08-25");

  assert.equal(isPassiveAgentSessionProposal(domain.ai_proposals[0]), true);
  assert.deepEqual(
    evidence.map((entry) => entry.sourceSessionId),
    ["canonical-source", "codex-source"],
  );
});

test("Daily Debrief groups a UTC morning session under its local date", () => {
  const previousTimeZone = process.env.TZ;
  process.env.TZ = "Asia/Tokyo";
  try {
    const domain = domainFixture();
    domain.agent_sessions = [
      {
        ...domain.agent_sessions[0],
        source_session_id: "jst-morning-source",
        started_at: "2026-08-30T23:50:00.000Z",
      },
    ];
    domain.ai_proposals = [];

    assert.deepEqual(
      buildDailyDebriefEvidence(domain, "2026-08-31").map((entry) => entry.sourceSessionId),
      ["jst-morning-source"],
    );
  } finally {
    if (previousTimeZone === undefined) delete process.env.TZ;
    else process.env.TZ = previousTimeZone;
  }
});

test("dailyReportDate accepts only a non-deleted report with daily_report.date", () => {
  const report = {
    id: "report-1",
    note_type: "report",
    properties_json: { daily_report: { date: "2026-08-31" } },
  };

  assert.equal(dailyReportDate(report), "2026-08-31");
  assert.equal(dailyReportDate({ ...report, note_type: "note" }), null);
  assert.equal(dailyReportDate({ ...report, properties_json: {} }), null);
  assert.equal(dailyReportDate({ ...report, deleted_at: "2026-08-31T12:00:00Z" }), null);
});

test("daily report request limits AI to proposal and leaves answers for human review", () => {
  const request = buildDailyReportRequest("2026-08-31");

  assert.match(request, /daily-report/);
  assert.doesNotMatch(request, /debrief prompt/);
  assert.match(request, /tasken\.get_debrief_context/);
  assert.match(request, /date: "2026-08-31"/);
  assert.match(request, /raw logは再収集しない/);
  assert.match(request, /tasken\.propose_note/);
  assert.match(request, /note_type: "report", report_date: "2026-08-31"/);
  assert.match(request, /AI Inbox/);
  assert.match(request, /NotesのMarkdownへ追記/);
  assert.doesNotMatch(request, /tasken\.(?:create|save|update)_note/);
});

test("readTaskenDebrief keeps legacy saved reports readable", () => {
  const note = {
    id: "legacy-debrief",
    note_type: "report",
    properties_json: {
      tasken_debrief: {
        schema_version: 1,
        kind: "daily",
        period_start: "2026-08-25",
        period_end: "2026-08-25",
        source_session_ids: ["session-1"],
        evidence_corrections: [],
        decision: "Keep the protocol as a Note.",
        next_return: {
          trigger: "Tomorrow",
          first_action: "Review the protocol",
          resume_state: "planned",
        },
        completed_at: "2026-08-25T12:00:00+09:00",
      },
    },
  };

  assert.equal(readTaskenDebrief(note)?.decision, "Keep the protocol as a Note.");
});
