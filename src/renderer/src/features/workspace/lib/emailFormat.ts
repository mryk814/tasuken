import type { Note } from "../types";

const REPORT_TYPE_LABELS: Record<string, string> = {
  weekly: "週報",
  monthly: "月報",
  milestone: "節目報告",
  ad_hoc: "その他",
};

function str(value: unknown): string {
  return typeof value === "string" ? value : "";
}

export function markdownToPlainText(md: string): string {
  return md
    // headings: remove # markers, keep text
    .replace(/^#{1,6}\s+/gm, "")
    // bold/italic: remove markers
    .replace(/\*{1,3}([^*]+)\*{1,3}/g, "$1")
    .replace(/_{1,3}([^_]+)_{1,3}/g, "$1")
    // strikethrough
    .replace(/~~([^~]+)~~/g, "$1")
    // inline code
    .replace(/`([^`]+)`/g, "$1")
    // links: [text](url) -> text
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    // images: ![alt](url) -> alt
    .replace(/!\[([^\]]*)\]\([^)]+\)/g, "$1")
    // unordered list items: - or * to ・
    .replace(/^[\t ]*[-*]\s+/gm, "・ ")
    // ordered list items: keep number with ) instead of .
    .replace(/^[\t ]*(\d+)\.\s+/gm, "$1) ")
    // blockquotes
    .replace(/^>\s?/gm, "")
    // horizontal rules
    .replace(/^[-*_]{3,}\s*$/gm, "")
    // trim trailing whitespace per line
    .replace(/[ \t]+$/gm, "");
}

export function formatReportSubject(note: Note, themeName: string): string {
  const properties = note.properties_json && typeof note.properties_json === "object"
    ? note.properties_json as Record<string, unknown>
    : {};
  const reportType = REPORT_TYPE_LABELS[str(properties.report_type)] || "報告";
  const periodStart = str(properties.period_start);
  const periodEnd = str(properties.period_end);
  const period = periodStart && periodEnd
    ? `${periodStart}〜${periodEnd}`
    : periodStart || periodEnd || "";
  const themeLabel = themeName || "未設定";
  return period
    ? `[${themeLabel}] ${reportType} - ${period}`
    : `[${themeLabel}] ${reportType}`;
}

export function formatReportEmailBody(note: Note): string {
  return markdownToPlainText(note.body_markdown || "");
}
