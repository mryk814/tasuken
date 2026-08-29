import { createHash } from "node:crypto";
import http, { type IncomingMessage, type ServerResponse } from "node:http";

import {
  TASKEN_MOBILE_API_VERSION,
  TASKEN_MOBILE_ENDPOINTS,
  TASKEN_MOBILE_SCHEMA_VERSION,
  mobileErrorResponseSchema,
  mobilePairRequestSchema,
  mobilePairResponseSchema,
  mobileResponseMetaSchema,
  type MobileErrorCode,
  type MobileResponseMeta,
} from "../../../shared/contracts/mobile/public.ts";
import type {
  MobileGatewayAdapter,
  MobileGatewayResponse,
  MobileGatewayStatePort,
} from "./mobileGatewayAdapter.ts";
import { MobileDeviceRegistry, MobileDeviceRegistryError } from "./mobileDeviceRegistry.ts";

const LOOPBACK_HOST = "127.0.0.1";
const DEFAULT_PORT = 48_177;
const MAX_BODY_BYTES = 64 * 1024;
const REQUEST_TIMEOUT_MS = 5_000;
const RATE_WINDOW_MS = 60_000;
const REQUESTS_PER_WINDOW = 120;
const PAIR_REQUESTS_PER_WINDOW = 10;

interface RateWindow {
  startedAt: number;
  count: number;
}

export interface MobileGatewayRequestDiagnostic {
  at: string;
  method: string;
  path: string;
  status: number;
  deviceId: string;
}

export interface MobileGatewayHostDiagnostics {
  status: "stopped" | "ready" | "error";
  localOrigin: string;
  port: number;
  startedAt: string;
  lastError: string;
  latestRequest: MobileGatewayRequestDiagnostic | null;
}

export interface MobileGatewayHostOptions {
  adapter: MobileGatewayAdapter;
  devices: MobileDeviceRegistry;
  state: MobileGatewayStatePort;
  port?: number;
  now?: () => Date;
  logger?: { warn(event: { id: string; location: "MobileGatewayHost.handle" }): void };
}

class MobileGatewayHostRequestError extends Error {
  readonly code: MobileErrorCode;

  constructor(code: MobileErrorCode) {
    super(code);
    this.name = "MobileGatewayHostRequestError";
    this.code = code;
  }
}

function json(
  response: ServerResponse,
  status: number,
  body: unknown,
  headers: Readonly<Record<string, string>> = {},
) {
  const encoded = JSON.stringify(body);
  response.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(encoded),
    "cache-control": "no-store",
    "x-content-type-options": "nosniff",
    "x-tasken-mobile-api-version": String(TASKEN_MOBILE_API_VERSION),
    ...headers,
  });
  response.end(encoded);
}

function bearerToken(request: IncomingMessage): string {
  const value = request.headers.authorization;
  if (!value || !value.startsWith("Bearer ")) return "";
  return value.slice("Bearer ".length);
}

function rateKey(value: string): string {
  return createHash("sha256")
    .update(value || "anonymous", "utf8")
    .digest("hex");
}

async function requestBody(request: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buffer.length;
    if (size > MAX_BODY_BYTES) throw new MobileGatewayHostRequestError("response_too_large");
    chunks.push(buffer);
  }
  if (size === 0) throw new MobileGatewayHostRequestError("validation_failed");
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw new MobileGatewayHostRequestError("validation_failed");
  }
}

