import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

import type { WorkspaceRestoreOutcome } from "../../shared/ipc/contracts";

/**
 * 控え（正本DBの写し）から戻す。
 *
 * 動いているアプリは正本を開いたままなので、その場では差し替えない。2段に分ける。
 * 1. stageRestore（動作中）: 今のDBを控える → 控えの添付を足す → 控えを正本の隣へ写して確かめる →
 *    予定（plan、phase=staged）を書く。ここまで正本には触れない。
 * 2. applyPendingRestore（次の起動の最初、DBを開く前）: 正本を脇へ退ける → 写しを正本の名前にする
 *    （placed）→ 件数を確かめる → committed を書く。committed より前に失敗・中断したら、
 *    退けた正本を元の名前へ戻す。committed の後は、どんな時も退けた正本を上へ戻さない
 *    （戻したDBを開いた後の記録を消してしまう）。
 *
 * 退けた正本（research-desk.before-restore-<時刻>.sqlite と -wal・-shm）は消さずに残す。
 * 準備から終了までの間にも、MCP・Androidの受け口・共有フォルダの受信・終了の時の書き出しが
 * 正本へ書くので、準備の最初に取る「戻す前の控え」と同じ中身とは限らない。消すのは本人に任せる。
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
/** 退けた正本の名前の頭。後ろに時刻と .sqlite が付く。 */
const SET_ASIDE_PREFIX = "research-desk.before-restore-";
/** -wal・-shm を先に、本体を最後に退ける。本体が退いていれば、付属のファイルも退き終えている。 */
const SET_ASIDE_ORDER = ["-wal", "-shm", ""] as const;
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

/**
 * 差し替えの段。予定のファイルに書き、次の起動はこれを見て続きを決める。
 * - staged: 写しを置いた（準備の終わり）。正本はまだ元の名前。
 * - placed: 正本を退け、写しを正本の名前にした。まだ誰も開いていない。
 * - committed: 件数まで確かめた。この後は退けた正本を上へ戻さない。
 * - rolling-back: 失敗したので退けた正本を元へ戻している。途中で止まっても続きから戻す。
 */
export type RestorePhase = "staged" | "placed" | "committed" | "rolling-back";
const RESTORE_PHASES: readonly RestorePhase[] = ["staged", "placed", "committed", "rolling-back"];

