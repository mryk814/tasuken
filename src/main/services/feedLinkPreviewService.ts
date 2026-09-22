import { createHash, randomUUID } from "node:crypto";
import { lookup } from "node:dns/promises";
import fs from "node:fs";
import path from "node:path";

import type { FeedLinkPreviewResult } from "../../shared/ipc/contracts";

/**
 * Feedへ貼られた外部リンクのPreview（Open Graph等）をMain側でだけ取得する。
 *
 * RendererからURLを直接fetchさせない理由は2つある。
 * 1. RendererのCSPとOriginでは外部サイトのHTMLを読めず、CORSでも弾かれる。
 * 2. 取得先の選別（SSRF対策）をRendererのコードに置くと、XSS1つで内部網へ
 *    投げられる。境界はMainに閉じ、Rendererへは整形済みの値だけを返す。
 *
 * 取得結果は派生キャッシュであり正本データではない。DB・Workspace・
 * Exportへは一切書かない（消えても再取得できる）。
 */

/** 1 hopの上限。Rendererの描画を待たせないため、転送を含めても短く切る。 */
const HOP_TIMEOUT_MS = 5_000;
const MAX_REDIRECTS = 3;
const MAX_HTML_BYTES = 512 * 1024;
const MAX_IMAGE_BYTES = 2 * 1024 * 1024;
const CACHE_TTL_MS = 60 * 60 * 1000;
/** 失敗を短くcacheする。壊れたリンクをrenderのたびに叩き直さない。 */
const FAILURE_CACHE_TTL_MS = 5 * 60 * 1000;
const MAX_CACHE_ENTRIES = 200;
const MAX_TITLE_LENGTH = 300;
const MAX_DESCRIPTION_LENGTH = 500;
const LINK_PREVIEW_DIRECTORY = "link-previews";
const LINK_PREVIEW_IMAGE_ACCEPT = "image/png,image/jpeg,image/webp,image/gif";
const LINK_PREVIEW_HTML_ACCEPT = "text/html,application/xhtml+xml";

/**
 * 取得元へ身元を晒さないための固定UA。Cookie・Authorization・Refererは
 * 一切送らない（利用者のログイン状態を外部リンク先へ漏らさない）。
 */
const LINK_PREVIEW_USER_AGENT = "Tasken-LinkPreview/1.0";

const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);

/**
 * Rendererへ返す失敗理由。URL・query・資格情報・Nodeのmessageは決して含めない
 * （Previewは表示専用なので、原因の詳細はログにも残さない）。
 */
const REASON = {
  invalidUrl: "リンクの形式が不正です。",
  unsupportedScheme: "http または https のリンクだけを表示できます。",
  credentials: "認証情報を含むリンクは表示できません。",
  blockedHost: "安全でない可能性があるリンク先のため表示できません。",
  unresolvedHost: "リンク先のホストを確認できませんでした。",
  requestFailed: "リンク先を取得できませんでした。",
  tooManyRedirects: "転送が多いためリンク先を表示できません。",
  badRedirect: "転送先を確認できないため表示できません。",
} as const;

class FeedLinkPreviewError extends Error {
  readonly reason: string;

  constructor(reason: string) {
    super(reason);
    this.name = "FeedLinkPreviewError";
    this.reason = reason;
  }
}

/** 解決済みIPアドレス。bytesは4（IPv4）または16（IPv6）要素。 */
interface ResolvedIp {
  version: 4 | 6;
  bytes: number[];
}

interface CacheEntry {
  result: FeedLinkPreviewResult;
  expiresAt: number;
}

interface HtmlMetadata {
  title: string;
  description: string;
  siteName: string;
  imageUrl: string | null;
}

interface FetchedDocument {
  body: Buffer;
  finalUrl: URL;
}

export interface FeedLinkPreviewOptions {
  /** テスト差し替え用。既定はglobal fetch。 */
  fetchImpl?: typeof fetch;
  /** テスト差し替え用。既定はdns.lookup({ all: true })。 */
  resolveHost?: (hostname: string) => Promise<readonly string[]>;
}

async function lookupAllHosts(hostname: string): Promise<readonly string[]> {
  const records = await lookup(hostname, { all: true });
  return records.map((record) => record.address);
}

