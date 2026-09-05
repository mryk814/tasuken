import { TaskenCoreHost } from "../infrastructure/http/taskenCoreHost.ts";
import {
  createTaskenCore,
  type AgentReadyTaskWorkspacePersistence,
  type AgentWorkspacePersistence,
  type TaskContextWorkspacePersistence,
  type ItemQueryWorkspacePersistence,
  type ContentDetailWorkspacePersistence,
  type ActivityEntriesWorkspacePersistence,
  type ThemeContextWorkspacePersistence,
  type KnowledgeWorkspacePersistence,
  type AgentContextWorkspacePersistence,
  type AiProposalPersistence,
} from "../infrastructure/sqlite/public.ts";
import {
  MobileGatewayAdapter,
  MOBILE_TASK_CONTEXT_INPUT,
  type MobileGatewayCaptureCommandResult,
  type MobileGatewayLoggerPort,
  type MobileGatewayStatePort,
  type MobileGatewayTaskDelegationResult,
  type MobileGatewayTaskWorkProposalDecisionResult,
  type MobileGatewayWorkReceiptRecord,
  taskContextFingerprint,
} from "../gateway/mobile/public.ts";
import {
  TaskCapabilityService,
  type ExecuteApplicationCommand,
  type WorkspaceTaskPersistence,
} from "../modules/task/public.ts";
import { TaskenCoreClient } from "../mcp/taskenCoreClient.mjs";
import {
  TASKEN_CORE_API_VERSION,
  TASKEN_CORE_GET_TASK_CONTEXT_CAPABILITY,
  TASKEN_CORE_TASK_COMMAND_CAPABILITY,
  TASKEN_CORE_TASK_QUERY_CAPABILITY,
} from "../../shared/contracts/core/public.mjs";
import {
  ApplicationCommandError,
  type ApplicationCommandPayload,
  type CommandReceipt,
} from "../../shared/applicationCommand.ts";
import {
  TASK_CONTRACT_SCHEMA_VERSION,
  taskIdSchema,
  taskReadModelSchema,
} from "../../shared/contracts/task/public.ts";
import {
  mobileResponseMetaSchema,
  type MobileResponseMeta,
} from "../../shared/contracts/mobile/public.ts";

type CorePersistence = AgentReadyTaskWorkspacePersistence &
  AgentWorkspacePersistence &
  TaskContextWorkspacePersistence &
  ItemQueryWorkspacePersistence &
  ContentDetailWorkspacePersistence &
  ActivityEntriesWorkspacePersistence &
  ThemeContextWorkspacePersistence &
  KnowledgeWorkspacePersistence &
  AgentContextWorkspacePersistence &
  WorkspaceTaskPersistence &
  AiProposalPersistence;

function mobileWorkReceipt(receipt: Record<string, unknown>): MobileGatewayWorkReceiptRecord {
  return {
    id: String(receipt.id || ""),
    taskId: String(receipt.task_id || ""),
    version: Number(receipt.version || 0),
    reportedAt: String(receipt.reported_at || ""),
    executorLabel: String(receipt.executor_label || ""),
    summary: String(receipt.summary || ""),
  };
}

function proposalDecisionFailure(
  error: ApplicationCommandError,
): MobileGatewayTaskWorkProposalDecisionResult {
  if (error.code === "COMMAND_ID_REUSED") return { ok: false, code: "idempotency_conflict" };
  if (error.code === "NOT_FOUND") return { ok: false, code: "not_found" };
  if (error.code === "CONFLICT" || error.code === "INVALID_TRANSITION") {
    return { ok: false, code: "proposal_conflict" };
  }
  return { ok: false, code: "validation_failed" };
}

function captureCommandFailure(error: ApplicationCommandError): MobileGatewayCaptureCommandResult {
  if (error.code === "COMMAND_ID_REUSED") return { ok: false, code: "idempotency_conflict" };
  if (error.code === "NOT_FOUND") return { ok: false, code: "not_found" };
  if (error.code === "CONFLICT" || error.code === "INVALID_TRANSITION") {
    return { ok: false, code: "entity_conflict" };
  }
  return { ok: false, code: "validation_failed" };
}

