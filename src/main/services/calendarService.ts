import fs from "node:fs";
import http from "node:http";
import { randomBytes, createHash } from "node:crypto";
import path from "node:path";
import { URL, URLSearchParams } from "node:url";

import type {
  CalendarConnectRequest,
  CalendarConnectionStatus,
  CalendarDisconnectRequest,
  CalendarEvent,
  CalendarEventsResult,
} from "../../shared/calendar";

const MICROSOFT_CLIENT_ID = "PLACEHOLDER_CLIENT_ID";
const MICROSOFT_AUTHORITY = "https://login.microsoftonline.com/common";
const MICROSOFT_GRAPH_BASE = "https://graph.microsoft.com/v1.0";
const SCOPES = "Calendars.Read User.Read offline_access";
const OAUTH_TIMEOUT_MS = 120_000;

interface StoredCalendarConfig {
  provider: "microsoft";
  accountName: string;
  encryptedAccessToken?: string;
  encryptedRefreshToken?: string;
  tokenExpiresAt: string;
  lastFetchedAt: string;
}

interface SafeStorageAdapter {
  isEncryptionAvailable(): boolean;
  encryptString(value: string): Buffer;
  decryptString(value: Buffer): string;
}

type FetchLike = typeof fetch;
type ShellOpenLike = (url: string) => Promise<void>;

