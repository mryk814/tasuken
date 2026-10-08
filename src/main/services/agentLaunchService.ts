import { realpath, stat } from "node:fs/promises";
import path from "node:path";
import { normalizeAiVisibility, projectEntityForAi } from "../../shared/aiMetadata.mjs";
import { validateAgentLaunchTask, type AgentLaunchRequest } from "../../shared/agentLaunch.ts";
import { launchTaskAgentProcess } from "./taskAgentProcess.ts";

interface Repository {
  get(type: "task" | "theme", id: string): Record<string, unknown> | null;
  getPreference(key: string): unknown;
}

const launchingTasks = new Set<string>();

export async function launchAgent(
  request: AgentLaunchRequest,
  repository: Repository,
  configJson: string,
  userDataPath: string,
  launch = launchTaskAgentProcess,
): Promise<void> {
  const taskId = request?.taskId;
  if (typeof taskId !== "string" || !taskId) throw new Error("タスクを選択してください。");
  if (launchingTasks.has(taskId))
    throw new Error("このタスクのAIは起動中です。しばらくお待ちください。");
  launchingTasks.add(taskId);
  try {
    await launchAgentOnce(request, repository, configJson, userDataPath, launch);
  } finally {
    launchingTasks.delete(taskId);
  }
}

async function launchAgentOnce(
  request: AgentLaunchRequest,
  repository: Repository,
  configJson: string,
  userDataPath: string,
  launch = launchTaskAgentProcess,
): Promise<void> {
  if (
    !request ||
    !["codex", "claude_code"].includes(request.clientId) ||
    typeof request.taskId !== "string"
  ) {
    throw new Error("AIとタスクを選択してください。");
  }
  if (
    typeof request.cwd !== "string" ||
    !path.isAbsolute(request.cwd) ||
    request.cwd.includes("\0")
  ) {
    throw new Error("作業フォルダの絶対パスを選択してください。");
  }
  let cwd: string;
  try {
    cwd = await realpath(request.cwd);
    if (!(await stat(cwd)).isDirectory()) throw new Error();
  } catch {
    throw new Error("作業フォルダが見つかりません。選び直してください。");
  }
  const task = repository.get("task", request.taskId);
  const workAttemptId = validateAgentLaunchTask(task, request.expectedVersion);
  const themeId = String(task!.project_id || task!.theme_id || "");
  const projected = projectEntityForAi("task", task, {
    audience: "coding_agent",
    theme: themeId ? repository.get("theme", themeId) : null,
    workspaceDefault: normalizeAiVisibility(repository.getPreference("aiVisibilityDefault")),
  });
  if (!projected.included)
    throw new Error("このタスクはAI公開範囲に含まれていません。公開範囲を確認してください。");
  await launch({
    clientId: request.clientId,
    cwd,
    taskId: request.taskId,
    workAttemptId,
    mcpConfigJson: configJson,
    userDataPath,
  });
}
