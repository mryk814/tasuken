import fs from "node:fs";
import path from "node:path";

import {
  retiredExportMarkMatches,
  writeKnowledgeExportFiles,
  type ExportFiles,
} from "./knowledgeRetirementExport";
import { waitingTaskId } from "./waitingRetirement";

/**
 * 待ちを、1 つの Markdown に書き出す（#755 束7）。
 *
 * 待ちの画面と入力を外し、待ちは Task に写す（waitingRetirement.ts）。元の待ちは種類の登録に
 * 読むだけで残るが、本人はどこからも読めない。決まり 4 に合わせ、写した Task とは別に、
 * 元の待ちの欄（待っている相手・次にすること・確認の時刻・日程）を本人の操作なしで残す。
 * 形と印は束 6 の保存した絞り込みの書き出し（savedViewRetirementExport.ts）と同じ。
 *
 * - 置き場は userData と、同期ルート（設定してある時だけ）の Exports/retired/waitings/。
 * - すべての待ちを 1 ファイルにまとめる。0 件なら何も書かず、印も付けない。削除した待ちは書かない。
 * - 印には件数と、いちばん新しい更新の時刻を持たせ、どちらかが変われば書き出し直す。
 * - 既にあるファイルは上書きしない。中身が同じなら書かず、違えば番号を付ける。
 * - 失敗しても起動は止めない。印を付けないので、次の起動でやり直す。ログは数と code だけ。
 */

type RecordLike = Record<string, unknown>;

export interface WaitingExportSource {
  /** WorkspaceDatabase.list と同じ形。includeDeleted を省くと、削除した記録を除く。 */
  list(type: string, includeDeleted?: boolean): RecordLike[];
}

export interface WaitingRetirementExportRepository extends WaitingExportSource {
  readRetiredExportMark(name: "waitings"): string | null;
  markRetiredExportDone(name: "waitings", value: string): void;
}

export interface WaitingExportDocument {
  baseName: string;
  waitingCount: number;
  markdown: string;
}

export type WaitingRetirementExportResult =
  | { state: "already_done" | "nothing" | "error" }
  | { state: "done" | "retry"; documents: number; directories: string[] };

const RETIRED_EXPORT_SEGMENTS = ["Exports", "retired", "waitings"] as const;
const EXPORT_BASE_NAME = "待ち";

// 画面の語（domain-model/labels.ts）の写し。Main から renderer は読めない。
const STATE_LABELS: Record<string, string> = {
  waiting: "待ち",
  received: "受領",
  cancelled: "中止",
};
const STATE_ORDER = ["waiting", "received", "cancelled"];

function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
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

function nameLookup(source: WaitingExportSource, types: string[]): Map<string, RecordLike> {
  const byId = new Map<string, RecordLike>();
  for (const type of types) {
    let entries: RecordLike[] = [];
    try {
      entries = source.list(type, true);
    } catch {
      // 登録の無い古い種類は、名前なしで書く。
    }
    for (const entry of entries) {
      const id = text(entry.id);
      if (id && !byId.has(id)) byId.set(id, entry);
    }
  }
  return byId;
}

/** 名前と ID。削除した物は名前を書かない（本人が消した物を新しく書き写さない）。 */
function labelFor(
  byId: Map<string, RecordLike>,
  value: unknown,
  kind: string,
  nameField: (entry: RecordLike) => string,
): string {
  const id = text(value);
  if (!id) return "";
  const entry = byId.get(id);
  if (!entry) return `見つからない ${kind}（${id}）`;
  if (!isLive(entry)) return `削除した ${kind}（${id}）`;
  const name = oneLine(nameField(entry));
  return name ? `${name}（${id}）` : `名前の無い ${kind}（${id}）`;
}

function scheduleText(schedule: RecordLike): string {
  const start = text(schedule.start_date);
  const end = text(schedule.end_date);
  if (start && end && start !== end) return `${start} 〜 ${end}`;
  return end || start;
}

