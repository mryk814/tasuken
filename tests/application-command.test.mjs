import assert from "node:assert/strict";
import { Buffer } from "node:buffer";
import { build } from "esbuild";
import path from "node:path";
import { mkdtemp, rm } from "node:fs/promises";
import { readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import test from "node:test";

async function importBundled(relativePath) {
  const result = await build({
    entryPoints: [path.resolve(relativePath)],
    bundle: true,
    platform: "node",
    format: "esm",
    write: false,
    logLevel: "silent",
  });
  return import(
    `data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString("base64")}`
  );
}

const { ApplicationCommandService, commandFingerprint } = await importBundled(
  "src/main/services/applicationCommandService.ts",
);
const { parseCommandEnvelope } = await importBundled("src/shared/applicationCommand.ts");
const { TaskCapabilityService } = await importBundled(
  "src/main/modules/task/application/taskCapabilityService.ts",
);
const { TASK_CONTRACT_SCHEMA_VERSION } = await importBundled(
  "src/shared/contracts/task/version.ts",
);
const { selectTodayTasks } = await importBundled("src/shared/todayTasks.mjs");
const { WorkspaceDatabase } = await import("../src/main/repositories/workspaceRepository.mjs");

function repository() {
  const records = new Map();
  const key = (type, id) => `${type}:${id}`;
  records.set(key("theme", "theme-personal-default"), {
    __type: "theme",
    id: "theme-personal-default",
    name: "個人業務",
    version: 1,
  });
  return {
    records,
    list(type) {
      return [...records.values()].filter((entity) => entity.__type === type);
    },
    get(type, id, includeDeleted = false) {
      const entity = records.get(key(type, id)) || null;
      return entity && (!entity.deleted_at || includeDeleted) ? entity : null;
    },
    saveMany(operations) {
      return operations.map(({ type, entity }) => {
        const current = records.get(key(type, entity.id));
        const saved = { ...entity, __type: type, version: Number(current?.version || 0) + 1 };
        records.set(key(type, entity.id), saved);
        return saved;
      });
    },
    save(type, entity) {
      return this.saveMany([{ action: "save", type, entity }])[0];
    },
    remove(type, id) {
      const current = records.get(key(type, id));
      if (!current) return null;
      const deleted = {
        ...current,
        deleted_at: "2026-08-08T00:00:00.000Z",
        version: Number(current.version || 0) + 1,
      };
      records.set(key(type, id), deleted);
      return deleted;
    },
    runTransaction(callback) {
      return callback(this);
    },
  };
}

function envelope(name, payload, commandId, expectedVersions = []) {
  return {
    commandId,
    name,
    payload,
    actor: { kind: "user" },
    source: "main_ui",
    expectedVersions,
    issuedAt: "2026-08-08T00:00:00.000Z",
  };
}

test("Task delegation rejects malformed Unicode IDs at the Application Command boundary", () => {
  const taskEntityType = "task";
  const base = {
    commandId: "delegate-invalid-unicode",
    name: "DelegateTaskToAgent",
    actor: { kind: "user", id: "mobile-user" },
    source: "mobile",
    issuedAt: "2026-08-30T01:00:00.000Z",
    payload: {
      taskId: "task-valid",
      agent: "hermes",
      contextFingerprint: `sha256:${"a".repeat(64)}`,
    },
    expectedVersions: [{ type: taskEntityType, id: "task-valid", version: 1 }],
  };
  assert.throws(
    () => parseCommandEnvelope({ ...base, payload: { ...base.payload, taskId: "\ud800" } }),
    /payload/u,
  );
  assert.throws(
    () =>
      parseCommandEnvelope({
        ...base,
        expectedVersions: [{ type: taskEntityType, id: "\ud800", version: 1 }],
      }),
    /expectedVersions/u,
  );
});

test("Task commands keep Theme/schedule/event fields identical across create entry points", () => {
  const repo = repository();
  const service = new ApplicationCommandService(repo);
  const task = { id: "task-a", title: "A", state: "todo", project_id: "", priority: "normal" };
  const schedule = {
    id: "schedule-a",
    owner_type: "task",
    owner_id: "task-a",
    end_date: "2026-08-08",
    date_kind: "deadline",
    confidence: "fixed",
    granularity: "day",
  };
  const receipt = service.execute(envelope("CreateTask", { task, schedule }, "cmd-a"));
  assert.equal(receipt.status, "applied");
  assert.equal(repo.get("task", "task-a").project_id, "theme-personal-default");
  assert.equal(repo.get("schedule", "schedule-a").owner_id, "task-a");
  assert.equal(repo.get("change_event", receipt.events[0]).change_type, "created");
  assert.deepEqual(
    JSON.parse(repo.get("change_event", receipt.events[0]).after_json),
    receipt.changes.find(({ type }) => type === "task").entity,
  );
  assert.equal(receipt.eventChanges?.length, 2);
  assert.ok(receipt.eventChanges.every(({ entity }) => !Object.hasOwn(entity, "receipt_json")));
  const persistedReceipt = JSON.parse(repo.get("change_event", receipt.events[0]).receipt_json);
  assert.equal(Object.hasOwn(persistedReceipt, "eventChanges"), false);
  for (const eventChange of receipt.eventChanges) {
    assert.equal(
      eventChange.entity.version,
      repo.get("change_event", eventChange.entity.id).version,
    );
  }
  const retry = service.execute(envelope("CreateTask", { task, schedule }, "cmd-a"));
  assert.deepEqual(retry, receipt);
  assert.equal(Object.getOwnPropertyDescriptor(retry, "replayed")?.value, true);
  assert.equal(JSON.stringify(retry), JSON.stringify(receipt));
  assert.ok(
    retry.eventChanges.every(
      ({ entity }) => entity.version === repo.get("change_event", entity.id).version,
    ),
  );
  assert.equal(repo.list("change_event").length, 2);
});

test("Task commands carry typed references without reopening a generic SaveOperation channel", () => {
  const repo = repository();
  repo.records.set("note:note-ref", {
    __type: "note",
    id: "note-ref",
    title: "source note",
    version: 1,
  });
  const service = new ApplicationCommandService(repo);
  const receipt = service.execute(
    envelope(
      "CreateTask",
      {
        task: {
          id: "task-ref",
          title: "from selection",
          state: "todo",
          project_id: "theme-personal-default",
        },
        references: [
          {
            id: "reference-ref",
            source_type: "task",
            source_id: "task-ref",
            target_type: "note",
            target_id: "note-ref",
            relation_type: "derived_from",
          },
        ],
      },
      "create-ref",
    ),
  );
  assert.ok(
    receipt.changes.some(
      ({ type, entity }) => type === "reference" && entity.id === "reference-ref",
    ),
  );
  assert.equal(repo.get("reference", "reference-ref").source_id, "task-ref");
});

test("Application Command validates Reference schema and both cross-entity endpoints before writing", () => {
  const service = new ApplicationCommandService(repository());
  const make = (reference) =>
    envelope(
      "CreateTask",
      {
        task: {
          id: `task-${reference.id}`,
          title: "Task",
          state: "todo",
          project_id: "theme-personal-default",
        },
        references: [reference],
      },
      `command-${reference.id}`,
    );
  assert.throws(
    () =>
      service.execute(
        make({
          id: "missing-target",
          source_type: "task",
          source_id: "task-missing-target",
          target_type: "note",
          target_id: "missing-note",
          relation_type: "derived_from",
        }),
      ),
    /存在しません/,
  );

  const deletedRepo = repository();
  deletedRepo.records.set("note:deleted-note", {
    __type: "note",
    id: "deleted-note",
    title: "deleted",
    deleted_at: "2026-08-08T00:00:00.000Z",
    version: 2,
  });
  const deletedService = new ApplicationCommandService(deletedRepo);
  assert.throws(
    () =>
      deletedService.execute(
        make({
          id: "deleted-target",
          source_type: "task",
          source_id: "task-deleted-target",
          target_type: "note",
          target_id: "deleted-note",
          relation_type: "derived_from",
        }),
      ),
    /削除済み/,
  );

  const invalidRepo = repository();
  invalidRepo.records.set("note:note-invalid", {
    __type: "note",
    id: "note-invalid",
    title: "note",
    version: 1,
  });
  const invalidService = new ApplicationCommandService(invalidRepo);
  assert.throws(
    () =>
      invalidService.execute(
        make({
          id: "invalid-type",
          source_type: "theme",
          source_id: "theme-personal-default",
          target_type: "note",
          target_id: "note-invalid",
          relation_type: "derived_from",
        }),
      ),
    /Referenceのsource\/target/,
  );
});

test("Complete/Reopen are idempotent and ordinary edits of completed Tasks are updated", () => {
  const repo = repository();
  const service = new ApplicationCommandService(repo);
  service.execute(
    envelope(
      "CreateTask",
      { task: { id: "task-b", title: "B", state: "todo", project_id: "theme-personal-default" } },
      "create-b",
    ),
  );
  const first = service.execute(
    envelope("CompleteTask", { taskId: "task-b" }, "complete-b", [
      { type: "task", id: "task-b", version: 1 },
    ]),
  );
  assert.equal(first.status, "applied");
  assert.equal(repo.get("change_event", first.events[0]).change_type, "completed");
  const noChange = service.execute(
    envelope("CompleteTask", { taskId: "task-b" }, "complete-b-retry", [
      { type: "task", id: "task-b", version: 2 },
    ]),
  );
  assert.equal(noChange.status, "no_change");
  const edited = service.execute(
    envelope(
      "UpdateTask",
      { task: { ...repo.get("task", "task-b"), title: "B edited" } },
      "edit-b",
      [{ type: "task", id: "task-b", version: 2 }],
    ),
  );
  assert.equal(edited.status, "applied");
  assert.equal(repo.get("change_event", edited.events[0]).change_type, "updated");
  assert.equal(
    repo.list("change_event").filter((event) => event.change_type === "completed").length,
    1,
  );
  const completedWithEdit = service.execute(
    envelope(
      "ReopenTask",
      {
        taskId: "task-b",
        task: { ...repo.get("task", "task-b"), project_id: "", title: "B reopened" },
      },
      "reopen-b",
      [{ type: "task", id: "task-b", version: 3 }],
    ),
  );
  assert.equal(completedWithEdit.status, "applied");
  assert.equal(repo.get("task", "task-b").project_id, "theme-personal-default");
  assert.equal(repo.get("task", "task-b").title, "B reopened");
  assert.throws(
    () =>
      service.execute(
        envelope("ReopenTask", { taskId: "task-b" }, "stale-b", [
          { type: "task", id: "task-b", version: 2 },
        ]),
      ),
    /更新済み/,
  );
  const noChangeRetry = service.execute(
    envelope("CompleteTask", { taskId: "task-b" }, "complete-b-retry", [
      { type: "task", id: "task-b", version: 2 },
    ]),
  );
  assert.deepEqual(noChangeRetry, noChange);
});

test("DeleteTask uses the same expected-version boundary and keeps deletion undoable", () => {
  const repo = repository();
  const service = new ApplicationCommandService(repo);
  service.execute(
    envelope(
      "CreateTask",
      {
        task: {
          id: "delete-task",
          title: "delete me",
          state: "todo",
          project_id: "theme-personal-default",
        },
      },
      "delete-create",
    ),
  );
  const receipt = service.execute(
    envelope("DeleteTask", { taskId: "delete-task" }, "delete-task-command", [
      { type: "task", id: "delete-task", version: 1 },
    ]),
  );
  assert.deepEqual(receipt.deleted, [{ type: "task", id: "delete-task" }]);
  assert.deepEqual(receipt.saved, []);
  assert.deepEqual(receipt.revisions, []);
  assert.equal(
    receipt.changes.find(({ type }) => type === "task").entity.deleted_at,
    "2026-08-08T00:00:00.000Z",
  );
  assert.equal(repo.get("task", "delete-task"), null);
  assert.equal(repo.get("task", "delete-task", true).deleted_at, "2026-08-08T00:00:00.000Z");
  assert.equal(repo.get("task", "delete-task", true).version, 2);
  assert.equal(receipt.events.length, 1);
  assert.equal(repo.get("change_event", receipt.events[0]).change_type, "deleted");
  assert.equal(repo.get("change_event", receipt.events[0]).command_id, "delete-task-command");
  const replay = new ApplicationCommandService(repo).execute(
    envelope("DeleteTask", { taskId: "delete-task" }, "delete-task-command", [
      { type: "task", id: "delete-task", version: 1 },
    ]),
  );
  assert.deepEqual(replay, receipt);
  assert.equal(
    repo.list("change_event").filter((event) => event.command_id === "delete-task-command").length,
    1,
  );
  assert.throws(
    () =>
      service.execute(
        envelope("DeleteTask", { taskId: "delete-task" }, "delete-task-stale", [
          { type: "task", id: "delete-task", version: 1 },
        ]),
      ),
    /削除対象のTaskがありません/,
  );
});

test("Mobile CreateCapture/DeleteCapture are canonical, provenance-bounded, and replay idempotent", () => {
  const repo = repository();
  const service = new ApplicationCommandService(repo);
  const provenance = {
    reported_via: "share_target",
    captured_at: "2026-08-08T00:00:00.000Z",
    capture_method: null,
    recognition_mode: null,
    language: null,
    confidence: null,
    source_audio_available: null,
    shared_mime_type: "text/plain",
  };
  const create = {
    ...envelope(
      "CreateCapture",
      {
        capture: {
          id: "mobile-capture",
          text: "https://example.com/research",
          project_id: "",
          captured_at: provenance.captured_at,
        },
        provenance,
      },
      "mobile-capture-create",
    ),
    source: "mobile",
  };
  const created = service.execute(create);
  assert.equal(created.status, "applied");
  assert.equal(repo.get("capture_entry", "mobile-capture").project_id, "theme-personal-default");
  assert.equal(repo.get("capture_entry", "mobile-capture").text, "https://example.com/research");
  const createEvent = repo.get("change_event", created.events[0]);
  assert.deepEqual(createEvent.metadata.provenance, provenance);
  assert.equal(JSON.stringify(createEvent.metadata).includes("example.com/research"), false);
  assert.deepEqual(service.execute(create), created);
  assert.equal(repo.list("capture_entry").filter(({ id }) => id === "mobile-capture").length, 1);

  const embeddedUrl = {
    ...create,
    commandId: "mobile-capture-embedded",
    payload: {
      ...create.payload,
      capture: {
        ...create.payload.capture,
        id: "mobile-capture-embedded",
        text: "共有された https://example.com/article をあとで読む",
      },
    },
  };
  assert.equal(service.execute(embeddedUrl).status, "applied");
  assert.equal(repo.get("capture_entry", "mobile-capture-embedded").content_type, "text");

  const remove = {
    ...envelope("DeleteCapture", { captureId: "mobile-capture" }, "mobile-capture-delete", [
      { type: "capture_entry", id: "mobile-capture", version: 1 },
    ]),
    source: "mobile",
  };
  const deleted = service.execute(remove);
  assert.deepEqual(deleted.deleted, [{ type: "capture_entry", id: "mobile-capture" }]);
  assert.equal(deleted.changes[0].entity.version, 2);
  assert.equal(repo.get("capture_entry", "mobile-capture"), null);
  assert.deepEqual(service.execute(remove), deleted);
  assert.equal(
    repo
      .list("change_event", true)
      .filter(({ command_id }) => command_id === "mobile-capture-delete").length,
    1,
  );
});

test("Main Today and Today mini use the same explicit-date Task selector", () => {
  const tasks = [
    { id: "today", title: "Today", state: "todo" },
    { id: "ongoing", title: "Ongoing", state: "todo" },
    { id: "done", title: "Done", state: "done" },
  ];
  const schedules = [
    {
      owner_type: "task",
      owner_id: "today",
      start_date: "2026-08-08",
      end_date: "2026-08-08",
      date_kind: "point",
    },
    {
      owner_type: "task",
      owner_id: "ongoing",
      start_date: "2026-08-01",
      end_date: "2026-08-20",
      date_kind: "range",
      range_semantics: "ongoing",
    },
    {
      owner_type: "task",
      owner_id: "done",
      start_date: "2026-08-08",
      end_date: "2026-08-08",
      date_kind: "point",
    },
  ];
  assert.deepEqual(
    selectTodayTasks(tasks, schedules, "2026-08-08").map(({ task }) => task.id),
    ["today"],
  );
});

test("Commands reject missing versions, invalid Theme refs, deleted ID reuse, and stale Schedule ownership", () => {
  const repo = repository();
  const service = new ApplicationCommandService(repo);
  assert.throws(
    () =>
      service.execute(
        envelope(
          "CreateTask",
          { task: { id: "bad-theme", title: "bad", state: "todo", project_id: "project-only" } },
          "bad-theme",
        ),
      ),
    /Themeが存在しません/,
  );
  service.execute(
    envelope(
      "CreateTask",
      {
        task: {
          id: "deleted-id",
          title: "old",
          state: "todo",
          project_id: "theme-personal-default",
        },
      },
      "deleted-create",
    ),
  );
  repo.records.set("task:deleted-id", {
    ...repo.get("task", "deleted-id"),
    deleted_at: "2026-08-08T00:00:00.000Z",
  });
  assert.throws(
    () =>
      service.execute(
        envelope(
          "CreateTask",
          {
            task: {
              id: "deleted-id",
              title: "reuse",
              state: "todo",
              project_id: "theme-personal-default",
            },
          },
          "deleted-reuse",
        ),
      ),
    /既に存在/,
  );
  assert.throws(
    () => service.execute(envelope("CompleteTask", { taskId: "deleted-id" }, "missing-version")),
    /対象Taskがありません/,
  );
  service.execute(
    envelope(
      "CreateTask",
      {
        task: {
          id: "schedule-owner",
          title: "scheduled",
          state: "todo",
          project_id: "theme-personal-default",
        },
        schedule: {
          id: "schedule-owned",
          owner_type: "task",
          owner_id: "schedule-owner",
          end_date: "2026-08-08",
          date_kind: "deadline",
          confidence: "fixed",
          granularity: "day",
        },
      },
      "schedule-create",
    ),
  );
  assert.throws(
    () =>
      service.execute(
        envelope(
          "UpdateTask",
          {
            task: { ...repo.get("task", "schedule-owner"), title: "stale" },
            schedule: { ...repo.get("schedule", "schedule-owned"), end_date: "2026-08-09" },
          },
          "schedule-stale",
          [{ type: "task", id: "schedule-owner", version: 1 }],
        ),
      ),
    /expected version/,
  );
  assert.throws(
    () =>
      service.execute(
        envelope(
          "UpdateTask",
          {
            task: { ...repo.get("task", "schedule-owner"), title: "hijack" },
            schedule: {
              id: "schedule-owned",
              owner_type: "task",
              owner_id: "other-task",
              end_date: "2026-08-09",
              date_kind: "deadline",
              confidence: "fixed",
              granularity: "day",
            },
          },
          "schedule-hijack",
          [
            { type: "task", id: "schedule-owner", version: 1 },
            { type: "schedule", id: "schedule-owned", version: 1 },
          ],
        ),
      ),
    /owner/,
  );
});

test("Batch commands share one transaction boundary and Today policy covers all schedule meanings", () => {
  const repo = repository();
  const service = new ApplicationCommandService(repo);
  const receipts = service.executeBatch([
    envelope(
      "CreateTask",
      { task: { id: "batch-a", title: "A", state: "todo", project_id: "theme-personal-default" } },
      "batch-a",
    ),
    envelope(
      "CreateTask",
      { task: { id: "batch-b", title: "B", state: "todo", project_id: "theme-personal-default" } },
      "batch-b",
    ),
  ]);
  assert.equal(receipts.length, 2);
  assert.ok(repo.get("task", "batch-a"));
  assert.ok(repo.get("task", "batch-b"));
  const rows = selectTodayTasks(
    [
      { id: "window", title: "window", state: "todo" },
      { id: "ongoing", title: "ongoing", state: "todo" },
      { id: "overdue", title: "overdue", state: "todo" },
      { id: "done", title: "done", state: "done" },
    ],
    [
      {
        owner_type: "task",
        owner_id: "window",
        start_date: "2026-08-01",
        end_date: "2026-08-10",
        date_kind: "range",
        range_semantics: "once_within_window",
      },
      {
        owner_type: "task",
        owner_id: "ongoing",
        start_date: "2026-08-01",
        end_date: "2026-08-20",
        date_kind: "range",
        range_semantics: "ongoing",
      },
      {
        owner_type: "task",
        owner_id: "overdue",
        start_date: "2026-08-01",
        end_date: "2026-08-07",
        date_kind: "deadline",
      },
      {
        owner_type: "task",
        owner_id: "done",
        start_date: "2026-08-08",
        end_date: "2026-08-08",
        date_kind: "point",
      },
    ],
    "2026-08-08",
    {
      includeExecutionWindow: true,
      includeOngoing: true,
      includeOverdue: true,
      includeCompleted: true,
    },
  );
  assert.deepEqual(
    rows.map(({ task }) => task.id),
    ["overdue", "ongoing", "window", "done"],
  );
  assert.deepEqual(
    selectTodayTasks(
      [{ id: "window", title: "window", state: "todo" }],
      [
        {
          owner_type: "task",
          owner_id: "window",
          start_date: "2026-08-01",
          end_date: "2026-08-07",
          range_semantics: "once_within_window",
        },
      ],
      "2026-08-08",
      {
        includeExecutionWindow: true,
        includeOngoing: true,
        includeOverdue: false,
        includeCompleted: false,
      },
    ),
    [],
  );
});

test("Repository transaction persists actual receipt/event values and rolls back together", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "tasken-command-"));
  const database = new WorkspaceDatabase(path.join(directory, "workspace.sqlite"));
  try {
    database.loadWorkspace();
    const service = new ApplicationCommandService(database);
    const receipt = service.execute(
      envelope(
        "CreateTask",
        {
          task: {
            id: "actual-task",
            title: "actual",
            state: "todo",
            project_id: "theme-personal-default",
          },
          schedule: {
            id: "actual-schedule",
            owner_type: "task",
            owner_id: "actual-task",
            end_date: "2026-08-08",
            date_kind: "deadline",
            confidence: "fixed",
            granularity: "day",
          },
        },
        "actual-command",
      ),
    );
    const task = database.get("task", "actual-task");
    const event = database.get("change_event", receipt.events[0]);
    assert.deepEqual(receipt.changes.find(({ type }) => type === "task").entity, task);
    assert.deepEqual(JSON.parse(event.after_json), task);
    const persistedReceipt = JSON.parse(event.receipt_json);
    const { eventChanges: _eventChanges, ...baseReceipt } = receipt;
    assert.deepEqual(persistedReceipt, baseReceipt);
    assert.equal(Object.hasOwn(persistedReceipt, "eventChanges"), false);
    assert.ok(
      receipt.eventChanges.every(
        ({ entity }) => entity.version === database.get("change_event", entity.id).version,
      ),
    );
    const retry = service.execute(
      envelope(
        "CreateTask",
        {
          task: {
            id: "actual-task",
            title: "actual",
            state: "todo",
            project_id: "theme-personal-default",
          },
          schedule: {
            id: "actual-schedule",
            owner_type: "task",
            owner_id: "actual-task",
            end_date: "2026-08-08",
            date_kind: "deadline",
            confidence: "fixed",
            granularity: "day",
          },
        },
        "actual-command",
      ),
    );
    assert.deepEqual(retry, receipt);
    assert.ok(
      retry.eventChanges.every(
        ({ entity }) => entity.version === database.get("change_event", entity.id).version,
      ),
    );
    const capture = database.save("capture_entry", {
      id: "actual-capture",
      text: "convert me",
      state: "untriaged",
      captured_at: "2026-08-08T00:00:00.000Z",
    });
    const captureReceipt = service.execute({
      ...envelope(
        "CreateTaskFromCapture",
        {
          task: { id: "converted-task", title: "converted", state: "todo", project_id: "" },
          captureId: capture.id,
          captureVersion: capture.version,
          transition: "triage_to_task",
        },
        "actual-capture-command",
        [{ type: "capture_entry", id: capture.id, version: capture.version }],
      ),
      source: "inbox",
    });
    const convertedTask = database.get("task", "converted-task");
    const convertedCapture = database.get("capture_entry", "actual-capture");
    assert.equal(convertedTask.project_id, "theme-personal-default");
    assert.equal(convertedCapture.state, "triaged");
    assert.deepEqual(
      JSON.parse(database.get("change_event", captureReceipt.events[0]).after_json),
      convertedTask,
    );
    assert.ok(
      captureReceipt.events.some(
        (eventId) =>
          JSON.parse(database.get("change_event", eventId).after_json).id === convertedCapture.id,
      ),
    );
    assert.throws(
      () =>
        database.runTransaction((transaction) => {
          transaction.save("task", {
            id: "rolled-back",
            title: "rollback",
            state: "todo",
            project_id: "theme-personal-default",
          });
          throw new Error("rollback");
        }),
      /rollback/,
    );
    assert.equal(database.get("task", "rolled-back"), null);
  } finally {
    database.db.close();
    await rm(directory, { recursive: true, force: true });
  }
});