function safeMessage(code: MobileErrorCode): string {
  const messages: Record<MobileErrorCode, string> = {
    unauthorized: "端末を認証できません。再ペアリングしてください。",
    forbidden: "この操作は端末へ許可されていません。",
    validation_failed: "リクエストが不正です。アプリを更新して再試行してください。",
    pairing_code_invalid: "ペアリングコードが無効または期限切れです。",
    rate_limited: "リクエストが多すぎます。少し待って再試行してください。",
    not_found: "Mobile API endpointが見つかりません。",
    theme_not_found: "選択したThemeは削除済みか利用できません。",
    method_not_allowed: "このmethodは利用できません。",
    version_mismatch: "Mobile API versionが一致しません。アプリを更新してください。",
    idempotency_conflict: "同じcommandIdが異なる内容で使用されています。",
    entity_conflict: "同じ端末またはTask IDが既に存在します。",
    version_conflict: "Taskが更新されています。再読み込みして再試行してください。",
    proposal_conflict: "Proposalまたは対象Taskが更新されています。再読み込みしてください。",
    work_review_conflict:
      "Work Receiptまたは作業状態が更新されています。最新の内容を確認してください。",
    capability_unavailable: "必要なTasken Core capabilityを利用できません。",
    upstream_unavailable: "Tasken Coreを利用できません。Desktopの状態を確認してください。",
    response_too_large: "requestまたはresponseが上限を超えました。",
    internal_error: "Mobile API処理を完了できませんでした。",
  };
  return messages[code];
}

export class MobileGatewayHost {
  private readonly options: MobileGatewayHostOptions;
  private readonly now: () => Date;
  private port: number;
  private readonly rates = new Map<string, RateWindow>();
  private server: http.Server | null = null;
  private startedAt = "";
  private lastError = "";
  private latestRequest: MobileGatewayRequestDiagnostic | null = null;

  constructor(options: MobileGatewayHostOptions) {
    this.options = options;
    this.now = options.now || (() => new Date());
    this.port = options.port ?? DEFAULT_PORT;
    if (!Number.isInteger(this.port) || this.port < 0 || this.port > 65_535) {
      throw new Error("Mobile Gateway port is invalid");
    }
  }

  async start(): Promise<void> {
    if (this.server) return;
    const server = http.createServer((request, response) => void this.handle(request, response));
    server.requestTimeout = REQUEST_TIMEOUT_MS;
    server.headersTimeout = REQUEST_TIMEOUT_MS;
    try {
      await new Promise<void>((resolve, reject) => {
        server.once("error", reject);
        server.listen(this.port, LOOPBACK_HOST, () => {
          server.off("error", reject);
          resolve();
        });
      });
      const address = server.address();
      if (typeof address === "object" && address) {
        this.port = address.port;
      }
      this.server = server;
      this.startedAt = this.now().toISOString();
      this.lastError = "";
    } catch (error) {
      server.closeAllConnections?.();
      this.lastError = error instanceof Error ? error.message : "Mobile Gateway failed to start";
      throw error;
    }
  }

  async stop(): Promise<void> {
    const server = this.server;
    this.server = null;
    if (!server) return;
    await new Promise<void>((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
      server.closeIdleConnections?.();
      server.closeAllConnections?.();
    });
    this.startedAt = "";
  }

  diagnostics(): MobileGatewayHostDiagnostics {
    return {
      status: this.server ? "ready" : this.lastError ? "error" : "stopped",
      localOrigin: "http://" + LOOPBACK_HOST + ":" + this.port,
      port: this.port,
      startedAt: this.startedAt,
      lastError: this.lastError,
      latestRequest: this.latestRequest ? { ...this.latestRequest } : null,
    };
  }

  private takeRate(key: string, limit: number): boolean {
    const now = this.now().getTime();
    const current = this.rates.get(key);
    if (!current || now - current.startedAt >= RATE_WINDOW_MS) {
      this.rates.set(key, { startedAt: now, count: 1 });
      return true;
    }
    current.count += 1;
    return current.count <= limit;
  }

  private meta(): MobileResponseMeta {
    const state = this.options.state.current();
    return mobileResponseMetaSchema.parse({
      apiVersion: TASKEN_MOBILE_API_VERSION,
      schemaVersion: TASKEN_MOBILE_SCHEMA_VERSION,
      serverId: state.serverId,
      serverRevision: state.serverRevision,
      generatedAt: state.generatedAt,
      truncated: false,
    });
  }

  private error(code: MobileErrorCode) {
    return mobileErrorResponseSchema.parse({
      ok: false,
      meta: this.meta(),
      error: {
        code,
        message: safeMessage(code),
        retryable:
          code === "rate_limited" || code === "upstream_unavailable" || code === "internal_error",
      },
    });
  }

