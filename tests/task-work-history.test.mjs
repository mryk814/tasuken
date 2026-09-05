import assert from "node:assert/strict";
import test from "node:test";
import {
  taskWorkInboxGroups,
  taskWorkPeriods,
  taskWorkReportsCoveredBy,
} from "../src/shared/contracts/task/public.ts";

const start = "2026-09-05T14:30:00.000Z";
const end = "2026-09-05T15:20:00.000Z";
const task = { id: "task-a", title: "作業履歴", work_started_at: start, version: 4 };
function report(id, action, reportedAt, extra = {}) {
  return {
    id,
    status: "pending",
    source: "mcp",
    source_app: "codex",
    payload_type: "task_work",
    received_at: reportedAt,
    request: { work_started_at: start },
    payload: {
      task_work: [
        {
          task_id: task.id,
          action,
          expected_version: 4,
          caller: "Codex",
          source_session: "session-a",
          reported_at: reportedAt,
          summary: id,
          verification: ["動作確認"],
          ...extra,
        },
      ],
    },
  };
}
const progress = report("progress", "append_receipt", "2026-09-05T14:50:00.000Z");
const done = report("done", "report_done", end);

test("Inbox groups by Task ID, orders reports and counts only terminal review", () => {
  assert.equal(taskWorkInboxGroups([progress])[0].actionable, false);
  const groups = taskWorkInboxGroups([done, progress]);
  assert.equal(groups.length, 1);
  assert.deepEqual(
    groups[0].reports.map((item) => item.id),
    ["progress", "done"],
  );
  assert.equal(groups[0].latest.id, "done");
  assert.equal(groups[0].actionable, true);
  assert.equal(
    taskWorkInboxGroups([done, report("other", "report_done", end, { task_id: "task-b" })]).length,
    2,
  );
});

test("done covers only earlier reports for this Task, producer, session and version", () => {
  const unrelated = [
    report("other-task", "append_receipt", start, { task_id: "task-b" }),
    report("other-version", "append_receipt", start, { expected_version: 5 }),
    report("other-session", "append_receipt", start, { source_session: "session-b" }),
    report("later", "report_done", "2026-09-06T00:00:00.000Z"),
    { ...progress, id: "other-client", source_app: "claude" },
  ];
  assert.deepEqual(
    taskWorkReportsCoveredBy(done, [done, progress, ...unrelated]).map((item) => item.id),
    ["progress"],
  );
});

test("work interval and identity survive next-day adoption and a later Task restart", () => {
  const pending = taskWorkPeriods([task], [progress, done], []);
  assert.equal(pending.length, 1);
  assert.equal(pending[0].started_at, start);
  assert.equal(pending[0].ended_at, end);
  assert.equal(pending[0].review_status, "pending");
  const accepted = { ...done, status: "accepted", updated_at: "2026-09-07T01:00:00.000Z" };
  const receipt = { ...done.payload.task_work[0], id: done.id, started_at: start };
  const persisted = taskWorkPeriods(
    [{ ...task, work_started_at: "2026-09-08T01:00:00.000Z" }],
    [accepted],
    [receipt],
  );
  assert.equal(persisted.length, 1);
  assert.equal(persisted[0].id, pending[0].id);
  assert.equal(persisted[0].ended_at, end);
  assert.equal(persisted[0].review_status, "accepted");
});

test("accepted progress does not hide a subsequent completion and invalid dates are not plotted", () => {
  const items = taskWorkPeriods([task], [{ ...progress, status: "accepted" }, done], []);
  assert.equal(items[0].status, "completed");
  assert.equal(
    taskWorkPeriods([task], [report("invalid", "report_done", "not-a-time")], []).length,
    0,
  );
});
