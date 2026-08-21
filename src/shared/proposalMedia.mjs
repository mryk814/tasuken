const MAX_SVG_CHARS = 500_000;
const MAX_ARTIFACT_CHARS = 1_000_000;
const SAFE_SVG_TAGS = new Set([
  "svg", "g", "path", "rect", "circle", "ellipse", "line", "polyline", "polygon", "text", "tspan",
]);

export function validateSafeSvg(value) {
  if (typeof value !== "string" || !value.trim() || value.length > MAX_SVG_CHARS) {
    throw new Error("SVGは1〜50万文字にしてください。");
  }
  const svg = value.trim();
  if (!/^<svg[\s>]/i.test(svg) || !/<\/svg>\s*$/i.test(svg)) throw new Error("完全なSVG文書を指定してください。");
  if (/<!DOCTYPE|<!ENTITY|<!--|<\?|<script|<style|<foreignObject|<iframe|<object|<embed|<image/i.test(svg)) {
    throw new Error("SVGに実行可能または外部参照要素は使用できません。");
  }
  if (/\bon[a-z]+\s*=|\b(?:href|xlink:href)\s*=|url\s*\(|javascript\s*:/i.test(svg)) {
    throw new Error("SVGにイベント、リンク、外部参照は使用できません。");
  }
  const tags = [...svg.matchAll(/<\/?\s*([a-zA-Z][\w-]*)\b/g)].map((match) => match[1].toLowerCase());
  if (!tags.length || tags.some((tag) => !SAFE_SVG_TAGS.has(tag))) throw new Error("SVGに未対応の要素が含まれています。");
  return svg;
}

export function validateArtifactProposal(entry) {
  if (!entry || typeof entry !== "object" || Array.isArray(entry)) throw new Error("ArtifactはJSON objectにしてください。");
  const title = typeof entry.title === "string" ? entry.title.trim() : "";
  const fileName = typeof entry.file_name === "string" ? entry.file_name.trim() : "";
  const mediaType = typeof entry.media_type === "string" ? entry.media_type.trim().toLowerCase() : "";
  const content = typeof entry.content === "string" ? entry.content : "";
  if (!title || title.length > 200) throw new Error("Artifact titleは1〜200文字にしてください。");
  if (!/^[^<>:\"/\\|?*\x00-\x1f]{1,180}\.(?:svg|md|txt|json|html|htm)$/i.test(fileName)) {
    throw new Error("file_nameはパスを含まないsvg、md、txt、json、html名にしてください。");
  }
  const windowsStem = fileName.slice(0, fileName.lastIndexOf(".")).toUpperCase();
  if (/^(?:CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])(?:\.|$)/.test(windowsStem)) {
    throw new Error("file_nameにWindowsの予約名は使用できません。");
  }
  if (!["image/svg+xml", "text/markdown", "text/plain", "application/json", "text/html"].includes(mediaType)) {
    throw new Error("未対応のArtifact media_typeです。");
  }
  const expectedExtension = {
    "image/svg+xml": [".svg"],
    "text/markdown": [".md"],
    "text/plain": [".txt"],
    "application/json": [".json"],
    "text/html": [".html", ".htm"],
  }[mediaType];
  if (!expectedExtension.some((extension) => fileName.toLowerCase().endsWith(extension))) {
    throw new Error("file_nameの拡張子とmedia_typeが一致しません。");
  }
  if (!content || content.length > MAX_ARTIFACT_CHARS) throw new Error("Artifact contentは1〜100万文字にしてください。");
  if (mediaType === "image/svg+xml") validateSafeSvg(content);
  if (mediaType === "application/json") {
    try {
      JSON.parse(content);
    } catch {
      throw new Error("Artifact JSONが不正です。JSON構文を確認してください。");
    }
  }
  return { title, fileName, mediaType, content };
}
