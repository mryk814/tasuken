import fs from "node:fs/promises";
import path from "node:path";

import { resolveTaskenUserDataPath } from "../../shared/taskenPaths.mjs";
import {
  findThemesForRepositoryResponseSchema,
  getActivityEntriesResponseSchema,
  getArtifactMetadataResponseSchema,
  getConversationResponseSchema,
  getNoteResponseSchema,
  getRepositoryContextResponseSchema,
  getAgentSessionContextResponseSchema,
  getThemeContextResponseSchema,
  getRecentNotesResponseSchema,
  searchKnowledgeResponseSchema,
  getKnowledgeContextResponseSchema,
  getPlanHealthResponseSchema,
  getKnowledgeHealthResponseSchema,
  getActivityResponseSchema,
  getContextSubgraphResponseSchema,
  exportAiContextResponseSchema,
  proposeTaskWorkResponseSchema,
  proposeAgentSessionResponseSchema,
  proposeRepositoryTaskResponseSchema,
  proposeContentResponseSchema,
  taskCommandResponseSchema,
  taskQueryResponseSchema,
} from "../../shared/contracts/task/public.ts";
import {
  TASKEN_CORE_API_VERSION,
  TASKEN_CORE_FIND_TASKS_FOR_REPOSITORY_CAPABILITY,
  TASKEN_CORE_FIND_THEMES_FOR_REPOSITORY_CAPABILITY,
  TASKEN_CORE_GET_REPOSITORY_CONTEXT_CAPABILITY,
  TASKEN_CORE_GET_AGENT_SESSION_CONTEXT_CAPABILITY,
  TASKEN_CORE_GET_TASK_ASSIGNMENT_CAPABILITY,
  TASKEN_CORE_GET_TASK_CONTEXT_CAPABILITY,
  TASKEN_CORE_GET_ACTIVITY_ENTRIES_CAPABILITY,
  TASKEN_CORE_GET_THEME_CONTEXT_CAPABILITY,
  TASKEN_CORE_GET_ARTIFACT_METADATA_CAPABILITY,
  TASKEN_CORE_GET_CONVERSATION_CAPABILITY,
  TASKEN_CORE_GET_NOTE_CAPABILITY,
  TASKEN_CORE_GET_RECENT_NOTES_CAPABILITY,
  TASKEN_CORE_SEARCH_KNOWLEDGE_CAPABILITY,
  TASKEN_CORE_GET_KNOWLEDGE_CONTEXT_CAPABILITY,
  TASKEN_CORE_GET_PLAN_HEALTH_CAPABILITY,
  TASKEN_CORE_GET_KNOWLEDGE_HEALTH_CAPABILITY,
  TASKEN_CORE_GET_ACTIVITY_CAPABILITY,
  TASKEN_CORE_GET_CONTEXT_SUBGRAPH_CAPABILITY,
  TASKEN_CORE_EXPORT_AI_CONTEXT_CAPABILITY,
  TASKEN_CORE_PROPOSE_TASK_WORK_CAPABILITY,
  TASKEN_CORE_PROPOSE_AGENT_SESSION_CAPABILITY,
  TASKEN_CORE_PROPOSE_REPOSITORY_TASK_CAPABILITY,
  TASKEN_CORE_PROPOSE_CONTENT_CAPABILITY,
  TASKEN_CORE_LIST_OPEN_ITEMS_CAPABILITY,
  TASKEN_CORE_LIST_AGENT_READY_TASKS_CAPABILITY,
  TASKEN_CORE_RESOLVE_REPOSITORY_CONTEXT_CAPABILITY,
  TASKEN_CORE_SEARCH_ITEMS_CAPABILITY,
  TASKEN_CORE_DISCOVERY_FILE,
  TASKEN_CORE_DISCOVERY_SCHEMA_VERSION,
  TASKEN_CORE_TASK_COMMAND_CAPABILITY,
  TASKEN_CORE_TASK_QUERY_CAPABILITY,
  taskenCorePublicError,
} from "../../shared/contracts/core/public.mjs";

