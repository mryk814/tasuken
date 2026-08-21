import { randomBytes, timingSafeEqual } from "node:crypto";
import fs from "node:fs/promises";
import http, { type IncomingMessage, type ServerResponse } from "node:http";
import path from "node:path";

import type {
  FindTasksForRepositoryResponse,
  FindThemesForRepositoryResponse,
  GetActivityEntriesRequest,
  GetActivityEntriesResponse,
  GetRepositoryContextRequest,
  GetRepositoryContextResponse,
  GetThemeContextRequest,
  GetThemeContextResponse,
  GetArtifactMetadataRequest,
  GetArtifactMetadataResponse,
  GetConversationRequest,
  GetConversationResponse,
  GetNoteRequest,
  GetNoteResponse,
  GetRecentNotesRequest,
  GetRecentNotesResponse,
  SearchKnowledgeRequest,
  SearchKnowledgeResponse,
  GetKnowledgeContextRequest,
  GetKnowledgeContextResponse,
  GetPlanHealthRequest,
  GetPlanHealthResponse,
  GetKnowledgeHealthRequest,
  GetKnowledgeHealthResponse,
  GetActivityRequest,
  GetActivityResponse,
  GetContextSubgraphRequest,
  GetContextSubgraphResponse,
  ExportAiContextRequest,
  ExportAiContextResponse,
  GetTaskAssignmentRequest,
  GetTaskAssignmentResponse,
  GetTaskContextRequest,
  GetTaskContextResponse,
  ListAgentReadyTasksRequest,
  ListAgentReadyTasksResponse,
  ListOpenItemsRequest,
  ListOpenItemsResponse,
  RepositoryLookupRequest,
  ResolveRepositoryContextResponse,
  SearchItemsRequest,
  SearchItemsResponse,
  ProposeTaskWorkRequest,
  ProposeTaskWorkResponse,
} from "../../../shared/contracts/task/public.ts";
import {
  getTaskAssignmentRequestSchema,
  getActivityEntriesRequestSchema,
  getRepositoryContextRequestSchema,
  getThemeContextRequestSchema,
  getArtifactMetadataRequestSchema,
  getConversationRequestSchema,
  getNoteRequestSchema,
  getRecentNotesRequestSchema,
  searchKnowledgeRequestSchema,
  getKnowledgeContextRequestSchema,
  getPlanHealthRequestSchema,
  getKnowledgeHealthRequestSchema,
  getActivityRequestSchema,
  getContextSubgraphRequestSchema,
  exportAiContextRequestSchema,
  getTaskContextRequestSchema,
  listAgentReadyTasksRequestSchema,
  listOpenItemsRequestSchema,
  repositoryLookupRequestSchema,
  searchItemsRequestSchema,
  proposeTaskWorkRequestSchema,
} from "../../../shared/contracts/task/public.ts";
import {
  TASKEN_CORE_API_VERSION,
  TASKEN_CORE_FIND_TASKS_FOR_REPOSITORY_CAPABILITY,
  TASKEN_CORE_FIND_THEMES_FOR_REPOSITORY_CAPABILITY,
  TASKEN_CORE_GET_REPOSITORY_CONTEXT_CAPABILITY,
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
  TASKEN_CORE_LIST_OPEN_ITEMS_CAPABILITY,
  TASKEN_CORE_LIST_AGENT_READY_TASKS_CAPABILITY,
  TASKEN_CORE_RESOLVE_REPOSITORY_CONTEXT_CAPABILITY,
  TASKEN_CORE_SEARCH_ITEMS_CAPABILITY,
  TASKEN_CORE_DISCOVERY_FILE,
  TASKEN_CORE_DISCOVERY_SCHEMA_VERSION,
  taskenCorePublicError,
} from "../../../shared/contracts/core/public.mjs";

const LOOPBACK_HOST = "127.0.0.1";
const MAX_BODY_BYTES = 64 * 1024;
const REQUEST_TIMEOUT_MS = 5_000;

export interface ListAgentReadyTasksProvider {
  execute(request: ListAgentReadyTasksRequest): ListAgentReadyTasksResponse;
}

interface QueryProvider<Request, Response> {
  execute(request: Request): Response;
}