function byStateThenCreated(left: RecordLike, right: RecordLike): number {
  return (
    STATE_ORDER.indexOf(text(left.state)) - STATE_ORDER.indexOf(text(right.state)) ||
    text(left.created_at).localeCompare(text(right.created_at)) ||
    text(left.id).localeCompare(text(right.id))
  );
}

/** 削除していない待ちを、1 つの Markdown にする。無ければ空の配列。 */
export function buildWaitingExport(source: WaitingExportSource): WaitingExportDocument[] {
  const waitings = source.list("waiting", false).filter(isLive).sort(byStateThenCreated);
  if (waitings.length === 0) return [];
  const themes = nameLookup(source, ["theme", "project"]);
  const tasks = nameLookup(source, ["task"]);
  const schedules = new Map<string, string[]>();
  for (const schedule of source.list("schedule", false)) {
    if (text(schedule.owner_type) !== "waiting" || !isLive(schedule)) continue;
    const when = scheduleText(schedule);
    if (!when) continue;
    const owner = text(schedule.owner_id);
    schedules.set(owner, [...(schedules.get(owner) || []), when]);
  }
  // 実際に写してある物（消した写しを含む）だけを「写した」と書く。同期が追いつかない・控えが
  // 取れない起動では写さないので、写す前に書き出すこともある（写した後の起動で書き出し直す）。
  const convertedTaskId = (waitingId: string) =>
    waitingId && tasks.has(waitingTaskId(waitingId)) ? waitingTaskId(waitingId) : "";
  const converted = waitings.filter((waiting) => convertedTaskId(text(waiting.id))).length;
  const conversionNote =
    converted === waitings.length
      ? "待ちはそれぞれ、状態が「待ち」などの Task に写してあります（「写した Task の ID」）。"
      : converted === 0
        ? "この時点では、まだ Task に写していません（同期が追いつき、写す前の控えが取れた起動で写ります）。"
        : `${converted} 件は Task に写してあります（「写した Task の ID」のある物）。残りは、同期が追いつき、写す前の控えが取れた起動で写ります。`;
  const lines = [
    `# ${EXPORT_BASE_NAME}`,
    "",
    `Tasken の待ちの控えです（#755 で待ちを Task に含めた版が書き出しました）。${conversionNote}`,
    "",
    `- 件数: ${waitings.length} 件`,
  ];
  for (const waiting of waitings) {
    const id = text(waiting.id);
    const state = text(waiting.state);
    const taskId = convertedTaskId(id);
    const taskLabel = taskId
      ? `${taskId}${isLive(tasks.get(taskId) || {}) ? "" : "（写した後に消した）"}`
      : "";
    const facts: [string, string][] = [
      ["状態", STATE_LABELS[state] || state],
      ["待っている相手", oneLine(text(waiting.waiting_for))],
      ["次にすること", oneLine(text(waiting.next_action))],
      ["確認の時刻", text(waiting.check_reminder_at)],
      ["日程", (schedules.get(id) || []).join("、")],
      [
        "Theme",
        labelFor(
          themes,
          waiting.project_id,
          "Theme",
          (entry) => text(entry.name) || text(entry.title),
        ),
      ],
      ["関係する Task", labelFor(tasks, waiting.task_id, "Task", (entry) => text(entry.title))],
      ["作った日", dateText(waiting.created_at)],
      ["更新した日", dateText(waiting.updated_at)],
      ["元の記録（source_record）の ID", text(waiting.source_record_id)],
      ["Tasken の ID", id],
      ["写した Task の ID", taskLabel],
    ];
    lines.push(
      "",
      `## ${oneLine(text(waiting.title)) || "無題の待ち"}`,
      "",
      ...facts.filter(([, value]) => value).map(([label, value]) => `- ${label}: ${value}`),
    );
    const description = typeof waiting.description === "string" ? waiting.description.trim() : "";
    if (description) lines.push("", description);
  }
  return [
    {
      baseName: EXPORT_BASE_NAME,
      waitingCount: waitings.length,
      markdown: `${lines.join("\n")}\n`,
    },
  ];
}

