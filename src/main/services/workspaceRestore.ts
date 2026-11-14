import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

import type { WorkspaceRestoreOutcome } from "../../shared/ipc/contracts";

/**
 * 控え（正本DBの写し）から戻す。
 *
 * 動いているアプリは正本を開いたままなので、その場では差し替えない。2段に分ける。
 * 1. stageRestore（動作中）: 今のDBを控える → 控えの添付を足す → 控えを正本の隣へ写して確かめる →
 *    予定（plan）を書く。ここまで正本には触れない。
 * 2. applyPendingRestore（次の起動の最初、DBを開く前）: 正本を脇へ退ける → 写しを正本の名前にする →
 *    件数を確かめる → 退けた正本を消す。どこで失敗・中断しても、退けた正本を元の名前へ戻す。
 *
 * 添付（ノートの画像と撮影した写真）は、名前がUUIDか内容のhashで決まり、書き換わらない。
 * だから控えの側は「足すだけの写し」にでき、世代ごとに丸ごと持たなくてよい。戻す時も、
 * 手元に無いファイルを足すだけで、手元のファイルは消さない。
 */

export const WORKSPACE_DATABASE_FILE = "research-desk.sqlite";
/** 控える添付。Link Previewのサムネイルは作り直せる派生物なので含めない。 */
export const BACKUP_ATTACHMENT_DIRECTORIES = ["markdown-images", "capture-images"] as const;
export const BACKUP_ATTACHMENT_ROOT = "attachments";

const PLAN_FILE = "restore-plan.json";
const OUTCOME_FILE = "restore-outcome.json";
const STAGED_SUFFIX = ".restore-staged";
const REPLACED_SUFFIX = ".restore-replaced";
const SQLITE_SIDE_FILES = ["", "-wal", "-shm"] as const;
/** 戻す前の控え。自動バックアップの世代（tasken-auto-*）とは別の名前にして、入れ替えで消さない。 */
const PRE_RESTORE_PREFIX = "tasken-before-restore-";
const BACKUP_FILE_PATTERN =
  /^tasken-(auto|before-restore)-(\d{8})T(\d{2})(\d{2})(\d{2})(\d{3})Z-[0-9a-f]{8}\.sqlite$/;

export interface RestoreSourceInfo {
  entityCount: number;
  workspaceId: string;
}

export interface RestoreDatabasePort {
  entityCount(): number;
  userEntityCount(): number;
  backupTo(filePath: string, shouldAbort: () => boolean): Promise<void>;
}

export interface RestorePlan {
  format: "tasken-restore-plan";
  formatVersion: 1;
  requestedAt: string;
  sourcePath: string;
  entityCount: number;
  /** 戻す前のDBの控え。空の作業台から戻した時は ""。 */
  previousBackupPath: string;
  syncWasEnabled: boolean;
  attachmentsRestored: number;
  /** 控えの隣に添付の写しがあったか。無い控え（古い自動バックアップ）は記録だけ戻る。 */
  attachmentsInBackup: boolean;
}

export type RestoreOutcome = WorkspaceRestoreOutcome;

export interface StageRestoreOptions {
  userDataPath: string;
  sourcePath: string;
  backupDirectory: string;
  database: RestoreDatabasePort;
  inspect(filePath: string): RestoreSourceInfo;
  /** 写しを確かめて同期を止める（workspaceRepository の prepareRestoredCopy）。 */
  prepare(filePath: string): { entityCount: number; syncWasEnabled: boolean };
  now?: () => Date;
}

export interface ApplyRestoreOptions {
  userDataPath: string;
  inspect(filePath: string): RestoreSourceInfo;
  now?: () => Date;
  log?: (level: "info" | "warn" | "error", message: string, error?: unknown) => void;
  /** 試験用: 差し替えの各段の直前に呼ぶ。投げると、その段で失敗した扱いになる。 */
  beforeStep?: (step: "set-aside" | "place" | "verify") => void;
}

