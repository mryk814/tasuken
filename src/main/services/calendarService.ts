import fs from "node:fs";
import http from "node:http";
import { createHash, randomBytes } from "node:crypto";
import path from "node:path";
import { URL, URLSearchParams } from "node:url";

import type {
  CalendarAdapter,
  CalendarConnectRequest,
  CalendarConnectionStatus,
  CalendarDisconnectRequest,
  CalendarErrorCode,
  CalendarEvent,
  CalendarEventsResult,
} from "../../shared/calendar";
import { buildCalendarRange } from "../../shared/calendar";
import {
  CalendarProviderError,
  calendarErrorMessage,
  classifyCalendarProviderError,
  MicrosoftCalendarAdapter,
} from "./calendarAdapter";

const MICROSOFT_AUTHORITY = "https://login.microsoftonline.com/common";
const MICROSOFT_SCOPES = "openid profile email offline_access Calendars.ReadBasic";
const OAUTH_TIMEOUT_MS = 120_000;

interface StoredCalendarConfig {
  provider: "microsoft";
  accountName: string;
  encryptedAccessToken: string;
  encryptedRefreshToken?: string;
  tokenExpiresAt: string;
  lastFetchedAt: string;
}

interface StoredCalendarCache {
  provider: "microsoft";
  date: string;
  timeZone: string;
  fetchedAt: string;
  encryptedEvents: string;
}

interface CalendarCacheEntry {
  date: string;
  timeZone: string;
  fetchedAt: string;
  events: CalendarEvent[];
}

export interface SafeStorageAdapter {
  isEncryptionAvailable(): boolean;
  encryptString(value: string): Buffer;
  decryptString(value: Buffer): string;
}

export interface CalendarServiceOptions {
  adapter?: CalendarAdapter;
  clientId?: string;
  timeZone?: string;
}

type FetchLike = typeof fetch;
type ShellOpenLike = (url: string) => Promise<void>;

export class CalendarServiceError extends Error {
  constructor(public readonly code: CalendarErrorCode, message: string) {
    super(message);
    this.name = "CalendarServiceError";
  }
}

function buildDisconnectedStatus(): CalendarConnectionStatus {
  return { provider: null, accountName: "", connected: false, lastFetchedAt: "" };
}

export class CalendarService {
  private readonly configPath: string;
  private readonly cachePath: string;
  private readonly adapter: CalendarAdapter;
  private readonly clientId: string;
  private readonly timeZone: string;
  private cached: CalendarCacheEntry | null = null;
  private pendingConnect: Promise<CalendarConnectionStatus> | null = null;

  constructor(
    userDataPath: string,
    private readonly storage: SafeStorageAdapter,
    private readonly fetcher: FetchLike = fetch,
    private readonly shellOpen: ShellOpenLike = async () => {},
    options: CalendarServiceOptions = {},
  ) {
    this.configPath = path.join(userDataPath, "calendar-provider.json");
    this.cachePath = path.join(userDataPath, "calendar-cache.json");
    this.adapter = options.adapter || new MicrosoftCalendarAdapter(fetcher);
    this.clientId = options.clientId?.trim() || process.env.TASKEN_MICROSOFT_CLIENT_ID?.trim() || "";
    this.timeZone = options.timeZone || Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  }

  getStatus(): CalendarConnectionStatus {
    const config = this.readConfig();
    if (!config || config.provider !== this.adapter.provider || !config.encryptedAccessToken) {
      return buildDisconnectedStatus();
    }
    return {
      provider: config.provider,
      accountName: config.accountName,
      connected: true,
      lastFetchedAt: config.lastFetchedAt || "",
    };
  }

  async connect(request: CalendarConnectRequest): Promise<CalendarConnectionStatus> {
    this.assertProvider(request.provider);
    if (!this.clientId) {
      throw new CalendarServiceError("not_configured", calendarErrorMessage("not_configured"));
    }
    if (!this.storage.isEncryptionAvailable()) {
      throw new CalendarServiceError("storage_unavailable", calendarErrorMessage("storage_unavailable"));
    }
    if (this.pendingConnect) return this.pendingConnect;
    this.pendingConnect = this.performOAuthFlow().finally(() => { this.pendingConnect = null; });
    return this.pendingConnect;
  }

  async disconnect(request: CalendarDisconnectRequest): Promise<CalendarConnectionStatus> {
    this.assertProvider(request.provider);
    // Disconnect is local: remove the locally stored token and cache; provider-side consent is not revoked here.
    try {
      this.removeFile(this.configPath, "カレンダーの認証情報");
      this.removeFile(this.cachePath, "カレンダーキャッシュ");
    } finally {
      this.cached = null;
    }
    return buildDisconnectedStatus();
  }