test("Organized CreateTask rolls back Task, checklist, Schedule and receipt after a persistence failure", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "tasken-organized-command-"));
  const database = new WorkspaceDatabase(path.join(directory, "workspace.sqlite"));
  try {
    database.loadWorkspace();
    const command = {
      schemaVersion: TASK_CONTRACT_SCHEMA_VERSION,
      command_id: "organized-rollback",
      name: "CreateTask",
      actor: { kind: "user", id: "mobile-device" },
      source: "mobile",
      issued_at: "2026-08-17T13:30:00.000Z",
      payload: {
        task: {
          id: "organized-task",
          title: "比較実験",
          project_id: "theme-personal-default",
          state: "todo",
          priority: "normal",
          description: "元の発話をそのまま保持する。",
          checklist_items: [
            {
              id: "organized-check",
              title: "データを集める",
              done: false,
              sort_order: 0,
              completed_at: null,
            },
          ],
        },
        schedule: {
          start_date: null,
          end_date: "2026-08-24",
          date_kind: "deadline",
          range_semantics: null,
          confidence: "fixed",
          granularity: "day",
        },
      },
    };
    const eventsBefore = database.list("change_event").length;
    let reachedPersistedState = false;
    const failing = new TaskCapabilityService(database, (envelope) =>
      database.runTransaction((transaction) => {
        new ApplicationCommandService(database).execute(envelope);
        assert.ok(transaction.get("task", "organized-task"));
        assert.ok(transaction.get("schedule", "organized-rollback"));
        reachedPersistedState = true;
        throw new Error("simulated persistence failure");
      }),
    );
    const failed = failing.executeCommand(command);
    assert.equal(failed.ok, false);
    assert.equal(failed.error.code, "INTERNAL_ERROR", JSON.stringify(failed.error));
    assert.equal(reachedPersistedState, true);
    assert.equal(database.get("task", "organized-task"), null);
    assert.equal(database.get("schedule", "organized-rollback"), null);
    assert.equal(database.list("change_event").length, eventsBefore);
    const service = new TaskCapabilityService(database, (envelope) =>
      new ApplicationCommandService(database).execute(envelope),
    );
    const retry = service.executeCommand(command);
    assert.equal(retry.ok, true);
    assert.equal(retry.value.task.description, command.payload.task.description);
    assert.deepEqual(retry.value.task.checklist_items, command.payload.task.checklist_items);
    assert.equal(retry.value.task.schedule.version, 1);
  } finally {
    database.db.close();
    await rm(directory, { recursive: true, force: true });
  }
});

