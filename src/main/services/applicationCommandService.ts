import { randomUUID } from "node:crypto";

import { canonicalThemeId } from "../../shared/themeRef.mjs";
import { entityDefinition, referenceRelationTypes, referenceTargetEntityTypes } from "../../shared/entityRegistry.mjs";
import { buildActivityEvent } from "../../shared/activityEvent.mjs";
import { normalizeTaskAssignment } from "../repositories/domain.mjs";
import type { Entity, EntityType, SaveOperation } from "../../shared/types/workspace";
import {
  ApplicationCommandError,
  parseCommandEnvelope,
  type ApplicationCommandName,
  type CommandEnvelope,
  type CommandReceipt,
  type ExpectedVersion,
} from "../../shared/applicationCommand";
import { applicationCommandSources } from "../../shared/applicationCommand";

interface Repository {
  list(type: EntityType, includeDeleted?: boolean): Entity[];
  get(type: EntityType, id: string, includeDeleted?: boolean): Entity | null;
  saveMany(operations: SaveOperation[]): Entity[];
  save(type: EntityType, entity: Entity): Entity;
  remove(type: EntityType, id: string): Entity | null;
  runTransaction<T>(callback: (repository: Repository) => T): T;
}

const now = () => new Date().toISOString();
const taskDefinition = entityDefinition("task");
const referenceDefinition = entityDefinition("reference");
const workReceiptDefinition = entityDefinition("work_receipt");
const taskWorkStates = new Set(["not_delegated", "ready_for_agent", "in_progress", "reported_done", "needs_human_review", "accepted", "blocked", "failed"]);
const taskExecutorKinds = new Set(["self", "human", "ai_agent", "external", "unknown"]);

function currentWorkState(task: Entity): string {
  if (typeof task.work_state === "string" && taskWorkStates.has(task.work_state)) return task.work_state;
  return task.intended_executor === "ai_agent" ? "ready_for_agent" : "not_delegated";
}

function assertHumanAcceptBeforeCompletion(task: Entity): void {
  if (task.intended_executor === "ai_agent" && currentWorkState(task) !== "accepted") {
    throw new ApplicationCommandError("INVALID_TRANSITION", "AIの報告だけではTaskを完了できません。人間がWork Receiptを確認してから完了してください。", { id: task.id });
  }
}

function workExecutorLabel(task: Entity, receipt?: Entity): string {
  return String(receipt?.executor_label || task.executor_identity || (task.intended_executor === "ai_agent" ? "AI agent" : "Task executor"));
}

function mcpTaskWorkProposal(repository: Repository, taskId: string, sourceSession: string): Entity | null {
  const proposal = repository.get("ai_proposal", sourceSession, true);
  if (!proposal || proposal.source !== "mcp" || proposal.payload_type !== "task_work") return null;
  let payload: unknown = proposal.payload;
  if (typeof payload === "string") {
    try {
      payload = JSON.parse(payload);
    } catch {
      return null;
    }
  }
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return null;
  const entries = (payload as { task_work?: unknown }).task_work;
  if (!Array.isArray(entries)) return null;
  return entries.some((entry) => entry && typeof entry === "object" && !Array.isArray(entry)
    && (entry as { task_id?: unknown }).task_id === taskId
    && ["append_receipt", "report_done"].includes(String((entry as { action?: unknown }).action)))
    ? proposal
    : null;
}

function workReceiptProvenance(repository: Repository, command: CommandEnvelope, taskId: string, receipt: Entity): {
  source: "manual" | "ai" | "migration";
  metadata: Record<string, unknown>;
  sourceSession?: string;
} {
  const requestedSourceSession = typeof receipt.source_session === "string" && receipt.source_session.trim()
    ? receipt.source_session.trim()
    : "";
  const proposal = requestedSourceSession ? mcpTaskWorkProposal(repository, taskId, requestedSourceSession) : null;
  const reportedViaMcp = proposal?.source === "mcp";
  const source = receipt.executor_kind === "ai_agent" || reportedViaMcp
    ? "ai"
    : command.actor.kind === "system" ? "migration" : "manual";
  return {
    source,
    ...(proposal ? { sourceSession: proposal.id } : {}),
    metadata: {
      reported_via: reportedViaMcp ? "mcp" : command.source,
      ...(proposal ? { proposal_id: proposal.id } : {}),
      ...(command.actor.kind === "user" && command.source !== "mcp" ? { imported_by: "human" } : {}),
    },
  };
}

function latestWorkReceipt(repository: Repository, taskId: string): Entity | null {
  return repository.list("work_receipt", true)
    .filter((receipt) => receipt.task_id === taskId && !receipt.deleted_at)
    .sort((left, right) => String(right.reported_at).localeCompare(String(left.reported_at)) || Number(right.version || 0) - Number(left.version || 0))[0] || null;
}

function assertHumanReviewActor(command: CommandEnvelope, action: string): void {
  if (command.actor.kind !== "user" || command.source === "mcp") {
    throw new ApplicationCommandError("INVALID_ENVELOPE", `${action}は人間UIからのみ実行できます。`);
  }
}

function asTask(payload: unknown): Entity {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    throw new ApplicationCommandError("INVALID_PAYLOAD", "Task payloadが不正です。");
  }
  const task = (payload as { task?: unknown }).task;
  if (!task || typeof task !== "object" || Array.isArray(task)) {
    throw new ApplicationCommandError("INVALID_PAYLOAD", "Task recordが不正です。");
  }
  taskDefinition.parseCreate(task);
  if (typeof (task as Entity).id !== "string" || !(task as Entity).id.trim()) {
    throw new ApplicationCommandError("INVALID_PAYLOAD", "Task IDがありません。");
  }
  const title = (task as Record<string, unknown>).title;
  if (typeof title !== "string" || !title.trim()) {
    throw new ApplicationCommandError("INVALID_PAYLOAD", "Taskタイトルがありません。");
  }
  return task as Entity;
}

function asTaskId(payload: unknown): string {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    throw new ApplicationCommandError("INVALID_PAYLOAD", "Task command payloadが不正です。");
  }
  const taskId = (payload as { taskId?: unknown }).taskId;
  if (typeof taskId !== "string" || !taskId.trim()) {
    throw new ApplicationCommandError("INVALID_PAYLOAD", "Task IDがありません。");
  }
  return taskId;
}

function expectedVersionFor(envelope: CommandEnvelope, type: EntityType, id: string): ExpectedVersion | undefined {
  return envelope.expectedVersions?.find((expected) => expected.type === type && expected.id === id);
}

function changeType(before: Entity | null, after: Entity, command: ApplicationCommandName): "created" | "updated" | "completed" {
  if (!before) return "created";
  if (before.state !== "done" && after.state === "done") return "completed";
  // Reopen and an edit of an already completed task are ordinary updates.  A
  // completed task must never receive another completed event just because its
  // title/checklist was edited.
  return "updated";
}

function commandEvent(
  command: CommandEnvelope,
  entityType: EntityType,
  entityId: string,
  kind: "created" | "updated" | "completed" | "rescheduled" | "triaged",
  before: Entity | null,
  after: Entity,
  eventKind?: string,
  workReceiptRef?: { type: string; id: string; revision?: number } | null,
  sourceOverride?: "manual" | "ai" | "migration",
): Entity {
  const refType = entityType === "schedule" ? "task" : entityType;
  const source = sourceOverride || (command.actor.kind === "system" ? "migration" : command.actor.kind === "ai_agent" ? "ai" : "manual");
  return {
    ...buildActivityEvent({
      id: randomUUID(),
      entityType: refType,
      entityId,
      eventKind: eventKind || (entityType === "schedule" ? "schedule_updated" : undefined),
      occurredAt: now(),
      changeType: kind,
      before,
      after,
      before_json: before ? JSON.stringify(before) : null,
      after_json: JSON.stringify(after),
      source,
      actor: command.actor,
      origin: {
        kind: "application_command",
        command_id: command.commandId,
        command_name: command.name,
        session_id: command.sessionId || command.commandId,
      },
      command_id: command.commandId,
      command_name: command.name,
      command_source: command.source,
      reason: `application-command:${command.name}`,
      metadata: {
        command_id: command.commandId,
        command_name: command.name,
        command_source: command.source,
        session_id: command.sessionId || command.commandId,
        // One command can persist a Task plus Note/Artifact/Schedule events.
        // The command ID gives retry idempotency; the typed event identity
        // keeps those sibling events from collapsing into one row.
        dedupe_key: `command:${command.commandId}:${entityType}:${entityId}:${kind}`,
      },
      work_receipt_ref: workReceiptRef || null,
    }),
    entity_type: refType,
    record_type: entityType,
  };
}