export interface TaskenCoreHostOptions {
  userDataPath: string;
  listAgentReadyTasks: ListAgentReadyTasksProvider;
  resolveRepositoryContext?: QueryProvider<RepositoryLookupRequest, ResolveRepositoryContextResponse>;
  findTasksForRepository?: QueryProvider<RepositoryLookupRequest, FindTasksForRepositoryResponse>;
  findThemesForRepository?: QueryProvider<RepositoryLookupRequest, FindThemesForRepositoryResponse>;
  getRepositoryContext?: QueryProvider<GetRepositoryContextRequest, GetRepositoryContextResponse>;
  getTaskAssignment?: QueryProvider<GetTaskAssignmentRequest, GetTaskAssignmentResponse>;
  getTaskContext?: QueryProvider<GetTaskContextRequest, GetTaskContextResponse>;
  searchItems?: QueryProvider<SearchItemsRequest, SearchItemsResponse>;
  listOpenItems?: QueryProvider<ListOpenItemsRequest, ListOpenItemsResponse>;
  getNote?: QueryProvider<GetNoteRequest, GetNoteResponse>;
  getConversation?: QueryProvider<GetConversationRequest, GetConversationResponse>;
  getArtifactMetadata?: QueryProvider<GetArtifactMetadataRequest, GetArtifactMetadataResponse>;
  getActivityEntries?: QueryProvider<GetActivityEntriesRequest, GetActivityEntriesResponse>;
  getThemeContext?: QueryProvider<GetThemeContextRequest, GetThemeContextResponse>;
  getRecentNotes?: QueryProvider<GetRecentNotesRequest, GetRecentNotesResponse>;
  searchKnowledge?: QueryProvider<SearchKnowledgeRequest, SearchKnowledgeResponse>;
  getKnowledgeContext?: QueryProvider<GetKnowledgeContextRequest, GetKnowledgeContextResponse>;
  getPlanHealth?: QueryProvider<GetPlanHealthRequest, GetPlanHealthResponse>;
  getKnowledgeHealth?: QueryProvider<GetKnowledgeHealthRequest, GetKnowledgeHealthResponse>;
  getActivity?: QueryProvider<GetActivityRequest, GetActivityResponse>;
  getContextSubgraph?: QueryProvider<GetContextSubgraphRequest, GetContextSubgraphResponse>;
  exportAiContext?: QueryProvider<ExportAiContextRequest, ExportAiContextResponse>;
  proposeTaskWork?: QueryProvider<ProposeTaskWorkRequest, ProposeTaskWorkResponse>;
}

interface DiscoveryDocument {
  schema_version: 1;
  api_version: string;
  origin: string;
  token: string;
  capabilities: string[];
  pid: number;
  started_at: string;
}

function json(response: ServerResponse, status: number, body: unknown) {
  const encoded = JSON.stringify(body);
  response.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(encoded),
    "cache-control": "no-store",
    "x-tasken-core-version": TASKEN_CORE_API_VERSION,
  });
  response.end(encoded);
}

function errorResponse(code: string, message: string, extra: Record<string, unknown> = {}) {
  return { error: taskenCorePublicError(code, message, extra) };
}

class RequestValidationError extends Error {
  readonly issues: unknown[];

  constructor(issues: unknown[]) {
    super("VALIDATION_FAILED");
    this.name = "RequestValidationError";
    this.issues = issues;
  }
}

function parseOperationRequest(url: string, body: unknown): unknown {
  const schema = url === "/v1/commands/propose-task-work" ? proposeTaskWorkRequestSchema
    : url === "/v1/queries/list-agent-ready-tasks" ? listAgentReadyTasksRequestSchema
    : url === "/v1/queries/resolve-repository-context" || url === "/v1/queries/find-tasks-for-repository" || url === "/v1/queries/find-themes-for-repository" ? repositoryLookupRequestSchema
      : url === "/v1/queries/get-repository-context" ? getRepositoryContextRequestSchema
      : url === "/v1/queries/get-task-assignment" ? getTaskAssignmentRequestSchema
        : url === "/v1/queries/get-task-context" ? getTaskContextRequestSchema
          : url === "/v1/queries/search-items" ? searchItemsRequestSchema
            : url === "/v1/queries/list-open-items" ? listOpenItemsRequestSchema
              : url === "/v1/queries/get-note" ? getNoteRequestSchema
                : url === "/v1/queries/get-conversation" ? getConversationRequestSchema
                  : url === "/v1/queries/get-artifact-metadata" ? getArtifactMetadataRequestSchema
                    : url === "/v1/queries/get-activity-entries" ? getActivityEntriesRequestSchema
                      : url === "/v1/queries/get-theme-context" ? getThemeContextRequestSchema
                        : url === "/v1/queries/get-recent-notes" ? getRecentNotesRequestSchema
                      : url === "/v1/queries/search-knowledge" ? searchKnowledgeRequestSchema
                        : url === "/v1/queries/get-knowledge-context" ? getKnowledgeContextRequestSchema
                          : url === "/v1/queries/get-plan-health" ? getPlanHealthRequestSchema
                            : url === "/v1/queries/get-knowledge-health" ? getKnowledgeHealthRequestSchema
                              : url === "/v1/queries/get-activity" ? getActivityRequestSchema
                                : url === "/v1/queries/get-context-subgraph" ? getContextSubgraphRequestSchema
                                  : exportAiContextRequestSchema;
  const result = schema.safeParse(body);
  if (!result.success) throw new RequestValidationError(result.error.issues);
  return result.data;
}