test("Capture conversion is an explicit atomic Inbox command and rejects the generic operations tunnel", () => {
  const repo = repository();
  repo.records.set("capture_entry:capture-1", {
    __type: "capture_entry",
    id: "capture-1",
    text: "capture",
    state: "untriaged",
    captured_at: "2026-08-08T00:00:00.000Z",
    version: 4,
  });
  repo.records.set("artifact:artifact-1", {
    __type: "artifact",
    id: "artifact-1",
    title: "file",
    filename: "file.txt",
    source_type: "capture_entry",
    source_id: "capture-1",
    theme_id: "legacy-theme",
    version: 2,
  });
  const service = new ApplicationCommandService(repo);
  const receipt = service.execute({
    ...envelope(
      "CreateTaskFromCapture",
      {
        task: { id: "capture-task", title: "converted", state: "todo", project_id: "" },
        captureId: "capture-1",
        captureVersion: 4,
        transition: "triage_to_task",
        artifactIds: ["artifact-1"],
      },
      "capture-command",
      [
        { type: "capture_entry", id: "capture-1", version: 4 },
        { type: "artifact", id: "artifact-1", version: 2 },
      ],
    ),
    source: "inbox",
  });
  assert.equal(receipt.status, "applied");
  assert.equal(repo.get("task", "capture-task").project_id, "theme-personal-default");
  assert.equal(repo.get("capture_entry", "capture-1").state, "triaged");
  assert.equal(repo.get("capture_entry", "capture-1").triaged_to_id, "capture-task");
  assert.equal(repo.get("artifact", "artifact-1").source_type, "task");
  assert.equal(repo.get("artifact", "artifact-1").source_id, "capture-task");
  assert.equal(repo.get("artifact", "artifact-1").project_id, "theme-personal-default");
  assert.equal(Object.hasOwn(repo.get("artifact", "artifact-1"), "theme_id"), false);
  assert.ok(repo.list("change_event").every((event) => event.command_source === "inbox"));
  assert.throws(
    () =>
      parseCommandEnvelope({
        ...envelope(
          "CreateTask",
          {
            task: {
              id: "tunnel",
              title: "bad",
              state: "todo",
              project_id: "theme-personal-default",
            },
            operations: [{ action: "save", type: "note", entity: { id: "note" } }],
          },
          "tunnel",
        ),
      }),
    /汎用SaveOperation/,
  );
});

