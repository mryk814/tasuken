import fs from "node:fs";
import path from "node:path";

import { validateMcpPackageSmokeRoot } from "../../shared/taskenPaths.mjs";
import { TaskenCoreRuntime } from "./taskenCoreRuntime.ts";
import { ApplicationCommandService } from "../services/applicationCommandService";
import {
  MobileGatewayRuntime,
  type MobileDevicePersistence,
  type MobileGatewayStatePort,
} from "../gateway/mobile/runtimePublic.ts";

type DesktopPersistence = ConstructorParameters<typeof TaskenCoreRuntime>[1] &
  ConstructorParameters<typeof ApplicationCommandService>[0] &
  MobileDevicePersistence & {
    mobileGatewayState(): ReturnType<MobileGatewayStatePort["current"]>;
    ensureMcpPackageSmokeFixture(): unknown;
    verifyMcpPackageSmokeProposal(id: string): unknown;
    db: { close(): void };
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
  private verifyOnlyCompleted = false;

  constructor(options: TaskenDesktopCompositionOptions<TPersistence>) {
    this.userDataPath = options.userDataPath;
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

  get taskCapability() {
    return this.coreRuntime.taskCapability;
  }

  get packageSmokeVerifyOnlyCompleted(): boolean {
    return this.verifyOnlyCompleted;
  }

  createCoreClient() {
    return this.coreRuntime.createClient(this.userDataPath);
  }

  async start(): Promise<void> {
    if (this.verifyOnlyCompleted) throw new Error("verify-only compositionは起動できません。");
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
    this.repository.ensureMcpPackageSmokeFixture();
    if (options.proposalId) {
      if (!/^[0-9a-f-]{36}$/i.test(options.proposalId)) {
        throw new Error("MCP package smoke Proposal IDが不正です。");
      }
      const verification = this.repository.verifyMcpPackageSmokeProposal(options.proposalId);
      if (options.resultPath) {
        fs.writeFileSync(path.resolve(options.resultPath), JSON.stringify(verification), {
          flag: "w",
        });
      }
    }
    if (options.verifyOnly) {
      this.repository.db.close();
      this.verifyOnlyCompleted = true;
    }
  }
}
