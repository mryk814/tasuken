import { entityTypes, type Entity, type EntityType } from "./types/workspace.ts";
import { normalizeExternalReferences } from "./externalReference.mjs";
import type { ExternalReference } from "./externalReference.mjs";

export const applicationCommandNames = [
  "CreateTask",
  "DeleteTask",
  "CreateCapture",
  "DeleteCapture",
  "CreateTaskFromCapture",
  "UpdateTask",
  "CompleteTask",
  "ReopenTask",
  "CompleteTaskWithLearning",
  "EndFocusSession",
  "ApplyAiProposal",
  "ApplyTaskWorkProposal",
  "StartTaskWork",
  "AppendWorkReceipt",
  "ReportTaskDone",
  "ReportTaskBlocked",
  "AcceptTaskWork",
  "ReturnTaskWork",
  "CommitAudioCapture",
  "CommitVideoArtifact",
  "CommitTrimmedVideoArtifact",
] as const;
export type ApplicationCommandName = (typeof applicationCommandNames)[number];

export type ApplicationCommandSource =
  | "main_ui"
  | "today_window"
  | "quick_capture"
  | "inbox"
  | "command_palette"
  | "tasken_root"
  | "mobile"
  | "mcp";
export const applicationCommandSources = [
  "main_ui",
  "today_window",
  "quick_capture",
  "inbox",
  "command_palette",
  "tasken_root",
  "mobile",
  "mcp",
] as const;

export interface CommandActor {
  kind: "user" | "system" | "ai_agent";
  id?: string;
}

export interface ExpectedVersion {
  type: EntityType;
  id: string;
  version: number;
}

export interface CreateTaskCommandPayload {
  task: Entity;
  schedule?: Entity | null;
  references?: Entity[];
  provenance?: Record<string, unknown>;
}

export interface CreateCaptureCommandPayload {
  capture: {
    id: string;
    text: string;
    project_id?: string | null;
    captured_at: string;
  };
  provenance?: Record<string, unknown>;
}

export interface DeleteCaptureCommandPayload {
  captureId: string;
}

export interface CreateTaskFromCaptureCommandPayload {
  task: Entity;
  schedule?: Entity | null;
  captureId: string;
  captureVersion: number;
  transition: "triage_to_task";
  artifactIds?: string[];
  references?: Entity[];
}

export interface UpdateTaskCommandPayload {
  task: Entity;
  schedule?: Entity | null;
  references?: Entity[];
}

export interface TaskIdCommandPayload {
  taskId: string;
  task?: Entity;
  completionNote?: string | null;
  schedule?: Entity | null;
  references?: Entity[];
}

export interface CompleteTaskWithLearningCommandPayload {
  task: Entity;
  note: Entity;
  nextTask?: Entity | null;
  nextSchedule?: Entity | null;
}

export interface EndFocusSessionCommandPayload {
  session: Entity;
  task?: Entity | null;
  selectedNote?: Entity | null;
  promotedNote?: Entity | null;
  promotedReference?: Entity | null;
  nextTask?: Entity | null;
  statusUpdate?: Entity | null;
  completeTask: boolean;
}

export interface ApplyAiProposalCommandPayload {
  proposal: Entity;
  decision?: "accept" | "reject";
  decisions?: Array<{
    entryIndex: number;
    type: Extract<EntityType, "note" | "knowledge_node" | "knowledge_edge" | "artifact" | "sketch">;
    action: "accept" | "ignore";
    acceptedHunks?: number[];
    beforeSignature?: string;
  }>;
  candidates: Array<{
    type: Extract<
      EntityType,
      | "task"
      | "note"
      | "waiting"
      | "plan_node"
      | "schedule"
      | "resource"
      | "knowledge_node"
      | "knowledge_edge"
      | "artifact"
      | "sketch"
      | "repository_context"
      | "agent_session"
      | "reference"
    >;
    entity: Entity;
  }>;
}

const MAX_AI_PROPOSAL_DECISIONS = 100;
const MAX_AI_PROPOSAL_ACCEPTED_HUNKS = 32_768;
const MAX_AI_PROPOSAL_HUNK_INDEX = 32_767;

export interface ApplyTaskWorkProposalCommandPayload {
  proposalId: string;
  decision: "accept" | "reject";
}

export interface StartTaskWorkCommandPayload {
  taskId: string;
  executorKind?: string;
  executorIdentity?: string | null;
  startedAt?: string | null;
  sourceSession?: string | null;
}

export interface AppendWorkReceiptCommandPayload {
  taskId: string;
  receipt: Entity & { external_references?: ExternalReference[] };
}