function savedRef(type: EntityType, entity: Entity): { type: EntityType; id: string; version: number } {
  return { type, id: entity.id, version: Number(entity.version || 0) };
}

function receiptFor(command: CommandEnvelope, status: CommandReceipt["status"], changes: Array<{ type: EntityType; entity: Entity }> = [], events: string[] = []): CommandReceipt {
  const saved = changes.map(({ type, entity }) => savedRef(type, entity));
  return {
    commandId: command.commandId,
    name: command.name,
    status,
    saved,
    deleted: [],
    events,
    warnings: [],
    revisions: saved,
    changes,
  };
}

function withoutReceiptJson(entity: Entity): Entity {
  const { receipt_json: _receiptJson, ...event } = entity;
  return event;
}

function annotateEvent(command: CommandEnvelope, event: Entity): Entity {
  return {
    ...event,
    command_source: command.source,
    actor_kind: command.actor.kind,
    actor_id: command.actor.id || null,
    command_fingerprint: commandFingerprint(command),
  };
}

function eventChangesFor(repository: Repository, eventIds: string[]): CommandReceipt["eventChanges"] {
  return eventIds
    .map((eventId) => repository.get("change_event", eventId, true))
    .filter((event): event is Entity => Boolean(event))
    .map((event) => ({ type: "change_event" as const, entity: withoutReceiptJson(event) }));
}

function commandFingerprint(command: CommandEnvelope): string {
  return JSON.stringify({
    name: command.name,
    payload: command.payload,
    actor: command.actor,
    source: command.source,
    windowId: command.windowId || null,
    sessionId: command.sessionId || null,
    expectedVersions: command.expectedVersions || [],
    issuedAt: command.issuedAt,
  });
}

function readIdempotent(repository: Repository, command: CommandEnvelope): CommandReceipt | null {
  const existing = repository.list("change_event", true).find((event) => event.command_id === command.commandId);
  if (!existing) return null;
  if (existing.command_name !== command.name || existing.command_fingerprint !== commandFingerprint(command) || typeof existing.receipt_json !== "string") {
    throw new ApplicationCommandError("COMMAND_ID_REUSED", "同じcommandIdを別のCommandで再利用できません。", { commandId: command.commandId });
  }
  const storedReceipt = JSON.parse(existing.receipt_json) as CommandReceipt;
  const receipt = storedReceipt.status === "applied"
    ? { ...storedReceipt, eventChanges: eventChangesFor(repository, storedReceipt.events) }
    : storedReceipt;
  // This is process-local notification metadata, not part of receipt_json.  The
  // IPC handler uses it to avoid rebroadcasting a retry while the renderer still
  // receives the exact persisted receipt.
  Object.defineProperty(receipt, "replayed", { value: true, enumerable: false });
  return receipt;
}

function assertThemeExists(repository: Repository, task: Entity): void {
  const themeId = task.project_id;
  if (typeof themeId !== "string" || !themeId.trim()) {
    throw new ApplicationCommandError("INVALID_PAYLOAD", "Taskのcanonical Theme IDがありません。");
  }
  const exists = repository.list("theme").some((theme) => theme.id === themeId);
  if (!exists) {
    throw new ApplicationCommandError("INVALID_PAYLOAD", `Themeが存在しません: ${themeId}`, { themeId });
  }
}

function persistReceipt(repository: Repository, command: CommandEnvelope, operations: SaveOperation[], eventIds: string[], changeTypes: EntityType[]): CommandReceipt {
  const saved = repository.saveMany(operations);
  const changes = saved
    .map((entity, index) => ({ type: operations[index].type, entity }))
    .filter(({ type }) => changeTypes.includes(type));
  const baseReceipt = receiptFor(command, "applied", changes, eventIds);
  for (const eventId of eventIds) {
    const event = repository.get("change_event", eventId, true);
    if (!event) throw new Error(`Change Eventが保存されていません: ${eventId}`);
    const actualAfter = event.record_type === "schedule"
      ? changes.find(({ type, entity }) => type === "schedule" && entity.owner_type === "task" && entity.owner_id === event.entity_id)?.entity
      : changes.find(({ type, entity }) => type === event.record_type && entity.id === event.entity_id)?.entity;
    repository.save("change_event", {
      ...event,
      after_json: actualAfter ? JSON.stringify(actualAfter) : event.after_json,
      receipt_json: JSON.stringify(baseReceipt),
    });
  }
  return { ...baseReceipt, eventChanges: eventChangesFor(repository, eventIds) };
}

function persistNoChange(repository: Repository, command: CommandEnvelope, taskId: string, current: Entity): CommandReceipt {
  const marker: Entity = {
    id: randomUUID(),
    entity_type: "task",
    entity_id: taskId,
    changed_at: now(),
    change_type: "updated",
    no_change: true,
    source: command.actor.kind === "system" ? "migration" : command.actor.kind === "ai_agent" ? "ai" : "manual",
    command_id: command.commandId,
    command_name: command.name,
    command_source: command.source,
    actor_kind: command.actor.kind,
    actor_id: command.actor.id || null,
    command_fingerprint: commandFingerprint(command),
    before_json: JSON.stringify(current),
    after_json: JSON.stringify(current),
  };
  const receipt = receiptFor(command, "no_change", [], [marker.id]);
  repository.saveMany([{ action: "save", type: "change_event", entity: { ...marker, receipt_json: JSON.stringify(receipt) } }]);
  return receipt;
}

function assertExpectedVersion(repository: Repository, envelope: CommandEnvelope, type: EntityType, id: string, current: Entity | null): void {
  const expected = expectedVersionFor(envelope, type, id);
  if (!expected) return;
  const actual = Number(current?.version || 0);
  if (actual !== expected.version) {
    throw new ApplicationCommandError("CONFLICT", "保存対象が更新済みです。画面を再読み込みしてから再試行してください。", {
      type, id, expected: expected.version, actual,
    });
  }
}

function validateScheduleWrite(repository: Repository, command: CommandEnvelope, schedule: Entity | null | undefined, taskId: string, isCreate: boolean): Entity | null {
  if (!schedule) return null;
  if (schedule.owner_type !== "task" || schedule.owner_id !== taskId) {
    throw new ApplicationCommandError("CONFLICT", "Scheduleのownerを別Taskへ変更できません。", { id: schedule.id });
  }
  const existing = repository.get("schedule", schedule.id, true);
  if (existing) {
    if (isCreate) throw new ApplicationCommandError("CONFLICT", "CreateTaskで既存Schedule IDを再利用できません。", { id: schedule.id });
    if (existing.owner_type !== "task" || existing.owner_id !== taskId) {
      throw new ApplicationCommandError("CONFLICT", "Scheduleのownerを別Taskへ変更できません。", { id: schedule.id });
    }
    if (!expectedVersionFor(command, "schedule", schedule.id)) {
      throw new ApplicationCommandError("CONFLICT", "既存Scheduleの更新にはexpected versionが必要です。", { type: "schedule", id: schedule.id });
    }
    assertExpectedVersion(repository, command, "schedule", schedule.id, existing);
  }
  return { ...schedule, owner_type: "task", owner_id: taskId };
}

