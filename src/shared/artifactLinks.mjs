// Artifact managed / linked の純ロジック（I/Oなし）。Main / Renderer / テストで共有する。

import {
  isRootRelativePathRef,
  normalizeRootRelativePathRef,
  resolveRootRelativePath,
  rootRelativePathText,
} from "./rootRelativePath.mjs";

export const ARTIFACT_STORAGE_MODES = ["managed", "linked"];
export const ARTIFACT_LINK_TYPES = [
  "url",
  "local_path",
  "shared_path",
  "onedrive",
  "sharepoint",
  "teams",
];
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
      lower.includes("onedrive.live.com") ||
      lower.includes("1drv.ms") ||
      lower.includes("onedrive.com") ||
      lower.includes("-my.sharepoint.com")
    ) {
      return "onedrive";
    }
    return "url";
  }
  if (isUncPath(raw)) return "shared_path";
  return "local_path";
}

/** managed Artifact の stored_path がルート相対の参照（#814）なら、その参照を返す。 */
export function artifactStoredPathRef(artifact) {
  if (!artifact || typeof artifact !== "object") return null;
  return normalizeRootRelativePathRef(artifact.stored_path);
}

/**
 * ファイルを開く・フォルダに出す・中身を読むための所在（ロケータ）。
 * linked は target の文字列、managed は stored_path（絶対パスの文字列、またはルート相対の
 * 参照オブジェクト）。参照の解決は Main（ルートの登録を持つ側）が行うので、Renderer は
 * この値をそのまま IPC へ渡す。文字列が要る表示・コピーでは artifactPathText を使う。
 */
export function artifactFileLocator(artifact) {
  if (!artifact || typeof artifact !== "object") return "";
  if (resolveArtifactStorageMode(artifact.storage_mode) === "linked") {
    return String(artifact.target || "").trim();
  }
  if (typeof artifact.stored_path === "string") return artifact.stored_path.trim();
  return artifactStoredPathRef(artifact) || "";
}

/**
 * 開く対象の絶対パス。ルート相対の参照は roots（ID → 絶対パス）を渡した時だけ解決する。
 * 解決できない参照は空文字（参照のままでは開けない）。
 */
export function artifactOpenTarget(artifact, roots) {
  if (!artifact || typeof artifact !== "object") return "";
  if (resolveArtifactStorageMode(artifact.storage_mode) === "linked") {
    return String(artifact.target || "").trim();
  }
  if (typeof artifact.stored_path === "string") return artifact.stored_path.trim();
  const ref = artifactStoredPathRef(artifact);
  if (!ref) return "";
  return roots ? resolveRootRelativePath(ref, roots).trim() : "";
}

/** 表示・検索・一覧コピー用のパスの文字列。参照は relative_path で表す。 */
export function artifactPathText(artifact) {
  if (!artifact || typeof artifact !== "object") return "";
  if (resolveArtifactStorageMode(artifact.storage_mode) === "linked") {
    return String(artifact.target || "").trim();
  }
  return rootRelativePathText(artifact.stored_path).trim();
}

export function artifactCopyTarget(artifact) {
  return artifactPathText(artifact);
}

/** フォルダを開く対象になるローカル系パスか。 */
export function artifactCanShowInFolder(artifact) {
  if (!artifact || typeof artifact !== "object") return false;
  const mode = resolveArtifactStorageMode(artifact.storage_mode);
  if (mode === "managed")
    return Boolean(
      (typeof artifact.stored_path === "string" && artifact.stored_path.trim()) ||
      isRootRelativePathRef(artifact.stored_path),
    );
  const target = String(artifact.target || "").trim();
  if (!target || isHttpUrl(target)) return false;
  const linkType = artifact.link_type || inferArtifactLinkType(target);
  return (
    linkType === "local_path" ||
    linkType === "shared_path" ||
    (linkType === "onedrive" && !isHttpUrl(target))
  );
}

export function artifactFolderPath(artifact, roots) {
  if (!artifactCanShowInFolder(artifact)) return "";
  return artifactOpenTarget(artifact, roots);
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
