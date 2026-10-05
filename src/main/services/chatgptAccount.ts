import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { createHash, createPublicKey, createVerify, randomBytes, randomUUID } from "node:crypto";
import { z } from "zod";

import type {
  ChatGptAccountState,
  ChatGptModelOption,
} from "../../shared/captureOrganizerSettings.ts";
import { CHATGPT_PLAN_API } from "../gateway/mobile/public.ts";

/**
 * Sign in with ChatGPT（ローカルアプリ向けのChatGPT plan usage）。
 * https://developers.openai.com/siwc/token-sharing-open-source/sign-in
 *
 * 外部AIがMCPでTaskenを使う経路とは別で、Tasken自身が整理をChatGPTの契約枠で実行するための認証。
 * refresh tokenはOSのsafeStorageで暗号化し、DB・同期・Export・ログ・MCP応答へ出さない。
 */
export const CHATGPT_AUTH = {
  issuer: "https://auth.openai.com",
  authorize: "https://auth.openai.com/api/accounts/authorize",
  token: "https://auth.openai.com/api/accounts/oauth/token",
  revoke: "https://auth.openai.com/api/accounts/oauth/revoke",
  jwks: "https://auth.openai.com/.well-known/jwks.json",
  resource: CHATGPT_PLAN_API.resource,
  models: CHATGPT_PLAN_API.models,
  scope: "openid profile email offline_access resource.invoke chatgpt.tokens.use.direct",
  directScope: "chatgpt.tokens.use.direct",
  dynamicClientId: "dynamic_agent_client",
  agentName: "Tasken",
  callbackPath: "/auth/callback",
  preferredPort: 1455,
} as const;

const SIGN_IN_TIMEOUT_MS = 5 * 60_000;
const REQUEST_TIMEOUT_MS = 30_000;
const UNUSABLE_REFRESH_ERRORS = new Set([
  "invalid_grant",
  "invalid_refresh_token",
  "token_expired",
  "refresh_token_expired",
  "refresh_token_invalidated",
  "refresh_token_reused",
  "invalid_client",
]);

interface SecureStorage {
  isEncryptionAvailable(): boolean;
  encryptString(value: string): Buffer;
  decryptString(value: Buffer): string;
  getSelectedStorageBackend?(): string;
}

const savedSchema = z.strictObject({
  hostId: z.string().uuid(),
  clientId: z.string().min(1).max(500).nullable(),
  subject: z.string().min(1).max(500).nullable(),
  email: z.string().max(500).nullable(),
  encryptedRefreshToken: z.string().min(1).max(64000).nullable(),
  reauthRequired: z.boolean(),
});
type Saved = z.infer<typeof savedSchema>;

const tokenResponseSchema = z.object({
  access_token: z.string().min(1),
  refresh_token: z.string().min(1).optional(),
  id_token: z.string().min(1).optional(),
  expires_in: z.number().positive(),
  scope: z.string().optional(),
});

/** 呼び出し側へ返してよい、秘密を含まない失敗。 */
export class ChatGptAccountError extends Error {
  readonly reason: "not_connected" | "reauth_required" | "sign_in_failed" | "unavailable";

  constructor(message: string, reason: ChatGptAccountError["reason"]) {
    super(message);
    this.name = "ChatGptAccountError";
    this.reason = reason;
  }
}

const notConnected = () =>
  new ChatGptAccountError(
    "ChatGPTと接続していません。Settingsの「入力のAI整理」でChatGPTに接続してください。",
    "not_connected",
  );
const reauthRequired = () =>
  new ChatGptAccountError(
    "ChatGPTとの接続が切れました。Settingsの「入力のAI整理」で接続し直してください。原文は保持されています。",
    "reauth_required",
  );
const signInFailed = () =>
  new ChatGptAccountError(
    "ChatGPTに接続できませんでした。ブラウザでの許可を確認して、もう一度お試しください。",
    "sign_in_failed",
  );
