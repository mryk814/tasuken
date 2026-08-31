import fs from "node:fs/promises";
import path from "node:path";

import { normalizeAiVisibility, projectEntityForAi } from "../../shared/aiMetadata.mjs";
import { TASKEN_CORE_DISCOVERY_FILE } from "../../shared/contracts/core/public.mjs";
import {
  normalizeLocalRepositoryPath,
  resolveTaskRepositoryContexts,
} from "../../shared/repositoryContext.mjs";
import type {
  McpBridgeInfo,
  TaskAgentClientId,
  TaskAgentLaunchClient,
  TaskAgentLaunchOptions,
  TaskAgentLaunchOptionsRequest,
  TaskAgentLaunchRepository,
  TaskAgentLaunchRequest,
  TaskAgentLaunchResult,
} from "../../shared/ipc/contracts";

interface WorkspaceRepository {
  get(type: string, id: string, includeDeleted?: boolean): Record<string, unknown> | null;
  list(type: string, includeDeleted?: boolean): Array<Record<string, unknown>>;
  getPreference(key: string): unknown;
}

export interface TaskAgentProcess {
  getTaskAgentClients(): Promise<TaskAgentLaunchClient[]>;
  launchTaskAgentProcess(input: {
    clientId: TaskAgentClientId;
    cwd: string;
    taskId: string;
    mcpConfigJson: string;
    coreDiscoveryPath: string;
  }): Promise<void>;
}

export interface TaskAgentWorkStartInput {
  taskId: string;
  expectedTaskVersion: number;
  clientId: TaskAgentClientId;
  clientLabel: string;
}

export interface TaskAgentLaunchServiceOptions extends TaskAgentProcess {
  repository: WorkspaceRepository;
  userDataPath: string;
  getMcpBridgeInfo(): Promise<McpBridgeInfo>;
  startTaskAgentWork(input: TaskAgentWorkStartInput): Promise<void> | void;
}

interface LaunchableTask {
  task: Record<string, unknown>;
  repositories: Array<TaskAgentLaunchRepository & { cwd: string }>;
}

function requiredText(value: unknown, label: string): string {
  if (typeof value !== "string" || !value.trim()) throw new Error(`${label}を指定してください。`);
  return value.trim();
}

function expectedVersion(value: unknown): number {
  if (!Number.isInteger(value) || Number(value) < 1) {
    throw new Error("Taskのversionを確認して、もう一度開始してください。");
  }
  return Number(value);
}

function themeForTask(repository: WorkspaceRepository, task: Record<string, unknown>) {
  const themeId = String(task.project_id || task.theme_id || "");
  if (!themeId) return null;
  return repository.get("theme", themeId) || repository.get("project", themeId);
}

async function existingDirectory(localPath: string): Promise<string | null> {
  try {
    const resolved = normalizeLocalRepositoryPath(await fs.realpath(localPath));
    if (!resolved) return null;
    return (await fs.stat(resolved)).isDirectory() ? resolved : null;
  } catch {
    return null;
  }
}

export class TaskAgentLaunchService {
  constructor(private readonly options: TaskAgentLaunchServiceOptions) {}