test("CommitAudioCapture is a Main-owned typed command and persists the Capture-owned Artifact, Event, and Receipt once", () => {
  const repo = repository();
  const service = new ApplicationCommandService(repo);
  const payload = {
    capture: {
      id: "audio-capture",
      title: "Voice memo",
      text: "voice.mp3",
      kind: "voice_memo",
      content_type: "audio",
      capture_method: "audio_import",
      media_status: "ready",
      transcription_status: "not_requested",
      captured_at: "2026-08-08T00:00:00.000Z",
      state: "untriaged",
      ai_visibility: [],
    },
    artifact: {
      id: "audio-artifact",
      title: "Voice memo",
      filename: "voice.mp3",
      file_type: "mp3",
      mime_type: "audio/mpeg",
      file_size: 4,
      stored_path: "C:/Tasken/Inbox/voice.mp3",
      storage_mode: "managed",
      source_type: "capture_entry",
      source_id: "audio-capture",
      media_kind: "audio",
      duration_ms: 1000,
      content_hash: `sha256:${"a".repeat(64)}`,
      ai_visibility: [],
    },
  };
  const command = { ...envelope("CommitAudioCapture", payload, "audio-command"), source: "inbox" };
  assert.throws(() => service.execute(command), /media session/);
  assert.throws(() => service.executeBatch([command]), /media session/);
  const receipt = service.executeMediaCapture(command);
  assert.equal(receipt.status, "applied");
  assert.deepEqual(
    receipt.changes.map(({ type }) => type),
    ["capture_entry", "artifact"],
  );
  assert.equal(repo.get("artifact", "audio-artifact").source_id, "audio-capture");
  assert.equal(repo.get("change_event", receipt.events[0]).metadata.media_kind, "audio");
  assert.equal(
    JSON.parse(repo.get("change_event", receipt.events[0]).receipt_json).commandId,
    "audio-command",
  );
  const retry = service.executeMediaCapture(command);
  assert.deepEqual(retry, receipt);
  assert.equal(repo.list("artifact").filter(({ id }) => id === "audio-artifact").length, 1);
  assert.equal(
    repo.list("change_event").filter(({ command_id }) => command_id === "audio-command").length,
    1,
  );
  const microphoneCommand = {
    ...envelope(
      "CommitAudioCapture",
      {
        capture: {
          ...payload.capture,
          id: "microphone-capture",
          text: "voice.webm",
          capture_method: "microphone",
        },
        artifact: {
          ...payload.artifact,
          id: "microphone-artifact",
          filename: "voice.webm",
          file_type: "webm",
          mime_type: "audio/webm",
          source_id: "microphone-capture",
        },
      },
      "microphone-command",
    ),
    source: "inbox",
  };
  const microphoneReceipt = service.executeMediaCapture(microphoneCommand);
  assert.equal(microphoneReceipt.status, "applied");
  assert.equal(repo.get("capture_entry", "microphone-capture").capture_method, "microphone");
  assert.throws(
    () =>
      service.executeMediaCapture({
        ...command,
        commandId: "audio-mismatch",
        payload: {
          capture: { ...payload.capture, id: "audio-capture-mismatch" },
          artifact: {
            ...payload.artifact,
            id: "audio-artifact-mismatch",
            source_id: "other-capture",
          },
        },
      }),
    /managed owner/,
  );
});