const unavailable = () =>
  new ChatGptAccountError(
    "ChatGPTの認証サーバーへ接続できません。ネットワークを確認して再試行してください。",
    "unavailable",
  );

function base64Url(buffer: Buffer): string {
  return buffer.toString("base64url");
}

function decodeJwtPart(part: string): Record<string, unknown> {
  return JSON.parse(Buffer.from(part, "base64url").toString("utf8")) as Record<string, unknown>;
}

export interface ChatGptAccountDependencies {
  fetchImpl?: typeof fetch;
  openExternal: (url: string) => Promise<void> | void;
  now?: () => number;
  files?: Pick<
    typeof fs,
    "readFileSync" | "writeFileSync" | "renameSync" | "unlinkSync" | "mkdirSync"
  >;
  createServer?: typeof http.createServer;
}

export class ChatGptAccountService {
  private readonly filePath: string;
  private readonly fetchImpl: typeof fetch;
  private readonly now: () => number;
  private readonly files: NonNullable<ChatGptAccountDependencies["files"]>;
  private readonly createServer: typeof http.createServer;
  private access: { token: string; expiresAt: number } | null = null;
  private refreshing: Promise<string> | null = null;
  private pendingSignIn: { cancel: () => void } | null = null;

  constructor(
    userDataPath: string,
    private readonly secureStorage: SecureStorage,
    private readonly dependencies: ChatGptAccountDependencies,
  ) {
    this.filePath = path.join(userDataPath, "chatgpt-account.json");
    this.fetchImpl = dependencies.fetchImpl ?? fetch;
    this.now = dependencies.now ?? Date.now;
    this.files = dependencies.files ?? fs;
    this.createServer = dependencies.createServer ?? http.createServer;
  }

  private secureAvailable(): boolean {
    try {
      return (
        this.secureStorage.isEncryptionAvailable() &&
        this.secureStorage.getSelectedStorageBackend?.() !== "basic_text"
      );
    } catch {
      return false;
    }
  }

  private read(): Saved | null {
    try {
      return savedSchema.parse(JSON.parse(this.files.readFileSync(this.filePath, "utf8")));
    } catch {
      return null;
    }
  }

  private write(value: Saved): void {
    const temporaryPath = `${this.filePath}.${randomUUID()}.tmp`;
    try {
      this.files.mkdirSync(path.dirname(this.filePath), { recursive: true });
      this.files.writeFileSync(temporaryPath, JSON.stringify(value), { mode: 0o600, flag: "wx" });
      this.files.renameSync(temporaryPath, this.filePath);
    } finally {
      try {
        this.files.unlinkSync(temporaryPath);
      } catch {
        /* Renamed or never written. */
      }
    }
  }

  /** 端末ごとに固定のhost ID。再接続でも同じ値を使う。 */
  private savedOrFresh(): Saved {
    return (
      this.read() ?? {
        hostId: randomUUID(),
        clientId: null,
        subject: null,
        email: null,
        encryptedRefreshToken: null,
        reauthRequired: false,
      }
    );
  }

  getState(): ChatGptAccountState {
    const saved = this.read();
    const status: ChatGptAccountState["status"] = this.pendingSignIn
      ? "connecting"
      : saved?.encryptedRefreshToken
        ? "connected"
        : saved?.reauthRequired
          ? "reauth_required"
          : "disconnected";
    return {
      status,
      email: status === "disconnected" ? null : (saved?.email ?? null),
      secureStorageAvailable: this.secureAvailable(),
    };
  }

  isConnected(): boolean {
    return Boolean(this.read()?.encryptedRefreshToken);
  }

  cancelSignIn(): void {
    this.pendingSignIn?.cancel();
  }

