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
    started_at: new Date(2026, 7, 25, 10).toISOString(),
    ended_at: new Date(2026, 7, 25, 11).toISOString(),
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
    request_events: [
      { observed_at: new Date(2026, 7, 25, 10).toISOString(), text: "Write protocol" },
    ],
    response_checkpoints: [
      { observed_at: new Date(2026, 7, 25, 11).toISOString(), text: "Saved as a Note" },
    ],
  };
  const proposal = {
    id: "proposal-1",
    source_app: "tasken-session-hook:codex",
    payload_type: "agent_sessions",
    status: "pending",
    payload: { agent_sessions: [{ action: "capture", session: hookSession }] },
  };
  return {
    tasks: [],
    work_receipts: [],
    agent_sessions: [
      {
        ...hookSession,
        id: "session-canonical",
        source_session_id: "canonical-source",
        started_at: new Date(2026, 7, 25, 8).toISOString(),
        ended_at: new Date(2026, 7, 25, 9).toISOString(),
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

test("Task report appears on its work days, independently of the adoption date or Agent Session", () => {
  const start = new Date(2026, 8, 5, 23, 30).toISOString();
  const end = new Date(2026, 8, 6, 0, 20).toISOString();
  const domain = {
    tasks: [{ id: "task-a", title: "作業履歴", work_started_at: start }],
    work_receipts: [],
    agent_sessions: [],
    ai_proposals: [
      {
        id: "done",
        payload_type: "task_work",
        status: "pending",
        received_at: end,
        request: { work_started_at: start },
        payload: {
          task_work: [
            { task_id: "task-a", action: "report_done", reported_at: end, summary: "検証完了" },
          ],
        },
      },
    ],
  };
  for (const date of ["2026-09-05", "2026-09-06"]) {
    const evidence = buildDailyDebriefEvidence(domain, date);
    assert.equal(evidence.length, 1);
    assert.equal(evidence[0].taskId, "task-a");
    assert.equal(evidence[0].endedAt, end);
    assert.equal(evidence[0].reviewStatus, "pending");
  }
  domain.ai_proposals[0].status = "accepted";
  domain.ai_proposals[0].updated_at = new Date(2026, 8, 7, 10).toISOString();
  assert.equal(buildDailyDebriefEvidence(domain, "2026-09-07").length, 0);
  assert.equal(buildDailyDebriefEvidence(domain, "2026-09-06")[0].reviewStatus, "accepted");
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