export interface TaskWorkReviewCommandPayload {
  taskId: string;
  reviewNote?: string | null;
}

export interface CommitAudioCaptureCommandPayload {
  capture: Entity;
  artifact: Entity;
}

export interface CommitVideoArtifactCommandPayload {
  artifact: Entity;
}

export interface CommitTrimmedVideoArtifactCommandPayload {
  artifact: Entity;
  reference: Entity;
}

export type ApplicationCommandPayload =
  | CreateTaskCommandPayload
  | CreateCaptureCommandPayload
  | DeleteCaptureCommandPayload
  | CreateTaskFromCaptureCommandPayload
  | UpdateTaskCommandPayload
  | TaskIdCommandPayload
  | CompleteTaskWithLearningCommandPayload
  | EndFocusSessionCommandPayload
  | ApplyAiProposalCommandPayload
  | ApplyTaskWorkProposalCommandPayload
  | StartTaskWorkCommandPayload
  | AppendWorkReceiptCommandPayload
  | TaskWorkReviewCommandPayload
  | CommitAudioCaptureCommandPayload
  | CommitVideoArtifactCommandPayload
  | CommitTrimmedVideoArtifactCommandPayload;

export interface CommandEnvelope<
  TPayload extends ApplicationCommandPayload = ApplicationCommandPayload,
> {
  commandId: string;
  name: ApplicationCommandName;
  payload: TPayload;
  actor: CommandActor;
  source: ApplicationCommandSource;
  windowId?: string;
  sessionId?: string;
  expectedVersions?: ExpectedVersion[];
  issuedAt: string;
}

export interface CommandEntityChange {
  type: EntityType;
  entity: Entity;
}

export interface CommandReceipt {
  commandId: string;
  name: ApplicationCommandName;
  status: "applied" | "no_change" | "conflict";
  saved: Array<{ type: EntityType; id: string; version: number }>;
  deleted: Array<{ type: EntityType; id: string }>;
  events: string[];
  warnings: string[];
  revisions: Array<{ type: EntityType; id: string; version: number }>;
  changes: CommandEntityChange[];
  /** Actual committed change_event rows, kept separate from domain entity deltas. */
  eventChanges?: CommandEntityChange[];
}

export type ApplicationCommandErrorCode =
  | "INVALID_ENVELOPE"
  | "INVALID_PAYLOAD"
  | "COMMAND_ID_REUSED"
  | "CONFLICT"
  | "NOT_FOUND"
  | "INVALID_TRANSITION";

export class ApplicationCommandError extends Error {
  readonly code: ApplicationCommandErrorCode;
  readonly details?: Record<string, unknown>;

  constructor(
    code: ApplicationCommandErrorCode,
    message: string,
    details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = "ApplicationCommandError";
    this.code = code;
    this.details = details;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function requireString(value: unknown, label: string): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new ApplicationCommandError("INVALID_ENVELOPE", `${label}が不正です。`);
  }
  return value;
}

function isReferenceRecord(value: unknown): value is Entity {
  return (
    isRecord(value) &&
    typeof value.id === "string" &&
    typeof value.source_type === "string" &&
    typeof value.source_id === "string" &&
    typeof value.target_type === "string" &&
    typeof value.target_id === "string" &&
    typeof value.relation_type === "string"
  );
}

