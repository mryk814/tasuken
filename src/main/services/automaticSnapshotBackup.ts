import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

import type {
  AutomaticSnapshotBackupConfig,
  AutomaticSnapshotBackupStatus,
} from "../../shared/ipc/contracts";

/**
 * 自動バックアップは正本DBそのもの（SQLite）の写しにする。
 *
 * 以前はWorkspace全体をJSONにしてZIPへ書き、読み直して確かめていた。変更履歴が増えると
 * 1ファイル10MB・全体50MBの読み込み上限に当たり、2026-10-06以降の起動では毎回失敗していた
 * （実データでchange_events.jsonが137MB）。失敗するまでにも起動時のMainを約3秒止めていた。
 * SQLiteのbackupは同期の状態や設定まで含めて写せて、上限もなく、小分けに進むのでMainをほぼ止めない。
 * 戻すときは、Taskenを終了して写しを正本の名前でコピーする（README）。
 */
const AUTOMATIC_BACKUP_PATTERN = /^tasken-auto-(\d{8}T\d{9}Z)-[0-9a-f]{8}\.sqlite$/;
/** 終了や失敗で残った作成途中のファイル。自分が作る名前だけを片付ける。 */
const AUTOMATIC_BACKUP_TEMPORARY_PATTERN =
  /^\.tasken-auto-\d{8}T\d{9}Z-[0-9a-f]{8}\.sqlite\.tmp(?:-journal|-wal|-shm)?$/;

export interface AutomaticBackupDatabase {
  /** 正本の件数（削除済みを含む）。写しの確認に使う。 */
  entityCount(): number;
  /** 本人が作ったEntityの件数。0なら空の作業台として保存しない（自動の既定Themeは数えない）。 */
  userEntityCount(): number;
  /** 正本のWorkspace ID。別のWorkspaceの写しは世代の入れ替えで消さない。 */
  workspaceId(): string;
  /** 正本の一貫した写しを filePath へ書く。shouldAbort が true を返したら途中でやめて投げる。 */
  backupTo(filePath: string, shouldAbort: () => boolean): Promise<void>;
  /** 写しを開き直して件数とWorkspace IDを返す。Taskenの正本として開けなければ投げる。 */
  inspectBackup(filePath: string): { entityCount: number; workspaceId: string };
}

interface AutomaticSnapshotBackupOptions extends AutomaticSnapshotBackupConfig {
  database: AutomaticBackupDatabase;
  defaultDirectory: string;
  now?: () => Date;
  log?: (level: "info" | "warn" | "error", message: string, error?: unknown) => void;
}

export type AutomaticSnapshotTrigger = "startup" | "manual";

function boundedGenerations(value: unknown): number {
  const number = Number(value);
  return Number.isFinite(number) ? Math.max(1, Math.min(20, Math.round(number))) : 5;
}

function safeError(error: unknown): string {
  const code = error && typeof error === "object" && "code" in error ? String(error.code) : "";
  if (code === "EACCES") return "保存先へ書き込めません。フォルダの権限を確認してください。";
  if (code === "ENOSPC") return "空き容量が不足しています。保存先の容量を確保してください。";
  return "バックアップを作成できませんでした。保存先を確認して、もう一度試してください。";
}

function timestamp(date: Date): string {
  return date.toISOString().replaceAll("-", "").replaceAll(":", "").replace(".", "");
}

/** ファイル名の時刻（20261107T140508945Z）をISO形式に戻す。 */
function isoFromFileTimestamp(value: string): string {
  return `${value.slice(0, 4)}-${value.slice(4, 6)}-${value.slice(6, 8)}T${value.slice(9, 11)}:${value.slice(11, 13)}:${value.slice(13, 15)}.${value.slice(15, 18)}Z`;
}

class BackupCancelledError extends Error {}

export class AutomaticSnapshotBackupService {
  private readonly database: AutomaticBackupDatabase;
  private readonly defaultDirectory: string;
  private readonly now: () => Date;
  private readonly log: NonNullable<AutomaticSnapshotBackupOptions["log"]>;
  private config: AutomaticSnapshotBackupConfig;
  private running: Promise<AutomaticSnapshotBackupStatus> | null = null;
  private cancelRequested = false;
  private closed = false;
  private runtime: Omit<AutomaticSnapshotBackupStatus, keyof AutomaticSnapshotBackupConfig> = {
    lastAttemptAt: "",
    lastSuccessAt: "",
    latestFilePath: "",
    backupCount: 0,
    lastError: "",
    skippedReason: "",
  };