function publicRequestError(error: unknown) {
  if (error instanceof RequestValidationError) {
    return {
      status: 400,
      body: errorResponse("VALIDATION_FAILED", "requestがschemaに適合しません。", {
        details: {
            issues: error.issues.map((issue) => {
              const value = issue as { path?: unknown; code?: unknown };
              return {
                path: Array.isArray(value.path) ? value.path.filter((entry) => typeof entry === "string" || typeof entry === "number") : [],
                code: typeof value.code === "string" ? value.code : "invalid_value",
                // Zod messages can quote attacker-controlled values; expose only the stable issue shape.
                message: "値が不正です。",
              };
            }),
          },
      }),
    };
  }
  const message = error instanceof Error ? error.message : "";
  if (message === "BODY_TOO_LARGE") {
    return { status: 413, body: errorResponse(message, "request bodyが大きすぎます。") };
  }
  if (message === "INVALID_JSON") {
    return { status: 400, body: errorResponse(message, "JSONが不正です。") };
  }
  if (error instanceof Error && error.name === "ProposeTaskWorkError"
    && "code" in error && error.code === "IDEMPOTENCY_CONFLICT") {
    return {
      status: 409,
      body: errorResponse("IDEMPOTENCY_CONFLICT", error.message, {
        details: "details" in error && error.details && typeof error.details === "object" ? error.details as Record<string, unknown> : {},
      }),
    };
  }
  return { status: 500, body: errorResponse("INTERNAL_ERROR", "Tasken Core queryの処理に失敗しました。") };
}

function bearerMatches(header: string | undefined, token: string) {
  const prefix = "Bearer ";
  if (!header?.startsWith(prefix)) return false;
  const provided = Buffer.from(header.slice(prefix.length));
  const expected = Buffer.from(token);
  return provided.length === expected.length && timingSafeEqual(provided, expected);
}

async function requestBody(request: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buffer.length;
    if (size > MAX_BODY_BYTES) {
      request.pause();
      throw new Error("BODY_TOO_LARGE");
    }
    chunks.push(buffer);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
  } catch {
    throw new Error("INVALID_JSON");
  }
}

async function atomicWriteDiscovery(filePath: string, document: DiscoveryDocument) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  const temporary = `${filePath}.${process.pid}.${randomBytes(8).toString("hex")}.tmp`;
  try {
    await fs.writeFile(temporary, `${JSON.stringify(document)}\n`, { encoding: "utf8", flag: "wx", mode: 0o600 });
    try {
      await fs.chmod(temporary, 0o600);
    } catch {
      // Windows ACL is inherited from userData; chmod is best effort there.
    }
    await fs.rename(temporary, filePath);
    try {
      await fs.chmod(filePath, 0o600);
    } catch {
      // The atomic destination inherits the same-user userData ACL on platforms without POSIX modes.
    }
  } finally {
    await fs.rm(temporary, { force: true });
  }
}

export class TaskenCoreHost {
  private readonly options: TaskenCoreHostOptions;
  private readonly token = randomBytes(32).toString("base64url");
  private readonly discoveryPath: string;
  private server: http.Server | null = null;

  constructor(options: TaskenCoreHostOptions) {
    this.options = options;
    this.discoveryPath = path.join(options.userDataPath, TASKEN_CORE_DISCOVERY_FILE);
  }

