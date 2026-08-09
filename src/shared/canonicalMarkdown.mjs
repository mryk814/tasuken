export const CANONICAL_MARKDOWN_SCHEMA_VERSION = 1;

const CANONICAL_SYNC_STATES = new Set([
  "in_sync",
  "internal_ahead",
  "file_ahead",
  "conflict",
  "unavailable",
]);

const SHA256_K = [
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
];

function rightRotate(value, amount) {
  return (value >>> amount) | (value << (32 - amount));
}

function sha256Hex(bytes) {
  const blockLength = 64;
  const paddedLength = Math.ceil((bytes.length + 9) / blockLength) * blockLength;
  const padded = new Uint8Array(paddedLength);
  padded.set(bytes);
  padded[bytes.length] = 0x80;
  const bitLength = bytes.length * 8;
  const lengthView = new DataView(padded.buffer);
  lengthView.setUint32(paddedLength - 8, Math.floor(bitLength / 0x100000000));
  lengthView.setUint32(paddedLength - 4, bitLength >>> 0);

  let h0 = 0x6a09e667;
  let h1 = 0xbb67ae85;
  let h2 = 0x3c6ef372;
  let h3 = 0xa54ff53a;
  let h4 = 0x510e527f;
  let h5 = 0x9b05688c;
  let h6 = 0x1f83d9ab;
  let h7 = 0x5be0cd19;
  const words = new Uint32Array(64);

  for (let offset = 0; offset < padded.length; offset += blockLength) {
    for (let index = 0; index < 16; index += 1) {
      words[index] = lengthView.getUint32(offset + index * 4);
    }
    for (let index = 16; index < 64; index += 1) {
      const s0 = rightRotate(words[index - 15], 7) ^ rightRotate(words[index - 15], 18) ^ (words[index - 15] >>> 3);
      const s1 = rightRotate(words[index - 2], 17) ^ rightRotate(words[index - 2], 19) ^ (words[index - 2] >>> 10);
      words[index] = (words[index - 16] + s0 + words[index - 7] + s1) >>> 0;
    }

    let a = h0;
    let b = h1;
    let c = h2;
    let d = h3;
    let e = h4;
    let f = h5;
    let g = h6;
    let h = h7;
    for (let index = 0; index < 64; index += 1) {
      const sigma1 = rightRotate(e, 6) ^ rightRotate(e, 11) ^ rightRotate(e, 25);
      const choose = (e & f) ^ (~e & g);
      const temp1 = (h + sigma1 + choose + SHA256_K[index] + words[index]) >>> 0;
      const sigma0 = rightRotate(a, 2) ^ rightRotate(a, 13) ^ rightRotate(a, 22);
      const majority = (a & b) ^ (a & c) ^ (b & c);
      const temp2 = (sigma0 + majority) >>> 0;
      h = g;
      g = f;
      f = e;
      e = (d + temp1) >>> 0;
      d = c;
      c = b;
      b = a;
      a = (temp1 + temp2) >>> 0;
    }
    h0 = (h0 + a) >>> 0;
    h1 = (h1 + b) >>> 0;
    h2 = (h2 + c) >>> 0;
    h3 = (h3 + d) >>> 0;
    h4 = (h4 + e) >>> 0;
    h5 = (h5 + f) >>> 0;
    h6 = (h6 + g) >>> 0;
    h7 = (h7 + h) >>> 0;
  }
  return [h0, h1, h2, h3, h4, h5, h6, h7]
    .map((value) => value.toString(16).padStart(8, "0"))
    .join("");
}

function isPlainObject(value) {
  return value && typeof value === "object" && !Array.isArray(value);
}

function text(value) {
  return typeof value === "string" ? value.trim() : "";
}

function numberOrNull(value) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

/**
 * Note本文から保存するポータブルMarkdownを組み立てる。RendererとMainで
 * 同じ本文を使うため、ここにはファイルI/OやElectron依存を置かない。
 */