function stripHostBrackets(value: string): string {
  const trimmed = value.trim();
  return trimmed.startsWith("[") && trimmed.endsWith("]") ? trimmed.slice(1, -1) : trimmed;
}

function parseIpv4(value: string): number[] | null {
  const parts = value.trim().split(".");
  if (parts.length !== 4) return null;
  const bytes: number[] = [];
  for (const part of parts) {
    if (!/^\d{1,3}$/.test(part)) return null;
    const octet = Number(part);
    if (octet > 255) return null;
    bytes.push(octet);
  }
  return bytes;
}

function parseIpv6(value: string): number[] | null {
  let text = value.trim().toLowerCase();
  if (text.startsWith("[") && text.endsWith("]")) text = text.slice(1, -1);
  // zone id（fe80::1%eth0）はアドレス本体ではないので落とす。
  const zone = text.indexOf("%");
  if (zone >= 0) text = text.slice(0, zone);
  if (!text.includes(":")) return null;

  const halves = text.split("::");
  if (halves.length > 2) return null;
  const parseGroups = (source: string): number[] | null => {
    if (!source) return [];
    const groups: number[] = [];
    for (const group of source.split(":")) {
      // 末尾のIPv4表記（::ffff:192.0.2.1）は2 groupへ展開する。
      if (group.includes(".")) {
        const ipv4 = parseIpv4(group);
        if (!ipv4) return null;
        groups.push((ipv4[0] << 8) | ipv4[1], (ipv4[2] << 8) | ipv4[3]);
        continue;
      }
      if (!/^[0-9a-f]{1,4}$/.test(group)) return null;
      groups.push(Number.parseInt(group, 16));
    }
    return groups;
  };

  const head = parseGroups(halves[0]);
  const tail = halves.length === 2 ? parseGroups(halves[1]) : [];
  if (!head || !tail) return null;
  let groups: number[];
  if (halves.length === 1) {
    if (head.length !== 8) return null;
    groups = head;
  } else {
    const missing = 8 - head.length - tail.length;
    if (missing < 1) return null;
    groups = [...head, ...new Array<number>(missing).fill(0), ...tail];
  }
  // 判定側はIPv4と同じ「バイト列」で扱うため、16bit groupを8組から16バイトへ開く。
  return groups.flatMap((group) => [(group >> 8) & 0xff, group & 0xff]);
}

function parseIp(value: string): ResolvedIp | null {
  const ipv4 = parseIpv4(value);
  if (ipv4) return { version: 4, bytes: ipv4 };
  const ipv6 = parseIpv6(value);
  if (ipv6) return { version: 6, bytes: ipv6 };
  return null;
}

/**
 * 名前解決の結果をそのまま信用しない。private・loopback・link-localへ
 * 到達できると、Rendererから見えない内部サービス（クラウドのmetadata
 * endpoint等）を読めてしまうため、範囲で機械的に落とす。
 */
function isBlockedIpv4(bytes: readonly number[]): boolean {
  const [a, b, c] = bytes;
  if (a === 0) return true; // 0.0.0.0/8
  if (a === 10) return true; // 10.0.0.0/8
  if (a === 100 && b >= 64 && b <= 127) return true; // 100.64.0.0/10 CGNAT
  if (a === 127) return true; // 127.0.0.0/8 loopback
  if (a === 169 && b === 254) return true; // 169.254.0.0/16 link-local
  if (a === 172 && b >= 16 && b <= 31) return true; // 172.16.0.0/12
  if (a === 192 && b === 0 && c === 0) return true; // 192.0.0.0/24
  if (a === 192 && b === 168) return true; // 192.168.0.0/16
  if (a === 198 && (b === 18 || b === 19)) return true; // 198.18.0.0/15
  if (a >= 224 && a <= 239) return true; // 224.0.0.0/4 multicast
  if (a >= 240) return true; // 240.0.0.0/4 reserved・255.255.255.255 broadcast
  return false;
}

