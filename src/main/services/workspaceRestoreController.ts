import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

import type {
  WorkspaceBackupList,
  WorkspaceRestoreChoice,
  WorkspaceRestoreOutcome,
  WorkspaceRestorePreview,
} from "../../shared/ipc/contracts";
import {
  backupAttachmentRoot,
  backupCreatedAt,
  clearRestoreOutcome,
  listBackups,
  readRestoreOutcome,
  stageRestore,
  type RestoreDatabasePort,
  type RestoreSourceInfo,
} from "./workspaceRestore";

export interface WorkspaceRestoreControllerOptions {
  userDataPath: string;
  /** 控えの保存先（自動バックアップと同じ場所）。設定が変わるので毎回たずねる。 */
  backupDirectory(): string;
  database: RestoreDatabasePort & { workspaceId(): string; syncEnabled(): boolean };
  inspect(filePath: string): RestoreSourceInfo;
  prepare(filePath: string): { entityCount: number; syncWasEnabled: boolean };
  /** 控えのファイルを本人に選んでもらう。取りやめたら ""。 */
  chooseFile(defaultDirectory: string): Promise<string>;
  /** 書きかけの入力を保存させる。保存できなければ false（戻さない）。 */
  flush(): Promise<boolean>;
  /** 終了して起動し直す。次の起動の最初に差し替わる。 */
  relaunch(): void;
}

/**
 * 設定の「控えから戻す」の裏側。Rendererには控えの場所を渡させず、Mainが渡した札（token）だけを
 * 受け取る（Rendererから任意のファイルをDBとして開かせない）。
 */
export class WorkspaceRestoreController {
  private readonly candidates = new Map<string, string>();
  private staging = false;

  constructor(private readonly options: WorkspaceRestoreControllerOptions) {}

  list(): WorkspaceBackupList {
    const directory = this.options.backupDirectory();
    return {
      directory,
      backups: listBackups(directory).map((entry) => ({
        token: this.issue(entry.filePath),
        fileName: path.basename(entry.filePath),
        createdAt: entry.createdAt,
        sizeBytes: entry.sizeBytes,
        kind: entry.kind,
      })),
    };
  }

  async chooseFile(): Promise<WorkspaceRestoreChoice> {
    const filePath = await this.options.chooseFile(this.options.backupDirectory());
    if (!filePath) return { canceled: true };
    return { canceled: false, preview: this.preview(this.issue(filePath)) };
  }

  preview(token: string): WorkspaceRestorePreview {
    const filePath = this.resolve(token);
    let info: RestoreSourceInfo;
    try {
      info = this.options.inspect(filePath);
    } catch {
      throw new Error(
        "選んだファイルをTaskenの控えとして読めませんでした。別の控えを選んでください。",
      );
    }
    const stat = fs.statSync(filePath);
    return {
      token,
      filePath,
      createdAt: backupCreatedAt(filePath) || stat.mtime.toISOString(),
      sizeBytes: stat.size,
      entityCount: info.entityCount,
      currentEntityCount: this.options.database.entityCount(),
      sameWorkspace: info.workspaceId === this.options.database.workspaceId(),
      attachmentsInBackup:
        fs.statSync(backupAttachmentRoot(filePath), { throwIfNoEntry: false })?.isDirectory() ===
        true,
      syncEnabled: this.options.database.syncEnabled(),
    };
  }

  /** 今のデータを控え、戻す準備をして、起動し直す。失敗したら今のデータのまま投げる。 */
  async restore(token: string): Promise<void> {
    if (this.staging) throw new Error("戻す準備をしています。しばらくお待ちください。");
    const sourcePath = this.resolve(token);
    this.staging = true;
    try {
      // 戻す前の控えに、書きかけの入力まで入れる。
      if (!(await this.options.flush())) {
        throw new Error("書きかけの入力を保存できなかったため、戻すのをやめました。");
      }
      await stageRestore({
        userDataPath: this.options.userDataPath,
        sourcePath,
        backupDirectory: this.options.backupDirectory(),
        database: this.options.database,
        inspect: this.options.inspect,
        prepare: this.options.prepare,
      });
    } finally {
      this.staging = false;
    }
    this.options.relaunch();
  }

  lastOutcome(): WorkspaceRestoreOutcome | null {
    return readRestoreOutcome(this.options.userDataPath);
  }

  dismissOutcome(): void {
    clearRestoreOutcome(this.options.userDataPath);
  }

  private issue(filePath: string): string {
    const resolved = path.resolve(filePath);
    for (const [token, known] of this.candidates) if (known === resolved) return token;
    const token = crypto.randomUUID();
    this.candidates.set(token, resolved);
    return token;
  }

  private resolve(token: string): string {
    const filePath = this.candidates.get(token);
    if (!filePath) throw new Error("控えを選び直してください。");
    return filePath;
  }
}