function timestamp(date: Date): string {
  return date.toISOString().replaceAll("-", "").replaceAll(":", "").replace(".", "");
}

function restoreError(message: string): Error {
  return new Error(message);
}

function databasePath(userDataPath: string): string {
  return path.join(userDataPath, WORKSPACE_DATABASE_FILE);
}

function writeJsonAtomic(filePath: string, value: unknown): void {
  const temporaryPath = `${filePath}.${process.pid}.tmp`;
  fs.writeFileSync(temporaryPath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  fs.renameSync(temporaryPath, filePath);
}

function readJson<T>(filePath: string): T | null {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8")) as T;
  } catch {
    return null;
  }
}

function isFile(filePath: string): boolean {
  return fs.statSync(filePath, { throwIfNoEntry: false })?.isFile() === true;
}

/** 控えのファイル名から作った時刻を読む。Taskenが作った名前でなければ ""。 */
export function backupCreatedAt(filePath: string): string {
  const match = BACKUP_FILE_PATTERN.exec(path.basename(filePath));
  if (!match) return "";
  const [, , day, hour, minute, second, millisecond] = match;
  return `${day.slice(0, 4)}-${day.slice(4, 6)}-${day.slice(6, 8)}T${hour}:${minute}:${second}.${millisecond}Z`;
}

export interface BackupListEntry {
  filePath: string;
  createdAt: string;
  sizeBytes: number;
  kind: "auto" | "before-restore";
}

/** 保存先にある控えを新しい順に並べる（自動の世代と、戻す前の控え）。 */
export function listBackups(directory: string): BackupListEntry[] {
  if (!fs.statSync(directory, { throwIfNoEntry: false })?.isDirectory()) return [];
  return fs
    .readdirSync(directory, { withFileTypes: true })
    .flatMap((entry) => {
      const match = entry.isFile() ? BACKUP_FILE_PATTERN.exec(entry.name) : null;
      if (!match) return [];
      const filePath = path.join(directory, entry.name);
      return [
        {
          filePath,
          createdAt: backupCreatedAt(filePath),
          sizeBytes: fs.statSync(filePath).size,
          kind: match[1] === "auto" ? ("auto" as const) : ("before-restore" as const),
        },
      ];
    })
    .sort((left, right) => right.createdAt.localeCompare(left.createdAt));
}

/**
 * 添付を sourceRoot から targetRoot へ足す。同じ名前で同じ大きさのファイルは写さない。
 * 写し先のファイルは消さない（控えの側では古い世代のDBが参照し、戻す側では今の記録が参照する）。
 * 一時名へ書いてから名前を替えるので、途中で止まっても半端なファイルを正しい名前で残さない。
 */
export async function mirrorAttachments(
  sourceRoot: string,
  targetRoot: string,
  shouldAbort: () => boolean = () => false,
): Promise<{ copied: number; total: number }> {
  let copied = 0;
  let total = 0;
  for (const directory of BACKUP_ATTACHMENT_DIRECTORIES) {
    const source = path.join(sourceRoot, directory);
    if (!fs.statSync(source, { throwIfNoEntry: false })?.isDirectory()) continue;
    const target = path.join(targetRoot, directory);
    await fs.promises.mkdir(target, { recursive: true });
    for (const entry of await fs.promises.readdir(source, { withFileTypes: true })) {
      if (!entry.isFile() || entry.name.endsWith(".tmp")) continue;
      // 終了の時は途中でやめる。写せた分は残り、次の作成で続きを足す。
      if (shouldAbort()) return { copied, total };
      total += 1;
      const from = path.join(source, entry.name);
      const to = path.join(target, entry.name);
      const existing = await fs.promises.stat(to).catch(() => null);
      if (existing?.isFile() && existing.size === (await fs.promises.stat(from)).size) continue;
      const temporaryPath = `${to}.${process.pid}.tmp`;
      try {
        await fs.promises.copyFile(from, temporaryPath);
        await fs.promises.rename(temporaryPath, to);
      } catch (error) {
        await fs.promises.rm(temporaryPath, { force: true }).catch(() => {});
        throw error;
      }
      copied += 1;
    }
  }
  return { copied, total };
}

