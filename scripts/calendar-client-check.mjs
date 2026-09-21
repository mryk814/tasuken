/**
 * Google OAuthクライアントの**種類**を、同意画面を開かずに確かめる（#273のM単位）。
 *
 * 実接続で `client_secret is missing.`（＝Web アプリ種別のクライアント）を観測した。
 * Taskenのループバック（`http://127.0.0.1:<任意ポート>` + PKCE、client secret無し）は
 * **デスクトップ アプリ**種別でしか成立しないため、同意画面を開く前に種類を判定できると、
 * 何度も同意操作を繰り返さずに済む。
 *
 * 判定はtoken endpointへ**わざと無効なcode**を送り、返るerrorで行う。
 * secretもcodeもtokenも送らない・残さない（client IDは公開情報で、出力は短い指紋だけ）。
 *
 *   node scripts/calendar-client-check.mjs                 # 環境変数のclient IDを使う
 *   node scripts/calendar-client-check.mjs --client-id=...
 *
 * 終了コード: デスクトップ アプリ種別なら0、それ以外は1、client IDや接続の問題は2。
 */
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";

const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";
const ENV_NAME = "TASKEN_GOOGLE_CLIENT_ID";

/**
 * token endpointの応答から、クライアントの種類を判定する（純関数）。
 *
 * - `client_secret is missing.` → Web アプリ種別（confidential client）。Taskenでは使えない。
 * - `invalid_grant`（Malformed auth code） → デスクトップ アプリ種別（public client）。期待どおり。
 * - `invalid_client`（not found） → client IDが存在しない、または種類が不明。
 */
export function classifyClientCheck({ status, body }) {
  const text = String(body || "");
  const lower = text.toLowerCase();
  const oauthError = /"error"\s*:\s*"([a-z_]{3,40})"/u.exec(text)?.[1] || "unknown";
  if (lower.includes("client_secret")) {
    return {
      kind: "confidential_client",
      oauthError,
      guidance:
        "この client ID は Web アプリケーション種別です。Google Cloud で「デスクトップ アプリ」種別の OAuth クライアントを作り直し、その client ID を設定してください。",
    };
  }
  if (lower.includes("invalid_client") || lower.includes("not found")) {
    return {
      kind: "unknown_client",
      oauthError,
      guidance:
        "この client ID は Google に登録されていません。値のコピー漏れを確認し、Google Cloud の「クライアント ID」をそのまま設定してください。",
    };
  }
  if (oauthError === "invalid_grant" || lower.includes("malformed auth code")) {
    return {
      kind: "public_client",
      oauthError,
      guidance:
        "デスクトップ アプリ種別の client ID です。TaskenのSettingsから接続できます（同意画面で許可してください）。",
    };
  }
  if (status === 200) {
    return { kind: "unexpected_success", oauthError, guidance: "判定できませんでした。" };
  }
  return {
    kind: "unknown",
    oauthError,
    guidance:
      "判定できませんでした。Google Cloud で「デスクトップ アプリ」種別か確認してください。",
  };
}

/** client IDは秘密ではないが、ログへ全文を残さず短い指紋だけを示す。 */
export function clientIdFingerprint(clientId) {
  return createHash("sha256").update(String(clientId)).digest("hex").slice(0, 8);
}

/**
 * 環境変数を読む。Windowsでは、いま開いているシェルが起動後に設定された
 * ユーザー環境変数を受け取っていないことがあるため、レジストリも見る。
 */
export function resolveClientId({
  argument,
  environment = process.env,
  platform = process.platform,
}) {
  if (argument) return argument;
  const fromEnvironment = environment[ENV_NAME];
  if (fromEnvironment) return fromEnvironment;
  if (platform !== "win32") return "";
  try {
    const output = execFileSync("reg", ["query", "HKCU\\Environment", "/v", ENV_NAME], {
      encoding: "utf8",
      windowsHide: true,
    });
    const matched = /REG_(?:EXPAND_)?SZ\s+(.+)$/mu.exec(output);
    return matched ? matched[1].trim() : "";
  } catch {
    return "";
  }
}

export async function runClientCheck({ clientId, fetchImpl = fetch }) {
  const body = new URLSearchParams({
    client_id: clientId,
    code: "tasken-client-check-invalid-code",
    grant_type: "authorization_code",
    redirect_uri: "http://127.0.0.1:45871",
    code_verifier: "tasken-client-check-verifier-0123456789abcdefghijklmnopqrstuvwxyz",
  });
  const response = await fetchImpl(GOOGLE_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: body.toString(),
  });
  const text = await response.text();
  const result = classifyClientCheck({ status: response.status, body: text });
  return {
    schema_version: 1,
    provider: "google",
    endpoint: GOOGLE_TOKEN_URL,
    client_id_fingerprint: clientIdFingerprint(clientId),
    status: response.status,
    oauth_error: result.oauthError,
    client_kind: result.kind,
    guidance: result.guidance,
  };
}

async function main() {
  const argument = process.argv
    .find((value) => value.startsWith("--client-id="))
    ?.slice("--client-id=".length);
  const clientId = resolveClientId({ argument });
  if (!clientId) {
    console.error(
      `${ENV_NAME}がありません。--client-id=... で渡すか、ユーザー環境変数へ設定してください。`,
    );
    process.exitCode = 2;
    return;
  }
  let report;
  try {
    report = await runClientCheck({ clientId });
  } catch (error) {
    console.error(`token endpointへ接続できませんでした: ${error?.message || error}`);
    process.exitCode = 2;
    return;
  }
  console.log(JSON.stringify(report, null, 2));
  // process.exit はlibuvの後始末と競合するため、終了コードだけを残して自然に終わる。
  process.exitCode = report.client_kind === "public_client" ? 0 : 1;
}

const invokedDirectly =
  process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invokedDirectly) await main();