export const TASKEN_CORE_CLIENT_TIMEOUT_MS = 5_000;
export const TASKEN_CORE_IMAGE_PROPOSAL_TIMEOUT_MS = 30_000;

export const TASKEN_MCP_REQUIRED_CORE_CAPABILITIES = Object.freeze([
  TASKEN_CORE_SEARCH_ITEMS_CAPABILITY,
  TASKEN_CORE_LIST_OPEN_ITEMS_CAPABILITY,
  TASKEN_CORE_LIST_AGENT_READY_TASKS_CAPABILITY,
  TASKEN_CORE_GET_TASK_ASSIGNMENT_CAPABILITY,
  TASKEN_CORE_GET_TASK_CONTEXT_CAPABILITY,
  TASKEN_CORE_GET_NOTE_CAPABILITY,
  TASKEN_CORE_GET_CONVERSATION_CAPABILITY,
  TASKEN_CORE_GET_ARTIFACT_METADATA_CAPABILITY,
  TASKEN_CORE_GET_ACTIVITY_ENTRIES_CAPABILITY,
  TASKEN_CORE_RESOLVE_REPOSITORY_CONTEXT_CAPABILITY,
  TASKEN_CORE_FIND_THEMES_FOR_REPOSITORY_CAPABILITY,
  TASKEN_CORE_FIND_TASKS_FOR_REPOSITORY_CAPABILITY,
  TASKEN_CORE_GET_REPOSITORY_CONTEXT_CAPABILITY,
  TASKEN_CORE_GET_AGENT_SESSION_CONTEXT_CAPABILITY,
  TASKEN_CORE_GET_THEME_CONTEXT_CAPABILITY,
  TASKEN_CORE_GET_RECENT_NOTES_CAPABILITY,
  TASKEN_CORE_SEARCH_KNOWLEDGE_CAPABILITY,
  TASKEN_CORE_GET_KNOWLEDGE_CONTEXT_CAPABILITY,
  TASKEN_CORE_GET_PLAN_HEALTH_CAPABILITY,
  TASKEN_CORE_GET_KNOWLEDGE_HEALTH_CAPABILITY,
  TASKEN_CORE_GET_ACTIVITY_CAPABILITY,
  TASKEN_CORE_GET_CONTEXT_SUBGRAPH_CAPABILITY,
  TASKEN_CORE_EXPORT_AI_CONTEXT_CAPABILITY,
  TASKEN_CORE_PROPOSE_TASK_WORK_CAPABILITY,
  TASKEN_CORE_PROPOSE_AGENT_SESSION_CAPABILITY,
  TASKEN_CORE_PROPOSE_REPOSITORY_TASK_CAPABILITY,
  TASKEN_CORE_PROPOSE_CONTENT_CAPABILITY,
  TASKEN_CORE_TASK_COMMAND_CAPABILITY,
]);

export class TaskenCoreClientError extends Error {
  constructor(code, message, options = {}) {
    super(message, options);
    this.name = "TaskenCoreClientError";
    this.code = code;
    this.status = options.status;
    this.details = options.details;
    const guidance = taskenCorePublicError(code, message, options);
    this.retryable = guidance.retryable;
    this.next_action = guidance.next_action;
  }

  toPublicError() {
    return taskenCorePublicError(this.code, this.message, {
      status: this.status,
      details: this.details,
      retryable: this.retryable,
      next_action: this.next_action,
    });
  }
}

export function taskenCoreDiscoveryPath(options = {}) {
  const userDataPath = options.userDataPath || resolveTaskenUserDataPath(options);
  return path.join(userDataPath, TASKEN_CORE_DISCOVERY_FILE);
}