  private capabilities() {
    return [
      TASKEN_CORE_LIST_AGENT_READY_TASKS_CAPABILITY,
      ...(this.options.resolveRepositoryContext ? [TASKEN_CORE_RESOLVE_REPOSITORY_CONTEXT_CAPABILITY] : []),
      ...(this.options.findTasksForRepository ? [TASKEN_CORE_FIND_TASKS_FOR_REPOSITORY_CAPABILITY] : []),
      ...(this.options.findThemesForRepository ? [TASKEN_CORE_FIND_THEMES_FOR_REPOSITORY_CAPABILITY] : []),
      ...(this.options.getRepositoryContext ? [TASKEN_CORE_GET_REPOSITORY_CONTEXT_CAPABILITY] : []),
      ...(this.options.getTaskAssignment ? [TASKEN_CORE_GET_TASK_ASSIGNMENT_CAPABILITY] : []),
      ...(this.options.getTaskContext ? [TASKEN_CORE_GET_TASK_CONTEXT_CAPABILITY] : []),
      ...(this.options.searchItems ? [TASKEN_CORE_SEARCH_ITEMS_CAPABILITY] : []),
      ...(this.options.listOpenItems ? [TASKEN_CORE_LIST_OPEN_ITEMS_CAPABILITY] : []),
      ...(this.options.getNote ? [TASKEN_CORE_GET_NOTE_CAPABILITY] : []),
      ...(this.options.getConversation ? [TASKEN_CORE_GET_CONVERSATION_CAPABILITY] : []),
      ...(this.options.getArtifactMetadata ? [TASKEN_CORE_GET_ARTIFACT_METADATA_CAPABILITY] : []),
      ...(this.options.getActivityEntries ? [TASKEN_CORE_GET_ACTIVITY_ENTRIES_CAPABILITY] : []),
      ...(this.options.getThemeContext ? [TASKEN_CORE_GET_THEME_CONTEXT_CAPABILITY] : []),
      ...(this.options.getRecentNotes ? [TASKEN_CORE_GET_RECENT_NOTES_CAPABILITY] : []),
      ...(this.options.searchKnowledge ? [TASKEN_CORE_SEARCH_KNOWLEDGE_CAPABILITY] : []),
      ...(this.options.getKnowledgeContext ? [TASKEN_CORE_GET_KNOWLEDGE_CONTEXT_CAPABILITY] : []),
      ...(this.options.getPlanHealth ? [TASKEN_CORE_GET_PLAN_HEALTH_CAPABILITY] : []),
      ...(this.options.getKnowledgeHealth ? [TASKEN_CORE_GET_KNOWLEDGE_HEALTH_CAPABILITY] : []),
      ...(this.options.getActivity ? [TASKEN_CORE_GET_ACTIVITY_CAPABILITY] : []),
      ...(this.options.getContextSubgraph ? [TASKEN_CORE_GET_CONTEXT_SUBGRAPH_CAPABILITY] : []),
      ...(this.options.exportAiContext ? [TASKEN_CORE_EXPORT_AI_CONTEXT_CAPABILITY] : []),
      ...(this.options.proposeTaskWork ? [TASKEN_CORE_PROPOSE_TASK_WORK_CAPABILITY] : []),
    ];
  }

