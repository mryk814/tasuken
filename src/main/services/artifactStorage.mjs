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
export function artifactMonthSegments(date = new Date()) {
  return [String(date.getFullYear()), String(date.getMonth() + 1).padStart(2, "0")];
}
