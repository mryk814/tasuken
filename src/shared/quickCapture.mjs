const HTTP_URL_PATTERN = /https?:\/\/[^\s<>"']+/i;
const IMAGE_EXTENSIONS = new Set(["png", "jpg", "jpeg", "gif", "webp", "bmp", "svg", "heic", "heif"]);

function trimUrlPunctuation(value) {
  return value.replace(/[),.;!?。、）】]+$/u, "");
}

export function firstCaptureUrl(text) {
  const matched = String(text || "").match(HTTP_URL_PATTERN);
  return matched ? trimUrlPunctuation(matched[0]) : "";
}

export function quickCaptureContentType(text) {
  const value = String(text || "").trim();
  if (!value) return "text";
  const url = firstCaptureUrl(value);
  if (url && value === url) return "url";
  if (/^(#{1,6}\s|[-*+]\s|>\s|```)/m.test(value)) return "markdown";
  return "text";
}

export function quickCaptureTitle(text) {
  const value = String(text || "").trim();
  if (!value) return "";
  if (quickCaptureContentType(value) === "url") {
    try {
      return new URL(value).hostname.replace(/^www\./i, "") || value;
    } catch {
      return value;
    }
  }
  const firstLine = value
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find(Boolean)
    ?.replace(/^(#{1,6}\s+|[-*+]\s+|>\s+)/, "") || value;
  return firstLine.length > 80 ? `${firstLine.slice(0, 79)}…` : firstLine;
}

export function fileCaptureContentType(files) {
  const names = (files || []).map((file) => String(file?.name || file?.path || ""));
  if (!names.length) return "file";
  const everyImage = names.every((name) => {
    const extension = name.split(".").pop()?.toLowerCase() || "";
    return IMAGE_EXTENSIONS.has(extension);
  });
  return everyImage ? "image" : "file";
}

export function captureMatchesQuery(entry, query) {
  const needle = String(query || "").trim().toLocaleLowerCase("ja-JP");
  if (!needle) return true;
  return [
    entry?.title,
    entry?.text,
    entry?.url,
    entry?.content_type,
    entry?.kind,
  ].some((value) => String(value || "").toLocaleLowerCase("ja-JP").includes(needle));
}