/** 控えの隣にある添付の写しの場所。 */
export function backupAttachmentRoot(backupFileOrDirectory: string, isDirectory = false): string {
  return path.join(
    isDirectory ? backupFileOrDirectory : path.dirname(backupFileOrDirectory),
    BACKUP_ATTACHMENT_ROOT,
  );
}

function removeStaged(userDataPath: string): void {
  const staged = `${databasePath(userDataPath)}${STAGED_SUFFIX}`;
  for (const suffix of ["", ".tmp", "-journal", ".tmp-journal"]) {
    fs.rmSync(`${staged}${suffix}`, { force: true });
  }
}

/**
 * 戻す準備をする。正本には触れない。成功したら、次の起動で差し替わる。
 * 失敗したら作りかけを片付けて投げる（今のDBと、作れた「戻す前の控え」は残る）。
 */
export async function stageRestore(options: StageRestoreOptions): Promise<RestorePlan> {
  const now = options.now || (() => new Date());
  const userDataPath = path.resolve(options.userDataPath);
  const sourcePath = path.resolve(options.sourcePath);
  const live = databasePath(userDataPath);
  if (sourcePath.toLowerCase() === live.toLowerCase()) {
    throw restoreError("今使っているデータベースは、控えとして選べません。");
  }
  if (!isFile(sourcePath)) throw restoreError("控えのファイルが見つかりません。");
  // 動いているDBの本体だけを写すと、-wal に残る分が欠ける。Taskenが作る控えは単体のファイル。
  if ((fs.statSync(`${sourcePath}-wal`, { throwIfNoEntry: false })?.size ?? 0) > 0) {
    throw restoreError(
      "選んだファイルは使用中のデータベースです。Taskenが作った控え（tasken-auto-…sqlite）を選んでください。",
    );
  }
  let source: RestoreSourceInfo;
  try {
    source = options.inspect(sourcePath);
  } catch {
    throw restoreError(
      "選んだファイルをTaskenの控えとして読めませんでした。別の控えを選んでください。",
    );
  }

  const requestedAt = now();
  const backupDirectory = path.resolve(options.backupDirectory);
  let previousBackupPath = "";
  // 空の作業台（新しい端末）には、控える物がない。
  if (options.database.userEntityCount() > 0) {
    fs.mkdirSync(backupDirectory, { recursive: true });
    const fileName = `${PRE_RESTORE_PREFIX}${timestamp(requestedAt)}-${crypto.randomUUID().slice(0, 8)}.sqlite`;
    const finalPath = path.join(backupDirectory, fileName);
    const temporaryPath = path.join(backupDirectory, `.${fileName}.tmp`);
    try {
      await options.database.backupTo(temporaryPath, () => false);
      const liveCount = options.database.entityCount();
      if (options.inspect(temporaryPath).entityCount !== liveCount) {
        throw new Error("戻す前の控えの件数が、今のデータと一致しませんでした。");
      }
      fs.renameSync(temporaryPath, finalPath);
    } catch (error) {
      for (const suffix of ["", "-journal", "-wal", "-shm"]) {
        fs.rmSync(`${temporaryPath}${suffix}`, { force: true });
      }
      throw restoreError(
        `今のデータを控えられなかったため、戻すのをやめました。保存先（${backupDirectory}）を確かめてください。${
          error instanceof Error ? ` ${error.message}` : ""
        }`,
      );
    }
    previousBackupPath = finalPath;
    await mirrorAttachments(
      path.join(userDataPath, BACKUP_ATTACHMENT_ROOT),
      backupAttachmentRoot(backupDirectory, true),
    );
  }

  const sourceAttachments = backupAttachmentRoot(sourcePath);
  const attachmentsInBackup =
    fs.statSync(sourceAttachments, { throwIfNoEntry: false })?.isDirectory() === true;
  // 足すだけなので、この後の差し替えが失敗しても害がない。
  const attachmentsRestored = attachmentsInBackup
    ? (await mirrorAttachments(sourceAttachments, path.join(userDataPath, BACKUP_ATTACHMENT_ROOT)))
        .copied
    : 0;

  const staged = `${live}${STAGED_SUFFIX}`;
  const stagedTemporary = `${staged}.tmp`;
  removeStaged(userDataPath);
  fs.rmSync(path.join(userDataPath, PLAN_FILE), { force: true });
  try {
    await fs.promises.copyFile(sourcePath, stagedTemporary);
    const prepared = options.prepare(stagedTemporary);
    if (prepared.entityCount !== source.entityCount) {
      throw restoreError("控えを写した後の件数が、控えと一致しませんでした。");
    }
    fs.renameSync(stagedTemporary, staged);
    const plan: RestorePlan = {
      format: "tasken-restore-plan",
      formatVersion: 1,
      requestedAt: requestedAt.toISOString(),
      sourcePath,
      entityCount: source.entityCount,
      previousBackupPath,
      syncWasEnabled: prepared.syncWasEnabled,
      attachmentsRestored,
      attachmentsInBackup,
    };
    writeJsonAtomic(path.join(userDataPath, PLAN_FILE), plan);
    return plan;
  } catch (error) {
    removeStaged(userDataPath);
    throw error;
  }
}