/** ::ffff:a.b.c.d はIPv4そのものなので、IPv4の規則をそのまま適用する。 */
function ipv4MappedBytes(bytes: readonly number[]): number[] | null {
  const prefixIsZero = bytes.slice(0, 10).every((value) => value === 0);
  if (!prefixIsZero || bytes[10] !== 0xff || bytes[11] !== 0xff) return null;
  return [bytes[12], bytes[13], bytes[14], bytes[15]];
}

function isBlockedIpv6(bytes: readonly number[]): boolean {
  if (bytes.every((value) => value === 0)) return true; // :: unspecified
  if (bytes.slice(0, 15).every((value) => value === 0) && bytes[15] === 1) return true; // ::1
  if ((bytes[0] & 0xfe) === 0xfc) return true; // fc00::/7 unique local
  if (bytes[0] === 0xfe && (bytes[1] & 0xc0) === 0x80) return true; // fe80::/10 link-local
  if (bytes[0] === 0xff) return true; // ff00::/8 multicast
  const mapped = ipv4MappedBytes(bytes);
  if (mapped) return isBlockedIpv4(mapped);
  return false;
}

function isBlockedIp(ip: ResolvedIp): boolean {
  return ip.version === 4 ? isBlockedIpv4(ip.bytes) : isBlockedIpv6(ip.bytes);
}

function namedEntity(name: string): string | undefined {
  const entities: Record<string, string> = {
    amp: "&",
    lt: "<",
    gt: ">",
    quot: '"',
    apos: "'",
    nbsp: " ",
  };
  return entities[name];
}

function decodeEntities(value: string): string {
  return value.replace(/&(#[0-9]+|#x[0-9a-f]+|[a-z]+);/gi, (match, body: string) => {
    const lower = body.toLowerCase();
    if (lower.startsWith("#")) {
      const code = lower.startsWith("#x")
        ? Number.parseInt(lower.slice(2), 16)
        : Number.parseInt(lower.slice(1), 10);
      // 範囲外・0は置換しない。壊れた文字列で例外を出さない。
      if (!Number.isFinite(code) || code <= 0 || code > 0x10ffff) return match;
      return String.fromCodePoint(code);
    }
    return namedEntity(lower) ?? match;
  });
}

/**
 * DOMを実行せず、タグだけを落として文字列として読む。HTMLを解釈しないので
 * script/styleの中身も単なるテキスト以上にはならない（RendererはReactが
 * escapeするため、ここで得た値がそのままタグになることはない）。
 */
function stripMarkup(value: string): string {
  return decodeEntities(value.replace(/<[^>]*>/g, " "))
    .replace(/\s+/g, " ")
    .trim();
}

function clampText(value: string, limit: number): string {
  return value.length > limit ? value.slice(0, limit) : value;
}

/**
 * meta要素を保守的に読む。属性の順序に依存せず、同名が複数あっても
 * 最初の宣言を採る（後から差し込まれた偽のog:*で上書きさせない）。
 */