export interface RestorePlan {
  format: "tasken-restore-plan";
  formatVersion: 1;
  phase: RestorePhase;
  /** 退けた正本の名前（userData の中）。戻した後も消さない。 */
  setAsideName: string;
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

/**
 * 失敗を元へ戻すのにも失敗し、正本が元の名前に無い時。起動を続けると空のDBを作って
 * 本人に書かせてしまうので、知らせて終了する（予定は残し、次の起動で続きから元へ戻す）。
 */
export interface RestoreHalt {
  status: "halted";
  error: string;
}

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
  beforeStep?: (step: "set-aside" | "place" | "verify" | "commit") => void;
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

function fsyncFile(filePath: string): void {
  const descriptor = fs.openSync(filePath, "r+");
  try {
    fs.fsyncSync(descriptor);
  } finally {
    fs.closeSync(descriptor);
  }
}

/** 一時名へ書いて fsync してから名前を替える。電源が落ちても、古い中身か新しい中身のどちらかが残る。 */
function writeJsonAtomic(filePath: string, value: unknown): void {
  const temporaryPath = `${filePath}.${process.pid}.tmp`;
  fs.writeFileSync(temporaryPath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  fsyncFile(temporaryPath);
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
    // 予定を書いた後に電源が落ちても、中身の欠けた写しを正本にしないよう、先に書き切る。
    fsyncFile(stagedTemporary);
    fs.renameSync(stagedTemporary, staged);
    const plan: RestorePlan = {
      format: "tasken-restore-plan",
      formatVersion: 1,
      phase: "staged",
      setAsideName: `${SET_ASIDE_PREFIX}${timestamp(requestedAt)}.sqlite`,
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
 * 退けた正本を元の名前へ戻す。committed より前（戻したDBをまだ誰も開いていない時）だけ呼ぶ。
 * 本体を先に戻す。本体が退いている間は、正本の名前にある本体・-wal・-shm はどれも
 * 写した控えの側の物なので捨ててよい（退けた -wal・-shm は、まだ退けた側にある）。
 * 本体を戻した後に止まっても、次の起動は退けた -wal・-shm だけを戻す。
 */
function moveBack(live: string, setAside: string): void {
  if (fs.existsSync(setAside)) {
    for (const suffix of ["", "-wal", "-shm"]) fs.rmSync(`${live}${suffix}`, { force: true });
    fs.renameSync(setAside, live);
  }
  for (const suffix of ["-wal", "-shm"]) {
    if (!fs.existsSync(`${setAside}${suffix}`)) continue;
    fs.rmSync(`${live}${suffix}`, { force: true });
    fs.renameSync(`${setAside}${suffix}`, `${live}${suffix}`);
  }
}

function hasSetAside(setAside: string): boolean {
  return SET_ASIDE_ORDER.some((suffix) => fs.existsSync(`${setAside}${suffix}`));
}

function isRestorePlan(value: RestorePlan | null): value is RestorePlan {
  return (
    value?.format === "tasken-restore-plan" &&
    value.formatVersion === 1 &&
    RESTORE_PHASES.includes(value.phase) &&
    typeof value.setAsideName === "string" &&
    value.setAsideName.startsWith(SET_ASIDE_PREFIX) &&
    path.basename(value.setAsideName) === value.setAsideName &&
    Number.isInteger(value.entityCount)
  );
}

function haltMessage(setAside: string): string {
  return (
    "控えから戻す途中で失敗し、戻す前のデータベースを元の名前へ戻せませんでした。" +
    `戻す前のデータは ${setAside} に残っています。` +
    "このフォルダのファイルを使っているプログラム（同期やウイルス対策のソフトなど）が無いか確かめてから、" +
    "Taskenをもう一度起動してください。起動の時に、続きから元へ戻します。"
  );
}

/**
 * 起動の最初、DBを開く前に呼ぶ。戻す予定があれば差し替える。予定が無ければ null。
 * 失敗した時は、退けた正本を元の名前へ戻し、結果に理由を残す（投げない。起動は続ける）。
 * 元へ戻すのにも失敗した時だけ halted を返す。呼ぶ側は知らせて終了し、DBを開かない。
 */
export function applyPendingRestore(
  options: ApplyRestoreOptions,
): RestoreOutcome | RestoreHalt | null {
  const now = options.now || (() => new Date());
  const log = options.log || (() => {});
  const userDataPath = path.resolve(options.userDataPath);
  const live = databasePath(userDataPath);
  const staged = `${live}${STAGED_SUFFIX}`;
  const planPath = path.join(userDataPath, PLAN_FILE);
  const read = readJson<RestorePlan>(planPath);

  if (!isRestorePlan(read)) {
    if (fs.existsSync(planPath) && !fs.existsSync(live)) {
      // 読めない予定が残り、正本も無い。差し替えの途中かもしれないので、空のDBを作らせない。
      log("error", "戻す予定が読めず、データベースも見つからない");
      return {
        status: "halted",
        error:
          "控えから戻す予定のファイルが読めず、データベースも見つかりませんでした。" +
          `${userDataPath} の中の research-desk.before-restore-… のファイルに、戻す前のデータが残っている場合があります。`,
      };
    }
    // 予定が無い時は、退けた正本の名前も分からない。正本にも退けたファイルにも触れない。
    if (fs.existsSync(planPath) || fs.existsSync(staged)) cancelStagedRestore(userDataPath);
    return null;
  }
  const plan = read;
  const setAside = path.join(userDataPath, plan.setAsideName);

  const outcome = (status: RestoreOutcome["status"], error = ""): RestoreOutcome => {
    const value: RestoreOutcome = {
      status,
      at: now().toISOString(),
      sourcePath: plan.sourcePath,
      entityCount: plan.entityCount,
      previousBackupPath: plan.previousBackupPath,
      setAsidePath: status === "restored" && fs.existsSync(setAside) ? setAside : "",
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
  const failedMessage =
    "控えから戻せませんでした。データは戻す前のままです。別の控えで、もう一度試してください。";
  const writePhase = (phase: RestorePhase) => writeJsonAtomic(planPath, { ...plan, phase });

  /** 退けた正本を元へ戻し、予定を片付ける。戻せなければ halted。 */
  const rollBack = (): RestoreOutcome | RestoreHalt => {
    try {
      writePhase("rolling-back");
    } catch (error) {
      log("warn", "戻す予定の段を書けなかった", error);
    }
    try {
      moveBack(live, setAside);
    } catch (error) {
      // 予定は rolling-back のまま残し、次の起動で続きから戻す。
      log("error", "退けたデータベースを元の名前へ戻せなかった", error);
      return { status: "halted", error: haltMessage(setAside) };
    }
    try {
      cancelStagedRestore(userDataPath);
    } catch (error) {
      // 予定が残っても、次の起動は rolling-back を見て戻し直す（もう戻っているので何もしない）。
      log("warn", "戻す予定を片付けられなかった（次の起動でもう一度片付ける）", error);
    }
    return outcome("failed", failedMessage);
  };

  if (plan.phase === "committed") {
    // 戻し終えて、予定を消し損ねただけ。退けた正本は上へ戻さない。
    try {
      fs.rmSync(planPath, { force: true });
    } catch (error) {
      log("warn", "戻した後の予定を消せなかった（次の起動でもう一度消す）", error);
    }
    return null;
  }
  if (plan.phase === "rolling-back") {
    log("warn", "前回の起動で元へ戻す途中だった。続きから戻す");
    return rollBack();
  }

  // ここから先は、まだ誰も戻したDBを開いていない（committed より前）。
  let placed = false;
  if (plan.phase === "placed") {
    // 退けた本体が無いのは、元へ戻し終えた後に予定を消し損ねた時など。もう一度戻すだけにする。
    if (!fs.existsSync(setAside) || !fs.existsSync(live)) return rollBack();
    placed = true;
  } else {
    const stagedExists = fs.existsSync(staged);
    const setAsideMain = fs.existsSync(setAside);
    const liveMain = fs.existsSync(live);
    if (!stagedExists && setAsideMain && liveMain) {
      // 写しを正本の名前にした後、placed を書く前に止まった。確かめから続ける。
      placed = true;
    } else if (stagedExists && setAsideMain && liveMain) {
      // 本体は最後に退けるので、正本が元の名前にあるのに退けた本体がある時は、ほかの物が名前を使っている。
      // どちらにも触れずにやめる。
      log("error", `退ける先の名前が既に使われている: ${setAside}`);
      cancelStagedRestore(userDataPath);
      return outcome("failed", failedMessage);
    } else if (hasSetAside(setAside)) {
      // 退ける途中で止まった（写しはまだ置いていない）。元へ戻してから、やり直す。
      try {
        moveBack(live, setAside);
      } catch (error) {
        log("error", "前回の途中で退けたデータベースを元の名前へ戻せなかった", error);
        return rollBack();
      }
    }
  }

  // 失敗した時に、退けた正本を元へ戻す必要があるか。
  let touched = placed;
  try {
    if (!placed) {
      if (!fs.existsSync(staged)) throw new Error("写した控えが見つかりません。");
      if (options.inspect(staged).entityCount !== plan.entityCount) {
        throw new Error("写した控えの件数が、準備した時と違います。");
      }
      options.beforeStep?.("set-aside");
      touched = true;
      // -wal に未反映の変更があるので、3つとも同じ名前にそろえて退ける。
      for (const suffix of SET_ASIDE_ORDER) {
        if (fs.existsSync(`${live}${suffix}`)) {
          fs.renameSync(`${live}${suffix}`, `${setAside}${suffix}`);
        }
      }
      options.beforeStep?.("place");
      fs.renameSync(staged, live);
      writePhase("placed");
    }
    options.beforeStep?.("verify");
    if (options.inspect(live).entityCount !== plan.entityCount) {
      throw new Error("戻した後の件数が、控えと一致しませんでした。");
    }
    options.beforeStep?.("commit");
    // DBを開く前に書く。これより後は、退けた正本を上へ戻さない。
    writePhase("committed");
  } catch (error) {
    log("error", "控えから戻せなかった。戻す前のデータベースへ戻す", error);
    if (touched) return rollBack();
    cancelStagedRestore(userDataPath);
    return outcome("failed", failedMessage);
  }

  // 退けた正本は消さない（準備の後の書き込みを持っている）。予定だけを消す。
  // 消せなくても、次の起動は committed を見て予定を消し直すだけにする。
  try {
    fs.rmSync(planPath, { force: true });
  } catch (error) {
    log("warn", "戻した後の予定を消せなかった（次の起動でもう一度消す）", error);
  }
  log("info", `控えから戻した (entities=${plan.entityCount}, setAside=${setAside})`);
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
