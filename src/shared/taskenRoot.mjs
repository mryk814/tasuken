/**
 * Tasken ルート（#803 段 1・#809）の、ファイルに触らない決まり。
 *
 * ルートは設定 `artifactDirectory`（meta の `artifact_directory`）そのもので、見せる名前だけを
 * 「Tasken ルート」にした。配下の決まりは storageResolver.mjs が持つ。ここでは、
 * ルートの目印の形、場所の性質（cloud / nas / local）の判定、ルートの外にある場所（例外）の
 * 一覧を決める。どれも端末ごとの値で、同期される記録には入れない。
 *
 * node:fs・node:path に依存しない。Windows のパスと POSIX のパスを同じ関数で扱うため、
 * 区切りと大文字小文字の扱いはここで決める。
 */

export const TASKEN_ROOT_MARKER = ".tasken-root.json";
export const TASKEN_ROOT_MARKER_SCHEMA = "tasken-root/v1";

/** 端末ごとの設定の値。auto は自動判定に従う。 */
export const TASKEN_ROOT_KIND_PREFERENCES = ["auto", "cloud", "nas", "local"];

/** 同期を新しく始めるときの、ルートの下の置き場。既存の同期フォルダは動かさない。 */
export const TASKEN_ROOT_SYNC_FOLDER = "Sync";
const ACTIVITY_FOLDER = "Activity";

// Google Drive for desktop が作るフォルダの名前。ドライブ文字は端末ごとに違うので、名前で見る。
const GOOGLE_DRIVE_SEGMENTS = ["my drive", "マイドライブ", "google drive", "googledrive"];
const ONEDRIVE_ENV_KEYS = ["OneDrive", "OneDriveCommercial", "OneDriveConsumer"];

function text(value) {
  return typeof value === "string" ? value.trim() : "";
}

/** ドライブ文字か UNC で始まるなら Windows のパスとして扱う（大文字小文字を区別しない）。 */
function isWindowsPath(value) {
  return /^[a-zA-Z]:([\\/]|$)/.test(value) || /^\\\\/.test(value);
}

function isUncPath(value) {
  return /^(\\\\|\/\/)[^\\/]+[\\/]+[^\\/]+/.test(value);
}

/**
 * 比べるための形にする。区切りを揃え、`.` と `..` を畳み、末尾の区切りを落とす。
 * Windows のパスは小文字にする。返すのは比べる専用の文字列で、表示や書き込みには使わない。
 */
