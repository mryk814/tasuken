import { aiEntityBodyText, projectEntityForAi, type AiProjectionContext } from "./aiMetadata.mjs";
import { markdownSignature } from "./canonicalMarkdown.mjs";
import { safeReceiptText } from "./taskContext.mjs";

export interface PublicSourceProjection {
  source: { type: "note" | "capture_entry"; id: string; revision: number | null };
  themeId: string | null;
  title: string;
  relativePath: string;
  content: string;
  contentHash: string;
  generatedAt: string;
  redacted: boolean;
}

export type PublishedBodySource = Pick<
  PublicSourceProjection,
  "source" | "themeId" | "title" | "relativePath" | "contentHash"
>;

export function publicSourceThemeIndexPath(themeId: string) {
  return `Sources/Themes/${markdownSignature(themeId).split(":").at(-1)}.md`;
}

export function buildPublicSourceIndexes(
  sources: PublishedBodySource[],
  retainedThemePaths: string[] = [],
): Record<string, string> {
  const unique = [...new Map(sources.map((source) => [source.relativePath, source])).values()].sort(
    (a, b) => a.relativePath.localeCompare(b.relativePath),
  );
  const paths = [
    ...new Set([
      ...retainedThemePaths,
      ...unique.flatMap((source) =>
        source.themeId ? [publicSourceThemeIndexPath(source.themeId)] : [],
      ),
    ]),
  ].sort();
  const files: Record<string, string> = {};
  const common =
    "明示的に本文公開を許可し、現在M365への公開を許可している記録の現在版です。過去版の再現ではありません。読み取り専用です。";
  const links = (entries: PublishedBodySource[], prefix: string) =>
    entries
      .map(
        (source) =>
          `- [${inline(sanitize(source.title))}](${prefix}${source.relativePath.slice("Sources/".length)})`,
      )
      .join("\n") || "公開中の本文はありません。";
  files["Sources/README.md"] = `# 公開した本文\n\n${common}\n\n${links(unique, "")}\n`;
  for (const indexPath of paths) {
    if (!/^Sources\/Themes\/[a-f0-9]{64}\.md$/.test(indexPath))
      throw new Error("本文索引の保存先が不正です。");
    files[indexPath] = `# Themeの公開本文\n\n${common}\n\n${links(
      unique.filter(
        (source) => source.themeId && publicSourceThemeIndexPath(source.themeId) === indexPath,
      ),
      "../",
    )}\n`;
  }
  return files;
}

const text = (value: unknown) => (typeof value === "string" ? value : "");
const sanitize = (value: string) =>
  safeReceiptText(value).replace(/\b(?:javascript|vbscript|data):[^\s<>"'`]*/gi, "[redacted-url]");
const inline = (value: string) =>
  value.replace(/[\r\n]+/g, " ").replace(/[\\`*_{}[\]()<>#!|&]/g, "\\$&");

/** Explicit full-body consent supplements, and never overrides, the M365 visibility policy. */
export function buildPublicSourceProjection({
  type,
  entity,
  theme,
  workspaceDefault,
  generatedAt,
  explicitlyAllowed,
}: {
  type: string;
  entity: Record<string, unknown>;
  theme?: Record<string, unknown> | null;
  workspaceDefault?: AiProjectionContext["workspaceDefault"];
  generatedAt: string;
  explicitlyAllowed: boolean;
}): PublicSourceProjection | null {
  if (
    explicitlyAllowed !== true ||
    (type !== "note" && type !== "capture_entry") ||
    !entity ||
    entity.deleted_at ||
    !text(entity.id).trim()
  )
    return null;
  const projection = projectEntityForAi(type, entity, {
    audience: "m365",
    theme,
    workspaceDefault,
  });
  if (
    !projection.included ||
    !projection.header ||
    projection.header.freshness === "superseded" ||
    projection.header.superseded_by
  )
    return null;
  if (
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(generatedAt) ||
    !Number.isFinite(Date.parse(generatedAt))
  )
    throw new Error("公開物の生成日時が不正です。");

  const source: PublicSourceProjection["source"] = {
    type,
    id: text(entity.id),
    revision: Number.isSafeInteger(entity.version) ? (entity.version as number) : null,
  };
  const rawTitle = projection.header.title || (type === "note" ? "Note" : "Capture");
  const rawBody = aiEntityBodyText(type, entity);
  const title = sanitize(rawTitle);
  const body = sanitize(rawBody);
  const safeId = sanitize(source.id);
  const redacted = title !== rawTitle || body !== rawBody || safeId !== source.id;
  const identityHash = markdownSignature(JSON.stringify([type, source.id]))
    .split(":")
    .at(-1);
  const relativePath = `Sources/${type}-${identityHash}.md`;
  // A source can contain arbitrary Markdown, including fences; render it as inert text.
  let fenceLength = 3;
  for (const [run] of body.matchAll(/`+/g)) fenceLength = Math.max(fenceLength, run.length + 1);
  const fence = "`".repeat(fenceLength);
  const locator =
    safeId === source.id
      ? `[Taskenで開く](tasken://${type}/${encodeURIComponent(source.id).replace(/[!'()*]/g, (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`)})`
      : "Taskenへのリンクは識別子の秘匿化のため省略しました。";
  const content = [
    `# ${inline(title)}`,
    "",
    "読み取り専用（read-only）の公開用コピーです。現在版の本文であり、過去の版を再現するものではありません。",
    "",
    `- 出典の型: ${type}`,
    `- 出典のID: ${inline(safeId)}`,
    `- 現在revision: ${source.revision ?? "不明"}`,
    `- 生成時刻: ${generatedAt}`,
    `- 省略・置換: ${redacted ? "あり（秘密情報・安全でない参照等を秘匿化）" : "なし"}。長さによる省略はありません。`,
    `- ${locator}`,
    "",
    "添付ファイルや外部URLの内容は取得していません。以下は元本文を文字列として表示します。",
    "",
    "## 本文",
    "",
    `${fence}text`,
    body,
    fence,
    "",
  ].join("\n");
  return {
    source,
    themeId: projection.header.theme_id,
    title,
    relativePath,
    content,
    contentHash: markdownSignature(content),
    generatedAt,
    redacted,
  };
}
