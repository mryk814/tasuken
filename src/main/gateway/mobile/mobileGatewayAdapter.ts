import {
  TASKEN_MOBILE_API_VERSION,
  TASKEN_MOBILE_CAPABILITIES,
  TASKEN_MOBILE_ENDPOINTS,
  TASKEN_MOBILE_SCHEMA_VERSION,
  TASKEN_MOBILE_WORK_RECEIPT_MAX_EXTERNAL_REFERENCES,
  TASKEN_MOBILE_WORK_RECEIPT_MAX_ITEM_LENGTH,
  TASKEN_MOBILE_WORK_RECEIPT_MAX_LIST_ITEMS,
  decodeTaskenMobileThemeCursor,
  encodeTaskenMobileThemeCursor,
  mobileBootstrapRequestSchema,
  mobileBootstrapResponseSchema,
  mobileCaptureCommandResponseSchema,
  mobileCommandRequestSchema,
  mobileTaskCommandResponseSchema,
  mobileErrorResponseSchema,
  mobileHealthResponseSchema,
  mobileResponseMetaSchema,
  mobileSyncRequestSchema,
  mobileSyncResponseSchema,
  mobileTaskWorkProposalDecisionRequestSchema,
  mobileTaskWorkProposalDecisionResponseSchema,
  mobileTaskWorkReviewRequestSchema,
  mobileTaskWorkReviewResponseSchema,
  mobileTaskWorkProposalsRequestSchema,
  mobileTaskWorkProposalsResponseSchema,
  mobileThemeCatalogItemSchema,
  mobileThemesRequestSchema,
  mobileThemesResponseSchema,
  mobileTodayRequestSchema,
  mobileTodayResponseSchema,
  mobileWorkReceiptRequestSchema,
  mobileWorkReceiptResponseSchema,
  type MobileCapability,
  type MobileErrorCode,
  type MobileResponseMeta,
  type MobileScope,
  type MobileTaskWorkProposal,
  type MobileThemeCatalogItem,
} from "../../../shared/contracts/mobile/public.ts";
import {
  TASKEN_CORE_API_VERSION,
  TASKEN_CORE_TASK_COMMAND_CAPABILITY,
  TASKEN_CORE_TASK_QUERY_CAPABILITY,
} from "../../../shared/contracts/core/public.mjs";
import {
  TASK_CONTRACT_SCHEMA_VERSION,
  taskReadModelSchema,
  type TaskCommandResponse,
  type TaskError,
  type TaskQueryResponse,
  type TaskReadModel,
} from "../../../shared/contracts/task/public.ts";
const REQUIRED_CORE_CAPABILITIES = [
  TASKEN_CORE_TASK_QUERY_CAPABILITY,
  TASKEN_CORE_TASK_COMMAND_CAPABILITY,
] as const;

export interface MobilePrincipal {
  kind: "mobile_device";
  deviceId: string;
  scopes: readonly MobileScope[];
}

export interface MobileGatewayRequest {
  method: "GET" | "POST";
  path: string;
  query?: Readonly<Record<string, string | undefined>>;
  body?: unknown;
  principal: MobilePrincipal | null;
}

export interface MobileGatewayResponse {
  status: number;
  headers: Readonly<Record<string, string>>;
  body: unknown;
}

export interface MobileGatewayTaskWorkProposalDecision {
  commandId: string;
  proposalId: string;
  taskId: string;
  expectedProposalVersion: number;
  expectedTaskVersion: number;
  decision: "accept" | "reject";
  actorId: string;
  issuedAt: string;
}

export type MobileGatewayTaskWorkProposalDecisionResult =
  | { ok: true; commandId: string; status: "applied" | "no_change" }
  | {
      ok: false;
      code: Extract<
        MobileErrorCode,
        "idempotency_conflict" | "not_found" | "proposal_conflict" | "validation_failed"
      >;
    };

export interface MobileGatewayCaptureCommand {
  commandId: string;
  name: "CreateCapture" | "DeleteCapture";
  actorId: string;
  issuedAt: string;
  payload: Record<string, unknown>;
  expectedVersion?: number;
}

export type MobileGatewayCaptureCommandResult =
  | {
      ok: true;
      commandId: string;
      status: "applied" | "no_change";
      capture: { id: string; version: number; capturedAt: string; deleted: boolean };
    }
  | {
      ok: false;
      code: Extract<
        MobileErrorCode,
        "idempotency_conflict" | "entity_conflict" | "not_found" | "validation_failed"
      >;
    };

export interface MobileGatewayCorePort {
  status(): Promise<{ apiVersion: string; capabilities: readonly string[] }>;
  listThemes(): Promise<readonly MobileGatewayThemeRecord[]> | readonly MobileGatewayThemeRecord[];
  listWorkReceipts():
    Promise<readonly MobileGatewayWorkReceiptRecord[]> | readonly MobileGatewayWorkReceiptRecord[];
  getWorkReceipt(
    id: string,
  ):
    | Promise<MobileGatewayWorkReceiptDetailRecord | null>
    | MobileGatewayWorkReceiptDetailRecord
    | null;
  listTaskWorkProposals():
    | Promise<readonly MobileGatewayTaskWorkProposalRecord[]>
    | readonly MobileGatewayTaskWorkProposalRecord[];
  getTaskWorkProposal(
    id: string,
  ):
    | Promise<MobileGatewayTaskWorkProposalRecord | null>
    | MobileGatewayTaskWorkProposalRecord
    | null;
  decideTaskWorkProposal(
    input: MobileGatewayTaskWorkProposalDecision,
  ):
    | Promise<MobileGatewayTaskWorkProposalDecisionResult>
    | MobileGatewayTaskWorkProposalDecisionResult;
  executeTaskQuery(input: unknown): Promise<TaskQueryResponse> | TaskQueryResponse;
  executeTaskCommand(input: unknown): Promise<TaskCommandResponse> | TaskCommandResponse;
  executeCaptureCommand(
    input: MobileGatewayCaptureCommand,
  ): Promise<MobileGatewayCaptureCommandResult> | MobileGatewayCaptureCommandResult;
}

export interface MobileGatewayThemeRecord {
  id: string;
  name: string;
}

export interface MobileGatewayWorkReceiptRecord {
  id: string;
  taskId: string;
  reportedAt: string;
  executorLabel: string;
  summary: string;
}

export interface MobileGatewayWorkReceiptDetailRecord extends MobileGatewayWorkReceiptRecord {
  executorKind: string;
  startedAt: string | null;
  completedItems: unknown;
  changedOrCreatedItems: unknown;
  verification: unknown;
  remainingWork: unknown;
  externalReferences: unknown;
  runtimeMetadata: unknown;
}

export interface MobileGatewayTaskWorkProposalRecord {
  id: string;
  version: number;
  source: string;
  sourceApp: string;
  payloadType: string;
  payload: unknown;
  request: unknown;
  status: string;
  receivedAt: string;
}

export interface MobileGatewayStatePort {
  current(): { serverId: string; serverRevision: number; generatedAt: string };
}