function referencesForTask(repository: Repository, command: CommandEnvelope, taskId: string): SaveOperation[] {
  const references = (command.payload as { references?: Entity[] }).references || [];
  return references.map((reference) => {
    referenceDefinition.parseCreate(reference);
    if (!referenceTargetEntityTypes.includes(reference.source_type as never)
      || !referenceTargetEntityTypes.includes(reference.target_type as never)
      || !referenceRelationTypes.includes(reference.relation_type as never)) {
      throw new ApplicationCommandError("INVALID_PAYLOAD", "Referenceのsource/target typeまたはrelationが不正です。", { id: reference.id });
    }
    if (reference.source_id !== taskId && reference.target_id !== taskId) {
      throw new ApplicationCommandError("INVALID_PAYLOAD", "Task Commandのreferenceは対象Taskを参照する必要があります。", { id: reference.id });
    }
    if (repository.get("reference", reference.id, true)) {
      throw new ApplicationCommandError("CONFLICT", "既存Reference IDをCommandで再利用できません。", { id: reference.id });
    }
    for (const [side, type, id] of [
      ["source", reference.source_type, reference.source_id],
      ["target", reference.target_type, reference.target_id],
    ] as const) {
      const referenceType = type as EntityType;
      const referenceId = String(id);
      if (referenceType === "task" && referenceId === taskId) continue;
      const active = repository.get(referenceType, referenceId);
      if (!active) {
        const deleted = repository.get(referenceType, referenceId, true);
        throw new ApplicationCommandError("NOT_FOUND", deleted
          ? `Referenceの${side} entityが削除済みです。`
          : `Referenceの${side} entityが存在しません。`, { type: referenceType, id: referenceId, side });
      }
    }
    return { action: "save", type: "reference", entity: reference };
  });
}

function normalizeCanonicalEntity(type: EntityType, entity: Entity, fallbackThemeId?: string): Entity {
  if (type !== "task") return entity;
  const next: Entity = {
    ...entity,
    project_id: canonicalThemeId(entity.project_id ?? entity.theme_id ?? fallbackThemeId, { defaultPersonal: true }),
  };
  delete next.theme_id;
  return next;
}

function normalizeCanonicalNote(entity: Entity, fallbackThemeId?: string): Entity {
  const next: Entity = {
    ...entity,
    project_id: entity.project_id ?? entity.theme_id ?? fallbackThemeId ?? null,
  };
  delete next.theme_id;
  return next;
}

export class ApplicationCommandService {
  constructor(private readonly repository: Repository) {}

  execute(input: unknown): CommandReceipt {
    const command = parseCommandEnvelope(input);
    if (!applicationCommandSources.includes(command.source)) throw new ApplicationCommandError("INVALID_ENVELOPE", "Command sourceが不正です。");
    return this.repository.runTransaction((transactionRepository) => (
      new ApplicationCommandService(transactionRepository).executeParsed(command)
    ));
  }

  executeBatch(inputs: unknown[]): CommandReceipt[] {
    const commands = inputs.map((input) => parseCommandEnvelope(input));
    for (const command of commands) {
      if (!applicationCommandSources.includes(command.source)) throw new ApplicationCommandError("INVALID_ENVELOPE", "Command sourceが不正です。");
    }
    return this.repository.runTransaction((transactionRepository) => {
      const service = new ApplicationCommandService(transactionRepository);
      return commands.map((command) => service.executeParsed(command));
    });
  }

  private executeParsed(command: CommandEnvelope): CommandReceipt {
    const previous = readIdempotent(this.repository, command);
    if (previous) return previous;

    if (command.name === "CreateTaskFromCapture") {
      return this.createTaskFromCapture(command);
    }
    if (command.name === "CompleteTaskWithLearning") {
      return this.completeTaskWithLearning(command);
    }
    if (command.name === "EndFocusSession") {
      return this.endFocusSession(command);
    }
    if (command.name === "ApplyAiProposal") {
      return this.applyAiProposal(command);
    }
    if (command.name === "StartTaskWork") return this.startTaskWork(command);
    if (command.name === "AppendWorkReceipt") return this.appendWorkReceipt(command);
    if (command.name === "AcceptTaskWork") return this.acceptTaskWork(command);
    if (command.name === "ReturnTaskWork") return this.returnTaskWork(command);
    if (command.name === "DeleteTask") {
      return this.deleteTask(command);
    }
    if (command.name === "CreateTask" || command.name === "UpdateTask") {
      return this.saveTask(command, command.name === "CreateTask");
    }
    return this.transitionTask(command, command.name === "CompleteTask");
  }

  private startTaskWork(command: CommandEnvelope): CommandReceipt {
    const payload = command.payload as { taskId: string; executorKind?: string; executorIdentity?: string | null; startedAt?: string | null };
    const taskId = asTaskId(payload);
    const current = this.repository.get("task", taskId);
    if (!current) throw new ApplicationCommandError("NOT_FOUND", "作業開始対象のTaskがありません。", { id: taskId });
    if (!expectedVersionFor(command, "task", taskId)) throw new ApplicationCommandError("CONFLICT", "StartTaskWorkにはexpected versionが必要です。", { type: "task", id: taskId });
    assertExpectedVersion(this.repository, command, "task", taskId, current);
    if (current.state === "done" || current.state === "cancelled") throw new ApplicationCommandError("INVALID_TRANSITION", "完了済みまたは中止済みTaskは作業開始できません。", { id: taskId });
    const state = currentWorkState(current);
    if (["reported_done", "needs_human_review", "accepted"].includes(state)) throw new ApplicationCommandError("INVALID_TRANSITION", "報告済みのTaskはAcceptまたは差戻しを先に行ってください。", { id: taskId, work_state: state });
    if (payload.executorKind != null && !taskExecutorKinds.has(payload.executorKind)) throw new ApplicationCommandError("INVALID_PAYLOAD", "executorKindが不正です。");
    if (payload.executorIdentity != null && payload.executorIdentity.length > 200) throw new ApplicationCommandError("INVALID_PAYLOAD", "executorIdentityは200文字以内で入力してください。");
    if (state === "in_progress") return persistNoChange(this.repository, command, taskId, current);
    const task: Entity = {
      ...current,
      work_state: "in_progress",
      work_started_at: payload.startedAt || current.work_started_at || now(),
      work_reported_at: null,
      work_review_note: null,
      ...(payload.executorIdentity !== undefined ? { executor_identity: payload.executorIdentity || null } : {}),
    };
    taskDefinition.parseUpdate(task);
    assertThemeExists(this.repository, task);
    const event = annotateEvent(command, commandEvent(command, "task", taskId, "updated", current, task, "task_work_recorded"));
    event.metadata = { ...(event.metadata as Record<string, unknown> || {}), include_in_activity: true, work_action: "started" };
    const operations: SaveOperation[] = [
      { action: "save", type: "task", entity: task },
      { action: "save", type: "change_event", entity: event },
    ];
    return persistReceipt(this.repository, command, operations, [event.id], ["task"]);
  }