  private record(method: string, path: string, status: number, deviceId = ""): void {
    this.latestRequest = { at: this.now().toISOString(), method, path, status, deviceId };
  }

  private async handle(request: IncomingMessage, response: ServerResponse): Promise<void> {
    const method = request.method || "";
    let path = "";
    let deviceId = "";
    try {
      const url = new URL(request.url || "/", "http://" + LOOPBACK_HOST);
      path = url.pathname;
      if (method !== "GET" && method !== "POST") {
        throw new MobileGatewayHostRequestError("method_not_allowed");
      }
      if (request.headers.origin) throw new MobileGatewayHostRequestError("forbidden");
      if (path === TASKEN_MOBILE_ENDPOINTS.pair) {
        if (method !== "POST") throw new MobileGatewayHostRequestError("method_not_allowed");
        const pairKey = "pair:" + (request.socket.remoteAddress || "unknown");
        if (!this.takeRate(pairKey, PAIR_REQUESTS_PER_WINDOW))
          throw new MobileGatewayHostRequestError("rate_limited");
        const parsed = mobilePairRequestSchema.safeParse(await requestBody(request));
        if (!parsed.success) throw new MobileGatewayHostRequestError("validation_failed");
        const result = this.options.devices.pair({
          code: parsed.data.pairingCode,
          deviceId: parsed.data.clientDeviceId,
          deviceLabel: parsed.data.deviceLabel,
        });
        const body = mobilePairResponseSchema.parse({
          ok: true,
          meta: this.meta(),
          data: {
            deviceId: result.device.id,
            deviceLabel: result.device.label,
            accessToken: result.accessToken,
            scopes: result.device.scopes,
            pairedAt: result.device.updatedAt,
          },
        });
        this.record(method, path, 200, result.device.id);
        json(response, 200, body);
        return;
      }

      const token = bearerToken(request);
      if (!this.takeRate("token:" + rateKey(token), REQUESTS_PER_WINDOW)) {
        throw new MobileGatewayHostRequestError("rate_limited");
      }
      const principal = this.options.devices.authenticate(token);
      deviceId = principal?.deviceId || "";
      let body: unknown;
      if (method === "POST") {
        body = await requestBody(request);
      } else if (request.headers["content-length"] || request.headers["transfer-encoding"]) {
        request.resume();
        throw new MobileGatewayHostRequestError("validation_failed");
      }
      const query: Record<string, string> = {};
      for (const [key, value] of url.searchParams) {
        if (Object.prototype.hasOwnProperty.call(query, key))
          throw new MobileGatewayHostRequestError("validation_failed");
        query[key] = value;
      }
      const result: MobileGatewayResponse = await this.options.adapter.handle({
        method: method === "POST" ? "POST" : "GET",
        path,
        query,
        body,
        principal,
      });
      this.record(method, path, result.status, deviceId);
      json(response, result.status, result.body, result.headers);
    } catch (error) {
      let code: MobileErrorCode = "internal_error";
      if (error instanceof MobileGatewayHostRequestError) code = error.code;
      if (error instanceof MobileDeviceRegistryError) code = error.code;
      const status =
        code === "unauthorized" || code === "pairing_code_invalid"
          ? 401
          : code === "forbidden"
            ? 403
            : code === "not_found" || code === "theme_not_found"
              ? 404
              : code === "method_not_allowed"
                ? 405
                : code === "rate_limited"
                  ? 429
                  : code === "entity_conflict" || code === "version_conflict"
                    ? 409
                    : code === "response_too_large"
                      ? 413
                      : code === "internal_error"
                        ? 500
                        : 400;
      this.record(method, path || "/", status, deviceId);
      if (code === "internal_error") {
        try {
          this.options.logger?.warn({
            id: this.latestRequest?.at || "unknown",
            location: "MobileGatewayHost.handle",
          });
        } catch {
          // Logging must not replace the sanitized API response.
        }
      }
      json(response, status, this.error(code));
    }
  }
}