export interface MobileGatewayLoggerPort {
  warn(event: { id: string; location: "MobileGatewayAdapter.handle" }): void;
}

export class MobileGatewayCoreUnavailableError extends Error {
  constructor(options?: ErrorOptions) {
    super("Tasken Core is unavailable", options);
    this.name = "MobileGatewayCoreUnavailableError";
  }
}

export interface MobileGatewayOptions {
  core: MobileGatewayCorePort;
  state: MobileGatewayStatePort;
  logger?: MobileGatewayLoggerPort;
}

function projectLatestWorkReceipt(
  taskId: string,
  receipts: readonly MobileGatewayWorkReceiptRecord[],
) {
  const latest = receipts
    .filter((receipt) => receipt.taskId === taskId && receipt.reportedAt && receipt.summary.trim())
    .sort(
      (left, right) =>
        String(right.reportedAt).localeCompare(String(left.reportedAt)) ||
        left.id.localeCompare(right.id),
    )[0];
  if (!latest) return null;
  const executorLabel = latest.executorLabel.trim().slice(0, 200) || "agent";
  const summary = latest.summary.trim().slice(0, 2000);
  if (!summary) return null;
  return {
    id: latest.id,
    reportedAt: latest.reportedAt,
    executorLabel,
    summary,
  };
}

function projectWorkReceiptItemList(value: unknown) {
  if (!Array.isArray(value)) return { items: [], truncated: value != null };
  let truncated = value.length > TASKEN_MOBILE_WORK_RECEIPT_MAX_LIST_ITEMS;
  const items: string[] = [];
  for (const entry of value) {
    if (items.length >= TASKEN_MOBILE_WORK_RECEIPT_MAX_LIST_ITEMS) break;
    if (typeof entry !== "string" || !entry.trim()) {
      truncated = true;
      continue;
    }
    const normalized = entry.trim();
    if (normalized.length > TASKEN_MOBILE_WORK_RECEIPT_MAX_ITEM_LENGTH) truncated = true;
    items.push(normalized.slice(0, TASKEN_MOBILE_WORK_RECEIPT_MAX_ITEM_LENGTH));
  }
  return { items, truncated };
}

function projectWorkReceiptExternalReferences(value: unknown) {
  if (!Array.isArray(value)) return { references: [], truncated: value != null };
  let truncated = value.length > TASKEN_MOBILE_WORK_RECEIPT_MAX_EXTERNAL_REFERENCES;
  const references: Array<{
    kind:
      | "issue"
      | "pull_request"
      | "merge_request"
      | "commit"
      | "branch"
      | "file"
      | "pipeline"
      | "other";
    provider: string | null;
    displayLabel: string;
    url: string;
    externalId: string | null;
  }> = [];
  const kinds = new Set([
    "issue",
    "pull_request",
    "merge_request",
    "commit",
    "branch",
    "file",
    "pipeline",
    "other",
  ]);
  for (const entry of value) {
    if (references.length >= TASKEN_MOBILE_WORK_RECEIPT_MAX_EXTERNAL_REFERENCES) break;
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
      truncated = true;
      continue;
    }
    const record = entry as Record<string, unknown>;
    const kind = String(record.kind || "");
    const displayLabel = String(record.display_label || "").trim();
    let parsed: URL;
    try {
      parsed = new URL(String(record.url || ""));
    } catch {
      truncated = true;
      continue;
    }
    if (
      !kinds.has(kind) ||
      !displayLabel ||
      parsed.protocol !== "https:" ||
      parsed.username ||
      parsed.password
    ) {
      truncated = true;
      continue;
    }
    if (parsed.search || parsed.hash) truncated = true;
    parsed.search = "";
    parsed.hash = "";
    const url = parsed.toString();
    if (url.length > 2000) {
      truncated = true;
      continue;
    }
    const provider = String(record.provider || "").trim();
    const externalId = String(record.external_id || "").trim();
    if (displayLabel.length > 200 || provider.length > 120 || externalId.length > 200)
      truncated = true;
    references.push({
      kind: kind as (typeof references)[number]["kind"],
      provider: provider ? provider.slice(0, 120) : null,
      displayLabel: displayLabel.slice(0, 200),
      url,
      externalId: externalId ? externalId.slice(0, 200) : null,
    });
  }
  return { references, truncated };
}

function projectWorkReceiptDetail(receipt: MobileGatewayWorkReceiptDetailRecord) {
  const completed = projectWorkReceiptItemList(receipt.completedItems);
  const changed = projectWorkReceiptItemList(receipt.changedOrCreatedItems);
  const verification = projectWorkReceiptItemList(receipt.verification);
  const remaining = projectWorkReceiptItemList(receipt.remainingWork);
  const external = projectWorkReceiptExternalReferences(receipt.externalReferences);
  const summary = receipt.summary.trim();
  const executorLabel = receipt.executorLabel.trim();
  const runtimeMetadata =
    receipt.runtimeMetadata &&
    typeof receipt.runtimeMetadata === "object" &&
    !Array.isArray(receipt.runtimeMetadata)
      ? (receipt.runtimeMetadata as Record<string, unknown>)
      : {};
  return {
    truncated:
      completed.truncated ||
      changed.truncated ||
      verification.truncated ||
      remaining.truncated ||
      external.truncated ||
      summary.length > 10000 ||
      executorLabel.length > 200,
    receipt: {
      id: receipt.id,
      taskId: receipt.taskId,
      executorKind: ["self", "human", "ai_agent", "external", "unknown"].includes(
        receipt.executorKind,
      )
        ? receipt.executorKind
        : "unknown",
      executorLabel: executorLabel.slice(0, 200) || "agent",
      startedAt: receipt.startedAt || null,
      reportedAt: receipt.reportedAt,
      reportKind: runtimeMetadata.report_kind === "blocked" ? "blocked" : "report",
      summary: summary.slice(0, 10000),
      completedItems: completed.items,
      changedOrCreatedItems: changed.items,
      verification: verification.items,
      remainingWork: remaining.items,
      externalReferences: external.references,
    },
  };
}

function objectRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function validTimestamp(value: unknown): string | null {
  if (typeof value !== "string" || !value.trim() || Number.isNaN(Date.parse(value))) return null;
  return value;
}

function taskWorkProposalEntry(proposal: MobileGatewayTaskWorkProposalRecord) {
  if (
    proposal.source !== "mcp" ||
    proposal.payloadType !== "task_work" ||
    !Number.isInteger(proposal.version) ||
    proposal.version < 0 ||
    !validTimestamp(proposal.receivedAt)
  )
    return null;
  const payload = objectRecord(proposal.payload);
  const entries = payload?.task_work;
  if (!Array.isArray(entries) || entries.length !== 1) return null;
  const entry = objectRecord(entries[0]);
  const action = entry?.action;
  const taskId = typeof entry?.task_id === "string" ? entry.task_id.trim() : "";
  const expectedTaskVersion = Number(entry?.expected_version);
  if (
    !entry ||
    !["start", "append_receipt", "report_done", "report_blocked"].includes(String(action)) ||
    !taskId ||
    !Number.isInteger(expectedTaskVersion) ||
    expectedTaskVersion < 0
  )
    return null;
  const request = objectRecord(proposal.request);
  return {
    entry,
    action: action as MobileTaskWorkProposal["action"],
    taskId,
    expectedTaskVersion,
    caller: String(entry.caller || request?.caller || "AI agent").trim() || "AI agent",
  };
}

