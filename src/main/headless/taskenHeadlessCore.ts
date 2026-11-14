import { WorkspaceService } from "../services/workspaceService.ts";
import {
  createAiItemCreationPort,
  createAiTaskChangeService,
  createMobileFeedWriter,
  createMobileRoutineWriter,
  createMobileWorkLogWriter,
} from "../composition/taskenCoreRuntime.ts";
import path from "node:path";

import { TaskenCoreRuntime } from "../composition/taskenCoreRuntime.ts";
import { TaskenCoreClient, TaskenCoreClientError } from "../mcp/taskenCoreClient.mjs";
import { WorkspaceDatabase } from "../repositories/workspaceRepository.mjs";
import { ApplicationCommandService } from "../services/applicationCommandService.ts";
import {
  createCaptureImagePort,
  createReadOnlyCaptureImagePort,
} from "../services/captureImageStore.ts";
import { AutomaticSnapshotBackupService } from "../services/automaticSnapshotBackup.ts";
import { createImageHeaderDecoder } from "../services/imageHeaderDecoder.ts";
import { inspectWorkspaceBackup } from "../repositories/workspaceRepository.mjs";
import { createHeadlessMobileGateway, DEFAULT_MOBILE_GATEWAY_PORT } from "./mobileGateway.ts";
import { SharedFolderSyncService } from "../services/sharedFolderSync.mjs";
import { aiItemPacketFlags } from "../../shared/contracts/sync/aiItemPacketContract.mjs";
import { desktopWriteBlock } from "../../shared/contracts/sync/desktopWriteBlock.mjs";
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
  /**
   * 既存Taskの直接変更と取り消し（#688）。`create-only`と一緒にだけ使える独立のopt-in。
   * 私用のWorkspaceのNASで、Museなどが本人の言葉を根拠にTaskを直せるようにする。
   */
  allowAiTaskChange?: boolean;
  /**
   * 端末（Android）のMobile Gatewayを、DesktopのかわりにこのNASで動かす。既定は無効で、write-modeとは独立。
   * 共有フォルダ同期への参加（syncDirectory）が済むまでは待ち受けない。127.0.0.1だけで待ち受ける。
   */
  mobileGateway?: boolean;
  /** Mobile Gatewayのport。既定は48177（Desktopと同じ）。試験では0で空きを使う。 */
  mobileGatewayPort?: number;
  /** 書き込みを断る判定に使う、AI作成の差分の形の印。試験で差し替える。既定は契約ファイルの値。 */
  syncShapeFlags?: ReadonlyArray<{
    shape_sha256: string;
    desktop_first?: boolean;
    /** 古いDesktopが取り込めないのがこの経路の書く差分だけの時、その経路だけを断る（#751）。 */
    desktop_first_routes?: ReadonlyArray<string>;
  }>;
  env?: NodeJS.ProcessEnv;
}

