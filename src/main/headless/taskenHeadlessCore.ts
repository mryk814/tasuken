import { WorkspaceService } from "../services/workspaceService.ts";
import { createAiItemCreationPort } from "../composition/taskenCoreRuntime.ts";
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
  /**
   * このnodeが受け付ける書き込みの範囲。既定は`read-only`。
   * 常時稼働nodeは明示的に`proposals`を選んだ場合だけ、
   * テキストのFeed投稿・Note案・Task案を受け付ける。
   */
  writeMode?: TaskenHeadlessWriteMode;
  /** Independent opt-in. Does not expose task.command or enable delegation. */
  allowAiTaskStart?: boolean;
  env?: NodeJS.ProcessEnv;
}

export type TaskenHeadlessWriteMode = "read-only" | "proposals" | "create-only";

export function resolveTaskenHeadlessWriteMode(value: unknown): TaskenHeadlessWriteMode {
  if (
    String(value || "")
      .trim()
      .toLowerCase() === "create-only"
  )
    return "create-only";
  return String(value || "")
    .trim()
    .toLowerCase() === "proposals"
    ? "proposals"
    : "read-only";
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
  readonly writeMode: TaskenHeadlessWriteMode;
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
 *
 * 書き込みは既定で公開しない。`writeMode: "proposals"` を明示した場合だけ、
 * テキストの読み物投稿・Note案・Task案・Task作業報告を受け付け、Core自身が許可範囲を強制する。
 * 開始専用の`task.start_work`は別の明示opt-inが必要。`task.command`は公開しない。
 */
export async function startTaskenHeadlessCore(
  options: TaskenHeadlessCoreOptions = {},
): Promise<TaskenHeadlessCoreHandle> {
  const env = options.env || process.env;
  const writeMode = options.writeMode || resolveTaskenHeadlessWriteMode(env.TASKEN_CORE_WRITE_MODE);
  const allowAiTaskStart = options.allowAiTaskStart ?? env.TASKEN_CORE_AI_TASK_START === "1";
  if (allowAiTaskStart && writeMode === "read-only") {
    throw new TaskenHeadlessCoreError(
      "WRITE_MODE_CONFLICT",
      "AI開始を許可するにはproposalsまたはcreate-onlyを明示してください。",
    );
  }
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
      {
        proposalAccess: writeMode !== "read-only" ? "proposals" : "read-only",
        ...(allowAiTaskStart
          ? { executeAiTaskStart: (command) => commands.executeAiTaskStart(command) }
          : {}),
      },
    );
    if (syncDirectory) {
      syncService = new SharedFolderSyncService(
        repository,
        () => {},
        path.join(userDataPath, "attachments", "markdown-images"),
        path.join(userDataPath, "attachments", "capture-images"),
      );
      if (!(await syncService.readManifest(syncDirectory))) {
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
    if (writeMode === "create-only") {
      const workspace = new WorkspaceService(repository, userDataPath, undefined, undefined, () => {
        throw new Error("Headless creation accepts text only.");
      });
      // Join first: a new replica must be empty before its personal theme is bootstrapped.
      repository.loadWorkspace();
      workspace.recoverCanonicalMarkdownReceipts();
      runtime.enableAiItemCreation(createAiItemCreationPort(commands, workspace));
    }
  } catch (error) {
    await syncService?.stop();
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
      writeMode,
      async syncNow() {
        if (syncService) await syncService.syncNow();
      },
      async stop() {
        if (stopped) return;
        stopped = true;
        await syncService?.stop();
        try {
          await runtime.stop();
        } finally {
          repository.db.close();
        }
      },
    };
  } catch (error) {
    await syncService?.stop();
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