function projectTaskWorkProposal(
  proposal: MobileGatewayTaskWorkProposalRecord,
  task: TaskReadModel,
) {
  if (proposal.status !== "pending") return null;
  const parsed = taskWorkProposalEntry(proposal);
  if (!parsed || parsed.taskId !== task.id) return null;
  const completed = projectWorkReceiptItemList(parsed.entry.completed_items);
  const changed = projectWorkReceiptItemList(parsed.entry.changed_or_created_items);
  const verification = projectWorkReceiptItemList(parsed.entry.verification);
  const remaining = projectWorkReceiptItemList(parsed.entry.remaining_work);
  const external = projectWorkReceiptExternalReferences(parsed.entry.external_references);
  const summary = String(parsed.entry.summary || "").trim();
  const executorLabel = String(
    parsed.entry.executor_label || parsed.entry.executor_identity || parsed.caller,
  ).trim();
  const sourceApp = proposal.sourceApp.trim() || "mcp-client";
  const receivedAt = validTimestamp(proposal.receivedAt);
  if (!receivedAt) return null;
  return {
    truncated:
      completed.truncated ||
      changed.truncated ||
      verification.truncated ||
      remaining.truncated ||
      external.truncated ||
      summary.length > 10000 ||
      executorLabel.length > 200 ||
      parsed.caller.length > 200 ||
      sourceApp.length > 120,
    proposal: {
      id: proposal.id,
      version: proposal.version,
      status: "pending" as const,
      task: {
        id: task.id,
        version: task.version,
        title: task.title,
        themeId: task.project_id || null,
        workState: task.work_state || null,
      },
      action: parsed.action,
      caller: parsed.caller.slice(0, 200),
      sourceApp: sourceApp.slice(0, 120),
      receivedAt,
      expectedTaskVersion: parsed.expectedTaskVersion,
      stale: parsed.expectedTaskVersion !== task.version,
      executorLabel: executorLabel ? executorLabel.slice(0, 200) : null,
      startedAt: validTimestamp(parsed.entry.started_at),
      reportedAt: validTimestamp(parsed.entry.reported_at),
      summary: summary ? summary.slice(0, 10000) : null,
      completedItems: completed.items,
      changedOrCreatedItems: changed.items,
      verification: verification.items,
      remainingWork: remaining.items,
      externalReferences: external.references,
    },
  };
}

function projectTask(
  task: TaskReadModel,
  includeTodayDate = false,
  receipts: readonly MobileGatewayWorkReceiptRecord[] = [],
) {
  return {
    id: task.id,
    version: task.version,
    title: task.title,
    themeId: task.project_id || null,
    state: task.state,
    workState: task.work_state || null,
    ...(includeTodayDate
      ? {
          todayDate: task.today_date || null,
          plannedStartTime: task.planned_start_time ?? null,
          plannedDurationMinutes: task.planned_duration_minutes ?? null,
          latestWorkReceipt: projectLatestWorkReceipt(task.id, receipts),
        }
      : {}),
    checklistItems: [...(task.checklist_items || [])]
      .sort((left, right) => left.sort_order - right.sort_order || left.id.localeCompare(right.id))
      .map((item) => ({
        id: item.id,
        title: item.title,
        done: item.done,
        sortOrder: item.sort_order,
        completedAt: item.completed_at ?? null,
      })),
    schedule: task.schedule
      ? {
          id: task.schedule.id,
          version: task.schedule.version,
          startDate: task.schedule.start_date,
          endDate: task.schedule.end_date,
          dateKind: scheduleDateKind(task.schedule.start_date, task.schedule.end_date),
          rangeSemantics: task.schedule.range_semantics,
          confidence: task.schedule.confidence,
          granularity: task.schedule.granularity,
        }
      : null,
    updatedAt: task.updated_at,
  };
}

type MobileScheduleEdit = {
  startDate: string | null;
  endDate: string | null;
  rangeSemantics: "once_within_window" | "ongoing" | null;
};

function scheduleDateKind(
  startDate: string | null | undefined,
  endDate: string | null | undefined,
) {
  if (!startDate && !endDate) return "unknown" as const;
  if (!startDate && endDate) return "deadline" as const;
  if (startDate && (!endDate || startDate === endDate)) return "point" as const;
  return "range" as const;
}

function canonicalSchedule(schedule: MobileScheduleEdit) {
  return {
    start_date: schedule.startDate,
    end_date: schedule.endDate,
    date_kind: scheduleDateKind(schedule.startDate, schedule.endDate),
    range_semantics: schedule.rangeSemantics,
    confidence: "fixed" as const,
    granularity: "day" as const,
  };
}

type MobileTaskFieldPatch =
  | { title: string }
  | { todayDate: string | null }
  | { themeId: string | null }
  | {
      checklistItems: Array<{
        id: string;
        title: string;
        done: boolean;
        sortOrder: number;
        completedAt: string | null;
      }>;
    };

function taskUpdatePatch(patch: MobileTaskFieldPatch) {
  if ("todayDate" in patch) return { today_date: patch.todayDate };
  if ("themeId" in patch) return { project_id: patch.themeId };
  if ("checklistItems" in patch) {
    return {
      checklist_items: patch.checklistItems.map((item) => ({
        id: item.id,
        title: item.title,
        done: item.done,
        sort_order: item.sortOrder,
        completed_at: item.completedAt,
      })),
    };
  }
  return patch;
}

