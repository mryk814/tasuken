import { execFile } from "node:child_process";
import { stat } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";

import type { TaskAgentClientId } from "../../shared/ipc/contracts";

const execFileAsync = promisify(execFile);
const clients = [
  { id: "claude_code", label: "Claude Code" },
  { id: "github_copilot", label: "GitHub Copilot" },
  { id: "codex", label: "Codex" },
] as const;

async function firstExecutable(candidates: string[]): Promise<string | undefined> {
  for (const candidate of candidates) {
    try {
      if ((await stat(candidate)).isFile()) return candidate;
    } catch (error) {
      if (!["ENOENT", "ENOTDIR"].includes((error as NodeJS.ErrnoException).code || "")) throw error;
    }
  }
  return undefined;
}

function executableCandidates(name: string): string[] {
  const searchPath =
    Object.entries(process.env).find(([key]) => key.toLowerCase() === "path")?.[1] || "";
  // Never search the Task's working directory or relative PATH entries.
  return searchPath
    .split(path.delimiter)
    .map((part) => part.replace(/^"|"$/g, ""))
    .filter((part) => path.isAbsolute(part))
    .map((part) => path.join(part, name));
}

async function findClient(clientId: TaskAgentClientId): Promise<string | undefined> {
  if (clientId === "github_copilot") return firstExecutable(executableCandidates("copilot.exe"));
  if (clientId === "codex") return firstExecutable(executableCandidates("codex.exe"));
  return firstExecutable([
    ...executableCandidates("claude.exe"),
    // Current Claude npm installation is a native executable behind an npm shim.
    ...executableCandidates("node_modules/@anthropic-ai/claude-code/bin/claude.exe"),
  ]);
}

function tomlString(value: unknown): string {
  return JSON.stringify(String(value));
}

function codexMcpServerConfig(mcpConfigJson: string): string {
  const tasken = JSON.parse(mcpConfigJson)?.mcpServers?.tasken as
    { command?: unknown; args?: unknown; env?: unknown } | undefined;
  if (!tasken || typeof tasken.command !== "string" || !Array.isArray(tasken.args)) {
    throw new Error("Codexへ渡すTasken MCP設定が不正です。");
  }
  const args = tasken.args.map(tomlString).join(", ");
  const env = Object.entries(tasken.env && typeof tasken.env === "object" ? tasken.env : {})
    .map(([key, value]) => `${tomlString(key)} = ${tomlString(value)}`)
    .join(", ");
  return [`command = ${tomlString(tasken.command)}`, `args = [${args}]`, `env = {${env}}`].join(
    ", ",
  );
}

export async function getTaskAgentClients() {
  const node =
    process.platform === "win32" && (await firstExecutable(executableCandidates("node.exe")));
  return Promise.all(
    clients.map(async (client) => {
      const available = Boolean(node && (await findClient(client.id)));
      return {
        ...client,
        available,
        ...(!available
          ? {
              reason:
                process.platform !== "win32"
                  ? "直接起動はWindows版に対応しています。依頼文のコピーを使ってください。"
                  : !node
                    ? "MCP接続にNode.jsが必要です。インストール後にTaskenを再起動してください。"
                    : `${client.label}のWindows版CLIが見つかりません。インストール後にTaskenを再起動してください。`,
            }
          : {}),
      };
    }),
  );
}

/** Quote one argv value for Windows CreateProcess/CRT, not for a shell. */
export function quoteWindowsArgument(value: string): string {
  return `"${value.replace(/(\\*)"/g, '$1$1\\"').replace(/(\\+)$/g, "$1$1")}"`;
}

