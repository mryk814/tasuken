import {
  TASKEN_MOBILE_API_VERSION,
  TASKEN_MOBILE_CAPABILITIES,
  TASKEN_MOBILE_CLIENT_TIMEOUT_MS,
  TASKEN_MOBILE_ENDPOINTS,
  TASKEN_MOBILE_MAX_RESPONSE_BYTES,
  mobileCreateTaskRequestSchema,
  mobileCreateTaskResponseSchema,
  mobileErrorResponseSchema,
  mobileHealthResponseSchema,
  mobileTodayRequestSchema,
  mobileTodayResponseSchema,
  type MobileCapability,
  type MobileCreateTaskRequest,
  type MobileTodayRequest,
} from "../../../shared/contracts/mobile/public.ts";

export class MobileGatewayClientError extends Error {
  readonly code: string;

  constructor(code: string, message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "MobileGatewayClientError";
    this.code = code;
  }
}

export interface MobileGatewayClientOptions {
  baseUrl: string;
  accessToken: string;
  fetch?: typeof globalThis.fetch;
  timeoutMs?: number;
  maxResponseBytes?: number;
}

function safeClientMessage(code: string) {
  if (code === "unauthorized") return "端末の認証が失効しました。再ペアリングしてください。";
  if (code === "forbidden") return "端末に必要なscopeがありません。Desktop設定を確認してください。";
  if (code === "version_mismatch") return "Mobile API versionが一致しません。アプリを更新してください。";
  if (code === "idempotency_conflict") return "同じcommandIdが異なる内容で使用されています。新しいcommandIdで再送してください。";
  if (code === "capability_unavailable") return "必要なMobile API capabilityを利用できません。";
  if (code === "response_too_large") return "Mobile API responseが上限を超えました。";
  return "Mobile Gatewayへ接続できません。DesktopとTailscaleを確認してください。";
}

export class MobileGatewayClient {
  private readonly baseUrl: string;
  private readonly accessToken: string;
  private readonly fetch: typeof globalThis.fetch;
  private readonly timeoutMs: number;
  private readonly maxResponseBytes: number;

  constructor(options: MobileGatewayClientOptions) {
    let baseUrl: URL;
    try {
      baseUrl = new URL(options.baseUrl);
    } catch {
      throw new MobileGatewayClientError("invalid_endpoint", "Mobile Gateway URLが不正です。");
    }
    if (baseUrl.protocol !== "https:" || baseUrl.username || baseUrl.password || baseUrl.search || baseUrl.hash) {
      throw new MobileGatewayClientError("invalid_endpoint", "Mobile Gatewayにはprivate HTTPS URLを指定してください。");
    }
    if (!options.accessToken || options.accessToken.length < 32 || options.accessToken.length > 4096) {
      throw new MobileGatewayClientError("invalid_credential", "Mobile Gateway credentialが不正です。");
    }
    this.baseUrl = baseUrl.toString().replace(/\/$/, "");
    this.accessToken = options.accessToken;
    this.fetch = options.fetch || globalThis.fetch;
    this.timeoutMs = options.timeoutMs || TASKEN_MOBILE_CLIENT_TIMEOUT_MS;
    this.maxResponseBytes = options.maxResponseBytes || TASKEN_MOBILE_MAX_RESPONSE_BYTES;
  }

  async health() {
    return mobileHealthResponseSchema.parse(await this.request("GET", TASKEN_MOBILE_ENDPOINTS.health));
  }

  async listToday(input: MobileTodayRequest) {
    mobileTodayRequestSchema.parse(input);
    await this.requireCapability(TASKEN_MOBILE_CAPABILITIES.todayRead);
    return mobileTodayResponseSchema.parse(await this.request("POST", TASKEN_MOBILE_ENDPOINTS.today, input));
  }

  async createTask(input: MobileCreateTaskRequest) {
    mobileCreateTaskRequestSchema.parse(input);
    await this.requireCapability(TASKEN_MOBILE_CAPABILITIES.taskCreate);
    return mobileCreateTaskResponseSchema.parse(await this.request("POST", TASKEN_MOBILE_ENDPOINTS.taskCommands, input));
  }

  private async requireCapability(capability: MobileCapability) {
    const health = await this.health();
    if (!health.data.capabilities.includes(capability)) {
      throw new MobileGatewayClientError("capability_unavailable", safeClientMessage("capability_unavailable"));
    }
  }

  private async request(method: "GET" | "POST", endpoint: string, body?: unknown) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const response = await this.fetch(`${this.baseUrl}${endpoint}`, {
        method,
        headers: {
          authorization: `Bearer ${this.accessToken}`,
          accept: "application/json",
          ...(body === undefined ? {} : { "content-type": "application/json" }),
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        signal: controller.signal,
      });
      const declaredLength = Number(response.headers.get("content-length") || "0");
      if (declaredLength > this.maxResponseBytes) {
        throw new MobileGatewayClientError("response_too_large", safeClientMessage("response_too_large"));
      }
      const text = await response.text();
      if (new TextEncoder().encode(text).byteLength > this.maxResponseBytes) {
        throw new MobileGatewayClientError("response_too_large", safeClientMessage("response_too_large"));
      }
      let payload: unknown;
      try {
        payload = JSON.parse(text);
      } catch {
        throw new MobileGatewayClientError("invalid_response", "Mobile Gateway responseが不正です。");
      }
      if (response.headers.get("x-tasken-mobile-api-version") !== String(TASKEN_MOBILE_API_VERSION)) {
        throw new MobileGatewayClientError("version_mismatch", safeClientMessage("version_mismatch"));
      }
      if (!response.ok) {
        const parsed = mobileErrorResponseSchema.safeParse(payload);
        const code = parsed.success ? parsed.data.error.code : "request_failed";
        throw new MobileGatewayClientError(code, safeClientMessage(code));
      }
      return payload;
    } catch (error) {
      if (error instanceof MobileGatewayClientError) throw error;
      throw new MobileGatewayClientError("gateway_unavailable", safeClientMessage("gateway_unavailable"), { cause: error });
    } finally {
      clearTimeout(timeout);
    }
  }
}
