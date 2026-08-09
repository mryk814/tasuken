/** Provider-neutral, credential-free links attached to Work Receipts. */

export const EXTERNAL_REFERENCE_KINDS = Object.freeze([
  "issue",
  "pull_request",
  "merge_request",
  "commit",
  "branch",
  "file",
  "pipeline",
  "other",
]);

const kindSet = new Set(EXTERNAL_REFERENCE_KINDS);
const secretKeyPattern = /(?:token|secret|password|passwd|credential|authorization|cookie|private[_-]?key|api[_-]?key)/i;

function text(value) {
  return value == null ? "" : String(value).trim();
}

function plainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function normalizeExternalUrl(value) {
  const source = text(value);
  if (!source) throw new Error("External referenceにはURLが必要です。");
  let parsed;
  try { parsed = new URL(source); } catch { throw new Error("External reference URLが不正です。"); }
  if (parsed.protocol !== "https:") throw new Error("External reference URLはHTTPSだけ指定できます。");
  if (parsed.username || parsed.password) throw new Error("External reference URLにcredentialを含めることはできません。");
  for (const [key] of parsed.searchParams) {
    if (secretKeyPattern.test(key)) throw new Error("External reference URLのqueryにcredential/tokenを含めることはできません。");
  }
  // Query and fragment are not needed for the stable external identity and
  // are dropped so pasted tracking/token values never become persisted data.
  parsed.search = "";
  parsed.hash = "";
  return parsed.toString();
}

export function normalizeExternalReference(input) {
  if (!plainObject(input)) throw new Error("External referenceはJSON objectにしてください。");
  const kind = text(input.kind);
  if (!kindSet.has(kind)) throw new Error("External reference.kindが不正です。");
  const displayLabel = text(input.display_label);
  if (!displayLabel || displayLabel.length > 200) throw new Error("External reference.display_labelは1〜200文字で指定してください。");
  const provider = text(input.provider);
  if (provider.length > 120) throw new Error("External reference.providerは120文字以内で指定してください。");
  const externalId = text(input.external_id);
  if (externalId.length > 200) throw new Error("External reference.external_idは200文字以内で指定してください。");
  return {
    kind,
    provider: provider || null,
    display_label: displayLabel,
    url: normalizeExternalUrl(input.url),
    external_id: externalId || null,
  };
}

export function normalizeExternalReferences(value) {
  if (value == null) return [];
  if (!Array.isArray(value) || value.length > 100) throw new Error("external_referencesは最大100件の配列で指定してください。");
  const result = [];
  const seen = new Set();
  for (const entry of value) {
    const normalized = normalizeExternalReference(entry);
    const key = `${normalized.kind}:${normalized.provider || ""}:${normalized.external_id || ""}:${normalized.url}`;
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(normalized);
  }
  return result;
}
