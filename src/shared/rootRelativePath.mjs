/**
 * 同期される記録の中のパスを、ルート相対の参照として持つための純ロジック（#803 段 6・#814）。
 * 型は rootRelativePath.d.mts が正（canonicalMarkdown.mjs と同じ作法）。
 *
 * 同期される記録（Artifact の stored_path、Note の正本 Markdown の結び付け）には、書いた端末の
 * 絶対パスが入っていた。別の PC や NAS ではルートの絶対位置が違うため、そのままでは指す先が
 * ずれる。Activity の canonical 参照と同じ { storage_root_id, relative_path } の形にすると、
 * 各端末が自分のルートで引き直せる。ID は既存の `sync`（Tasken ルート）を使い、新しい ID は
 * 作らない。
 *
 * ここはファイル I/O をしない（node:fs / node:path に依存しない）。区切り文字は / にそろえ、
 * Windows の \ 区切りとドライブ文字も文字列として扱う。実体の解決（realpath や symlink の
 * 確認）は Main 側の仕事で、ここは形の変換だけを持つ。
 */

export const SYNC_STORAGE_ROOT_ID = "sync";

function text(value) {
  return typeof value === "string" ? value.trim() : "";
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

/**
 * ルート相対の relative_path として安全な形か（Activity の safeRelativePath と同じ規則）。
 * 絶対パス・ドライブ文字・`..` の段を含むものは受けない。区切りは / にそろえる。
 */
export function safeRootRelativePath(value) {
  const raw = text(value).replaceAll("\\", "/");
  if (!raw || raw.startsWith("/") || /^[A-Za-z]:\//.test(raw) || raw.startsWith("//")) return "";
  if (raw.split("/").includes("..")) return "";
  return raw.replace(/^\.\//, "");
}

/** { storage_root_id, relative_path } の形の参照か。 */
export function isRootRelativePathRef(value) {
  return (
    isPlainObject(value) &&
    text(/** @type {Record<string, unknown>} */ (value).storage_root_id) !== "" &&
    safeRootRelativePath(/** @type {Record<string, unknown>} */ (value).relative_path) !== ""
  );
}

/**
 * 参照の形をそろえる。不正な形は null。
 * @returns {{ storage_root_id: string, relative_path: string } | null}
 */
export function normalizeRootRelativePathRef(value) {
  if (!isPlainObject(value)) return null;
  const storageRootId = text(value.storage_root_id);
  const relativePath = safeRootRelativePath(value.relative_path);
  if (!storageRootId || !relativePath) return null;
  // ルート ID は場所の名前であって、パスそのものを持たせない（agentSession の同じ規則）。
  if (/[\\/]/.test(storageRootId) || /^[A-Za-z]:/.test(storageRootId)) return null;
  return { storage_root_id: storageRootId, relative_path: relativePath };
}

function pathSegments(value) {
  return text(value)
    .replaceAll("\\", "/")
    .split("/")
    .filter((segment) => segment !== "" && segment !== ".");
}

function isWindowsStylePath(value) {
  const raw = text(value);
  return /^[A-Za-z]:[\\/]/.test(raw) || raw.startsWith("\\\\") || raw.startsWith("//");
}

/**
 * 絶対パスがルートの下にあれば、ルート相対の参照にする。ルートの外なら null。
 * 比較は段ごとに行い、Windows の形のパスどうしは大文字小文字を区別しない。
 * ルートそのもの（ファイルでない）は対象にしない。
 */
export function rootRelativePathRef(absolutePath, root, storageRootId = SYNC_STORAGE_ROOT_ID) {
  const candidateSegments = pathSegments(absolutePath);
  const rootSegments = pathSegments(root);
  if (!candidateSegments.length || !rootSegments.length) return null;
  if (candidateSegments.length <= rootSegments.length) return null;
  const windowsStyle = isWindowsStylePath(absolutePath) && isWindowsStylePath(root);
  for (let index = 0; index < rootSegments.length; index += 1) {
    const expected = windowsStyle ? rootSegments[index].toLowerCase() : rootSegments[index];
    const actual = windowsStyle ? candidateSegments[index].toLowerCase() : candidateSegments[index];
    if (expected !== actual) return null;
  }
  const relativePath = safeRootRelativePath(candidateSegments.slice(rootSegments.length).join("/"));
  if (!relativePath) return null;
  return normalizeRootRelativePathRef({
    storage_root_id: storageRootId,
    relative_path: relativePath,
  });
}

/**
 * パスの値（絶対パスの文字列、またはルート相対の参照）を、この端末の絶対パスへ引き直す。
 * roots は activityRootRegistry の形（ID → 絶対パス）。引けない参照は空文字。
 * 文字列の値はそのまま返す（従来の絶対パスの記録をそのまま読む）。
 */
export function resolveRootRelativePath(value, roots = {}) {
  if (typeof value === "string") return value;
  const ref = normalizeRootRelativePathRef(value);
  if (!ref) return "";
  const root = roots instanceof Map ? roots.get(ref.storage_root_id) : roots?.[ref.storage_root_id];
  if (typeof root !== "string" || !root.trim()) return "";
  const base = root.trim().replace(/[\\/]+$/, "");
  return `${base}/${ref.relative_path}`;
}

/**
 * 表示・検索・コピー用の文字列。絶対パスはそのまま、参照は relative_path を返す
 * （"[object Object]" のような壊れた文字列を画面や検索へ出さないため）。
 */
export function rootRelativePathText(value) {
  if (typeof value === "string") return value;
  const ref = normalizeRootRelativePathRef(value);
  return ref ? ref.relative_path : "";
}
