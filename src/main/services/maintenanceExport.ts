import fs from "node:fs";
import path from "node:path";

/**
 * 手入れ（maintenance）を 1 件ずつ Markdown に書き出す（#755 束9b）。
 *
 * 手入れの画面を外す前に、本人が後で別の所へ移せるよう、記録を読める形で残すための口。
 * 記録そのもの（maintenance・maintenance_entry）は消さず、登録に読むだけで残る。
 * 書き出しは本人の操作でだけ行い、既にあるファイルは上書きしない（同じ名前があれば番号を付ける）。
 */

type RecordLike = Record<string, unknown>;

export interface MaintenanceExportSource {
  list(type: "maintenance" | "maintenance_entry" | "theme" | "project"): RecordLike[];
}

export interface MaintenanceExportDocument {
  id: string;
  /** 拡張子の無いファイル名。Windows で使えない文字は置き換え済み。 */
  baseName: string;
  markdown: string;
}

function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function dateText(value: unknown): string {
  const raw = text(value);
  return /^\d{4}-\d{2}-\d{2}/u.test(raw) ? raw.slice(0, 10) : "";
}

function isLive(record: RecordLike): boolean {
  return !record.deleted_at;
}

/** 表示用の見出し。「エアコン / フィルターを掃除する」。 */
export function maintenanceTitle(item: RecordLike): string {
  const target = text(item.target);
  const action = text(item.action);
  if (target && action) return `${target} / ${action}`;
  return target || action || text(item.title) || "手入れ";
}

/** Markdown の表のセルを 1 行に収める。 */
function cell(value: string): string {
  return value.replace(/\r?\n/gu, " ").replace(/\|/gu, "\\|") || "—";
}

export function maintenanceMarkdown(
  item: RecordLike,
  entries: readonly RecordLike[],
  themeName: string | null,
): string {
  const interval = Number(item.interval_days);
  const facts: [string, string][] = [
    ["対象", text(item.target)],
    ["すること", text(item.action)],
    ["間隔", Number.isInteger(interval) && interval > 0 ? `${interval}日ごと` : ""],
    ["次の目安", dateText(item.next_due_on)],
    ["最後に行った日", dateText(item.last_performed_on)],
    ["始めた日", dateText(item.started_on)],
    ["Theme", themeName || ""],
    ["作った日", dateText(item.created_at)],
    ["Tasken の ID", text(item.id)],
  ];
  const lines = [
    `# ${maintenanceTitle(item)}`,
    "",
    "Tasken の手入れから書き出した記録です（#755 で手入れの画面を外す前の控え）。",
    "",
    ...facts.filter(([, value]) => value).map(([label, value]) => `- ${label}: ${value}`),
  ];
  const note = typeof item.note === "string" ? item.note.trim() : "";
  if (note) lines.push("", "## メモ", "", note);
  const history = [...entries].sort(
    (left, right) =>
      dateText(right.performed_on).localeCompare(dateText(left.performed_on)) ||
      text(right.recorded_at).localeCompare(text(left.recorded_at)),
  );
  lines.push("", "## 行った記録", "");
  if (history.length === 0) {
    lines.push("記録はありません。");
  } else {
    lines.push("| 行った日 | 次の目安 | メモ |", "| --- | --- | --- |");
    for (const entry of history) {
      lines.push(
        `| ${cell(dateText(entry.performed_on))} | ${cell(dateText(entry.next_due_on))} | ${cell(
          typeof entry.note === "string" ? entry.note.trim() : "",
        )} |`,
      );
    }
  }
  return `${lines.join("\n")}\n`;
}

/** Windows のファイル名に使えない文字を除き、長さを抑える。 */
export function maintenanceFileBaseName(item: RecordLike): string {
  const cleaned = `手入れ - ${maintenanceTitle(item)}`
    .replace(/[\\/:*?"<>|]+/gu, "-")
    // 制御文字は名前に残さない。
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u001f]+/gu, " ")
    .replace(/\s+/gu, " ")
    .trim()
    .replace(/[. ]+$/u, "")
    .slice(0, 80);
  return cleaned || "手入れ";
}

/** 削除していない手入れを、見出しの順に 1 件ずつ Markdown にする。 */
export function buildMaintenanceExport(
  source: MaintenanceExportSource,
): MaintenanceExportDocument[] {
  const themes = new Map<string, string>();
  for (const theme of [...source.list("theme"), ...source.list("project")]) {
    const id = text(theme.id);
    const name = text(theme.name) || text(theme.title);
    if (id && name && !themes.has(id)) themes.set(id, name);
  }
  const entries = source.list("maintenance_entry").filter(isLive);
  return source
    .list("maintenance")
    .filter(isLive)
    .map((item) => {
      const id = text(item.id);
      return {
        id,
        baseName: maintenanceFileBaseName(item),
        markdown: maintenanceMarkdown(
          item,
          entries.filter((entry) => text(entry.maintenance_id) === id),
          themes.get(text(item.project_id)) ?? null,
        ),
      };
    })
    .sort(
      (left, right) =>
        left.baseName.localeCompare(right.baseName, "ja") || left.id.localeCompare(right.id),
    );
}

type ExportFiles = Pick<typeof fs, "writeFileSync">;

/**
 * 選んだフォルダーへ 1 件ずつ書く。既にある名前は上書きせず「(2)」「(3)」…を付ける。
 * 書けたファイルの場所を返す。途中で失敗した時は、それまでに書いた物を残したまま例外にする。
 */
export function writeMaintenanceMarkdownFiles(
  directory: string,
  documents: readonly MaintenanceExportDocument[],
  files: ExportFiles = fs,
): string[] {
  const written: string[] = [];
  for (const document of documents) {
    for (let attempt = 1; ; attempt += 1) {
      if (attempt > 1000) throw new Error("同じ名前のファイルが多すぎて書き出せません。");
      const suffix = attempt === 1 ? "" : ` (${attempt})`;
      const filePath = path.join(directory, `${document.baseName}${suffix}.md`);
      try {
        files.writeFileSync(filePath, document.markdown, { encoding: "utf8", flag: "wx" });
        written.push(filePath);
        break;
      } catch (error) {
        if ((error as { code?: unknown } | null)?.code === "EEXIST") continue;
        throw error;
      }
    }
  }
  return written;
}
