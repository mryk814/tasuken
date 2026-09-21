import { TaskenCoreHost } from "../infrastructure/http/taskenCoreHost.ts";
import { createMobileActivityReadPort } from "./mobileActivityReadPort.ts";
import { createMobileRelatedDocumentReadPort } from "./mobileRelatedDocumentReadPort.ts";
import { createMobileThemeContextReadPort } from "./mobileThemeContextReadPort.ts";
import { createMobileWorkLogPort, type WorkLogWriterPort } from "./mobileWorkLogPort.ts";
import type { NoteProposalImagePort } from "../core/public.ts";
import type { CaptureImagePort } from "../core/public.ts";
import type { NoteProposalImage } from "../../shared/contracts/task/public.ts";
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
  type MobileGatewayAgentReplyResult,
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
  restrictContentProposals,
  restrictRepositoryTaskProposals,
  type CoreProposalAccess,
} from "../core/public.ts";
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
  buildAgentDeskSummary,
  deriveAgentWorkState,
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

/**
 * 質問への回答の失敗（#601）。
 * 「すでに回答済み」と「Taskが変わった」はどちらも画面の再読み込みで解決するため、
 * 同じ競合として返し、Androidに再送を促さない。
 */
function agentReplyFailure(error: ApplicationCommandError): MobileGatewayAgentReplyResult {
  if (error.code === "COMMAND_ID_REUSED") return { ok: false, code: "idempotency_conflict" };
  if (error.code === "NOT_FOUND") return { ok: false, code: "not_found" };
  if (error.code === "CONFLICT" || error.code === "INVALID_TRANSITION") {
    return { ok: false, code: "entity_conflict" };
  }
  return { ok: false, code: "validation_failed" };
}

type PreparedImageCommand =
  | { ok: true; payload: Record<string, unknown>; rollback: () => void }
  | { ok: false; code: "validation_failed" };

/**
 * Mobile の base64 画像を Core の外側で stage し、Core へ渡すのは manifest
 * だけにする（change_event 肥大を避ける）。stage 済みファイルは Core 成功時
 * だけ残し、それ以外は rollback する（再送は決定的ファイル名で再利用）。
 * CreateCapture の capture、CreateTask の task が対象。
 */
