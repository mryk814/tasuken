import { createHash, randomUUID } from "node:crypto";

import { canonicalThemeId } from "../../shared/themeRef.mjs";
import { rejectGenericAudioArtifact, rejectGenericVideoArtifact } from "../mediaCapturePersistence";
import {
  entityDefinition,
  referenceRelationTypes,
  referenceTargetEntityTypes,
} from "../../shared/entityRegistry.mjs";
import { normalizeAgentSession } from "../../shared/agentSession.mjs";
import { buildActivityEvent } from "../../shared/activityEvent.mjs";
import { normalizeExternalReferences } from "../../shared/externalReference.mjs";
import { normalizeRepositoryContext } from "../../shared/repositoryContext.mjs";
import {
  firstCaptureUrl,
  quickCaptureContentType,
  quickCaptureTitle,
} from "../../shared/quickCapture.mjs";
import { taskCreationProvenanceSchema } from "../../shared/contracts/task/public.ts";
import type {
  CanonicalNoteAiCompanion,
  Entity,
  EntityType,
  SaveOperation,
} from "../../shared/types/workspace";
import {
  ApplicationCommandError,
  parseCommandEnvelope,
  type ApplyAiProposalCommandPayload,
  type ApplicationCommandName,
  type CommandEnvelope,
  type CommandReceipt,
  type ExpectedVersion,
} from "../../shared/applicationCommand";
import { applicationCommandSources } from "../../shared/applicationCommand";
import {
  assertHumanAcceptBeforeTaskCompletion as assertHumanAcceptBeforeCompletion,
  assertTaskThemeExists as assertThemeExists,
  createTaskModule,
  currentTaskWorkState as currentWorkState,
  normalizeCanonicalTask,
  normalizeTaskForSave,
  taskChangeType as changeType,
  taskFromPayload as asTask,
  taskIdFromPayload as asTaskId,
  taskReferenceOperations as referencesForTask,
  validateTaskScheduleWrite,
  type TaskCommandRuntime,
} from "../modules/task/public.ts";

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
const captureDefinition = entityDefinition("capture_entry");
const artifactDefinition = entityDefinition("artifact");
const taskExecutorKinds = new Set(["self", "human", "ai_agent", "external", "unknown"]);
const aiAgentCommands = new Set<ApplicationCommandName>([
  "StartTaskWork",
  "AppendWorkReceipt",
  "ReportTaskDone",
  "ReportTaskBlocked",
  // These still fail in their own human-review guard, with the specific UI-only error.
  "AcceptTaskWork",
  "ReturnTaskWork",
]);

function workExecutorLabel(task: Entity, receipt?: Entity): string {
  return String(
    receipt?.executor_label ||
      task.executor_identity ||
      (task.intended_executor === "ai_agent" ? "AI agent" : "Task executor"),
  );
}

function mcpTaskWorkProposal(
  repository: Repository,
  taskId: string,
  sourceSession: string,
  actions = ["append_receipt", "report_done", "report_blocked"],
): Entity | null {
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
  return entries.some(
    (entry) =>
      entry &&
      typeof entry === "object" &&
      !Array.isArray(entry) &&
      (entry as { task_id?: unknown }).task_id === taskId &&
      actions.includes(String((entry as { action?: unknown }).action)),
  )
    ? proposal
    : null;
}

function mcpProposalAudit(proposal: Entity | null): Record<string, unknown> {
  if (!proposal) return {};
  const request =
    proposal.request && typeof proposal.request === "object" && !Array.isArray(proposal.request)
      ? (proposal.request as Record<string, unknown>)
      : {};
  return {
    reported_via: "mcp",
    proposal_id: proposal.id,
    ...(typeof request.caller === "string" && request.caller ? { caller: request.caller } : {}),
    ...(typeof request.source_session === "string" && request.source_session
      ? { source_session: request.source_session }
      : {}),
    ...(typeof request.idempotency_key === "string" && request.idempotency_key
      ? { idempotency_key: request.idempotency_key }
      : {}),
    ...(proposal.created_at || proposal.received_at
      ? { proposal_created_at: proposal.created_at || proposal.received_at }
      : {}),
  };
}

function safeTaskWorkRepositoryContext(value: unknown): Record<string, string> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const input = value as Record<string, unknown>;
  const result: Record<string, string> = {};
  const repositoryContextId =
    typeof input.repository_context_id === "string" ? input.repository_context_id.trim() : "";
  const provider = typeof input.provider === "string" ? input.provider.trim() : "";
  const repositorySlug =
    typeof input.repository_slug === "string" ? input.repository_slug.trim() : "";
  const branch = typeof input.branch === "string" ? input.branch.trim() : "";
  if (repositoryContextId && repositoryContextId.length <= 200)
    result.repository_context_id = repositoryContextId;
  if (["github", "gitlab", "azure_devops", "local", "generic_git", "unknown"].includes(provider))
    result.provider = provider;
  if (
    repositorySlug &&
    repositorySlug.length <= 500 &&
    /^[A-Za-z0-9._-]+(?:\/[A-Za-z0-9._-]+)*$/.test(repositorySlug)
  )
    result.repository_slug = repositorySlug;
  if (branch && branch.length <= 500 && !/[\x00-\x1f\x7f]/.test(branch)) result.branch = branch;
  return Object.keys(result).length ? result : null;
}

function safeTaskWorkRuntimeMetadata(value: unknown): Record<string, string> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const input = value as Record<string, unknown>;
  const result: Record<string, string> = {};
  const provider = typeof input.provider === "string" ? input.provider.trim() : "";
  const model = typeof input.model === "string" ? input.model.trim() : "";
  const reportKind = typeof input.report_kind === "string" ? input.report_kind.trim() : "";
  if (provider && provider.length <= 120) result.provider = provider;
  if (model && model.length <= 200) result.model = model;
  if (["done", "blocked", "progress"].includes(reportKind)) result.report_kind = reportKind;
  return Object.keys(result).length ? result : null;
}

function mcpTaskWorkEntry(
  proposal: Entity | null,
  taskId: string,
  actions: string[],
): Record<string, unknown> | null {
  if (!proposal) return null;
  let payload: unknown = proposal.payload;
  if (typeof payload === "string") {
    try {
      payload = JSON.parse(payload);
    } catch {
      return null;
    }
  }
  const entries =
    payload && typeof payload === "object" && !Array.isArray(payload)
      ? (payload as { task_work?: unknown }).task_work
      : null;
  if (!Array.isArray(entries)) return null;
  const entry = entries.find(
    (candidate) =>
      candidate &&
      typeof candidate === "object" &&
      !Array.isArray(candidate) &&
      (candidate as { task_id?: unknown }).task_id === taskId &&
      actions.includes(String((candidate as { action?: unknown }).action)),
  );
  return entry && typeof entry === "object" && !Array.isArray(entry)
    ? (entry as Record<string, unknown>)
    : null;
}

function singleMcpTaskWorkEntry(proposal: Entity): Record<string, unknown> {
  if (proposal.source !== "mcp" || proposal.payload_type !== "task_work") {
    throw new ApplicationCommandError("INVALID_PAYLOAD", "Task Work Proposalではありません。", {
      id: proposal.id,
    });
  }
  let payload: unknown = proposal.payload;
  if (typeof payload === "string") {
    try {
      payload = JSON.parse(payload);
    } catch {
      throw new ApplicationCommandError(
        "INVALID_PAYLOAD",
        "Task Work Proposalのpayloadを解析できません。",
        { id: proposal.id },
      );
    }
  }
  const entries =
    payload && typeof payload === "object" && !Array.isArray(payload)
      ? (payload as { task_work?: unknown }).task_work
      : null;
  if (
    !Array.isArray(entries) ||
    entries.length !== 1 ||
    !entries[0] ||
    typeof entries[0] !== "object" ||
    Array.isArray(entries[0])
  ) {
    throw new ApplicationCommandError(
      "INVALID_PAYLOAD",
      "Task Work Proposalは1件ずつ採用してください。",
      { id: proposal.id },
    );
  }
  return entries[0] as Record<string, unknown>;
}

function mergeCommandReceipts(
  repository: Repository,
  command: CommandEnvelope,
  workReceipt: CommandReceipt,
  decisionReceipt: CommandReceipt,
): CommandReceipt {
  const unique = <T>(values: T[], key: (value: T) => string): T[] => {
    const result = new Map<string, T>();
    for (const value of values) result.set(key(value), value);
    return [...result.values()];
  };
  const events = [...workReceipt.events, ...decisionReceipt.events];
  const merged: CommandReceipt = {
    commandId: command.commandId,
    name: command.name,
    status: "applied",
    saved: unique(
      [...workReceipt.saved, ...decisionReceipt.saved],
      (entry) => `${entry.type}:${entry.id}`,
    ),
    deleted: unique(
      [...workReceipt.deleted, ...decisionReceipt.deleted],
      (entry) => `${entry.type}:${entry.id}`,
    ),
    events,
    warnings: [...workReceipt.warnings, ...decisionReceipt.warnings],
    revisions: unique(
      [...workReceipt.revisions, ...decisionReceipt.revisions],
      (entry) => `${entry.type}:${entry.id}`,
    ),
    changes: unique(
      [...workReceipt.changes, ...decisionReceipt.changes],
      (entry) => `${entry.type}:${entry.entity.id}`,
    ),
  };
  const markerId = decisionReceipt.events.at(-1);
  const marker = markerId ? repository.get("change_event", markerId, true) : null;
  if (!marker) throw new Error("Task Work Proposalのdecision eventが保存されていません。");
  repository.save("change_event", {
    ...marker,
    command_fingerprint: commandFingerprint(command),
    receipt_json: JSON.stringify(merged),
  });
  return { ...merged, eventChanges: eventChangesFor(repository, events) };
}

function workReceiptProvenance(
  repository: Repository,
  command: CommandEnvelope,
  taskId: string,
  receipt: Entity,
): {
  source: "manual" | "ai" | "migration";
  metadata: Record<string, unknown>;
  sourceSession?: string;
} {
  const requestedSourceSession =
    typeof receipt.source_session === "string" && receipt.source_session.trim()
      ? receipt.source_session.trim()
      : "";
  const proposal = requestedSourceSession
    ? mcpTaskWorkProposal(repository, taskId, requestedSourceSession)
    : null;
  const reportedViaMcp = proposal?.source === "mcp";
  const source =
    receipt.executor_kind === "ai_agent" || reportedViaMcp
      ? "ai"
      : command.actor.kind === "system"
        ? "migration"
        : "manual";
  return {
    source,
    ...(proposal ? { sourceSession: proposal.id } : {}),
    metadata: {
      ...(reportedViaMcp ? mcpProposalAudit(proposal) : { reported_via: command.source }),
      ...(command.actor.kind === "user" && command.source !== "mcp"
        ? { imported_by: "human" }
        : {}),
    },
  };
}

function latestWorkReceipt(repository: Repository, taskId: string): Entity | null {
  return (
    repository
      .list("work_receipt", true)
      .filter((receipt) => receipt.task_id === taskId && !receipt.deleted_at)
      .sort(
        (left, right) =>
          String(right.reported_at).localeCompare(String(left.reported_at)) ||
          Number(right.version || 0) - Number(left.version || 0),
      )[0] || null
  );
}

function assertHumanReviewActor(command: CommandEnvelope, action: string): void {
  if (command.actor.kind !== "user" || command.source === "mcp") {
    throw new ApplicationCommandError(
      "INVALID_ENVELOPE",
      `${action}は人間UIからのみ実行できます。`,
    );
  }
}

function expectedVersionFor(
  envelope: CommandEnvelope,
  type: EntityType,
  id: string,
): ExpectedVersion | undefined {
  return envelope.expectedVersions?.find(
    (expected) => expected.type === type && expected.id === id,
  );
}

