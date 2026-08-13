import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

import type { AutomaticSnapshotBackupConfig, AutomaticSnapshotBackupStatus } from "../../shared/ipc/contracts";
import { entityDefinitions } from "../../shared/entityRegistry.mjs";

const AUTOMATIC_SNAPSHOT_PATTERN = /^tasken-auto-\d{8}T\d{9}Z-[0-9a-f]{8}\.zip$/;

interface SnapshotRepository {
  loadWorkspace(includeDeleted?: boolean): unknown;
}

interface AutomaticSnapshotBackupOptions extends AutomaticSnapshotBackupConfig {
  repository: SnapshotRepository;
  defaultDirectory: string;
  writeSnapshot: (workspace: unknown, filePath: string) => void;
  verifySnapshot: (filePath: string) => unknown;
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

function storedEntityCount(workspace: unknown): number {
  if (!workspace || typeof workspace !== "object" || Array.isArray(workspace)) return 0;
  const source = workspace as Record<string, unknown>;
  return entityDefinitions.reduce((count, definition) => {
    const collection = source[definition.collectionKey];
    if (!Array.isArray(collection)) return count;
    return count + collection.length;
  }, 0);
}

export class AutomaticSnapshotBackupService {
  private readonly repository: SnapshotRepository;
  private readonly defaultDirectory: string;
  private readonly writeSnapshot: AutomaticSnapshotBackupOptions["writeSnapshot"];
  private readonly verifySnapshot: AutomaticSnapshotBackupOptions["verifySnapshot"];
  private readonly now: () => Date;
  private readonly log: NonNullable<AutomaticSnapshotBackupOptions["log"]>;
  private config: AutomaticSnapshotBackupConfig;
  private runtime: Omit<AutomaticSnapshotBackupStatus, keyof AutomaticSnapshotBackupConfig> = {
    lastAttemptAt: "",
    lastSuccessAt: "",
    latestFilePath: "",
    backupCount: 0,
    lastError: "",
    skippedReason: "",
  };

  constructor(options: AutomaticSnapshotBackupOptions) {
    this.repository = options.repository;
    this.defaultDirectory = path.resolve(options.defaultDirectory);
    this.writeSnapshot = options.writeSnapshot;
    this.verifySnapshot = options.verifySnapshot;
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

  run(trigger: AutomaticSnapshotTrigger = "manual"): AutomaticSnapshotBackupStatus {
    const attemptedAt = this.now();
    this.runtime.lastAttemptAt = attemptedAt.toISOString();
    this.runtime.lastError = "";
    this.runtime.skippedReason = "";

    if (trigger === "startup" && !this.config.enabled) {
      this.runtime.skippedReason = "自動バックアップは停止中です。";
      return this.status();
    }

    let temporaryPath = "";
    try {
      const workspace = this.repository.loadWorkspace(true);
      const entityCount = storedEntityCount(workspace);
      if (entityCount === 0) {
        this.runtime.skippedReason = "保存するデータがまだないため、バックアップを作成しませんでした。";
        return this.status();
      }

      fs.mkdirSync(this.config.directory, { recursive: true });
      const fileName = `tasken-auto-${timestamp(attemptedAt)}-${crypto.randomUUID().slice(0, 8)}.zip`;
      const finalPath = path.join(this.config.directory, fileName);
      temporaryPath = path.join(this.config.directory, `.${fileName}.tmp`);
      this.writeSnapshot(workspace, temporaryPath);
      const verifiedWorkspace = this.verifySnapshot(temporaryPath);
      if (storedEntityCount(verifiedWorkspace) !== entityCount) {
        throw new Error("Snapshotの復元確認でEntity件数が一致しませんでした。");
      }
      fs.renameSync(temporaryPath, finalPath);
      temporaryPath = "";

      const backups = this.listBackups();
      for (const stale of backups.slice(this.config.generations)) fs.unlinkSync(stale.path);
      this.runtime.lastSuccessAt = attemptedAt.toISOString();
      this.runtime.latestFilePath = finalPath;
      this.log("info", `自動Snapshotを作成した (trigger=${trigger}, generations=${this.config.generations})`);
    } catch (error) {
      if (temporaryPath) {
        try {
          fs.unlinkSync(temporaryPath);
        } catch {
          // 作成途中の一時ファイルが既にない場合は、元の失敗理由を優先する。
        }
      }
      this.runtime.lastError = safeError(error);
      this.log("error", `自動Snapshotに失敗した (trigger=${trigger})`, error);
    }
    this.refreshInventory();
    return this.status();
  }

  private normalizeConfig(config: AutomaticSnapshotBackupConfig): AutomaticSnapshotBackupConfig {
    const requestedDirectory = typeof config.directory === "string" ? config.directory.trim() : "";
    return {
      enabled: config.enabled !== false,
      directory: path.resolve(requestedDirectory || this.defaultDirectory),
      generations: boundedGenerations(config.generations),
    };
  }

  private listBackups(): Array<{ path: string; modifiedAt: number }> {
    if (!fs.statSync(this.config.directory, { throwIfNoEntry: false })?.isDirectory()) return [];
    return fs.readdirSync(this.config.directory, { withFileTypes: true })
      .filter((entry) => entry.isFile() && AUTOMATIC_SNAPSHOT_PATTERN.test(entry.name))
      .map((entry) => {
        const filePath = path.join(this.config.directory, entry.name);
        return { path: filePath, modifiedAt: fs.statSync(filePath).mtimeMs };
      })
      .sort((left, right) => right.modifiedAt - left.modifiedAt || right.path.localeCompare(left.path));
  }

  private refreshInventory(): void {
    try {
      const backups = this.listBackups();
      this.runtime.backupCount = backups.length;
      this.runtime.latestFilePath = backups[0]?.path || "";
      if (!this.runtime.lastSuccessAt && backups[0]) {
        this.runtime.lastSuccessAt = new Date(backups[0].modifiedAt).toISOString();
      }
    } catch (error) {
      this.runtime.backupCount = 0;
      this.runtime.latestFilePath = "";
      this.runtime.lastError ||= safeError(error);
      this.log("warn", "自動Snapshot一覧を確認できなかった", error);
    }
  }
}
