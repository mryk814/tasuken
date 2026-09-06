import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { buildActivityEvent } from "../src/shared/activityEvent.mjs";
import { build } from "esbuild";
const bundled = await build({
  stdin: {
    contents: `export { buildDailyContextPlan } from './src/shared/dailyContext.ts'; export { publishDailyContext } from './src/main/services/dailyContextPublisher.ts'; export { planWorkLog } from './src/main/services/workLogCommand.ts';`,
    resolveDir: process.cwd(),
  },
  bundle: true,
  platform: "node",
  format: "esm",
  write: false,
  logLevel: "silent",
});
const { buildDailyContextPlan, publishDailyContext, planWorkLog } = await import(
  `data:text/javascript;base64,${Buffer.from(bundled.outputFiles[0].text).toString("base64")}`
);

function fixture(count = 1) {
  const task = { id: "test-task", title: "公開された作業", state: "done", ai_visibility: ["m365"] };
  return {
    workspaceId: "test-workspace",
    generatedAt: "2026-09-06T15:00:00.000Z",
    selection: { date: "2026-09-06", timezone: "Asia/Tokyo", themeId: null },
    workspace: {
      tasks: [task],
      change_events: Array.from({ length: count }, (_, index) =>
        buildActivityEvent({
          id: `event-${String(index).padStart(5, "0")}`,
          entity_type: "task",
          entity_id: task.id,
          event_kind: "task_completed",
          occurred_at: "2026-09-06T10:00:00.000Z",
          after: task,
          metadata: { dedupe_key: `event-${index}` },
        }),
      ),
    },
  };
}
function temporary(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "tasken-daily-test-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  return root;
}
function publish(root, plan, extra = {}) {
  return publishDailyContext({ root, plan, expectedContentHash: plan.contentHash, ...extra });
}

test("daily plans paginate beyond 500 and label incomplete coverage", () => {
  const input = fixture(501);
  const complete = buildDailyContextPlan(input);
  assert.equal(complete.includedCount, 501);
  assert.equal(complete.partial, false);
  assert.equal(complete.sourceCount, 1);
  const partial = buildDailyContextPlan({ ...input, maxPages: 1 });
  assert.equal(partial.includedCount, 500);
  assert.equal(partial.partial, true);
  assert.match(partial.content, /部分取得/);
});

test("one published day distinguishes incomplete work, input, plans, AI reports and human acceptance", (t) => {
  const input = fixture();
  const task = { ...input.workspace.tasks[0], state: "doing", version: 2 };
  input.workspace.tasks = [task];
  const work = planWorkLog(
    {
      schemaVersion: 1,
      commandName: "RecordWorkLog",
      commandId: "unfinished-work",
      issuedAt: "2026-09-08T10:00:00.000Z",
      body: "測定した。結果の解釈は未完了。",
      performedDate: "2026-09-06",
      themeId: null,
      taskId: null,
    },
    "2026-09-08T10:00:00.000Z",
    "personal",
    { kind: "user", id: "fixture-user" },
  );
  input.workspace.themes = [{ id: "personal", name: "個人業務", ai_visibility: ["m365"] }];
  input.workspace.notes = [{ ...work.note, ai_visibility: ["m365"] }];
  input.workspace.capture_entries = [
    {
      id: "loose-input",
      text: "未整理の観測",
      captured_at: "2026-09-06T10:00:00.000Z",
      state: "untriaged",
      ai_visibility: ["m365"],
    },
  ];
  input.workspace.change_events.push(
    work.companion.event,
    ...["task_updated", "task_ai_reported", "task_ai_accepted"].map((kind) =>
      buildActivityEvent({
        id: kind,
        entity_type: "task",
        entity_id: task.id,
        event_kind: kind,
        occurred_at: "2026-09-06T10:00:00.000Z",
        after: task,
        changed_fields: ["today_date"],
        metadata: { dedupe_key: kind },
      }),
    ),
  );
  const before = JSON.stringify(input.workspace);
  const plan = buildDailyContextPlan(input);
  assert.equal(plan.includedCount, 6);
  assert.deepEqual(
    new Set(plan.rows.map((row) => row.stage)),
    new Set(["work_recorded", "input", "planned", "ai_reported", "human_accepted"]),
  );
  assert.equal(
    plan.rows.find((row) => row.source.id === "unfinished-work").dateBasis,
    "performed_day",
  );
  assert.equal(plan.rows.find((row) => row.source.id === "loose-input").themeId, null);
  assert.match(plan.content, /Task完了の操作/);
  assert.match(plan.content, /本人が申告した実施日/);
  const result = publish(temporary(t), plan);
  assert.equal(fs.readFileSync(result.path, "utf8"), plan.content);
  assert.equal(JSON.stringify(input.workspace), before);
});