function delegationFailure(error: ApplicationCommandError): MobileGatewayTaskDelegationResult {
  if (error.code === "COMMAND_ID_REUSED") return { ok: false, code: "idempotency_conflict" };
  if (error.code === "NOT_FOUND") return { ok: false, code: "not_found" };
  if (error.code === "CONFLICT") {
    return {
      ok: false,
      code:
        error.details?.conflictReason === "context_stale" ? "context_stale" : "version_conflict",
    };
  }
  return { ok: false, code: "validation_failed" };
}

export class TaskenCoreRuntime {
  private readonly host: TaskenCoreHost;
  private readonly persistence: CorePersistence;
  private readonly executeApplicationCommand: ExecuteApplicationCommand;
  private readonly taskContext: ReturnType<typeof createTaskenCore>["getTaskContext"];
  private readonly executeTaskDelegation?: (
    command: unknown,
    currentContextFingerprint: () => string,
    responseMeta: MobileResponseMeta,
  ) => CommandReceipt;
  readonly taskCapability: TaskCapabilityService;

  constructor(
    userDataPath: string,
    persistence: CorePersistence,
    executeApplicationCommand: ExecuteApplicationCommand,
    onProposalCommitted?: NonNullable<
      Parameters<typeof createTaskenCore>[1]
    >["onProposalCommitted"],
    executeTaskDelegation?: (
      command: unknown,
      currentContextFingerprint: () => string,
      responseMeta: MobileResponseMeta,
    ) => CommandReceipt,
  ) {
    this.persistence = persistence;
    this.executeApplicationCommand = executeApplicationCommand;
    const core = createTaskenCore(persistence, { onProposalCommitted });
    this.taskContext = core.getTaskContext;
    this.executeTaskDelegation = executeTaskDelegation;
    this.taskCapability = new TaskCapabilityService(persistence, executeApplicationCommand);
    this.host = new TaskenCoreHost({
      userDataPath,
      taskQuery: { execute: this.taskCapability.executeQuery.bind(this.taskCapability) },
      taskCommand: { execute: this.taskCapability.executeCommand.bind(this.taskCapability) },
      listAgentReadyTasks: core.listAgentReadyTasks,
      resolveRepositoryContext: core.resolveRepositoryContext,
      findTasksForRepository: core.findTasksForRepository,
      findThemesForRepository: core.findThemesForRepository,
      getRepositoryContext: core.getRepositoryContext,
      getAgentSessionContext: core.getAgentSessionContext,
      getTaskAssignment: core.getTaskAssignment,
      getTaskContext: core.getTaskContext,
      searchItems: core.searchItems,
      listOpenItems: core.listOpenItems,
      getNote: core.getNote,
      getConversation: core.getConversation,
      getArtifactMetadata: core.getArtifactMetadata,
      getActivityEntries: core.getActivityEntries,
      getThemeContext: core.getThemeContext,
      getRecentNotes: core.getRecentNotes,
      searchKnowledge: core.searchKnowledge,
      getKnowledgeContext: core.getKnowledgeContext,
      getPlanHealth: core.getPlanHealth,
      getKnowledgeHealth: core.getKnowledgeHealth,
      getActivity: core.getActivity,
      getContextSubgraph: core.getContextSubgraph,
      exportAiContext: core.exportAiContext,
      proposeTaskWork: core.proposeTaskWork,
      proposeAgentSession: core.proposeAgentSession,
      proposeRepositoryTask: core.proposeRepositoryTask,
      proposeContent: core.proposeContent,
    });
  }

  createClient(userDataPath: string): TaskenCoreClient {
    return new TaskenCoreClient({ userDataPath });
  }

