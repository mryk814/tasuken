import {
  TASKEN_MOBILE_API_VERSION,
  TASKEN_MOBILE_CAPABILITIES,
  TASKEN_MOBILE_ENDPOINTS,
  TASKEN_MOBILE_SCHEMA_VERSION,
  decodeTaskenMobileThemeCursor,
  encodeTaskenMobileThemeCursor,
  mobileBootstrapRequestSchema,
  mobileBootstrapResponseSchema,
  mobileTaskCommandRequestSchema,
  mobileTaskCommandResponseSchema,
  mobileErrorResponseSchema,
  mobileHealthResponseSchema,
  mobileResponseMetaSchema,
  mobileSyncRequestSchema,
  mobileSyncResponseSchema,
  mobileThemeCatalogItemSchema,
  mobileThemesRequestSchema,
  mobileThemesResponseSchema,
  mobileTodayRequestSchema,
  mobileTodayResponseSchema,
  type MobileCapability,
  type MobileErrorCode,
  type MobileResponseMeta,
  type MobileScope,
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

const REQUIRED_CORE_CAPABILITIES = [TASKEN_CORE_TASK_QUERY_CAPABILITY, TASKEN_CORE_TASK_COMMAND_CAPABILITY] as const;

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

export interface MobileGatewayCorePort {
  status(): Promise<{ apiVersion: string; capabilities: readonly string[] }>;
  listThemes(): Promise<readonly MobileGatewayThemeRecord[]> | readonly MobileGatewayThemeRecord[];
  listWorkReceipts(): Promise<readonly MobileGatewayWorkReceiptRecord[]> | readonly MobileGatewayWorkReceiptRecord[];
  executeTaskQuery(input: unknown): Promise<TaskQueryResponse> | TaskQueryResponse;
  executeTaskCommand(input: unknown): Promise<TaskCommandResponse> | TaskCommandResponse;
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
    .sort((left, right) => String(right.reportedAt).localeCompare(String(left.reportedAt)) || left.id.localeCompare(right.id))[0];
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
    ...(includeTodayDate ? {
      todayDate: task.today_date || null,
      plannedStartTime: task.planned_start_time ?? null,
      plannedDurationMinutes: task.planned_duration_minutes ?? null,
      latestWorkReceipt: projectLatestWorkReceipt(task.id, receipts),
    } : {}),
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

function scheduleDateKind(startDate: string | null | undefined, endDate: string | null | undefined) {
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
  | { themeId: string | null };

function taskUpdatePatch(patch: MobileTaskFieldPatch) {
  if ("todayDate" in patch) return { today_date: patch.todayDate };
  if ("themeId" in patch) return { project_id: patch.themeId };
  return patch;
}

function taskUpdatePayload(command: Extract<import("../../../shared/contracts/mobile/public.ts").MobileTaskCommandRequest["command"], { name: "UpdateTask" }>) {
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

async function themeCatalogFingerprint(catalog: readonly MobileThemeCatalogItem[]): Promise<string> {
  const digest = await globalThis.crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(JSON.stringify(catalog)),
  );
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
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
    entity_conflict: "同じTask IDが既に存在します。新しいIDで再試行してください。",
    version_conflict: "Taskが更新されています。再読み込みして再試行してください。",
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
      const expectedMethod = request.path === TASKEN_MOBILE_ENDPOINTS.commands ? "POST" : "GET";
      if (request.method !== expectedMethod) return this.error(meta, "method_not_allowed");
      if (request.method === "GET" && request.body !== undefined) return this.error(meta, "validation_failed");

      if (
        [TASKEN_MOBILE_ENDPOINTS.today, TASKEN_MOBILE_ENDPOINTS.themes, TASKEN_MOBILE_ENDPOINTS.bootstrap, TASKEN_MOBILE_ENDPOINTS.sync].includes(request.path as never)
        && !request.principal.scopes.includes("mobile:read")
      ) return this.error(meta, "forbidden");
      if (
        request.path === TASKEN_MOBILE_ENDPOINTS.commands
        && !request.principal.scopes.includes("mobile:task-write")
      ) return this.error(meta, "forbidden");

      const today = request.path === TASKEN_MOBILE_ENDPOINTS.today
        ? this.parseTodayQuery(request.query)
        : null;
      const themes = request.path === TASKEN_MOBILE_ENDPOINTS.themes
        ? this.parseThemesQuery(request.query)
        : null;
      const bootstrap = request.path === TASKEN_MOBILE_ENDPOINTS.bootstrap
        ? this.parseBootstrapQuery(request.query)
        : null;
      const sync = request.path === TASKEN_MOBILE_ENDPOINTS.sync
        ? this.parseSyncQuery(request.query)
        : null;
      if (request.path === TASKEN_MOBILE_ENDPOINTS.today && !today) return this.error(meta, "validation_failed");
      if (request.path === TASKEN_MOBILE_ENDPOINTS.themes && !themes) return this.error(meta, "validation_failed");
      if (request.path === TASKEN_MOBILE_ENDPOINTS.bootstrap && !bootstrap) return this.error(meta, "validation_failed");
      if (request.path === TASKEN_MOBILE_ENDPOINTS.sync && !sync) return this.error(meta, "validation_failed");
      if (today || themes || bootstrap || sync) diagnosticId = (today || themes || bootstrap || sync)!.requestId;
      if (![TASKEN_MOBILE_ENDPOINTS.today, TASKEN_MOBILE_ENDPOINTS.themes, TASKEN_MOBILE_ENDPOINTS.bootstrap, TASKEN_MOBILE_ENDPOINTS.sync].includes(request.path as never) && Object.keys(request.query || {}).length > 0) {
        return this.error(meta, "validation_failed");
      }

      const coreStatus = await this.options.core.status();
      if (
        !coreStatus
        || typeof coreStatus.apiVersion !== "string"
        || !Array.isArray(coreStatus.capabilities)
        || coreStatus.capabilities.some((capability) => typeof capability !== "string")
      ) throw new Error("Invalid Tasken Core status");
      if (coreStatus.apiVersion !== TASKEN_CORE_API_VERSION) return this.error(meta, "version_mismatch");
      if (REQUIRED_CORE_CAPABILITIES.some((capability) => !coreStatus.capabilities.includes(capability))) {
        return this.error(meta, "capability_unavailable");
      }

      if (request.path === TASKEN_MOBILE_ENDPOINTS.health) {
        return this.success(mobileHealthResponseSchema.parse({
          ok: true,
          meta,
          data: { status: "ready", capabilities: this.capabilities(request.principal) },
        }));
      }
      if (request.path === TASKEN_MOBILE_ENDPOINTS.today) {
        const result = await this.options.core.executeTaskQuery({
          schemaVersion: TASK_CONTRACT_SCHEMA_VERSION,
          query_id: today!.requestId,
          name: "ListTodayTasks",
          parameters: { date: today!.date, limit: today!.limit },
        });
        if (!result.ok) return this.taskError(meta, result.error);
        if (result.value.name !== "ListTodayTasks") throw new Error("Unexpected Task query outcome");
        return this.success(mobileTodayResponseSchema.parse({
          ok: true,
          meta,
          data: {
            date: result.value.date,
            items: result.value.items.map((task) => projectTask(task)),
            nextCursor: result.value.next_cursor,
          },
        }));
      }
      if (request.path === TASKEN_MOBILE_ENDPOINTS.themes) {
        const catalog = [...await this.options.core.listThemes()]
          .map((theme) => mobileThemeCatalogItemSchema.parse({ id: theme.id, title: theme.name }))
          .sort((left, right) => compareText(left.id, right.id));
        if (catalog.some((theme, index) => index > 0 && catalog[index - 1].id === theme.id)) {
          throw new Error("Tasken Core returned duplicate Theme IDs");
        }
        const fingerprint = await themeCatalogFingerprint(catalog);
        const cursor = themes!.cursor ? decodeTaskenMobileThemeCursor(themes!.cursor) : null;
        const position = cursor?.position || 0;
        if (
          (themes!.cursor && !cursor)
          || (cursor && (cursor.fingerprint !== fingerprint || position >= catalog.length))
        ) return this.error(meta, "validation_failed");
        const page = catalog.slice(position, position + themes!.limit);
        const nextPosition = position + page.length;
        const hasMore = nextPosition < catalog.length;
        meta = this.meta(hasMore);
        return this.success(mobileThemesResponseSchema.parse({
          ok: true,
          meta,
          data: {
            themes: page,
            nextCursor: hasMore ? encodeTaskenMobileThemeCursor(fingerprint, nextPosition) : null,
          },
        }));
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
          if (result.value.name !== "ListTaskChanges") throw new Error("Unexpected Task bootstrap outcome");
          for (const task of result.value.items) {
            if (task.deleted_at) active.delete(task.id);
            else active.set(task.id, task);
          }
          cursor = result.value.next_cursor;
          if (!result.value.has_more) break;
          if (page === 99) throw new Error("Task bootstrap exceeded the page limit");
        }
        const tasks = [...active.values()]
          .sort((left, right) => String(right.updated_at).localeCompare(String(left.updated_at)) || left.id.localeCompare(right.id));
        const receipts = [...await this.options.core.listWorkReceipts()];
        meta = this.meta(tasks.length > bootstrap!.limit);
        return this.success(mobileBootstrapResponseSchema.parse({
          ok: true,
          meta,
          data: {
            tasks: tasks.slice(0, bootstrap!.limit).map((task) => projectTask(task, true, receipts)),
            nextCursor: cursor || "",
            hasMore: false,
          },
        }));
      }
      if (request.path === TASKEN_MOBILE_ENDPOINTS.sync) {
        const result = await this.options.core.executeTaskQuery({
          schemaVersion: TASK_CONTRACT_SCHEMA_VERSION,
          query_id: sync!.requestId,
          name: "ListTaskChanges",
          parameters: { cursor: sync!.cursor, limit: sync!.limit },
        });
        if (!result.ok) return this.taskError(meta, result.error);
        if (result.value.name !== "ListTaskChanges") throw new Error("Unexpected Task sync outcome");
        const receipts = [...await this.options.core.listWorkReceipts()];
        return this.success(mobileSyncResponseSchema.parse({
          ok: true,
          meta,
          data: {
            changes: result.value.items.map((task) => task.deleted_at
              ? { kind: "tombstone", entityType: "task", id: task.id, version: task.version, updatedAt: task.updated_at }
              : { kind: "upsert", task: projectTask(task, true, receipts) }),
            nextCursor: result.value.next_cursor || sync!.cursor,
            hasMore: result.value.has_more,
          },
        }));
      }

      const parsed = mobileTaskCommandRequestSchema.safeParse(request.body);
      if (!parsed.success || parsed.data.clientDeviceId !== request.principal.deviceId) {
        return this.error(meta, "validation_failed");
      }
      diagnosticId = parsed.data.requestId;
      const command = parsed.data.command;
      const payload = command.name === "CreateTask"
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
      if (result.value.name !== command.name || !result.value.task) throw new Error("Unexpected Task command outcome");
      const receipts = [...await this.options.core.listWorkReceipts()];
      return this.success(mobileTaskCommandResponseSchema.parse({
        ok: true,
        meta,
        data: {
          commandId: result.value.command_id,
          status: result.value.status,
          task: projectTask(result.value.task, true, receipts),
        },
      }));
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
    if (keys.some((key) => !["apiVersion", "schemaVersion", "requestId", "date", "limit"].includes(key))) return null;
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
    if (Object.keys(values).some((key) => !["apiVersion", "schemaVersion", "requestId", "limit"].includes(key))) return null;
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
    if (Object.keys(values).some((key) => !["apiVersion", "schemaVersion", "requestId", "cursor", "limit"].includes(key))) return null;
    const parsed = mobileThemesRequestSchema.safeParse({
      apiVersion: Number(values.apiVersion),
      schemaVersion: Number(values.schemaVersion),
      requestId: values.requestId,
      ...(values.cursor === undefined ? {} : { cursor: values.cursor }),
      ...(values.limit === undefined ? {} : { limit: Number(values.limit) }),
    });
    return parsed.success ? parsed.data : null;
  }

  private parseSyncQuery(query: MobileGatewayRequest["query"]) {
    const values = query || {};
    if (Object.keys(values).some((key) => !["apiVersion", "schemaVersion", "requestId", "cursor", "limit"].includes(key))) return null;
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
      );
    }
    if (principal.scopes.includes("mobile:task-write")) capabilities.push(TASKEN_MOBILE_CAPABILITIES.taskWrite);
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
      intendedAction: "UpdateTask" | "CompleteTask" | "ReopenTask";
      expectedVersion: number;
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
    command?: { name: string; expectedVersion?: number },
  ) {
    if (
      error.code === "INVALID_COMMAND"
      && typeof error.details?.themeId === "string"
      && error.details.themeId.trim()
    ) return this.error(meta, "theme_not_found");
    if (error.code === "CONFLICT") {
      if (error.conflict_reason === "command_fingerprint_mismatch") return this.error(meta, "idempotency_conflict");
      if (error.conflict_reason === "entity_already_exists") return this.error(meta, "entity_conflict");
      if (error.conflict_reason === "version_conflict") {
        const currentTask = taskReadModelSchema.safeParse(error.details?.current_task);
        if (
          !currentTask.success
          || (command?.name !== "UpdateTask" && command?.name !== "CompleteTask" && command?.name !== "ReopenTask")
          || command.expectedVersion === undefined
        ) throw new Error("Version conflict is missing its canonical Task context");
        return this.error(meta, "version_conflict", false, {
          currentTask: projectTask(currentTask.data, true),
          intendedAction: command.name,
          expectedVersion: command.expectedVersion,
        });
      }
      throw new Error("Unclassified Task conflict");
    }
    if (error.code === "NOT_FOUND") return this.error(meta, "not_found");
    if (error.code === "FORBIDDEN") return this.error(meta, "forbidden");
    if (error.code === "UNAVAILABLE") return this.error(meta, "upstream_unavailable", true);
    if (error.code === "INTERNAL_ERROR") return this.error(meta, "internal_error", true);
    if (error.code.startsWith("INVALID") || error.code.startsWith("UNSUPPORTED")) return this.error(meta, "validation_failed");
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
