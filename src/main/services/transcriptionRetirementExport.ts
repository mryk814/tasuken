import fs from "node:fs";
import path from "node:path";

import {
  retiredExportMarkMatches,
  writeKnowledgeExportFiles,
  type ExportFiles,
} from "./knowledgeRetirementExport";

/**
 * 完了済みの文字起こしを、1 件ずつ Markdown に書き出す（#755 束4）。
 *
 * 文字起こしの本文（transcription_revisions の raw_text）は、記録には残るが、束4 で履歴の
 * 表示を外したので Desktop のどこにも出なくなった。決まり 4 に合わせ、読める形の控えを
 * 本人の操作なしで残す。形と印は束8 の Knowledge の書き出し（knowledgeRetirementExport.ts）と同じ。
 *
 * - 置き場は userData と、同期ルート（設定してある時だけ）の Exports/retired/transcriptions/。
 * - 完了済みの文字起こし 1 件につき 1 ファイル。同じ文字起こしは付箋（capture_entry）と添付
 *   （artifact）の両方に写しがあるので、ID で 1 件にまとめる。0 件なら何も書かず、印も付けない。
 * - 削除した付箋・添付の文字起こしは書き出さない（本人が消した物の中身を、控えに新しく書き写さない）。
 * - 印には件数と、いちばん新しい更新の時刻を持たせ、どちらかが変われば書き出し直す。
 * - 既にあるファイルは上書きしない。中身が同じなら書かず、違えば番号を付ける。中身に書き出した
 *   時刻は入れない。
 * - 失敗しても起動は止めない。印を付けないので、次の起動でやり直す。ログは数と code だけ。
 */

type RecordLike = Record<string, unknown>;

export interface TranscriptionExportSource {
  /** WorkspaceDatabase.list と同じ形。includeDeleted を省くと、削除した記録を除く。 */
  list(type: string, includeDeleted?: boolean): RecordLike[];
}

export interface TranscriptionRetirementExportRepository extends TranscriptionExportSource {
  readRetiredExportMark(name: "transcriptions"): string | null;
  markRetiredExportDone(name: "transcriptions", value: string): void;
}

export interface TranscriptionExportDocument {
  revisionId: string;
  baseName: string;
  markdown: string;
}

export type TranscriptionRetirementExportResult =
  | { state: "already_done" | "nothing" | "error" }
  | { state: "done" | "retry"; documents: number; directories: string[] };

const RETIRED_EXPORT_SEGMENTS = ["Exports", "retired", "transcriptions"] as const;
const OWNER_TYPES = ["capture_entry", "artifact"] as const;
const PROCESSING_MODE_LABELS: Record<string, string> = {
  cloud: "クラウド",
  local: "この端末",
};

function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function record(value: unknown): RecordLike | null {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as RecordLike) : null;
}

function oneLine(value: string): string {
  return value.replace(/\s+/gu, " ").trim();
}

function isLive(entry: RecordLike): boolean {
  return !entry.deleted_at;
}

/** 本文のある、完了した文字起こし。 */
function completedRevisions(entry: RecordLike): RecordLike[] {
  return (Array.isArray(entry.transcription_revisions) ? entry.transcription_revisions : [])
    .map(record)
    .filter(
      (revision): revision is RecordLike =>
        Boolean(revision) &&
        text(revision?.status) === "completed" &&
        Boolean(text(revision?.id)) &&
        Boolean(text(revision?.raw_text)),
    );
}

/** Windows のファイル名に使えない文字を除き、長さを抑える。 */
function fileBaseName(label: string): string {
  const cleaned = `文字起こし - ${label}`
    .replace(/[\\/:*?"<>|]+/gu, "-")
    // 制御文字は名前に残さない。
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u001f]+/gu, " ")
    .replace(/\s+/gu, " ")
    .trim()
    .replace(/[. ]+$/u, "")
    .slice(0, 100);
  return cleaned || "文字起こし";
}

interface CollectedRevision {
  revision: RecordLike;
  capture: RecordLike | null;
  artifact: RecordLike | null;
}

/**
 * 削除していない付箋・添付から、完了した文字起こしを ID で 1 件にまとめて集める。
 * どちらかの持ち主が削除されていれば、その文字起こしは書き出さない。
 */
function collectRevisions(source: TranscriptionExportSource): CollectedRevision[] {
  const byId = new Map<string, CollectedRevision>();
  const deleted = new Set<string>();
  for (const type of OWNER_TYPES) {
    let entries: RecordLike[] = [];
    try {
      entries = source.list(type, true);
    } catch {
      continue;
    }
    for (const entry of entries) {
      for (const revision of completedRevisions(entry)) {
        const id = text(revision.id);
        if (!isLive(entry)) {
          deleted.add(id);
          continue;
        }
        const collected = byId.get(id) || { revision, capture: null, artifact: null };
        if (type === "capture_entry") collected.capture = entry;
        else collected.artifact = entry;
        byId.set(id, collected);
      }
    }
  }
  // 添付の側にしか無い文字起こしは、添付の持ち主（付箋）を引く。
  const captures = new Map<string, RecordLike>();
  try {
    for (const capture of source.list("capture_entry", true))
      captures.set(text(capture.id), capture);
  } catch {
    // 付箋が読めなければ、持ち主の名前なしで書く。
  }
  const result: CollectedRevision[] = [];
  for (const [id, collected] of byId) {
    if (deleted.has(id)) continue;
    if (!collected.capture && collected.artifact) {
      const owner =
        text(collected.artifact.source_type) === "capture_entry"
          ? captures.get(text(collected.artifact.source_id))
          : undefined;
      if (owner && !isLive(owner)) continue;
      collected.capture = owner || null;
    }
    result.push(collected);
  }
  return result.sort(
    (left, right) =>
      text(left.revision.completed_at).localeCompare(text(right.revision.completed_at)) ||
      text(left.revision.id).localeCompare(text(right.revision.id)),
  );
}

