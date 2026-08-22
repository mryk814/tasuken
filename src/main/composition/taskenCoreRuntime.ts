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
  type MobileGatewayLoggerPort,
  type MobileGatewayStatePort,
} from "../gateway/mobile/public.ts";
import {
  TaskCapabilityService,
  type ExecuteApplicationCommand,
  type WorkspaceTaskPersistence,
} from "../modules/task/public.ts";
import { TaskenCoreClient } from "../mcp/taskenCoreClient.mjs";
import {
  TASKEN_CORE_API_VERSION,
  TASKEN_CORE_TASK_COMMAND_CAPABILITY,
  TASKEN_CORE_TASK_QUERY_CAPABILITY,
} from "../../shared/contracts/core/public.mjs";

type CorePersistence = AgentReadyTaskWorkspacePersistence
  & AgentWorkspacePersistence
  & TaskContextWorkspacePersistence
  & ItemQueryWorkspacePersistence
  & ContentDetailWorkspacePersistence
  & ActivityEntriesWorkspacePersistence
  & ThemeContextWorkspacePersistence
  & KnowledgeWorkspacePersistence
  & AgentContextWorkspacePersistence
  & WorkspaceTaskPersistence
  & AiProposalPersistence;

export class TaskenCoreRuntime {
  private readonly host: TaskenCoreHost;
  private readonly persistence: CorePersistence;
  readonly taskCapability: TaskCapabilityService;

  constructor(userDataPath: string, persistence: CorePersistence, executeApplicationCommand: ExecuteApplicationCommand) {
    this.persistence = persistence;
    const core = createTaskenCore(persistence);
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
      proposeRepositoryTask: core.proposeRepositoryTask,
      proposeContent: core.proposeContent,
    });
  }

  createClient(userDataPath: string): TaskenCoreClient {
    return new TaskenCoreClient({ userDataPath });
  }

  createMobileGateway(state: MobileGatewayStatePort, logger?: MobileGatewayLoggerPort): MobileGatewayAdapter {
    return new MobileGatewayAdapter({
      core: {
        status: async () => ({
          apiVersion: TASKEN_CORE_API_VERSION,
          capabilities: [TASKEN_CORE_TASK_QUERY_CAPABILITY, TASKEN_CORE_TASK_COMMAND_CAPABILITY],
        }),
        listThemes: () => this.persistence.list("theme", false).map((theme) => ({
          id: String(theme.id || ""),
          name: String(theme.name || ""),
        })),
        executeTaskQuery: (input) => this.taskCapability.executeQuery(input),
        executeTaskCommand: (input) => this.taskCapability.executeCommand(input),
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