function parseDiscovery(value) {
  if (!value || typeof value !== "object")
    throw new TaskenCoreClientError("INVALID_DISCOVERY", "Tasken Core discoveryが不正です。");
  if (value.schema_version !== TASKEN_CORE_DISCOVERY_SCHEMA_VERSION) {
    throw new TaskenCoreClientError(
      "INVALID_DISCOVERY",
      "Tasken Core discovery versionが不正です。",
    );
  }
  if (value.api_version !== TASKEN_CORE_API_VERSION) {
    throw new TaskenCoreClientError("VERSION_MISMATCH", "Tasken Core API versionが一致しません。");
  }
  if (
    !Array.isArray(value.capabilities) ||
    value.capabilities.some((capability) => typeof capability !== "string")
  ) {
    throw new TaskenCoreClientError("INVALID_DISCOVERY", "Tasken Core capabilitiesが不正です。");
  }
  let origin;
  try {
    origin = typeof value.origin === "string" ? new URL(value.origin) : null;
  } catch {
    origin = null;
  }
  const port = Number(origin?.port);
  if (
    !origin ||
    origin.protocol !== "http:" ||
    origin.hostname !== "127.0.0.1" ||
    origin.pathname !== "/" ||
    origin.search ||
    origin.hash ||
    !Number.isInteger(port) ||
    port < 1 ||
    port > 65_535
  ) {
    throw new TaskenCoreClientError("INVALID_DISCOVERY", "Tasken Core originが不正です。");
  }
  const token =
    typeof value.token === "string" && /^[A-Za-z0-9_-]{43}$/.test(value.token)
      ? Buffer.from(value.token, "base64url")
      : null;
  if (!token || token.length !== 32 || token.toString("base64url") !== value.token) {
    throw new TaskenCoreClientError("INVALID_DISCOVERY", "Tasken Core credentialが不正です。");
  }
  return value;
}

async function readDiscovery(discoveryPath) {
  let handle;
  try {
    const linkStat = await fs.lstat(discoveryPath);
    if (linkStat.isSymbolicLink()) {
      throw new TaskenCoreClientError(
        "INVALID_DISCOVERY",
        "Tasken Core discoveryにsymlinkは使用できません。",
      );
    }
    handle = await fs.open(discoveryPath, "r");
    const stat = await handle.stat();
    if (linkStat.dev !== stat.dev || linkStat.ino !== stat.ino) {
      throw new TaskenCoreClientError(
        "INVALID_DISCOVERY",
        "Tasken Core discoveryが読み取り中に変更されました。",
      );
    }
    if (typeof process.getuid === "function") {
      if (stat.uid !== process.getuid()) {
        throw new TaskenCoreClientError(
          "DISCOVERY_OWNER_MISMATCH",
          "Tasken Core discoveryの所有者が一致しません。",
        );
      }
      if ((stat.mode & 0o077) !== 0) {
        throw new TaskenCoreClientError(
          "DISCOVERY_PERMISSION_INVALID",
          "Tasken Core discoveryの権限が安全ではありません。",
        );
      }
    }
    if (stat.size > 8 * 1024) {
      throw new TaskenCoreClientError("INVALID_DISCOVERY", "Tasken Core discoveryが大きすぎます。");
    }
    return parseDiscovery(JSON.parse(await handle.readFile("utf8")));
  } catch (error) {
    if (error instanceof TaskenCoreClientError) throw error;
    throw new TaskenCoreClientError(
      "CORE_UNAVAILABLE",
      "Tasken Coreへ接続できません。Taskenを起動してください。",
      { cause: error },
    );
  } finally {
    await handle?.close();
  }
}

export class TaskenCoreClient {
  constructor(options = {}) {
    this.discoveryPath = options.discoveryPath || taskenCoreDiscoveryPath(options);
    this.timeoutMs = options.timeoutMs || TASKEN_CORE_CLIENT_TIMEOUT_MS;
    this.fetch = options.fetch || globalThis.fetch;
  }

  async listAgentReadyTasks(request = {}) {
    return this.query(
      "list-agent-ready-tasks",
      TASKEN_CORE_LIST_AGENT_READY_TASKS_CAPABILITY,
      request,
    );
  }

  async resolveRepositoryContext(request = {}) {
    return this.query(
      "resolve-repository-context",
      TASKEN_CORE_RESOLVE_REPOSITORY_CONTEXT_CAPABILITY,
      request,
    );
  }

  async findTasksForRepository(request = {}) {
    return this.query(
      "find-tasks-for-repository",
      TASKEN_CORE_FIND_TASKS_FOR_REPOSITORY_CAPABILITY,
      request,
    );
  }