  /** ブラウザでChatGPTに接続する。loopback callbackを受けてtokenを保存する。 */
  async signIn(): Promise<ChatGptAccountState> {
    if (!this.secureAvailable()) throw signInFailed();
    if (this.pendingSignIn) throw signInFailed();
    const saved = this.savedOrFresh();
    const verifier = base64Url(randomBytes(32));
    const challenge = base64Url(createHash("sha256").update(verifier).digest());
    const state = base64Url(randomBytes(24));
    const nonce = base64Url(randomBytes(24));
    const server = this.createServer();
    let settle: (value: { code: string; clientId: string | null }) => void = () => {};
    let fail: (error: Error) => void = () => {};
    const callback = new Promise<{ code: string; clientId: string | null }>((resolve, reject) => {
      settle = resolve;
      fail = reject;
    });
    // 待機前にキャンセルされても未処理のrejectionにしない。awaitで同じ失敗を受け取る。
    callback.catch(() => {});
    const timer = setTimeout(() => fail(signInFailed()), SIGN_IN_TIMEOUT_MS);
    this.pendingSignIn = { cancel: () => fail(signInFailed()) };
    server.on("request", (request, response) => {
      const url = new URL(request.url ?? "/", "http://127.0.0.1");
      if (url.pathname !== CHATGPT_AUTH.callbackPath) {
        response.writeHead(404).end();
        return;
      }
      const ok =
        url.searchParams.get("state") === state &&
        Boolean(url.searchParams.get("code")) &&
        !url.searchParams.get("error");
      response
        .writeHead(ok ? 200 : 400, { "Content-Type": "text/html; charset=utf-8" })
        .end(
          `<!doctype html><meta charset="utf-8"><title>Tasken</title><body style="font-family:sans-serif;padding:2rem">${
            ok
              ? "ChatGPTとの接続を受け取りました。Taskenに戻ってください。このタブは閉じてかまいません。"
              : "ChatGPTとの接続を完了できませんでした。Taskenに戻って、もう一度お試しください。"
          }</body>`,
        );
      if (ok)
        settle({
          code: url.searchParams.get("code")!,
          clientId: url.searchParams.get("client_id"),
        });
      else fail(signInFailed());
    });
    try {
      const port = await new Promise<number>((resolve, reject) => {
        const listen = (candidate: number) => {
          server.once("error", (error: NodeJS.ErrnoException) => {
            if (candidate !== 0 && error.code === "EADDRINUSE") listen(0);
            else reject(signInFailed());
          });
          server.listen(candidate, "127.0.0.1", () => {
            const address = server.address();
            if (address && typeof address === "object") resolve(address.port);
            else reject(signInFailed());
          });
        };
        listen(CHATGPT_AUTH.preferredPort);
      });
      const redirectUri = `http://127.0.0.1:${port}${CHATGPT_AUTH.callbackPath}`;
      const firstRegistration = !saved.clientId;
      const query = new URLSearchParams({
        client_id: saved.clientId ?? CHATGPT_AUTH.dynamicClientId,
        ...(firstRegistration ? { agent_name_hint: CHATGPT_AUTH.agentName } : {}),
        ext_agent_host_id: saved.hostId,
        response_type: "code",
        redirect_uri: redirectUri,
        scope: CHATGPT_AUTH.scope,
        resource: CHATGPT_AUTH.resource,
        state,
        nonce,
        code_challenge_method: "S256",
        code_challenge: challenge,
      });
      await this.dependencies.openExternal(`${CHATGPT_AUTH.authorize}?${query.toString()}`);
      const { code, clientId: issuedClientId } = await callback;
      const clientId = issuedClientId ?? saved.clientId;
      if (!clientId) throw signInFailed();
      const token = await this.tokenRequest({
        grant_type: "authorization_code",
        client_id: clientId,
        code,
        code_verifier: verifier,
        redirect_uri: redirectUri,
        resource: CHATGPT_AUTH.resource,
      }).catch((error: unknown) => {
        // 認可コードの交換失敗は「再接続が必要」ではなく、今回の接続の失敗として扱う。
        throw error instanceof ChatGptAccountError && error.reason === "unavailable"
          ? error
          : signInFailed();
      });
      if (!token.refresh_token || !token.id_token) throw signInFailed();
      if (!(token.scope ?? "").split(/\s+/).includes(CHATGPT_AUTH.directScope))
        throw new ChatGptAccountError(
          "このChatGPTアカウントでは契約枠の利用を許可できませんでした。ChatGPTの契約と許可内容を確認してください。",
          "sign_in_failed",
        );
      const identity = await this.verifyIdToken(token.id_token, clientId, nonce);
      if (saved.subject && saved.subject !== identity.subject && saved.clientId === clientId)
        throw signInFailed();
      this.write({
        hostId: saved.hostId,
        clientId,
        subject: identity.subject,
        email: identity.email,
        encryptedRefreshToken: this.secureStorage
          .encryptString(token.refresh_token)
          .toString("base64"),
        reauthRequired: false,
      });
      this.access = { token: token.access_token, expiresAt: this.now() + token.expires_in * 1000 };
      this.pendingSignIn = null;
      return this.getState();
    } catch (error) {
      throw error instanceof ChatGptAccountError ? error : signInFailed();
    } finally {
      clearTimeout(timer);
      this.pendingSignIn = null;
      server.close();
    }
  }

