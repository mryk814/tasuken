import {
  TASKEN_MOBILE_API_VERSION,
  TASKEN_MOBILE_CAPABILITIES,
  TASKEN_MOBILE_ENDPOINTS,
  TASKEN_MOBILE_SCHEMA_VERSION,
  mobileCreateTaskRequestSchema,
  mobileCreateTaskResponseSchema,
  mobileErrorResponseSchema,
  mobileHealthResponseSchema,
  mobileResponseMetaSchema,
  mobileTodayRequestSchema,
  mobileTodayResponseSchema,
  type MobileCapability,
  type MobileErrorCode,
  type MobileResponseMeta,
  type MobileScope,
} from "../../../shared/contracts/mobile/public.ts";
import {
  TASKEN_CORE_API_VERSION,
  TASKEN_CORE_TASK_COMMAND_CAPABILITY,
  TASKEN_CORE_TASK_QUERY_CAPABILITY,
} from "../../../shared/contracts/core/public.mjs";
import {
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
  executeTaskQuery(input: unknown): Promise<TaskQueryResponse> | TaskQueryResponse;
  executeTaskCommand(input: unknown): Promise<TaskCommandResponse> | TaskCommandResponse;
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

function projectTask(task: TaskReadModel) {
  return {
    id: task.id,
    title: task.title,
    themeId: task.project_id || null,
    state: task.state,
    workState: task.work_state || null,
    updatedAt: task.updated_at,
  };
}

function statusFor(code: MobileErrorCode) {
  if (code === "unauthorized") return 401;
  if (code === "forbidden") return 403;
  if (code === "not_found") return 404;
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
    forbidden: "この操作は端末へ許可されていません。",
    validation_failed: "リクエストが不正です。アプリを更新して再試行してください。",
    not_found: "Mobile API endpointが見つかりません。",
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
        request.path === TASKEN_MOBILE_ENDPOINTS.today
        && !request.principal.scopes.includes("mobile:read")
      ) return this.error(meta, "forbidden");
      if (
        request.path === TASKEN_MOBILE_ENDPOINTS.commands
        && !request.principal.scopes.includes("mobile:task-write")
      ) return this.error(meta, "forbidden");

      const today = request.path === TASKEN_MOBILE_ENDPOINTS.today
        ? this.parseTodayQuery(request.query)
        : null;
      if (request.path === TASKEN_MOBILE_ENDPOINTS.today && !today) return this.error(meta, "validation_failed");
      if (today) diagnosticId = today.requestId;
      if (request.path !== TASKEN_MOBILE_ENDPOINTS.today && Object.keys(request.query || {}).length > 0) {
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
          schemaVersion: 1,
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
            items: result.value.items.map(projectTask),
            nextCursor: result.value.next_cursor,
          },
        }));
      }

      const parsed = mobileCreateTaskRequestSchema.safeParse(request.body);
      if (!parsed.success || parsed.data.clientDeviceId !== request.principal.deviceId) {
        return this.error(meta, "validation_failed");
      }
      diagnosticId = parsed.data.requestId;
      const candidate = parsed.data.command.task;
      const result = await this.options.core.executeTaskCommand({
        schemaVersion: 1,
        command_id: parsed.data.commandId,
        name: "CreateTask",
        actor: { kind: "user", id: request.principal.deviceId },
        source: "mobile",
        issued_at: parsed.data.issuedAt,
        payload: {
          task: {
            id: candidate.id,
            title: candidate.title,
            project_id: candidate.projectId ?? null,
            state: candidate.state,
            priority: candidate.priority,
            requester: candidate.requester,
            intended_executor: candidate.intendedExecutor,
            today_date: candidate.todayDate ?? null,
          },
        },
      });
      if (!result.ok) return this.taskError(meta, result.error);
      if (result.value.name !== "CreateTask" || !result.value.task) throw new Error("Unexpected Task command outcome");
      return this.success(mobileCreateTaskResponseSchema.parse({
        ok: true,
        meta,
        data: {
          commandId: result.value.command_id,
          status: result.value.status,
          task: projectTask(result.value.task),
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

  private warnUnexpected(id: string): void {
    try {
      this.options.logger?.warn({ id, location: "MobileGatewayAdapter.handle" });
    } catch {
      // Logging must never replace the sanitized protocol error returned to the caller.
    }
  }

  private capabilities(principal: MobilePrincipal): MobileCapability[] {
    const capabilities: MobileCapability[] = [TASKEN_MOBILE_CAPABILITIES.health];
    if (principal.scopes.includes("mobile:read")) capabilities.push(TASKEN_MOBILE_CAPABILITIES.todayRead);
    if (principal.scopes.includes("mobile:task-write")) capabilities.push(TASKEN_MOBILE_CAPABILITIES.taskCreate);
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

  private error(meta: MobileResponseMeta, code: MobileErrorCode, retryable = false): MobileGatewayResponse {
    const body = mobileErrorResponseSchema.parse({
      ok: false,
      meta,
      error: { code, message: safeMessage(code), retryable },
    });
    return { status: statusFor(code), headers: this.headers(), body };
  }

  private taskError(meta: MobileResponseMeta, error: TaskError) {
    if (error.code === "CONFLICT") {
      if (error.conflict_reason === "command_fingerprint_mismatch") return this.error(meta, "idempotency_conflict");
      if (error.conflict_reason === "entity_already_exists") return this.error(meta, "entity_conflict");
      if (error.conflict_reason === "version_conflict") return this.error(meta, "version_conflict");
      throw new Error("Unclassified Task conflict");
    }
    if (error.code === "NOT_FOUND") return this.error(meta, "not_found");
    if (error.code === "FORBIDDEN") return this.error(meta, "forbidden");
    if (error.code === "UNAVAILABLE") return this.error(meta, "upstream_unavailable", true);
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