  private appendWorkReceipt(command: CommandEnvelope): CommandReceipt {
    const payload = command.payload as { taskId: string; receipt: Entity };
    const taskId = asTaskId(payload);
    const current = this.repository.get("task", taskId);
    if (!current) throw new ApplicationCommandError("NOT_FOUND", "報告対象のTaskがありません。", { id: taskId });
    if (!expectedVersionFor(command, "task", taskId)) throw new ApplicationCommandError("CONFLICT", "AppendWorkReceiptにはexpected versionが必要です。", { type: "task", id: taskId });
    assertExpectedVersion(this.repository, command, "task", taskId, current);
    if (current.state === "done" || current.state === "cancelled") throw new ApplicationCommandError("INVALID_TRANSITION", "完了済みまたは中止済みTaskへWork Receiptを追加できません。", { id: taskId });
    if (currentWorkState(current) !== "in_progress") throw new ApplicationCommandError("INVALID_TRANSITION", "作業中のTaskだけにWork Receiptを追加できます。", { id: taskId, work_state: currentWorkState(current) });
    if (payload.receipt.task_id !== taskId) throw new ApplicationCommandError("INVALID_PAYLOAD", "Work Receiptのtask_idが対象Taskと一致しません。", { id: payload.receipt.id });
    if (this.repository.get("work_receipt", payload.receipt.id, true)) throw new ApplicationCommandError("CONFLICT", "Work ReceiptのIDを再利用できません。", { id: payload.receipt.id });
    const provenance = workReceiptProvenance(this.repository, command, taskId, payload.receipt);
    const receipt: Entity = {
      id: payload.receipt.id,
      task_id: taskId,
      executor_kind: payload.receipt.executor_kind,
      executor_label: payload.receipt.executor_label,
      started_at: payload.receipt.started_at || current.work_started_at || null,
      reported_at: payload.receipt.reported_at,
      summary: payload.receipt.summary,
      completed_items: Array.isArray(payload.receipt.completed_items) ? payload.receipt.completed_items : [],
      changed_or_created_items: Array.isArray(payload.receipt.changed_or_created_items) ? payload.receipt.changed_or_created_items : [],
      ...(Array.isArray(payload.receipt.verification) ? { verification: payload.receipt.verification } : {}),
      ...(Array.isArray(payload.receipt.remaining_work) ? { remaining_work: payload.receipt.remaining_work } : {}),
      ...(Array.isArray(payload.receipt.external_references) ? { external_references: payload.receipt.external_references } : {}),
      ...(payload.receipt.repository_context && typeof payload.receipt.repository_context === "object" ? { repository_context: payload.receipt.repository_context } : {}),
      ...(provenance.sourceSession ? { source_session: provenance.sourceSession } : {}),
      ...(payload.receipt.runtime_metadata && typeof payload.receipt.runtime_metadata === "object" ? { runtime_metadata: payload.receipt.runtime_metadata } : {}),
      provenance: provenance.metadata,
      source: provenance.source,
    };
    workReceiptDefinition.parseCreate(receipt);
    const nextTask: Entity = { ...current, work_state: "needs_human_review", work_reported_at: receipt.reported_at, work_review_note: null };
    taskDefinition.parseUpdate(nextTask);
    assertThemeExists(this.repository, nextTask);
    const eventKind = provenance.source === "ai" ? "task_ai_reported" : "task_work_recorded";
    const event = annotateEvent(command, commandEvent(command, "task", taskId, "updated", current, nextTask, eventKind, { type: "work_receipt", id: receipt.id }, provenance.source));
    event.metadata = {
      ...(event.metadata as Record<string, unknown> || {}),
      include_in_activity: true,
      work_action: "reported",
      executor_kind: receipt.executor_kind,
      executor_label: workExecutorLabel(nextTask, receipt),
      provenance: provenance.metadata,
    };
    const operations: SaveOperation[] = [
      { action: "save", type: "task", entity: nextTask },
      { action: "save", type: "work_receipt", entity: receipt },
      { action: "save", type: "change_event", entity: event },
    ];
    return persistReceipt(this.repository, command, operations, [event.id], ["task", "work_receipt"]);
  }

  private acceptTaskWork(command: CommandEnvelope): CommandReceipt {
    assertHumanReviewActor(command, "AcceptTaskWork");
    const taskId = asTaskId(command.payload);
    const current = this.repository.get("task", taskId);
    if (!current) throw new ApplicationCommandError("NOT_FOUND", "確認対象のTaskがありません。", { id: taskId });
    if (!expectedVersionFor(command, "task", taskId)) throw new ApplicationCommandError("CONFLICT", "AcceptTaskWorkにはexpected versionが必要です。", { type: "task", id: taskId });
    assertExpectedVersion(this.repository, command, "task", taskId, current);
    if (currentWorkState(current) === "accepted") return persistNoChange(this.repository, command, taskId, current);
    if (!["reported_done", "needs_human_review"].includes(currentWorkState(current))) throw new ApplicationCommandError("INVALID_TRANSITION", "確認待ちのTaskだけをAcceptできます。", { id: taskId, work_state: currentWorkState(current) });
    const receipt = latestWorkReceipt(this.repository, taskId);
    if (!receipt) throw new ApplicationCommandError("NOT_FOUND", "確認対象のWork Receiptがありません。", { id: taskId });
    const nextTask: Entity = { ...current, work_state: "accepted", work_review_note: null };
    taskDefinition.parseUpdate(nextTask);
    assertThemeExists(this.repository, nextTask);
    const eventKind = current.intended_executor === "ai_agent" || receipt.executor_kind === "ai_agent" ? "task_ai_accepted" : "task_work_recorded";
    const event = annotateEvent(command, commandEvent(command, "task", taskId, "updated", current, nextTask, eventKind, { type: "work_receipt", id: receipt.id }));
    event.metadata = { ...(event.metadata as Record<string, unknown> || {}), include_in_activity: true, work_action: "accepted", executor_label: workExecutorLabel(nextTask, receipt) };
    return persistReceipt(this.repository, command, [
      { action: "save", type: "task", entity: nextTask },
      { action: "save", type: "change_event", entity: event },
    ], [event.id], ["task"]);
  }

  private returnTaskWork(command: CommandEnvelope): CommandReceipt {
    assertHumanReviewActor(command, "ReturnTaskWork");
    const payload = command.payload as { taskId: string; reviewNote?: string | null };
    const taskId = asTaskId(payload);
    const current = this.repository.get("task", taskId);
    if (!current) throw new ApplicationCommandError("NOT_FOUND", "差戻し対象のTaskがありません。", { id: taskId });
    if (!expectedVersionFor(command, "task", taskId)) throw new ApplicationCommandError("CONFLICT", "ReturnTaskWorkにはexpected versionが必要です。", { type: "task", id: taskId });
    assertExpectedVersion(this.repository, command, "task", taskId, current);
    if (!["reported_done", "needs_human_review"].includes(currentWorkState(current))) throw new ApplicationCommandError("INVALID_TRANSITION", "確認待ちのTaskだけを差し戻せます。", { id: taskId, work_state: currentWorkState(current) });
    const reviewNote = typeof payload.reviewNote === "string" ? payload.reviewNote.trim() : "";
    if (!reviewNote || reviewNote.length > 2000) throw new ApplicationCommandError("INVALID_PAYLOAD", "差戻し理由を1〜2000文字で入力してください。");
    const receipt = latestWorkReceipt(this.repository, taskId);
    if (!receipt) throw new ApplicationCommandError("NOT_FOUND", "差戻し対象のWork Receiptがありません。", { id: taskId });
    const nextTask: Entity = {
      ...current,
      work_state: current.intended_executor === "ai_agent" ? "ready_for_agent" : "not_delegated",
      work_started_at: null,
      work_reported_at: null,
      work_review_note: reviewNote,
    };
    taskDefinition.parseUpdate(nextTask);
    assertThemeExists(this.repository, nextTask);
    const eventKind = current.intended_executor === "ai_agent" || receipt.executor_kind === "ai_agent" ? "task_ai_returned" : "task_work_recorded";
    const event = annotateEvent(command, commandEvent(command, "task", taskId, "updated", current, nextTask, eventKind, { type: "work_receipt", id: receipt.id }));
    event.metadata = { ...(event.metadata as Record<string, unknown> || {}), include_in_activity: true, work_action: "returned", review_note: reviewNote, executor_label: workExecutorLabel(nextTask, receipt) };
    return persistReceipt(this.repository, command, [
      { action: "save", type: "task", entity: nextTask },
      { action: "save", type: "change_event", entity: event },
    ], [event.id], ["task"]);
  }

  private deleteTask(command: CommandEnvelope): CommandReceipt {
    const taskId = asTaskId(command.payload);
    const current = this.repository.get("task", taskId);
    if (!current) throw new ApplicationCommandError("NOT_FOUND", "削除対象のTaskがありません。", { id: taskId });
    if (!expectedVersionFor(command, "task", taskId)) {
      throw new ApplicationCommandError("CONFLICT", "DeleteTaskにはexpected versionが必要です。", { type: "task", id: taskId });
    }
    assertExpectedVersion(this.repository, command, "task", taskId, current);
    const deleted = this.repository.remove("task", taskId);
    if (!deleted) throw new ApplicationCommandError("NOT_FOUND", "削除対象のTaskがありません。", { id: taskId });
    const receipt = receiptFor(command, "applied");
    return {
      ...receipt,
      deleted: [{ type: "task", id: taskId }],
      changes: [{ type: "task", entity: deleted }],
    };
  }