function normalizeCanonicalEntity(
  type: EntityType,
  entity: Entity,
  fallbackThemeId?: string,
): Entity {
  return type === "task" ? normalizeCanonicalTask(entity, fallbackThemeId) : entity;
}

function validateScheduleWrite(
  repository: Repository,
  command: CommandEnvelope,
  schedule: Entity | null | undefined,
  taskId: string,
  isCreate: boolean,
): Entity | null {
  return validateTaskScheduleWrite(
    repository,
    command,
    schedule,
    taskId,
    isCreate,
    (type, id) => Boolean(expectedVersionFor(command, type, id)),
    (type, id, current) => assertExpectedVersion(repository, command, type, id, current),
  );
}

function commandEvent(
  command: CommandEnvelope,
  entityType: EntityType,
  entityId: string,
  kind: "created" | "updated" | "completed" | "rescheduled" | "triaged" | "deleted",
  before: Entity | null,
  after: Entity,
  eventKind?: string,
  workReceiptRef?: { type: string; id: string; revision?: number } | null,
  sourceOverride?: "manual" | "ai" | "migration",
): Entity {
  const refType = entityType === "schedule" ? "task" : entityType;
  const source =
    sourceOverride ||
    (command.actor.kind === "system"
      ? "migration"
      : command.actor.kind === "ai_agent"
        ? "ai"
        : "manual");
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

function savedRef(
  type: EntityType,
  entity: Entity,
): { type: EntityType; id: string; version: number } {
  return { type, id: entity.id, version: Number(entity.version || 0) };
}

function receiptFor(
  command: CommandEnvelope,
  status: CommandReceipt["status"],
  changes: Array<{ type: EntityType; entity: Entity }> = [],
  events: string[] = [],
): CommandReceipt {
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

function annotateCaptureProvenance(command: CommandEnvelope, event: Entity): Entity {
  const raw = (command.payload as { provenance?: unknown }).provenance;
  if (raw === undefined) return event;
  const parsed = taskCreationProvenanceSchema.safeParse(raw);
  if (!parsed.success) {
    throw new ApplicationCommandError("INVALID_PAYLOAD", "Capture作成元のprovenanceが不正です。", {
      issues: parsed.error.issues,
    });
  }
  const metadata =
    event.metadata && typeof event.metadata === "object" && !Array.isArray(event.metadata)
      ? (event.metadata as Record<string, unknown>)
      : {};
  return { ...event, metadata: { ...metadata, provenance: parsed.data } };
}

function assertCanonicalThemeExists(repository: Repository, entity: Entity, label: string): void {
  const themeId = entity.project_id;
  if (typeof themeId !== "string" || !themeId.trim()) {
    throw new ApplicationCommandError(
      "INVALID_PAYLOAD",
      `${label}のcanonical Theme IDがありません。`,
    );
  }
  if (!repository.list("theme").some((theme) => theme.id === themeId)) {
    throw new ApplicationCommandError("INVALID_PAYLOAD", `Themeが存在しません: ${themeId}`, {
      themeId,
    });
  }
}

function eventChangesFor(
  repository: Repository,
  eventIds: string[],
): CommandReceipt["eventChanges"] {
  return eventIds
    .map((eventId) => repository.get("change_event", eventId, true))
    .filter((event): event is Entity => Boolean(event))
    .map((event) => ({ type: "change_event" as const, entity: withoutReceiptJson(event) }));
}

const contentProposalPayloadTypes = new Set(["notes", "knowledge_nodes", "sketches", "artifacts"]);

function isContentProposalDecision(command: CommandEnvelope): boolean {
  const payload = command.payload as ApplyAiProposalCommandPayload;
  return (
    command.name === "ApplyAiProposal" &&
    Array.isArray(payload.decisions) &&
    contentProposalPayloadTypes.has(String(payload.proposal?.payload_type || ""))
  );
}

function fingerprintPayload(command: CommandEnvelope): unknown {
  const payload = command.payload as ApplyAiProposalCommandPayload;
  if (!isContentProposalDecision(command)) {
    return command.payload;
  }
  return {
    proposal: {
      id: payload.proposal.id,
      version: payload.proposal.version,
      status: payload.proposal.status,
    },
    decision: payload.decision,
    decisions: payload.decisions,
    candidates: payload.candidates.map((candidate) => ({
      type: candidate.type,
      id: candidate.entity.id,
    })),
  };
}

export function commandFingerprint(command: CommandEnvelope): string {
  return JSON.stringify({
    name: command.name,
    payload: fingerprintPayload(command),
    actor: command.actor,
    source: command.source,
    windowId: command.windowId || null,
    sessionId: command.sessionId || null,
    expectedVersions: command.expectedVersions || [],
    issuedAt: command.issuedAt,
  });
}

function receiptMetadata(
  command: CommandEnvelope,
  event: Entity,
  serializedReceipt: string,
): Entity["metadata"] {
  if (!isContentProposalDecision(command)) return event.metadata;
  const metadata =
    event.metadata && typeof event.metadata === "object" && !Array.isArray(event.metadata)
      ? (event.metadata as Record<string, unknown>)
      : {};
  return {
    ...metadata,
    content_proposal_receipt_integrity: {
      schema: "tasken-content-proposal-receipt/v1",
      digest: `sha256:${createHash("sha256").update(serializedReceipt, "utf8").digest("hex")}`,
    },
  };
}

const NOTE_AI_COMMAND_MARKER_SCHEMA = "tasken-note-ai-command-marker/v1";

interface NoteAiCommandMarker {
  schema: typeof NOTE_AI_COMMAND_MARKER_SCHEMA;
  commandId: string;
  commandFingerprint: string;
  noteId: string;
  proposalId: string;
  noteVersion: number;
  proposalVersion: number;
}

function noteAiCommandMarker(event: Entity): NoteAiCommandMarker | null {
  const metadata =
    event.metadata && typeof event.metadata === "object" && !Array.isArray(event.metadata)
      ? (event.metadata as Record<string, unknown>)
      : {};
  const value = metadata.note_ai_command_marker;
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const marker = value as Record<string, unknown>;
  if (
    marker.schema !== NOTE_AI_COMMAND_MARKER_SCHEMA ||
    typeof marker.commandId !== "string" ||
    typeof marker.commandFingerprint !== "string" ||
    marker.commandFingerprint.length === 0 ||
    typeof marker.noteId !== "string" ||
    typeof marker.proposalId !== "string" ||
    !Number.isInteger(marker.noteVersion) ||
    !Number.isInteger(marker.proposalVersion)
  )
    return null;
  return marker as unknown as NoteAiCommandMarker;
}

function recoverNoteAiReceipt(
  repository: Repository,
  command: CommandEnvelope,
  event: Entity,
): CommandReceipt | null {
  if (command.name !== "ApplyAiProposal") return null;
  const marker = noteAiCommandMarker(event);
  if (
    !marker ||
    marker.commandId !== command.commandId ||
    marker.commandFingerprint !== event.command_fingerprint ||
    marker.commandFingerprint !== commandFingerprint(command) ||
    event.entity_id !== marker.noteId
  )
    return null;
  const note = repository.get("note", marker.noteId, true);
  const proposal = repository.get("ai_proposal", marker.proposalId, true);
  if (
    !note ||
    !proposal ||
    Number(note.version || 0) < marker.noteVersion ||
    Number(proposal.version || 0) < marker.proposalVersion ||
    !["accepted", "partially_accepted"].includes(String(proposal.status || ""))
  )
    return null;
  const receipt: CommandReceipt = {
    ...receiptFor(
      command,
      "applied",
      [
        { type: "note", entity: note },
        { type: "ai_proposal", entity: proposal },
      ],
      [event.id],
    ),
    saved: [
      { type: "note", id: note.id, version: marker.noteVersion },
      { type: "ai_proposal", id: proposal.id, version: marker.proposalVersion },
    ],
    revisions: [
      { type: "note", id: note.id, version: marker.noteVersion },
      { type: "ai_proposal", id: proposal.id, version: marker.proposalVersion },
    ],
  };
  try {
    repository.save("change_event", { ...event, receipt_json: JSON.stringify(receipt) });
  } catch {
    // marker自体がcanonical transaction内にあるため、後書きが再び失敗しても同じreceiptを復元できる。
  }
  return { ...receipt, eventChanges: eventChangesFor(repository, [event.id]) };
}

function readIdempotent(repository: Repository, command: CommandEnvelope): CommandReceipt | null {
  const existing = repository
    .list("change_event", true)
    .find((event) => event.command_id === command.commandId);
  if (!existing) return null;
  if (
    existing.command_name !== command.name ||
    existing.command_fingerprint !== commandFingerprint(command)
  ) {
    throw new ApplicationCommandError(
      "COMMAND_ID_REUSED",
      "同じcommandIdを別のCommandで再利用できません。",
      {
        commandId: command.commandId,
        conflictReason: "command_fingerprint_mismatch",
      },
    );
  }
  if (typeof existing.receipt_json !== "string") {
    const recovered = recoverNoteAiReceipt(repository, command, existing);
    if (recovered) {
      Object.defineProperty(recovered, "replayed", { value: true, enumerable: false });
      return recovered;
    }
    throw new ApplicationCommandError(
      "COMMAND_ID_REUSED",
      "同じcommandIdの完了状態を復元できません。",
      {
        commandId: command.commandId,
        conflictReason: "other_conflict",
      },
    );
  }
  const storedReceipt = JSON.parse(existing.receipt_json) as CommandReceipt;
  const receipt =
    storedReceipt.status === "applied"
      ? { ...storedReceipt, eventChanges: eventChangesFor(repository, storedReceipt.events) }
      : storedReceipt;
  // This is process-local notification metadata, not part of receipt_json.  The
  // IPC handler uses it to avoid rebroadcasting a retry while the renderer still
  // receives the exact persisted receipt.
  Object.defineProperty(receipt, "replayed", { value: true, enumerable: false });
  return receipt;
}

function persistReceipt(
  repository: Repository,
  command: CommandEnvelope,
  operations: SaveOperation[],
  eventIds: string[],
  changeTypes: EntityType[],
): CommandReceipt {
  const saved = repository.saveMany(operations);
  const changes = saved
    .map((entity, index) => ({ type: operations[index].type, entity }))
    .filter(({ type }) => changeTypes.includes(type));
  const baseReceipt = receiptFor(command, "applied", changes, eventIds);
  const serializedReceipt = JSON.stringify(baseReceipt);
  for (const eventId of eventIds) {
    const event = repository.get("change_event", eventId, true);
    if (!event) throw new Error(`Change Eventが保存されていません: ${eventId}`);
    const actualAfter =
      event.record_type === "schedule"
        ? changes.find(
            ({ type, entity }) =>
              type === "schedule" &&
              entity.owner_type === "task" &&
              entity.owner_id === event.entity_id,
          )?.entity
        : changes.find(
            ({ type, entity }) => type === event.record_type && entity.id === event.entity_id,
          )?.entity;
    repository.save("change_event", {
      ...event,
      after_json: actualAfter ? JSON.stringify(actualAfter) : event.after_json,
      metadata: receiptMetadata(command, event, serializedReceipt),
      receipt_json: serializedReceipt,
    });
  }
  return { ...baseReceipt, eventChanges: eventChangesFor(repository, eventIds) };
}

function persistDeleteReceipt(
  repository: Repository,
  command: CommandEnvelope,
  type: EntityType,
  deleted: Entity,
  event: Entity,
  preserveRevision: boolean,
): CommandReceipt {
  const baseReceipt = receiptFor(command, "applied", [{ type, entity: deleted }], [event.id]);
  const receipt: CommandReceipt = {
    ...baseReceipt,
    saved: [],
    deleted: [{ type, id: deleted.id }],
    revisions: preserveRevision ? baseReceipt.revisions : [],
  };
  repository.save("change_event", {
    ...event,
    receipt_json: JSON.stringify(receipt),
  });
  return { ...receipt, eventChanges: eventChangesFor(repository, [event.id]) };
}

function persistNoChange(
  repository: Repository,
  command: CommandEnvelope,
  taskId: string,
  current: Entity,
): CommandReceipt {
  const marker: Entity = {
    id: randomUUID(),
    entity_type: "task",
    entity_id: taskId,
    changed_at: now(),
    change_type: "updated",
    no_change: true,
    source:
      command.actor.kind === "system"
        ? "migration"
        : command.actor.kind === "ai_agent"
          ? "ai"
          : "manual",
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
  repository.saveMany([
    {
      action: "save",
      type: "change_event",
      entity: { ...marker, receipt_json: JSON.stringify(receipt) },
    },
  ]);
  return receipt;
}

function assertExpectedVersion(
  repository: Repository,
  envelope: CommandEnvelope,
  type: EntityType,
  id: string,
  current: Entity | null,
): void {
  const expected = expectedVersionFor(envelope, type, id);
  if (!expected) return;
  const actual = Number(current?.version || 0);
  if (actual !== expected.version) {
    throw new ApplicationCommandError(
      "CONFLICT",
      "保存対象が更新済みです。画面を再読み込みしてから再試行してください。",
      {
        type,
        id,
        expected: expected.version,
        actual,
        conflictReason: "version_conflict",
      },
    );
  }
}

function normalizeCanonicalNote(entity: Entity, fallbackThemeId?: string): Entity {
  const next: Entity = {
    ...entity,
    project_id: entity.project_id ?? entity.theme_id ?? fallbackThemeId ?? null,
  };
  delete next.theme_id;
  return next;
}

function taskCommandRuntime(repository: Repository): TaskCommandRuntime {
  return {
    hasExpectedVersion: (command, type, id) => Boolean(expectedVersionFor(command, type, id)),
    assertExpectedVersion: (command, type, id, current) =>
      assertExpectedVersion(repository, command, type, id, current),
    createEvent: (command, entityType, entityId, kind, before, after) =>
      commandEvent(command, entityType, entityId, kind, before, after),
    annotateEvent,
    persist: (command, operations, eventIds, changeTypes) =>
      persistReceipt(repository, command, operations, eventIds, changeTypes),
    persistDelete: (command, type, deleted, event) =>
      persistDeleteReceipt(repository, command, type, deleted, event, false),
    persistNoChange: (command, taskId, current) =>
      persistNoChange(repository, command, taskId, current),
    now,
  };
}

export class ApplicationCommandService {
  constructor(private readonly repository: Repository) {}

  execute(input: unknown): CommandReceipt {
    const command = parseCommandEnvelope(input);
    if (
      command.name === "CommitAudioCapture" ||
      command.name === "CommitVideoArtifact" ||
      command.name === "CommitTrimmedVideoArtifact"
    ) {
      throw new ApplicationCommandError(
        "INVALID_ENVELOPE",
        "Mediaの保存はMainのmedia session経由で確定してください。",
      );
    }
    if (!applicationCommandSources.includes(command.source))
      throw new ApplicationCommandError("INVALID_ENVELOPE", "Command sourceが不正です。");
    return this.repository.runTransaction((transactionRepository) =>
      new ApplicationCommandService(transactionRepository).executeParsed(command),
    );
  }

  executeMediaCapture(input: unknown): CommandReceipt {
    const command = parseCommandEnvelope(input);
    if (
      (command.name !== "CommitAudioCapture" &&
        command.name !== "CommitVideoArtifact" &&
        command.name !== "CommitTrimmedVideoArtifact") ||
      command.actor.kind !== "user" ||
      !["inbox", "main_ui"].includes(command.source)
    ) {
      throw new ApplicationCommandError(
        "INVALID_ENVELOPE",
        "Media commitはMain-owned media session専用です。",
      );
    }
    return this.repository.runTransaction((transactionRepository) =>
      new ApplicationCommandService(transactionRepository).executeParsed(command),
    );
  }

  executeBatch(inputs: unknown[]): CommandReceipt[] {
    const commands = inputs.map((input) => parseCommandEnvelope(input));
    for (const command of commands) {
      if (
        command.name === "CommitAudioCapture" ||
        command.name === "CommitVideoArtifact" ||
        command.name === "CommitTrimmedVideoArtifact"
      ) {
        throw new ApplicationCommandError(
          "INVALID_ENVELOPE",
          "Mediaの保存はMainのmedia session経由で確定してください。",
        );
      }
      if (!applicationCommandSources.includes(command.source))
        throw new ApplicationCommandError("INVALID_ENVELOPE", "Command sourceが不正です。");
    }
    return this.repository.runTransaction((transactionRepository) => {
      const service = new ApplicationCommandService(transactionRepository);
      return commands.map((command) => service.executeParsed(command));
    });
  }

  /**
   * Canonical Markdownを持つNoteだけのApplyAiProposal。
   * Note保存はWorkspaceServiceへ委譲し、proposal/eventを同じDB transactionへ
   * 同伴させる。Rendererのgeneric saveや二段階保存は許可しない。
   */
  executeCanonicalNoteAiProposal(
    input: unknown,
    saveCanonicalNote: (note: Entity, companion: CanonicalNoteAiCompanion) => Entity,
  ): CommandReceipt {
    const command = parseCommandEnvelope(input);
    if (!applicationCommandSources.includes(command.source) || command.name !== "ApplyAiProposal") {
      throw new ApplicationCommandError(
        "INVALID_ENVELOPE",
        "canonical NoteにはApplyAiProposalが必要です。",
      );
    }
    // Validation of nested proposal payloads may normalize their objects.  Pin
    // the idempotency identity before those validators run so the transaction
    // marker and a later retry compare the same original command envelope.
    const durableCommandFingerprint = commandFingerprint(command);
    const previous = readIdempotent(this.repository, command);
    if (previous) return previous;
    const payload = command.payload as {
      proposal: Entity;
      candidates: Array<{ type: EntityType; entity: Entity }>;
    };
    if (payload.candidates.length !== 1 || payload.candidates[0]?.type !== "note") {
      throw new ApplicationCommandError(
        "INVALID_PAYLOAD",
        "canonical Note採用にはNote候補を1件だけ指定してください。",
      );
    }
    const currentProposal = this.repository.get("ai_proposal", payload.proposal.id);
    if (!currentProposal)
      throw new ApplicationCommandError("NOT_FOUND", "AI Proposalがありません。", {
        id: payload.proposal.id,
      });
    if (!expectedVersionFor(command, "ai_proposal", currentProposal.id)) {
      throw new ApplicationCommandError(
        "CONFLICT",
        "ApplyAiProposalにはProposalのexpected versionが必要です。",
        { type: "ai_proposal", id: currentProposal.id },
      );
    }
    assertExpectedVersion(
      this.repository,
      command,
      "ai_proposal",
      currentProposal.id,
      currentProposal,
    );
    if (currentProposal.status !== "pending")
      throw new ApplicationCommandError(
        "INVALID_TRANSITION",
        "Pending以外のProposalは採用できません。",
        { id: currentProposal.id },
      );
    const proposal = { ...payload.proposal };
    if (proposal.status !== "accepted" && proposal.status !== "partially_accepted") {
      throw new ApplicationCommandError(
        "INVALID_PAYLOAD",
        "canonical NoteのProposal採用状態が不正です。",
      );
    }
    entityDefinition("ai_proposal").parseUpdate(proposal);

    const currentNote = this.repository.get("note", payload.candidates[0].entity.id, true);
    if (currentNote?.deleted_at)
      throw new ApplicationCommandError(
        "CONFLICT",
        "削除済みNoteをAI Proposalから更新できません。",
        { id: payload.candidates[0].entity.id },
      );
    if (currentNote) {
      if (!expectedVersionFor(command, "note", currentNote.id)) {
        throw new ApplicationCommandError(
          "CONFLICT",
          "既存Noteの採用にはexpected versionが必要です。",
          { type: "note", id: currentNote.id },
        );
      }
      assertExpectedVersion(this.repository, command, "note", currentNote.id, currentNote);
    }
    const note = normalizeCanonicalNote(
      payload.candidates[0].entity,
      String(currentNote?.project_id || currentNote?.theme_id || ""),
    );
    entityDefinition("note")[currentNote ? "parseUpdate" : "parseCreate"](note);
    const marker: NoteAiCommandMarker = {
      schema: NOTE_AI_COMMAND_MARKER_SCHEMA,
      commandId: command.commandId,
      commandFingerprint: durableCommandFingerprint,
      noteId: note.id,
      proposalId: proposal.id,
      noteVersion: Number(currentNote?.version || 0) + 1,
      proposalVersion: Number(currentProposal.version || 0) + 1,
    };
    const noteEvent = annotateEvent(
      command,
      commandEvent(
        command,
        "note",
        note.id,
        currentNote ? "updated" : "created",
        currentNote,
        note,
      ),
    );
    noteEvent.command_fingerprint = durableCommandFingerprint;
    noteEvent.metadata = {
      ...(noteEvent.metadata &&
      typeof noteEvent.metadata === "object" &&
      !Array.isArray(noteEvent.metadata)
        ? noteEvent.metadata
        : {}),
      note_ai_command_marker: marker,
    };
    const companion: CanonicalNoteAiCompanion = {
      schema: "tasken-note-ai-companion/v1",
      noteId: note.id,
      commandId: command.commandId,
      proposal,
      event: noteEvent,
    };
    const savedNote = saveCanonicalNote(note, companion);
    const savedProposal = this.repository.get("ai_proposal", proposal.id, true);
    if (!savedProposal) throw new Error("AI Proposalが保存されていません。");
    const changes = [
      { type: "note" as const, entity: savedNote },
      { type: "ai_proposal" as const, entity: savedProposal },
    ];
    const eventIds = [noteEvent.id];
    const baseReceipt = receiptFor(command, "applied", changes, eventIds);
    const serializedReceipt = JSON.stringify(baseReceipt);
    for (const eventId of eventIds) {
      const event = this.repository.get("change_event", eventId, true);
      if (!event) throw new Error(`Change Eventが保存されていません: ${eventId}`);
      this.repository.save("change_event", {
        ...event,
        after_json: JSON.stringify(savedNote),
        metadata: receiptMetadata(command, event, serializedReceipt),
        receipt_json: serializedReceipt,
      });
    }
    return { ...baseReceipt, eventChanges: eventChangesFor(this.repository, eventIds) };
  }

  private executeParsed(command: CommandEnvelope): CommandReceipt {
    const previous = readIdempotent(this.repository, command);
    if (previous) return previous;
    if (command.actor.kind === "ai_agent" && !aiAgentCommands.has(command.name)) {
      throw new ApplicationCommandError(
        "INVALID_TRANSITION",
        "AI agentはTaskを直接変更・完了できません。Task Work Proposalを人間の確認へ送ってください。",
      );
    }

    const taskModule = createTaskModule(this.repository, taskCommandRuntime(this.repository));
    if (taskModule.commands.handles(command.name)) return taskModule.commands.execute(command);

    if (command.name === "CreateCapture") return this.createCapture(command);
    if (command.name === "DeleteCapture") return this.deleteCapture(command);
    if (command.name === "CreateTaskFromCapture") {
      return this.createTaskFromCapture(command);
    }
    if (command.name === "CommitAudioCapture") return this.commitAudioCapture(command);
    if (command.name === "CommitVideoArtifact") return this.commitVideoArtifact(command);
    if (command.name === "CommitTrimmedVideoArtifact")
      return this.commitTrimmedVideoArtifact(command);
    if (command.name === "CompleteTaskWithLearning") {
      return this.completeTaskWithLearning(command);
    }
    if (command.name === "EndFocusSession") {
      return this.endFocusSession(command);
    }
    if (command.name === "ApplyAiProposal") {
      return this.applyAiProposal(command);
    }
    if (command.name === "ApplyTaskWorkProposal") return this.applyTaskWorkProposal(command);
    if (command.name === "StartTaskWork") return this.startTaskWork(command);
    if (command.name === "AppendWorkReceipt") return this.appendWorkReceipt(command, "continue");
    if (command.name === "ReportTaskDone") return this.appendWorkReceipt(command, "review");
    if (command.name === "ReportTaskBlocked") return this.appendWorkReceipt(command, "blocked");
    if (command.name === "AcceptTaskWork") return this.acceptTaskWork(command);
    if (command.name === "ReturnTaskWork") return this.returnTaskWork(command);
    throw new ApplicationCommandError(
      "INVALID_ENVELOPE",
      `Command handlerが登録されていません: ${command.name}`,
    );
  }

  private createCapture(command: CommandEnvelope): CommandReceipt {
    if (command.source !== "mobile") {
      throw new ApplicationCommandError("INVALID_ENVELOPE", "CreateCaptureはMobile経路専用です。");
    }
    const payload = command.payload as {
      capture: {
        id: string;
        text: string;
        project_id?: string | null;
        captured_at: string;
      };
      provenance?: Record<string, unknown>;
    };
    if (this.repository.get("capture_entry", payload.capture.id, true)) {
      throw new ApplicationCommandError("CONFLICT", "同じCapture IDが既に存在します。", {
        type: "capture_entry",
        id: payload.capture.id,
      });
    }
    const captureUrl = firstCaptureUrl(payload.capture.text);
    const capture: Entity = {
      id: payload.capture.id,
      text: payload.capture.text,
      title: quickCaptureTitle(payload.capture.text),
      kind: "inbox",
      content_type: quickCaptureContentType(payload.capture.text),
      url: captureUrl || null,
      project_id: canonicalThemeId(payload.capture.project_id, { defaultPersonal: true }),
      captured_at: payload.capture.captured_at,
      state: "untriaged",
    };
    captureDefinition.parseCreate(capture);
    if (
      capture.state !== "untriaged" ||
      capture.kind !== "inbox" ||
      !["text", "url", "markdown"].includes(String(capture.content_type)) ||
      (capture.content_type === "url" && !capture.url)
    ) {
      throw new ApplicationCommandError(
        "INVALID_PAYLOAD",
        "Mobile Captureのcanonical payloadが不正です。",
      );
    }
    assertCanonicalThemeExists(this.repository, capture, "Capture");
    const event = annotateCaptureProvenance(
      command,
      annotateEvent(
        command,
        commandEvent(command, "capture_entry", capture.id, "created", null, capture),
      ),
    );
    return persistReceipt(
      this.repository,
      command,
      [
        { action: "save", type: "capture_entry", entity: capture },
        { action: "save", type: "change_event", entity: event },
      ],
      [event.id],
      ["capture_entry"],
    );
  }

  private deleteCapture(command: CommandEnvelope): CommandReceipt {
    if (command.source !== "mobile") {
      throw new ApplicationCommandError("INVALID_ENVELOPE", "DeleteCaptureはMobile経路専用です。");
    }
    const captureId = (command.payload as { captureId: string }).captureId;
    const current = this.repository.get("capture_entry", captureId);
    if (!current) {
      throw new ApplicationCommandError("NOT_FOUND", "削除対象のCaptureがありません。", {
        id: captureId,
      });
    }
    if (!expectedVersionFor(command, "capture_entry", captureId)) {
      throw new ApplicationCommandError(
        "CONFLICT",
        "DeleteCaptureにはexpected versionが必要です。",
        {
          type: "capture_entry",
          id: captureId,
          conflictReason: "version_conflict",
        },
      );
    }
    assertExpectedVersion(this.repository, command, "capture_entry", captureId, current);
    const deleted = this.repository.remove("capture_entry", captureId);
    if (!deleted) {
      throw new ApplicationCommandError("NOT_FOUND", "削除対象のCaptureがありません。", {
        id: captureId,
      });
    }
    const event = annotateEvent(
      command,
      commandEvent(command, "capture_entry", captureId, "deleted", current, deleted),
    );
    return persistDeleteReceipt(this.repository, command, "capture_entry", deleted, event, true);
  }

  private commitAudioCapture(command: CommandEnvelope): CommandReceipt {
    const payload = command.payload as { capture: Entity; artifact: Entity };
    const { capture, artifact } = payload;
    for (const [type, entity] of [
      ["capture_entry", capture],
      ["artifact", artifact],
    ] as const) {
      if (this.repository.get(type, entity.id, true)) {
        throw new ApplicationCommandError("CONFLICT", `${type}のIDを再利用できません。`, {
          type,
          id: entity.id,
        });
      }
    }
    captureDefinition.parseCreate(capture);
    artifactDefinition.parseCreate(artifact);
    if (
      capture.content_type !== "audio" ||
      capture.kind !== "voice_memo" ||
      !["audio_import", "microphone"].includes(String(capture.capture_method)) ||
      capture.media_status !== "ready"
    ) {
      throw new ApplicationCommandError(
        "INVALID_PAYLOAD",
        "Voice Captureのcommit contractが不正です。",
      );
    }
    if (
      artifact.media_kind !== "audio" ||
      artifact.storage_mode !== "managed" ||
      artifact.source_type !== "capture_entry" ||
      artifact.source_id !== capture.id
    ) {
      throw new ApplicationCommandError(
        "INVALID_PAYLOAD",
        "Audio Artifactのmanaged ownerがCaptureと一致しません。",
      );
    }
    const event = annotateEvent(
      command,
      commandEvent(command, "capture_entry", capture.id, "created", null, capture),
    );
    event.metadata = {
      ...((event.metadata as Record<string, unknown>) || {}),
      include_in_activity: true,
      media_kind: "audio",
      artifact_id: artifact.id,
      content_hash: artifact.content_hash,
    };
    return persistReceipt(
      this.repository,
      command,
      [
        { action: "save", type: "capture_entry", entity: capture },
        { action: "save", type: "artifact", entity: artifact },
        { action: "save", type: "change_event", entity: event },
      ],
      [event.id],
      ["capture_entry", "artifact"],
    );
  }

  private commitVideoArtifact(command: CommandEnvelope): CommandReceipt {
    // captureを伴う場合は紐づけ先未選択の画面録画。CaptureEntryごと同じtransactionで作る（#383）。
    const { capture = null, artifact } = command.payload as { capture?: Entity; artifact: Entity };
    for (const [type, entity] of [
      ["capture_entry", capture],
      ["artifact", artifact],
    ] as const) {
      if (entity && this.repository.get(type, entity.id, true)) {
        throw new ApplicationCommandError("CONFLICT", `${type}のIDを再利用できません。`, {
          type,
          id: entity.id,
        });
      }
    }
    if (capture) {
      captureDefinition.parseCreate(capture);
      if (
        capture.content_type !== "video" ||
        capture.kind !== "screen_capture" ||
        capture.capture_method !== "screen_recording" ||
        capture.media_status !== "ready" ||
        artifact.source_type !== "capture_entry" ||
        artifact.source_id !== capture.id
      ) {
        throw new ApplicationCommandError(
          "INVALID_PAYLOAD",
          "画面録画Captureのcommit contractが不正です。",
        );
      }
    }
    artifactDefinition.parseCreate(artifact);
    const ownerTypes = new Set<EntityType>(["task", "note", "capture_entry"]);
    const ownerType =
      artifact.source_type === "report" ? "note" : (artifact.source_type as EntityType);
    const owner =
      capture ||
      (ownerTypes.has(ownerType) && typeof artifact.source_id === "string"
        ? this.repository.get(ownerType, artifact.source_id)
        : null);
    const ownerThemeId =
      owner && typeof owner.project_id === "string" && owner.project_id
        ? owner.project_id
        : owner && typeof owner.theme_id === "string" && owner.theme_id
          ? owner.theme_id
          : null;
    if (
      artifact.media_kind !== "video" ||
      (artifact.storage_mode !== "managed" && artifact.storage_mode !== "linked") ||
      !ownerTypes.has(ownerType) ||
      typeof artifact.source_id !== "string" ||
      !owner ||
      (artifact.theme_id || null) !== ownerThemeId
    ) {
      throw new ApplicationCommandError(
        "INVALID_PAYLOAD",
        "Video Artifactのownerまたはstorage contractが不正です。",
      );
    }
    const event = annotateEvent(
      command,
      commandEvent(command, "artifact", artifact.id, "created", null, artifact),
    );
    event.metadata = {
      ...((event.metadata as Record<string, unknown>) || {}),
      include_in_activity: true,
      media_kind: "video",
      source_type: artifact.source_type,
      source_id: artifact.source_id,
      content_hash: artifact.content_hash,
    };
    return persistReceipt(
      this.repository,
      command,
      [
        ...(capture
          ? [{ action: "save" as const, type: "capture_entry" as const, entity: capture }]
          : []),
        { action: "save", type: "artifact", entity: artifact },
        { action: "save", type: "change_event", entity: event },
      ],
      [event.id],
      capture ? ["capture_entry", "artifact"] : ["artifact"],
    );
  }

  private commitTrimmedVideoArtifact(command: CommandEnvelope): CommandReceipt {
    const { artifact, reference } = command.payload as { artifact: Entity; reference: Entity };
    if (
      this.repository.get("artifact", artifact.id, true) ||
      this.repository.get("reference", reference.id, true)
    ) {
      throw new ApplicationCommandError("CONFLICT", "trim書き出しのIDを再利用できません。");
    }
    artifactDefinition.parseCreate(artifact);
    referenceDefinition.parseCreate(reference);
    const source =
      typeof reference.target_id === "string"
        ? this.repository.get("artifact", reference.target_id)
        : null;
    if (
      artifact.media_kind !== "video" ||
      artifact.storage_mode !== "managed" ||
      artifact.source_type !== source?.source_type ||
      artifact.source_id !== source?.source_id ||
      reference.source_type !== "artifact" ||
      reference.source_id !== artifact.id ||
      reference.target_type !== "artifact" ||
      reference.relation_type !== "derived_from" ||
      !source ||
      source.media_kind !== "video"
    ) {
      throw new ApplicationCommandError(
        "INVALID_PAYLOAD",
        "trim Artifactの原本またはderived_from contractが不正です。",
      );
    }
    const event = annotateEvent(
      command,
      commandEvent(command, "artifact", artifact.id, "created", null, artifact),
    );
    event.metadata = {
      ...((event.metadata as Record<string, unknown>) || {}),
      include_in_activity: true,
      media_kind: "video",
      derived_from_artifact_id: source.id,
      content_hash: artifact.content_hash,
    };
    return persistReceipt(
      this.repository,
      command,
      [
        { action: "save", type: "artifact", entity: artifact },
        { action: "save", type: "reference", entity: reference },
        { action: "save", type: "change_event", entity: event },
      ],
      [event.id],
      ["artifact", "reference"],
    );
  }

  private startTaskWork(command: CommandEnvelope): CommandReceipt {
    const payload = command.payload as {
      taskId: string;
      executorKind?: string;
      executorIdentity?: string | null;
      startedAt?: string | null;
      sourceSession?: string | null;
    };
    const taskId = asTaskId(payload);
    const current = this.repository.get("task", taskId);
    if (!current)
      throw new ApplicationCommandError("NOT_FOUND", "作業開始対象のTaskがありません。", {
        id: taskId,
      });
    if (!expectedVersionFor(command, "task", taskId))
      throw new ApplicationCommandError(
        "CONFLICT",
        "StartTaskWorkにはexpected versionが必要です。",
        { type: "task", id: taskId },
      );
    assertExpectedVersion(this.repository, command, "task", taskId, current);
    if (current.state === "done" || current.state === "cancelled")
      throw new ApplicationCommandError(
        "INVALID_TRANSITION",
        "完了済みまたは中止済みTaskは作業開始できません。",
        { id: taskId },
      );
    const state = currentWorkState(current);
    if (["reported_done", "needs_human_review", "accepted"].includes(state))
      throw new ApplicationCommandError(
        "INVALID_TRANSITION",
        "報告済みのTaskはAcceptまたは差戻しを先に行ってください。",
        { id: taskId, work_state: state },
      );
    if (payload.executorKind != null && !taskExecutorKinds.has(payload.executorKind))
      throw new ApplicationCommandError("INVALID_PAYLOAD", "executorKindが不正です。");
    if (payload.executorIdentity != null && payload.executorIdentity.length > 200)
      throw new ApplicationCommandError(
        "INVALID_PAYLOAD",
        "executorIdentityは200文字以内で入力してください。",
      );
    if (state === "in_progress") return persistNoChange(this.repository, command, taskId, current);
    const task: Entity = {
      ...current,
      work_state: "in_progress",
      work_started_at: payload.startedAt || current.work_started_at || now(),
      work_reported_at: null,
      work_review_note: null,
      ...(payload.executorIdentity !== undefined
        ? { executor_identity: payload.executorIdentity || null }
        : {}),
    };
    taskDefinition.parseUpdate(task);
    assertThemeExists(this.repository, task);
    const event = annotateEvent(
      command,
      commandEvent(command, "task", taskId, "updated", current, task, "task_work_recorded"),
    );
    const proposal = payload.sourceSession
      ? mcpTaskWorkProposal(this.repository, taskId, payload.sourceSession, ["start"])
      : null;
    const repositoryContext = safeTaskWorkRepositoryContext(
      mcpTaskWorkEntry(proposal, taskId, ["start"])?.repository_context,
    );
    event.metadata = {
      ...((event.metadata as Record<string, unknown>) || {}),
      include_in_activity: true,
      work_action: "started",
      ...(proposal ? mcpProposalAudit(proposal) : {}),
      ...(repositoryContext ? { repository_context: repositoryContext } : {}),
    };
    const operations: SaveOperation[] = [
      { action: "save", type: "task", entity: task },
      { action: "save", type: "change_event", entity: event },
    ];
    return persistReceipt(this.repository, command, operations, [event.id], ["task"]);
  }

  private applyTaskWorkProposal(command: CommandEnvelope): CommandReceipt {
    const payload = command.payload as { proposalId: string; decision: "accept" | "reject" };
    const proposal = this.repository.get("ai_proposal", payload.proposalId);
    if (!proposal)
      throw new ApplicationCommandError("NOT_FOUND", "Task Work Proposalがありません。", {
        id: payload.proposalId,
      });
    if (!expectedVersionFor(command, "ai_proposal", proposal.id)) {
      throw new ApplicationCommandError(
        "CONFLICT",
        "Task Work Proposalにはexpected versionが必要です。",
        { id: proposal.id },
      );
    }
    assertExpectedVersion(this.repository, command, "ai_proposal", proposal.id, proposal);
    if (proposal.status !== "pending") {
      throw new ApplicationCommandError(
        "INVALID_TRANSITION",
        "Pending以外のTask Work Proposalは判断できません。",
        { id: proposal.id },
      );
    }
    const entry = singleMcpTaskWorkEntry(proposal);
    const decisionCommand: CommandEnvelope = {
      ...command,
      payload: {
        proposal: { ...proposal, status: payload.decision === "accept" ? "accepted" : "rejected" },
        candidates: [],
      },
    };
    if (payload.decision === "reject") return this.applyAiProposal(decisionCommand);

    const taskId = typeof entry.task_id === "string" ? entry.task_id.trim() : "";
    const task = taskId ? this.repository.get("task", taskId) : null;
    if (!task)
      throw new ApplicationCommandError("NOT_FOUND", "Task Work Proposalの対象Taskがありません。", {
        id: taskId,
      });
    const proposalExpectedVersion = Number(entry.expected_version);
    if (
      !Number.isInteger(proposalExpectedVersion) ||
      proposalExpectedVersion < 0 ||
      proposalExpectedVersion !== Number(task.version || 0)
    ) {
      throw new ApplicationCommandError(
        "CONFLICT",
        "Taskが更新されています。tasken.get_task_contextで対象を再取得し、最新versionと新しいidempotency_keyでProposalを作り直してください。",
        {
          id: taskId,
          expected: proposalExpectedVersion,
          actual: Number(task.version || 0),
        },
      );
    }
    if (!expectedVersionFor(command, "task", taskId)) {
      throw new ApplicationCommandError(
        "CONFLICT",
        "Task Work Proposalの対象Taskにはexpected versionが必要です。",
        { id: taskId },
      );
    }
    assertExpectedVersion(this.repository, command, "task", taskId, task);

    const action = typeof entry.action === "string" ? entry.action : "";
    let name: ApplicationCommandName;
    let workPayload: CommandEnvelope["payload"];
    if (action === "start") {
      name = "StartTaskWork";
      workPayload = {
        taskId,
        executorKind: typeof entry.executor_kind === "string" ? entry.executor_kind : "ai_agent",
        executorIdentity:
          typeof entry.executor_identity === "string" ? entry.executor_identity : null,
        startedAt: typeof entry.started_at === "string" ? entry.started_at : null,
        sourceSession: proposal.id,
      };
    } else if (["append_receipt", "report_done", "report_blocked"].includes(action)) {
      name =
        action === "report_blocked"
          ? "ReportTaskBlocked"
          : action === "report_done"
            ? "ReportTaskDone"
            : "AppendWorkReceipt";
      const reportedAt =
        typeof entry.reported_at === "string" && entry.reported_at
          ? entry.reported_at
          : String(proposal.created_at || proposal.received_at || command.issuedAt);
      workPayload = {
        taskId,
        receipt: {
          id: proposal.id,
          task_id: taskId,
          executor_kind: typeof entry.executor_kind === "string" ? entry.executor_kind : "ai_agent",
          executor_label:
            typeof entry.executor_label === "string" ? entry.executor_label : "AI agent",
          started_at:
            typeof entry.started_at === "string"
              ? entry.started_at
              : task.work_started_at || reportedAt,
          reported_at: reportedAt,
          summary: typeof entry.summary === "string" ? entry.summary : "",
          completed_items: Array.isArray(entry.completed_items) ? entry.completed_items : [],
          changed_or_created_items: Array.isArray(entry.changed_or_created_items)
            ? entry.changed_or_created_items
            : [],
          ...(Array.isArray(entry.verification) ? { verification: entry.verification } : {}),
          ...(Array.isArray(entry.remaining_work) ? { remaining_work: entry.remaining_work } : {}),
          ...(entry.external_references !== undefined
            ? { external_references: normalizeExternalReferences(entry.external_references) }
            : {}),
          source_session: proposal.id,
          repository_context: safeTaskWorkRepositoryContext(entry.repository_context),
          runtime_metadata: safeTaskWorkRuntimeMetadata(entry.runtime_metadata),
        },
      };
    } else {
      throw new ApplicationCommandError(
        "INVALID_PAYLOAD",
        "未対応のTask Work Proposal actionです。",
        { action },
      );
    }
    const workCommand: CommandEnvelope = {
      ...command,
      commandId: `${command.commandId}:work`,
      name,
      payload: workPayload,
      expectedVersions: [{ type: "task", id: taskId, version: proposalExpectedVersion }],
    };
    const workReceipt = this.executeParsed(workCommand);
    const decisionReceipt = this.applyAiProposal(decisionCommand);
    return mergeCommandReceipts(this.repository, command, workReceipt, decisionReceipt);
  }

  private appendWorkReceipt(
    command: CommandEnvelope,
    outcome: "continue" | "review" | "blocked",
  ): CommandReceipt {
    const payload = command.payload as { taskId: string; receipt: Entity };
    const taskId = asTaskId(payload);
    const current = this.repository.get("task", taskId);
    if (!current)
      throw new ApplicationCommandError("NOT_FOUND", "報告対象のTaskがありません。", {
        id: taskId,
      });
    if (!expectedVersionFor(command, "task", taskId))
      throw new ApplicationCommandError(
        "CONFLICT",
        `${command.name}にはexpected versionが必要です。`,
        { type: "task", id: taskId },
      );
    assertExpectedVersion(this.repository, command, "task", taskId, current);
    if (current.state === "done" || current.state === "cancelled")
      throw new ApplicationCommandError(
        "INVALID_TRANSITION",
        "完了済みまたは中止済みTaskへWork Receiptを追加できません。",
        { id: taskId },
      );
    if (currentWorkState(current) !== "in_progress")
      throw new ApplicationCommandError(
        "INVALID_TRANSITION",
        "作業中のTaskだけにWork Receiptを追加できます。",
        { id: taskId, work_state: currentWorkState(current) },
      );
    if (payload.receipt.task_id !== taskId)
      throw new ApplicationCommandError(
        "INVALID_PAYLOAD",
        "Work Receiptのtask_idが対象Taskと一致しません。",
        { id: payload.receipt.id },
      );
    if (this.repository.get("work_receipt", payload.receipt.id, true))
      throw new ApplicationCommandError("CONFLICT", "Work ReceiptのIDを再利用できません。", {
        id: payload.receipt.id,
      });
    const provenance = workReceiptProvenance(this.repository, command, taskId, payload.receipt);
    const repositoryContext = safeTaskWorkRepositoryContext(payload.receipt.repository_context);
    const runtimeMetadata = safeTaskWorkRuntimeMetadata(payload.receipt.runtime_metadata);
    const receipt: Entity = {
      id: payload.receipt.id,
      task_id: taskId,
      executor_kind: payload.receipt.executor_kind,
      executor_label: payload.receipt.executor_label,
      started_at: payload.receipt.started_at || current.work_started_at || null,
      reported_at: payload.receipt.reported_at,
      summary: payload.receipt.summary,
      completed_items: Array.isArray(payload.receipt.completed_items)
        ? payload.receipt.completed_items
        : [],
      changed_or_created_items: Array.isArray(payload.receipt.changed_or_created_items)
        ? payload.receipt.changed_or_created_items
        : [],
      ...(Array.isArray(payload.receipt.verification)
        ? { verification: payload.receipt.verification }
        : {}),
      ...(Array.isArray(payload.receipt.remaining_work)
        ? { remaining_work: payload.receipt.remaining_work }
        : {}),
      ...(payload.receipt.external_references !== undefined
        ? { external_references: normalizeExternalReferences(payload.receipt.external_references) }
        : {}),
      ...(repositoryContext ? { repository_context: repositoryContext } : {}),
      ...(provenance.sourceSession ? { source_session: provenance.sourceSession } : {}),
      ...(runtimeMetadata ? { runtime_metadata: runtimeMetadata } : {}),
      provenance: provenance.metadata,
      source: provenance.source,
    };
    workReceiptDefinition.parseCreate(receipt);
    const nextTask: Entity =
      outcome === "continue"
        ? { ...current, work_state: "in_progress" }
        : {
            ...current,
            work_state: outcome === "blocked" ? "blocked" : "needs_human_review",
            work_reported_at: receipt.reported_at,
            work_review_note: null,
          };
    taskDefinition.parseUpdate(nextTask);
    assertThemeExists(this.repository, nextTask);
    const eventKind =
      outcome !== "continue" && provenance.source === "ai"
        ? "task_ai_reported"
        : "task_work_recorded";
    const event = annotateEvent(
      command,
      commandEvent(
        command,
        "task",
        taskId,
        "updated",
        current,
        nextTask,
        eventKind,
        { type: "work_receipt", id: receipt.id },
        provenance.source,
      ),
    );
    event.metadata = {
      ...((event.metadata as Record<string, unknown>) || {}),
      include_in_activity: true,
      work_action:
        outcome === "continue" ? "appended" : outcome === "blocked" ? "blocked" : "reported",
      executor_kind: receipt.executor_kind,
      executor_label: workExecutorLabel(nextTask, receipt),
      provenance: provenance.metadata,
    };
    const operations: SaveOperation[] = [
      { action: "save", type: "task", entity: nextTask },
      { action: "save", type: "work_receipt", entity: receipt },
      { action: "save", type: "change_event", entity: event },
    ];
    return persistReceipt(
      this.repository,
      command,
      operations,
      [event.id],
      ["task", "work_receipt"],
    );
  }

  private acceptTaskWork(command: CommandEnvelope): CommandReceipt {
    assertHumanReviewActor(command, "AcceptTaskWork");
    const payload = command.payload as {
      taskId: string;
      receiptId?: string | null;
      completeTask?: boolean;
    };
    const taskId = asTaskId(payload);
    const current = this.repository.get("task", taskId);
    if (!current)
      throw new ApplicationCommandError("NOT_FOUND", "確認対象のTaskがありません。", {
        id: taskId,
      });
    if (!expectedVersionFor(command, "task", taskId))
      throw new ApplicationCommandError(
        "CONFLICT",
        "AcceptTaskWorkにはexpected versionが必要です。",
        { type: "task", id: taskId },
      );
    assertExpectedVersion(this.repository, command, "task", taskId, current);
    if (currentWorkState(current) === "accepted")
      return persistNoChange(this.repository, command, taskId, current);
    if (!["reported_done", "needs_human_review"].includes(currentWorkState(current)))
      throw new ApplicationCommandError(
        "INVALID_TRANSITION",
        "確認待ちのTaskだけをAcceptできます。",
        { id: taskId, work_state: currentWorkState(current) },
      );
    const receipt = latestWorkReceipt(this.repository, taskId);
    if (!receipt)
      throw new ApplicationCommandError("NOT_FOUND", "確認対象のWork Receiptがありません。", {
        id: taskId,
      });
    if (payload.receiptId && receipt.id !== payload.receiptId) {
      throw new ApplicationCommandError(
        "CONFLICT",
        "Work Receiptが更新されています。最新の内容を確認し直してください。",
        {
          id: taskId,
          expected_receipt_id: payload.receiptId,
          current_receipt_id: receipt.id,
        },
      );
    }
    const nextTask: Entity = {
      ...current,
      work_state: "accepted",
      work_review_note: null,
      ...(payload.completeTask ? { state: "done", completed_at: command.issuedAt } : {}),
    };
    taskDefinition.parseUpdate(nextTask);
    assertThemeExists(this.repository, nextTask);
    const eventKind =
      current.intended_executor === "ai_agent" || receipt.executor_kind === "ai_agent"
        ? "task_ai_accepted"
        : "task_work_recorded";
    const event = annotateEvent(
      command,
      commandEvent(
        command,
        "task",
        taskId,
        payload.completeTask ? "completed" : "updated",
        current,
        nextTask,
        eventKind,
        { type: "work_receipt", id: receipt.id },
      ),
    );
    event.metadata = {
      ...((event.metadata as Record<string, unknown>) || {}),
      include_in_activity: true,
      work_action: "accepted",
      task_completed: payload.completeTask === true,
      executor_label: workExecutorLabel(nextTask, receipt),
    };
    return persistReceipt(
      this.repository,
      command,
      [
        { action: "save", type: "task", entity: nextTask },
        { action: "save", type: "change_event", entity: event },
      ],
      [event.id],
      ["task"],
    );
  }

  private returnTaskWork(command: CommandEnvelope): CommandReceipt {
    assertHumanReviewActor(command, "ReturnTaskWork");
    const payload = command.payload as {
      taskId: string;
      receiptId?: string | null;
      reviewNote?: string | null;
    };
    const taskId = asTaskId(payload);
    const current = this.repository.get("task", taskId);
    if (!current)
      throw new ApplicationCommandError("NOT_FOUND", "差戻し対象のTaskがありません。", {
        id: taskId,
      });
    if (!expectedVersionFor(command, "task", taskId))
      throw new ApplicationCommandError(
        "CONFLICT",
        "ReturnTaskWorkにはexpected versionが必要です。",
        { type: "task", id: taskId },
      );
    assertExpectedVersion(this.repository, command, "task", taskId, current);
    if (!["reported_done", "needs_human_review", "blocked"].includes(currentWorkState(current)))
      throw new ApplicationCommandError(
        "INVALID_TRANSITION",
        "確認待ちまたは停止中のTaskだけへ返信できます。",
        { id: taskId, work_state: currentWorkState(current) },
      );
    const reviewNote = typeof payload.reviewNote === "string" ? payload.reviewNote.trim() : "";
    if (!reviewNote || reviewNote.length > 2000)
      throw new ApplicationCommandError(
        "INVALID_PAYLOAD",
        "差戻し理由を1〜2000文字で入力してください。",
      );
    const receipt = latestWorkReceipt(this.repository, taskId);
    if (!receipt)
      throw new ApplicationCommandError("NOT_FOUND", "差戻し対象のWork Receiptがありません。", {
        id: taskId,
      });
    if (payload.receiptId && receipt.id !== payload.receiptId) {
      throw new ApplicationCommandError(
        "CONFLICT",
        "Work Receiptが更新されています。最新の内容を確認し直してください。",
        {
          id: taskId,
          expected_receipt_id: payload.receiptId,
          current_receipt_id: receipt.id,
        },
      );
    }
    const nextTask: Entity = {
      ...current,
      work_state: current.intended_executor === "ai_agent" ? "ready_for_agent" : "not_delegated",
      work_started_at: null,
      work_reported_at: null,
      work_review_note: reviewNote,
    };
    taskDefinition.parseUpdate(nextTask);
    assertThemeExists(this.repository, nextTask);
    const eventKind =
      current.intended_executor === "ai_agent" || receipt.executor_kind === "ai_agent"
        ? "task_ai_returned"
        : "task_work_recorded";
    const event = annotateEvent(
      command,
      commandEvent(command, "task", taskId, "updated", current, nextTask, eventKind, {
        type: "work_receipt",
        id: receipt.id,
      }),
    );
    event.metadata = {
      ...((event.metadata as Record<string, unknown>) || {}),
      include_in_activity: true,
      work_action: "returned",
      review_note: reviewNote,
      executor_label: workExecutorLabel(nextTask, receipt),
    };
    return persistReceipt(
      this.repository,
      command,
      [
        { action: "save", type: "task", entity: nextTask },
        { action: "save", type: "change_event", entity: event },
      ],
      [event.id],
      ["task"],
    );
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
    if (!current)
      throw new ApplicationCommandError("NOT_FOUND", "完了対象のTaskがありません。", {
        id: inputTask.id,
      });
    if (!expectedVersionFor(command, "task", inputTask.id)) {
      throw new ApplicationCommandError(
        "CONFLICT",
        "CompleteTaskWithLearningにはexpected versionが必要です。",
        { type: "task", id: inputTask.id },
      );
    }
    assertExpectedVersion(this.repository, command, "task", inputTask.id, current);
    if (current.state === "cancelled" || current.state === "done") {
      throw new ApplicationCommandError(
        "INVALID_TRANSITION",
        "キャンセル済みまたは完了済みTaskは学び付き完了できません。",
        { id: inputTask.id },
      );
    }
    assertHumanAcceptBeforeCompletion(current);
    const completedAt =
      typeof inputTask.completed_at === "string" && inputTask.completed_at.trim()
        ? inputTask.completed_at
        : command.issuedAt;
    const completedTask = normalizeCanonicalEntity("task", {
      ...current,
      ...inputTask,
      id: inputTask.id,
      state: "done",
      completed_at: completedAt,
    });
    taskDefinition.parseUpdate(completedTask);
    assertThemeExists(this.repository, completedTask);

    const note = normalizeCanonicalNote(
      {
        ...payload.note,
        project_id: payload.note.project_id ?? completedTask.project_id,
        item_id: inputTask.id,
        note_type: payload.note.note_type || "learning",
      },
      completedTask.project_id as string,
    );
    if (this.repository.get("note", note.id, true)) {
      throw new ApplicationCommandError("CONFLICT", "学びNoteのIDを再利用できません。", {
        id: note.id,
      });
    }
    entityDefinition("note").parseCreate(note);

    const operations: SaveOperation[] = [{ action: "save", type: "task", entity: completedTask }];
    const eventIds: string[] = [];
    const taskEvent = annotateEvent(
      command,
      commandEvent(command, "task", completedTask.id, "completed", current, completedTask),
    );
    operations.push({ action: "save", type: "change_event", entity: taskEvent });
    eventIds.push(taskEvent.id);
    operations.push({ action: "save", type: "note", entity: note });
    const noteEvent = annotateEvent(
      command,
      commandEvent(command, "note", note.id, "created", null, note),
    );
    operations.push({ action: "save", type: "change_event", entity: noteEvent });
    eventIds.push(noteEvent.id);

    if (payload.nextTask) {
      const nextTask = normalizeCanonicalEntity(
        "task",
        payload.nextTask,
        completedTask.project_id as string,
      );
      if (this.repository.get("task", nextTask.id, true)) {
        throw new ApplicationCommandError("CONFLICT", "繰返しTaskのIDを再利用できません。", {
          id: nextTask.id,
        });
      }
      if (
        nextTask.parent_task_id !== completedTask.id &&
        nextTask.repeat_parent_task_id !== completedTask.id
      ) {
        throw new ApplicationCommandError(
          "INVALID_PAYLOAD",
          "繰返しTaskは完了したTaskを親にする必要があります。",
          { id: nextTask.id },
        );
      }
      taskDefinition.parseCreate(nextTask);
      assertThemeExists(this.repository, nextTask);
      operations.push({ action: "save", type: "task", entity: nextTask });
      const nextEvent = annotateEvent(
        command,
        commandEvent(command, "task", nextTask.id, "created", null, nextTask),
      );
      operations.push({ action: "save", type: "change_event", entity: nextEvent });
      eventIds.push(nextEvent.id);
      if (payload.nextSchedule) {
        const nextSchedule = validateScheduleWrite(
          this.repository,
          command,
          payload.nextSchedule,
          nextTask.id,
          true,
        );
        if (!nextSchedule)
          throw new ApplicationCommandError("INVALID_PAYLOAD", "繰返しTaskのScheduleが不正です。");
        operations.push({ action: "save", type: "schedule", entity: nextSchedule });
        const scheduleEvent = annotateEvent(
          command,
          commandEvent(command, "schedule", nextTask.id, "rescheduled", null, nextSchedule),
        );
        operations.push({ action: "save", type: "change_event", entity: scheduleEvent });
        eventIds.push(scheduleEvent.id);
      }
    } else if (payload.nextSchedule) {
      throw new ApplicationCommandError("INVALID_PAYLOAD", "nextScheduleにはnextTaskが必要です。");
    }
    return persistReceipt(this.repository, command, operations, eventIds, [
      "task",
      "note",
      "schedule",
    ]);
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
    if (!currentSession)
      throw new ApplicationCommandError("NOT_FOUND", "Focus Sessionがありません。", {
        id: payload.session.id,
      });
    if (!expectedVersionFor(command, "note", payload.session.id)) {
      throw new ApplicationCommandError(
        "CONFLICT",
        "EndFocusSessionにはSessionのexpected versionが必要です。",
        { type: "note", id: payload.session.id },
      );
    }
    assertExpectedVersion(this.repository, command, "note", payload.session.id, currentSession);
    const sessionProps =
      payload.session.properties_json && typeof payload.session.properties_json === "object"
        ? (payload.session.properties_json as Record<string, unknown>)
        : {};
    const taskId =
      typeof payload.task?.id === "string"
        ? payload.task.id
        : typeof sessionProps.task_id === "string"
          ? sessionProps.task_id
          : "";
    if (!taskId)
      throw new ApplicationCommandError("INVALID_PAYLOAD", "Focus SessionのTask IDがありません。");
    const currentTask = this.repository.get("task", taskId);
    if (!currentTask)
      throw new ApplicationCommandError("NOT_FOUND", "Focus SessionのTaskがありません。", {
        id: taskId,
      });

    const nextSessionProps =
      payload.session.properties_json && typeof payload.session.properties_json === "object"
        ? (payload.session.properties_json as Record<string, unknown>)
        : {};
    if (nextSessionProps.session_state !== "ended") {
      throw new ApplicationCommandError(
        "INVALID_TRANSITION",
        "Focus Sessionはended状態へ遷移する必要があります。",
      );
    }
    const endedAt =
      typeof nextSessionProps.ended_at === "string" && nextSessionProps.ended_at.trim()
        ? nextSessionProps.ended_at
        : command.issuedAt;
    const session: Entity = normalizeCanonicalNote(
      {
        ...payload.session,
        properties_json: { ...nextSessionProps, ended_at: endedAt },
      },
      currentTask.project_id as string,
    );
    entityDefinition("note").parseUpdate(session);
    const operations: SaveOperation[] = [{ action: "save", type: "note", entity: session }];
    const eventIds: string[] = [];
    const sessionEvent = annotateEvent(
      command,
      commandEvent(command, "note", session.id, "updated", currentSession, session),
    );
    operations.push({ action: "save", type: "change_event", entity: sessionEvent });
    eventIds.push(sessionEvent.id);

    if (payload.selectedNote) {
      const currentNote = this.repository.get("note", payload.selectedNote.id);
      if (!currentNote)
        throw new ApplicationCommandError("NOT_FOUND", "Focus Sessionの選択Noteがありません。", {
          id: payload.selectedNote.id,
        });
      assertExpectedVersion(this.repository, command, "note", currentNote.id, currentNote);
      const selectedNote = normalizeCanonicalNote(
        payload.selectedNote,
        currentTask.project_id as string,
      );
      entityDefinition("note").parseUpdate(selectedNote);
      operations.push({ action: "save", type: "note", entity: selectedNote });
      const selectedEvent = annotateEvent(
        command,
        commandEvent(command, "note", selectedNote.id, "updated", currentNote, selectedNote),
      );
      operations.push({ action: "save", type: "change_event", entity: selectedEvent });
      eventIds.push(selectedEvent.id);
    }

    if (payload.completeTask) {
      if (!expectedVersionFor(command, "task", taskId)) {
        throw new ApplicationCommandError(
          "CONFLICT",
          "完了するTaskにはexpected versionが必要です。",
          { type: "task", id: taskId },
        );
      }
      assertExpectedVersion(this.repository, command, "task", taskId, currentTask);
      if (currentTask.state === "cancelled" || currentTask.state === "done") {
        throw new ApplicationCommandError(
          "INVALID_TRANSITION",
          "キャンセル済みまたは完了済みTaskはFocus終了で完了できません。",
          { id: taskId },
        );
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
      const taskEvent = annotateEvent(
        command,
        commandEvent(command, "task", taskId, "completed", currentTask, task),
      );
      operations.push({ action: "save", type: "change_event", entity: taskEvent });
      eventIds.push(taskEvent.id);
    }

    if (payload.promotedNote) {
      const promotedNote = normalizeCanonicalNote(
        payload.promotedNote,
        currentTask.project_id as string,
      );
      if (this.repository.get("note", promotedNote.id, true))
        throw new ApplicationCommandError("CONFLICT", "Promoted NoteのIDを再利用できません。", {
          id: promotedNote.id,
        });
      entityDefinition("note").parseCreate(promotedNote);
      operations.push({ action: "save", type: "note", entity: promotedNote });
      const promotedEvent = annotateEvent(
        command,
        commandEvent(command, "note", promotedNote.id, "created", null, promotedNote),
      );
      operations.push({ action: "save", type: "change_event", entity: promotedEvent });
      eventIds.push(promotedEvent.id);
    }
    if (payload.promotedReference) {
      const reference = payload.promotedReference;
      referenceDefinition.parseCreate(reference);
      if (
        reference.source_type !== "note" ||
        reference.target_type !== "task" ||
        reference.target_id !== taskId ||
        !payload.promotedNote ||
        reference.source_id !== payload.promotedNote.id ||
        reference.relation_type !== "related_to"
      ) {
        throw new ApplicationCommandError(
          "INVALID_PAYLOAD",
          "Focus SessionのPromoted ReferenceがNote↔Task契約に一致しません。",
          { id: reference.id },
        );
      }
      if (this.repository.get("reference", reference.id, true))
        throw new ApplicationCommandError(
          "CONFLICT",
          "Promoted ReferenceのIDを再利用できません。",
          { id: reference.id },
        );
      operations.push({ action: "save", type: "reference", entity: reference });
      const referenceEvent = annotateEvent(
        command,
        commandEvent(command, "reference", reference.id, "created", null, reference),
      );
      operations.push({ action: "save", type: "change_event", entity: referenceEvent });
      eventIds.push(referenceEvent.id);
    }
    if (payload.nextTask) {
      const nextTask = normalizeCanonicalEntity(
        "task",
        payload.nextTask,
        currentTask.project_id as string,
      );
      if (this.repository.get("task", nextTask.id, true))
        throw new ApplicationCommandError(
          "CONFLICT",
          "Focus Sessionの次Task IDを再利用できません。",
          { id: nextTask.id },
        );
      if (nextTask.parent_task_id !== taskId)
        throw new ApplicationCommandError(
          "INVALID_PAYLOAD",
          "Focus Sessionの次Taskは現在Taskを親にする必要があります。",
          { id: nextTask.id },
        );
      taskDefinition.parseCreate(nextTask);
      assertThemeExists(this.repository, nextTask);
      operations.push({ action: "save", type: "task", entity: nextTask });
      const nextEvent = annotateEvent(
        command,
        commandEvent(command, "task", nextTask.id, "created", null, nextTask),
      );
      operations.push({ action: "save", type: "change_event", entity: nextEvent });
      eventIds.push(nextEvent.id);
    }
    if (payload.statusUpdate) {
      const statusUpdate = payload.statusUpdate;
      if (this.repository.get("status_update", statusUpdate.id, true))
        throw new ApplicationCommandError("CONFLICT", "Status UpdateのIDを再利用できません。", {
          id: statusUpdate.id,
        });
      entityDefinition("status_update").parseCreate(statusUpdate);
      const themeId = statusUpdate.theme_id;
      if (typeof themeId !== "string" || !this.repository.get("theme", themeId))
        throw new ApplicationCommandError(
          "INVALID_PAYLOAD",
          "Status UpdateのThemeが存在しません。",
          { themeId },
        );
      operations.push({ action: "save", type: "status_update", entity: statusUpdate });
      const statusEvent = annotateEvent(
        command,
        commandEvent(command, "status_update", statusUpdate.id, "created", null, statusUpdate),
      );
      operations.push({ action: "save", type: "change_event", entity: statusEvent });
      eventIds.push(statusEvent.id);
    }
    return persistReceipt(this.repository, command, operations, eventIds, [
      "note",
      "task",
      "reference",
      "status_update",
    ]);
  }

  private applyAiProposal(command: CommandEnvelope): CommandReceipt {
    const payload = command.payload as {
      proposal: Entity;
      candidates: Array<{ type: EntityType; entity: Entity }>;
    };
    const currentProposal = this.repository.get("ai_proposal", payload.proposal.id);
    if (!currentProposal)
      throw new ApplicationCommandError("NOT_FOUND", "AI Proposalがありません。", {
        id: payload.proposal.id,
      });
    if (!expectedVersionFor(command, "ai_proposal", currentProposal.id)) {
      throw new ApplicationCommandError(
        "CONFLICT",
        "ApplyAiProposalにはProposalのexpected versionが必要です。",
        { type: "ai_proposal", id: currentProposal.id },
      );
    }
    assertExpectedVersion(
      this.repository,
      command,
      "ai_proposal",
      currentProposal.id,
      currentProposal,
    );
    if (currentProposal.status !== "pending")
      throw new ApplicationCommandError(
        "INVALID_TRANSITION",
        "Pending以外のProposalは採用できません。",
        { id: currentProposal.id },
      );
    const proposal = payload.proposal;
    if (!["accepted", "partially_accepted", "rejected"].includes(String(proposal.status))) {
      throw new ApplicationCommandError("INVALID_PAYLOAD", "Proposalの採用状態が不正です。");
    }
    entityDefinition("ai_proposal").parseUpdate(proposal);
    const operations: SaveOperation[] = [];
    const eventIds: string[] = [];
    const seen = new Set<string>();
    const capturedAgentSessionIds = new Set(
      currentProposal.payload_type === "agent_sessions" &&
        currentProposal.payload &&
        typeof currentProposal.payload === "object" &&
        !Array.isArray(currentProposal.payload) &&
        Array.isArray((currentProposal.payload as { agent_sessions?: unknown[] }).agent_sessions)
        ? (currentProposal.payload as { agent_sessions: unknown[] }).agent_sessions.flatMap(
            (entry) => {
              if (!entry || typeof entry !== "object" || Array.isArray(entry)) return [];
              const record = entry as { action?: unknown; session?: unknown };
              if (
                record.action !== "capture" ||
                !record.session ||
                typeof record.session !== "object" ||
                Array.isArray(record.session)
              )
                return [];
              const id = (record.session as { id?: unknown }).id;
              return typeof id === "string" ? [id] : [];
            },
          )
        : [],
    );
    for (const candidate of payload.candidates) {
      const type = candidate.type;
      let candidateEntity = candidate.entity;
      if (type === "artifact") {
        rejectGenericAudioArtifact(candidateEntity, "AI Proposal採用");
        rejectGenericVideoArtifact(candidateEntity, "AI Proposal採用");
      }
      if (type === "repository_context") {
        try {
          candidateEntity = normalizeRepositoryContext(candidate.entity) as Entity;
        } catch (error) {
          throw new ApplicationCommandError(
            "INVALID_PAYLOAD",
            `RepositoryContext候補が不正です: ${error instanceof Error ? error.message : String(error)}`,
          );
        }
      }
      if (type === "agent_session") {
        try {
          candidateEntity = normalizeAgentSession(candidate.entity) as Entity;
        } catch (error) {
          throw new ApplicationCommandError(
            "INVALID_PAYLOAD",
            `Agent Session candidate が不正です: ${error instanceof Error ? error.message : String(error)}`,
          );
        }
      }
      if (type === "schedule") {
        const schedule = candidateEntity;
        if (
          schedule.owner_type !== "task" &&
          schedule.owner_type !== "waiting" &&
          schedule.owner_type !== "plan_node"
        ) {
          throw new ApplicationCommandError(
            "INVALID_PAYLOAD",
            "AI ProposalのSchedule ownerが不正です。",
            { id: schedule.id },
          );
        }
      }
      const key = `${type}:${candidateEntity.id}`;
      if (seen.has(key))
        throw new ApplicationCommandError(
          "INVALID_PAYLOAD",
          "AI Proposal candidateが重複しています。",
          { key },
        );
      seen.add(key);
      const before = this.repository.get(type, candidateEntity.id, true);
      if (before?.deleted_at)
        throw new ApplicationCommandError(
          "CONFLICT",
          "削除済みEntityをAI Proposalから更新できません。",
          { type, id: candidateEntity.id },
        );
      if (before) {
        if (!expectedVersionFor(command, type, candidateEntity.id))
          throw new ApplicationCommandError(
            "CONFLICT",
            "既存candidateにはexpected versionが必要です。",
            { type, id: candidateEntity.id },
          );
        assertExpectedVersion(this.repository, command, type, candidateEntity.id, before);
      }
      if (type === "agent_session") {
        if (!before) {
          const isCapturedTerminalRecord = capturedAgentSessionIds.has(candidateEntity.id);
          if (isCapturedTerminalRecord) {
            if (
              !["completed", "blocked", "abandoned"].includes(String(candidateEntity.status)) ||
              !candidateEntity.ended_at ||
              !candidateEntity.outcome
            ) {
              throw new ApplicationCommandError(
                "INVALID_TRANSITION",
                "Captureする Agent Session は完結した終端記録にしてください。",
                { id: candidateEntity.id },
              );
            }
          } else if (
            candidateEntity.status !== "active" ||
            candidateEntity.ended_at ||
            candidateEntity.outcome
          ) {
            throw new ApplicationCommandError(
              "INVALID_TRANSITION",
              "新しい Agent Session は active で開始してください。",
              { id: candidateEntity.id },
            );
          }
        }
        if (before) {
          for (const field of [
            "started_at",
            "client_kind",
            "client_label",
            "agent_label",
            "provider_label",
            "model_label",
            "source_session_id",
            "intent",
          ] as const) {
            if (
              JSON.stringify(before[field] ?? null) !==
              JSON.stringify(candidateEntity[field] ?? null)
            ) {
              throw new ApplicationCommandError(
                "INVALID_TRANSITION",
                `Agent Session の ${field} は終了時に変更できません。`,
                { id: candidateEntity.id },
              );
            }
          }
          if (
            before.status !== "active" ||
            !["completed", "blocked", "abandoned"].includes(String(candidateEntity.status))
          ) {
            throw new ApplicationCommandError(
              "INVALID_TRANSITION",
              "Agent Session は active から終端状態へのみ更新できます。",
              { id: candidateEntity.id },
            );
          }
        }
      }
      if (type === "reference") {
        referenceDefinition.parseCreate(candidateEntity);
        if (
          !referenceTargetEntityTypes.includes(candidateEntity.source_type as never) ||
          !referenceTargetEntityTypes.includes(candidateEntity.target_type as never) ||
          !referenceRelationTypes.includes(candidateEntity.relation_type as never)
        ) {
          throw new ApplicationCommandError(
            "INVALID_PAYLOAD",
            "Agent Session Reference の型または関係が不正です。",
            { id: candidateEntity.id },
          );
        }
        for (const [side, entityType, entityId] of [
          ["source", candidateEntity.source_type, candidateEntity.source_id],
          ["target", candidateEntity.target_type, candidateEntity.target_id],
        ] as const) {
          const relatedCandidate = payload.candidates.find(
            (entry) => entry.type === entityType && entry.entity.id === entityId,
          )?.entity;
          if (
            !relatedCandidate &&
            !this.repository.get(entityType as EntityType, String(entityId))
          ) {
            throw new ApplicationCommandError(
              "NOT_FOUND",
              `Agent Session Reference の ${side} が存在しません。`,
              { type: entityType, id: entityId },
            );
          }
        }
      }
      if (type === "schedule") {
        const ownerType = String(candidateEntity.owner_type) as EntityType;
        const ownerId = String(candidateEntity.owner_id || "");
        const ownerCandidate = payload.candidates.find(
          (entry) => entry.type === ownerType && entry.entity.id === ownerId,
        );
        const owner = ownerCandidate?.entity || this.repository.get(ownerType, ownerId);
        if (!owner || owner.deleted_at) {
          throw new ApplicationCommandError(
            "NOT_FOUND",
            "AI ProposalのSchedule ownerが存在しません。",
            { type: ownerType, id: ownerId },
          );
        }
      }
      if (type === "knowledge_edge") {
        const sourceId = String(candidateEntity.source_node_id || "");
        const targetId = String(candidateEntity.target_node_id || "");
        const source =
          payload.candidates.find(
            (entry) => entry.type === "knowledge_node" && entry.entity.id === sourceId,
          )?.entity || this.repository.get("knowledge_node", sourceId);
        const target =
          payload.candidates.find(
            (entry) => entry.type === "knowledge_node" && entry.entity.id === targetId,
          )?.entity || this.repository.get("knowledge_node", targetId);
        if (!source || source.deleted_at || !target || target.deleted_at || sourceId === targetId) {
          throw new ApplicationCommandError(
            "INVALID_PAYLOAD",
            "AI ProposalのKnowledge Edge両端が存在しないか不正です。",
            { id: candidateEntity.id },
          );
        }
        if (
          ![
            "supports",
            "contradicts",
            "explains",
            "causes",
            "example_of",
            "generalizes",
            "depends_on",
            "derived_from",
            "answers",
            "raises",
            "similar_to",
            "leads_to",
          ].includes(String(candidateEntity.relation_type))
        ) {
          throw new ApplicationCommandError(
            "INVALID_PAYLOAD",
            "AI ProposalのKnowledge Edge relationが不正です.",
            { id: candidateEntity.id },
          );
        }
      }
      if (type === "task") {
        const task = normalizeTaskForSave(
          normalizeCanonicalEntity(type, candidateEntity),
          before || undefined,
        );
        if (
          task.work_state === "accepted" &&
          (!before || currentWorkState(before) !== "accepted")
        ) {
          throw new ApplicationCommandError(
            "INVALID_TRANSITION",
            "Work stateの受入れはAcceptTaskWorkを使用してください。",
            { id: task.id },
          );
        }
        if (
          before &&
          before.intended_executor === task.intended_executor &&
          Object.prototype.hasOwnProperty.call(candidateEntity, "work_state") &&
          currentWorkState(before) !== currentWorkState(task)
        ) {
          throw new ApplicationCommandError(
            "INVALID_TRANSITION",
            "Work stateの変更はStart/Report/Accept/Return Commandを使用してください。",
            { id: task.id },
          );
        }
        if (task.state === "done") assertHumanAcceptBeforeCompletion(task);
        taskDefinition[before ? "parseUpdate" : "parseCreate"](task);
        assertThemeExists(this.repository, task);
        operations.push({ action: "save", type, entity: task });
        const event = annotateEvent(
          command,
          commandEvent(
            command,
            type,
            task.id,
            changeType(before, task, command.name),
            before,
            task,
          ),
        );
        operations.push({ action: "save", type: "change_event", entity: event });
        eventIds.push(event.id);
      } else {
        const entity = candidateEntity;
        if (before) entityDefinition(type).parseUpdate(entity);
        else entityDefinition(type).parseCreate(entity);
        operations.push({ action: "save", type, entity });
        const event = annotateEvent(
          command,
          commandEvent(command, type, entity.id, before ? "updated" : "created", before, entity),
        );
        operations.push({ action: "save", type: "change_event", entity: event });
        eventIds.push(event.id);
      }
    }
    operations.push({ action: "save", type: "ai_proposal", entity: proposal });
    const proposalEvent = annotateEvent(
      command,
      commandEvent(command, "ai_proposal", proposal.id, "updated", currentProposal, proposal),
    );
    operations.push({ action: "save", type: "change_event", entity: proposalEvent });
    eventIds.push(proposalEvent.id);
    return persistReceipt(this.repository, command, operations, eventIds, [
      ...new Set([...payload.candidates.map((candidate) => candidate.type), "ai_proposal"]),
    ] as EntityType[]);
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
      throw new ApplicationCommandError(
        "INVALID_ENVELOPE",
        "CreateTaskFromCaptureはInbox経路専用です。",
      );
    }
    const inputTask = asTask(payload);
    const currentTask = this.repository.get("task", inputTask.id, true);
    if (currentTask) {
      throw new ApplicationCommandError("CONFLICT", "同じTask IDが既に存在します。", {
        type: "task",
        id: inputTask.id,
      });
    }
    const capture = this.repository.get("capture_entry", payload.captureId);
    if (!capture)
      throw new ApplicationCommandError("NOT_FOUND", "整理対象のCaptureがありません。", {
        id: payload.captureId,
      });
    if (capture.state !== "untriaged") {
      throw new ApplicationCommandError("INVALID_TRANSITION", "このCaptureはすでに整理済みです。", {
        id: payload.captureId,
        state: capture.state,
      });
    }
    if (Number(capture.version || 0) !== payload.captureVersion) {
      throw new ApplicationCommandError(
        "CONFLICT",
        "Captureが更新済みです。Inboxを再読み込みしてから再試行してください。",
        {
          type: "capture_entry",
          id: payload.captureId,
          expected: payload.captureVersion,
          actual: Number(capture.version || 0),
        },
      );
    }
    const expectedCapture = expectedVersionFor(command, "capture_entry", payload.captureId);
    if (!expectedCapture || expectedCapture.version !== payload.captureVersion) {
      throw new ApplicationCommandError("CONFLICT", "Captureのexpected versionが必要です。", {
        type: "capture_entry",
        id: payload.captureId,
      });
    }

    const task: Entity = {
      ...inputTask,
      project_id: canonicalThemeId(inputTask.project_id, { defaultPersonal: true }),
    };
    if (task.state === "done") assertHumanAcceptBeforeCompletion(task);
    taskDefinition.parseCreate(task);
    assertThemeExists(this.repository, task);
    const schedule = validateScheduleWrite(
      this.repository,
      command,
      payload.schedule,
      task.id,
      true,
    );
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
      if (seenArtifactIds.has(artifactId))
        throw new ApplicationCommandError("INVALID_PAYLOAD", "artifactIdsに重複があります。", {
          artifactId,
        });
      seenArtifactIds.add(artifactId);
      const artifact = this.repository.get("artifact", artifactId);
      if (!artifact)
        throw new ApplicationCommandError("NOT_FOUND", "Captureに紐づくArtifactがありません。", {
          id: artifactId,
        });
      if (artifact.source_type !== "capture_entry" || artifact.source_id !== payload.captureId) {
        throw new ApplicationCommandError(
          "CONFLICT",
          "Captureに紐づかないArtifactは移管できません。",
          { id: artifactId },
        );
      }
      const expectedArtifact = expectedVersionFor(command, "artifact", artifactId);
      if (!expectedArtifact)
        throw new ApplicationCommandError(
          "CONFLICT",
          "移管するArtifactにはexpected versionが必要です。",
          { type: "artifact", id: artifactId },
        );
      assertExpectedVersion(this.repository, command, "artifact", artifactId, artifact);
      const isMediaArtifact = artifact.media_kind === "audio" || artifact.media_kind === "video";
      const artifactWithoutLegacyTheme = { ...artifact };
      if (!isMediaArtifact) delete artifactWithoutLegacyTheme.theme_id;
      operations.push({
        action: "save",
        type: "artifact",
        entity: isMediaArtifact
          ? { ...artifactWithoutLegacyTheme, source_type: "task", source_id: task.id }
          : {
              ...artifactWithoutLegacyTheme,
              source_type: "task",
              source_id: task.id,
              project_id: task.project_id,
            },
      });
      changed.push("artifact");
    }

    const taskEvent = commandEvent(command, "task", task.id, "created", null, task);
    const captureEvent = commandEvent(
      command,
      "capture_entry",
      capture.id,
      "triaged",
      capture,
      triagedCapture,
    );
    for (const event of [taskEvent, captureEvent]) {
      event.command_source = command.source;
      event.actor_kind = command.actor.kind;
      event.actor_id = command.actor.id || null;
      event.command_fingerprint = commandFingerprint(command);
      operations.push({ action: "save", type: "change_event", entity: event });
      eventIds.push(event.id);
    }
    if (schedule) {
      const scheduleEvent = commandEvent(
        command,
        "schedule",
        task.id,
        "rescheduled",
        null,
        schedule,
      );
      scheduleEvent.command_source = command.source;
      scheduleEvent.actor_kind = command.actor.kind;
      scheduleEvent.actor_id = command.actor.id || null;
      scheduleEvent.command_fingerprint = commandFingerprint(command);
      operations.push({ action: "save", type: "change_event", entity: scheduleEvent });
      eventIds.push(scheduleEvent.id);
    }
    for (const artifactId of artifactIds) {
      const artifact = operations.find(
        (operation) => operation.type === "artifact" && operation.entity.id === artifactId,
      )?.entity;
      if (!artifact) continue;
      const before = this.repository.get("artifact", artifactId);
      const artifactEvent = commandEvent(
        command,
        "artifact",
        artifactId,
        "updated",
        before,
        artifact,
      );
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
