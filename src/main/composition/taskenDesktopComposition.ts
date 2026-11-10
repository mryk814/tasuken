import fs from "node:fs";
import path from "node:path";

import { nativeImage } from "electron";

import { validateMcpPackageSmokeRoot } from "../../shared/taskenPaths.mjs";
import { TaskenCoreRuntime } from "./taskenCoreRuntime.ts";
import { ApplicationCommandService } from "../services/applicationCommandService";
import {
  createNativeImageDecoder,
  createNoteProposalImagePort,
} from "../services/proposalMarkdownImages.ts";
import { createCaptureImagePort } from "../services/captureImageStore.ts";
import {
  MobileGatewayRuntime,
  type MobileDevicePersistence,
  type MobileGatewayStatePort,
} from "../gateway/mobile/runtimePublic.ts";

interface McpPackageSmokePersistence {
  ensureMcpPackageSmokeFixture(): unknown;
  verifyMcpPackageSmokeProposal(id: string): unknown;
}

type DesktopPersistence = ConstructorParameters<typeof TaskenCoreRuntime>[1] &
  ConstructorParameters<typeof ApplicationCommandService>[0] &
  MobileDevicePersistence &
  McpPackageSmokePersistence & {
    mobileGatewayState(): ReturnType<MobileGatewayStatePort["current"]>;
  };

export interface McpPackageSmokeRootOptions {
  userDataPath?: string;
  markerToken?: string;
  environmentMarker?: string;
}

export interface McpPackageSmokeOptions {
  enabled: boolean;
  verifyOnly: boolean;
  proposalId?: string;
  resultPath?: string;
}

export interface McpPackageSmokeLaunchOptions
  extends McpPackageSmokeRootOptions, McpPackageSmokeOptions {}

export interface TaskenDesktopCompositionOptions<
  TPersistence extends DesktopPersistence = DesktopPersistence,
> {
  userDataPath: string;
  persistence: TPersistence;
  getCaptureOrganizer?: Parameters<TaskenCoreRuntime["createMobileGateway"]>[2];
  mcpPackageSmoke?: McpPackageSmokeOptions;
  onProposalCommitted?: ConstructorParameters<typeof TaskenCoreRuntime>[3];
  onCoreCommandCommitted?: (receipt: ReturnType<ApplicationCommandService["execute"]>) => void;
  workLogWriter?: ConstructorParameters<typeof TaskenCoreRuntime>[6];
  /** Androidからの反応・返信を保存する口（保存後のDesktop画面の更新も担う）。 */
  feedWriter?: NonNullable<ConstructorParameters<typeof TaskenCoreRuntime>[8]>["feedWriter"];
  /** Androidからの続けること・手入れの記録を保存する口（#454）。 */
  routineWriter?: NonNullable<ConstructorParameters<typeof TaskenCoreRuntime>[8]>["routineWriter"];
}

/** packaged MCP smokeのfixtureを用意し、Proposal IDがあれば検証結果を書き出す。 */
function prepareMcpPackageSmokeData(
  repository: McpPackageSmokePersistence,
  options: McpPackageSmokeOptions,
): void {
  repository.ensureMcpPackageSmokeFixture();
  if (!options.proposalId) return;
  if (!/^[0-9a-f-]{36}$/i.test(options.proposalId)) {
    throw new Error("MCP package smoke Proposal IDが不正です。");
  }
  const verification = repository.verifyMcpPackageSmokeProposal(options.proposalId);
  if (options.resultPath) {
    fs.writeFileSync(path.resolve(options.resultPath), JSON.stringify(verification), {
      flag: "w",
    });
  }
}

/**
 * verify-onlyの検証を、Desktopの起動処理（composition・protocol・session・window）を通さずに行う。
 *
 * 呼んだ側はこのあとすぐapp.exitする。起動処理を進めてからexitすると、Chromiumが
 * protocol登録などを機に始めた子プロセス（network service）の起動をlauncher threadで
 * 走らせている最中にmainが後片付けを始め、SandboxWin::StartSandboxedProcessの中で
 * access violation（0xC0000005）になることがある（FAILURES.md 2026-11-09）。
 * そのため、子プロセスの起動を呼ぶものより前、app.whenReady()の直後で呼ぶ。
 */
export function runMcpPackageSmokeVerifyOnly<
  TPersistence extends McpPackageSmokePersistence & { db: { close(): void } },
>(openPersistence: () => TPersistence, options: McpPackageSmokeOptions): void {
  if (!options.enabled || !options.verifyOnly) {
    throw new Error("MCP package smokeのverify-only指定がありません。");
  }
  const repository = openPersistence();
  try {
    prepareMcpPackageSmokeData(repository, options);
  } finally {
    repository.db.close();
  }
}