  async getEvents(date: string): Promise<CalendarEventsResult> {
    const range = buildCalendarRange(date, this.timeZone);
    const config = this.readConfig();
    if (!config || !config.encryptedAccessToken) {
      throw new CalendarServiceError("not_connected", calendarErrorMessage("not_connected"));
    }

    try {
      const accessToken = await this.ensureValidToken(config);
      const events = await this.adapter.listEvents(accessToken, range);
      const fetchedAt = new Date().toISOString();
      try {
        this.writeCache({ date, timeZone: range.timeZone, fetchedAt, events });
        this.updateLastFetchedAt(fetchedAt);
      } catch {
        /* A provider result remains usable when the optional local cache cannot be refreshed. */
      }
      return {
        provider: this.adapter.provider,
        events,
        fetchedAt,
        timeZone: range.timeZone,
        stale: false,
      };
    } catch (error) {
      const failure = normalizeCalendarError(error);
      const cached = this.getCachedEvents(date, range.timeZone);
      if (cached) {
        return {
          provider: this.adapter.provider,
          events: cached.events,
          fetchedAt: cached.fetchedAt,
          timeZone: range.timeZone,
          stale: true,
          error: failure.message,
          errorCode: failure.code,
        };
      }
      return {
        provider: this.adapter.provider,
        events: [],
        fetchedAt: "",
        timeZone: range.timeZone,
        stale: false,
        error: failure.message,
        errorCode: failure.code,
      };
    }
  }

  private assertProvider(provider: CalendarConnectRequest["provider"]): void {
    if (provider !== this.adapter.provider) {
      throw new CalendarServiceError("unsupported_provider", calendarErrorMessage("unsupported_provider"));
    }
  }

