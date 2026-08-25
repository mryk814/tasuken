import assert from "node:assert/strict";
import test from "node:test";

import {
  buildAgentSessionAcceptanceCommand,
  buildDailyDebriefEvidence,
  buildTaskenDebriefMarkdown,
  buildWeeklyDebriefMarkdown,
  dailyDebriefsForPeriod,
  findDailyDebriefNote,
  findWeeklyDebriefNote,
  readTaskenDebrief,
  selectAdaptiveQuestion,
  weeklyDebriefPeriod,
} from "../src/renderer/src/features/workspace/lib/taskenDebrief.ts";

function domainFixture() {
  const pendingSession = {
    id: "session-pending",
    started_at: "2026-08-25T10:00:00+09:00",
    ended_at: "2026-08-25T11:00:00+09:00",
    status: "completed",
    client_kind: "codex",
    source_session_id: "codex-source",
    intent: { summary: "最初の依頼" },
    outcome: {
      summary: "実装した",
      decisions: [],
      changed_items: [],
      verification: [],
      remaining_work: [],
    },
    request_events: [
      { observed_at: "2026-08-25T10:00:00+09:00", text: "最初の依頼" },
      { observed_at: "2026-08-25T10:30:00+09:00", text: "方針を変更" },
    ],
    response_checkpoints: [{ observed_at: "2026-08-25T11:00:00+09:00", text: "実装した" }],
  };
  const proposal = {
    id: "proposal-1",
    version: 1,
    source: "mcp",
    source_app: "tasken-session-hook:codex",
    payload_type: "agent_sessions",
    status: "pending",
    received_at: "2026-08-25T11:00:01+09:00",
    payload: {
      agent_sessions: [
        {
          action: "capture",
          session: pendingSession,
          references: [
            {
              id: "reference-1",
              source_type: "agent_session",
              source_id: "session-pending",
              target_type: "repository_context",
              target_id: "repo-1",
            },
          ],
        },
      ],
    },
  };
  return {
    projects: [],
    repository_contexts: [],
    working_copies: [],
    capture_entries: [],
    tasks: [],
    waitings: [],
    plan_nodes: [],
    schedules: [],
    notes: [],
    resources: [],
    sketches: [],
    knowledge_nodes: [],
    references: [],
    task_dependencies: [],
    plan_dependencies: [],
    knowledge_edges: [],
    change_events: [],
    work_receipts: [],
    artifacts: [],
    agent_sessions: [
      {
        ...pendingSession,
        id: "session-canonical",
        source_session_id: "canonical-source",
        started_at: "2026-08-25T08:00:00+09:00",
        ended_at: "2026-08-25T09:00:00+09:00",
        outcome: { ...pendingSession.outcome, verification: ["test passed"] },
      },
    ],
    ai_proposals: [proposal],
  };
}

test("Daily Debrief reads canonical sessions and passive hook proposals without duplicates", () => {
  const evidence = buildDailyDebriefEvidence(domainFixture(), "2026-08-25");
  assert.deepEqual(
    evidence.map((entry) => entry.sourceSessionId),
    ["canonical-source", "codex-source"],
  );
  assert.equal(evidence[1].requests.length, 2);
  assert.equal(evidence[1].proposal.id, "proposal-1");
  assert.equal(
    selectAdaptiveQuestion(evidence),
    "何を確認できれば、自分の判断として完了と言える？",
  );
});

test("saving a Debrief can accept all included Agent Session candidates at one review boundary", () => {
  const proposal = domainFixture().ai_proposals[0];
  const command = buildAgentSessionAcceptanceCommand(proposal);
  assert.equal(command.name, "ApplyAiProposal");
  assert.equal(command.payload.proposal.status, "accepted");
  assert.deepEqual(
    command.payload.candidates.map((entry) => entry.type),
    ["agent_session", "reference"],
  );
  assert.deepEqual(command.expectedVersions, [
    { type: "ai_proposal", id: "proposal-1", version: 1 },
  ]);
});