export function comparablePath(value) {
  const raw = text(value);
  if (!raw) return "";
  const windows = isWindowsPath(raw) || isUncPath(raw);
  const unified = windows ? raw.replace(/\//g, "\\") : raw;
  const separator = windows ? "\\" : "/";
  let prefix = "";
  let rest = unified;
  if (windows && /^\\\\/.test(unified)) {
    prefix = "\\\\";
    rest = unified.slice(2);
  } else if (windows) {
    prefix = `${unified.slice(0, 2)}\\`;
    rest = unified.slice(2);
  } else if (unified.startsWith("/")) {
    prefix = "/";
    rest = unified.slice(1);
  }
  const segments = [];
  for (const segment of rest.split(separator)) {
    if (!segment || segment === ".") continue;
    if (segment === "..") {
      segments.pop();
      continue;
    }
    segments.push(segment);
  }
  const joined = prefix + segments.join(separator);
  return windows ? joined.toLowerCase() : joined;
}

/** child が parent と同じか、その下にあるか。 */
export function isPathInside(child, parent) {
  const a = comparablePath(child);
  const b = comparablePath(parent);
  if (!a || !b) return false;
  if (a === b) return true;
  const separator = b.includes("\\") || /^[a-z]:/.test(b) ? "\\" : "/";
  const base = b.endsWith(separator) ? b : `${b}${separator}`;
  return a.startsWith(base);
}

function separatorOf(value) {
  return isWindowsPath(value) || isUncPath(value) ? "\\" : "/";
}

/** ルートの下の子の場所。表示と既定の場所に使うので、元の大文字小文字を残す。 */
export function joinUnderRoot(root, ...segments) {
  const base = text(root);
  if (!base) return "";
  const separator = separatorOf(base);
  const trimmed = base.replace(/[\\/]+$/, "") || base;
  return [trimmed, ...segments].join(separator);
}

/** 親のフォルダ。ドライブや共有の頭（C:\ や \\server\share）より上には上がらない。 */
export function parentDirectory(value) {
  const raw = text(value).replace(/[\\/]+$/, "");
  if (!raw) return "";
  const unc = raw.match(/^(\\\\|\/\/)[^\\/]+[\\/]+[^\\/]+/);
  const index = Math.max(raw.lastIndexOf("\\"), raw.lastIndexOf("/"));
  if (index < 0) return "";
  if (unc && raw.length <= unc[0].length) return "";
  const parent = raw.slice(0, index);
  if (unc && parent.length < unc[0].length) return "";
  if (/^[a-zA-Z]:$/.test(parent)) return `${parent}\\`;
  if (parent === "") return "/";
  return parent;
}

/**
 * 場所の性質を判定する。空なら null。
 * - cloud: 環境変数 OneDrive・OneDriveCommercial・OneDriveConsumer の配下、または Google Drive の形
 * - nas: UNC パス（\\server\share・//server/share）
 * - local: それ以外
 * ネットワークドライブ（Z: など）は、ファイルに触らずには見分けられないので local になる。直すのは Settings。
 * @param {string} root
 * @param {Record<string, string | undefined>} [env]
 * @returns {"cloud" | "nas" | "local" | null}
 */
export function detectTaskenRootKind(root, env = {}) {
  const value = text(root);
  if (!value) return null;
  for (const key of ONEDRIVE_ENV_KEYS) {
    const base = text(env?.[key]);
    if (base && isPathInside(value, base)) return "cloud";
  }
  const segments = value
    .split(/[\\/]+/)
    .map((segment) => segment.trim().toLowerCase())
    .filter(Boolean);
  if (segments.some((segment) => GOOGLE_DRIVE_SEGMENTS.includes(segment))) return "cloud";
  if (isUncPath(value)) return "nas";
  return "local";
}

export function normalizeTaskenRootKindPreference(value) {
  return TASKEN_ROOT_KIND_PREFERENCES.includes(value) ? value : "auto";
}

/** 本人が直した値があればそれ、無ければ判定した値。 */
export function effectiveTaskenRootKind(preference, detected) {
  const normalized = normalizeTaskenRootKindPreference(preference);
  return normalized === "auto" ? detected : normalized;
}

export function buildTaskenRootMarker({ workspaceId, createdAt }) {
  return {
    schema: TASKEN_ROOT_MARKER_SCHEMA,
    workspaceId: String(workspaceId || ""),
    createdAt: String(createdAt || ""),
  };
}

export function isTaskenRootMarker(value) {
  return Boolean(
    value &&
    typeof value === "object" &&
    value.schema === TASKEN_ROOT_MARKER_SCHEMA &&
    typeof value.workspaceId === "string" &&
    value.workspaceId,
  );
}

/**
 * 目印の workspaceId をこの端末と照らす。止めることはしない。
 * 同期に参加していない端末は、Workspace がまだ決まっていない（参加すると変わる）ので照らさない。
 * @returns {"ok" | "missing" | "invalid" | "mismatch" | "unchecked"}
 */
export function compareTaskenRootMarker({ marker, workspaceId, workspaceSettled }) {
  if (marker === null || marker === undefined) return "missing";
  if (!isTaskenRootMarker(marker)) return "invalid";
  if (marker.workspaceId === workspaceId) return "ok";
  return workspaceSettled ? "mismatch" : "unchecked";
}

/**
 * ルートの外にある場所（例外）の一覧。並びは 同期フォルダ → Theme → 日誌 → 控え。
 * 控えは同期やクラウドの事故と一緒に壊れないよう、いつもルートの外に置く前提なので常に載せる。
 * ルートがクラウドで、控えがその配下にあるときだけ注意を付ける。
 *
 * @param {{
 *   root?: string,
 *   rootKind?: "cloud" | "nas" | "local" | null,
 *   syncDirectory?: string,
 *   themes?: Array<{ id?: unknown, name?: unknown, code?: unknown, storage_root?: unknown, deleted_at?: unknown }>,
 *   activityLogDirectory?: string,
 *   backupDirectory?: string,
 * }} input
 * @returns {Array<{ kind: "sync" | "theme" | "activity" | "backup", path: string, themeId?: string, themeName?: string, warning?: "backup_in_cloud_root" }>}
 */
export function listTaskenRootExceptions({
  root = "",
  rootKind = null,
  syncDirectory = "",
  themes = [],
  activityLogDirectory = "",
  backupDirectory = "",
} = {}) {
  const rootPath = text(root);
  const result = [];
  const sync = text(syncDirectory);
  if (sync && !(rootPath && isPathInside(sync, rootPath))) {
    result.push({ kind: "sync", path: sync });
  }
  const themeRows = (Array.isArray(themes) ? themes : [])
    .filter((theme) => theme && !theme.deleted_at && text(theme.storage_root))
    .map((theme) => ({
      kind: /** @type {const} */ ("theme"),
      path: text(theme.storage_root),
      themeId: String(theme.id || ""),
      themeName: text(theme.name) || text(theme.code) || String(theme.id || ""),
    }))
    .sort(
      (a, b) => a.themeName.localeCompare(b.themeName, "ja") || a.themeId.localeCompare(b.themeId),
    );
  result.push(...themeRows);
  const activity = text(activityLogDirectory);
  if (
    activity &&
    !(
      rootPath &&
      comparablePath(activity) === comparablePath(joinUnderRoot(rootPath, ACTIVITY_FOLDER))
    )
  ) {
    result.push({ kind: "activity", path: activity });
  }
  const backup = text(backupDirectory);
  if (backup) {
    const insideCloudRoot = rootKind === "cloud" && rootPath && isPathInside(backup, rootPath);
    result.push(
      insideCloudRoot
        ? { kind: "backup", path: backup, warning: "backup_in_cloud_root" }
        : { kind: "backup", path: backup },
    );
  }
  return result;
}

/**
 * ルートが空で同期フォルダだけある端末に出す候補（同期フォルダの親）。自動では決めない。
 * 親がドライブの頭（C:\ や /）になるときは出さない。ワンクリックでドライブ直下に
 * Themes/ や Inbox/ を作らせないため。共有の頭（\\nas\share）は NAS をルートにする意図がありうるので出す。
 */
export function taskenRootCandidate({ root = "", syncDirectory = "" } = {}) {
  if (text(root)) return null;
  const parent = parentDirectory(syncDirectory);
  if (!parent || /^[a-zA-Z]:[\\/]?$/.test(parent) || parent === "/") return null;
  return parent;
}

/** 同期フォルダを選ぶダイアログの初期位置。ルートが無ければ null（OS の既定）。 */
export function syncFolderDefaultPath(root) {
  return text(root) ? joinUnderRoot(root, TASKEN_ROOT_SYNC_FOLDER) : null;
}