test("preview bytes match publication and republishing removes private records", (t) => {
  const root = temporary(t);
  const input = fixture();
  const plan = buildDailyContextPlan(input);
  const result = publish(root, plan);
  assert.equal(result.cloudStatus, "unknown");
  assert.equal(fs.readFileSync(result.path, "utf8"), plan.content);
  assert.equal(publish(root, plan).path, result.path);
  input.workspace.tasks[0].ai_visibility = [];
  const privatePlan = buildDailyContextPlan(input);
  assert.equal(privatePlan.includedCount, 0);
  assert.throws(
    () => publish(root, privatePlan, { expectedContentHash: plan.contentHash }),
    /プレビュー/,
  );
  publish(root, privatePlan);
  assert.doesNotMatch(fs.readFileSync(result.path, "utf8"), /公開された作業/);
});

test("foreign folders and externally edited files remain untouched", (t) => {
  const root = temporary(t);
  const plan = buildDailyContextPlan(fixture());
  fs.mkdirSync(path.join(root, "Tasken Context"));
  assert.throws(() => publish(root, plan), /既存/);
  fs.rmdirSync(path.join(root, "Tasken Context"));
  const result = publish(root, plan);
  fs.writeFileSync(result.path, "external edit");
  assert.throws(() => publish(root, plan), /外部で変更/);
  assert.equal(fs.readFileSync(result.path, "utf8"), "external edit");
});

test("failed replacement preserves the previous day and records a retryable pending operation", (t) => {
  const root = temporary(t);
  const input = fixture();
  const old = buildDailyContextPlan(input);
  const result = publish(root, old);
  input.generatedAt = "2026-09-06T16:00:00.000Z";
  const next = buildDailyContextPlan(input);
  const failingFs = {
    ...fs,
    writeFileSync(target, ...args) {
      if (path.basename(target).startsWith(".2026-09-06.md."))
        throw Object.assign(new Error("disk full"), { code: "ENOSPC" });
      return fs.writeFileSync(target, ...args);
    },
  };
  assert.throws(() => publish(root, next, { fileSystem: failingFs }), /未完了/);
  assert.equal(fs.readFileSync(result.path, "utf8"), old.content);
  const manifestPath = path.join(root, "Tasken Context", ".tasken-context.json");
  assert.equal(JSON.parse(fs.readFileSync(manifestPath)).pending.date, "2026-09-06");
  publish(root, next);
  assert.equal(JSON.parse(fs.readFileSync(manifestPath)).pending, null);
});

test("missing destinations and unconfirmed partial plans are rejected", (t) => {
  const root = temporary(t);
  const plan = buildDailyContextPlan({ ...fixture(501), maxPages: 1 });
  assert.throws(() => publish(root, plan), /部分取得/);
  assert.throws(() => publish(path.join(root, "missing"), plan, { allowPartial: true }), /folder/);
  publish(root, plan, { allowPartial: true });
});

test("failure creating the first manifest can be retried without claiming a foreign folder", (t) => {
  const root = temporary(t);
  const plan = buildDailyContextPlan(fixture());
  const failingFs = {
    ...fs,
    writeFileSync() {
      throw Object.assign(new Error("permission denied"), { code: "EACCES" });
    },
  };
  assert.throws(() => publish(root, plan, { fileSystem: failingFs }), /permission denied/);
  assert.equal(fs.existsSync(path.join(root, "Tasken Context")), false);
  publish(root, plan);
});

test("junction descendants are refused without writing outside the chosen folder", (t) => {
  const root = temporary(t);
  const outside = temporary(t);
  const plan = buildDailyContextPlan(fixture());
  publish(root, plan);
  const dayPath = path.join(root, "Tasken Context", "Days");
  fs.unlinkSync(path.join(dayPath, "2026-09-06.md"));
  fs.rmdirSync(dayPath);
  fs.symlinkSync(outside, dayPath, "junction");
  assert.throws(() => publish(root, plan), /symlink\/junction/);
  assert.deepEqual(fs.readdirSync(outside), []);
});
