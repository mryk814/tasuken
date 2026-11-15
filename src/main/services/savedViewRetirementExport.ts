import fs from "node:fs";
import path from "node:path";

import {
  retiredExportMarkMatches,
  writeKnowledgeExportFiles,
  type ExportFiles,
} from "./knowledgeRetirementExport";

/**
 * やることの画面で保存した絞り込み（view_type が task の view）を、1 つの Markdown に書き出す（#755 束6）。
 *
 * 保存した絞り込みを開く・作る画面は先に外れていて、束6 で残りのコードも外したので、記録は
 * 種類の登録（view）に読むだけで残るが、本人はどこからも読めない。決まり 4 に合わせ、名前と条件の
 * 控えを本人の操作なしで残す。形と印は束8 の Knowledge の書き出し（knowledgeRetirementExport.ts）と同じ。
 *
 * - 置き場は userData と、同期ルート（設定してある時だけ）の Exports/retired/views/。
 * - すべての絞り込みを 1 ファイルにまとめる。0 件なら何も書かず、印も付けない。
 * - 同じ view の種類には、Theme の区分（task_section）とリマインダーの設定も入っているので、
 *   保存した絞り込みだけを選ぶ（view_type か scope が task の物）。
 * - 削除した絞り込みは書かない。条件が指す Theme が削除されていれば、名前を書かずに ID だけ書く。
 * - 印には件数と、いちばん新しい更新の時刻を持たせ、どちらかが変われば書き出し直す。
 * - 既にあるファイルは上書きしない。中身が同じなら書かず、違えば番号を付ける。中身に書き出した
 *   時刻は入れない。
 * - 失敗しても起動は止めない。印を付けないので、次の起動でやり直す。ログは数と code だけ。
 */

type RecordLike = Record<string, unknown>;

export interface SavedViewExportSource {
  /** WorkspaceDatabase.list と同じ形。includeDeleted を省くと、削除した記録を除く。 */
  list(type: string, includeDeleted?: boolean): RecordLike[];
}

export interface SavedViewRetirementExportRepository extends SavedViewExportSource {
  readRetiredExportMark(name: "views"): string | null;
  markRetiredExportDone(name: "views", value: string): void;
}

export interface SavedViewExportDocument {
  baseName: string;
  viewCount: number;
  markdown: string;
}

export type SavedViewRetirementExportResult =
  | { state: "already_done" | "nothing" | "error" }
  | { state: "done" | "retry"; documents: number; directories: string[] };

const RETIRED_EXPORT_SEGMENTS = ["Exports", "retired", "views"] as const;
const EXPORT_BASE_NAME = "保存した絞り込み";

// 画面の語（TodoPage と domain-model/labels.ts）の写し。Main から renderer は読めないので、
// 一度きりの書き出しに要る分だけを持つ。
const TAB_LABELS: Record<string, string> = {
  open: "未完了",
  today: "今日",
  overdue: "予定超過",
  "no-schedule": "予定なし",
  done: "完了",
};
const STATE_LABELS: Record<string, string> = {
  todo: "未着手",
  doing: "進行中",
  waiting: "待ち",
  review: "確認待ち",
  done: "完了",
  cancelled: "中止",
};
const PRIORITY_LABELS: Record<string, string> = {
  high: "優先",
  normal: "通常",
};
const SCHEDULE_LABELS: Record<string, string> = {
  scheduled: "予定あり",
  "no-schedule": "予定なし",
  overdue: "予定超過",
  "this-week": "今週中",
  today: "今日",
};
const RANGE_SEMANTICS_LABELS: Record<string, string> = {
  execution_window: "期間内に一度",
  ongoing_period: "期間中継続",
  unspecified_range: "期間未分類",
};
const NOT_SPECIFIED = "指定なし";

function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function record(value: unknown): RecordLike | null {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as RecordLike) : null;
}

function oneLine(value: string): string {
  return value.replace(/\s+/gu, " ").trim();
}

function dateText(value: unknown): string {
  const raw = text(value);
  return /^\d{4}-\d{2}-\d{2}/u.test(raw) ? raw.slice(0, 10) : "";
}