export function buildTaskAgentArguments(
  clientId: TaskAgentClientId,
  taskId: string,
  mcpConfigJson: string,
): string[] {
  const prompt = [
    `TaskenのTask ID: ${taskId} の作業をお願いします。`,
    "まずTasken MCPでこのTaskと関連Contextを取得し、内容と作業先を確認してください。取得できなければ推測で作業せず、接続を確認してください。",
    "Tasken側でこのTaskのAI委任と作業開始は記録済みです。start_task_workは呼ばず、このTask IDをセッションと結果に関連付けて、そのまま作業を進めてください。",
    "途中経過・完了・ブロックはTasken MCPの既存のProposal / Work Receipt経路で報告し、人間の確認やTask完了を代行しないでください。",
  ].join("\n");
  if (clientId === "claude_code") return ["--mcp-config", mcpConfigJson, "--", prompt];
  if (clientId === "github_copilot") {
    return ["--additional-mcp-config", mcpConfigJson, "-i", prompt];
  }
  return ["-c", `mcp_servers.tasken={${codexMcpServerConfig(mcpConfigJson)}}`, prompt];
}

export function buildWindowsConsoleScript(executable: string, args: string[], cwd: string): string {
  const payload = Buffer.from(
    JSON.stringify({ executable, commandLine: args.map(quoteWindowsArgument).join(" "), cwd }),
    "utf8",
  ).toString("base64");
  // Only base64 data is interpolated. No user text is evaluated as PowerShell.
  return [
    "$ErrorActionPreference = 'Stop'",
    `$launch = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${payload}')) | ConvertFrom-Json`,
    "$child = Start-Process -FilePath $launch.executable -ArgumentList $launch.commandLine -WorkingDirectory $launch.cwd -WindowStyle Normal -PassThru",
    "if ($child.WaitForExit(500)) { throw 'The interactive CLI exited during startup.' }",
    "$child.Id",
  ].join("\n");
}

export async function launchTaskAgentProcess(input: {
  clientId: TaskAgentClientId;
  cwd: string;
  taskId: string;
  mcpConfigJson: string;
  coreDiscoveryPath: string;
}): Promise<void> {
  if (process.platform !== "win32")
    throw new Error("直接起動はWindows版に対応しています。依頼文のコピーを使ってください。");
  const [executable, node] = await Promise.all([
    findClient(input.clientId),
    firstExecutable(executableCandidates("node.exe")),
  ]);
  if (!executable || !node)
    throw new Error(
      "AIのCLIまたはNode.jsが見つかりません。インストール後にTaskenを再起動してください。",
    );

  const userDataPath = path.dirname(input.coreDiscoveryPath);
  const config = JSON.parse(input.mcpConfigJson);
  const tasken = config.mcpServers.tasken;
  tasken.command = node;
  tasken.env = { ...tasken.env, TASKEN_USER_DATA_DIR: userDataPath };
  if (input.clientId === "github_copilot") {
    tasken.type = "stdio";
    tasken.tools = ["*"];
  }
  const args = buildTaskAgentArguments(input.clientId, input.taskId, JSON.stringify(config));
  const script = buildWindowsConsoleScript(executable, args, input.cwd);
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    TASKEN_USER_DATA_DIR: userDataPath,
    TASKEN_AGENT_SESSION_TASK_IDS: input.taskId,
  };
  delete env.ELECTRON_RUN_AS_NODE;
  delete env.TASKEN_AGENT_SESSION_THEME_IDS;
  try {
    await execFileAsync(
      path.join(
        process.env.SystemRoot || "C:\\Windows",
        "System32/WindowsPowerShell/v1.0/powershell.exe",
      ),
      [
        "-NoLogo",
        "-NoProfile",
        "-NonInteractive",
        "-EncodedCommand",
        Buffer.from(script, "utf16le").toString("base64"),
      ],
      { shell: false, windowsHide: true, env, timeout: 10_000, maxBuffer: 16_384 },
    );
  } catch {
    // Native failure output can contain argv/context. Do not forward it to logs/UI.
    throw new Error(
      "AIの画面を開けませんでした。CLIと作業先を確認して、もう一度起動してください。",
    );
  }
}