test("ApplyAiProposal entry decisions are bounded, strict, and type-discriminated at IPC parsing", () => {
  const base = envelope(
    "ApplyAiProposal",
    {
      proposal: { id: "proposal-bounded", version: 1, status: "accepted" },
      decision: "accept",
      decisions: [
        {
          entryIndex: 0,
          type: "note",
          action: "accept",
          acceptedHunks: [0],
          beforeSignature: `sha256:1:${"a".repeat(64)}`,
        },
      ],
      candidates: [{ type: "note", entity: { id: "note-bounded" } }],
    },
    "proposal-bounded:accept:v1",
  );
  assert.equal(parseCommandEnvelope(base).name, "ApplyAiProposal");
  const invalidDecisions = [
    Array.from({ length: 101 }, (_, entryIndex) => ({
      entryIndex,
      type: "artifact",
      action: "ignore",
    })),
    [
      {
        entryIndex: 0,
        type: "note",
        action: "accept",
        acceptedHunks: Array.from({ length: 32_769 }, (_, index) => index),
        beforeSignature: `sha256:1:${"a".repeat(64)}`,
      },
    ],
    [
      {
        entryIndex: 0,
        type: "note",
        action: "accept",
        acceptedHunks: [32_768],
        beforeSignature: `sha256:1:${"a".repeat(64)}`,
      },
    ],
    [
      {
        entryIndex: 0,
        type: "note",
        action: "accept",
        acceptedHunks: [0],
        beforeSignature: "a".repeat(1_000_000),
      },
    ],
    [{ entryIndex: 0, type: "artifact", action: "accept", acceptedHunks: [0] }],
    [
      {
        entryIndex: 0,
        type: "knowledge_node",
        action: "accept",
        beforeSignature: `sha256:1:${"a".repeat(64)}`,
      },
    ],
    [{ entryIndex: 0, type: "sketch", action: "accept", unexpected: true }],
  ];
  for (const decisions of invalidDecisions) {
    assert.throws(
      () => parseCommandEnvelope({ ...base, payload: { ...base.payload, decisions } }),
      /entry decision|decisions/,
    );
  }
});

