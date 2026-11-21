/**
 * Tasken ルートの目印（{root}/.tasken-root.json）と、Settings に出す状態（#809）。
 *
 * 目印は「このフォルダがどの Workspace のルートか」を後から確かめるためのもので、
 * 書けなくても何も止めない（ログに残し、Settings に出すだけ）。食い違いも止めずに注意だけにする。
 * 端末ごとの設定と同じで、同期される記録には入れない。
 */

import fs from "node:fs";
import path from "node:path";

import {
  TASKEN_ROOT_MARKER,
  buildTaskenRootMarker,
  compareTaskenRootMarker,
  detectTaskenRootKind,
  effectiveTaskenRootKind,
  isTaskenRootMarker,
  listTaskenRootExceptions,
  normalizeTaskenRootKindPreference,
  syncFolderDefaultPath,
  taskenRootCandidate,
} from "../../shared/taskenRoot.mjs";

function text(value) {
  return typeof value === "string" ? value.trim() : "";
}

function errorMessage(error) {
  return error instanceof Error ? error.message : String(error);
}

export function taskenRootMarkerPath(root) {
  return path.join(root, TASKEN_ROOT_MARKER);
}

/**
 * @returns {{ state: "missing" } | { state: "invalid", error?: string } | { state: "present", marker: { schema: string, workspaceId: string, createdAt: string } }}
 */
export function readTaskenRootMarker(root) {
  const filePath = taskenRootMarkerPath(root);
  let raw;
  try {
    raw = fs.readFileSync(filePath, "utf8");
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") {
      return { state: "missing" };
    }
    return { state: "invalid", error: errorMessage(error) };
  }
  try {
    const parsed = JSON.parse(raw);
    return isTaskenRootMarker(parsed) ? { state: "present", marker: parsed } : { state: "invalid" };
  } catch (error) {
    return { state: "invalid", error: errorMessage(error) };
  }
}

/**
 * 一時ファイルに書いてから置く。途中で落ちても壊れた目印を残さない。
 * replace=false のときは hard link で置き、確かめてから置くまでの間にクラウドの同期が
 * 別の端末の目印を降ろしていても上書きしない（EEXIST で失敗する）。
 */
function writeMarkerAtomic(root, marker, { replace }) {
  const filePath = taskenRootMarkerPath(root);
  const temporaryPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  try {
    fs.writeFileSync(temporaryPath, `${JSON.stringify(marker, null, 2)}\n`, "utf8");
    if (replace) {
      fs.renameSync(temporaryPath, filePath);
    } else {
      fs.linkSync(temporaryPath, filePath);
      fs.rmSync(temporaryPath, { force: true });
    }
  } catch (error) {
    fs.rmSync(temporaryPath, { force: true });
    throw error;
  }
}

/**
 * 目印が無ければ書く。あれば（別の Workspace のものでも）書き換えない。投げない。
 * ルートのフォルダそのものは作らない（指定した場所が消えていたら、作らずに失敗として出す）。
 * @returns {{ status: "written" | "present" | "skipped" | "failed", error?: string }}
 */
export function ensureTaskenRootMarker({ root, workspaceId, now = () => new Date() }) {
  const directory = text(root);
  if (!directory || !text(workspaceId)) return { status: "skipped" };
  try {
    if (!fs.statSync(directory, { throwIfNoEntry: false })?.isDirectory()) {
      return { status: "failed", error: "ルートのフォルダが見つかりません。" };
    }
    const current = readTaskenRootMarker(directory);
    if (current.state !== "missing") return { status: "present" };
    writeMarkerAtomic(
      directory,
      buildTaskenRootMarker({ workspaceId, createdAt: now().toISOString() }),
      { replace: false },
    );
    return { status: "written" };
  } catch (error) {
    if (error && /** @type {NodeJS.ErrnoException} */ (error).code === "EEXIST") {
      return { status: "present" };
    }
    return { status: "failed", error: errorMessage(error) };
  }
}

/**
 * 同期に参加して Workspace を引き継いだとき、目印が前の Workspace を指していれば新しい方へ書き換える。
 * 前の Workspace 以外（別の端末が書いた目印など）は触らない。作った日時は残す。投げない。
 * @returns {{ status: "rewritten" | "unchanged" | "skipped" | "failed", error?: string }}
 */
export function rewriteTaskenRootMarkerWorkspace({ root, fromWorkspaceId, toWorkspaceId }) {
  const directory = text(root);
  if (!directory || !text(toWorkspaceId) || fromWorkspaceId === toWorkspaceId) {
    return { status: "skipped" };
  }
  try {
    const current = readTaskenRootMarker(directory);
    if (current.state !== "present" || current.marker.workspaceId !== fromWorkspaceId) {
      return { status: "unchanged" };
    }
    writeMarkerAtomic(
      directory,
      { ...current.marker, workspaceId: toWorkspaceId },
      { replace: true },
    );
    return { status: "rewritten" };
  } catch (error) {
    return { status: "failed", error: errorMessage(error) };
  }
}

/**
 * Settings に出す Tasken ルートの状態を組み立てる。
 * repository は端末ごとの設定と Theme を読む。書くのは、段 2 の知らせを済ませた印だけ。
 */