  async findThemesForRepository(request = {}) {
    return this.query(
      "find-themes-for-repository",
      TASKEN_CORE_FIND_THEMES_FOR_REPOSITORY_CAPABILITY,
      request,
      findThemesForRepositoryResponseSchema,
    );
  }

  async getRepositoryContext(request = {}) {
    return this.query(
      "get-repository-context",
      TASKEN_CORE_GET_REPOSITORY_CONTEXT_CAPABILITY,
      request,
      getRepositoryContextResponseSchema,
    );
  }

  async getTaskAssignment(request = {}) {
    return this.query("get-task-assignment", TASKEN_CORE_GET_TASK_ASSIGNMENT_CAPABILITY, request);
  }

  async getTaskContext(request = {}) {
    return this.query("get-task-context", TASKEN_CORE_GET_TASK_CONTEXT_CAPABILITY, request);
  }

  async searchItems(request = {}) {
    return this.query("search-items", TASKEN_CORE_SEARCH_ITEMS_CAPABILITY, request);
  }

  async listOpenItems(request = {}) {
    return this.query("list-open-items", TASKEN_CORE_LIST_OPEN_ITEMS_CAPABILITY, request);
  }

  async getNote(request = {}) {
    return this.query("get-note", TASKEN_CORE_GET_NOTE_CAPABILITY, request, getNoteResponseSchema);
  }

  async getConversation(request = {}) {
    return this.query(
      "get-conversation",
      TASKEN_CORE_GET_CONVERSATION_CAPABILITY,
      request,
      getConversationResponseSchema,
    );
  }

  async getArtifactMetadata(request = {}) {
    return this.query(
      "get-artifact-metadata",
      TASKEN_CORE_GET_ARTIFACT_METADATA_CAPABILITY,
      request,
      getArtifactMetadataResponseSchema,
    );
  }

  async getActivityEntries(request = {}) {
    return this.query(
      "get-activity-entries",
      TASKEN_CORE_GET_ACTIVITY_ENTRIES_CAPABILITY,
      request,
      getActivityEntriesResponseSchema,
    );
  }

  async getThemeContext(request = {}) {
    return this.query(
      "get-theme-context",
      TASKEN_CORE_GET_THEME_CONTEXT_CAPABILITY,
      request,
      getThemeContextResponseSchema,
    );
  }

  async getRecentNotes(request = {}) {
    return this.query(
      "get-recent-notes",
      TASKEN_CORE_GET_RECENT_NOTES_CAPABILITY,
      request,
      getRecentNotesResponseSchema,
    );
  }

  async searchKnowledge(request = {}) {
    return this.query(
      "search-knowledge",
      TASKEN_CORE_SEARCH_KNOWLEDGE_CAPABILITY,
      request,
      searchKnowledgeResponseSchema,
    );
  }

  async getKnowledgeContext(request = {}) {
    return this.query(
      "get-knowledge-context",
      TASKEN_CORE_GET_KNOWLEDGE_CONTEXT_CAPABILITY,
      request,
      getKnowledgeContextResponseSchema,
    );
  }

  async getPlanHealth(request = {}) {
    return this.query(
      "get-plan-health",
      TASKEN_CORE_GET_PLAN_HEALTH_CAPABILITY,
      request,
      getPlanHealthResponseSchema,
    );
  }

  async getKnowledgeHealth(request = {}) {
    return this.query(
      "get-knowledge-health",
      TASKEN_CORE_GET_KNOWLEDGE_HEALTH_CAPABILITY,
      request,
      getKnowledgeHealthResponseSchema,
    );
  }

  async getActivity(request = {}) {
    return this.query(
      "get-activity",
      TASKEN_CORE_GET_ACTIVITY_CAPABILITY,
      request,
      getActivityResponseSchema,
    );
  }

  async getContextSubgraph(request = {}) {
    return this.query(
      "get-context-subgraph",
      TASKEN_CORE_GET_CONTEXT_SUBGRAPH_CAPABILITY,
      request,
      getContextSubgraphResponseSchema,
    );
  }