  private completeTaskWithLearning(command: CommandEnvelope): CommandReceipt {
    const payload = command.payload as {
      task: Entity;
      note: Entity;
      nextTask?: Entity | null;
      nextSchedule?: Entity | null;
    };
    const inputTask = asTask({ task: payload.task });
    const current = this.repository.get("task", inputTask.id);
    if (!current) throw new ApplicationCommandError("NOT_FOUND", "完了対象のTaskがありません。", { id: inputTask.id });
    if (!expectedVersionFor(command, "task", inputTask.id)) {
      throw new ApplicationCommandError("CONFLICT", "CompleteTaskWithLearningにはexpected versionが必要です。", { type: "task", id: inputTask.id });
    }
    assertExpectedVersion(this.repository, command, "task", inputTask.id, current);
    if (current.state === "cancelled" || current.state === "done") {
      throw new ApplicationCommandError("INVALID_TRANSITION", "キャンセル済みまたは完了済みTaskは学び付き完了できません。", { id: inputTask.id });
    }
    assertHumanAcceptBeforeCompletion(current);
    const completedAt = typeof inputTask.completed_at === "string" && inputTask.completed_at.trim()
      ? inputTask.completed_at : command.issuedAt;
    const completedTask = normalizeCanonicalEntity("task", {
      ...current,
      ...inputTask,
      id: inputTask.id,
      state: "done",
      completed_at: completedAt,
    });
    taskDefinition.parseUpdate(completedTask);
    assertThemeExists(this.repository, completedTask);

    const note = normalizeCanonicalNote({
      ...payload.note,
      project_id: payload.note.project_id ?? completedTask.project_id,
      item_id: inputTask.id,
      note_type: payload.note.note_type || "learning",
    }, completedTask.project_id as string);
    if (this.repository.get("note", note.id, true)) {
      throw new ApplicationCommandError("CONFLICT", "学びNoteのIDを再利用できません。", { id: note.id });
    }
    entityDefinition("note").parseCreate(note);

    const operations: SaveOperation[] = [{ action: "save", type: "task", entity: completedTask }];
    const eventIds: string[] = [];
    const taskEvent = annotateEvent(command, commandEvent(command, "task", completedTask.id, "completed", current, completedTask));
    operations.push({ action: "save", type: "change_event", entity: taskEvent });
    eventIds.push(taskEvent.id);
    operations.push({ action: "save", type: "note", entity: note });
    const noteEvent = annotateEvent(command, commandEvent(command, "note", note.id, "created", null, note));
    operations.push({ action: "save", type: "change_event", entity: noteEvent });
    eventIds.push(noteEvent.id);

    if (payload.nextTask) {
      const nextTask = normalizeCanonicalEntity("task", payload.nextTask, completedTask.project_id as string);
      if (this.repository.get("task", nextTask.id, true)) {
        throw new ApplicationCommandError("CONFLICT", "繰返しTaskのIDを再利用できません。", { id: nextTask.id });
      }
      if (nextTask.parent_task_id !== completedTask.id && nextTask.repeat_parent_task_id !== completedTask.id) {
        throw new ApplicationCommandError("INVALID_PAYLOAD", "繰返しTaskは完了したTaskを親にする必要があります。", { id: nextTask.id });
      }
      taskDefinition.parseCreate(nextTask);
      assertThemeExists(this.repository, nextTask);
      operations.push({ action: "save", type: "task", entity: nextTask });
      const nextEvent = annotateEvent(command, commandEvent(command, "task", nextTask.id, "created", null, nextTask));
      operations.push({ action: "save", type: "change_event", entity: nextEvent });
      eventIds.push(nextEvent.id);
      if (payload.nextSchedule) {
        const nextSchedule = validateScheduleWrite(this.repository, command, payload.nextSchedule, nextTask.id, true);
        if (!nextSchedule) throw new ApplicationCommandError("INVALID_PAYLOAD", "繰返しTaskのScheduleが不正です。");
        operations.push({ action: "save", type: "schedule", entity: nextSchedule });
        const scheduleEvent = annotateEvent(command, commandEvent(command, "schedule", nextTask.id, "rescheduled", null, nextSchedule));
        operations.push({ action: "save", type: "change_event", entity: scheduleEvent });
        eventIds.push(scheduleEvent.id);
      }
    } else if (payload.nextSchedule) {
      throw new ApplicationCommandError("INVALID_PAYLOAD", "nextScheduleにはnextTaskが必要です。");
    }
    return persistReceipt(this.repository, command, operations, eventIds, ["task", "note", "schedule"]);
  }