test("non-content ApplyAiProposal with decisions keeps candidate bodies in its idempotency fingerprint", () => {
  const base = envelope(
    "ApplyAiProposal",
    {
      proposal: {
        id: "proposal-non-content",
        version: 1,
        status: "accepted",
        payload_type: "items",
      },
      decision: "accept",
      decisions: [{ entryIndex: 0, type: "note", action: "ignore" }],
      candidates: [{ type: "task", entity: { id: "task-non-content", title: "canonical body" } }],
    },
    "proposal-non-content:accept:v1",
  );
  const changed = structuredClone(base);
  changed.payload.candidates[0].entity.title = "changed body";
  assert.notEqual(
    commandFingerprint(parseCommandEnvelope(base)),
    commandFingerprint(parseCommandEnvelope(changed)),
  );
});

test("CommitTrimmedVideoArtifact atomically saves a derived Artifact and its lineage", () => {
  const repo = repository();
  repo.records.set("task:trim-task", {
    __type: "task",
    id: "trim-task",
    title: "Demo",
    state: "todo",
    project_id: "theme-personal-default",
    version: 1,
  });
  const source = {
    __type: "artifact",
    id: "source-video",
    title: "Source",
    filename: "source.mp4",
    file_type: "mp4",
    mime_type: "video/mp4",
    file_size: 100,
    stored_path: "C:/Tasken/source.mp4",
    original_path: null,
    target: null,
    storage_mode: "managed",
    copied_at: "2026-08-09T00:00:00.000Z",
    link_type: null,
    link_status: null,
    last_checked_at: null,
    source_type: "task",
    source_id: "trim-task",
    theme_id: "theme-personal-default",
    media_kind: "video",
    capture_method: "screen_recording",
    duration_ms: 2000,
    width_px: 320,
    height_px: 180,
    container: "mp4",
    content_hash: `sha256:${"a".repeat(64)}`,
    media_availability: "available",
    ai_visibility: [],
    version: 1,
  };
  repo.records.set("artifact:source-video", source);
  const artifact = {
    ...source,
    id: "trimmed-video",
    title: "Source trimmed",
    filename: "source-trimmed.mp4",
    stored_path: "C:/Tasken/source-trimmed.mp4",
    duration_ms: 1000,
    content_hash: `sha256:${"b".repeat(64)}`,
  };
  delete artifact.__type;
  delete artifact.version;
  const reference = {
    id: "trim-lineage",
    source_type: "artifact",
    source_id: artifact.id,
    target_type: "artifact",
    target_id: source.id,
    relation_type: "derived_from",
    note: "trim 500ms-1500ms",
  };
  const command = {
    ...envelope("CommitTrimmedVideoArtifact", { artifact, reference }, "trim-command"),
    source: "main_ui",
  };
  const service = new ApplicationCommandService(repo);
  assert.throws(() => service.execute(command), /media session/);
  const receipt = service.executeMediaCapture(command);
  assert.equal(receipt.status, "applied");
  assert.deepEqual(
    receipt.changes.map(({ type }) => type),
    ["artifact", "reference"],
  );
  assert.equal(repo.get("reference", "trim-lineage").target_id, "source-video");
  assert.equal(
    repo.get("change_event", receipt.events[0]).metadata.derived_from_artifact_id,
    "source-video",
  );
});

test("Command source attribution is preserved for every renderer entry", () => {
  const repo = repository();
  const service = new ApplicationCommandService(repo);
  for (const [index, source] of [
    "main_ui",
    "today_window",
    "quick_capture",
    "inbox",
    "command_palette",
  ].entries()) {
    const receipt = service.execute({
      ...envelope(
        "CreateTask",
        {
          task: {
            id: `source-${index}`,
            title: source,
            state: "todo",
            project_id: "theme-personal-default",
          },
        },
        `source-${index}`,
      ),
      source,
    });
    const event = repo.get("change_event", receipt.events[0]);
    assert.equal(event.command_source, source);
    assert.equal(event.actor_kind, "user");
  }
});