  private async tokenRequest(
    form: Record<string, string>,
  ): Promise<z.infer<typeof tokenResponseSchema>> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    let response: Response;
    try {
      response = await this.fetchImpl(CHATGPT_AUTH.token, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams(form).toString(),
        redirect: "error",
        signal: controller.signal,
      });
    } catch {
      throw unavailable();
    } finally {
      clearTimeout(timer);
    }
    let body: unknown = null;
    try {
      body = await response.json();
    } catch {
      /* Treated below by status. */
    }
    if (!response.ok) {
      const code =
        body && typeof body === "object" && "error" in body
          ? String((body as { error: unknown }).error)
          : "";
      if (UNUSABLE_REFRESH_ERRORS.has(code) || response.status === 400 || response.status === 401)
        throw reauthRequired();
      throw unavailable();
    }
    const parsed = tokenResponseSchema.safeParse(body);
    if (!parsed.success) throw unavailable();
    return parsed.data;
  }

  private async verifyIdToken(
    idToken: string,
    clientId: string,
    nonce: string,
  ): Promise<{ subject: string; email: string | null }> {
    const parts = idToken.split(".");
    if (parts.length !== 3) throw signInFailed();
    const header = decodeJwtPart(parts[0]);
    const claims = decodeJwtPart(parts[1]);
    if (header.alg !== "RS256" || typeof header.kid !== "string") throw signInFailed();
    const response = await this.fetchImpl(CHATGPT_AUTH.jwks, { redirect: "error" }).catch(() => {
      throw unavailable();
    });
    if (!response.ok) throw unavailable();
    const jwks = z
      .object({ keys: z.array(z.object({ kid: z.string().optional() }).passthrough()) })
      .parse(await response.json());
    const jwk = jwks.keys.find((key) => key.kid === header.kid);
    if (!jwk) throw signInFailed();
    const key = createPublicKey({ key: jwk as never, format: "jwk" });
    const verifier = createVerify("RSA-SHA256");
    verifier.update(`${parts[0]}.${parts[1]}`);
    if (!verifier.verify(key, Buffer.from(parts[2], "base64url"))) throw signInFailed();
    const audience = Array.isArray(claims.aud) ? claims.aud : [claims.aud];
    const nowSeconds = this.now() / 1000;
    if (
      claims.iss !== CHATGPT_AUTH.issuer ||
      !audience.includes(clientId) ||
      claims.nonce !== nonce ||
      typeof claims.exp !== "number" ||
      claims.exp < nowSeconds - 60 ||
      typeof claims.sub !== "string" ||
      !claims.sub
    )
      throw signInFailed();
    return {
      subject: claims.sub,
      email: typeof claims.email === "string" ? claims.email.slice(0, 500) : null,
    };
  }

  /** 推論用のaccess token。期限切れならrefreshし、使えなければ再接続を求める。 */
  async getAccessToken(): Promise<string> {
    if (this.access && this.access.expiresAt - 60_000 > this.now()) return this.access.token;
    this.refreshing ??= this.refresh().finally(() => {
      this.refreshing = null;
    });
    return this.refreshing;
  }

  /** 推論が401（失効）を返したときに、手元のaccess tokenを捨てる。 */
  invalidateAccessToken(): void {
    this.access = null;
  }

  private async refresh(): Promise<string> {
    const saved = this.read();
    if (!saved?.encryptedRefreshToken || !saved.clientId) {
      throw saved?.reauthRequired ? reauthRequired() : notConnected();
    }
    if (!this.secureAvailable()) throw reauthRequired();
    let refreshToken: string;
    try {
      refreshToken = this.secureStorage.decryptString(
        Buffer.from(saved.encryptedRefreshToken, "base64"),
      );
    } catch {
      this.markReauthRequired(saved);
      throw reauthRequired();
    }
    try {
      const token = await this.tokenRequest({
        grant_type: "refresh_token",
        client_id: saved.clientId,
        refresh_token: refreshToken,
        resource: CHATGPT_AUTH.resource,
      });
      // access token・期限・refresh tokenは一緒に置き換える。
      this.write({
        ...saved,
        encryptedRefreshToken: token.refresh_token
          ? this.secureStorage.encryptString(token.refresh_token).toString("base64")
          : saved.encryptedRefreshToken,
        reauthRequired: false,
      });
      this.access = { token: token.access_token, expiresAt: this.now() + token.expires_in * 1000 };
      return token.access_token;
    } catch (error) {
      if (error instanceof ChatGptAccountError && error.reason === "reauth_required")
        this.markReauthRequired(saved);
      throw error;
    }
  }

  /** 失効が確認されたときだけ呼ぶ。client ID・host IDは残し、次の接続で再利用する。 */
  markReauthRequired(saved: Saved | null = this.read()): void {
    this.access = null;
    if (!saved) return;
    this.write({ ...saved, encryptedRefreshToken: null, reauthRequired: true });
  }

  /** 接続解除。revokeに失敗してもローカルのtokenは消す。 */
  async disconnect(): Promise<ChatGptAccountState> {
    const saved = this.read();
    this.access = null;
    if (saved?.encryptedRefreshToken && saved.clientId && this.secureAvailable()) {
      try {
        const refreshToken = this.secureStorage.decryptString(
          Buffer.from(saved.encryptedRefreshToken, "base64"),
        );
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
        await this.fetchImpl(CHATGPT_AUTH.revoke, {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          body: new URLSearchParams({
            token: refreshToken,
            token_type_hint: "refresh_token",
            client_id: saved.clientId,
          }).toString(),
          redirect: "error",
          signal: controller.signal,
        }).finally(() => clearTimeout(timer));
      } catch {
        /* Local tokens are cleared regardless. */
      }
    }
    if (saved)
      this.write({
        ...saved,
        subject: null,
        email: null,
        encryptedRefreshToken: null,
        reauthRequired: false,
      });
    return this.getState();
  }

  /** このアカウントで使えるモデル。visibility=list のものだけを返す。 */
  async listModels(): Promise<ChatGptModelOption[]> {
    const token = await this.getAccessToken();
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    try {
      const response = await this.fetchImpl(CHATGPT_AUTH.models, {
        headers: { Authorization: `Bearer ${token}` },
        redirect: "error",
        signal: controller.signal,
      });
      if (response.status === 401) {
        this.invalidateAccessToken();
        throw reauthRequired();
      }
      if (!response.ok) throw unavailable();
      const body = z
        .object({
          models: z.array(
            z
              .object({
                slug: z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,199}$/),
                display_name: z.string().max(200).optional(),
                visibility: z.string().optional(),
              })
              .passthrough(),
          ),
        })
        .parse(await response.json());
      return body.models
        .filter((model) => model.visibility === "list")
        .map((model) => ({ slug: model.slug, displayName: model.display_name || model.slug }));
    } catch (error) {
      throw error instanceof ChatGptAccountError ? error : unavailable();
    } finally {
      clearTimeout(timer);
    }
  }
}
