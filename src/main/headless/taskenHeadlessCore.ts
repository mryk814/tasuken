import path from "node:path";

import { TaskenCoreRuntime } from "../composition/taskenCoreRuntime.ts";
import { TaskenCoreClient, TaskenCoreClientError } from "../mcp/taskenCoreClient.mjs";
import { WorkspaceDatabase } from "../repositories/workspaceRepository.mjs";
import { ApplicationCommandService } from "../services/applicationCommandService.ts";
import { createReadOnlyCaptureImagePort } from "../services/captureImageStore.ts";
import { SharedFolderSyncService } from "../services/sharedFolderSync.mjs";
import { resolveTaskenDatabasePath, resolveTaskenUserDataPath } from "../../shared/taskenPaths.mjs";

export interface TaskenHeadlessCoreOptions {
  userDataPath?: string;
  databasePath?: string;
  syncDirectory?: string;
  env?: NodeJS.ProcessEnv;
}

export interface TaskenHeadlessCoreHandle {
  readonly userDataPath: string;
  readonly databasePath: string;
  readonly origin: string;
  readonly discoveryPath: string;
  readonly apiVersion: string;
  readonly capabilityCount: number;
  readonly pid: number;
  readonly syncDirectory: string | null;
  syncNow(): Promise<void>;
  stop(): Promise<void>;
}

export class TaskenHeadlessCoreError extends Error {
  readonly code: string;

  constructor(code: string, message: string, options: ErrorOptions = {}) {
    super(message, options);
    this.name = "TaskenHeadlessCoreError";
    this.code = code;
  }
}

/**
 * GUI・Electron lifecycleを必要とせずにTasken Coreを起動する。
 * Desktop compositionと同じApplicationCommandService / TaskenCoreRuntimeを使い、
 * loopback hostとdiscovery fileだけを公開する。画像port・Mobile Gateway・
 * Desktop IPCは含めない。
 *
 * `syncDirectory` を指定すると、既存の共有フォルダ同期へreplicaとして参加し、
 * ホスト端末が公開したapplication-level差分を取り込む。空のnodeだけが参加でき、
 * MCPはread-only deployment（`TASKEN_MCP_READ_ONLY=1`）で動かす前提とする。
 */
export async function startTaskenHeadlessCore(
  options: TaskenHeadlessCoreOptions = {},
): Promise<TaskenHeadlessCoreHandle> {
  const env = options.env || process.env;
  const userDataPath = path.resolve(options.userDataPath || resolveTaskenUserDataPath({ env }));
  const databasePath = path.resolve(
    options.databasePath ||
      (options.userDataPath
        ? path.join(userDataPath, "research-desk.sqlite")
        : resolveTaskenDatabasePath({ env })),
  );
  const syncDirectory = options.syncDirectory ? path.resolve(options.syncDirectory) : null;
  await assertNoLiveCore(userDataPath);
  let repository: InstanceType<typeof WorkspaceDatabase>;
  try {
    repository = new WorkspaceDatabase(databasePath);
  } catch (error) {
    throw nativeModuleStartError(error);
  }
  let runtime: TaskenCoreRuntime;
  let syncService: InstanceType<typeof SharedFolderSyncService> | null = null;
  try {
    const commands = new ApplicationCommandService(repository);
    runtime = new TaskenCoreRuntime(
      userDataPath,
      repository,
      (command) => commands.execute(command),
      undefined,
      undefined,
      undefined,
      undefined,
      createReadOnlyCaptureImagePort(userDataPath),
    );
    if (syncDirectory) {
      syncService = new SharedFolderSyncService(
        repository,
        () => {},
        path.join(userDataPath, "attachments", "markdown-images"),
        path.join(userDataPath, "attachments", "capture-images"),
      );
      if (!syncService.readManifest(syncDirectory)) {
        throw new TaskenHeadlessCoreError(
          "SYNC_FOLDER_NOT_READY",
          "共有フォルダがまだデータ端末で初期化されていません。先にデータを持つ端末で同期を設定してください。",
        );
      }
      try {
        await syncService.configure(syncDirectory);
      } catch (error) {
        // join自体は保存済みでも、初回同期はOneDrive等の途中コピーで失敗しうる。
        // その場合はpollで再試行するため起動は継続する。
        const joined =
          repository.getPreference("sharedSyncEnabled") === true &&
          String(repository.getPreference("sharedSyncDirectory") || "") === syncDirectory;
        if (!joined) throw error;
      }
    }
  } catch (error) {
    syncService?.stop();
    repository.db.close();
    throw error;
  }
  try {
    const started = await runtime.start();
    const status = await new TaskenCoreClient({ userDataPath }).inspect();
    syncService?.start();
    let stopped = false;
    return {
      userDataPath,
      databasePath,
      origin: started.origin,
      discoveryPath: started.discoveryPath,
      apiVersion: status.api_version,
      capabilityCount: status.capabilities.length,
      pid: process.pid,
      syncDirectory,
      async syncNow() {
        if (syncService) await syncService.syncNow();
      },
      async stop() {
        if (stopped) return;
        stopped = true;
        syncService?.stop();
        try {
          await runtime.stop();
        } finally {
          repository.db.close();
        }
      },
    };
  } catch (error) {
    syncService?.stop();
    await runtime.stop().catch(() => {});
    repository.db.close();
    throw error;
  }
}

/**
 * 同じuserDataで稼働中のCoreがあれば起動を拒否する。DesktopとHeadlessを
 * 同時に動かすとSQLiteの単一writer境界を壊すため、discoveryが有効な間は
 * 2つ目のCoreを許さない。staleなdiscoveryは上書きされる。
 */
async function assertNoLiveCore(userDataPath: string): Promise<void> {
  try {
    await new TaskenCoreClient({ userDataPath }).inspect();
  } catch (error) {
    if (error instanceof TaskenCoreClientError) return;
    throw error;
  }
  throw new TaskenHeadlessCoreError(
    "CORE_ALREADY_RUNNING",
    "同じuserDataでTasken Coreが稼働中です。Desktopまたは既存のHeadless Coreを停止してください。",
  );
}

function nativeModuleStartError(error: unknown): unknown {
  const message = error instanceof Error ? error.message : "";
  if (message.includes("NODE_MODULE_VERSION")) {
    return new TaskenHeadlessCoreError(
      "NATIVE_MODULE_MISMATCH",
      "better-sqlite3がこのNode runtime向けにビルドされていません。npm rebuild better-sqlite3で再ビルドしてください。",
      { cause: error },
    );
  }
  return error;
}