function prepareCommandImages(
  port: CaptureImagePort | undefined,
  input: { name: string; payload: Record<string, unknown> },
): PreparedImageCommand {
  const noop = () => {};
  const ownerKey =
    input.name === "CreateCapture" ? "capture" : input.name === "CreateTask" ? "task" : null;
  if (!ownerKey) return { ok: true, payload: input.payload, rollback: noop };
  const owner: unknown = input.payload[ownerKey];
  if (!owner || typeof owner !== "object" || Array.isArray(owner)) {
    return { ok: true, payload: input.payload, rollback: noop };
  }
  const images: unknown = (owner as { images?: unknown }).images;
  if (images === undefined) return { ok: true, payload: input.payload, rollback: noop };
  const ownerId: unknown = (owner as { id?: unknown }).id;
  if (typeof ownerId !== "string" || !ownerId.trim()) {
    return { ok: false, code: "validation_failed" };
  }
  if (!port) return { ok: false, code: "validation_failed" };
  let staged: { manifest: readonly unknown[]; staged: unknown };
  try {
    staged = port.stage({ ownerId, images: images as readonly NoteProposalImage[] });
  } catch {
    return { ok: false, code: "validation_failed" };
  }
  const manifest = (Array.isArray(staged.manifest) ? staged.manifest : []).map((entry) => {
    const record = (entry || {}) as Record<string, unknown>;
    return {
      reference_id: record.reference_id,
      file_name: record.file_name,
      mime_type: record.mime_type,
      size: record.size,
      sha256: record.sha256,
      url: record.url,
    };
  });
  const state = staged.staged;
  return {
    ok: true,
    payload: {
      ...input.payload,
      [ownerKey]: { ...(owner as Record<string, unknown>), images: manifest },
    },
    rollback: () => port.rollback(state),
  };
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
    noteProposalImagePort?: NoteProposalImagePort,
    private readonly workLogWriter?: WorkLogWriterPort,
    private readonly captureImagePort?: CaptureImagePort,
    options: { proposalAccess?: CoreProposalAccess } = {},
  ) {
    this.persistence = persistence;
    this.executeApplicationCommand = executeApplicationCommand;
    const proposalAccess = options.proposalAccess || "full";
    // 常時稼働nodeでは、読み取りはそのままに書き込みだけを絞る。
    // capabilityを外した経路はMCP bridgeから見ても利用不可になり、
    // 種類単位の制限は実行時にWRITE_NOT_ALLOWEDで拒否する。
    const allowsProposals = proposalAccess !== "read-only";
    const restrictsProposals = proposalAccess === "proposals";
    const core = createTaskenCore(persistence, {
      onProposalCommitted,
      noteProposalImagePort,
      captureImagePort: this.captureImagePort,
    });
    this.taskContext = core.getTaskContext;
    this.executeTaskDelegation = executeTaskDelegation;
    this.taskCapability = new TaskCapabilityService(persistence, executeApplicationCommand);
    this.host = new TaskenCoreHost({
      userDataPath,
      taskQuery: { execute: this.taskCapability.executeQuery.bind(this.taskCapability) },
      // start_task_workはProposalではなく直接書き込みなので、書き込みを絞る配備では公開しない。
      ...(proposalAccess === "full"
        ? { taskCommand: { execute: this.taskCapability.executeCommand.bind(this.taskCapability) } }
        : {}),
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
      getCaptureImage: core.getCaptureImage,
      getTaskImage: core.getTaskImage,
      getActivityEntries: core.getActivityEntries,
      getThemeContext: core.getThemeContext,
      getRecentNotes: core.getRecentNotes,
      searchKnowledge: core.searchKnowledge,
      getKnowledgeContext: core.getKnowledgeContext,
      getPlanHealth: core.getPlanHealth,
      getKnowledgeHealth: core.getKnowledgeHealth,
      getActivity: core.getActivity,
      getContextSubgraph: core.getContextSubgraph,
      getFeedContext: core.getFeedContext,
      exportAiContext: core.exportAiContext,
      ...(allowsProposals
        ? {
            proposeRepositoryTask: restrictsProposals
              ? restrictRepositoryTaskProposals(core.proposeRepositoryTask)
              : core.proposeRepositoryTask,
            proposeContent: restrictsProposals
              ? restrictContentProposals(core.proposeContent)
              : core.proposeContent,
          }
        : {}),
      // Task作業報告とAgent Sessionは常時稼働nodeの受付対象外。
      ...(proposalAccess === "full"
        ? {
            proposeTaskWork: core.proposeTaskWork,
            proposeAgentSession: core.proposeAgentSession,
          }
        : {}),
    });
  }

  createClient(userDataPath: string): TaskenCoreClient {
    return new TaskenCoreClient({ userDataPath });
  }

  createMobileGateway(
    state: MobileGatewayStatePort,
    logger?: MobileGatewayLoggerPort,
    getCaptureOrganizer?: ConstructorParameters<
      typeof MobileGatewayAdapter
    >[0]["getCaptureOrganizer"],
  ): MobileGatewayAdapter {
    return new MobileGatewayAdapter({
      getCaptureOrganizer,
      core: {
        queryActivity: createMobileActivityReadPort(this.persistence),
        ...createMobileRelatedDocumentReadPort(this.persistence),
        getThemeContext: createMobileThemeContextReadPort(this.persistence),
        ...createMobileWorkLogPort(this.persistence, this.workLogWriter),
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
            color: typeof theme.color === "string" ? theme.color : null,
          })),
        listWorkReceipts: () => this.persistence.list("work_receipt", false).map(mobileWorkReceipt),
        readAttention: () => {
          const tasks = this.persistence.list("task", false);
          const summary = buildAgentDeskSummary({
            tasks,
            proposals: this.persistence.list("ai_proposal", false),
            receipts: this.persistence.list("work_receipt", false),
            themes: this.persistence.list("theme", false),
          });
          return {
            items: summary.attention,
            taskVersions: new Map(
              tasks
                .filter((task) => !task.deleted_at && Number.isInteger(Number(task.version)))
                .map((task) => [String(task.id), Number(task.version)] as const),
            ),
            working: summary.working,
            queued: summary.queued,
          };
        },
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
        replyToAgentRequest: (input) => {
          try {
            const receipt = this.executeApplicationCommand({
              commandId: input.commandId,
              name: "ReplyToAgentRequest",
              actor: { kind: "user", id: input.actorId },
              source: "mobile",
              issuedAt: input.issuedAt,
              payload: {
                taskId: input.taskId,
                requestId: input.questionId,
                body: input.body,
                ...(input.choiceId ? { choiceId: input.choiceId } : {}),
              },
              expectedVersions: [
                { type: "task", id: input.taskId, version: input.expectedTaskVersion },
              ],
            });
            if (receipt.status === "conflict") return { ok: false, code: "entity_conflict" };
            if (receipt.status !== "applied" && receipt.status !== "no_change") {
              throw new Error("Agent reply returned an unexpected command status");
            }
            const task = this.persistence.get("task", input.taskId, false);
            const state = task
              ? deriveAgentWorkState({
                  task,
                  proposals: this.persistence.list("ai_proposal", false),
                  receipts: this.persistence.list("work_receipt", false),
                })
              : null;
            // 回答はTaskを変えない。回答後に残る表示状態はDesktopと同じ導出から取る。
            if (!state) throw new Error("Agent reply receipt is missing its canonical Task");
            return {
              ok: true,
              commandId: receipt.commandId,
              status: receipt.status,
              taskId: state.taskId,
              taskVersion: Number(task?.version ?? 0),
              questionId: input.questionId,
              displayState: state.state,
            };
          } catch (error) {
            if (error instanceof ApplicationCommandError) return agentReplyFailure(error);
            throw error;
          }
        },
        executeTaskQuery: (input) => this.taskCapability.executeQuery(input),
        executeTaskCommand: (input) => {
          const record = (input || {}) as { name?: unknown; payload?: unknown };
          const prepared = prepareCommandImages(this.captureImagePort, {
            name: typeof record.name === "string" ? record.name : "",
            payload: (record.payload || {}) as Record<string, unknown>,
          });
          if (!prepared.ok) {
            return {
              ok: false as const,
              error: {
                code: "INVALID_COMMAND" as const,
                message: "Task画像をstageできませんでした。画像を確認して再送してください。",
                issues: [],
                retryable: false,
              },
            };
          }
          try {
            const result = this.taskCapability.executeCommand({
              ...(input as Record<string, unknown>),
              payload: prepared.payload,
            });
            if (!result.ok) prepared.rollback();
            return result;
          } catch (error) {
            prepared.rollback();
            throw error;
          }
        },
        executeCaptureCommand: (input) => {
          const prepared = prepareCommandImages(this.captureImagePort, {
            name: input.name,
            payload: (input.payload || {}) as Record<string, unknown>,
          });
          if (!prepared.ok) return { ok: false, code: prepared.code };
          try {
            const receipt = this.executeApplicationCommand({
              commandId: input.commandId,
              name: input.name,
              actor: { kind: "user", id: input.actorId },
              source: "mobile",
              issuedAt: input.issuedAt,
              payload: prepared.payload as unknown as ApplicationCommandPayload,
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
            if (receipt.status === "conflict") {
              prepared.rollback();
              return { ok: false, code: "entity_conflict" };
            }
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
            prepared.rollback();
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
    return this.host.start();
  }

  async stop() {
    await this.host.stop();
  }
}