/** 戻す予定を取りやめる（再起動できなかった時）。正本には触れていない。 */
export function cancelStagedRestore(userDataPathValue: string): void {
  const userDataPath = path.resolve(userDataPathValue);
  fs.rmSync(path.join(userDataPath, PLAN_FILE), { force: true });
  removeStaged(userDataPath);
}

/**
 * 退けた正本を元の名前へ戻す。本体を最後に戻すので、「本体の退避が残っている」なら
 * 戻し終えていないと分かる（途中で止まっても、次の起動で続きから戻せる）。
 */
function moveBack(live: string): void {
  for (const suffix of ["-wal", "-shm", ""]) {
    const replaced = `${live}${suffix}${REPLACED_SUFFIX}`;
    if (!fs.existsSync(replaced)) continue;
    fs.rmSync(`${live}${suffix}`, { force: true });
    fs.renameSync(replaced, `${live}${suffix}`);
  }
}

function hasReplaced(live: string): boolean {
  return SQLITE_SIDE_FILES.some((suffix) => fs.existsSync(`${live}${suffix}${REPLACED_SUFFIX}`));
}

/**
 * 起動の最初、DBを開く前に呼ぶ。戻す予定があれば差し替える。予定が無ければ null。
 * 失敗した時は、退けた正本を元の名前へ戻し、結果に理由を残す（投げない。起動は続ける）。
 */
