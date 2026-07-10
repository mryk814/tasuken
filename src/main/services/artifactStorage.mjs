// Artifactファイル保存の純粋ロジック（パス組み立て・命名・種別判定）。
// ファイルI/O自体はworkspaceServiceが行い、ここはnode:fsに依存しない。

const ARTIFACT_MIME_TYPES = {
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  xls: "application/vnd.ms-excel",
  csv: "text/csv",
  tsv: "text/tab-separated-values",
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
  bmp: "image/bmp",
  svg: "image/svg+xml",
  pdf: "application/pdf",
  md: "text/markdown",
  markdown: "text/markdown",
  txt: "text/plain",
  json: "application/json",
  html: "text/html",
  pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  ppt: "application/vnd.ms-powerpoint",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  doc: "application/msword",
  zip: "application/zip",
};

export function splitArtifactFileName(fileName) {
  const name = String(fileName || "");
  const match = name.match(/^(.+)(\.[^.]+)$/);
  if (!match || !match[1]) return { base: name, extension: "" };
  return { base: match[1], extension: match[2] };
}

export function artifactFileTypeOf(fileName) {
  const { extension } = splitArtifactFileName(fileName);
  const normalized = extension.replace(/^\./, "").toLowerCase();
  return normalized || "file";
}

export function artifactMimeTypeOf(fileName) {
  return ARTIFACT_MIME_TYPES[artifactFileTypeOf(fileName)] || "application/octet-stream";
}

export function safeArtifactFileName(fileName) {
  const { base, extension } = splitArtifactFileName(String(fileName || "").trim());
  const cleanedBase = base
    .replace(/[\\/:*?"<>|]+/g, "-")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 120);
  const cleanedExtension = extension.replace(/[\\/:*?"<>|\s]+/g, "").toLowerCase();
  return `${cleanedBase || "artifact"}${cleanedExtension}`;
}

// 同名ファイルがある場合は「name (2).ext」形式で衝突しない名前を返す（上書き事故防止）。
export function resolveUniqueArtifactFileName(fileName, exists) {
  const safeName = safeArtifactFileName(fileName);
  if (!exists(safeName)) return safeName;
  const { base, extension } = splitArtifactFileName(safeName);
  for (let index = 2; index <= 999; index += 1) {
    const candidate = `${base} (${index})${extension}`;
    if (!exists(candidate)) return candidate;
  }
  throw new Error("同名ファイルが多すぎて保存できません。保存先のフォルダを整理してください。");
}

// 保存先のサブフォルダはローカル日付のYYYY/MM。toISOStringは使わない（UTCずれ防止）。
// #146 以降の Theme ルールでは月次は任意。既存呼び出し互換のため残す。
export function artifactMonthSegments(date = new Date()) {
  return [String(date.getFullYear()), String(date.getMonth() + 1).padStart(2, "0")];
}

/** Theme 自動配置フォルダ名。表示名ではなく code / id を使い、改名で追従しない。 */
export function safeThemeFolderSegment(value) {
  const cleaned = String(value || "")
    .replace(/[\\/:*?"<>|]+/g, "-")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 80);
  return cleaned || "theme";
}

/**
 * Theme 単位のコンテンツ保存先（#146）。
 * contentKind:
 * - artifacts → Artifacts/（Theme なしは Inbox/）
 * - notes → Notes/（Markdown 既定）
 * - exports → Exports/（PDF 等の既定候補）
 *
 * - Theme.storage_root あり → {storage_root}/{kind}
 * - Theme あり・未設定 → {artifactDirectory}/Themes/{code|id}/{kind}
 * - Theme なし → {artifactDirectory}/Inbox または Inbox/{kind}
 *
 * @returns {{ kind: "needs_directory" } | { kind: "ok", root: string, segments: string[] }}
 */
export function resolveThemeContentDirectoryParts({
  artifactDirectory,
  themeId,
  themeCode,
  themeStorageRoot,
  contentKind = "artifacts",
} = {}) {
  const kindKey = String(contentKind || "artifacts");
  const subfolder = kindKey === "notes" ? "Notes" : kindKey === "exports" ? "Exports" : "Artifacts";
  const storageRoot = String(themeStorageRoot || "").trim();
  if (storageRoot) {
    return { kind: "ok", root: storageRoot, segments: [subfolder] };
  }
  const base = String(artifactDirectory || "").trim();
  if (!base) return { kind: "needs_directory" };
  const themeKey = String(themeId || "").trim();
  if (themeKey) {
    const folder = safeThemeFolderSegment(themeCode || themeKey);
    return { kind: "ok", root: base, segments: ["Themes", folder, subfolder] };
  }
  if (subfolder === "Artifacts") {
    return { kind: "ok", root: base, segments: ["Inbox"] };
  }
  return { kind: "ok", root: base, segments: ["Inbox", subfolder] };
}

/** managed Artifact 専用（互換ラッパ）。 */
export function resolveManagedArtifactDirectoryParts(options = {}) {
  return resolveThemeContentDirectoryParts({ ...options, contentKind: "artifacts" });
}