function readMetaValues(html: string): Map<string, string> {
  const values = new Map<string, string>();
  const attributePattern =
    /([a-zA-Z_:][-a-zA-Z0-9_:.]*)\s*=\s*("([^"]*)"|'([^']*)'|([^\s"'`=<>]+))/g;
  // 属性値を引用符ごと1つの塊として読む。値の中の`>`でタグを切らないため
  // （og:descriptionへHTMLが混ざるページでも属性の対応が崩れない）。
  for (const tag of html.match(/<meta\b(?:[^>"']|"[^"]*"|'[^']*')*>/gi) ?? []) {
    const attributes = new Map<string, string>();
    for (const match of tag.matchAll(attributePattern)) {
      attributes.set(match[1].toLowerCase(), match[3] ?? match[4] ?? match[5] ?? "");
    }
    const key = (attributes.get("property") || attributes.get("name") || "").trim().toLowerCase();
    const content = attributes.get("content");
    if (!key || content === undefined) continue;
    if (!values.has(key)) values.set(key, content);
  }
  return values;
}

function resolveImageUrl(value: string, baseUrl: URL): string | null {
  const candidate = decodeEntities(value).trim();
  if (!candidate) return null;
  let parsed: URL;
  try {
    parsed = new URL(candidate, baseUrl);
  } catch {
    return null;
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return null;
  if (parsed.username || parsed.password) return null;
  return parsed.toString();
}

/** og:* を優先し、無いときだけHTML標準のタグへ落とす。 */
function parseHtmlMetadata(html: string, finalUrl: URL): HtmlMetadata {
  const values = readMetaValues(html);
  const documentTitle = /<title\b[^>]*>([\s\S]*?)<\/title>/i.exec(html);
  return {
    title: clampText(
      stripMarkup(values.get("og:title") || documentTitle?.[1] || ""),
      MAX_TITLE_LENGTH,
    ),
    description: clampText(
      stripMarkup(values.get("og:description") || values.get("description") || ""),
      MAX_DESCRIPTION_LENGTH,
    ),
    siteName: clampText(stripMarkup(values.get("og:site_name") || ""), MAX_TITLE_LENGTH),
    imageUrl: resolveImageUrl(
      values.get("og:image") || values.get("twitter:image") || "",
      finalUrl,
    ),
  };
}

/**
 * 宣言されたcontent-typeは信用せず、実バイトのmagic numberだけで判定する。
 * 画像と偽ったHTML/スクリプトを添付ディレクトリへ置かせないための境界。
 */
function detectImageExtension(bytes: Buffer): string | null {
  if (
    bytes.length >= 4 &&
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47
  )
    return "png";
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff)
    return "jpg";
  if (bytes.length >= 4 && bytes.subarray(0, 4).toString("latin1") === "GIF8") return "gif";
  if (
    bytes.length >= 12 &&
    bytes.subarray(0, 4).toString("latin1") === "RIFF" &&
    bytes.subarray(8, 12).toString("latin1") === "WEBP"
  )
    return "webp";
  return null;
}

function requireAllowedUrl(input: unknown): URL {
  if (typeof input !== "string") throw new FeedLinkPreviewError(REASON.invalidUrl);
  const trimmed = input.trim();
  if (!trimmed) throw new FeedLinkPreviewError(REASON.invalidUrl);
  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    throw new FeedLinkPreviewError(REASON.invalidUrl);
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new FeedLinkPreviewError(REASON.unsupportedScheme);
  }
  // user:pass@host は取得元へ資格情報を渡す意味になるため受け取らない。
  if (parsed.username || parsed.password) throw new FeedLinkPreviewError(REASON.credentials);
  if (!parsed.hostname) throw new FeedLinkPreviewError(REASON.invalidUrl);
  return parsed;
}

/** fragmentは取得内容に影響しないので、同じリンクとして同じcacheへ寄せる。 */
function cacheKeyOf(target: URL): string {
  const normalized = new URL(target.toString());
  normalized.hash = "";
  return normalized.toString();
}

function reasonOf(error: unknown): string {
  if (error instanceof FeedLinkPreviewError) return error.reason;
  // Node/undiciのmessageにはURLやqueryが混ざりうるので、そのまま返さない。
  return REASON.requestFailed;
}

async function readLimitedBody(response: Response, maxBytes: number): Promise<Buffer> {
  const declared = response.headers.get("content-length");
  if (declared && Number(declared) > maxBytes) {
    throw new FeedLinkPreviewError(REASON.requestFailed);
  }
  if (!response.body) return Buffer.alloc(0);
  const reader = response.body.getReader();
  const chunks: Buffer[] = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value) continue;
      total += value.byteLength;
      if (total > maxBytes) {
        // 上限を超えた時点で読むのをやめる。巨大なbodyを最後まで受け取らない。
        await reader.cancel().catch(() => undefined);
        throw new FeedLinkPreviewError(REASON.requestFailed);
      }
      chunks.push(Buffer.from(value));
    }
  } finally {
    reader.releaseLock();
  }
  return Buffer.concat(chunks);
}

export class FeedLinkPreviewService {
  private readonly attachmentDirectory: string;
  private readonly fetchImpl: typeof fetch;
  private readonly resolveHost: (hostname: string) => Promise<readonly string[]>;
  private readonly cache = new Map<string, CacheEntry>();