  createMobileGateway(
    state: MobileGatewayStatePort,
    logger?: MobileGatewayLoggerPort,
    getCaptureOrganizer?: ConstructorParameters<typeof MobileGatewayAdapter>[0]["getCaptureOrganizer"],
  ): MobileGatewayAdapter {
    return new MobileGatewayAdapter({
      getCaptureOrganizer,
      core: {
        status: async () => ({
          apiVersion: TASKEN_CORE_API_VERSION,
          capabilities: [
            TASKEN_CORE_TASK_QUERY_CAPABILITY,
            TASKEN_CORE_TASK_COMMAND_CAPABILITY,
            TASKEN_CORE_GET_TASK_CONTEXT_CAPABILITY,
          ],
        }),
        listThemes: () =>
          this.persistence.list("theme", false).map((theme) => ({
            id: String(theme.id || ""),
            name: String(theme.name || ""),
          })),
        listWorkReceipts: () => this.persistence.list("work_receipt", false).map(mobileWorkReceipt),
        getWorkReceipt: (id) => {
          const receipt = this.persistence.get("work_receipt", id, false);
          if (!receipt) return null;
          return {
            id: String(receipt.id || ""),
            taskId: String(receipt.task_id || ""),
            version: Number(receipt.version || 0),
            executorKind: String(receipt.executor_kind || "unknown"),
            executorLabel: String(receipt.executor_label || ""),
            startedAt: receipt.started_at ? String(receipt.started_at) : null,
            reportedAt: String(receipt.reported_at || ""),
            summary: String(receipt.summary || ""),
            completedItems: receipt.completed_items,
            changedOrCreatedItems: receipt.changed_or_created_items,
            verification: receipt.verification,
            remainingWork: receipt.remaining_work,
            externalReferences: receipt.external_references,
            runtimeMetadata: receipt.runtime_metadata,
          };
        },
        listTaskWorkProposals: () =>
          this.persistence
            .list("ai_proposal", false)
            .filter(
              (proposal) =>
                proposal.source === "mcp" &&
                proposal.payload_type === "task_work" &&
                proposal.status === "pending",
            )
            .map((proposal) => ({
              id: String(proposal.id || ""),
              version: Number(proposal.version || 0),
              source: String(proposal.source || ""),
              sourceApp: String(proposal.source_app || ""),
              payloadType: String(proposal.payload_type || ""),
              payload: proposal.payload,
              request: proposal.request,
              status: String(proposal.status || ""),
              receivedAt: String(proposal.received_at || ""),
            })),
        getTaskWorkProposal: (id) => {
          const proposal = this.persistence.get("ai_proposal", id, true);
          if (!proposal || proposal.source !== "mcp" || proposal.payload_type !== "task_work")
            return null;
          return {
            id: String(proposal.id || ""),
            version: Number(proposal.version || 0),
            source: String(proposal.source || ""),
            sourceApp: String(proposal.source_app || ""),
            payloadType: String(proposal.payload_type || ""),
            payload: proposal.payload,
            request: proposal.request,
            status: String(proposal.status || ""),
            receivedAt: String(proposal.received_at || ""),
          };
        },
        decideTaskWorkProposal: (input) => {
          try {
            const receipt = this.executeApplicationCommand({
              commandId: input.commandId,
              name: "ApplyTaskWorkProposal",
              actor: { kind: "user", id: input.actorId },
              source: "mobile",
              issuedAt: input.issuedAt,
              payload: { proposalId: input.proposalId, decision: input.decision },
              expectedVersions: [
                {
                  type: "ai_proposal",
                  id: input.proposalId,
                  version: input.expectedProposalVersion,
                },
                { type: "task", id: input.taskId, version: input.expectedTaskVersion },
              ],
            });
            if (receipt.status === "conflict") return { ok: false, code: "proposal_conflict" };
            return { ok: true, commandId: receipt.commandId, status: receipt.status };
          } catch (error) {
            if (error instanceof ApplicationCommandError) return proposalDecisionFailure(error);
            throw error;
          }
        },
        executeTaskQuery: (input) => this.taskCapability.executeQuery(input),
        executeTaskCommand: (input) => this.taskCapability.executeCommand(input),
        executeCaptureCommand: (input) => {
          try {
            const receipt = this.executeApplicationCommand({
              commandId: input.commandId,
              name: input.name,
              actor: { kind: "user", id: input.actorId },
              source: "mobile",
              issuedAt: input.issuedAt,
              payload: input.payload as unknown as ApplicationCommandPayload,
              expectedVersions:
                input.name === "DeleteCapture"
                  ? [
                      {
                        type: "capture_entry",
                        id: String(input.payload.captureId || ""),
                        version: Number(input.expectedVersion),
                      },
                    ]
                  : [],
            });
            if (receipt.status === "conflict") return { ok: false, code: "entity_conflict" };
            const capture = receipt.changes.find(
              (change) => change.type === "capture_entry",
            )?.entity;
            if (
              !capture ||
              typeof capture.id !== "string" ||
              !Number.isInteger(Number(capture.version)) ||
              Number(capture.version) <= 0 ||
              typeof capture.captured_at !== "string"
            ) {
              throw new Error("Capture command receipt is missing its canonical Capture");
            }
            return {
              ok: true,
              commandId: receipt.commandId,
              status: receipt.status,
              capture: {
                id: capture.id,
                version: Number(capture.version),
                capturedAt: capture.captured_at,
                deleted: input.name === "DeleteCapture",
              },
            };
          } catch (error) {
            if (error instanceof ApplicationCommandError) return captureCommandFailure(error);
            throw error;
          }
        },
        getTaskContext: (input) =>
          this.taskContext.execute(input as Parameters<typeof this.taskContext.execute>[0]),
        delegateTaskToAgent: (input) => {
          if (!this.executeTaskDelegation) return { ok: false, code: "validation_failed" };
          const command = {
            commandId: input.commandId,
            name: "DelegateTaskToAgent",
            actor: { kind: "user", id: input.actorId },
            source: "mobile",
            issuedAt: input.issuedAt,
            payload: {
              taskId: input.taskId,
              agent: input.agent,
              ...(input.expectedResult ? { expectedResult: input.expectedResult } : {}),
              ...(input.instruction ? { instruction: input.instruction } : {}),
              contextFingerprint: input.contextFingerprint,
            },
            expectedVersions: [
              { type: "task", id: input.taskId, version: input.expectedTaskVersion },
            ],
          };
          try {
            const receipt = this.executeTaskDelegation(
              command,
              () =>
                taskContextFingerprint(
                  this.taskContext.execute({
                    task_id: taskIdSchema.parse(input.taskId),
                    ...MOBILE_TASK_CONTEXT_INPUT,
                  }),
                ),
              input.responseMeta,
            );
            if (receipt.status === "conflict") {
              throw new Error("Task delegation returned an unclassified conflict receipt");
            }
            const taskSnapshot = taskReadModelSchema.safeParse(receipt.resultSnapshot?.task);
            const responseMeta = mobileResponseMetaSchema.safeParse(
              receipt.resultSnapshot?.responseMeta,
            );
            const latestWorkReceipt = receipt.resultSnapshot?.latestWorkReceipt;
            if (!taskSnapshot.success || taskSnapshot.data.id !== input.taskId) {
              throw new Error("Task delegation receipt is missing its canonical Task snapshot");
            }
            if (!responseMeta.success) {
              throw new Error("Task delegation receipt is missing its immutable response metadata");
            }
            if (
              latestWorkReceipt !== null &&
              (!latestWorkReceipt || latestWorkReceipt.task_id !== input.taskId)
            ) {
              throw new Error("Task delegation receipt has an invalid Work Receipt snapshot");
            }
            return {
              ok: true,
              commandId: receipt.commandId,
              status: receipt.status,
              task: taskSnapshot.data,
              latestWorkReceipt: latestWorkReceipt ? mobileWorkReceipt(latestWorkReceipt) : null,
              responseMeta: responseMeta.data,
            };
          } catch (error) {
            if (error instanceof ApplicationCommandError) return delegationFailure(error);
            throw error;
          }
        },
      },
      state,
      logger,
    });
  }

  async start() {
    await this.host.start();
  }

  async stop() {
    await this.host.stop();
  }
}