function isLive(entry: RecordLike): boolean {
  return !entry.deleted_at;
}

/** やることの画面の保存した絞り込みか（元の savedTaskViews.ts の isTaskSavedView と同じ決まり）。 */
export function isSavedTaskView(entry: RecordLike): boolean {
  return text(entry.view_type) === "task" || text(entry.scope) === "task";
}

/** 選べる値なら画面の語で、知らない値ならそのまま書く（控えなので、値を捨てない）。 */
function choiceLabel(labels: Record<string, string>, value: unknown, empty = NOT_SPECIFIED) {
  if (value === undefined || value === null || value === "") return empty;
  const raw = typeof value === "string" ? value : JSON.stringify(value);
  return labels[raw] || `${raw}（この版の画面に無い値）`;
}

function bySortOrder(left: RecordLike, right: RecordLike): number {
  const order = (entry: RecordLike) =>
    typeof entry.sort_order === "number" && Number.isFinite(entry.sort_order)
      ? entry.sort_order
      : Number.MAX_SAFE_INTEGER;
  return (
    order(left) - order(right) ||
    text(left.created_at).localeCompare(text(right.created_at)) ||
    text(left.id).localeCompare(text(right.id))
  );
}

function savedViews(source: SavedViewExportSource, includeDeleted: boolean): RecordLike[] {
  return source.list("view", includeDeleted).filter(isSavedTaskView);
}

/** Theme の ID から名前を引く。削除した Theme は名前を書かない（本人が消した物を新しく書き写さない）。 */
function themeLabeler(source: SavedViewExportSource): (value: unknown) => string {
  const themes = new Map<string, RecordLike>();
  for (const type of ["theme", "project"]) {
    let entries: RecordLike[] = [];
    try {
      entries = source.list(type, true);
    } catch {
      // 登録の無い古い種類は、名前なしで書く。
    }
    for (const entry of entries) {
      const id = text(entry.id);
      if (id && !themes.has(id)) themes.set(id, entry);
    }
  }
  return (value) => {
    if (value === undefined || value === null || value === "all") return "すべての Theme";
    if (value === "") return "Theme なし";
    if (typeof value !== "string") return `${JSON.stringify(value)}（この版の画面に無い値）`;
    const theme = themes.get(value);
    if (!theme) return `見つからない Theme（${value}）`;
    if (!isLive(theme)) return `削除した Theme（${value}）`;
    const name = oneLine(text(theme.name) || text(theme.title));
    return name ? `${name}（${value}）` : `名前の無い Theme（${value}）`;
  };
}

function viewMarkdown(view: RecordLike, themeLabel: (value: unknown) => string): string[] {
  const filters = record(view.filters) || {};
  const title = oneLine(text(view.title) || text(view.name)) || "名前の無い絞り込み";
  const facts: [string, string][] = [
    ["タブ", choiceLabel(TAB_LABELS, filters.tab, "未完了（既定）")],
    ["Theme", themeLabel(filters.themeId)],
    ["状態", choiceLabel(STATE_LABELS, filters.state)],
    ["優先度", choiceLabel(PRIORITY_LABELS, filters.priority)],
    ["予定", choiceLabel(SCHEDULE_LABELS, filters.schedule)],
    ["期間の意味", choiceLabel(RANGE_SEMANTICS_LABELS, filters.rangeSemantics)],
    ["作った日", dateText(view.created_at)],
    ["更新した日", dateText(view.updated_at)],
    ["Tasken の ID", text(view.id)],
  ];
  const lines = [
    "",
    `## ${title}`,
    "",
    ...facts.filter(([, value]) => value).map(([label, value]) => `- ${label}: ${value}`),
  ];
  // 画面の語に直す前の、保存されていた条件そのもの（知らない欄や値も落とさない）。
  if (Object.keys(filters).length > 0)
    lines.push(
      "",
      "保存されていた条件（元の形）:",
      "",
      "```json",
      JSON.stringify(filters, null, 2),
      "```",
    );
  return lines;
}