  constructor(userDataPath: string, options: FeedLinkPreviewOptions = {}) {
    if (typeof userDataPath !== "string" || !userDataPath.trim()) {
      throw new Error("Link Previewの保存先が設定されていません。");
    }
    this.attachmentDirectory = path.join(
      path.resolve(userDataPath),
      "attachments",
      LINK_PREVIEW_DIRECTORY,
    );
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.resolveHost = options.resolveHost ?? lookupAllHosts;
  }

  /** IPCからは例外を出さない。常に判別可能な結果を返す。 */
  async fetchPreview(input: unknown): Promise<FeedLinkPreviewResult> {
    let start: URL;
    let cacheKey: string;
    try {
      start = requireAllowedUrl(input);
      cacheKey = cacheKeyOf(start);
    } catch (error) {
      return { ok: false, reason: reasonOf(error) };
    }

    const cached = this.readCache(cacheKey);
    // cache hitでは名前解決もfetchもしない（renderのたびに外部へ出ない）。
    if (cached) return cached;

    let result: FeedLinkPreviewResult;
    try {
      result = await this.load(start);
    } catch (error) {
      result = { ok: false, reason: reasonOf(error) };
    }
    this.writeCache(cacheKey, result);
    return result;
  }

  private async load(start: URL): Promise<FeedLinkPreviewResult> {
    const document = await this.fetchFollowingRedirects(
      start,
      LINK_PREVIEW_HTML_ACCEPT,
      MAX_HTML_BYTES,
    );
    const metadata = parseHtmlMetadata(document.body.toString("utf8"), document.finalUrl);
    return {
      ok: true,
      preview: {
        url: document.finalUrl.toString(),
        title: metadata.title,
        description: metadata.description,
        siteName: metadata.siteName,
        imageFileName: metadata.imageUrl ? await this.storeThumbnail(metadata.imageUrl) : null,
      },
    };
  }

  /**
   * 転送は手動で追う。scheme・資格情報・解決先IPを毎hopで検証し直すことで、
   * 公開ホストがprivateへ転送する「リダイレクト経由のSSRF」を塞ぐ。
   * fetchの自動追従に任せると、この検証を1回も挟めない。
   */
  private async fetchFollowingRedirects(
    start: URL,
    accept: string,
    maxBytes: number,
  ): Promise<FetchedDocument> {
    let target = start;
    for (let hop = 0; ; hop += 1) {
      await this.assertPublicHost(target);
      const response = await this.fetchHop(target, accept, maxBytes);
      if (!REDIRECT_STATUSES.has(response.status)) {
        if (response.status < 200 || response.status >= 300) {
          throw new FeedLinkPreviewError(REASON.requestFailed);
        }
        return { body: response.body, finalUrl: target };
      }
      if (hop >= MAX_REDIRECTS) throw new FeedLinkPreviewError(REASON.tooManyRedirects);
      target = nextHop(response.location, target);
    }
  }

  private async fetchHop(
    target: URL,
    accept: string,
    maxBytes: number,
  ): Promise<{ status: number; location: string | null; body: Buffer }> {
    const controller = new AbortController();
    // bodyの読取までを1つのタイマーで覆い、finallyで必ず片付ける。
    const timer = setTimeout(() => controller.abort(), HOP_TIMEOUT_MS);
    try {
      const response = await this.fetchImpl(target.toString(), {
        method: "GET",
        // 自動追従させない。追う場合はこちらで毎回検証する。
        redirect: "manual",
        credentials: "omit",
        headers: { "user-agent": LINK_PREVIEW_USER_AGENT, accept },
        referrer: "",
        referrerPolicy: "no-referrer",
        signal: controller.signal,
      });
      return {
        status: response.status,
        location: response.headers.get("location"),
        body: await readLimitedBody(response, maxBytes),
      };
    } finally {
      clearTimeout(timer);
    }
  }