/** 既存Taskを直接書き換える経路。replicaの取り込みが追いついていないと断る。 */
const EXISTING_TASK_PATHS = new Set([
  "/v1/commands/start-ai-task-work",
  "/v1/commands/change-task",
  "/v1/commands/undo-change",
]);

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
  readonly aiTaskChange: boolean;
  /** Mobile Gatewayが待ち受けているport。無効なら null。 */
  readonly mobileGatewayPort: number | null;
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
 * 既存Taskの直接変更（`task.ai_change`）も、`create-only`に足す別の明示opt-inが必要。
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
  const allowAiTaskChange = options.allowAiTaskChange ?? env.TASKEN_CORE_AI_TASK_CHANGE === "1";
  // 直してよいのに作れない配備は作らない（作れないAIが直接変更だけを持つ形を残さない）。
  if (allowAiTaskChange && writeMode !== "create-only") {
    throw new TaskenHeadlessCoreError(
      "WRITE_MODE_CONFLICT",
      "AIの直接のTask変更を許可するにはcreate-onlyを明示してください。",
    );
  }
  const mobileGatewayEnabled = options.mobileGateway ?? env.TASKEN_CORE_MOBILE_GATEWAY === "1";
  const mobileGatewayPort = resolveMobileGatewayPort(
    options.mobileGatewayPort ?? env.TASKEN_CORE_MOBILE_GATEWAY_PORT,
  );
  // 参加前の空のnodeが端末を受け付けないよう、同期の設定がない配備ではそもそも起動しない。
  if (mobileGatewayEnabled && !options.syncDirectory) {
    throw new TaskenHeadlessCoreError(
      "MOBILE_GATEWAY_REQUIRES_SYNC",
      "Mobile Gatewayは共有フォルダ同期へ参加したnodeでだけ動かせます。--sync-directoryを指定してください。",
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
  let workspace: WorkspaceService | null = null;
  let mobileGateway: ReturnType<typeof createHeadlessMobileGateway> | null = null;
  let backup: AutomaticSnapshotBackupService | null = null;
  let backupTimer: NodeJS.Timeout | null = null;
  // WorkLogの書き込みは参加の後に作るWorkspaceServiceを使う。Gatewayは参加の後にしか待ち受けない。
  const requireWorkspace = () => {
    if (!workspace) throw new Error("WorkspaceServiceが準備できていません。");
    return workspace;
  };
  try {
    const commands = new ApplicationCommandService(repository);
    runtime = new TaskenCoreRuntime(
      userDataPath,
      repository,
      (command) => commands.execute(command),
      undefined,
      undefined,
      mobileGatewayEnabled
        ? createMobileWorkLogWriter({
            adoptWorkLogOrganization: (command, actor) =>
              requireWorkspace().adoptWorkLogOrganization(command, actor),
            recordWorkLog: (command, actor) => requireWorkspace().recordWorkLog(command, actor),
            changeWorkLogLifecycle: (command, actor) =>
              requireWorkspace().changeWorkLogLifecycle(command, actor),
          })
        : undefined,
      // 端末の写真は、Electronなしの寸法検査でDesktopと同じ場所・同じ名前に保存する（共有フォルダ同期で運ぶ）。
      mobileGatewayEnabled
        ? createCaptureImagePort(userDataPath, createImageHeaderDecoder())
        : createReadOnlyCaptureImagePort(userDataPath),
      {
        ...(mobileGatewayEnabled
          ? {
              feedWriter: createMobileFeedWriter(repository),
              routineWriter: createMobileRoutineWriter(repository),
            }
          : {}),
        proposalAccess: writeMode !== "read-only" ? "proposals" : "read-only",
        ...(allowAiTaskStart
          ? { executeAiTaskStart: (command) => commands.executeAiTaskStart(command, "personal") }
          : {}),
      },
    );
    if (syncDirectory) {
      syncService = new SharedFolderSyncService(
        repository,
        () => {},
        path.join(userDataPath, "attachments", "markdown-images"),
        path.join(userDataPath, "attachments", "capture-images"),
        { role: "replica" },
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
    if (writeMode === "create-only" || mobileGatewayEnabled) {
      // WorkLogの書き込み（端末）はwrite-modeと独立に、同じWorkspaceServiceを使う。
      workspace = new WorkspaceService(repository, userDataPath, undefined, undefined, () => {
        throw new Error("Headless creation accepts text only.");
      });
      // Join first: a new replica must be empty before its personal theme is bootstrapped.
      repository.loadWorkspace();
      workspace.recoverCanonicalMarkdownReceipts();
    }
    if (writeMode === "create-only" && workspace) {
      runtime.enableAiItemCreation(createAiItemCreationPort(commands, workspace));
      // 配備で明示した時点で許しているので、Desktopのような要求ごとの設定は読まない。
      if (allowAiTaskChange)
        runtime.enableAiTaskChange(createAiTaskChangeService(repository, commands, () => true));
    }
    if (mobileGatewayEnabled && syncService) {
      if (!isJoinedTo(repository, syncDirectory)) {
        throw new TaskenHeadlessCoreError(
          "MOBILE_GATEWAY_NOT_JOINED",
          "共有フォルダ同期への参加が済んでいないため、Mobile Gatewayを起動しません。",
        );
      }
      const joinedSync = syncService;
      mobileGateway = createHeadlessMobileGateway({
        runtime,
        persistence: repository,
        sync: {
          sourceStatus: (node) => joinedSync.sourceStatus(node),
          isPublishBlocked: () => joinedSync.isPublishBlocked(),
        },
        port: mobileGatewayPort,
      });
      runtime.enableAdminRoutes(mobileGateway.adminRoutes);
      // 端末の書き込みを受けるnodeなので、DBの写しを取る（Desktopと同じ仕組み。既定の保存先は<userData>/Backups）。
      backup = createBackupService(repository, userDataPath);
    }
  } catch (error) {
    await syncService?.stop();
    repository.db.close();
    throw error;
  }
  // replicaだけが、取り込みの鮮度をAIへ返す。Desktopのcompositionでは有効にしない。
  if (syncService) {
    const sync = syncService;
    runtime.enableSourceStatus(() => sync.sourceStatus("replica"));
    // 古いDesktopが取り込めない差分を、replicaが書かないようにする。読み取りは止めない。
    const flags = options.syncShapeFlags || aiItemPacketFlags;
    runtime.enableWriteGate((requestPath) => {
      if (
        desktopWriteBlock({ flags, desktops: sync.desktopStatuses(), route: requestPath }) ===
        "desktop_behind"
      )
        return "DESKTOP_BEHIND";
      // 開始・直接変更・取り消しは既存Taskの直接の書き換えで、replicaの手元の版との照合は、
      // replicaが遅れていても通ってしまう。取り込みが追いついている（state ok）ときだけ受け付ける。
      if (EXISTING_TASK_PATHS.has(requestPath) && sync.sourceStatus("replica").state !== "ok")
        return "REPLICA_BEHIND";
      return null;
    });
  }
  try {
    const started = await runtime.start();
    const status = await new TaskenCoreClient({ userDataPath }).inspect();
    syncService?.start();
    // 待ち受けは、Core・同期が起動し、参加が済んでから。
    if (mobileGateway && !(await mobileGateway.gateway.start())) {
      throw new TaskenHeadlessCoreError(
        "MOBILE_GATEWAY_START_FAILED",
        `Mobile Gatewayを127.0.0.1:${mobileGatewayPort}で起動できませんでした。portが使われていないか確認してください。`,
      );
    }
    if (backup) {
      const service = backup;
      // 起動の少し後に一回、その後は一日おき（NASは起動しっぱなしで、Desktopのような起動のたびの写しにならない）。
      setTimeout(() => void service.run("startup"), BACKUP_STARTUP_DELAY_MS).unref();
      backupTimer = setInterval(() => void service.run("manual"), BACKUP_INTERVAL_MS);
      backupTimer.unref();
    }
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
      aiTaskChange: allowAiTaskChange,
      mobileGatewayPort: mobileGateway ? mobileGateway.gateway.diagnostics().port : null,
      async syncNow() {
        if (syncService) await syncService.syncNow();
      },
      async stop() {
        if (stopped) return;
        stopped = true;
        if (backupTimer) clearInterval(backupTimer);
        try {
          await mobileGateway?.gateway.stop();
          await backup?.cancel();
          await syncService?.stop();
          await runtime.stop();
        } finally {
          repository.db.close();
        }
      },
    };
  } catch (error) {
    if (backupTimer) clearInterval(backupTimer);
    await mobileGateway?.gateway.stop().catch(() => {});
    await backup?.cancel();
    await syncService?.stop();
    await runtime.stop().catch(() => {});
    repository.db.close();
    throw error;
  }
}

const BACKUP_STARTUP_DELAY_MS = 30_000;
const BACKUP_INTERVAL_MS = 24 * 60 * 60_000;

function resolveMobileGatewayPort(value: unknown): number {
  if (value === undefined || value === "") return DEFAULT_MOBILE_GATEWAY_PORT;
  const port = Number(value);
  if (!Number.isInteger(port) || port < 0 || port > 65_535) {
    throw new TaskenHeadlessCoreError(
      "INVALID_MOBILE_GATEWAY_PORT",
      "Mobile Gatewayのportには0〜65535の整数を指定してください。",
    );
  }
  return port;
}

/** 同期が有効で、この共有フォルダへ参加済み（Workspaceを採用済み）か。 */
function isJoinedTo(
  repository: InstanceType<typeof WorkspaceDatabase>,
  syncDirectory: string | null,
): boolean {
  return (
    Boolean(syncDirectory) &&
    repository.getPreference("sharedSyncEnabled") === true &&
    String(repository.getPreference("sharedSyncDirectory") || "") === syncDirectory
  );
}

function createBackupService(
  repository: InstanceType<typeof WorkspaceDatabase>,
  userDataPath: string,
) {
  return new AutomaticSnapshotBackupService({
    database: {
      entityCount: () => repository.entityCount(),
      userEntityCount: () => repository.userEntityCount(),
      workspaceId: () => repository.workspaceId,
      backupTo: (filePath, shouldAbort) => repository.backupTo(filePath, shouldAbort),
      inspectBackup: (filePath) => inspectWorkspaceBackup(filePath),
    },
    defaultDirectory: path.join(userDataPath, "Backups"),
    enabled: repository.getPreference("automaticSnapshotBackupEnabled") !== false,
    directory: String(repository.getPreference("automaticSnapshotBackupDirectory") || ""),
    generations: Number(repository.getPreference("automaticSnapshotBackupGenerations")),
    log: (level, message) => console.error(`[tasken-backup] ${level}: ${message}`),
  });
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
