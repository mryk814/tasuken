import {
  TASKEN_MOBILE_API_VERSION,
  TASKEN_MOBILE_CAPABILITIES,
  TASKEN_MOBILE_CLIENT_TIMEOUT_MS,
  TASKEN_MOBILE_ENDPOINTS,
  TASKEN_MOBILE_MAX_RESPONSE_BYTES,
  mobileTaskCommandRequestSchema,
  mobileTaskCommandResponseSchema,
  mobileErrorResponseSchema,
  mobileHealthResponseSchema,
  mobileThemesRequestSchema,
  mobileThemesResponseSchema,
  mobileTodayRequestSchema,
  mobileTodayResponseSchema,
  type MobileCapability,
  type MobileTaskCommandRequest,
  type MobileThemesRequest,
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
  if (code === "entity_conflict") return "同じTask IDが既に存在します。新しいIDで再試行してください。";
  if (code === "version_conflict") return "Taskが更新されています。再読み込みして再試行してください。";
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
    const parsed = mobileTodayRequestSchema.parse(input);
    await this.requireCapability(TASKEN_MOBILE_CAPABILITIES.todayRead);
    const query = new URLSearchParams({
      apiVersion: String(parsed.apiVersion),
      schemaVersion: String(parsed.schemaVersion),
      requestId: parsed.requestId,
      date: parsed.date,
      limit: String(parsed.limit),
    });
    return mobileTodayResponseSchema.parse(await this.request("GET", `${TASKEN_MOBILE_ENDPOINTS.today}?${query}`));
  }

  async listThemes(input: MobileThemesRequest) {
    const parsed = mobileThemesRequestSchema.parse(input);
    const query = new URLSearchParams({
      apiVersion: String(parsed.apiVersion),
      schemaVersion: String(parsed.schemaVersion),
      requestId: parsed.requestId,
      limit: String(parsed.limit),
      ...(parsed.cursor ? { cursor: parsed.cursor } : {}),
    });
    return mobileThemesResponseSchema.parse(await this.request("GET", `${TASKEN_MOBILE_ENDPOINTS.themes}?${query}`));
  }

  async executeTaskCommand(input: MobileTaskCommandRequest) {
    mobileTaskCommandRequestSchema.parse(input);
    await this.requireCapability(TASKEN_MOBILE_CAPABILITIES.taskWrite);
    return mobileTaskCommandResponseSchema.parse(await this.request("POST", TASKEN_MOBILE_ENDPOINTS.commands, input));
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
      const text = await this.readBounded(response, controller.signal);
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

  private async readBounded(response: Response, signal: AbortSignal): Promise<string> {
    if (!response.body) throw new MobileGatewayClientError("invalid_response", "Mobile Gateway responseが不正です。");
    const reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let size = 0;
    let rejectAborted!: (reason?: unknown) => void;
    const aborted = new Promise<never>((_resolve, reject) => {
      rejectAborted = reject;
    });
    const onAbort = () => {
      rejectAborted(new Error("Mobile Gateway response timed out"));
      // Timeout is authoritative; a stream-level cancel failure must not keep the request pending.
      void reader.cancel().catch(() => undefined);
    };
    if (signal.aborted) onAbort();
    else signal.addEventListener("abort", onAbort, { once: true });
    try {
      const declaredLength = Number(response.headers.get("content-length") || "0");
      if (Number.isFinite(declaredLength) && declaredLength > this.maxResponseBytes) {
        // The size violation is authoritative; a transport-level cancel failure must not replace it.
        await reader.cancel().catch(() => undefined);
        throw new MobileGatewayClientError("response_too_large", safeClientMessage("response_too_large"));
      }
      while (true) {
        const { done, value } = await Promise.race([reader.read(), aborted]);
        if (done) break;
        size += value.byteLength;
        if (size > this.maxResponseBytes) {
          // The size violation is authoritative; a transport-level cancel failure must not replace it.
          await reader.cancel().catch(() => undefined);
          throw new MobileGatewayClientError("response_too_large", safeClientMessage("response_too_large"));
        }
        chunks.push(value);
      }
    } finally {
      signal.removeEventListener("abort", onAbort);
      reader.releaseLock();
    }
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.byteLength;
    }
    return new TextDecoder().decode(bytes);
  }
}