  constructor(options: AutomaticSnapshotBackupOptions) {
    this.database = options.database;
    this.defaultDirectory = path.resolve(options.defaultDirectory);
    this.now = options.now || (() => new Date());
    this.log = options.log || (() => {});
    this.config = this.normalizeConfig(options);
    this.refreshInventory();
  }

  configure(config: AutomaticSnapshotBackupConfig): AutomaticSnapshotBackupStatus {
    this.config = this.normalizeConfig(config);
    this.runtime.lastError = "";
    this.runtime.skippedReason = "";
    this.refreshInventory();
    return this.status();
  }

  status(): AutomaticSnapshotBackupStatus {
    this.refreshInventory();
    return { ...this.config, ...this.runtime };
  }

  /** 実行中なら同じ結果を待つ。同時に2つの写しを作らない。終了の後は作らない。 */
  run(trigger: AutomaticSnapshotTrigger = "manual"): Promise<AutomaticSnapshotBackupStatus> {
    if (this.running) return this.running;
    if (this.closed) return Promise.resolve(this.status());
    this.cancelRequested = false;
    this.running = this.runOnce(trigger).finally(() => {
      this.running = null;
    });
    return this.running;
  }

  /**
   * 終了時に呼ぶ。作成途中の写しを止めて片付け終わるまで待つ。完成済みの世代には触れない。
   * 以後の run（起動30秒後のタイマーなど）は何もしない。
   */
  async cancel(): Promise<void> {
    this.closed = true;
    if (!this.running) return;
    this.cancelRequested = true;
    await this.running.catch(() => undefined);
  }

  private async runOnce(trigger: AutomaticSnapshotTrigger): Promise<AutomaticSnapshotBackupStatus> {
    const attemptedAt = this.now();
    this.runtime.lastAttemptAt = attemptedAt.toISOString();
    this.runtime.lastError = "";
    this.runtime.skippedReason = "";

    if (trigger === "startup" && !this.config.enabled) {
      this.runtime.skippedReason = "自動バックアップは停止中です。";
      return this.status();
    }

    const directory = this.config.directory;
    let temporaryPath = "";
    try {
      // 起動のたびに既定Theme「個人業務」が自動で作られるので、全件の数では空を判定できない。
      // DBを移した直後などに空の写しを作ると、世代の入れ替えで本物の写しが消えていく。
      if (this.database.userEntityCount() === 0) {
        this.runtime.skippedReason =
          "保存するデータがまだないため、バックアップを作成しませんでした。";
        return this.status();
      }

      fs.mkdirSync(directory, { recursive: true });
      this.removeStaleTemporaryFiles(directory);
      const fileName = `tasken-auto-${timestamp(attemptedAt)}-${crypto.randomUUID().slice(0, 8)}.sqlite`;
      const finalPath = path.join(directory, fileName);
      temporaryPath = path.join(directory, `.${fileName}.tmp`);
      await this.database.backupTo(temporaryPath, () => this.cancelRequested);
      if (this.cancelRequested) throw new BackupCancelledError("終了のため中止した");
      // backupの最後の1歩とこの行の間に他の処理は割り込まない（同じtickの続き）。
      const liveCount = this.database.entityCount();
      const { entityCount } = this.database.inspectBackup(temporaryPath);
      if (entityCount !== liveCount) {
        throw new Error("バックアップの確認でEntity件数が一致しませんでした。");
      }
      fs.renameSync(temporaryPath, finalPath);
      temporaryPath = "";
      this.runtime.lastSuccessAt = attemptedAt.toISOString();
      this.runtime.latestFilePath = finalPath;
      this.log(
        "info",
        `自動バックアップを作成した (trigger=${trigger}, generations=${this.config.generations})`,
      );
      this.removeOldGenerations();
    } catch (error) {
      if (temporaryPath) this.removeTemporaryFile(temporaryPath);
      // 中止はbackupTo自身が投げる（進捗の途中で止める）ことも、終わった直後に気づくこともある。
      if (error instanceof BackupCancelledError || this.cancelRequested) {
        this.runtime.skippedReason = "終了のため、作成途中のバックアップを中止しました。";
      } else {
        this.runtime.lastError = safeError(error);
        this.log("error", `自動バックアップに失敗した (trigger=${trigger})`, error);
      }
    }
    this.refreshInventory();
    return this.status();
  }