/** 削除していない保存した絞り込みを、1 つの Markdown にする。無ければ空の配列。 */
export function buildSavedViewExport(source: SavedViewExportSource): SavedViewExportDocument[] {
  const views = savedViews(source, false).filter(isLive).sort(bySortOrder);
  if (views.length === 0) return [];
  const themeLabel = themeLabeler(source);
  const lines = [
    `# ${EXPORT_BASE_NAME}`,
    "",
    "Tasken のやることの画面で保存した絞り込みの、名前と条件の控えです（#755 で絞り込みの保存を外した版が書き出しました）。",
    "",
    `- 件数: ${views.length} 件`,
    ...views.flatMap((view) => viewMarkdown(view, themeLabel)),
  ];
  return [
    {
      baseName: EXPORT_BASE_NAME,
      viewCount: views.length,
      markdown: `${lines.join("\n")}\n`,
    },
  ];
}

/**
 * 書き出しの元の状態。削除していない保存した絞り込みの件数と、削除した物も含めたいちばん新しい
 * 更新・作成・削除の時刻。どちらかが変われば書き出し直す。
 */
export function savedViewExportSignature(source: SavedViewExportSource): {
  count: number;
  latest: string;
} {
  let count = 0;
  let latest = "";
  for (const entry of savedViews(source, true)) {
    if (isLive(entry)) count += 1;
    for (const field of ["updated_at", "created_at", "deleted_at"]) {
      const value = text(entry[field]);
      if (value > latest) latest = value;
    }
  }
  return { count, latest };
}

/** 置き場（userData と、設定してある時の同期ルート）の Exports/retired/views。 */
export function savedViewRetirementExportDirectories(
  userDataDirectory: string,
  syncRoot: string | null | undefined,
): string[] {
  const roots = [userDataDirectory, text(syncRoot)].filter((root) => root && path.isAbsolute(root));
  return [...new Set(roots.map((root) => path.join(root, ...RETIRED_EXPORT_SEGMENTS)))];
}

/**
 * 起動時に書き出す。すべての置き場に書けた時だけ済んだ印を付ける。印の時から変わって
 * いなければ何もしない。失敗は起動を止めない。ログには数と code だけを出し、名前や条件は出さない。
 */
export function runSavedViewRetirementExportOnce(input: {
  repository: SavedViewRetirementExportRepository;
  userDataDirectory: string;
  syncRoot?: string | null;
  log?: (level: "info" | "warn", message: string) => void;
  now?: () => string;
  files?: ExportFiles;
}): SavedViewRetirementExportResult {
  const { repository, log = () => {}, now = () => new Date().toISOString(), files = fs } = input;
  try {
    const signature = savedViewExportSignature(repository);
    if (retiredExportMarkMatches(repository.readRetiredExportMark("views"), signature))
      return { state: "already_done" };
    const documents = buildSavedViewExport(repository);
    if (documents.length === 0) return { state: "nothing" };
    const directories = savedViewRetirementExportDirectories(
      input.userDataDirectory,
      input.syncRoot,
    );
    let failed = 0;
    const done: string[] = [];
    for (const directory of directories) {
      try {
        const { written, unchanged } = writeKnowledgeExportFiles(directory, documents, files);
        done.push(directory);
        log(
          "info",
          `保存した絞り込みを書き出した: views=${signature.count} written=${written} unchanged=${unchanged}`,
        );
      } catch (error) {
        failed += 1;
        const code = (error as { code?: unknown } | null)?.code;
        log(
          "warn",
          `保存した絞り込みを書き出せなかった置き場がある${code ? `: ${String(code)}` : ""}`,
        );
      }
    }
    if (failed > 0) {
      log("warn", "保存した絞り込みの書き出しを次の起動でやり直す");
      return { state: "retry", documents: documents.length, directories: done };
    }
    repository.markRetiredExportDone("views", JSON.stringify({ at: now(), ...signature }));
    return { state: "done", documents: documents.length, directories: done };
  } catch (error) {
    const code = (error as { code?: unknown } | null)?.code;
    log("warn", `保存した絞り込みを書き出せなかった${code ? `: ${String(code)}` : ""}`);
    return { state: "error" };
  }
}