  private async launchableTask(taskIdValue: unknown): Promise<LaunchableTask> {
    const taskId = requiredText(taskIdValue, "Task ID");
    const task = this.options.repository.get("task", taskId);
    if (!task || task.deleted_at) throw new Error("Taskが見つかりません。画面を更新してください。");
    if (task.state === "done" || task.state === "cancelled") {
      throw new Error("完了または中止済みのTaskは再開してから開始してください。");
    }
    if (
      ["reported_done", "needs_human_review", "accepted"].includes(
        String(task.work_state || "not_delegated"),
      )
    ) {
      throw new Error("確認待ちのTaskはAcceptまたは差戻しを先に行ってください。");
    }
    if (
      String(task.work_state || "not_delegated") === "in_progress" &&
      task.intended_executor !== "ai_agent"
    ) {
      throw new Error("AI以外が作業中のTaskは、その作業を終えてからAIへ委任してください。");
    }

    const theme = themeForTask(this.options.repository, task);
    const visibility = projectEntityForAi("task", task, {
      audience: "coding_agent",
      theme,
      workspaceDefault: normalizeAiVisibility(
        this.options.repository.getPreference("aiVisibilityDefault"),
      ),
    });
    if (!visibility.included) throw new Error("このTaskはAI公開範囲に含まれていません。");

    const contexts = this.options.repository
      .list("repository_context")
      .filter((context) => !context.deleted_at && context.active !== false);
    const resolution = resolveTaskRepositoryContexts({ task, theme, contexts }) as {
      contexts: Array<Record<string, unknown>>;
    };
    const repositories: Array<TaskAgentLaunchRepository & { cwd: string }> = [];
    for (const context of resolution.contexts) {
      const localPath = normalizeLocalRepositoryPath(context.local_path);
      if (!localPath) continue;
      const cwd = await existingDirectory(localPath);
      if (!cwd) continue;
      repositories.push({
        id: String(context.id),
        label: String(context.label || context.repository_slug || "Repository"),
        localPath,
        cwd,
      });
    }
    return { task, repositories };
  }

  async getTaskAgentLaunchOptions(
    request: TaskAgentLaunchOptionsRequest,
  ): Promise<TaskAgentLaunchOptions> {
    const { task, repositories } = await this.launchableTask(request?.taskId);
    return {
      clients: await this.options.getTaskAgentClients(),
      repositories: repositories.map(({ cwd, ...repository }) => ({
        ...repository,
        localPath: cwd,
      })),
      taskVersion: expectedVersion(task.version),
    };
  }

  async launchTaskAgent(request: TaskAgentLaunchRequest): Promise<TaskAgentLaunchResult> {
    const taskId = requiredText(request?.taskId, "Task ID");
    const repositoryContextId = requiredText(request?.repositoryContextId, "RepositoryContext");
    const [clients, bridge] = await Promise.all([
      this.options.getTaskAgentClients(),
      this.options.getMcpBridgeInfo(),
    ]);
    const { task, repositories } = await this.launchableTask(taskId);
    if (expectedVersion(request?.expectedTaskVersion) !== expectedVersion(task.version)) {
      throw new Error("Taskが別の画面で更新されました。画面を更新して、もう一度開始してください。");
    }
    const repository = repositories.find((candidate) => candidate.id === repositoryContextId);
    if (!repository) {
      throw new Error(
        "選択した作業先はこのTaskに関連付いていないか、フォルダーが見つかりません。作業先を確認して「選択肢を再読込」を押してください。",
      );
    }
    if (normalizeLocalRepositoryPath(request?.expectedLocalPath) !== repository.cwd) {
      throw new Error(
        "Repositoryの場所が変更されました。画面を更新して、もう一度開始してください。",
      );
    }

    const clientId = request?.clientId;
    const client = clients.find((candidate) => candidate.id === clientId);
    if (!client || !client.available) {
      throw new Error(
        client?.reason || "選択したAIを起動できません。インストール状態を確認してください。",
      );
    }
    if (bridge.coreStatus === "unavailable") {
      throw new Error(
        bridge.coreNextAction || "Tasken Coreへ接続できません。Taskenを起動し直してください。",
      );
    }
    await this.options.startTaskAgentWork({
      taskId,
      expectedTaskVersion: expectedVersion(task.version),
      clientId,
      clientLabel: client.label,
    });
    try {
      await this.options.launchTaskAgentProcess({
        clientId,
        cwd: repository.cwd,
        taskId,
        mcpConfigJson: bridge.configJson,
        coreDiscoveryPath: path.join(this.options.userDataPath, TASKEN_CORE_DISCOVERY_FILE),
      });
    } catch {
      throw new Error(
        "Taskenには作業開始を記録しましたが、AIの画面を開けませんでした。同じAIと作業先を選んで、もう一度起動してください。",
      );
    }
    return { clientLabel: client.label };
  }
}
