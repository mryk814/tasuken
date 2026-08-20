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

export interface MobileGatewayOptions {
  core: MobileGatewayCorePort;
  state: MobileGatewayStatePort;
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
    const meta = this.meta(false);
    try {
      if (!request.principal || request.principal.kind !== "mobile_device") {
        return this.error(meta, "unauthorized");
      }
      const expectedMethod = request.path === TASKEN_MOBILE_ENDPOINTS.health ? "GET" : "POST";
      const knownPath = Object.values(TASKEN_MOBILE_ENDPOINTS).includes(request.path as never);
      if (!knownPath) return this.error(meta, "not_found");
      if (request.method !== expectedMethod) return this.error(meta, "method_not_allowed");

      const coreStatus = await this.options.core.status();
      if (coreStatus.apiVersion !== TASKEN_CORE_API_VERSION) return this.error(meta, "version_mismatch");
      if (REQUIRED_CORE_CAPABILITIES.some((capability) => !coreStatus.capabilities.includes(capability))) {
        return this.error(meta, "capability_unavailable");
      }

      if (request.path === TASKEN_MOBILE_ENDPOINTS.health) {
        if (!request.principal.scopes.includes("mobile:read")) return this.error(meta, "forbidden");
        return this.success(mobileHealthResponseSchema.parse({
          ok: true,
          meta,
          data: { status: "ready", capabilities: this.capabilities(request.principal) },
        }));
      }
      if (request.path === TASKEN_MOBILE_ENDPOINTS.today) {
        if (!request.principal.scopes.includes("mobile:read")) return this.error(meta, "forbidden");
        const parsed = mobileTodayRequestSchema.safeParse(request.body);
        if (!parsed.success) return this.error(meta, "validation_failed");
        const result = await this.options.core.executeTaskQuery({
          schemaVersion: 1,
          query_id: parsed.data.requestId,
          name: "ListTodayTasks",
          parameters: { date: parsed.data.date, limit: parsed.data.limit },
        });
        if (!result.ok) return this.taskError(meta, result.error.code);
        if (result.value.name !== "ListTodayTasks") return this.error(meta, "upstream_unavailable");
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

      if (!request.principal.scopes.includes("mobile:task-write")) return this.error(meta, "forbidden");
      const parsed = mobileCreateTaskRequestSchema.safeParse(request.body);
      if (!parsed.success || parsed.data.clientDeviceId !== request.principal.deviceId) {
        return this.error(meta, "validation_failed");
      }
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
      if (!result.ok) return this.taskError(meta, result.error.code);
      if (result.value.name !== "CreateTask" || !result.value.task) return this.error(meta, "upstream_unavailable");
      return this.success(mobileCreateTaskResponseSchema.parse({
        ok: true,
        meta,
        data: {
          commandId: result.value.command_id,
          status: result.value.status,
          task: projectTask(result.value.task),
        },
      }));
    } catch {
      return this.error(meta, "upstream_unavailable", true);
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

  private taskError(meta: MobileResponseMeta, code: string) {
    if (code === "CONFLICT") return this.error(meta, "idempotency_conflict");
    if (code === "NOT_FOUND") return this.error(meta, "not_found");
    if (code === "FORBIDDEN") return this.error(meta, "forbidden");
    if (code === "UNAVAILABLE") return this.error(meta, "upstream_unavailable", true);
    if (code.startsWith("INVALID") || code.startsWith("UNSUPPORTED")) return this.error(meta, "validation_failed");
    return this.error(meta, "internal_error");
  }

  private headers() {
    return {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      "x-tasken-mobile-api-version": String(TASKEN_MOBILE_API_VERSION),
    };
  }
}