export function parseCommandEnvelope(value: unknown): CommandEnvelope {
  if (!isRecord(value))
    throw new ApplicationCommandError("INVALID_ENVELOPE", "Command envelopeが不正です。");
  const name = value.name;
  if (
    typeof name !== "string" ||
    !applicationCommandNames.includes(name as ApplicationCommandName)
  ) {
    throw new ApplicationCommandError("INVALID_ENVELOPE", "Command名が不正です。");
  }
  const actor = value.actor;
  if (
    !isRecord(actor) ||
    (actor.kind !== "user" && actor.kind !== "system" && actor.kind !== "ai_agent")
  ) {
    throw new ApplicationCommandError("INVALID_ENVELOPE", "Command actorが不正です。");
  }
  const source = requireString(value.source, "Command source") as ApplicationCommandSource;
  if (!applicationCommandSources.includes(source))
    throw new ApplicationCommandError("INVALID_ENVELOPE", "Command sourceが不正です。");
  const expectedVersions = value.expectedVersions;
  if (
    expectedVersions !== undefined &&
    (!Array.isArray(expectedVersions) ||
      expectedVersions.some((item) => {
        if (!isRecord(item)) return true;
        return (
          typeof item.type !== "string" ||
          !entityTypes.includes(item.type as EntityType) ||
          typeof item.id !== "string" ||
          !Number.isInteger(item.version)
        );
      }))
  ) {
    throw new ApplicationCommandError("INVALID_ENVELOPE", "expectedVersionsが不正です。");
  }
  const expectedKeys = new Set<string>();
  for (const expected of (expectedVersions || []) as ExpectedVersion[]) {
    if (expected.version < 0)
      throw new ApplicationCommandError(
        "INVALID_ENVELOPE",
        "expected versionは0以上である必要があります。",
      );
    const key = `${expected.type}:${expected.id}`;
    if (expectedKeys.has(key))
      throw new ApplicationCommandError("INVALID_ENVELOPE", "expectedVersionsに重複があります。", {
        key,
      });
    expectedKeys.add(key);
  }
  if (!isRecord(value.payload))
    throw new ApplicationCommandError("INVALID_PAYLOAD", "Command payloadが不正です。");
  if (
    (name === "CreateTask" || name === "CreateTaskFromCapture" || name === "UpdateTask") &&
    (!isRecord(value.payload.task) || typeof value.payload.task.id !== "string")
  ) {
    throw new ApplicationCommandError("INVALID_PAYLOAD", `${name}のtask payloadが不正です。`);
  }
  if (
    name === "CreateCapture" &&
    (!isRecord(value.payload.capture) ||
      typeof value.payload.capture.id !== "string" ||
      !value.payload.capture.id.trim() ||
      typeof value.payload.capture.text !== "string" ||
      !value.payload.capture.text.trim() ||
      typeof value.payload.capture.captured_at !== "string" ||
      !value.payload.capture.captured_at.trim())
  ) {
    throw new ApplicationCommandError(
      "INVALID_PAYLOAD",
      "CreateCaptureのcapture payloadが不正です。",
    );
  }
  if (
    name === "DeleteCapture" &&
    (typeof value.payload.captureId !== "string" || !value.payload.captureId.trim())
  ) {
    throw new ApplicationCommandError("INVALID_PAYLOAD", "DeleteCaptureのcaptureIdが不正です。");
  }
  if (
    (name === "CompleteTask" || name === "ReopenTask" || name === "DeleteTask") &&
    (typeof value.payload.taskId !== "string" || !value.payload.taskId.trim())
  ) {
    throw new ApplicationCommandError("INVALID_PAYLOAD", `${name}のtaskIdが不正です。`);
  }
  if (
    [
      "StartTaskWork",
      "AppendWorkReceipt",
      "ReportTaskDone",
      "ReportTaskBlocked",
      "AcceptTaskWork",
      "ReturnTaskWork",
    ].includes(name) &&
    (typeof value.payload.taskId !== "string" || !value.payload.taskId.trim())
  ) {
    throw new ApplicationCommandError("INVALID_PAYLOAD", `${name}のtaskIdが不正です。`);
  }
  if (["AppendWorkReceipt", "ReportTaskDone", "ReportTaskBlocked"].includes(name)) {
    if (
      !isRecord(value.payload.receipt) ||
      typeof value.payload.receipt.id !== "string" ||
      !value.payload.receipt.id.trim()
    ) {
      throw new ApplicationCommandError("INVALID_PAYLOAD", `${name}のreceiptが不正です。`);
    }
    if (value.payload.receipt.external_references !== undefined) {
      try {
        normalizeExternalReferences(value.payload.receipt.external_references);
      } catch (error) {
        throw new ApplicationCommandError(
          "INVALID_PAYLOAD",
          `Work Receiptのexternal_referencesが不正です: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }
  }
  if (
    name === "ReturnTaskWork" &&
    value.payload.reviewNote !== undefined &&
    value.payload.reviewNote !== null &&
    typeof value.payload.reviewNote !== "string"
  ) {
    throw new ApplicationCommandError("INVALID_PAYLOAD", "ReturnTaskWorkのreviewNoteが不正です。");
  }
  if (name === "CompleteTaskWithLearning") {
    const required = ["task", "note"];
    for (const field of required) {
      const entity = value.payload[field];
      if (!isRecord(entity) || typeof entity.id !== "string" || !entity.id.trim()) {
        throw new ApplicationCommandError(
          "INVALID_PAYLOAD",
          `${name}の${field} payloadが不正です。`,
        );
      }
    }
    for (const field of ["nextTask", "nextSchedule"]) {
      const entity = value.payload[field];
      if (
        entity !== undefined &&
        entity !== null &&
        (!isRecord(entity) || typeof entity.id !== "string" || !entity.id.trim())
      ) {
        throw new ApplicationCommandError(
          "INVALID_PAYLOAD",
          `${name}の${field} payloadが不正です。`,
        );
      }
    }
  }
  if (name === "ApplyAiProposal") {
    if (
      !isRecord(value.payload.proposal) ||
      typeof value.payload.proposal.id !== "string" ||
      !value.payload.proposal.id.trim() ||
      !Array.isArray(value.payload.candidates)
    ) {
      throw new ApplicationCommandError("INVALID_PAYLOAD", "ApplyAiProposalのpayloadが不正です。");
    }
    for (const candidate of value.payload.candidates) {
      if (
        !isRecord(candidate) ||
        typeof candidate.type !== "string" ||
        !isRecord(candidate.entity) ||
        typeof candidate.entity.id !== "string" ||
        !candidate.entity.id.trim()
      ) {
        throw new ApplicationCommandError(
          "INVALID_PAYLOAD",
          "ApplyAiProposalのcandidateが不正です。",
        );
      }
      if (
        ![
          "task",
          "note",
          "waiting",
          "plan_node",
          "schedule",
          "resource",
          "knowledge_node",
          "knowledge_edge",
          "artifact",
          "sketch",
          "repository_context",
          "agent_session",
          "reference",
        ].includes(candidate.type)
      ) {
        throw new ApplicationCommandError(
          "INVALID_PAYLOAD",
          `ApplyAiProposalで未対応のcandidate typeです: ${candidate.type}`,
        );
      }
    }
    if (
      value.payload.decision !== undefined &&
      value.payload.decision !== "accept" &&
      value.payload.decision !== "reject"
    ) {
      throw new ApplicationCommandError("INVALID_PAYLOAD", "ApplyAiProposalのdecisionが不正です。");
    }
    if (value.payload.decisions !== undefined) {
      if (
        !Array.isArray(value.payload.decisions) ||
        value.payload.decisions.length > MAX_AI_PROPOSAL_DECISIONS
      ) {
        throw new ApplicationCommandError(
          "INVALID_PAYLOAD",
          "ApplyAiProposalのdecisionsが不正です。",
        );
      }
      for (const decision of value.payload.decisions) {
        const noteDecision = isRecord(decision) && decision.type === "note";
        const allowedKeys = noteDecision
          ? new Set(["entryIndex", "type", "action", "acceptedHunks", "beforeSignature"])
          : new Set(["entryIndex", "type", "action"]);
        const acceptedHunks = isRecord(decision) ? decision.acceptedHunks : undefined;
        const beforeSignature = isRecord(decision) ? decision.beforeSignature : undefined;
        if (
          !isRecord(decision) ||
          !Number.isInteger(decision.entryIndex) ||
          Number(decision.entryIndex) < 0 ||
          !["note", "knowledge_node", "knowledge_edge", "artifact", "sketch"].includes(
            String(decision.type),
          ) ||
          (decision.action !== "accept" && decision.action !== "ignore") ||
          Object.keys(decision).some((key) => !allowedKeys.has(key)) ||
          (acceptedHunks !== undefined &&
            (!Array.isArray(acceptedHunks) ||
              acceptedHunks.length > MAX_AI_PROPOSAL_ACCEPTED_HUNKS ||
              acceptedHunks.some(
                (index) =>
                  !Number.isInteger(index) ||
                  Number(index) < 0 ||
                  Number(index) > MAX_AI_PROPOSAL_HUNK_INDEX,
              ))) ||
          (beforeSignature !== undefined &&
            (typeof beforeSignature !== "string" ||
              beforeSignature.length > 79 ||
              !/^sha256:(0|[1-9]\d{0,6}):[a-f0-9]{64}$/.test(beforeSignature) ||
              Number(beforeSignature.slice(7, beforeSignature.indexOf(":", 7))) > 1_000_000)) ||
          (acceptedHunks === undefined) !== (beforeSignature === undefined)
        ) {
          throw new ApplicationCommandError(
            "INVALID_PAYLOAD",
            "ApplyAiProposalのentry decisionが不正です。",
          );
        }
      }
    }
  }
  if (name === "ApplyTaskWorkProposal") {
    if (
      typeof value.payload.proposalId !== "string" ||
      !value.payload.proposalId.trim() ||
      (value.payload.decision !== "accept" && value.payload.decision !== "reject")
    ) {
      throw new ApplicationCommandError(
        "INVALID_PAYLOAD",
        "ApplyTaskWorkProposalのpayloadが不正です。",
      );
    }
  }
  if (name === "EndFocusSession") {
    if (
      !isRecord(value.payload.session) ||
      typeof value.payload.session.id !== "string" ||
      !value.payload.session.id.trim() ||
      typeof value.payload.completeTask !== "boolean"
    ) {
      throw new ApplicationCommandError("INVALID_PAYLOAD", "EndFocusSessionのpayloadが不正です。");
    }
    for (const field of [
      "task",
      "selectedNote",
      "promotedNote",
      "promotedReference",
      "nextTask",
      "statusUpdate",
    ]) {
      const entity = value.payload[field];
      if (
        entity !== undefined &&
        entity !== null &&
        (!isRecord(entity) || typeof entity.id !== "string" || !entity.id.trim())
      ) {
        throw new ApplicationCommandError(
          "INVALID_PAYLOAD",
          `EndFocusSessionの${field} payloadが不正です。`,
        );
      }
    }
  }
  if (name === "CommitAudioCapture") {
    for (const field of ["capture", "artifact"] as const) {
      const entity = value.payload[field];
      if (!isRecord(entity) || typeof entity.id !== "string" || !entity.id.trim()) {
        throw new ApplicationCommandError(
          "INVALID_PAYLOAD",
          `CommitAudioCaptureの${field} payloadが不正です。`,
        );
      }
    }
  }
  if (name === "CommitVideoArtifact") {
    const artifact = value.payload.artifact;
    if (!isRecord(artifact) || typeof artifact.id !== "string" || !artifact.id.trim()) {
      throw new ApplicationCommandError(
        "INVALID_PAYLOAD",
        "CommitVideoArtifactのartifact payloadが不正です。",
      );
    }
  }
  if (name === "CommitTrimmedVideoArtifact") {
    for (const field of ["artifact", "reference"] as const) {
      const entity = value.payload[field];
      if (!isRecord(entity) || typeof entity.id !== "string" || !entity.id.trim()) {
        throw new ApplicationCommandError(
          "INVALID_PAYLOAD",
          `CommitTrimmedVideoArtifactの${field} payloadが不正です。`,
        );
      }
    }
  }
  if (
    (name === "CompleteTask" || name === "ReopenTask") &&
    value.payload.task !== undefined &&
    (!isRecord(value.payload.task) || value.payload.task.id !== value.payload.taskId)
  ) {
    throw new ApplicationCommandError("INVALID_PAYLOAD", `${name}のtask recordが不正です。`);
  }
  if (name === "CreateTaskFromCapture") {
    if (
      typeof value.payload.captureId !== "string" ||
      !value.payload.captureId.trim() ||
      typeof value.payload.captureVersion !== "number" ||
      !Number.isInteger(value.payload.captureVersion) ||
      value.payload.captureVersion < 0 ||
      value.payload.transition !== "triage_to_task" ||
      (value.payload.artifactIds !== undefined &&
        (!Array.isArray(value.payload.artifactIds) ||
          value.payload.artifactIds.some((id) => typeof id !== "string" || !id.trim())))
    ) {
      throw new ApplicationCommandError(
        "INVALID_PAYLOAD",
        "CreateTaskFromCaptureのcapture transitionが不正です。",
      );
    }
  }
  if (
    value.payload.references !== undefined &&
    (!Array.isArray(value.payload.references) ||
      value.payload.references.some((reference) => !isReferenceRecord(reference)))
  ) {
    throw new ApplicationCommandError("INVALID_PAYLOAD", `${name}のreferencesが不正です。`);
  }
  if (Object.prototype.hasOwnProperty.call(value.payload, "operations")) {
    throw new ApplicationCommandError(
      "INVALID_PAYLOAD",
      "汎用SaveOperationはCommand payloadへ渡せません。",
    );
  }
  return {
    commandId: requireString(value.commandId, "commandId"),
    name: name as ApplicationCommandName,
    payload: value.payload as unknown as ApplicationCommandPayload,
    actor: {
      kind: actor.kind as CommandActor["kind"],
      id: typeof actor.id === "string" ? actor.id : undefined,
    },
    source,
    windowId: typeof value.windowId === "string" ? value.windowId : undefined,
    sessionId: typeof value.sessionId === "string" ? value.sessionId : undefined,
    expectedVersions: expectedVersions as ExpectedVersion[] | undefined,
    issuedAt: requireString(value.issuedAt, "issuedAt"),
  };
}

export function makeCommandEnvelope<TName extends ApplicationCommandName>(
  name: TName,
  payload: Extract<CommandEnvelope["payload"], { taskId: string } | { task: Entity }>,
  source: ApplicationCommandSource,
  expectedVersions: ExpectedVersion[] = [],
): CommandEnvelope {
  return {
    commandId: globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random()}`,
    name,
    payload,
    actor: { kind: "user" },
    source,
    expectedVersions,
    issuedAt: new Date().toISOString(),
  } as CommandEnvelope;
}