function transcriptionMarkdown(input: CollectedRevision & { title: string }): string {
  const { revision, capture, artifact, title } = input;
  const facts: [string, string][] = [
    ["音声", oneLine(text(artifact?.filename) || text(capture?.text))],
    ["付箋", capture ? `「${oneLine(text(capture.title)) || "無題"}」（${text(capture.id)}）` : ""],
    ["添付", artifact ? text(artifact.id) : text(revision.source_artifact_id)],
    ["言語", text(revision.language)],
    [
      "モデル",
      [text(revision.model_id), text(revision.model_profile_id), text(revision.provider_profile_id)]
        .filter(Boolean)
        .join(" / "),
    ],
    [
      "処理",
      PROCESSING_MODE_LABELS[text(revision.processing_mode)] || text(revision.processing_mode),
    ],
    ["始めた時刻", text(revision.started_at)],
    ["終えた時刻", text(revision.completed_at)],
    ["原音の hash", text(revision.source_content_hash)],
    ["Tasken の ID", text(revision.id)],
  ];
  const lines = [
    `# 文字起こし - ${title}`,
    "",
    "Tasken の音声の文字起こしの履歴から書き出した記録です（#755 で文字起こしの履歴の表示を外す前の控え）。",
    "",
    ...facts.filter(([, value]) => value).map(([label, value]) => `- ${label}: ${value}`),
    "",
    "## 本文",
    "",
    String(revision.raw_text).replace(/\r\n?/gu, "\n").trim(),
  ];
  return `${lines.join("\n")}\n`;
}

/** 削除していない付箋・添付の、完了済みの文字起こしを 1 件 1 ファイルの Markdown にする。 */
export function buildTranscriptionExport(
  source: TranscriptionExportSource,
): TranscriptionExportDocument[] {
  const used = new Map<string, number>();
  return collectRevisions(source).map((collected) => {
    const title =
      oneLine(text(collected.capture?.title)) ||
      oneLine(text(collected.artifact?.title)) ||
      oneLine(text(collected.artifact?.filename)) ||
      "無題の音声";
    const date = text(collected.revision.completed_at).slice(0, 10);
    const base = fileBaseName(date ? `${title} - ${date}` : title);
    // 同じ音声を何度か文字起こししていても、1 件ずつ別のファイルにする。
    const key = base.toLocaleLowerCase("ja");
    const count = (used.get(key) || 0) + 1;
    used.set(key, count);
    return {
      revisionId: text(collected.revision.id),
      baseName: count === 1 ? base : `${base} [${count}]`,
      markdown: transcriptionMarkdown({ ...collected, title }),
    };
  });
}

/**
 * 書き出しの元の状態。書き出す文字起こしの件数と、完了した文字起こしを持つ付箋・添付の
 * （削除した物も含めた）いちばん新しい更新・作成・削除の時刻。どちらかが変われば書き出し直す。
 */
export function transcriptionExportSignature(source: TranscriptionExportSource): {
  count: number;
  latest: string;
} {
  let latest = "";
  for (const type of OWNER_TYPES) {
    for (const entry of source.list(type, true)) {
      if (completedRevisions(entry).length === 0) continue;
      for (const field of ["updated_at", "created_at", "deleted_at"]) {
        const value = text(entry[field]);
        if (value > latest) latest = value;
      }
    }
  }
  return { count: collectRevisions(source).length, latest };
}

/** 置き場（userData と、設定してある時の同期ルート）の Exports/retired/transcriptions。 */
export function transcriptionRetirementExportDirectories(
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
export function runTranscriptionRetirementExportOnce(input: {
  repository: TranscriptionRetirementExportRepository;
  userDataDirectory: string;
  syncRoot?: string | null;
  log?: (level: "info" | "warn", message: string) => void;
  now?: () => string;
  files?: ExportFiles;
}): TranscriptionRetirementExportResult {
  const { repository, log = () => {}, now = () => new Date().toISOString(), files = fs } = input;
  try {
    const signature = transcriptionExportSignature(repository);
    if (retiredExportMarkMatches(repository.readRetiredExportMark("transcriptions"), signature))
      return { state: "already_done" };
    const documents = buildTranscriptionExport(repository);
    if (documents.length === 0) return { state: "nothing" };
    const directories = transcriptionRetirementExportDirectories(
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
          `文字起こしを書き出した: files=${documents.length} written=${written} unchanged=${unchanged}`,
        );
      } catch (error) {
        failed += 1;
        const code = (error as { code?: unknown } | null)?.code;
        log("warn", `文字起こしを書き出せなかった置き場がある${code ? `: ${String(code)}` : ""}`);
      }
    }
    if (failed > 0) {
      log("warn", "文字起こしの書き出しを次の起動でやり直す");
      return { state: "retry", documents: documents.length, directories: done };
    }
    repository.markRetiredExportDone("transcriptions", JSON.stringify({ at: now(), ...signature }));
    return { state: "done", documents: documents.length, directories: done };
  } catch (error) {
    const code = (error as { code?: unknown } | null)?.code;
    log("warn", `文字起こしを書き出せなかった${code ? `: ${String(code)}` : ""}`);
    return { state: "error" };
  }
}
