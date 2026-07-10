// Artifact managed / linked の純ロジック（I/Oなし）。Main / Renderer / テストで共有する。

export const ARTIFACT_STORAGE_MODES = ["managed", "linked"];
export const ARTIFACT_LINK_TYPES = ["url", "local_path", "shared_path", "onedrive", "sharepoint", "teams"];
export const ARTIFACT_LINK_STATUSES = ["unknown", "ok", "broken", "inaccessible"];

export function resolveArtifactStorageMode(value) {
  return value === "linked" ? "linked" : "managed";
}

export function isHttpUrl(value) {
  return /^https?:\/\//i.test(String(value || "").trim());
}

/** 文中から http(s) URL を取り出す（末尾の句読点は落とす）。 */
export function extractHttpUrls(text) {
  const raw = String(text || "");
  const matches = raw.match(/https?:\/\/[^\s<>"'`]+/gi) || [];
  return [...new Set(matches.map((url) => url.replace(/[),.;:]+$/g, "").trim()).filter(Boolean))];
}

/**
 * DataTransfer から URL を拾う（ブラウザからURLをドラッグしたとき用）。
 * files がある場合は呼び出し側でファイルを優先する。
 */
export function extractUrlsFromDataTransfer(dataTransfer) {
  if (!dataTransfer || typeof dataTransfer.getData !== "function") return [];
  const urls = [];
  try {
    const uriList = dataTransfer.getData("text/uri-list") || "";
    for (const line of uriList.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (trimmed && !trimmed.startsWith("#") && isHttpUrl(trimmed)) urls.push(trimmed);
    }
  } catch {
    // getData が失敗する環境では text/plain のみ試す。
  }
  try {
    urls.push(...extractHttpUrls(dataTransfer.getData("text/plain") || ""));
  } catch {
    // ignore
  }
  try {
    const html = dataTransfer.getData("text/html") || "";
    const hrefMatches = html.matchAll(/\bhref\s*=\s*["'](https?:\/\/[^"']+)["']/gi);
    for (const match of hrefMatches) {
      if (match[1]) urls.push(match[1]);
    }
  } catch {
    // ignore
  }
  return [...new Set(urls.map((url) => url.trim()).filter((url) => isHttpUrl(url)))];
}

export function isUncPath(value) {
  const target = String(value || "").trim();
  return target.startsWith("\\\\") || /^\/\/[^/]/.test(target);
}

/**
 * target 文字列から link_type を推定する。
 * OneDrive / SharePoint / Teams の URL を優先し、それ以外の http(s) は url。
 */
export function inferArtifactLinkType(target) {
  const raw = String(target || "").trim();
  if (!raw) return "url";
  if (isHttpUrl(raw)) {
    const lower = raw.toLowerCase();
    if (lower.includes("teams.microsoft.com") || lower.includes("teams.live.com")) return "teams";
    if (lower.includes("sharepoint.com") || lower.includes("sharepoint.")) return "sharepoint";
    if (
      lower.includes("onedrive.live.com")
      || lower.includes("1drv.ms")
      || lower.includes("onedrive.com")
      || lower.includes("-my.sharepoint.com")
    ) {
      return "onedrive";
    }
    return "url";
  }
  if (isUncPath(raw)) return "shared_path";
  return "local_path";
}

export function artifactOpenTarget(artifact) {
  if (!artifact || typeof artifact !== "object") return "";
  if (resolveArtifactStorageMode(artifact.storage_mode) === "linked") {
    return String(artifact.target || "").trim();
  }
  return String(artifact.stored_path || "").trim();
}

export function artifactCopyTarget(artifact) {
  return artifactOpenTarget(artifact);
}

/** フォルダを開く対象になるローカル系パスか。 */
export function artifactCanShowInFolder(artifact) {
  if (!artifact || typeof artifact !== "object") return false;
  const mode = resolveArtifactStorageMode(artifact.storage_mode);
  if (mode === "managed") return Boolean(String(artifact.stored_path || "").trim());
  const target = String(artifact.target || "").trim();
  if (!target || isHttpUrl(target)) return false;
  const linkType = artifact.link_type || inferArtifactLinkType(target);
  return linkType === "local_path" || linkType === "shared_path"
    || (linkType === "onedrive" && !isHttpUrl(target));
}

export function artifactFolderPath(artifact) {
  if (!artifactCanShowInFolder(artifact)) return "";
  return artifactOpenTarget(artifact);
}

/** linked → managed 化できる（ローカル/共有パスの実体がある）か。 */
export function artifactCanPromoteToManaged(artifact) {
  if (!artifact || typeof artifact !== "object") return false;
  if (resolveArtifactStorageMode(artifact.storage_mode) !== "linked") return false;
  const target = String(artifact.target || "").trim();
  if (!target || isHttpUrl(target)) return false;
  return true;
}

export function displayNameFromTarget(target, fallback = "link") {
  const raw = String(target || "").trim();
  if (!raw) return fallback;
  if (isHttpUrl(raw)) {
    try {
      const url = new URL(raw);
      const base = decodeURIComponent(url.pathname.split("/").filter(Boolean).pop() || "");
      if (base) return base.slice(0, 120);
      return (url.hostname || fallback).slice(0, 120);
    } catch {
      return raw.slice(0, 120);
    }
  }
  const normalized = raw.replace(/\\/g, "/");
  const base = normalized.split("/").filter(Boolean).pop() || raw;
  return base.slice(0, 120);
}

export function artifactFileTypeFromName(name) {
  const match = String(name || "").match(/\.([^.]+)$/);
  return match ? match[1].toLowerCase() : "file";
}