  private endFocusSession(command: CommandEnvelope): CommandReceipt {
    const payload = command.payload as {
      session: Entity;
      task?: Entity | null;
      selectedNote?: Entity | null;
      promotedNote?: Entity | null;
      promotedReference?: Entity | null;
      nextTask?: Entity | null;
      statusUpdate?: Entity | null;
      completeTask: boolean;
    };
    const currentSession = this.repository.get("note", payload.session.id);
    if (!currentSession) throw new ApplicationCommandError("NOT_FOUND", "Focus Sessionがありません。", { id: payload.session.id });
    if (!expectedVersionFor(command, "note", payload.session.id)) {
      throw new ApplicationCommandError("CONFLICT", "EndFocusSessionにはSessionのexpected versionが必要です。", { type: "note", id: payload.session.id });
    }
    assertExpectedVersion(this.repository, command, "note", payload.session.id, currentSession);
    const sessionProps = payload.session.properties_json && typeof payload.session.properties_json === "object"
      ? payload.session.properties_json as Record<string, unknown> : {};
    const taskId = typeof payload.task?.id === "string"
      ? payload.task.id
      : typeof sessionProps.task_id === "string" ? sessionProps.task_id : "";
    if (!taskId) throw new ApplicationCommandError("INVALID_PAYLOAD", "Focus SessionのTask IDがありません。");
    const currentTask = this.repository.get("task", taskId);
    if (!currentTask) throw new ApplicationCommandError("NOT_FOUND", "Focus SessionのTaskがありません。", { id: taskId });

    const nextSessionProps = payload.session.properties_json && typeof payload.session.properties_json === "object"
      ? payload.session.properties_json as Record<string, unknown> : {};
    if (nextSessionProps.session_state !== "ended") {
      throw new ApplicationCommandError("INVALID_TRANSITION", "Focus Sessionはended状態へ遷移する必要があります。");
    }
    const endedAt = typeof nextSessionProps.ended_at === "string" && nextSessionProps.ended_at.trim()
      ? nextSessionProps.ended_at : command.issuedAt;
    const session: Entity = normalizeCanonicalNote({
      ...payload.session,
      properties_json: { ...nextSessionProps, ended_at: endedAt },
    }, currentTask.project_id as string);
    entityDefinition("note").parseUpdate(session);
    const operations: SaveOperation[] = [{ action: "save", type: "note", entity: session }];
    const eventIds: string[] = [];
    const sessionEvent = annotateEvent(command, commandEvent(command, "note", session.id, "updated", currentSession, session));
    operations.push({ action: "save", type: "change_event", entity: sessionEvent });
    eventIds.push(sessionEvent.id);

    if (payload.selectedNote) {
      const currentNote = this.repository.get("note", payload.selectedNote.id);
      if (!currentNote) throw new ApplicationCommandError("NOT_FOUND", "Focus Sessionの選択Noteがありません。", { id: payload.selectedNote.id });
      assertExpectedVersion(this.repository, command, "note", currentNote.id, currentNote);
      const selectedNote = normalizeCanonicalNote(payload.selectedNote, currentTask.project_id as string);
      entityDefinition("note").parseUpdate(selectedNote);
      operations.push({ action: "save", type: "note", entity: selectedNote });
      const selectedEvent = annotateEvent(command, commandEvent(command, "note", selectedNote.id, "updated", currentNote, selectedNote));
      operations.push({ action: "save", type: "change_event", entity: selectedEvent });
      eventIds.push(selectedEvent.id);
    }

    if (payload.completeTask) {
      if (!expectedVersionFor(command, "task", taskId)) {
        throw new ApplicationCommandError("CONFLICT", "完了するTaskにはexpected versionが必要です。", { type: "task", id: taskId });
      }
      assertExpectedVersion(this.repository, command, "task", taskId, currentTask);
      if (currentTask.state === "cancelled" || currentTask.state === "done") {
        throw new ApplicationCommandError("INVALID_TRANSITION", "キャンセル済みまたは完了済みTaskはFocus終了で完了できません。", { id: taskId });
      }
      assertHumanAcceptBeforeCompletion(currentTask);
      const task = normalizeCanonicalEntity("task", {
        ...currentTask,
        ...(payload.task || {}),
        id: taskId,
        state: "done",
        completed_at: endedAt,
      });
      taskDefinition.parseUpdate(task);
      assertThemeExists(this.repository, task);
      operations.push({ action: "save", type: "task", entity: task });
      const taskEvent = annotateEvent(command, commandEvent(command, "task", taskId, "completed", currentTask, task));
      operations.push({ action: "save", type: "change_event", entity: taskEvent });
      eventIds.push(taskEvent.id);
    }

    if (payload.promotedNote) {
      const promotedNote = normalizeCanonicalNote(payload.promotedNote, currentTask.project_id as string);
      if (this.repository.get("note", promotedNote.id, true)) throw new ApplicationCommandError("CONFLICT", "Promoted NoteのIDを再利用できません。", { id: promotedNote.id });
      entityDefinition("note").parseCreate(promotedNote);
      operations.push({ action: "save", type: "note", entity: promotedNote });
      const promotedEvent = annotateEvent(command, commandEvent(command, "note", promotedNote.id, "created", null, promotedNote));
      operations.push({ action: "save", type: "change_event", entity: promotedEvent });
      eventIds.push(promotedEvent.id);
    }
    if (payload.promotedReference) {
      const reference = payload.promotedReference;
      referenceDefinition.parseCreate(reference);
      if (reference.source_type !== "note" || reference.target_type !== "task" || reference.target_id !== taskId
        || !payload.promotedNote || reference.source_id !== payload.promotedNote.id || reference.relation_type !== "related_to") {
        throw new ApplicationCommandError("INVALID_PAYLOAD", "Focus SessionのPromoted ReferenceがNote↔Task契約に一致しません。", { id: reference.id });
      }
      if (this.repository.get("reference", reference.id, true)) throw new ApplicationCommandError("CONFLICT", "Promoted ReferenceのIDを再利用できません。", { id: reference.id });
      operations.push({ action: "save", type: "reference", entity: reference });
      const referenceEvent = annotateEvent(command, commandEvent(command, "reference", reference.id, "created", null, reference));
      operations.push({ action: "save", type: "change_event", entity: referenceEvent });
      eventIds.push(referenceEvent.id);
    }
    if (payload.nextTask) {
      const nextTask = normalizeCanonicalEntity("task", payload.nextTask, currentTask.project_id as string);
      if (this.repository.get("task", nextTask.id, true)) throw new ApplicationCommandError("CONFLICT", "Focus Sessionの次Task IDを再利用できません。", { id: nextTask.id });
      if (nextTask.parent_task_id !== taskId) throw new ApplicationCommandError("INVALID_PAYLOAD", "Focus Sessionの次Taskは現在Taskを親にする必要があります。", { id: nextTask.id });
      taskDefinition.parseCreate(nextTask);
      assertThemeExists(this.repository, nextTask);
      operations.push({ action: "save", type: "task", entity: nextTask });
      const nextEvent = annotateEvent(command, commandEvent(command, "task", nextTask.id, "created", null, nextTask));
      operations.push({ action: "save", type: "change_event", entity: nextEvent });
      eventIds.push(nextEvent.id);
    }
    if (payload.statusUpdate) {
      const statusUpdate = payload.statusUpdate;
      if (this.repository.get("status_update", statusUpdate.id, true)) throw new ApplicationCommandError("CONFLICT", "Status UpdateのIDを再利用できません。", { id: statusUpdate.id });
      entityDefinition("status_update").parseCreate(statusUpdate);
      const themeId = statusUpdate.theme_id;
      if (typeof themeId !== "string" || !this.repository.get("theme", themeId)) throw new ApplicationCommandError("INVALID_PAYLOAD", "Status UpdateのThemeが存在しません。", { themeId });
      operations.push({ action: "save", type: "status_update", entity: statusUpdate });
      const statusEvent = annotateEvent(command, commandEvent(command, "status_update", statusUpdate.id, "created", null, statusUpdate));
      operations.push({ action: "save", type: "change_event", entity: statusEvent });
      eventIds.push(statusEvent.id);
    }
    return persistReceipt(this.repository, command, operations, eventIds, ["note", "task", "reference", "status_update"]);
  }

  private applyAiProposal(command: CommandEnvelope): CommandReceipt {
    const payload = command.payload as { proposal: Entity; candidates: Array<{ type: EntityType; entity: Entity }> };
    const currentProposal = this.repository.get("ai_proposal", payload.proposal.id);
    if (!currentProposal) throw new ApplicationCommandError("NOT_FOUND", "AI Proposalがありません。", { id: payload.proposal.id });
    if (!expectedVersionFor(command, "ai_proposal", currentProposal.id)) {
      throw new ApplicationCommandError("CONFLICT", "ApplyAiProposalにはProposalのexpected versionが必要です。", { type: "ai_proposal", id: currentProposal.id });
    }
    assertExpectedVersion(this.repository, command, "ai_proposal", currentProposal.id, currentProposal);
    if (currentProposal.status !== "pending") throw new ApplicationCommandError("INVALID_TRANSITION", "Pending以外のProposalは採用できません。", { id: currentProposal.id });
    const proposal = payload.proposal;
    if (!["accepted", "partially_accepted", "rejected"].includes(String(proposal.status))) {
      throw new ApplicationCommandError("INVALID_PAYLOAD", "Proposalの採用状態が不正です。");
    }
    entityDefinition("ai_proposal").parseUpdate(proposal);
    const operations: SaveOperation[] = [];
    const eventIds: string[] = [];
    const seen = new Set<string>();
    for (const candidate of payload.candidates) {
      const type = candidate.type;
      if (type === "schedule") {
        const schedule = candidate.entity;
        if (schedule.owner_type !== "task" && schedule.owner_type !== "waiting" && schedule.owner_type !== "plan_node") {
          throw new ApplicationCommandError("INVALID_PAYLOAD", "AI ProposalのSchedule ownerが不正です。", { id: schedule.id });
        }
      }
      const key = `${type}:${candidate.entity.id}`;
      if (seen.has(key)) throw new ApplicationCommandError("INVALID_PAYLOAD", "AI Proposal candidateが重複しています。", { key });
      seen.add(key);
      const before = this.repository.get(type, candidate.entity.id, true);
      if (before?.deleted_at) throw new ApplicationCommandError("CONFLICT", "削除済みEntityをAI Proposalから更新できません。", { type, id: candidate.entity.id });
      if (before) {
        if (!expectedVersionFor(command, type, candidate.entity.id)) throw new ApplicationCommandError("CONFLICT", "既存candidateにはexpected versionが必要です。", { type, id: candidate.entity.id });
        assertExpectedVersion(this.repository, command, type, candidate.entity.id, before);
      }
      if (type === "schedule") {
        const ownerType = String(candidate.entity.owner_type) as EntityType;
        const ownerId = String(candidate.entity.owner_id || "");
        const ownerCandidate = payload.candidates.find((entry) => entry.type === ownerType && entry.entity.id === ownerId);
        const owner = ownerCandidate?.entity || this.repository.get(ownerType, ownerId);
        if (!owner || owner.deleted_at) {
          throw new ApplicationCommandError("NOT_FOUND", "AI ProposalのSchedule ownerが存在しません。", { type: ownerType, id: ownerId });
        }
      }
      if (type === "knowledge_edge") {
        const sourceId = String(candidate.entity.source_node_id || "");
        const targetId = String(candidate.entity.target_node_id || "");
        const source = payload.candidates.find((entry) => entry.type === "knowledge_node" && entry.entity.id === sourceId)?.entity || this.repository.get("knowledge_node", sourceId);
        const target = payload.candidates.find((entry) => entry.type === "knowledge_node" && entry.entity.id === targetId)?.entity || this.repository.get("knowledge_node", targetId);
        if (!source || source.deleted_at || !target || target.deleted_at || sourceId === targetId) {
          throw new ApplicationCommandError("INVALID_PAYLOAD", "AI ProposalのKnowledge Edge両端が存在しないか不正です。", { id: candidate.entity.id });
        }
        if (!["supports", "contradicts", "explains", "causes", "example_of", "generalizes", "depends_on", "derived_from", "answers", "raises", "similar_to", "leads_to"].includes(String(candidate.entity.relation_type))) {
          throw new ApplicationCommandError("INVALID_PAYLOAD", "AI ProposalのKnowledge Edge relationが不正です.", { id: candidate.entity.id });
        }
      }
      if (type === "task") {
        const task = normalizeTaskAssignment(normalizeCanonicalEntity(type, candidate.entity), before || undefined);
        if (task.work_state === "accepted" && (!before || currentWorkState(before) !== "accepted")) {
          throw new ApplicationCommandError("INVALID_TRANSITION", "Work stateの受入れはAcceptTaskWorkを使用してください。", { id: task.id });
        }
        if (before && before.intended_executor === task.intended_executor
          && Object.prototype.hasOwnProperty.call(candidate.entity, "work_state")
          && currentWorkState(before) !== currentWorkState(task)) {
          throw new ApplicationCommandError("INVALID_TRANSITION", "Work stateの変更はStart/Report/Accept/Return Commandを使用してください。", { id: task.id });
        }
        if (task.state === "done") assertHumanAcceptBeforeCompletion(task);
        taskDefinition[before ? "parseUpdate" : "parseCreate"](task);
        assertThemeExists(this.repository, task);
        operations.push({ action: "save", type, entity: task });
        const event = annotateEvent(command, commandEvent(command, type, task.id, changeType(before, task, command.name), before, task));
        operations.push({ action: "save", type: "change_event", entity: event });
        eventIds.push(event.id);
      } else {
        const entity = candidate.entity;
        if (before) entityDefinition(type).parseUpdate(entity);
        else entityDefinition(type).parseCreate(entity);
        operations.push({ action: "save", type, entity });
        const event = annotateEvent(command, commandEvent(command, type, entity.id, before ? "updated" : "created", before, entity));
        operations.push({ action: "save", type: "change_event", entity: event });
        eventIds.push(event.id);
      }
    }
    operations.push({ action: "save", type: "ai_proposal", entity: proposal });
    const proposalEvent = annotateEvent(command, commandEvent(command, "ai_proposal", proposal.id, "updated", currentProposal, proposal));
    operations.push({ action: "save", type: "change_event", entity: proposalEvent });
    eventIds.push(proposalEvent.id);
    return persistReceipt(this.repository, command, operations, eventIds, [...new Set([...payload.candidates.map((candidate) => candidate.type), "ai_proposal"])] as EntityType[]);
  }