test("Command Palette source is attached to the new Drawer after dirty-form flush", () => {
  const source = readFileSync("src/renderer/src/features/workspace/WorkspaceApp.tsx", "utf8");
  assert.match(
    source,
    /if \(!\(await saveDirtyDrawerForm\(\)\)\) return;[\s\S]*setDrawer\(config\);/,
  );
  assert.match(source, /commandSource: "command_palette"/);
  assert.match(source, /entrypoint: drawer\?\.commandSource \|\| "main_ui"/);
  assert.match(source, /taskClient\.applyEdit\(/);
  assert.doesNotMatch(source, /pendingCommandSource/);
});

test("Command notifications skip no-change/retry and delta committed change events", () => {
  const source = readFileSync("src/main/index.ts", "utf8");
  assert.match(source, /receipt\.status !== "no_change"/);
  assert.match(source, /replayed\?: boolean/);
  assert.match(source, /if \(!receipts\.length\) return;/);
  assert.match(
    source,
    /const delta =\s*win\.webContents\.id === senderId \? payloads\.sender\.entities : payloads\.other\.entities/,
  );
  assert.match(
    source,
    /satelliteWindows\?\.broadcast\(IPC\.workspaceChanged, payloads\.satellite\)/,
  );
  assert.match(source, /workspaceRepository\?\.get\("change_event", eventId, true\)/);
  assert.match(source, /type: "change_event" as const/);
  assert.doesNotMatch(
    source,
    /const change = changes\.length \? \{ entities: changes \} : undefined/,
  );
});

test("CompleteTaskWithLearning atomically keeps the learning Note and repeated next Task/Schedule", () => {
  const repo = repository();
  const service = new ApplicationCommandService(repo);
  service.execute(
    envelope(
      "CreateTask",
      {
        task: {
          id: "learning-task",
          title: "learn",
          state: "todo",
          project_id: "theme-personal-default",
          repeat_rule: { frequency: "daily", interval: 1 },
        },
      },
      "learning-create",
    ),
  );
  const receipt = service.execute(
    envelope(
      "CompleteTaskWithLearning",
      {
        task: { ...repo.get("task", "learning-task"), state: "done" },
        note: {
          id: "learning-note",
          title: "学び",
          body_markdown: "keep this",
          note_type: "learning",
          theme_id: "legacy-theme",
        },
        nextTask: {
          id: "learning-next",
          title: "next",
          state: "todo",
          project_id: "theme-personal-default",
          parent_task_id: "learning-task",
        },
        nextSchedule: {
          id: "learning-next-schedule",
          owner_type: "task",
          owner_id: "learning-next",
          end_date: "2026-08-09",
          date_kind: "deadline",
          confidence: "fixed",
          granularity: "day",
        },
      },
      "learning-complete",
      [{ type: "task", id: "learning-task", version: 1 }],
    ),
  );
  assert.equal(receipt.status, "applied");
  assert.equal(repo.get("task", "learning-task").state, "done");
  assert.equal(repo.get("note", "learning-note").project_id, "theme-personal-default");
  assert.equal(Object.hasOwn(repo.get("note", "learning-note"), "theme_id"), false);
  assert.equal(repo.get("task", "learning-next").parent_task_id, "learning-task");
  assert.equal(repo.get("schedule", "learning-next-schedule").owner_id, "learning-next");
  assert.equal(receipt.events.length, 4);
  assert.equal(
    repo.list("change_event").filter((event) => event.command_id === "learning-complete").length,
    4,
  );
});

test("EndFocusSession preserves complete/no-complete mixed surfaces in one typed transaction", () => {
  const repo = repository();
  const service = new ApplicationCommandService(repo);
  const task = service.execute(
    envelope(
      "CreateTask",
      {
        task: {
          id: "focus-task",
          title: "focus",
          state: "todo",
          project_id: "theme-personal-default",
        },
      },
      "focus-task-create",
    ),
  );
  repo.save("note", {
    id: "focus-session",
    title: "Focus Session: focus",
    body_markdown: "scratch",
    project_id: "theme-personal-default",
    properties_json: {
      document_role: "focus_session",
      session_state: "active",
      task_id: "focus-task",
    },
  });
  const complete = service.execute(
    envelope(
      "EndFocusSession",
      {
        session: {
          ...repo.get("note", "focus-session"),
          properties_json: {
            document_role: "focus_session",
            session_state: "ended",
            task_id: "focus-task",
          },
        },
        task: { ...repo.get("task", "focus-task"), state: "done" },
        promotedNote: {
          id: "focus-promoted",
          title: "memo",
          body_markdown: "memo",
          project_id: "theme-personal-default",
        },
        promotedReference: {
          id: "focus-reference",
          source_type: "note",
          source_id: "focus-promoted",
          target_type: "task",
          target_id: "focus-task",
          relation_type: "related_to",
        },
        nextTask: {
          id: "focus-next",
          title: "next",
          state: "todo",
          project_id: "theme-personal-default",
          parent_task_id: "focus-task",
        },
        statusUpdate: {
          id: "focus-status",
          theme_id: "theme-personal-default",
          summary: "Focus ended",
        },
        completeTask: true,
      },
      "focus-end",
      [
        { type: "note", id: "focus-session", version: 1 },
        {
          type: "task",
          id: "focus-task",
          version: task.changes.find(({ type }) => type === "task").entity.version,
        },
      ],
    ),
  );
  assert.equal(complete.status, "applied");
  assert.equal(repo.get("task", "focus-task").state, "done");
  assert.equal(
    repo.get("task", "focus-task").completed_at,
    repo.get("note", "focus-session").properties_json.ended_at,
  );
  assert.equal(repo.get("reference", "focus-reference").target_id, "focus-task");
  assert.ok(repo.get("status_update", "focus-status"));

  const noCompleteTask = service.execute(
    envelope(
      "CreateTask",
      {
        task: {
          id: "focus-no-complete",
          title: "focus 2",
          state: "todo",
          project_id: "theme-personal-default",
        },
      },
      "focus-task-create-2",
    ),
  );
  repo.save("note", {
    id: "focus-session-2",
    title: "Focus Session: focus 2",
    body_markdown: "scratch",
    project_id: "theme-personal-default",
    properties_json: {
      document_role: "focus_session",
      session_state: "active",
      task_id: "focus-no-complete",
    },
  });
  const noComplete = service.execute(
    envelope(
      "EndFocusSession",
      {
        session: {
          ...repo.get("note", "focus-session-2"),
          properties_json: {
            document_role: "focus_session",
            session_state: "ended",
            task_id: "focus-no-complete",
          },
        },
        task: repo.get("task", "focus-no-complete"),
        nextTask: {
          id: "focus-next-2",
          title: "next 2",
          state: "todo",
          project_id: "theme-personal-default",
          parent_task_id: "focus-no-complete",
        },
        completeTask: false,
      },
      "focus-end-2",
      [{ type: "note", id: "focus-session-2", version: 1 }],
    ),
  );
  assert.equal(noComplete.status, "applied");
  assert.equal(repo.get("task", "focus-no-complete").state, "todo");
  assert.ok(repo.get("task", "focus-next-2"));
  assert.equal(
    noComplete.events.some(
      (id) => JSON.parse(repo.get("change_event", id).after_json)?.id === "focus-no-complete",
    ),
    false,
  );
  assert.equal(noCompleteTask.changes.find(({ type }) => type === "task").entity.state, "todo");
});

test("ApplyAiProposal commits a typed multi-candidate set with proposal status atomically", () => {
  const repo = repository();
  repo.save("ai_proposal", {
    id: "proposal-1",
    source: "manual",
    payload_type: "items",
    status: "pending",
  });
  const service = new ApplicationCommandService(repo);
  const receipt = service.execute(
    envelope(
      "ApplyAiProposal",
      {
        proposal: { ...repo.get("ai_proposal", "proposal-1"), status: "accepted" },
        candidates: [
          {
            type: "task",
            entity: { id: "ai-task", title: "AI task", state: "todo", project_id: "" },
          },
          {
            type: "note",
            entity: { id: "ai-note", title: "AI note", body_markdown: "body", project_id: "" },
          },
          {
            type: "waiting",
            entity: {
              id: "ai-waiting",
              title: "AI waiting",
              waiting_for: "someone",
              state: "waiting",
              project_id: "theme-personal-default",
            },
          },
          {
            type: "schedule",
            entity: {
              id: "ai-schedule",
              owner_type: "task",
              owner_id: "ai-task",
              end_date: "2026-08-09",
              date_kind: "deadline",
              confidence: "fixed",
              granularity: "day",
            },
          },
          { type: "knowledge_node", entity: { id: "ai-node-a", node_type: "claim", title: "A" } },
          {
            type: "knowledge_node",
            entity: { id: "ai-node-b", node_type: "evidence", title: "B" },
          },
          {
            type: "knowledge_edge",
            entity: {
              id: "ai-edge",
              source_node_id: "ai-node-a",
              target_node_id: "ai-node-b",
              relation_type: "supports",
            },
          },
          {
            type: "repository_context",
            entity: {
              id: "ai-repository-context",
              label: "Tasken",
              remote_url: "https://user:password@github.com/mryk814/tasuken.git?token=drop#readme",
            },
          },
        ],
      },
      "proposal-accept",
      [{ type: "ai_proposal", id: "proposal-1", version: 1 }],
    ),
  );
  assert.equal(receipt.status, "applied");
  assert.equal(repo.get("ai_proposal", "proposal-1").status, "accepted");
  assert.equal(repo.get("task", "ai-task").project_id, "theme-personal-default");
  assert.equal(repo.get("note", "ai-note").project_id, "");
  const savedAiNote = { ...repo.get("note", "ai-note") };
  delete savedAiNote.version;
  delete savedAiNote.__type;
  assert.deepEqual(savedAiNote, {
    id: "ai-note",
    title: "AI note",
    body_markdown: "body",
    project_id: "",
  });
  assert.equal(repo.get("waiting", "ai-waiting").project_id, "theme-personal-default");
  assert.equal(repo.get("schedule", "ai-schedule").owner_id, "ai-task");
  assert.equal(repo.get("knowledge_edge", "ai-edge").source_node_id, "ai-node-a");
  assert.equal(repo.get("repository_context", "ai-repository-context").label, "Tasken");
  assert.equal(
    repo.get("repository_context", "ai-repository-context").canonical_url,
    "https://github.com/mryk814/tasuken",
  );
  assert.equal(
    JSON.stringify(repo.get("repository_context", "ai-repository-context")).includes("password"),
    false,
  );
  assert.equal(receipt.events.length, 9);
  repo.save("ai_proposal", {
    id: "proposal-bad-schedule",
    source: "manual",
    payload_type: "items",
    status: "pending",
  });
  assert.throws(
    () =>
      service.execute(
        envelope(
          "ApplyAiProposal",
          {
            proposal: { ...repo.get("ai_proposal", "proposal-bad-schedule"), status: "accepted" },
            candidates: [
              {
                type: "schedule",
                entity: {
                  id: "ai-bad-schedule",
                  owner_type: "task",
                  owner_id: "missing-task",
                  end_date: "2026-08-09",
                  date_kind: "deadline",
                  confidence: "fixed",
                  granularity: "day",
                },
              },
            ],
          },
          "proposal-bad-schedule-command",
          [{ type: "ai_proposal", id: "proposal-bad-schedule", version: 1 }],
        ),
      ),
    /owner/,
  );
  repo.save("ai_proposal", {
    id: "proposal-bad-edge",
    source: "manual",
    payload_type: "items",
    status: "pending",
  });
  assert.throws(
    () =>
      service.execute(
        envelope(
          "ApplyAiProposal",
          {
            proposal: { ...repo.get("ai_proposal", "proposal-bad-edge"), status: "accepted" },
            candidates: [
              {
                type: "knowledge_edge",
                entity: {
                  id: "ai-bad-edge",
                  source_node_id: "missing-a",
                  target_node_id: "missing-b",
                  relation_type: "supports",
                },
              },
            ],
          },
          "proposal-bad-edge-command",
          [{ type: "ai_proposal", id: "proposal-bad-edge", version: 1 }],
        ),
      ),
    /両端/,
  );
});

test("ApplyAiProposal rejects a video Artifact candidate before any proposal or artifact write", () => {
  const repo = repository();
  repo.save("ai_proposal", {
    id: "proposal-video",
    source: "manual",
    payload_type: "items",
    status: "pending",
  });
  const service = new ApplicationCommandService(repo);
  assert.throws(
    () =>
      service.execute(
        envelope(
          "ApplyAiProposal",
          {
            proposal: { ...repo.get("ai_proposal", "proposal-video"), status: "accepted" },
            candidates: [
              {
                type: "artifact",
                entity: { id: "ai-video", title: "bypass", filename: "bypass.mp4" },
              },
            ],
          },
          "proposal-video-accept",
          [{ type: "ai_proposal", id: "proposal-video", version: 1 }],
        ),
      ),
    /専用の動画取り込み/,
  );
  assert.equal(repo.get("artifact", "ai-video"), null);
  assert.equal(repo.get("ai_proposal", "proposal-video").status, "pending");
  assert.equal(repo.list("change_event").length, 0);
});

test("WorkspaceApp maps reachable mixed flows to named commands and preserves other Task paths", () => {
  const workspaceApp = readFileSync("src/renderer/src/features/workspace/WorkspaceApp.tsx", "utf8");
  const drawer = readFileSync("src/renderer/src/features/workspace/components/drawer.tsx", "utf8");
  const focus = readFileSync(
    "src/renderer/src/features/workspace/components/FocusSessionDialog.tsx",
    "utf8",
  );
  const ai = readFileSync(
    "src/renderer/src/features/workspace/components/AiProposalPanel.tsx",
    "utf8",
  );
  const scratchpad = readFileSync(
    "src/renderer/src/features/workspace/components/DailyScratchpadDialog.tsx",
    "utf8",
  );
  const registerIpc = readFileSync("src/main/ipc/registerIpc.ts", "utf8");
  const workspaceApi = readFileSync("src/renderer/src/services/workspaceApi.ts", "utf8");
  const todo = readFileSync("src/renderer/src/features/workspace/pages/TodoPage.tsx", "utf8");
  const timeline = readFileSync(
    "src/renderer/src/features/workspace/pages/TimelinePage.tsx",
    "utf8",
  );
  assert.match(workspaceApp, /name: "CompleteTaskWithLearning"/);
  assert.match(workspaceApp, /name: "EndFocusSession"/);
  assert.match(workspaceApp, /name: "ApplyAiProposal"/);
  assert.match(workspaceApp, /nextTask: nextTaskOperations/);
  assert.match(workspaceApp, /payload: \{ proposal: proposalOperation\.entity, candidates \}/);
  assert.match(drawer, /note_type: "learning"/);
  assert.match(focus, /buildSelectionExtractionOperations/);
  assert.match(ai, /buildCandidateOperations/);
  assert.match(scratchpad, /saveEntities\(result\.operations/);
  assert.match(todo, /buildCompleteTaskOperations/);
  assert.match(todo, /duplicateTask/);
  assert.match(timeline, /timelineAddDependencyOperations/);
  assert.match(workspaceApp, /executeCommands\(envelopes\)/);
  assert.match(workspaceApp, /planTaskEdit\(/);
  assert.doesNotMatch(workspaceApp, /isCompleting|isReopening/);
  assert.match(workspaceApp, /taskClient\.delete\(/);
  assert.match(registerIpc, /rejectTaskPersistence\(entityType\)/);
  assert.match(registerIpc, /types\.includes\("task"\)/);
  assert.match(workspaceApi, /Taskの保存はApplication Command経由/);
});