test("human reflection is structured canonical data and generated Evidence stays readable", () => {
  const evidence = buildDailyDebriefEvidence(domainFixture(), "2026-08-25");
  const record = {
    schema_version: 1,
    kind: "daily",
    period_start: "2026-08-25",
    period_end: "2026-08-25",
    source_session_ids: evidence.map((entry) => entry.sourceSessionId),
    evidence_corrections: ["実機確認はまだ"],
    decision: "AI案を採用したが、実機確認までは完了扱いにしない。",
    adaptive_question: "何を確認できれば、自分の判断として完了と言える？",
    adaptive_answer: "Windows実描画を確認する。",
    next_return: {
      trigger: "次にTaskenへ戻ったとき",
      first_action: "確認チェックリストを開く",
      resume_state: "planned",
    },
    completed_at: "2026-08-25T12:00:00+09:00",
    duration_seconds: 180,
  };
  const note = {
    id: "debrief-note",
    title: "Tasken Debrief — 2026-08-25",
    note_type: "report",
    body_markdown: buildTaskenDebriefMarkdown("2026-08-25", evidence, record),
    properties_json: { tasken_debrief: record },
  };
  assert.equal(readTaskenDebrief(note).decision, record.decision);
  assert.equal(findDailyDebriefNote([note], "2026-08-25").id, "debrief-note");
  assert.match(note.body_markdown, /## Evidence/);
  assert.match(note.body_markdown, /## My decision/);
  assert.match(note.body_markdown, /## Next return/);
});

test("Weekly Debrief derives from human-written Daily decisions and keeps deeper reflection structured", () => {
  const period = weeklyDebriefPeriod("2026-08-25");
  assert.deepEqual(period, { start: "2026-08-19", end: "2026-08-25" });
  const dailyNote = {
    id: "daily-1",
    properties_json: {
      tasken_debrief: {
        schema_version: 1,
        kind: "daily",
        period_start: "2026-08-24",
        period_end: "2026-08-24",
        source_session_ids: ["session-1"],
        evidence_corrections: [],
        decision: "AIの完了報告だけでは採用しなかった。",
        next_return: { trigger: "再訪時", first_action: "実描画を見る", resume_state: "planned" },
        completed_at: "2026-08-24T20:00:00+09:00",
      },
    },
  };
  const weeklyRecord = {
    schema_version: 1,
    kind: "weekly",
    period_start: period.start,
    period_end: period.end,
    source_session_ids: ["session-1"],
    evidence_corrections: [],
    decision: "完了判定をAIへ委ねがちだった。",
    next_return: {
      trigger: "次のAI委任時",
      first_action: "完了条件は自分で決める",
      resume_state: "planned",
    },
    completed_at: "2026-08-25T20:00:00+09:00",
    weekly_reflection: {
      repeated_pattern: "完了判定をAIへ委ねがちだった。",
      stalled_return: "実機確認が止まった。",
      delegation_boundary: "実装は任せ、採用判断は自分で行う。",
    },
  };
  const weeklyNote = { id: "weekly-1", properties_json: { tasken_debrief: weeklyRecord } };
  const daily = dailyDebriefsForPeriod([dailyNote, weeklyNote], period.start, period.end);
  assert.equal(daily.length, 1);
  assert.equal(
    findWeeklyDebriefNote([dailyNote, weeklyNote], period.start, period.end).id,
    "weekly-1",
  );
  assert.equal(
    readTaskenDebrief(weeklyNote).weekly_reflection.delegation_boundary,
    weeklyRecord.weekly_reflection.delegation_boundary,
  );
  assert.match(buildWeeklyDebriefMarkdown(daily, weeklyRecord), /## Delegation boundary/);
  assert.match(
    buildWeeklyDebriefMarkdown(daily, weeklyRecord),
    /AIの完了報告だけでは採用しなかった/,
  );
});