  private saveTask(command: CommandEnvelope, isCreate: boolean): CommandReceipt {
    const inputTask = asTask(command.payload);
    const taskId = inputTask.id;
    const current = this.repository.get("task", taskId, true);
    if (isCreate && current) {
      throw new ApplicationCommandError("CONFLICT", "同じTask IDが既に存在します。", { type: "task", id: taskId });
    }
    if (!isCreate && !current) throw new ApplicationCommandError("NOT_FOUND", "更新対象のTaskがありません。", { id: taskId });
    assertExpectedVersion(this.repository, command, "task", taskId, current);

    const task: Entity = normalizeTaskAssignment({
      ...inputTask,
      project_id: canonicalThemeId(inputTask.project_id, { defaultPersonal: true }),
    }, current || undefined);
    if (task.state === "done") assertHumanAcceptBeforeCompletion(task);
    if (!isCreate && !expectedVersionFor(command, "task", taskId)) {
      throw new ApplicationCommandError("CONFLICT", "UpdateTaskにはexpected versionが必要です。", { type: "task", id: taskId });
    }
    taskDefinition.parseUpdate(task);
    assertThemeExists(this.repository, task);
    if (!isCreate && current && current.state !== task.state && (current.state === "done" || task.state === "done")) {
      throw new ApplicationCommandError("INVALID_TRANSITION", "完了状態の変更はCompleteTask/ReopenTaskを使用してください。");
    }
    if (!isCreate && current && Object.prototype.hasOwnProperty.call(inputTask, "work_state") && currentWorkState(current) !== currentWorkState(task)) {
      const setupTransition = (currentWorkState(current) === "not_delegated" && currentWorkState(task) === "ready_for_agent")
        || (currentWorkState(current) === "ready_for_agent" && currentWorkState(task) === "not_delegated");
      if (!setupTransition) throw new ApplicationCommandError("INVALID_TRANSITION", "Work stateの変更はStart/Report/Accept/Return Commandを使用してください。", { id: taskId });
    }

    const schedule = validateScheduleWrite(this.repository, command, (command.payload as { schedule?: Entity | null }).schedule, taskId, isCreate);
    const operations: SaveOperation[] = [{ action: "save", type: "task", entity: task }];
    if (schedule) {
      operations.push({
        action: "save",
        type: "schedule",
        entity: schedule,
      });
    }
    const event = commandEvent(command, "task", taskId, changeType(current, task, command.name), current, task);
    event.command_source = command.source;
    event.actor_kind = command.actor.kind;
    event.actor_id = command.actor.id || null;
    event.command_fingerprint = commandFingerprint(command);
    operations.push({ action: "save", type: "change_event", entity: event });
    const previousSchedule = schedule ? this.repository.get("schedule", schedule.id, true) : null;
    const scheduleEvent = schedule
      ? commandEvent(command, "schedule", taskId, "rescheduled", previousSchedule, schedule)
      : null;
    if (scheduleEvent) {
      scheduleEvent.command_source = command.source;
      scheduleEvent.actor_kind = command.actor.kind;
      scheduleEvent.actor_id = command.actor.id || null;
      scheduleEvent.command_fingerprint = commandFingerprint(command);
    }
    if (scheduleEvent) operations.push({ action: "save", type: "change_event", entity: scheduleEvent });
    operations.push(...referencesForTask(this.repository, command, taskId));

    return persistReceipt(
      this.repository,
      command,
      operations,
      [event.id, ...(scheduleEvent ? [scheduleEvent.id] : [])],
      operations.map((operation) => operation.type).filter((type) => type !== "change_event"),
    );
  }