export function buildCanonicalMarkdownContent({ title = "", themeName = "", updatedAt = "", body = "" } = {}) {
  const metadata = [
    "---",
    `title: ${JSON.stringify(String(title ?? ""))}`,
    text(themeName) ? `theme: ${JSON.stringify(text(themeName))}` : "",
    text(updatedAt) ? `updated_at: ${JSON.stringify(text(updatedAt))}` : "",
    "---",
    "",
  ].filter((line) => line !== "").join("\n");
  const sourceBody = String(body ?? "");
  const bodyWithTrailingNewline = sourceBody.endsWith("\n") ? sourceBody : `${sourceBody}\n`;
  return `${metadata}\n${bodyWithTrailingNewline}`;
}

/**
 * 旧 markdown_export を読み込める期間の正規化。新しく保存する正本は
 * canonical_markdown へ置き、旧フィールド自体は削除・書き換えしない。
 */
export function normalizeCanonicalMarkdownBinding(value = {}, { noteId = "" } = {}) {
  const source = isPlainObject(value) ? value : {};
  const canonicalPath = text(source.canonical_path || source.canonicalPath || source.filePath || source.path);
  const syncState = CANONICAL_SYNC_STATES.has(source.sync_state)
    ? source.sync_state
    : (canonicalPath && text(source.file_signature || source.fileSignature) ? "in_sync" : "unavailable");
  return {
    schema_version: Number(source.schema_version) || CANONICAL_MARKDOWN_SCHEMA_VERSION,
    binding_id: text(source.binding_id || source.bindingId) || (text(noteId) ? `note:${text(noteId)}` : ""),
    mode: "linked_canonical",
    canonical_path: canonicalPath,
    directory: text(source.directory),
    root_identity: text(source.root_identity || source.rootIdentity),
    file_name: text(source.file_name || source.fileName),
    body_signature: text(source.body_signature || source.bodySignature),
    file_signature: text(source.file_signature || source.fileSignature),
    file_size: numberOrNull(source.file_size ?? source.fileSize),
    file_mtime_ms: numberOrNull(source.file_mtime_ms ?? source.fileMtimeMs),
    last_synced_revision: numberOrNull(source.last_synced_revision ?? source.lastSyncedRevision),
    sync_state: syncState,
    last_operation_id: text(source.last_operation_id || source.lastOperationId),
    last_attempt_at: text(source.last_attempt_at || source.lastAttemptAt),
    last_synced_at: text(source.last_synced_at || source.lastSyncedAt),
    last_error: text(source.last_error || source.lastError),
    file_ahead_signature: text(source.file_ahead_signature || source.fileAheadSignature),
  };
}

export function canonicalMarkdownBindingFromProperties(properties = {}, { noteId = "" } = {}) {
  if (!isPlainObject(properties)) return null;
  if (isPlainObject(properties.canonical_markdown)) {
    return normalizeCanonicalMarkdownBinding(properties.canonical_markdown, { noteId });
  }
  if (isPlainObject(properties.markdown_export)) {
    return normalizeCanonicalMarkdownBinding(properties.markdown_export, { noteId });
  }
  return null;
}

export function withCanonicalMarkdownBinding(properties = {}, binding = {}) {
  return {
    ...(isPlainObject(properties) ? properties : {}),
    canonical_markdown: normalizeCanonicalMarkdownBinding(binding, {
      noteId: binding?.binding_id ? String(binding.binding_id).replace(/^note:/, "") : "",
    }),
  };
}

export function canonicalMarkdownFileState(syncState) {
  switch (syncState) {
    case "in_sync": return "synced";
    case "conflict":
    case "file_ahead": return "external_change";
    case "internal_ahead": return "failed";
    case "unavailable": return "pending";
    default: return "none";
  }
}

/**
 * Noteの正本Markdownを更新するときの判断（#291）。
 *
 * 通常のMarkdownは「毎回生成する出力物」ではなく、Note本文のポータブルな正本ファイル。
 * 保存のたびに新しいファイルやArtifactを増やさず、同じ `.md` を更新し続ける。
 *
 * ここはファイルI/Oをせず、判断だけを持つ（node:fsに依存しない）。
 * 実際の読み書きは Main 側が行う。
 */

