// Web Artifact の識別と、専用sandbox iframeへ渡すHTMLの境界。
// DOM・Electron・ファイルI/Oには依存しないため、Main / Renderer / テストで共有する。

export const WEB_ARTIFACT_EXECUTION_POLICIES = ["static", "sandboxed_interactive"];
export const WEB_ARTIFACT_KIND = "self_contained_html";

const HTML_EXTENSIONS = new Set(["html", "htm"]);
const HTML_MIME = "text/html";
const DANGEROUS_ELEMENT_PATTERN = /<(iframe|frame|object|embed|portal|base)\b[^>]*>[\s\S]*?<\/\1\s*>/gi;
const DANGEROUS_VOID_ELEMENT_PATTERN = /<\/?(iframe|frame|object|embed|portal|base)\b[^>]*>/gi;
const META_REFRESH_PATTERN = /<meta\b[^>]*(?:http-equiv\s*=\s*["']?refresh|content\s*=\s*["'][^"']*url\s*=)[^>]*>/gi;
const SCRIPT_ELEMENT_PATTERN = /<script\b[^>]*>[\s\S]*?<\/script\s*>/gi;
const SCRIPT_VOID_PATTERN = /<script\b[^>]*\/?\s*>/gi;
const EXTERNAL_SCRIPT_PATTERN = /<script\b(?=[^>]*\bsrc\s*=)[^>]*>[\s\S]*?<\/script\s*>/gi;
const EXTERNAL_SCRIPT_VOID_PATTERN = /<script\b(?=[^>]*\bsrc\s*=)[^>]*\/?\s*>/gi;
const EVENT_ATTRIBUTE_PATTERN = /\s+on[a-z][\w:-]*\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi;
const URL_ATTRIBUTE_PATTERN = /\s+(href|src|srcset|poster|action|formaction|xlink:href)\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi;

function attributeValue(value) {
  const trimmed = String(value || "").trim();
  if ((trimmed.startsWith("\"") && trimmed.endsWith("\"")) || (trimmed.startsWith("'") && trimmed.endsWith("'"))) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

function safeUrlAttribute(name, rawValue) {
  const value = attributeValue(rawValue);
  const lower = value.toLowerCase();
  if (name.toLowerCase() === "href" && value.startsWith("#")) return rawValue;
  if (["src", "poster"].includes(name.toLowerCase()) && /^(?:data:(?:image|audio|video)\/|blob:)/i.test(value)) return rawValue;
  if (!value || /^(?:javascript:|vbscript:|data:text\/html|file:|https?:|wss?:|\/\/)/i.test(lower)) {
    return '="#"';
  }
  // self-contained HTML may keep fragment links and inline data only. Relative
  // file/network references are removed so a file:// base cannot escape the
  // iframe's CSP boundary.
  return '="#"';
}

function rewriteUnsafeUrlAttributes(markup) {
  return markup
    .replace(URL_ATTRIBUTE_PATTERN, (_match, name, value) => ` ${name}=${safeUrlAttribute(name, value)}`)
    .replace(/url\(\s*["']?(?:https?:|file:|data:text\/html|javascript:)[^)]*\)/gi, "none");
}

function insertCsp(markup, policy) {
  const csp = webArtifactCsp(policy);
  const meta = `<meta http-equiv="Content-Security-Policy" content="${csp}"><meta name="referrer" content="no-referrer">`;
  const head = markup.match(/<head\b[^>]*>/i);
  if (head && head.index != null) {
    const end = head.index + head[0].length;
    return `${markup.slice(0, end)}${meta}${markup.slice(end)}`;
  }
  const doctype = markup.match(/^\s*<!doctype\b[^>]*>/i);
  if (doctype && doctype.index != null) {
    const end = doctype.index + doctype[0].length;
    return `${markup.slice(0, end)}${meta}${markup.slice(end)}`;
  }
  return `${meta}${markup}`;
}

export function isWebArtifact(input) {
  if (!input || typeof input !== "object") return false;
  const value = input;
  const mime = String(value.mime_type || "").split(";", 1)[0].trim().toLowerCase();
  const fileType = String(value.file_type || "").replace(/^\./, "").trim().toLowerCase();
  const filename = String(value.filename || "").trim().toLowerCase();
  const extension = filename.match(/\.([^.\\/]+)$/)?.[1] || "";
  return mime === HTML_MIME || HTML_EXTENSIONS.has(fileType) || HTML_EXTENSIONS.has(extension);
}

export function normalizeWebArtifactExecutionPolicy(value) {
  return value === "sandboxed_interactive" ? "sandboxed_interactive" : "static";
}

export function sanitizeWebArtifactHtml(value, policy = "static") {
  if (typeof value !== "string") throw new Error("Web ArtifactのHTMLが不正です。");
  const normalizedPolicy = normalizeWebArtifactExecutionPolicy(policy);
  let markup = value;
  markup = markup.replace(DANGEROUS_ELEMENT_PATTERN, "");
  markup = markup.replace(DANGEROUS_VOID_ELEMENT_PATTERN, "");
  markup = markup.replace(META_REFRESH_PATTERN, "");
  markup = markup.replace(EXTERNAL_SCRIPT_PATTERN, "");
  markup = markup.replace(EXTERNAL_SCRIPT_VOID_PATTERN, "");
  if (normalizedPolicy === "static") {
    markup = markup.replace(SCRIPT_ELEMENT_PATTERN, "");
    markup = markup.replace(SCRIPT_VOID_PATTERN, "");
    markup = markup.replace(EVENT_ATTRIBUTE_PATTERN, "");
  }
  return rewriteUnsafeUrlAttributes(markup);
}

export function webArtifactCsp(policy = "static") {
  const scriptPolicy = normalizeWebArtifactExecutionPolicy(policy) === "sandboxed_interactive"
    ? "'unsafe-inline'"
    : "'none'";
  return [
    "default-src 'none'",
    "base-uri 'none'",
    "child-src 'none'",
    "connect-src 'none'",
    "font-src data:",
    "form-action 'none'",
    "frame-src 'none'",
    "img-src data: blob:",
    "media-src data: blob:",
    "object-src 'none'",
    `script-src ${scriptPolicy}`,
    "style-src 'unsafe-inline'",
    "worker-src 'none'",
    "navigate-to 'none'",
  ].join("; ");
}

export function buildWebArtifactDocument(value, policy = "static") {
  const normalizedPolicy = normalizeWebArtifactExecutionPolicy(policy);
  return insertCsp(sanitizeWebArtifactHtml(value, normalizedPolicy), normalizedPolicy);
}