export function applyPendingRestore(options: ApplyRestoreOptions): RestoreOutcome | null {
  const now = options.now || (() => new Date());
  const log = options.log || (() => {});
  const userDataPath = path.resolve(options.userDataPath);
  const live = databasePath(userDataPath);
  const staged = `${live}${STAGED_SUFFIX}`;
  const planPath = path.join(userDataPath, PLAN_FILE);
  const plan = readJson<RestorePlan>(planPath);
  const validPlan =
    plan?.format === "tasken-restore-plan" &&
    plan.formatVersion === 1 &&
    Number.isInteger(plan.entityCount);

  // 前回の差し替えが途中で止まっていた時。写しがまだ置かれていなければ、正本を元へ戻してやり直す。
  // 置いた後に止まったのなら、下の確認から続ける。
  const resumedAfterPlace = hasReplaced(live) && !fs.existsSync(staged) && fs.existsSync(live);
  if (hasReplaced(live) && !resumedAfterPlace) moveBack(live);

  if (!validPlan || !plan) {
    if (fs.existsSync(planPath) || fs.existsSync(staged)) cancelStagedRestore(userDataPath);
    // 予定が無いのに退けた本体が残るのは、失敗の後に元へ戻し切れなかった時だけ
    // （成功した時は、退けた正本を消してから予定を消す）。続きを戻す。
    if (fs.existsSync(`${live}${REPLACED_SUFFIX}`)) moveBack(live);
    return null;
  }

  const outcome = (status: RestoreOutcome["status"], error = ""): RestoreOutcome => {
    const value: RestoreOutcome = {
      status,
      at: now().toISOString(),
      sourcePath: plan.sourcePath,
      entityCount: plan.entityCount,
      previousBackupPath: plan.previousBackupPath,
      syncStopped: status === "restored" && plan.syncWasEnabled,
      attachmentsRestored: plan.attachmentsRestored,
      attachmentsInBackup: plan.attachmentsInBackup,
      error,
    };
    try {
      writeJsonAtomic(path.join(userDataPath, OUTCOME_FILE), value);
    } catch (writeError) {
      log("warn", "復元の結果を書けなかった", writeError);
    }
    return value;
  };

  try {
    if (!resumedAfterPlace) {
      if (options.inspect(staged).entityCount !== plan.entityCount) {
        throw new Error("写した控えの件数が、準備した時と違います。");
      }
      options.beforeStep?.("set-aside");
      // -wal に未反映の変更があるので、3つとも一緒に退ける。
      for (const suffix of SQLITE_SIDE_FILES) {
        if (fs.existsSync(`${live}${suffix}`)) {
          fs.renameSync(`${live}${suffix}`, `${live}${suffix}${REPLACED_SUFFIX}`);
        }
      }
      options.beforeStep?.("place");
      fs.renameSync(staged, live);
    }
    options.beforeStep?.("verify");
    if (options.inspect(live).entityCount !== plan.entityCount) {
      throw new Error("戻した後の件数が、控えと一致しませんでした。");
    }
  } catch (error) {
    log("error", "控えから戻せなかった。戻す前のデータベースへ戻す", error);
    try {
      if (hasReplaced(live)) moveBack(live);
    } catch (rollbackError) {
      // ここへ来るのは、退けた正本を元の名前へ戻せない時だけ。退けたファイルは消さずに残る。
      log("error", "退けたデータベースを元の名前へ戻せなかった", rollbackError);
    }
    cancelStagedRestore(userDataPath);
    return outcome(
      "failed",
      "控えから戻せませんでした。データは戻す前のままです。別の控えで、もう一度試してください。",
    );
  }

  // 件数まで確かめられた。退けた正本は「戻す前の控え」と同じ中身なので消す。
  // 予定は最後に消す。退けた正本を消せずに終わっても、次の起動は予定を見て
  // 「置いた後」と分かり、確認からやり直す（古い正本を上へ戻さない）。
  try {
    for (const suffix of SQLITE_SIDE_FILES) {
      fs.rmSync(`${live}${suffix}${REPLACED_SUFFIX}`, { force: true });
    }
    fs.rmSync(planPath, { force: true });
  } catch (error) {
    log("warn", "退けたデータベースを消せなかった（次の起動でもう一度消す）", error);
  }
  log("info", `控えから戻した (entities=${plan.entityCount})`);
  return outcome("restored");
}

/** 前回の復元の結果。本人が見るまで残す。 */
export function readRestoreOutcome(userDataPath: string): RestoreOutcome | null {
  const value = readJson<RestoreOutcome>(path.join(path.resolve(userDataPath), OUTCOME_FILE));
  return value && (value.status === "restored" || value.status === "failed") ? value : null;
}

export function clearRestoreOutcome(userDataPath: string): void {
  fs.rmSync(path.join(path.resolve(userDataPath), OUTCOME_FILE), { force: true });
}