/** 本文の同一性を見るSHA-256署名。旧djb2署名とは形式を分け、安全側へ倒す。 */
export function markdownSignature(content) {
  const text = String(content ?? "");
  const bytes = new TextEncoder().encode(text);
  return `sha256:${bytes.length}:${sha256Hex(bytes)}`;
}

/**
 * 正本Markdownを書き込んでよいかを決める（#291）。
 *
 * Tasken外（別端末・エディタ・OneDriveの競合コピー）でファイルが変わっていることがある。
 * 保存前に、前回書いた内容の署名と、いまのファイルの署名を比べる。
 * 食い違えば黙って上書きせず、利用者へ選ばせる。
 *
 * @returns {{ action: "write" }
 *   | { action: "skip", reason: "unchanged" }
 *   | { action: "confirm", reason: "external_change", externalSignature: string }
 *   | { action: "unavailable", reason: "missing_path" | "root_unavailable" }}
 */
export function planCanonicalMarkdownWrite({
  canonicalPath = "",
  nextContent = "",
  lastWrittenSignature = "",
  currentFileSignature = null,
  fileExists = true,
  rootAvailable = true,
} = {}) {
  if (!String(canonicalPath || "").trim()) return { action: "unavailable", reason: "missing_path" };
  // ルートが一時的に見えない（OneDrive未同期・ネットワークドライブ等）ときは、
  // 失敗ではなく保留にして再試行できるようにする。内部の保存は先に確定させる。
  if (!rootAvailable) return { action: "unavailable", reason: "root_unavailable" };

  const nextSignature = markdownSignature(nextContent);

  // ファイルが消えている場合は作り直す。外部変更として止めない。
  if (!fileExists) return { action: "write" };

  if (currentFileSignature != null && lastWrittenSignature && currentFileSignature !== lastWrittenSignature) {
    // 前回Taskenが書いた内容と、いまのファイルが違う = 外部で変更された。
    // 内容がたまたま同じなら、わざわざ確認を出さない。
    if (currentFileSignature === nextSignature) return { action: "skip", reason: "unchanged" };
    return { action: "confirm", reason: "external_change", externalSignature: currentFileSignature };
  }

  // 既存bindingに前回署名がない場合も、存在するファイルを黙って上書きしない。
  if (currentFileSignature != null && !lastWrittenSignature) {
    if (currentFileSignature === nextSignature) return { action: "skip", reason: "unchanged" };
    return { action: "confirm", reason: "external_change", externalSignature: currentFileSignature };
  }

  if (currentFileSignature != null && currentFileSignature === nextSignature) {
    return { action: "skip", reason: "unchanged" };
  }
  return { action: "write" };
}

/**
 * 保存済み表示（#291）。
 * Tasken内部とファイルの両方を反映し、片方だけ成功した状態を「保存済み」に見せない。
 */
export function noteSaveStateLabel({ internalSaved = false, fileState = "none" } = {}) {
  if (!internalSaved) return "保存中…";
  switch (fileState) {
    case "synced":
      return "すべての変更を保存しました";
    case "pending":
      return "Taskenへ保存しました。Markdownの更新を待っています";
    case "external_change":
      return "Taskenへ保存しました。Markdownが外部で変更されています";
    case "failed":
      return "Taskenへ保存しましたが、Markdownを更新できませんでした";
    case "conflict":
      return "Taskenへ保存しました。Markdownの競合を確認してください";
    case "unavailable":
      return "Taskenへ保存しました。Markdownの保存先を確認してください";
    case "none":
    default:
      // 正本Markdownをまだ持たないNote。ファイル状態を語らない。
      return "保存しました";
  }
}

/** 通常保存で正本Markdownを更新しただけのときは、Artifactを増やさない（#291）。 */
export function shouldCreateExportArtifact(format, purpose = "derived") {
  // canonical保存は同じ正本ファイルを更新するだけなのでArtifactを増やさない。
  // 明示的なMarkdownコピーは利用者が別ファイルを作った操作なので、派生出力として扱う。
  if (purpose === "canonical") return false;
  return Boolean(String(format || "").trim());
}