function base64url(buffer: Buffer): string {
  return buffer.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function buildDisconnectedStatus(): CalendarConnectionStatus {
  return { provider: null, accountName: "", connected: false, lastFetchedAt: "" };
}

export class CalendarService {
  private readonly configPath: string;
  private cachedEvents: CalendarEvent[] = [];
  private cachedFetchedAt = "";
  private pendingConnect: Promise<CalendarConnectionStatus> | null = null;

  constructor(
    userDataPath: string,
    private readonly storage: SafeStorageAdapter,
    private readonly fetcher: FetchLike = fetch,
    private readonly shellOpen: ShellOpenLike = async () => {},
  ) {
    this.configPath = path.join(userDataPath, "calendar-provider.json");
  }

  getStatus(): CalendarConnectionStatus {
    const config = this.readConfig();
    if (!config) return buildDisconnectedStatus();
    return {
      provider: "microsoft",
      accountName: config.accountName,
      connected: true,
      lastFetchedAt: config.lastFetchedAt || "",
    };
  }

  async connect(request: CalendarConnectRequest): Promise<CalendarConnectionStatus> {
    if (request.provider !== "microsoft") {
      throw new Error("対応していないカレンダープロバイダーです。");
    }
    if (MICROSOFT_CLIENT_ID === "PLACEHOLDER_CLIENT_ID") {
      throw new Error(
        "Microsoft Graph APIのクライアントIDが未設定です。" +
        "Azure Portal でアプリを登録し、calendarService.ts の MICROSOFT_CLIENT_ID を設定してください。",
      );
    }
    if (!this.storage.isEncryptionAvailable()) {
      throw new Error("この端末では資格情報を安全に暗号化できません。OSの資格情報保護を有効にしてください。");
    }
    if (this.pendingConnect) return this.pendingConnect;
    this.pendingConnect = this.performOAuthFlow().finally(() => { this.pendingConnect = null; });
    return this.pendingConnect;
  }

  async disconnect(_request: CalendarDisconnectRequest): Promise<CalendarConnectionStatus> {
    try { fs.unlinkSync(this.configPath); } catch { /* already absent */ }
    this.cachedEvents = [];
    this.cachedFetchedAt = "";
    return buildDisconnectedStatus();
  }

  async getEvents(date: string): Promise<CalendarEventsResult> {
    const config = this.readConfig();
    if (!config) {
      throw new Error("カレンダーが接続されていません。Settingsから接続してください。");
    }
    try {
      const accessToken = await this.ensureValidToken(config);
      const startDateTime = `${date}T00:00:00`;
      const endDateTime = `${date}T23:59:59`;
      const params = new URLSearchParams({
        startDateTime,
        endDateTime,
        $select: "id,subject,start,end,isAllDay,location,onlineMeetingUrl,sensitivity,calendar",
        $orderby: "start/dateTime",
        $top: "50",
      });
      const response = await this.fetcher(
        `${MICROSOFT_GRAPH_BASE}/me/calendarview?${params}`,
        {
          headers: {
            Authorization: `Bearer ${accessToken}`,
            Prefer: 'outlook.timezone="Asia/Tokyo"',
          },
        },
      );
      if (!response.ok) {
        const errorBody = await response.text().catch(() => "");
        if (response.status === 401 || response.status === 403) {
          throw new Error(`カレンダーへのアクセスが拒否されました（HTTP ${response.status}）。Settingsから再接続してください。`);
        }
        throw new Error(`カレンダーAPIが応答しませんでした（HTTP ${response.status}）。${errorBody.slice(0, 200)}`);
      }
      const data = await response.json() as { value?: unknown[] };
      const events = Array.isArray(data.value) ? data.value.map(parseGraphEvent) : [];
      const fetchedAt = new Date().toISOString();
      this.cachedEvents = events;
      this.cachedFetchedAt = fetchedAt;
      this.updateLastFetchedAt(fetchedAt);
      return { provider: "microsoft", events, fetchedAt, stale: false };
    } catch (error) {
      if (this.cachedEvents.length > 0) {
        return {
          provider: "microsoft",
          events: this.cachedEvents,
          fetchedAt: this.cachedFetchedAt,
          stale: true,
          error: error instanceof Error ? error.message : String(error),
        };
      }
      return {
        provider: "microsoft",
        events: [],
        fetchedAt: "",
        stale: false,
        error: error instanceof Error ? error.message : String(error),
      };
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
          client_id: MICROSOFT_CLIENT_ID,
          scope: SCOPES,
          code,
          redirect_uri: redirectUri,
          grant_type: "authorization_code",
          code_verifier: codeVerifier,
        }).toString(),
      },
    );
    if (!tokenResponse.ok) {
      const body = await tokenResponse.text().catch(() => "");
      throw new Error(`トークンの取得に失敗しました（HTTP ${tokenResponse.status}）。${body.slice(0, 200)}`);
    }
    const tokens = await tokenResponse.json() as {
      access_token?: string;
      refresh_token?: string;
      expires_in?: number;
    };
    if (!tokens.access_token) throw new Error("アクセストークンが取得できませんでした。");

    const meResponse = await this.fetcher(`${MICROSOFT_GRAPH_BASE}/me`, {
      headers: { Authorization: `Bearer ${tokens.access_token}` },
    });
    const me = meResponse.ok ? await meResponse.json() as { displayName?: string; mail?: string; userPrincipalName?: string } : {};
    const accountName = me.displayName || me.mail || me.userPrincipalName || "Microsoft";

    const expiresAt = new Date(Date.now() + (tokens.expires_in || 3600) * 1000).toISOString();
    const config: StoredCalendarConfig = {
      provider: "microsoft",
      accountName,
      encryptedAccessToken: this.storage.encryptString(tokens.access_token).toString("base64"),
      encryptedRefreshToken: tokens.refresh_token
        ? this.storage.encryptString(tokens.refresh_token).toString("base64")
        : undefined,
      tokenExpiresAt: expiresAt,
      lastFetchedAt: "",
    };
    this.writeConfig(config);
    return { provider: "microsoft", accountName, connected: true, lastFetchedAt: "" };
  }

  private listenForAuthCode(state: string, codeChallenge: string): Promise<{ code: string; redirectUri: string }> {
    return new Promise((resolve, reject) => {
      const server = http.createServer((req, res) => {
        const url = new URL(req.url || "/", `http://localhost`);
        const returnedState = url.searchParams.get("state");
        const code = url.searchParams.get("code");
        const error = url.searchParams.get("error");
        const errorDescription = url.searchParams.get("error_description");

        res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
        if (error) {
          res.end("<html><body><h2>接続に失敗しました</h2><p>このタブを閉じてTaskenに戻ってください。</p></body></html>");
          cleanup();
          reject(new Error(
            errorDescription
              ? `カレンダー接続が拒否されました: ${errorDescription}`
              : `カレンダー接続が拒否されました（${error}）。組織のポリシーでアプリへのカレンダー権限付与が制限されている可能性があります。個人アカウントで試すか、IT管理者に確認してください。`,
          ));
          return;
        }
        if (returnedState !== state || !code) {
          res.end("<html><body><h2>不正なリクエストです</h2><p>このタブを閉じてTaskenから再試行してください。</p></body></html>");
          cleanup();
          reject(new Error("OAuthの応答が不正です。再度接続してください。"));
          return;
        }
        res.end("<html><body><h2>接続が完了しました</h2><p>このタブを閉じてTaskenに戻ってください。</p></body></html>");
        const address = server.address() as { port: number };
        cleanup();
        resolve({ code, redirectUri: `http://localhost:${address.port}` });
      });

      const timeout = setTimeout(() => {
        cleanup();
        reject(new Error("認証がタイムアウトしました。再度接続してください。"));
      }, OAUTH_TIMEOUT_MS);

      function cleanup() {
        clearTimeout(timeout);
        try { server.close(); } catch { /* ignore */ }
      }

      server.listen(0, "127.0.0.1", () => {
        const address = server.address() as { port: number };
        const redirectUri = `http://localhost:${address.port}`;
        const authorizeUrl = `${MICROSOFT_AUTHORITY}/oauth2/v2.0/authorize?${new URLSearchParams({
          client_id: MICROSOFT_CLIENT_ID,
          response_type: "code",
          redirect_uri: redirectUri,
          scope: SCOPES,
          state,
          code_challenge: codeChallenge,
          code_challenge_method: "S256",
        })}`;
        this.shellOpen(authorizeUrl).catch((err: unknown) => {
          cleanup();
          reject(new Error(`ブラウザを開けませんでした。${err instanceof Error ? err.message : String(err)}`));
        });
      });

      server.on("error", (err) => {
        cleanup();
        reject(new Error(`認証用サーバーの起動に失敗しました。${err.message}`));
      });
    });
  }

  private async ensureValidToken(config: StoredCalendarConfig): Promise<string> {
    if (!config.encryptedAccessToken) {
      throw new Error("アクセストークンが保存されていません。Settingsから再接続してください。");
    }
    const expiresAt = new Date(config.tokenExpiresAt).getTime();
    const bufferMs = 5 * 60 * 1000;
    if (Date.now() < expiresAt - bufferMs) {
      return this.storage.decryptString(Buffer.from(config.encryptedAccessToken, "base64"));
    }
    if (!config.encryptedRefreshToken) {
      throw new Error("トークンの有効期限が切れました。Settingsから再接続してください。");
    }
    const refreshToken = this.storage.decryptString(Buffer.from(config.encryptedRefreshToken, "base64"));
    const response = await this.fetcher(`${MICROSOFT_AUTHORITY}/oauth2/v2.0/token`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: MICROSOFT_CLIENT_ID,
        scope: SCOPES,
        refresh_token: refreshToken,
        grant_type: "refresh_token",
      }).toString(),
    });
    if (!response.ok) {
      throw new Error("トークンの更新に失敗しました。Settingsから再接続してください。");
    }
    const tokens = await response.json() as {
      access_token?: string;
      refresh_token?: string;
      expires_in?: number;
    };
    if (!tokens.access_token) throw new Error("更新後のアクセストークンが取得できませんでした。");
    const newExpiresAt = new Date(Date.now() + (tokens.expires_in || 3600) * 1000).toISOString();
    const updated: StoredCalendarConfig = {
      ...config,
      encryptedAccessToken: this.storage.encryptString(tokens.access_token).toString("base64"),
      encryptedRefreshToken: tokens.refresh_token
        ? this.storage.encryptString(tokens.refresh_token).toString("base64")
        : config.encryptedRefreshToken,
      tokenExpiresAt: newExpiresAt,
    };
    this.writeConfig(updated);
    return tokens.access_token;
  }

  private readConfig(): StoredCalendarConfig | null {
    if (!fs.existsSync(this.configPath)) return null;
    try {
      return JSON.parse(fs.readFileSync(this.configPath, "utf8")) as StoredCalendarConfig;
    } catch {
      return null;
    }
  }

  private writeConfig(config: StoredCalendarConfig): void {
    fs.mkdirSync(path.dirname(this.configPath), { recursive: true });
    fs.writeFileSync(this.configPath, `${JSON.stringify(config, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
  }

  private updateLastFetchedAt(fetchedAt: string): void {
    const config = this.readConfig();
    if (config) {
      config.lastFetchedAt = fetchedAt;
      this.writeConfig(config);
    }
  }
}

function parseGraphEvent(raw: unknown): CalendarEvent {
  const event = raw as Record<string, unknown>;
  const start = event.start as { dateTime?: string; timeZone?: string } | undefined;
  const end = event.end as { dateTime?: string; timeZone?: string } | undefined;
  const location = event.location as { displayName?: string } | undefined;
  return {
    id: String(event.id || ""),
    title: String(event.subject || ""),
    startTime: String(start?.dateTime || ""),
    endTime: String(end?.dateTime || ""),
    isAllDay: Boolean(event.isAllDay),
    location: location?.displayName || "",
    meetingUrl: String(event.onlineMeetingUrl || ""),
    calendarName: "",
    sensitivity: event.sensitivity === "private" ? "private" : "normal",
  };
}