  /**
   * SSRF対策の中核。ホスト名の文字列だけを見るのでは不十分なので、
   * 実際に解決されるアドレスを全て検査する（1つでもprivateなら拒否）。
   */
  private async assertPublicHost(target: URL): Promise<void> {
    const hostname = stripHostBrackets(target.hostname);
    if (!hostname) throw new FeedLinkPreviewError(REASON.invalidUrl);
    const literal = parseIp(hostname);
    if (literal && isBlockedIp(literal)) throw new FeedLinkPreviewError(REASON.blockedHost);

    let addresses: readonly string[];
    try {
      addresses = await this.resolveHost(hostname);
    } catch {
      throw new FeedLinkPreviewError(REASON.unresolvedHost);
    }
    if (!Array.isArray(addresses) || addresses.length === 0) {
      throw new FeedLinkPreviewError(REASON.unresolvedHost);
    }
    for (const address of addresses) {
      // 解釈できない解決結果は「安全と確認できない」ため拒否する。
      const resolved = typeof address === "string" ? parseIp(stripHostBrackets(address)) : null;
      if (!resolved || isBlockedIp(resolved)) throw new FeedLinkPreviewError(REASON.blockedHost);
    }
  }

  /** サムネイルは装飾なので、取得・保存に失敗してもPreview本体は返す。 */
  private async storeThumbnail(imageUrl: string): Promise<string | null> {
    try {
      const image = await this.fetchFollowingRedirects(
        requireAllowedUrl(imageUrl),
        LINK_PREVIEW_IMAGE_ACCEPT,
        MAX_IMAGE_BYTES,
      );
      const extension = detectImageExtension(image.body);
      if (!extension) return null;
      return this.writeThumbnail(image.body, extension);
    } catch {
      return null;
    }
  }

  /**
   * ファイル名は内容のsha256なので、同じ画像は同じ名前になる。
   * 既存ファイルを上書きしないため、並行取得でも別の内容が混ざらない。
   */
  private writeThumbnail(bytes: Buffer, extension: string): string {
    const fileName = `${createHash("sha256").update(bytes).digest("hex")}.${extension}`;
    const targetPath = path.join(this.attachmentDirectory, fileName);
    fs.mkdirSync(this.attachmentDirectory, { recursive: true });
    if (fs.existsSync(targetPath)) return fileName;
    // 書込み途中のファイルを添付プロトコルから読ませないよう、temp→renameで置く。
    const temporaryPath = path.join(this.attachmentDirectory, `.${fileName}.${randomUUID()}.tmp`);
    try {
      const descriptor = fs.openSync(temporaryPath, "wx");
      try {
        fs.writeFileSync(descriptor, bytes);
        fs.fsyncSync(descriptor);
      } finally {
        fs.closeSync(descriptor);
      }
      fs.renameSync(temporaryPath, targetPath);
    } finally {
      if (fs.existsSync(temporaryPath)) fs.rmSync(temporaryPath, { force: true });
    }
    return fileName;
  }

  private readCache(key: string): FeedLinkPreviewResult | null {
    const entry = this.cache.get(key);
    if (!entry) return null;
    if (entry.expiresAt <= Date.now()) {
      this.cache.delete(key);
      return null;
    }
    // 呼出し側の書換えがcacheへ波及しないよう、毎回複製して返す。
    return entry.result.ok
      ? { ok: true, preview: { ...entry.result.preview } }
      : { ok: false, reason: entry.result.reason };
  }

  private writeCache(key: string, result: FeedLinkPreviewResult): void {
    const ttl = result.ok ? CACHE_TTL_MS : FAILURE_CACHE_TTL_MS;
    // 同じkeyは入れ直して末尾へ移し、「先頭＝最古」の順序を保つ。
    this.cache.delete(key);
    this.cache.set(key, { result, expiresAt: Date.now() + ttl });
    while (this.cache.size > MAX_CACHE_ENTRIES) {
      const oldest = this.cache.keys().next();
      if (oldest.done) break;
      this.cache.delete(oldest.value);
    }
  }
}

function nextHop(location: string | null, base: URL): URL {
  if (!location) throw new FeedLinkPreviewError(REASON.badRedirect);
  let resolved: URL;
  try {
    resolved = new URL(location, base);
  } catch {
    throw new FeedLinkPreviewError(REASON.badRedirect);
  }
  try {
    // 転送先にも scheme・資格情報の規則を適用する。
    return requireAllowedUrl(resolved.toString());
  } catch {
    throw new FeedLinkPreviewError(REASON.badRedirect);
  }
}