function taskUpdatePayload(
  command: Extract<
    import("../../../shared/contracts/mobile/public.ts").MobileTaskCommandRequest["command"],
    { name: "UpdateTask" }
  >,
) {
  const changes = command.changes;
  if ("schedule" in changes) {
    const base = "schedule" in command.base ? command.base.schedule : null;
    return {
      task_id: command.taskId,
      expected_version: command.expectedVersion,
      schedule_change: {
        changes: canonicalSchedule(changes.schedule),
        base: base ? canonicalSchedule(base) : null,
        expected_version: command.expectedScheduleVersion,
      },
    };
  }
  return {
    task_id: command.taskId,
    expected_version: command.expectedVersion,
    changes: taskUpdatePatch(changes),
    base: taskUpdatePatch(command.base as MobileTaskFieldPatch),
  };
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

async function themeCatalogFingerprint(
  catalog: readonly MobileThemeCatalogItem[],
): Promise<string> {
  const digest = await globalThis.crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(JSON.stringify(catalog)),
  );
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function statusFor(code: MobileErrorCode) {
  if (code === "unauthorized") return 401;
  if (code === "pairing_code_invalid") return 401;
  if (code === "forbidden") return 403;
  if (code === "rate_limited") return 429;
  if (code === "not_found" || code === "theme_not_found") return 404;
  if (code === "method_not_allowed") return 405;
  if (code === "version_mismatch") return 409;
  if (code === "idempotency_conflict") return 409;
  if (code === "entity_conflict") return 409;
  if (code === "version_conflict") return 409;
  if (code === "proposal_conflict") return 409;
  if (code === "work_review_conflict") return 409;
  if (code === "capability_unavailable") return 409;
  if (code === "upstream_unavailable") return 503;
  if (code === "response_too_large") return 502;
  if (code === "internal_error") return 500;
  return 400;
}

function safeMessage(code: MobileErrorCode) {
  const messages: Record<MobileErrorCode, string> = {
    unauthorized: "端末を認証できません。再ペアリングしてください。",
    pairing_code_invalid: "ペアリングコードが無効です。Desktopで新しいコードを発行してください。",
    forbidden: "この操作は端末へ許可されていません。",
    rate_limited: "短時間のリクエストが多すぎます。少し待って再試行してください。",
    validation_failed: "リクエストが不正です。アプリを更新して再試行してください。",
    not_found: "Mobile API endpointが見つかりません。",
    theme_not_found: "選択したThemeは削除済みか利用できません。",
    method_not_allowed: "このmethodは利用できません。",
    version_mismatch: "Tasken Coreとのversionが一致しません。Desktopを更新してください。",
    idempotency_conflict: "同じcommandIdが異なる内容で使用されています。",
    entity_conflict:
      "同じIDが既に存在するか、対象が更新済みです。再読み込みして再試行してください。",
    version_conflict: "Taskが更新されています。再読み込みして再試行してください。",
    proposal_conflict: "Proposalまたは対象Taskが更新されています。再読み込みしてください。",
    work_review_conflict:
      "Work Receiptまたは作業状態が更新されています。最新の内容を確認してください。",
    capability_unavailable: "必要なTasken Core capabilityを利用できません。",
    upstream_unavailable: "Tasken Coreを利用できません。Desktopの状態を確認してください。",
    response_too_large: "応答が上限を超えました。取得件数を減らしてください。",
    internal_error: "Mobile API処理を完了できませんでした。",
  };
  return messages[code];
}

export class MobileGatewayAdapter {
  private readonly options: MobileGatewayOptions;

  constructor(options: MobileGatewayOptions) {
    this.options = options;
  }

  async handle(request: MobileGatewayRequest): Promise<MobileGatewayResponse> {
    let meta: MobileResponseMeta | undefined;
    let diagnosticId = "unknown";
    try {
      meta = this.meta(false);
      if (!request.principal || request.principal.kind !== "mobile_device") {
        return this.error(meta, "unauthorized");
      }
      const knownPath = Object.values(TASKEN_MOBILE_ENDPOINTS).includes(request.path as never);
      if (!knownPath) return this.error(meta, "not_found");
      const expectedMethod = [
        TASKEN_MOBILE_ENDPOINTS.commands,
        TASKEN_MOBILE_ENDPOINTS.proposalDecisions,
        TASKEN_MOBILE_ENDPOINTS.workReviews,
      ].includes(request.path as never)
        ? "POST"
        : "GET";
      if (request.method !== expectedMethod) return this.error(meta, "method_not_allowed");
      if (request.method === "GET" && request.body !== undefined)
        return this.error(meta, "validation_failed");
      const commandRequest =
        request.path === TASKEN_MOBILE_ENDPOINTS.commands
          ? mobileCommandRequestSchema.safeParse(request.body)
          : null;
      if (
        request.path === TASKEN_MOBILE_ENDPOINTS.commands &&
        (!commandRequest?.success ||
          commandRequest.data.clientDeviceId !== request.principal.deviceId)
      )
        return this.error(meta, "validation_failed");

      if (
        [
          TASKEN_MOBILE_ENDPOINTS.today,
          TASKEN_MOBILE_ENDPOINTS.themes,
          TASKEN_MOBILE_ENDPOINTS.workReceipt,
          TASKEN_MOBILE_ENDPOINTS.proposals,
          TASKEN_MOBILE_ENDPOINTS.bootstrap,
          TASKEN_MOBILE_ENDPOINTS.sync,
        ].includes(request.path as never) &&
        !request.principal.scopes.includes("mobile:read")
      )
        return this.error(meta, "forbidden");
      if (request.path === TASKEN_MOBILE_ENDPOINTS.commands && commandRequest?.success) {
        const captureCommand = ["CreateCapture", "DeleteCapture"].includes(
          commandRequest.data.command.name,
        );
        const requiredScope: MobileScope = captureCommand
          ? "mobile:capture-write"
          : "mobile:task-write";
        if (!request.principal.scopes.includes(requiredScope)) return this.error(meta, "forbidden");
      }
      if (
        request.path === TASKEN_MOBILE_ENDPOINTS.proposalDecisions &&
        !request.principal.scopes.includes("mobile:proposal-review")
      )
        return this.error(meta, "forbidden");
      if (
        request.path === TASKEN_MOBILE_ENDPOINTS.workReviews &&
        !request.principal.scopes.includes("mobile:human-review")
      )
        return this.error(meta, "forbidden");

      const today =
        request.path === TASKEN_MOBILE_ENDPOINTS.today ? this.parseTodayQuery(request.query) : null;
      const themes =
        request.path === TASKEN_MOBILE_ENDPOINTS.themes
          ? this.parseThemesQuery(request.query)
          : null;
      const workReceipt =
        request.path === TASKEN_MOBILE_ENDPOINTS.workReceipt
          ? this.parseWorkReceiptQuery(request.query)
          : null;
      const proposals =
        request.path === TASKEN_MOBILE_ENDPOINTS.proposals
          ? this.parseProposalsQuery(request.query)
          : null;
      const proposalDecision =
        request.path === TASKEN_MOBILE_ENDPOINTS.proposalDecisions
          ? mobileTaskWorkProposalDecisionRequestSchema.safeParse(request.body)
          : null;
      const workReview =
        request.path === TASKEN_MOBILE_ENDPOINTS.workReviews
          ? mobileTaskWorkReviewRequestSchema.safeParse(request.body)
          : null;
      const bootstrap =
        request.path === TASKEN_MOBILE_ENDPOINTS.bootstrap
          ? this.parseBootstrapQuery(request.query)
          : null;
      const sync =
        request.path === TASKEN_MOBILE_ENDPOINTS.sync ? this.parseSyncQuery(request.query) : null;
      if (request.path === TASKEN_MOBILE_ENDPOINTS.today && !today)
        return this.error(meta, "validation_failed");
      if (request.path === TASKEN_MOBILE_ENDPOINTS.themes && !themes)
        return this.error(meta, "validation_failed");
      if (request.path === TASKEN_MOBILE_ENDPOINTS.workReceipt && !workReceipt)
        return this.error(meta, "validation_failed");
      if (request.path === TASKEN_MOBILE_ENDPOINTS.proposals && !proposals)
        return this.error(meta, "validation_failed");
      if (
        request.path === TASKEN_MOBILE_ENDPOINTS.proposalDecisions &&
        (!proposalDecision?.success ||
          proposalDecision.data.clientDeviceId !== request.principal.deviceId)
      )
        return this.error(meta, "validation_failed");
      if (
        request.path === TASKEN_MOBILE_ENDPOINTS.workReviews &&
        (!workReview?.success || workReview.data.clientDeviceId !== request.principal.deviceId)
      )
        return this.error(meta, "validation_failed");
      if (request.path === TASKEN_MOBILE_ENDPOINTS.bootstrap && !bootstrap)
        return this.error(meta, "validation_failed");
      if (request.path === TASKEN_MOBILE_ENDPOINTS.sync && !sync)
        return this.error(meta, "validation_failed");
      if (today || themes || workReceipt || proposals || bootstrap || sync) {
        diagnosticId = (today || themes || workReceipt || proposals || bootstrap || sync)!
          .requestId;
      }
      if (proposalDecision?.success) diagnosticId = proposalDecision.data.requestId;
      if (workReview?.success) diagnosticId = workReview.data.requestId;
      if (
        ![
          TASKEN_MOBILE_ENDPOINTS.today,
          TASKEN_MOBILE_ENDPOINTS.themes,
          TASKEN_MOBILE_ENDPOINTS.workReceipt,
          TASKEN_MOBILE_ENDPOINTS.proposals,
          TASKEN_MOBILE_ENDPOINTS.bootstrap,
          TASKEN_MOBILE_ENDPOINTS.sync,
        ].includes(request.path as never) &&
        Object.keys(request.query || {}).length > 0
      ) {
        return this.error(meta, "validation_failed");
      }

      const coreStatus = await this.options.core.status();
      if (
        !coreStatus ||
        typeof coreStatus.apiVersion !== "string" ||
        !Array.isArray(coreStatus.capabilities) ||
        coreStatus.capabilities.some((capability) => typeof capability !== "string")
      )
        throw new Error("Invalid Tasken Core status");
      if (coreStatus.apiVersion !== TASKEN_CORE_API_VERSION)
        return this.error(meta, "version_mismatch");
      if (
        REQUIRED_CORE_CAPABILITIES.some(
          (capability) => !coreStatus.capabilities.includes(capability),
        )
      ) {
        return this.error(meta, "capability_unavailable");
      }

      if (request.path === TASKEN_MOBILE_ENDPOINTS.health) {
        return this.success(
          mobileHealthResponseSchema.parse({
            ok: true,
            meta,
            data: { status: "ready", capabilities: this.capabilities(request.principal) },
          }),
        );
      }
      if (request.path === TASKEN_MOBILE_ENDPOINTS.today) {
        const result = await this.options.core.executeTaskQuery({
          schemaVersion: TASK_CONTRACT_SCHEMA_VERSION,
          query_id: today!.requestId,
          name: "ListTodayTasks",
          parameters: { date: today!.date, limit: today!.limit },
        });
        if (!result.ok) return this.taskError(meta, result.error);
        if (result.value.name !== "ListTodayTasks")
          throw new Error("Unexpected Task query outcome");
        return this.success(
          mobileTodayResponseSchema.parse({
            ok: true,
            meta,
            data: {
              date: result.value.date,
              items: result.value.items.map((task) => projectTask(task)),
              nextCursor: result.value.next_cursor,
            },
          }),
        );
      }
      if (request.path === TASKEN_MOBILE_ENDPOINTS.themes) {
        const catalog = [...(await this.options.core.listThemes())]
          .map((theme) => mobileThemeCatalogItemSchema.parse({ id: theme.id, title: theme.name }))
          .sort((left, right) => compareText(left.id, right.id));
        if (catalog.some((theme, index) => index > 0 && catalog[index - 1].id === theme.id)) {
          throw new Error("Tasken Core returned duplicate Theme IDs");
        }
        const fingerprint = await themeCatalogFingerprint(catalog);
        const cursor = themes!.cursor ? decodeTaskenMobileThemeCursor(themes!.cursor) : null;
        const position = cursor?.position || 0;
        if (
          (themes!.cursor && !cursor) ||
          (cursor && (cursor.fingerprint !== fingerprint || position >= catalog.length))
        )
          return this.error(meta, "validation_failed");
        const page = catalog.slice(position, position + themes!.limit);
        const nextPosition = position + page.length;
        const hasMore = nextPosition < catalog.length;
        meta = this.meta(hasMore);
        return this.success(
          mobileThemesResponseSchema.parse({
            ok: true,
            meta,
            data: {
              themes: page,
              nextCursor: hasMore ? encodeTaskenMobileThemeCursor(fingerprint, nextPosition) : null,
            },
          }),
        );
      }
      if (request.path === TASKEN_MOBILE_ENDPOINTS.workReceipt) {
        const canonical = await this.options.core.getWorkReceipt(workReceipt!.receiptId);
        if (!canonical || canonical.taskId !== workReceipt!.taskId)
          return this.error(meta, "not_found");
        const projected = projectWorkReceiptDetail(canonical);
        meta = this.meta(projected.truncated);
        return this.success(
          mobileWorkReceiptResponseSchema.parse({
            ok: true,
            meta,
            data: { receipt: projected.receipt },
          }),
        );
      }
      if (request.path === TASKEN_MOBILE_ENDPOINTS.proposals) {
        const records = [...(await this.options.core.listTaskWorkProposals())].sort(
          (left, right) =>
            right.receivedAt.localeCompare(left.receivedAt) || left.id.localeCompare(right.id),
        );
        const projected: unknown[] = [];
        let truncated = records.length > proposals!.limit;
        for (const record of records) {
          if (projected.length >= proposals!.limit) break;
          const parsed = taskWorkProposalEntry(record);
          if (!parsed) {
            truncated = true;
            continue;
          }
          const result = await this.options.core.executeTaskQuery({
            schemaVersion: TASK_CONTRACT_SCHEMA_VERSION,
            query_id: `${proposals!.requestId}:${record.id}`,
            name: "GetTask",
            parameters: { task_id: parsed.taskId },
          });
          if (!result.ok) {
            if (result.error.code === "NOT_FOUND") {
              truncated = true;
              continue;
            }
            return this.taskError(meta, result.error);
          }
          if (result.value.name !== "GetTask")
            throw new Error("Unexpected Task proposal query outcome");
          if (!result.value.task) {
            truncated = true;
            continue;
          }
          const projection = projectTaskWorkProposal(record, result.value.task);
          if (!projection) {
            truncated = true;
            continue;
          }
          truncated ||= projection.truncated;
          projected.push(projection.proposal);
        }
        meta = this.meta(truncated);
        return this.success(
          mobileTaskWorkProposalsResponseSchema.parse({
            ok: true,
            meta,
            data: { proposals: projected },
          }),
        );
      }
      if (request.path === TASKEN_MOBILE_ENDPOINTS.proposalDecisions) {
        const decision = proposalDecision?.success ? proposalDecision.data : null;
        if (!decision) return this.error(meta, "validation_failed");
        const record = await this.options.core.getTaskWorkProposal(decision.proposalId);
        const parsed = record ? taskWorkProposalEntry(record) : null;
        if (!record || !parsed) return this.error(meta, "not_found");
        if (parsed.taskId !== decision.taskId) return this.error(meta, "validation_failed");
        const taskResult = await this.options.core.executeTaskQuery({
          schemaVersion: TASK_CONTRACT_SCHEMA_VERSION,
          query_id: `${decision.requestId}:task`,
          name: "GetTask",
          parameters: { task_id: decision.taskId },
        });
        if (!taskResult.ok) return this.taskError(meta, taskResult.error);
        if (taskResult.value.name !== "GetTask" || !taskResult.value.task) {
          return this.error(meta, "not_found");
        }
        const decisionResult = await this.options.core.decideTaskWorkProposal({
          commandId: decision.commandId,
          proposalId: decision.proposalId,
          taskId: decision.taskId,
          expectedProposalVersion: decision.expectedProposalVersion,
          expectedTaskVersion: decision.expectedTaskVersion,
          decision: decision.decision,
          actorId: request.principal.deviceId,
          issuedAt: decision.issuedAt,
        });
        if (!decisionResult.ok) return this.error(meta, decisionResult.code);
        const updatedProposal = await this.options.core.getTaskWorkProposal(decision.proposalId);
        const updatedTask = await this.options.core.executeTaskQuery({
          schemaVersion: TASK_CONTRACT_SCHEMA_VERSION,
          query_id: `${decision.requestId}:updated-task`,
          name: "GetTask",
          parameters: { task_id: decision.taskId },
        });
        if (
          !updatedProposal ||
          !updatedTask.ok ||
          updatedTask.value.name !== "GetTask" ||
          !updatedTask.value.task
        ) {
          throw new Error("Proposal decision did not expose its canonical result");
        }
        const expectedStatus = decision.decision === "accept" ? "accepted" : "rejected";
        if (updatedProposal.status !== expectedStatus) {
          throw new Error("Proposal decision returned an unexpected canonical state");
        }
        return this.success(
          mobileTaskWorkProposalDecisionResponseSchema.parse({
            ok: true,
            meta,
            data: {
              commandId: decisionResult.commandId,
              commandStatus: decisionResult.status,
              proposalId: decision.proposalId,
              proposalStatus: expectedStatus,
              decision: decision.decision,
              taskId: decision.taskId,
              taskVersion: updatedTask.value.task.version,
            },
          }),
        );
      }
      if (request.path === TASKEN_MOBILE_ENDPOINTS.workReviews) {
        const review = workReview?.success ? workReview.data : null;
        if (!review) return this.error(meta, "validation_failed");
        const receipts = [...(await this.options.core.listWorkReceipts())]
          .filter((receipt) => receipt.taskId === review.taskId)
          .sort(
            (left, right) =>
              right.reportedAt.localeCompare(left.reportedAt) || left.id.localeCompare(right.id),
          );
        const latestReceipt = receipts[0];
        if (!latestReceipt) return this.error(meta, "not_found");
        if (latestReceipt.id !== review.receiptId) return this.error(meta, "work_review_conflict");
        const result = await this.options.core.executeTaskCommand({
          schemaVersion: TASK_CONTRACT_SCHEMA_VERSION,
          command_id: review.commandId,
          name: review.action === "accept" ? "AcceptTaskWork" : "ReturnTaskWork",
          actor: { kind: "user", id: request.principal.deviceId },
          source: "mobile",
          issued_at: review.issuedAt,
          payload:
            review.action === "accept"
              ? {
                  task_id: review.taskId,
                  expected_version: review.expectedTaskVersion,
                  receipt_id: review.receiptId,
                  complete_task: true,
                }
              : {
                  task_id: review.taskId,
                  expected_version: review.expectedTaskVersion,
                  receipt_id: review.receiptId,
                  review_note: review.reviewNote,
                },
        });
        if (!result.ok)
          return this.taskError(meta, result.error, {
            name: review.action === "accept" ? "AcceptTaskWork" : "ReturnTaskWork",
            expectedVersion: review.expectedTaskVersion,
          });
        if (
          !["AcceptTaskWork", "ReturnTaskWork"].includes(result.value.name) ||
          !result.value.task
        ) {
          throw new Error("Unexpected Task work review outcome");
        }
        return this.success(
          mobileTaskWorkReviewResponseSchema.parse({
            ok: true,
            meta,
            data: {
              commandId: result.value.command_id,
              commandStatus: result.value.status,
              action: review.action,
              receiptId: review.receiptId,
              task: projectTask(result.value.task, true, receipts),
            },
          }),
        );
      }
      if (request.path === TASKEN_MOBILE_ENDPOINTS.bootstrap) {
        let cursor: string | null = null;
        const active = new Map<string, TaskReadModel>();
        for (let page = 0; page < 100; page += 1) {
          const result = await this.options.core.executeTaskQuery({
            schemaVersion: TASK_CONTRACT_SCHEMA_VERSION,
            query_id: `${bootstrap!.requestId}-bootstrap-${page}`,
            name: "ListTaskChanges",
            parameters: { cursor, limit: 200 },
          });
          if (!result.ok) return this.taskError(meta, result.error);
          if (result.value.name !== "ListTaskChanges")
            throw new Error("Unexpected Task bootstrap outcome");
          for (const task of result.value.items) {
            if (task.deleted_at) active.delete(task.id);
            else active.set(task.id, task);
          }
          cursor = result.value.next_cursor;
          if (!result.value.has_more) break;
          if (page === 99) throw new Error("Task bootstrap exceeded the page limit");
        }
        const tasks = [...active.values()].sort(
          (left, right) =>
            String(right.updated_at).localeCompare(String(left.updated_at)) ||
            left.id.localeCompare(right.id),
        );
        const receipts = [...(await this.options.core.listWorkReceipts())];
        meta = this.meta(tasks.length > bootstrap!.limit);
        return this.success(
          mobileBootstrapResponseSchema.parse({
            ok: true,
            meta,
            data: {
              tasks: tasks
                .slice(0, bootstrap!.limit)
                .map((task) => projectTask(task, true, receipts)),
              nextCursor: cursor || "",
              hasMore: false,
            },
          }),
        );
      }
      if (request.path === TASKEN_MOBILE_ENDPOINTS.sync) {
        const result = await this.options.core.executeTaskQuery({
          schemaVersion: TASK_CONTRACT_SCHEMA_VERSION,
          query_id: sync!.requestId,
          name: "ListTaskChanges",
          parameters: { cursor: sync!.cursor, limit: sync!.limit },
        });
        if (!result.ok) return this.taskError(meta, result.error);
        if (result.value.name !== "ListTaskChanges")
          throw new Error("Unexpected Task sync outcome");
        const receipts = [...(await this.options.core.listWorkReceipts())];
        return this.success(
          mobileSyncResponseSchema.parse({
            ok: true,
            meta,
            data: {
              changes: result.value.items.map((task) =>
                task.deleted_at
                  ? {
                      kind: "tombstone",
                      entityType: "task",
                      id: task.id,
                      version: task.version,
                      updatedAt: task.updated_at,
                    }
                  : { kind: "upsert", task: projectTask(task, true, receipts) },
              ),
              nextCursor: result.value.next_cursor || sync!.cursor,
              hasMore: result.value.has_more,
            },
          }),
        );
      }

      const parsed = commandRequest;
      if (!parsed?.success) return this.error(meta, "validation_failed");
      diagnosticId = parsed.data.requestId;
      const command = parsed.data.command;
      if (command.name === "CreateCapture" || command.name === "DeleteCapture") {
        const payload =
          command.name === "CreateCapture"
            ? {
                capture: {
                  id: command.capture.id,
                  text: command.capture.text,
                  project_id: command.capture.projectId ?? null,
                  captured_at: command.capture.capturedAt,
                },
                ...(command.provenance
                  ? {
                      provenance: {
                        reported_via: command.provenance.reportedVia,
                        captured_at: command.provenance.capturedAt,
                        capture_method: command.provenance.captureMethod,
                        recognition_mode: command.provenance.recognitionMode,
                        language: command.provenance.language,
                        confidence: command.provenance.confidence,
                        source_audio_available: command.provenance.sourceAudioAvailable,
                        shared_mime_type: command.provenance.sharedMimeType,
                      },
                    }
                  : {}),
              }
            : { captureId: command.captureId };
        const result = await this.options.core.executeCaptureCommand({
          commandId: parsed.data.commandId,
          name: command.name,
          actorId: request.principal.deviceId,
          issuedAt: parsed.data.issuedAt,
          payload,
          ...(command.name === "DeleteCapture" ? { expectedVersion: command.expectedVersion } : {}),
        });
        if (!result.ok) return this.error(meta, result.code);
        return this.success(
          mobileCaptureCommandResponseSchema.parse({
            ok: true,
            meta,
            data: {
              commandId: result.commandId,
              status: result.status,
              capture: result.capture,
            },
          }),
        );
      }
      const payload =
        command.name === "CreateTask"
          ? {
              task: {
                id: command.task.id,
                title: command.task.title,
                project_id: command.task.projectId ?? null,
                state: command.task.state,
                priority: command.task.priority,
                requester: command.task.requester,
                intended_executor: command.task.intendedExecutor,
                today_date: command.task.todayDate ?? null,
              },
              ...(command.provenance
                ? {
                    provenance: {
                      reported_via: command.provenance.reportedVia,
                      captured_at: command.provenance.capturedAt,
                      capture_method: command.provenance.captureMethod,
                      recognition_mode: command.provenance.recognitionMode,
                      language: command.provenance.language,
                      confidence: command.provenance.confidence,
                      source_audio_available: command.provenance.sourceAudioAvailable,
                      shared_mime_type: command.provenance.sharedMimeType,
                    },
                  }
                : {}),
            }
          : command.name === "UpdateTask"
            ? taskUpdatePayload(command)
            : {
                task_id: command.taskId,
                expected_version: command.expectedVersion,
              };
      const result = await this.options.core.executeTaskCommand({
        schemaVersion: TASK_CONTRACT_SCHEMA_VERSION,
        command_id: parsed.data.commandId,
        name: command.name,
        actor: { kind: "user", id: request.principal.deviceId },
        source: "mobile",
        issued_at: parsed.data.issuedAt,
        payload,
      });
      if (!result.ok) return this.taskError(meta, result.error, command);
      if (result.value.name !== command.name || !result.value.task)
        throw new Error("Unexpected Task command outcome");
      const receipts = [...(await this.options.core.listWorkReceipts())];
      return this.success(
        mobileTaskCommandResponseSchema.parse({
          ok: true,
          meta,
          data: {
            commandId: result.value.command_id,
            status: result.value.status,
            task: projectTask(result.value.task, true, receipts),
          },
        }),
      );
    } catch (error) {
      const responseMeta = meta || this.fallbackMeta();
      if (error instanceof MobileGatewayCoreUnavailableError) {
        return this.error(responseMeta, "upstream_unavailable", true);
      }
      this.warnUnexpected(diagnosticId);
      return this.error(responseMeta, "internal_error");
    }
  }

  private parseTodayQuery(query: MobileGatewayRequest["query"]) {
    const values = query || {};
    const keys = Object.keys(values);
    if (
      keys.some(
        (key) => !["apiVersion", "schemaVersion", "requestId", "date", "limit"].includes(key),
      )
    )
      return null;
    const apiVersion = Number(values.apiVersion);
    const schemaVersion = Number(values.schemaVersion);
    const limit = values.limit === undefined ? undefined : Number(values.limit);
    const parsed = mobileTodayRequestSchema.safeParse({
      apiVersion,
      schemaVersion,
      requestId: values.requestId,
      date: values.date,
      ...(limit === undefined ? {} : { limit }),
    });
    return parsed.success ? parsed.data : null;
  }

  private parseBootstrapQuery(query: MobileGatewayRequest["query"]) {
    const values = query || {};
    if (
      Object.keys(values).some(
        (key) => !["apiVersion", "schemaVersion", "requestId", "limit"].includes(key),
      )
    )
      return null;
    const parsed = mobileBootstrapRequestSchema.safeParse({
      apiVersion: Number(values.apiVersion),
      schemaVersion: Number(values.schemaVersion),
      requestId: values.requestId,
      ...(values.limit === undefined ? {} : { limit: Number(values.limit) }),
    });
    return parsed.success ? parsed.data : null;
  }

  private parseThemesQuery(query: MobileGatewayRequest["query"]) {
    const values = query || {};
    if (
      Object.keys(values).some(
        (key) => !["apiVersion", "schemaVersion", "requestId", "cursor", "limit"].includes(key),
      )
    )
      return null;
    const parsed = mobileThemesRequestSchema.safeParse({
      apiVersion: Number(values.apiVersion),
      schemaVersion: Number(values.schemaVersion),
      requestId: values.requestId,
      ...(values.cursor === undefined ? {} : { cursor: values.cursor }),
      ...(values.limit === undefined ? {} : { limit: Number(values.limit) }),
    });
    return parsed.success ? parsed.data : null;
  }

  private parseWorkReceiptQuery(query: MobileGatewayRequest["query"]) {
    const values = query || {};
    if (
      Object.keys(values).some(
        (key) => !["apiVersion", "schemaVersion", "requestId", "taskId", "receiptId"].includes(key),
      )
    )
      return null;
    const parsed = mobileWorkReceiptRequestSchema.safeParse({
      apiVersion: Number(values.apiVersion),
      schemaVersion: Number(values.schemaVersion),
      requestId: values.requestId,
      taskId: values.taskId,
      receiptId: values.receiptId,
    });
    return parsed.success ? parsed.data : null;
  }

  private parseProposalsQuery(query: MobileGatewayRequest["query"]) {
    const values = query || {};
    if (
      Object.keys(values).some(
        (key) => !["apiVersion", "schemaVersion", "requestId", "limit"].includes(key),
      )
    )
      return null;
    const parsed = mobileTaskWorkProposalsRequestSchema.safeParse({
      apiVersion: Number(values.apiVersion),
      schemaVersion: Number(values.schemaVersion),
      requestId: values.requestId,
      ...(values.limit === undefined ? {} : { limit: Number(values.limit) }),
    });
    return parsed.success ? parsed.data : null;
  }

  private parseSyncQuery(query: MobileGatewayRequest["query"]) {
    const values = query || {};
    if (
      Object.keys(values).some(
        (key) => !["apiVersion", "schemaVersion", "requestId", "cursor", "limit"].includes(key),
      )
    )
      return null;
    const parsed = mobileSyncRequestSchema.safeParse({
      apiVersion: Number(values.apiVersion),
      schemaVersion: Number(values.schemaVersion),
      requestId: values.requestId,
      cursor: values.cursor,
      ...(values.limit === undefined ? {} : { limit: Number(values.limit) }),
    });
    return parsed.success ? parsed.data : null;
  }

  private warnUnexpected(id: string): void {
    try {
      this.options.logger?.warn({ id, location: "MobileGatewayAdapter.handle" });
    } catch {
      // Logging must never replace the sanitized protocol error returned to the caller.
    }
  }

  private capabilities(principal: MobilePrincipal): MobileCapability[] {
    const capabilities: MobileCapability[] = [TASKEN_MOBILE_CAPABILITIES.health];
    if (principal.scopes.includes("mobile:read")) {
      capabilities.push(
        TASKEN_MOBILE_CAPABILITIES.todayRead,
        TASKEN_MOBILE_CAPABILITIES.syncRead,
        TASKEN_MOBILE_CAPABILITIES.workReceiptRead,
        TASKEN_MOBILE_CAPABILITIES.proposalRead,
      );
    }
    if (principal.scopes.includes("mobile:task-write"))
      capabilities.push(TASKEN_MOBILE_CAPABILITIES.taskWrite);
    if (principal.scopes.includes("mobile:capture-write"))
      capabilities.push(TASKEN_MOBILE_CAPABILITIES.captureWrite);
    if (principal.scopes.includes("mobile:proposal-review"))
      capabilities.push(TASKEN_MOBILE_CAPABILITIES.proposalReview);
    if (principal.scopes.includes("mobile:human-review"))
      capabilities.push(TASKEN_MOBILE_CAPABILITIES.humanReview);
    return capabilities;
  }

  private meta(truncated: boolean): MobileResponseMeta {
    return mobileResponseMetaSchema.parse({
      apiVersion: TASKEN_MOBILE_API_VERSION,
      schemaVersion: TASKEN_MOBILE_SCHEMA_VERSION,
      ...this.options.state.current(),
      truncated,
    });
  }

  private fallbackMeta(): MobileResponseMeta {
    return mobileResponseMetaSchema.parse({
      apiVersion: TASKEN_MOBILE_API_VERSION,
      schemaVersion: TASKEN_MOBILE_SCHEMA_VERSION,
      serverId: "unavailable",
      serverRevision: 0,
      generatedAt: new Date().toISOString(),
      truncated: false,
    });
  }

  private success(body: unknown): MobileGatewayResponse {
    return { status: 200, headers: this.headers(), body };
  }

  private error(
    meta: MobileResponseMeta,
    code: MobileErrorCode,
    retryable = false,
    conflict?: {
      currentTask: ReturnType<typeof projectTask>;
      intendedAction: "UpdateTask" | "CompleteTask" | "ReopenTask" | "DeleteTask";
      expectedVersion: number;
      conflictField: "task" | "schedule";
      expectedScheduleVersion: number | null;
    },
  ): MobileGatewayResponse {
    const body = mobileErrorResponseSchema.parse({
      ok: false,
      meta,
      error: { code, message: safeMessage(code), retryable, ...(conflict ? { conflict } : {}) },
    });
    return { status: statusFor(code), headers: this.headers(), body };
  }

  private taskError(
    meta: MobileResponseMeta,
    error: TaskError,
    command?: {
      name: string;
      expectedVersion?: number;
      expectedScheduleVersion?: number | null;
      changes?: Record<string, unknown>;
    },
  ) {
    if (
      error.code === "INVALID_COMMAND" &&
      typeof error.details?.themeId === "string" &&
      error.details.themeId.trim()
    )
      return this.error(meta, "theme_not_found");
    if (error.code === "CONFLICT") {
      if (error.conflict_reason === "command_fingerprint_mismatch")
        return this.error(meta, "idempotency_conflict");
      if (error.conflict_reason === "entity_already_exists")
        return this.error(meta, "entity_conflict");
      if (error.conflict_reason === "version_conflict") {
        if (command?.name === "AcceptTaskWork" || command?.name === "ReturnTaskWork") {
          return this.error(meta, "work_review_conflict");
        }
        const currentTask = taskReadModelSchema.safeParse(error.details?.current_task);
        if (
          !currentTask.success ||
          (command?.name !== "UpdateTask" &&
            command?.name !== "CompleteTask" &&
            command?.name !== "ReopenTask" &&
            command?.name !== "DeleteTask") ||
          command.expectedVersion === undefined
        )
          throw new Error("Version conflict is missing its canonical Task context");
        const scheduleConflict =
          command.name === "UpdateTask" &&
          Boolean(
            command.changes && Object.prototype.hasOwnProperty.call(command.changes, "schedule"),
          );
        return this.error(meta, "version_conflict", false, {
          currentTask: projectTask(currentTask.data, true),
          intendedAction: command.name,
          expectedVersion: command.expectedVersion,
          conflictField: scheduleConflict ? "schedule" : "task",
          expectedScheduleVersion: scheduleConflict
            ? (command.expectedScheduleVersion ?? null)
            : null,
        });
      }
      throw new Error("Unclassified Task conflict");
    }
    if (error.code === "NOT_FOUND") return this.error(meta, "not_found");
    if (error.code === "FORBIDDEN") return this.error(meta, "forbidden");
    if (error.code === "UNAVAILABLE") return this.error(meta, "upstream_unavailable", true);
    if (error.code === "INTERNAL_ERROR") return this.error(meta, "internal_error", true);
    if (error.code.startsWith("INVALID") || error.code.startsWith("UNSUPPORTED"))
      return this.error(meta, "validation_failed");
    throw new Error("Unexpected Task error");
  }

  private headers() {
    return {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      "x-tasken-mobile-api-version": String(TASKEN_MOBILE_API_VERSION),
    };
  }
}