  /**
   * 今のWorkspaceの写しを新しい順に数え、世代数を超えた古いものを消す。
   * 別のWorkspaceの写し（DBを作り直す前のものなど）と、開けない写しは数えず消さない。
   * 消せないファイル（同期ソフトが掴んでいるなど）は警告にとどめ、作成の成功は取り消さない。
   */
  private removeOldGenerations(): void {
    const workspaceId = this.database.workspaceId();
    let kept = 0;
    for (const backup of this.listBackups()) {
      let backupWorkspaceId = "";
      try {
        backupWorkspaceId = this.database.inspectBackup(backup.path).workspaceId;
      } catch (error) {
        this.log("warn", "開けない自動バックアップは入れ替えの対象にしない", error);
        continue;
      }
      if (backupWorkspaceId !== workspaceId) continue;
      kept += 1;
      if (kept <= this.config.generations) continue;
      try {
        fs.unlinkSync(backup.path);
      } catch (error) {
        this.log("warn", "古い自動バックアップを消せなかった（次の作成で再び試す）", error);
      }
    }
  }

  private removeTemporaryFile(temporaryPath: string): void {
    for (const suffix of ["", "-journal", "-wal", "-shm"]) {
      try {
        fs.rmSync(`${temporaryPath}${suffix}`, { force: true });
      } catch {
        // 作成途中のファイルを消せなくても、元の失敗理由を優先する。次回の実行でも片付ける。
      }
    }
  }

  private removeStaleTemporaryFiles(directory: string): void {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      if (entry.isFile() && AUTOMATIC_BACKUP_TEMPORARY_PATTERN.test(entry.name)) {
        this.removeTemporaryFile(
          path.join(directory, entry.name.replace(/(-journal|-wal|-shm)$/, "")),
        );
      }
    }
  }

  private normalizeConfig(config: AutomaticSnapshotBackupConfig): AutomaticSnapshotBackupConfig {
    const requestedDirectory = typeof config.directory === "string" ? config.directory.trim() : "";
    return {
      enabled: config.enabled !== false,
      directory: path.resolve(requestedDirectory || this.defaultDirectory),
      generations: boundedGenerations(config.generations),
    };
  }

  /**
   * SQLiteの写しを、ファイル名の時刻の新しい順に並べる（更新時刻は写しを開いて書き換えると
   * 変わるので使わない）。以前のZIP（tasken-auto-*.zip）は数えず、触れない。
   */
  private listBackups(): Array<{ path: string; createdAt: string }> {
    if (!fs.statSync(this.config.directory, { throwIfNoEntry: false })?.isDirectory()) return [];
    return fs
      .readdirSync(this.config.directory, { withFileTypes: true })
      .flatMap((entry) => {
        const match = entry.isFile() ? AUTOMATIC_BACKUP_PATTERN.exec(entry.name) : null;
        return match
          ? [
              {
                path: path.join(this.config.directory, entry.name),
                createdAt: isoFromFileTimestamp(match[1]),
              },
            ]
          : [];
      })
      .sort(
        (left, right) =>
          right.createdAt.localeCompare(left.createdAt) || right.path.localeCompare(left.path),
      );
  }

  private refreshInventory(): void {
    try {
      const backups = this.listBackups();
      this.runtime.backupCount = backups.length;
      this.runtime.latestFilePath = backups[0]?.path || "";
      if (!this.runtime.lastSuccessAt && backups[0]) {
        this.runtime.lastSuccessAt = backups[0].createdAt;
      }
    } catch (error) {
      this.runtime.backupCount = 0;
      this.runtime.latestFilePath = "";
      this.runtime.lastError ||= safeError(error);
      this.log("warn", "自動バックアップの一覧を確認できなかった", error);
    }
  }
}