  private transitionTask(command: CommandEnvelope, completing: boolean): CommandReceipt {
    const taskId = asTaskId(command.payload);
    const current = this.repository.get("task", taskId);
    if (!current) throw new ApplicationCommandError("NOT_FOUND", "対象Taskがありません。", { id: taskId });
    if (!expectedVersionFor(command, "task", taskId)) {
      throw new ApplicationCommandError("CONFLICT", `${command.name}にはexpected versionが必要です。`, { type: "task", id: taskId });
    }
    assertExpectedVersion(this.repository, command, "task", taskId, current);
    if (current.state === "cancelled") {
      throw new ApplicationCommandError("INVALID_TRANSITION", "キャンセル済みTaskはこのCommandで変更できません。", { id: taskId });
    }
    if (completing) assertHumanAcceptBeforeCompletion(current);
    const requestedTask = (command.payload as { task?: Entity }).task;
    if (requestedTask) {
      asTask({ task: requestedTask });
      taskDefinition.parseUpdate(requestedTask);
    }
    const alreadyInTarget = completing ? current.state === "done" : current.state !== "done";
    if (alreadyInTarget) {
      if (requestedTask || (command.payload as { references?: Entity[] }).references?.length) {
        return this.saveTask(command, false);
      }
      return persistNoChange(this.repository, command, taskId, current);
    }
    const next: Entity = completing
      ? {
        ...current,
        ...(requestedTask || {}),
        id: taskId,
        project_id: canonicalThemeId(requestedTask?.project_id ?? current.project_id, { defaultPersonal: true }),
        state: "done",
        completed_at: now(),
        completion_note: (command.payload as { completionNote?: string | null }).completionNote ?? current.completion_note ?? null,
      }
      : {
        ...current,
        ...(requestedTask || {}),
        id: taskId,
        project_id: canonicalThemeId(requestedTask?.project_id ?? current.project_id, { defaultPersonal: true }),
        state: "todo",
        completed_at: null,
      };
    taskDefinition.parseUpdate(next);
    assertThemeExists(this.repository, next);
    const event = commandEvent(command, "task", taskId, completing ? "completed" : "updated", current, next);
    event.command_source = command.source;
    event.actor_kind = command.actor.kind;
    event.actor_id = command.actor.id || null;
    event.command_fingerprint = commandFingerprint(command);
    const normalizedSchedule = validateScheduleWrite(this.repository, command, (command.payload as { schedule?: Entity | null }).schedule, taskId, false);
    const scheduleEvent = normalizedSchedule
      ? commandEvent(command, "schedule", taskId, "rescheduled", this.repository.get("schedule", normalizedSchedule.id, true), normalizedSchedule)
      : null;
    if (scheduleEvent) {
      scheduleEvent.command_source = command.source;
      scheduleEvent.actor_kind = command.actor.kind;
      scheduleEvent.actor_id = command.actor.id || null;
      scheduleEvent.command_fingerprint = commandFingerprint(command);
    }
    const operations: SaveOperation[] = [
      { action: "save", type: "task", entity: next },
      ...(normalizedSchedule ? [{ action: "save" as const, type: "schedule" as const, entity: normalizedSchedule }] : []),
      { action: "save", type: "change_event", entity: event },
      ...(scheduleEvent ? [{ action: "save" as const, type: "change_event" as const, entity: scheduleEvent }] : []),
    ];
    operations.push(...referencesForTask(this.repository, command, taskId));
    return persistReceipt(
      this.repository,
      command,
      operations,
      [event.id, ...(scheduleEvent ? [scheduleEvent.id] : [])],
      operations.map((operation) => operation.type).filter((type) => type !== "change_event"),
    );
  }

  private createTaskFromCapture(command: CommandEnvelope): CommandReceipt {
    const payload = command.payload as {
      task: Entity;
      schedule?: Entity | null;
      captureId: string;
      captureVersion: number;
      transition: "triage_to_task";
      artifactIds?: string[];
      references?: Entity[];
    };
    if (command.source !== "inbox") {
      throw new ApplicationCommandError("INVALID_ENVELOPE", "CreateTaskFromCaptureはInbox経路専用です。");
    }
    const inputTask = asTask(payload);
    const currentTask = this.repository.get("task", inputTask.id, true);
    if (currentTask) {
      throw new ApplicationCommandError("CONFLICT", "同じTask IDが既に存在します。", { type: "task", id: inputTask.id });
    }
    const capture = this.repository.get("capture_entry", payload.captureId);
    if (!capture) throw new ApplicationCommandError("NOT_FOUND", "整理対象のCaptureがありません。", { id: payload.captureId });
    if (capture.state !== "untriaged") {
      throw new ApplicationCommandError("INVALID_TRANSITION", "このCaptureはすでに整理済みです。", { id: payload.captureId, state: capture.state });
    }
    if (Number(capture.version || 0) !== payload.captureVersion) {
      throw new ApplicationCommandError("CONFLICT", "Captureが更新済みです。Inboxを再読み込みしてから再試行してください。", {
        type: "capture_entry", id: payload.captureId, expected: payload.captureVersion, actual: Number(capture.version || 0),
      });
    }
    const expectedCapture = expectedVersionFor(command, "capture_entry", payload.captureId);
    if (!expectedCapture || expectedCapture.version !== payload.captureVersion) {
      throw new ApplicationCommandError("CONFLICT", "Captureのexpected versionが必要です。", { type: "capture_entry", id: payload.captureId });
    }

    const task: Entity = { ...inputTask, project_id: canonicalThemeId(inputTask.project_id, { defaultPersonal: true }) };
    if (task.state === "done") assertHumanAcceptBeforeCompletion(task);
    taskDefinition.parseCreate(task);
    assertThemeExists(this.repository, task);
    const schedule = validateScheduleWrite(this.repository, command, payload.schedule, task.id, true);
    const operations: SaveOperation[] = [{ action: "save", type: "task", entity: task }];
    const changed: EntityType[] = ["task"];
    const eventIds: string[] = [];
    if (schedule) {
      operations.push({ action: "save", type: "schedule", entity: schedule });
      changed.push("schedule");
    }
    const references = referencesForTask(this.repository, command, task.id);
    operations.push(...references);
    changed.push(...references.map(() => "reference" as const));

    const triagedCapture: Entity = {
      ...capture,
      state: "triaged",
      triaged_to_type: "task",
      triaged_to_id: task.id,
    };
    operations.push({ action: "save", type: "capture_entry", entity: triagedCapture });
    changed.push("capture_entry");

    const artifactIds = payload.artifactIds || [];
    const seenArtifactIds = new Set<string>();
    for (const artifactId of artifactIds) {
      if (seenArtifactIds.has(artifactId)) throw new ApplicationCommandError("INVALID_PAYLOAD", "artifactIdsに重複があります。", { artifactId });
      seenArtifactIds.add(artifactId);
      const artifact = this.repository.get("artifact", artifactId);
      if (!artifact) throw new ApplicationCommandError("NOT_FOUND", "Captureに紐づくArtifactがありません。", { id: artifactId });
      if (artifact.source_type !== "capture_entry" || artifact.source_id !== payload.captureId) {
        throw new ApplicationCommandError("CONFLICT", "Captureに紐づかないArtifactは移管できません。", { id: artifactId });
      }
      const expectedArtifact = expectedVersionFor(command, "artifact", artifactId);
      if (!expectedArtifact) throw new ApplicationCommandError("CONFLICT", "移管するArtifactにはexpected versionが必要です。", { type: "artifact", id: artifactId });
      assertExpectedVersion(this.repository, command, "artifact", artifactId, artifact);
      const artifactWithoutLegacyTheme = { ...artifact };
      delete artifactWithoutLegacyTheme.theme_id;
      operations.push({
        action: "save",
        type: "artifact",
        entity: { ...artifactWithoutLegacyTheme, source_type: "task", source_id: task.id, project_id: task.project_id },
      });
      changed.push("artifact");
    }

    const taskEvent = commandEvent(command, "task", task.id, "created", null, task);
    const captureEvent = commandEvent(command, "capture_entry", capture.id, "triaged", capture, triagedCapture);
    for (const event of [taskEvent, captureEvent]) {
      event.command_source = command.source;
      event.actor_kind = command.actor.kind;
      event.actor_id = command.actor.id || null;
      event.command_fingerprint = commandFingerprint(command);
      operations.push({ action: "save", type: "change_event", entity: event });
      eventIds.push(event.id);
    }
    if (schedule) {
      const scheduleEvent = commandEvent(command, "schedule", task.id, "rescheduled", null, schedule);
      scheduleEvent.command_source = command.source;
      scheduleEvent.actor_kind = command.actor.kind;
      scheduleEvent.actor_id = command.actor.id || null;
      scheduleEvent.command_fingerprint = commandFingerprint(command);
      operations.push({ action: "save", type: "change_event", entity: scheduleEvent });
      eventIds.push(scheduleEvent.id);
    }
    for (const artifactId of artifactIds) {
      const artifact = operations.find((operation) => operation.type === "artifact" && operation.entity.id === artifactId)?.entity;
      if (!artifact) continue;
      const before = this.repository.get("artifact", artifactId);
      const artifactEvent = commandEvent(command, "artifact", artifactId, "updated", before, artifact);
      artifactEvent.command_source = command.source;
      artifactEvent.actor_kind = command.actor.kind;
      artifactEvent.actor_id = command.actor.id || null;
      artifactEvent.command_fingerprint = commandFingerprint(command);
      operations.push({ action: "save", type: "change_event", entity: artifactEvent });
      eventIds.push(artifactEvent.id);
    }
    return persistReceipt(this.repository, command, operations, eventIds, changed);
  }
}