  async exportAiContext(request = {}) {
    return this.query(
      "export-ai-context",
      TASKEN_CORE_EXPORT_AI_CONTEXT_CAPABILITY,
      request,
      exportAiContextResponseSchema,
    );
  }

  async proposeTaskWork(request = {}) {
    return this.request(
      "/v1/commands/propose-task-work",
      TASKEN_CORE_PROPOSE_TASK_WORK_CAPABILITY,
      request,
      proposeTaskWorkResponseSchema,
      "propose-task-work",
    );
  }

  async getAgentSessionContext(request = {}) {
    return this.query(
      "get-agent-session-context",
      TASKEN_CORE_GET_AGENT_SESSION_CONTEXT_CAPABILITY,
      request,
      getAgentSessionContextResponseSchema,
    );
  }

  async proposeAgentSession(request = {}) {
    return this.request(
      "/v1/commands/propose-agent-session",
      TASKEN_CORE_PROPOSE_AGENT_SESSION_CAPABILITY,
      request,
      proposeAgentSessionResponseSchema,
      "propose-agent-session",
    );
  }

  async proposeRepositoryTask(request = {}) {
    return this.request(
      "/v1/commands/propose-repository-task",
      TASKEN_CORE_PROPOSE_REPOSITORY_TASK_CAPABILITY,
      request,
      proposeRepositoryTaskResponseSchema,
      "propose-repository-task",
    );
  }

  async proposeContent(request = {}) {
    const hasImages = Array.isArray(request.images) && request.images.length > 0;
    const extraHeaders = hasImages ? { "x-tasken-proposal-images": "1" } : {};
    return this.request(
      "/v1/commands/propose-content",
      TASKEN_CORE_PROPOSE_CONTENT_CAPABILITY,
      request,
      proposeContentResponseSchema,
      "propose-content",
      extraHeaders,
      hasImages ? Math.max(this.timeoutMs, TASKEN_CORE_IMAGE_PROPOSAL_TIMEOUT_MS) : this.timeoutMs,
    );
  }

  async executeTaskQuery(request = {}) {
    return this.request(
      "/v1/task/query",
      TASKEN_CORE_TASK_QUERY_CAPABILITY,
      request,
      taskQueryResponseSchema,
      "task-query",
    );
  }

  async executeTaskCommand(request = {}) {
    return this.request(
      "/v1/task/command",
      TASKEN_CORE_TASK_COMMAND_CAPABILITY,
      request,
      taskCommandResponseSchema,
      "task-command",
    );
  }

  async inspect() {
    const discovery = await readDiscovery(this.discoveryPath);
    const [health, version, capabilityPayload] = await Promise.all([
      this.get(discovery, "/health"),
      this.get(discovery, "/version"),
      this.get(discovery, "/capabilities"),
    ]);
    if (health?.status !== "ok" || health?.api_version !== TASKEN_CORE_API_VERSION) {
      throw new TaskenCoreClientError(
        "INVALID_RESPONSE",
        "Tasken Core health responseが不正です。",
      );
    }
    if (version?.api_version !== TASKEN_CORE_API_VERSION) {
      throw new TaskenCoreClientError(
        "VERSION_MISMATCH",
        "Tasken Core API versionが一致しません。",
      );
    }
    if (
      !Array.isArray(capabilityPayload?.capabilities) ||
      capabilityPayload.capabilities.some((capability) => typeof capability !== "string")
    ) {
      throw new TaskenCoreClientError(
        "INVALID_RESPONSE",
        "Tasken Core capabilities responseが不正です。",
      );
    }
    const advertised = [...new Set(discovery.capabilities)].sort();
    const live = [...new Set(capabilityPayload.capabilities)].sort();
    if (JSON.stringify(advertised) !== JSON.stringify(live)) {
      throw new TaskenCoreClientError(
        "INVALID_RESPONSE",
        "Tasken Core discoveryとlive capabilitiesが一致しません。",
      );
    }
    return { status: "ok", api_version: TASKEN_CORE_API_VERSION, capabilities: live };
  }

  async status() {
    const result = await this.inspect();
    return { apiVersion: result.api_version, capabilities: result.capabilities };
  }