  private async performOAuthFlow(): Promise<CalendarConnectionStatus> {
    const codeVerifier = base64url(randomBytes(32));
    const codeChallenge = base64url(createHash("sha256").update(codeVerifier).digest());
    const state = randomBytes(16).toString("hex");
    const { code, redirectUri } = await this.listenForAuthCode(state, codeChallenge);
    const tokenResponse = await this.fetcher(
      `${MICROSOFT_AUTHORITY}/oauth2/v2.0/token`,
      {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          client_id: this.clientId,
          scope: MICROSOFT_SCOPES,
          code,
          redirect_uri: redirectUri,
          grant_type: "authorization_code",
          code_verifier: codeVerifier,
        }).toString(),
      },
    );
    if (!tokenResponse.ok) {
      const body = await tokenResponse.text().catch(() => "");
      throw classifyCalendarProviderError(tokenResponse.status, body, "authentication_required");
    }
    const tokens = await readTokenResponse(tokenResponse);
    if (!tokens.access_token) {
      throw new CalendarServiceError("invalid_response", calendarErrorMessage("invalid_response"));
    }

    const accountName = decodeAccountName(tokens.id_token) || "Microsoft account";
    this.removeFile(this.cachePath, "切替前のカレンダーキャッシュ");
    this.cached = null;
    const expiresAt = new Date(Date.now() + (tokens.expires_in || 3600) * 1000).toISOString();
    this.writeConfig({
      provider: "microsoft",
      accountName,
      encryptedAccessToken: this.encryptToken(tokens.access_token),
      encryptedRefreshToken: tokens.refresh_token ? this.encryptToken(tokens.refresh_token) : undefined,
      tokenExpiresAt: expiresAt,
      lastFetchedAt: "",
    });
    return { provider: "microsoft", accountName, connected: true, lastFetchedAt: "" };
  }

  private listenForAuthCode(state: string, codeChallenge: string): Promise<{ code: string; redirectUri: string }> {
    return new Promise((resolve, reject) => {
      const server = http.createServer((req, res) => {
        const url = new URL(req.url || "/", "http://127.0.0.1");
        const returnedState = url.searchParams.get("state");
        const code = url.searchParams.get("code");
        const error = url.searchParams.get("error") || "";
        const errorDescription = url.searchParams.get("error_description") || "";

        if (returnedState !== state || (!code && !error)) {
          res.writeHead(400, { "Content-Type": "text/html; charset=utf-8" });
          res.end("<html><body><h2>不正なリクエストです</h2><p>このタブを閉じてTaskenから再試行してください。</p></body></html>");
          return;
        }
        if (error) {
          res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
          res.end("<html><body><h2>接続に失敗しました</h2><p>このタブを閉じてTaskenに戻ってください。</p></body></html>");
          cleanup();
          reject(classifyOAuthError(error, errorDescription));
          return;
        }
        if (!code) return;
        res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
        res.end("<html><body><h2>接続が完了しました</h2><p>このタブを閉じてTaskenに戻ってください。</p></body></html>");
        const address = server.address() as { port: number };
        cleanup();
        resolve({ code, redirectUri: `http://127.0.0.1:${address.port}` });
      });

      const timeout = setTimeout(() => {
        cleanup();
        reject(new CalendarServiceError("authentication_required", "認証がタイムアウトしました。再度接続してください。"));
      }, OAUTH_TIMEOUT_MS);

      function cleanup() {
        clearTimeout(timeout);
        try {
          server.close();
        } catch {
          /* The server may already be closed after a completed callback. */
        }
      }

      server.listen(0, "127.0.0.1", () => {
        const address = server.address() as { port: number };
        const redirectUri = `http://127.0.0.1:${address.port}`;
        const authorizeUrl = `${MICROSOFT_AUTHORITY}/oauth2/v2.0/authorize?${new URLSearchParams({
          client_id: this.clientId,
          response_type: "code",
          redirect_uri: redirectUri,
          scope: MICROSOFT_SCOPES,
          state,
          code_challenge: codeChallenge,
          code_challenge_method: "S256",
        })}`;
        this.shellOpen(authorizeUrl).catch(() => {
          cleanup();
          reject(new CalendarServiceError("authentication_required", "ブラウザを開けませんでした。Settingsから再試行してください。"));
        });
      });

      server.on("error", () => {
        cleanup();
        reject(new CalendarServiceError("authentication_required", "認証用サーバーを起動できませんでした。再度接続してください。"));
      });
    });
  }

  private async ensureValidToken(config: StoredCalendarConfig): Promise<string> {
    const expiresAt = new Date(config.tokenExpiresAt).getTime();
    const bufferMs = 5 * 60 * 1000;
    if (config.encryptedAccessToken && Number.isFinite(expiresAt) && Date.now() < expiresAt - bufferMs) {
      return this.decryptToken(config.encryptedAccessToken);
    }
    if (!config.encryptedRefreshToken) {
      throw new CalendarServiceError("token_expired", calendarErrorMessage("token_expired"));
    }

    const refreshToken = this.decryptToken(config.encryptedRefreshToken);
    const response = await this.fetcher(`${MICROSOFT_AUTHORITY}/oauth2/v2.0/token`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: this.clientId,
        refresh_token: refreshToken,
        grant_type: "refresh_token",
      }).toString(),
    });
    if (!response.ok) {
      const body = await response.text().catch(() => "");
      throw classifyCalendarProviderError(response.status, body, "token_expired");
    }
    const tokens = await readTokenResponse(response);
    if (!tokens.access_token) throw new CalendarServiceError("invalid_response", calendarErrorMessage("invalid_response"));
    const updated: StoredCalendarConfig = {
      ...config,
      encryptedAccessToken: this.encryptToken(tokens.access_token),
      encryptedRefreshToken: tokens.refresh_token ? this.encryptToken(tokens.refresh_token) : config.encryptedRefreshToken,
      tokenExpiresAt: new Date(Date.now() + (tokens.expires_in || 3600) * 1000).toISOString(),
    };
    this.writeConfig(updated);
    return tokens.access_token;
  }

  private getCachedEvents(date: string, timeZone: string): CalendarCacheEntry | null {
    if (this.cached && this.cached.date === date && this.cached.timeZone === timeZone) return this.cached;
    const stored = this.readCache();
    if (!stored || stored.date !== date || stored.timeZone !== timeZone) return null;
    this.cached = stored;
    return stored;
  }

  private readConfig(): StoredCalendarConfig | null {
    if (!fs.existsSync(this.configPath)) return null;
    try {
      const value = JSON.parse(fs.readFileSync(this.configPath, "utf8")) as Partial<StoredCalendarConfig>;
      if (value.provider !== "microsoft" || typeof value.accountName !== "string" || typeof value.encryptedAccessToken !== "string") return null;
      return value as StoredCalendarConfig;
    } catch {
      /* A corrupt local credential file is treated as disconnected and never logged. */
      return null;
    }
  }

  private readCache(): CalendarCacheEntry | null {
    if (!this.storage.isEncryptionAvailable() || !fs.existsSync(this.cachePath)) return null;
    try {
      const stored = JSON.parse(fs.readFileSync(this.cachePath, "utf8")) as Partial<StoredCalendarCache>;
      if (
        stored.provider !== "microsoft"
        || typeof stored.date !== "string"
        || typeof stored.timeZone !== "string"
        || typeof stored.fetchedAt !== "string"
        || typeof stored.encryptedEvents !== "string"
      ) return null;
      const payload = JSON.parse(this.storage.decryptString(Buffer.from(stored.encryptedEvents, "base64"))) as Partial<CalendarCacheEntry>;
      if (!Array.isArray(payload.events)) return null;
      return {
        date: stored.date,
        timeZone: stored.timeZone,
        fetchedAt: stored.fetchedAt,
        events: payload.events as CalendarEvent[],
      };
    } catch {
      /* A corrupt cache is recoverable by a fresh provider fetch. */
      return null;
    }
  }

  private writeCache(cache: CalendarCacheEntry): void {
    if (!this.storage.isEncryptionAvailable()) return;
    const stored: StoredCalendarCache = {
      provider: "microsoft",
      date: cache.date,
      timeZone: cache.timeZone,
      fetchedAt: cache.fetchedAt,
      encryptedEvents: this.storage.encryptString(JSON.stringify({ events: cache.events })).toString("base64"),
    };
    fs.mkdirSync(path.dirname(this.cachePath), { recursive: true });
    fs.writeFileSync(this.cachePath, `${JSON.stringify(stored, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
    this.cached = cache;
  }

  private writeConfig(config: StoredCalendarConfig): void {
    fs.mkdirSync(path.dirname(this.configPath), { recursive: true });
    fs.writeFileSync(this.configPath, `${JSON.stringify(config, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
  }

  private updateLastFetchedAt(fetchedAt: string): void {
    const config = this.readConfig();
    if (config) this.writeConfig({ ...config, lastFetchedAt: fetchedAt });
  }

  private encryptToken(token: string): string {
    try {
      return this.storage.encryptString(token).toString("base64");
    } catch {
      throw new CalendarServiceError("storage_unavailable", calendarErrorMessage("storage_unavailable"));
    }
  }

  private decryptToken(encryptedToken: string): string {
    try {
      return this.storage.decryptString(Buffer.from(encryptedToken, "base64"));
    } catch {
      throw new CalendarServiceError("storage_unavailable", calendarErrorMessage("storage_unavailable"));
    }
  }

  private removeFile(filePath: string, label: string): void {
    if (!fs.existsSync(filePath)) return;
    try {
      fs.unlinkSync(filePath);
    } catch {
      throw new CalendarServiceError("storage_unavailable", `${label}を削除できませんでした。アプリを再起動して再試行してください。`);
    }
  }
}

function base64url(buffer: Buffer): string {
  return buffer.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function classifyOAuthError(error: string, description: string): CalendarProviderError {
  if (error === "access_denied") {
    return new CalendarProviderError("permission_denied", calendarErrorMessage("permission_denied"));
  }
  return classifyCalendarProviderError(400, `${error} ${description}`, "consent_required");
}

function normalizeCalendarError(error: unknown): { code: CalendarErrorCode; message: string } {
  if (error instanceof CalendarProviderError || error instanceof CalendarServiceError) {
    return { code: error.code, message: error.message };
  }
  return { code: "unknown", message: calendarErrorMessage("unknown") };
}

async function readTokenResponse(response: Response): Promise<{
  access_token?: string;
  refresh_token?: string;
  expires_in?: number;
  id_token?: string;
}> {
  try {
    const value = await response.json() as Record<string, unknown>;
    return {
      access_token: typeof value.access_token === "string" ? value.access_token : undefined,
      refresh_token: typeof value.refresh_token === "string" ? value.refresh_token : undefined,
      expires_in: typeof value.expires_in === "number" ? value.expires_in : undefined,
      id_token: typeof value.id_token === "string" ? value.id_token : undefined,
    };
  } catch {
    throw new CalendarServiceError("invalid_response", calendarErrorMessage("invalid_response"));
  }
}

function decodeAccountName(idToken: string | undefined): string {
  if (!idToken) return "";
  try {
    const payload = idToken.split(".")[1];
    if (!payload) return "";
    const value = JSON.parse(Buffer.from(payload.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8")) as Record<string, unknown>;
    for (const key of ["name", "preferred_username", "email"]) {
      if (typeof value[key] === "string" && value[key]) return value[key];
    }
  } catch {
    /* The account label is optional; a malformed ID token must not block calendar access. */
  }
  return "";
}
