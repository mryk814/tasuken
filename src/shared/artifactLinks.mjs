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