export function applyMcpPackageSmokeUserData(
  options: McpPackageSmokeLaunchOptions,
  isPackaged: boolean,
  apply: (userDataPath: string) => void,
): boolean {
  if (options.enabled) {
    if (!isPackaged) throw new Error("MCP package smokeはpackaged Desktopでのみ使用できます。");
    apply(validateMcpPackageSmokeRoot(options));
    return true;
  }
  if (!options.userDataPath) return false;
  apply(path.resolve(options.userDataPath));
  return true;
}

function argumentValue(argv: string[], prefix: string): string | undefined {
  return argv.find((argument) => argument.startsWith(prefix))?.slice(prefix.length) || undefined;
}

export function readMcpPackageSmokeLaunchOptions(
  argv: string[],
  environment: NodeJS.ProcessEnv,
): McpPackageSmokeLaunchOptions {
  return {
    enabled: argv.includes("--mcp-package-smoke"),
    verifyOnly: argv.includes("--mcp-package-smoke-verify-only"),
    resultPath: argumentValue(argv, "--mcp-package-smoke-result-path="),
    proposalId: argumentValue(argv, "--mcp-package-smoke-proposal-id="),
    markerToken: argumentValue(argv, "--mcp-package-smoke-marker="),
    userDataPath: argumentValue(argv, "--user-data-dir="),
    environmentMarker: environment.TASKEN_MCP_PACKAGE_SMOKE_MARKER,
  };
}

/**
 * Canonical Desktop composition root for the workspace database, Task application
 * service, loopback Core host, and adapters that must share that same service.
 */
export class TaskenDesktopComposition<
  TPersistence extends DesktopPersistence = DesktopPersistence,
> {
  readonly repository: TPersistence;
  readonly applicationCommands: ApplicationCommandService;
  readonly coreRuntime: TaskenCoreRuntime;
  readonly mobileGateway: MobileGatewayRuntime;
  private readonly userDataPath: string;
  private readonly onCoreCommandCommitted?: TaskenDesktopCompositionOptions["onCoreCommandCommitted"];

  constructor(options: TaskenDesktopCompositionOptions<TPersistence>) {
    this.userDataPath = options.userDataPath;
    this.onCoreCommandCommitted = options.onCoreCommandCommitted;
    this.repository = options.persistence;
    this.applicationCommands = new ApplicationCommandService(this.repository);
    this.coreRuntime = new TaskenCoreRuntime(
      options.userDataPath,
      this.repository,
      (command) => {
        const receipt = this.applicationCommands.execute(command);
        options.onCoreCommandCommitted?.(receipt);
        return receipt;
      },
      options.onProposalCommitted,
      (command, currentContextFingerprint, responseMeta) =>
        this.applicationCommands.executeTaskDelegation(
          command,
          currentContextFingerprint,
          responseMeta,
        ),
      createNoteProposalImagePort(options.userDataPath, createNativeImageDecoder(nativeImage)),
      options.workLogWriter,
      createCaptureImagePort(options.userDataPath, createNativeImageDecoder(nativeImage)),
      {
        feedWriter: options.feedWriter,
        routineWriter: options.routineWriter,
        executeAiTaskStart: (command) => this.executeAiTaskStart(command),
      },
    );
    const mobileState: MobileGatewayStatePort = {
      current: () => this.repository.mobileGatewayState(),
    };
    this.mobileGateway = new MobileGatewayRuntime({
      adapter: this.coreRuntime.createMobileGateway(
        mobileState,
        undefined,
        options.getCaptureOrganizer,
      ),
      state: mobileState,
      persistence: this.repository,
    });
    this.prepareMcpPackageSmoke(options.mcpPackageSmoke);
  }

  /**
   * Desktopの開始もCoreの限定の入口を通す。AI Readyが本人の許可なので設定には依らず、
   * Themeと依頼者は問わない（仕事のTaskも開始できる）。作業中のTaskは取り直せない。
   */
  executeAiTaskStart(command: unknown) {
    const receipt = this.applicationCommands.executeAiTaskStart(command, "any");
    this.onCoreCommandCommitted?.(receipt);
    return receipt;
  }

  get taskCapability() {
    return this.coreRuntime.taskCapability;
  }

  createCoreClient() {
    return this.coreRuntime.createClient(this.userDataPath);
  }

  async start(): Promise<void> {
    await this.coreRuntime.start();
    await this.mobileGateway.start();
  }

  async stop(): Promise<void> {
    try {
      await this.mobileGateway.stop();
    } finally {
      await this.coreRuntime.stop();
    }
  }

  async stopSafely(onError: (error: unknown) => void): Promise<void> {
    try {
      await this.stop();
    } catch (error) {
      onError(error);
    }
  }

  private prepareMcpPackageSmoke(options?: McpPackageSmokeOptions): void {
    if (!options?.enabled) return;
    if (options.verifyOnly) {
      throw new Error("verify-onlyはrunMcpPackageSmokeVerifyOnlyで行います。");
    }
    prepareMcpPackageSmokeData(this.repository, options);
  }
}