export class TaskenRootService {
  /**
   * @param {{
   *   repository: {
   *     workspaceId: string,
   *     getPreference(key: string): unknown,
   *     list(type: string, includeDeleted?: boolean): Array<Record<string, unknown>>,
   *     readOutsideRootNoticeDoneAt(): string | null,
   *     markOutsideRootNoticeDone(at?: string): void,
   *   },
   *   backupDirectory: () => string,
   *   env?: Record<string, string | undefined>,
   *   now?: () => Date,
   *   log?: (level: "info" | "warn" | "error", message: string) => void,
   * }} options
   */
  constructor({ repository, backupDirectory, env = process.env, now, log = () => {} }) {
    this.repository = repository;
    this.backupDirectory = backupDirectory;
    this.env = env;
    this.now = now || (() => new Date());
    this.log = log;
    this.lastWriteError = "";
  }

  root() {
    return text(this.repository.getPreference("artifactDirectory"));
  }

  /** 起動時とルートを決めたときに呼ぶ。失敗は覚えて Settings に出す。 */
  ensureMarker() {
    const root = this.root();
    const result = ensureTaskenRootMarker({
      root,
      workspaceId: this.repository.workspaceId,
      now: this.now,
    });
    if (result.status === "failed") {
      this.lastWriteError = result.error || "目印を書けませんでした。";
      this.log("warn", `Tasken ルートの目印を書けませんでした: ${this.lastWriteError}`);
    } else {
      this.lastWriteError = "";
      if (result.status === "written") this.log("info", "Tasken ルートの目印を書きました。");
    }
    return result;
  }

  /** adoptSyncWorkspace の後に呼ぶ。 */
  workspaceAdopted(fromWorkspaceId, toWorkspaceId) {
    const result = rewriteTaskenRootMarkerWorkspace({
      root: this.root(),
      fromWorkspaceId,
      toWorkspaceId,
    });
    if (result.status === "failed") {
      // 書き換えに失敗すると目印は前の ID のまま残り、Settings には「別の Workspace」と出る。
      // 本当の原因が分かるよう、書けなかった理由も Settings に出す。
      this.lastWriteError = `参加後の書き換えに失敗しました: ${result.error || "理由不明"}`;
      this.log("warn", `Tasken ルートの目印を書き換えられませんでした: ${result.error}`);
    } else if (result.status === "rewritten") {
      this.lastWriteError = "";
    }
    return result;
  }

  status() {
    const root = this.root();
    const kindPreference = normalizeTaskenRootKindPreference(
      this.repository.getPreference("taskenRootKind"),
    );
    const detectedKind = detectTaskenRootKind(root, this.env);
    const kind = effectiveTaskenRootKind(kindPreference, detectedKind);
    const syncDirectory = text(this.repository.getPreference("sharedSyncDirectory"));
    const syncEnabled = this.repository.getPreference("sharedSyncEnabled") === true;
    let backupDirectory = "";
    try {
      backupDirectory = text(this.backupDirectory());
    } catch {
      // 控えの場所が読めないときは一覧から外すだけにする。
    }
    let marker = { state: /** @type {string} */ ("none"), workspaceId: "", error: "" };
    if (root) {
      const read = readTaskenRootMarker(root);
      const compared = compareTaskenRootMarker({
        marker: read.state === "missing" ? null : read.state === "present" ? read.marker : {},
        workspaceId: this.repository.workspaceId,
        // 同期フォルダに参加した後でなければ、この端末の Workspace は決まっていない。
        workspaceSettled: syncEnabled && Boolean(syncDirectory),
      });
      marker = {
        state: compared,
        workspaceId: read.state === "present" ? read.marker.workspaceId : "",
        error: compared === "missing" ? this.lastWriteError : "",
      };
    }
    return {
      root,
      kindPreference,
      detectedKind,
      kind,
      marker,
      exceptions: listTaskenRootExceptions({
        root,
        rootKind: kind,
        syncDirectory,
        themes: this.repository.list("theme"),
        activityLogDirectory: text(this.repository.getPreference("activityLogDirectory")),
        backupDirectory,
      }),
      candidate: taskenRootCandidate({ root, syncDirectory }),
      syncDefaultPath: syncFolderDefaultPath(root),
    };
  }

  /**
   * 段 2（#810）で新しい保存に使わなくなった、ルートの外の指定。storage_root を持つ Theme と、
   * {root}/Activity 以外の日誌の個別指定。前に置いたファイルはそこに残っている。
   * 日誌の個別指定は、ルートを設定していない端末ではまだ使うので、そのときは載せない。
   */
  retiredOutsideEntries() {
    const root = this.root();
    return listTaskenRootExceptions({
      root,
      themes: this.repository.list("theme"),
      activityLogDirectory: text(this.repository.getPreference("activityLogDirectory")),
    }).filter((entry) => entry.kind === "theme" || (entry.kind === "activity" && root));
  }

  /**
   * この版の最初の起動で一度だけ出す知らせ（#810）。まだ済んでいなくて該当があれば一覧、無ければ null。
   * ファイルは動かさないので、知らせるだけにする。
   */
  outsideRootNotice() {
    if (this.repository.readOutsideRootNoticeDoneAt()) return null;
    const entries = this.retiredOutsideEntries();
    return entries.length ? { entries } : null;
  }

  /**
   * 起動時に呼ぶ。知らせることが無ければ、ここで済んだ印を付ける。この版の最初の起動のときの
   * 該当だけを知らせ、後から同期で届いた Theme などで改めて出さないため。
   */
  settleOutsideRootNotice() {
    if (this.repository.readOutsideRootNoticeDoneAt()) return;
    if (this.retiredOutsideEntries().length === 0) {
      this.repository.markOutsideRootNoticeDone(this.now().toISOString());
    }
  }

  /** 本人が知らせを閉じたとき。 */
  dismissOutsideRootNotice() {
    this.repository.markOutsideRootNoticeDone(this.now().toISOString());
  }
}
