/**
 * PDF / previewDocument 用に、KaTeX CSS + woff2 フォントを data: URL 埋め込みで生成する。
 * data:text/html では相対パスの fonts/ が読めないため、印刷時にシステムフォントへ落ちて見た目が崩れる。
 *
 * 使い方: node scripts/generate-katex-document-css.mjs
 * katex を上げたら再実行する。
 */
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const cssPath = require.resolve("katex/dist/katex.min.css");
const fontsDir = path.join(path.dirname(cssPath), "fonts");
const outPath = path.join(root, "src/renderer/src/features/workspace/lib/katexDocumentCss.ts");

const originalCss = fs.readFileSync(cssPath, "utf8");
const dataUriCache = new Map();

function fontDataUri(fileName) {
  if (dataUriCache.has(fileName)) return dataUriCache.get(fileName);
  const filePath = path.join(fontsDir, fileName);
  if (!fs.existsSync(filePath)) {
    throw new Error(`KaTeX font missing: ${fileName}`);
  }
  const mime = fileName.endsWith(".woff2")
    ? "font/woff2"
    : fileName.endsWith(".woff")
      ? "font/woff"
      : fileName.endsWith(".ttf")
        ? "font/ttf"
        : "application/octet-stream";
  const uri = `data:${mime};base64,${fs.readFileSync(filePath).toString("base64")}`;
  dataUriCache.set(fileName, uri);
  return uri;
}

// url(fonts/Foo.woff2) format("woff2"),url(fonts/Foo.woff) format("woff"),url(fonts/Foo.ttf) ...
// → woff2 のみ data: 埋め込み（容量と印刷品質のバランス）。他形式は落とす。
let css = originalCss.replace(
  /url\(fonts\/([^)]+)\)\s*format\("([^"]+)"\)/g,
  (match, fileName, format) => {
    if (format !== "woff2" || !fileName.endsWith(".woff2")) return "";
    return `url(${fontDataUri(fileName)}) format("woff2")`;
  },
);

// 空になった src: や連続カンマを掃除
css = css
  .replace(/src:\s*,+/g, "src:")
  .replace(/,\s*,+/g, ",")
  .replace(/src:\s*,/g, "src:")
  .replace(/,\s*;/g, ";")
  .replace(/src:\s*;/g, "src:local('KaTeX');")
  .replace(/\s+/g, " ")
  .trim();

const header = [
  "/**",
  " * Auto-generated from katex/dist/katex.min.css + fonts/*.woff2 (base64).",
  " * Do not edit by hand. Re-run: node scripts/generate-katex-document-css.mjs",
  " * Used by previewDocument / PDF so math fonts work inside data: URL documents.",
  " */",
  "",
].join("\n");

const body = `export const KATEX_DOCUMENT_CSS = ${JSON.stringify(css)};\n`;
fs.writeFileSync(outPath, header + body, "utf8");

const bytes = Buffer.byteLength(css, "utf8");
console.log(`Wrote ${path.relative(root, outPath)} (${(bytes / 1024).toFixed(1)} KiB CSS, ${dataUriCache.size} fonts)`);