  async start() {
    if (this.server) throw new Error("Tasken Core hostは起動済みです。");
    const server = http.createServer((request, response) => void this.handle(request, response));
    server.requestTimeout = REQUEST_TIMEOUT_MS;
    server.headersTimeout = REQUEST_TIMEOUT_MS;
    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(0, LOOPBACK_HOST, () => {
        server.off("error", reject);
        resolve();
      });
    });
    this.server = server;
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("Tasken Core addressを取得できませんでした。");
    const discovery: DiscoveryDocument = {
      schema_version: TASKEN_CORE_DISCOVERY_SCHEMA_VERSION,
      api_version: TASKEN_CORE_API_VERSION,
      origin: `http://${LOOPBACK_HOST}:${address.port}`,
      token: this.token,
      capabilities: this.capabilities(),
      pid: process.pid,
      started_at: new Date().toISOString(),
    };
    try {
      await atomicWriteDiscovery(this.discoveryPath, discovery);
    } catch (error) {
      await this.closeServer();
      throw error;
    }
    return { origin: discovery.origin, discoveryPath: this.discoveryPath };
  }

  async stop() {
    await this.closeServer();
    await fs.rm(this.discoveryPath, { force: true });
  }

  private async closeServer() {
    const server = this.server;
    this.server = null;
    if (!server) return;
    await new Promise<void>((resolve, reject) => {
      server.close((error) => error ? reject(error) : resolve());
      // `server.close()` alone can wait indefinitely for a child MCP process
      // that still owns a keep-alive or partially-open request on Windows.
      // Start graceful shutdown first, then retire every remaining connection.
      server.closeIdleConnections?.();
      server.closeAllConnections?.();
    });
  }

  private async handle(request: IncomingMessage, response: ServerResponse) {
    try {
      if (!bearerMatches(request.headers.authorization, this.token)) {
        json(response, 401, errorResponse("UNAUTHORIZED", "認証できません。"));
        return;
      }
      const queryPaths = new Set([
        "/v1/queries/list-agent-ready-tasks",
        ...(this.options.resolveRepositoryContext ? ["/v1/queries/resolve-repository-context"] : []),
        ...(this.options.findTasksForRepository ? ["/v1/queries/find-tasks-for-repository"] : []),
        ...(this.options.findThemesForRepository ? ["/v1/queries/find-themes-for-repository"] : []),
        ...(this.options.getRepositoryContext ? ["/v1/queries/get-repository-context"] : []),
        ...(this.options.getTaskAssignment ? ["/v1/queries/get-task-assignment"] : []),
        ...(this.options.getTaskContext ? ["/v1/queries/get-task-context"] : []),
        ...(this.options.searchItems ? ["/v1/queries/search-items"] : []),
        ...(this.options.listOpenItems ? ["/v1/queries/list-open-items"] : []),
        ...(this.options.getNote ? ["/v1/queries/get-note"] : []),
        ...(this.options.getConversation ? ["/v1/queries/get-conversation"] : []),
        ...(this.options.getArtifactMetadata ? ["/v1/queries/get-artifact-metadata"] : []),
        ...(this.options.getActivityEntries ? ["/v1/queries/get-activity-entries"] : []),
        ...(this.options.getThemeContext ? ["/v1/queries/get-theme-context"] : []),
        ...(this.options.getRecentNotes ? ["/v1/queries/get-recent-notes"] : []),
        ...(this.options.searchKnowledge ? ["/v1/queries/search-knowledge"] : []),
        ...(this.options.getKnowledgeContext ? ["/v1/queries/get-knowledge-context"] : []),
        ...(this.options.getPlanHealth ? ["/v1/queries/get-plan-health"] : []),
        ...(this.options.getKnowledgeHealth ? ["/v1/queries/get-knowledge-health"] : []),
        ...(this.options.getActivity ? ["/v1/queries/get-activity"] : []),
        ...(this.options.getContextSubgraph ? ["/v1/queries/get-context-subgraph"] : []),
        ...(this.options.exportAiContext ? ["/v1/queries/export-ai-context"] : []),
      ]);
      const commandPaths = new Set([
        ...(this.options.proposeTaskWork ? ["/v1/commands/propose-task-work"] : []),
      ]);
      const operationPaths = new Set([...queryPaths, ...commandPaths]);
      const knownPaths = new Set(["/health", "/version", "/capabilities", ...operationPaths]);
      if (knownPaths.has(request.url || "")
        && request.method !== (operationPaths.has(request.url || "") ? "POST" : "GET")) {
        response.setHeader("allow", operationPaths.has(request.url || "") ? "POST" : "GET");
        json(response, 405, errorResponse("METHOD_NOT_ALLOWED", "methodが許可されていません。"));
        return;
      }
      if (request.method === "GET" && request.url === "/health") {
        json(response, 200, { status: "ok", api_version: TASKEN_CORE_API_VERSION });
        return;
      }
      if (request.method === "GET" && request.url === "/version") {
        json(response, 200, { api_version: TASKEN_CORE_API_VERSION });
        return;
      }
      if (request.method === "GET" && request.url === "/capabilities") {
        json(response, 200, { capabilities: this.capabilities() });
        return;
      }
      if (request.method === "POST" && operationPaths.has(request.url || "")) {
        if (request.headers["content-type"]?.split(";", 1)[0].trim().toLowerCase() !== "application/json") {
          json(response, 415, errorResponse("UNSUPPORTED_MEDIA_TYPE", "application/jsonを指定してください。"));
          return;
        }
        const body = parseOperationRequest(request.url || "", await requestBody(request));
        if (request.url === "/v1/commands/propose-task-work") {
          json(response, 200, this.options.proposeTaskWork!.execute(body as ProposeTaskWorkRequest));
        } else if (request.url === "/v1/queries/list-agent-ready-tasks") {
          json(response, 200, this.options.listAgentReadyTasks.execute(body as ListAgentReadyTasksRequest));
        } else if (request.url === "/v1/queries/resolve-repository-context") {
          json(response, 200, this.options.resolveRepositoryContext!.execute(body as RepositoryLookupRequest));
        } else if (request.url === "/v1/queries/find-tasks-for-repository") {
          json(response, 200, this.options.findTasksForRepository!.execute(body as RepositoryLookupRequest));
        } else if (request.url === "/v1/queries/find-themes-for-repository") {
          json(response, 200, this.options.findThemesForRepository!.execute(body as RepositoryLookupRequest));
        } else if (request.url === "/v1/queries/get-repository-context") {
          json(response, 200, this.options.getRepositoryContext!.execute(body as GetRepositoryContextRequest));
        } else if (request.url === "/v1/queries/get-task-context") {
          json(response, 200, this.options.getTaskContext!.execute(body as GetTaskContextRequest));
        } else if (request.url === "/v1/queries/search-items") {
          json(response, 200, this.options.searchItems!.execute(body as SearchItemsRequest));
        } else if (request.url === "/v1/queries/list-open-items") {
          json(response, 200, this.options.listOpenItems!.execute(body as ListOpenItemsRequest));
        } else if (request.url === "/v1/queries/get-note") {
          json(response, 200, this.options.getNote!.execute(body as GetNoteRequest));
        } else if (request.url === "/v1/queries/get-conversation") {
          json(response, 200, this.options.getConversation!.execute(body as GetConversationRequest));
        } else if (request.url === "/v1/queries/get-artifact-metadata") {
          json(response, 200, this.options.getArtifactMetadata!.execute(body as GetArtifactMetadataRequest));
        } else if (request.url === "/v1/queries/get-activity-entries") {
          json(response, 200, this.options.getActivityEntries!.execute(body as GetActivityEntriesRequest));
        } else if (request.url === "/v1/queries/get-theme-context") {
          json(response, 200, this.options.getThemeContext!.execute(body as GetThemeContextRequest));
        } else if (request.url === "/v1/queries/get-recent-notes") {
          json(response, 200, this.options.getRecentNotes!.execute(body as GetRecentNotesRequest));
        } else if (request.url === "/v1/queries/search-knowledge") {
          json(response, 200, this.options.searchKnowledge!.execute(body as SearchKnowledgeRequest));
        } else if (request.url === "/v1/queries/get-knowledge-context") {
          json(response, 200, this.options.getKnowledgeContext!.execute(body as GetKnowledgeContextRequest));
        } else if (request.url === "/v1/queries/get-plan-health") {
          json(response, 200, this.options.getPlanHealth!.execute(body as GetPlanHealthRequest));
        } else if (request.url === "/v1/queries/get-knowledge-health") {
          json(response, 200, this.options.getKnowledgeHealth!.execute(body as GetKnowledgeHealthRequest));
        } else if (request.url === "/v1/queries/get-activity") {
          json(response, 200, this.options.getActivity!.execute(body as GetActivityRequest));
        } else if (request.url === "/v1/queries/get-context-subgraph") {
          json(response, 200, this.options.getContextSubgraph!.execute(body as GetContextSubgraphRequest));
        } else if (request.url === "/v1/queries/export-ai-context") {
          json(response, 200, this.options.exportAiContext!.execute(body as ExportAiContextRequest));
        } else {
          json(response, 200, this.options.getTaskAssignment!.execute(body as GetTaskAssignmentRequest));
        }
        return;
      }
      json(response, 404, errorResponse("NOT_FOUND", "endpointがありません。"));
    } catch (error) {
      const mapped = publicRequestError(error);
      if (mapped.status === 413) {
        response.setHeader("connection", "close");
        json(response, mapped.status, mapped.body);
        response.once("finish", () => request.destroy());
      }
      else json(response, mapped.status, mapped.body);
    }
  }
}