  async query(path, capability, request, responseSchema) {
    return this.request(`/v1/queries/${path}`, capability, request, responseSchema, path);
  }

  async request(
    route,
    capability,
    request,
    responseSchema,
    operation = route,
    extraHeaders = {},
    timeoutMs = this.timeoutMs,
  ) {
    const discovery = await readDiscovery(this.discoveryPath);
    if (!discovery.capabilities.includes(capability)) {
      throw new TaskenCoreClientError(
        "CAPABILITY_UNAVAILABLE",
        `Tasken Core operation capabilityが利用できません（${capability}）。`,
      );
    }
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await this.fetch(`${discovery.origin}${route}`, {
        method: "POST",
        headers: {
          authorization: `Bearer ${discovery.token}`,
          "content-type": "application/json",
          ...extraHeaders,
        },
        body: JSON.stringify(request),
        signal: controller.signal,
      });
      if (!response.ok) {
        let payload;
        try {
          payload = await response.json();
        } catch {
          // A non-JSON error is a transport failure, not a public domain error.
        }
        const publicError = payload?.error;
        if (
          publicError &&
          typeof publicError.code === "string" &&
          typeof publicError.message === "string"
        ) {
          throw new TaskenCoreClientError(publicError.code, publicError.message, {
            status: response.status,
            details: publicError.details,
            retryable: publicError.retryable,
            next_action: publicError.next_action,
          });
        }
        if (response.status === 401)
          throw new TaskenCoreClientError("UNAUTHORIZED", "Tasken Coreの認証に失敗しました。", {
            status: 401,
          });
        if (response.status === 409)
          throw new TaskenCoreClientError(
            "VERSION_MISMATCH",
            "Tasken Core API versionが一致しません。",
            { status: 409 },
          );
        throw new TaskenCoreClientError(
          "CORE_REQUEST_FAILED",
          `Tasken Core queryが失敗しました（${response.status}）。`,
          { status: response.status },
        );
      }
      const version = response.headers.get("x-tasken-core-version");
      if (version !== TASKEN_CORE_API_VERSION) {
        throw new TaskenCoreClientError(
          "VERSION_MISMATCH",
          "Tasken Core API versionが一致しません。",
        );
      }
      const payload = await response.json();
      if (!responseSchema) return payload;
      const parsed = responseSchema.safeParse(payload);
      if (!parsed.success) {
        throw new TaskenCoreClientError(
          "INVALID_RESPONSE",
          "Tasken Core responseがschemaに適合しません。",
          {
            details: { operation },
          },
        );
      }
      return parsed.data;
    } catch (error) {
      if (error instanceof TaskenCoreClientError) throw error;
      throw new TaskenCoreClientError(
        "CORE_UNAVAILABLE",
        "Tasken Coreへ接続できません。Taskenを起動してください。",
        { cause: error },
      );
    } finally {
      clearTimeout(timeout);
    }
  }

  async get(discovery, route) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const response = await this.fetch(`${discovery.origin}${route}`, {
        method: "GET",
        headers: { authorization: `Bearer ${discovery.token}` },
        signal: controller.signal,
      });
      if (!response.ok) {
        if (response.status === 401)
          throw new TaskenCoreClientError("UNAUTHORIZED", "Tasken Coreの認証に失敗しました。", {
            status: 401,
          });
        throw new TaskenCoreClientError(
          "CORE_REQUEST_FAILED",
          `Tasken Core inspectionが失敗しました（${response.status}）。`,
          { status: response.status },
        );
      }
      if (response.headers.get("x-tasken-core-version") !== TASKEN_CORE_API_VERSION) {
        throw new TaskenCoreClientError(
          "VERSION_MISMATCH",
          "Tasken Core API versionが一致しません。",
        );
      }
      return await response.json();
    } catch (error) {
      if (error instanceof TaskenCoreClientError) throw error;
      throw new TaskenCoreClientError(
        "CORE_UNAVAILABLE",
        "Tasken Coreへ接続できません。Taskenを起動してください。",
        { cause: error },
      );
    } finally {
      clearTimeout(timeout);
    }
  }
}