/**
 * 書き出しの元の状態。削除していない待ちの件数、削除した物も含めたいちばん新しい
 * 更新・作成・削除の時刻、Task に写してある待ちの数。どれかが変われば書き出し直す
 * （古い版の端末から後で届いた待ちも、後の起動で写した事も残る）。
 */
export function waitingExportSignature(source: WaitingExportSource): {
  count: number;
  latest: string;
  converted: number;
} {
  let count = 0;
  let converted = 0;
  let latest = "";
  const tasks = nameLookup(source, ["task"]);
  for (const entry of source.list("waiting", true)) {
    if (isLive(entry)) {
      count += 1;
      if (tasks.has(waitingTaskId(text(entry.id)))) converted += 1;
    }
    for (const field of ["updated_at", "created_at", "deleted_at"]) {
      const value = text(entry[field]);
      if (value > latest) latest = value;
    }
  }
  return { count, latest, converted };
}

function exportMarkMatches(
  raw: string | null,
  signature: ReturnType<typeof waitingExportSignature>,
): boolean {
  if (!retiredExportMarkMatches(raw, signature) || !raw) return false;
  try {
    return (JSON.parse(raw) as { converted?: unknown }).converted === signature.converted;
  } catch {
    return false;
  }
}

/** 置き場（userData と、設定してある時の同期ルート）の Exports/retired/waitings。 */
export function waitingRetirementExportDirectories(
  userDataDirectory: string,
  syncRoot: string | null | undefined,
): string[] {
  const roots = [userDataDirectory, text(syncRoot)].filter((root) => root && path.isAbsolute(root));
  return [...new Set(roots.map((root) => path.join(root, ...RETIRED_EXPORT_SEGMENTS)))];
}

/**
 * 起動時に書き出す。すべての置き場に書けた時だけ済んだ印を付ける。印の時から変わって
 * いなければ何もしない。失敗は起動を止めない。ログには数と code だけを出す。
 */
export function runWaitingRetirementExportOnce(input: {
  repository: WaitingRetirementExportRepository;
  userDataDirectory: string;
  syncRoot?: string | null;
  log?: (level: "info" | "warn", message: string) => void;
  now?: () => string;
  files?: ExportFiles;
}): WaitingRetirementExportResult {
  const { repository, log = () => {}, now = () => new Date().toISOString(), files = fs } = input;
  try {
    const signature = waitingExportSignature(repository);
    if (exportMarkMatches(repository.readRetiredExportMark("waitings"), signature))
      return { state: "already_done" };
    const documents = buildWaitingExport(repository);
    if (documents.length === 0) return { state: "nothing" };
    const directories = waitingRetirementExportDirectories(input.userDataDirectory, input.syncRoot);
    let failed = 0;
    const done: string[] = [];
    for (const directory of directories) {
      try {
        const { written, unchanged } = writeKnowledgeExportFiles(directory, documents, files);
        done.push(directory);
        log(
          "info",
          `待ちを書き出した: waitings=${signature.count} written=${written} unchanged=${unchanged}`,
        );
      } catch (error) {
        failed += 1;
        const code = (error as { code?: unknown } | null)?.code;
        log("warn", `待ちを書き出せなかった置き場がある${code ? `: ${String(code)}` : ""}`);
      }
    }
    if (failed > 0) {
      log("warn", "待ちの書き出しを次の起動でやり直す");
      return { state: "retry", documents: documents.length, directories: done };
    }
    repository.markRetiredExportDone("waitings", JSON.stringify({ at: now(), ...signature }));
    return { state: "done", documents: documents.length, directories: done };
  } catch (error) {
    const code = (error as { code?: unknown } | null)?.code;
    log("warn", `待ちを書き出せなかった${code ? `: ${String(code)}` : ""}`);
    return { state: "error" };
  }
}
