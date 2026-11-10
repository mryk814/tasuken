import {
  aiItemCreationRequestSchema,
  aiTaskStartRequestSchema,
  type AiTaskStartRequest,
  type AiItemCreationRequest,
  type AiItemCreationResponse,
  getSourceStatusRequestSchema,
  type GetSourceStatusRequest,
  type GetSourceStatusResponse,
} from "../../../shared/contracts/task/public.ts";
import { randomBytes, timingSafeEqual } from "node:crypto";
import fs from "node:fs/promises";
import http, { type IncomingMessage, type ServerResponse } from "node:http";
import path from "node:path";
import { setTimeout } from "node:timers/promises";
import type { ZodType } from "zod/v4";

import type {
  FindTasksForRepositoryResponse,
  FindThemesForRepositoryResponse,
  GetActivityEntriesRequest,
  GetActivityEntriesResponse,
  GetRepositoryContextRequest,
  GetRepositoryContextResponse,
  GetAgentSessionContextRequest,
  GetAgentSessionContextResponse,
  GetThemeContextRequest,
  GetThemeContextResponse,
  GetArtifactMetadataRequest,
  GetArtifactMetadataResponse,
  GetConversationRequest,
  GetConversationResponse,
  GetNoteRequest,
  GetNoteResponse,
  GetCaptureImageRequest,
  GetCaptureImageResponse,
  GetTaskImageRequest,
  GetTaskImageResponse,
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
  GetFeedContextRequest,
  GetFeedContextResponse,
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
  ProposeAgentSessionRequest,
  ProposeAgentSessionResponse,
  ProposeRepositoryTaskRequest,
  ProposeRepositoryTaskResponse,
  ProposeContentRequest,
  ProposeContentResponse,
  ProposalStatusRequest,
  ProposalStatusResponse,
  ListProposalsRequest,
  ListProposalsResponse,
  TaskCommandResponse,
  TaskQueryResponse,
} from "../../../shared/contracts/task/public.ts";
import {
  getTaskAssignmentRequestSchema,
  getActivityEntriesRequestSchema,
  getRepositoryContextRequestSchema,
  getAgentSessionContextRequestSchema,
  getThemeContextRequestSchema,
  getArtifactMetadataRequestSchema,
  getCaptureImageRequestSchema,
  getTaskImageRequestSchema,
  getConversationRequestSchema,
  getNoteRequestSchema,
  getRecentNotesRequestSchema,
  searchKnowledgeRequestSchema,
  getKnowledgeContextRequestSchema,
  getPlanHealthRequestSchema,
  getKnowledgeHealthRequestSchema,
  getActivityRequestSchema,
  getContextSubgraphRequestSchema,
  getFeedContextRequestSchema,
  exportAiContextRequestSchema,
  getTaskContextRequestSchema,
  listAgentReadyTasksRequestSchema,
  listOpenItemsRequestSchema,
  repositoryLookupRequestSchema,
  searchItemsRequestSchema,
  proposeTaskWorkRequestSchema,
  proposeAgentSessionRequestSchema,
  proposeRepositoryTaskRequestSchema,
  proposeContentRequestSchema,
  proposalStatusRequestSchema,
  listProposalsRequestSchema,
  taskCommandSchema,
  taskQuerySchema,
} from "../../../shared/contracts/task/public.ts";
import {
  TASKEN_CORE_API_VERSION,
  TASKEN_CORE_CREATE_AI_ITEM_CAPABILITY,
  TASKEN_CORE_FIND_TASKS_FOR_REPOSITORY_CAPABILITY,
  TASKEN_CORE_FIND_THEMES_FOR_REPOSITORY_CAPABILITY,
  TASKEN_CORE_GET_REPOSITORY_CONTEXT_CAPABILITY,
  TASKEN_CORE_GET_AGENT_SESSION_CONTEXT_CAPABILITY,
  TASKEN_CORE_GET_TASK_ASSIGNMENT_CAPABILITY,
  TASKEN_CORE_GET_TASK_CONTEXT_CAPABILITY,
  TASKEN_CORE_GET_ACTIVITY_ENTRIES_CAPABILITY,
  TASKEN_CORE_GET_THEME_CONTEXT_CAPABILITY,
  TASKEN_CORE_GET_ARTIFACT_METADATA_CAPABILITY,
  TASKEN_CORE_GET_CAPTURE_IMAGE_CAPABILITY,
  TASKEN_CORE_GET_TASK_IMAGE_CAPABILITY,
  TASKEN_CORE_GET_CONVERSATION_CAPABILITY,
  TASKEN_CORE_GET_NOTE_CAPABILITY,
  TASKEN_CORE_GET_RECENT_NOTES_CAPABILITY,
  TASKEN_CORE_SEARCH_KNOWLEDGE_CAPABILITY,
  TASKEN_CORE_GET_KNOWLEDGE_CONTEXT_CAPABILITY,
  TASKEN_CORE_GET_PLAN_HEALTH_CAPABILITY,
  TASKEN_CORE_GET_KNOWLEDGE_HEALTH_CAPABILITY,
  TASKEN_CORE_GET_ACTIVITY_CAPABILITY,
  TASKEN_CORE_GET_CONTEXT_SUBGRAPH_CAPABILITY,
  TASKEN_CORE_GET_FEED_CONTEXT_CAPABILITY,
  TASKEN_CORE_PROPOSAL_STATUS_CAPABILITY,
  TASKEN_CORE_LIST_PROPOSALS_CAPABILITY,
  TASKEN_CORE_EXPORT_AI_CONTEXT_CAPABILITY,
  TASKEN_CORE_SOURCE_STATUS_CAPABILITY,
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
  TASKEN_CORE_TASK_START_WORK_CAPABILITY,
  TASKEN_CORE_TASK_QUERY_CAPABILITY,
  taskenCorePublicError,
} from "../../../shared/contracts/core/public.mjs";
import { findCoreClient } from "./coreClientTokens.mjs";

const LOOPBACK_HOST = "127.0.0.1";
// Token-free origin for read-only clients; the full token stays in discovery only.
// It lives in a folder of its own so that a reader in another container (awai on
// the NAS) can be given that folder alone. Core replaces the file by rename, so a
// reader needs the folder rather than the file, and userData itself holds the
// full-token discovery file and the database.
const TASKEN_CORE_ENDPOINT_DIR = "core-endpoint";
const TASKEN_CORE_ENDPOINT_FILE = "tasken-core-endpoint.json";
const MAX_BODY_BYTES = 64 * 1024;
const MAX_NOTE_PROPOSAL_WITH_IMAGES_BODY_BYTES = 34 * 1024 * 1024;
const REQUEST_TIMEOUT_MS = 5_000;

export interface ListAgentReadyTasksProvider {
  execute(request: ListAgentReadyTasksRequest): ListAgentReadyTasksResponse;
}

interface QueryProvider<Request, Response> {
  execute(request: Request): Response;
}

export interface TaskenCoreHostOptions {
  userDataPath: string;
  createAiItem?: QueryProvider<AiItemCreationRequest, AiItemCreationResponse>;
  getSourceStatus?: QueryProvider<GetSourceStatusRequest, GetSourceStatusResponse>;
  startAiTaskWork?: QueryProvider<AiTaskStartRequest, TaskCommandResponse>;
  taskQuery?: QueryProvider<unknown, TaskQueryResponse>;
  taskCommand?: QueryProvider<unknown, TaskCommandResponse>;
  listAgentReadyTasks: ListAgentReadyTasksProvider;
  resolveRepositoryContext?: QueryProvider<
    RepositoryLookupRequest,
    ResolveRepositoryContextResponse
  >;
  findTasksForRepository?: QueryProvider<RepositoryLookupRequest, FindTasksForRepositoryResponse>;
  findThemesForRepository?: QueryProvider<RepositoryLookupRequest, FindThemesForRepositoryResponse>;
  getRepositoryContext?: QueryProvider<GetRepositoryContextRequest, GetRepositoryContextResponse>;
  getAgentSessionContext?: QueryProvider<
    GetAgentSessionContextRequest,
    GetAgentSessionContextResponse
  >;
  getTaskAssignment?: QueryProvider<GetTaskAssignmentRequest, GetTaskAssignmentResponse>;
  getTaskContext?: QueryProvider<GetTaskContextRequest, GetTaskContextResponse>;
  searchItems?: QueryProvider<SearchItemsRequest, SearchItemsResponse>;
  listOpenItems?: QueryProvider<ListOpenItemsRequest, ListOpenItemsResponse>;
  getNote?: QueryProvider<GetNoteRequest, GetNoteResponse>;
  getConversation?: QueryProvider<GetConversationRequest, GetConversationResponse>;
  getArtifactMetadata?: QueryProvider<GetArtifactMetadataRequest, GetArtifactMetadataResponse>;
  getCaptureImage?: QueryProvider<GetCaptureImageRequest, GetCaptureImageResponse>;
  getTaskImage?: QueryProvider<GetTaskImageRequest, GetTaskImageResponse>;
  getActivityEntries?: QueryProvider<GetActivityEntriesRequest, GetActivityEntriesResponse>;
  getThemeContext?: QueryProvider<GetThemeContextRequest, GetThemeContextResponse>;
  getRecentNotes?: QueryProvider<GetRecentNotesRequest, GetRecentNotesResponse>;
  searchKnowledge?: QueryProvider<SearchKnowledgeRequest, SearchKnowledgeResponse>;
  getKnowledgeContext?: QueryProvider<GetKnowledgeContextRequest, GetKnowledgeContextResponse>;
  getPlanHealth?: QueryProvider<GetPlanHealthRequest, GetPlanHealthResponse>;
  getKnowledgeHealth?: QueryProvider<GetKnowledgeHealthRequest, GetKnowledgeHealthResponse>;
  getActivity?: QueryProvider<GetActivityRequest, GetActivityResponse>;
  getContextSubgraph?: QueryProvider<GetContextSubgraphRequest, GetContextSubgraphResponse>;
  getFeedContext?: QueryProvider<GetFeedContextRequest, GetFeedContextResponse>;
  getProposalStatus?: QueryProvider<ProposalStatusRequest, ProposalStatusResponse>;
  listProposals?: QueryProvider<ListProposalsRequest, ListProposalsResponse>;
  exportAiContext?: QueryProvider<ExportAiContextRequest, ExportAiContextResponse>;
  proposeTaskWork?: QueryProvider<ProposeTaskWorkRequest, ProposeTaskWorkResponse>;
  proposeAgentSession?: QueryProvider<ProposeAgentSessionRequest, ProposeAgentSessionResponse>;
  proposeRepositoryTask?: QueryProvider<
    ProposeRepositoryTaskRequest,
    ProposeRepositoryTaskResponse
  >;
  proposeContent?: QueryProvider<ProposeContentRequest, ProposeContentResponse>;
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

interface EndpointDocument {
  schema_version: 1;
  api_version: string;
  origin: string;
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

export type WriteGateCode = "DESKTOP_BEHIND" | "REPLICA_BEHIND";
export type WriteGate = (path: string) => WriteGateCode | null;

const WRITE_GATE_MESSAGES: Record<WriteGateCode, string> = {
  DESKTOP_BEHIND: "Desktopが古く、この書き込みの差分を取り込めないため受け付けません。",
  REPLICA_BEHIND: "NASのreplicaがDesktopの変更を取り込み終えていないため受け付けません。",
};

class RequestValidationError extends Error {
  readonly issues: unknown[];

  constructor(issues: unknown[]) {
    super("VALIDATION_FAILED");
    this.name = "RequestValidationError";
    this.issues = issues;
  }
}

type ProviderKey = Exclude<keyof TaskenCoreHostOptions, "userDataPath">;

interface RouteDefinition {
  path: string;
  kind: "query" | "command";
  provider: ProviderKey;
  capability: string;
  schema: ZodType;
  /** 読み取り専用のclient tokenには見せない読み取り（Proposalの状態）。 */
  hiddenFromReadClients?: boolean;
}

/**
 * Coreのloopback経路の正本。経路・公開するcapability・入力schema・処理するproviderを一行で持つ。
 * providerを渡された経路だけを公開し、capabilityもそこから導く。
 */
const ROUTES: readonly RouteDefinition[] = [
  {
    path: "/v1/queries/get-source-status",
    kind: "query",
    provider: "getSourceStatus",
    capability: TASKEN_CORE_SOURCE_STATUS_CAPABILITY,
    schema: getSourceStatusRequestSchema,
  },
  {
    path: "/v1/commands/create-ai-item",
    kind: "command",
    provider: "createAiItem",
    capability: TASKEN_CORE_CREATE_AI_ITEM_CAPABILITY,
    schema: aiItemCreationRequestSchema,
  },
  {
    path: "/v1/commands/start-ai-task-work",
    kind: "command",
    provider: "startAiTaskWork",
    capability: TASKEN_CORE_TASK_START_WORK_CAPABILITY,
    schema: aiTaskStartRequestSchema,
  },
  {
    path: "/v1/task/query",
    kind: "query",
    provider: "taskQuery",
    capability: TASKEN_CORE_TASK_QUERY_CAPABILITY,
    schema: taskQuerySchema,
  },
  {
    path: "/v1/task/command",
    kind: "command",
    provider: "taskCommand",
    capability: TASKEN_CORE_TASK_COMMAND_CAPABILITY,
    schema: taskCommandSchema,
  },
  {
    path: "/v1/queries/list-agent-ready-tasks",
    kind: "query",
    provider: "listAgentReadyTasks",
    capability: TASKEN_CORE_LIST_AGENT_READY_TASKS_CAPABILITY,
    schema: listAgentReadyTasksRequestSchema,
  },
  {
    path: "/v1/queries/resolve-repository-context",
    kind: "query",
    provider: "resolveRepositoryContext",
    capability: TASKEN_CORE_RESOLVE_REPOSITORY_CONTEXT_CAPABILITY,
    schema: repositoryLookupRequestSchema,
  },
  {
    path: "/v1/queries/find-tasks-for-repository",
    kind: "query",
    provider: "findTasksForRepository",
    capability: TASKEN_CORE_FIND_TASKS_FOR_REPOSITORY_CAPABILITY,
    schema: repositoryLookupRequestSchema,
  },
  {
    path: "/v1/queries/find-themes-for-repository",
    kind: "query",
    provider: "findThemesForRepository",
    capability: TASKEN_CORE_FIND_THEMES_FOR_REPOSITORY_CAPABILITY,
    schema: repositoryLookupRequestSchema,
  },
  {
    path: "/v1/queries/get-repository-context",
    kind: "query",
    provider: "getRepositoryContext",
    capability: TASKEN_CORE_GET_REPOSITORY_CONTEXT_CAPABILITY,
    schema: getRepositoryContextRequestSchema,
  },
  {
    path: "/v1/queries/get-agent-session-context",
    kind: "query",
    provider: "getAgentSessionContext",
    capability: TASKEN_CORE_GET_AGENT_SESSION_CONTEXT_CAPABILITY,
    schema: getAgentSessionContextRequestSchema,
  },
  {
    path: "/v1/queries/get-task-assignment",
    kind: "query",
    provider: "getTaskAssignment",
    capability: TASKEN_CORE_GET_TASK_ASSIGNMENT_CAPABILITY,
    schema: getTaskAssignmentRequestSchema,
  },
  {
    path: "/v1/queries/get-task-context",
    kind: "query",
    provider: "getTaskContext",
    capability: TASKEN_CORE_GET_TASK_CONTEXT_CAPABILITY,
    schema: getTaskContextRequestSchema,
  },
  {
    path: "/v1/queries/search-items",
    kind: "query",
    provider: "searchItems",
    capability: TASKEN_CORE_SEARCH_ITEMS_CAPABILITY,
    schema: searchItemsRequestSchema,
  },
  {
    path: "/v1/queries/list-open-items",
    kind: "query",
    provider: "listOpenItems",
    capability: TASKEN_CORE_LIST_OPEN_ITEMS_CAPABILITY,
    schema: listOpenItemsRequestSchema,
  },
  {
    path: "/v1/queries/get-note",
    kind: "query",
    provider: "getNote",
    capability: TASKEN_CORE_GET_NOTE_CAPABILITY,
    schema: getNoteRequestSchema,
  },
  {
    path: "/v1/queries/get-conversation",
    kind: "query",
    provider: "getConversation",
    capability: TASKEN_CORE_GET_CONVERSATION_CAPABILITY,
    schema: getConversationRequestSchema,
  },
  {
    path: "/v1/queries/get-artifact-metadata",
    kind: "query",
    provider: "getArtifactMetadata",
    capability: TASKEN_CORE_GET_ARTIFACT_METADATA_CAPABILITY,
    schema: getArtifactMetadataRequestSchema,
  },
  {
    path: "/v1/queries/get-capture-image",
    kind: "query",
    provider: "getCaptureImage",
    capability: TASKEN_CORE_GET_CAPTURE_IMAGE_CAPABILITY,
    schema: getCaptureImageRequestSchema,
  },
  {
    path: "/v1/queries/get-task-image",
    kind: "query",
    provider: "getTaskImage",
    capability: TASKEN_CORE_GET_TASK_IMAGE_CAPABILITY,
    schema: getTaskImageRequestSchema,
  },
  {
    path: "/v1/queries/get-activity-entries",
    kind: "query",
    provider: "getActivityEntries",
    capability: TASKEN_CORE_GET_ACTIVITY_ENTRIES_CAPABILITY,
    schema: getActivityEntriesRequestSchema,
  },
  {
    path: "/v1/queries/get-theme-context",
    kind: "query",
    provider: "getThemeContext",
    capability: TASKEN_CORE_GET_THEME_CONTEXT_CAPABILITY,
    schema: getThemeContextRequestSchema,
  },
  {
    path: "/v1/queries/get-recent-notes",
    kind: "query",
    provider: "getRecentNotes",
    capability: TASKEN_CORE_GET_RECENT_NOTES_CAPABILITY,
    schema: getRecentNotesRequestSchema,
  },
  {
    path: "/v1/queries/search-knowledge",
    kind: "query",
    provider: "searchKnowledge",
    capability: TASKEN_CORE_SEARCH_KNOWLEDGE_CAPABILITY,
    schema: searchKnowledgeRequestSchema,
  },
  {
    path: "/v1/queries/get-knowledge-context",
    kind: "query",
    provider: "getKnowledgeContext",
    capability: TASKEN_CORE_GET_KNOWLEDGE_CONTEXT_CAPABILITY,
    schema: getKnowledgeContextRequestSchema,
  },
  {
    path: "/v1/queries/get-plan-health",
    kind: "query",
    provider: "getPlanHealth",
    capability: TASKEN_CORE_GET_PLAN_HEALTH_CAPABILITY,
    schema: getPlanHealthRequestSchema,
  },
  {
    path: "/v1/queries/get-knowledge-health",
    kind: "query",
    provider: "getKnowledgeHealth",
    capability: TASKEN_CORE_GET_KNOWLEDGE_HEALTH_CAPABILITY,
    schema: getKnowledgeHealthRequestSchema,
  },
  {
    path: "/v1/queries/get-activity",
    kind: "query",
    provider: "getActivity",
    capability: TASKEN_CORE_GET_ACTIVITY_CAPABILITY,
    schema: getActivityRequestSchema,
  },
  {
    path: "/v1/queries/get-context-subgraph",
    kind: "query",
    provider: "getContextSubgraph",
    capability: TASKEN_CORE_GET_CONTEXT_SUBGRAPH_CAPABILITY,
    schema: getContextSubgraphRequestSchema,
  },
  {
    path: "/v1/queries/get-feed-context",
    kind: "query",
    provider: "getFeedContext",
    capability: TASKEN_CORE_GET_FEED_CONTEXT_CAPABILITY,
    schema: getFeedContextRequestSchema,
  },
  {
    path: "/v1/queries/get-proposal-status",
    kind: "query",
    provider: "getProposalStatus",
    capability: TASKEN_CORE_PROPOSAL_STATUS_CAPABILITY,
    schema: proposalStatusRequestSchema,
    hiddenFromReadClients: true,
  },
  {
    path: "/v1/queries/list-proposals",
    kind: "query",
    provider: "listProposals",
    capability: TASKEN_CORE_LIST_PROPOSALS_CAPABILITY,
    schema: listProposalsRequestSchema,
    hiddenFromReadClients: true,
  },
  {
    path: "/v1/queries/export-ai-context",
    kind: "query",
    provider: "exportAiContext",
    capability: TASKEN_CORE_EXPORT_AI_CONTEXT_CAPABILITY,
    schema: exportAiContextRequestSchema,
  },
  {
    path: "/v1/commands/propose-task-work",
    kind: "command",
    provider: "proposeTaskWork",
    capability: TASKEN_CORE_PROPOSE_TASK_WORK_CAPABILITY,
    schema: proposeTaskWorkRequestSchema,
  },
  {
    path: "/v1/commands/propose-agent-session",
    kind: "command",
    provider: "proposeAgentSession",
    capability: TASKEN_CORE_PROPOSE_AGENT_SESSION_CAPABILITY,
    schema: proposeAgentSessionRequestSchema,
  },
  {
    path: "/v1/commands/propose-repository-task",
    kind: "command",
    provider: "proposeRepositoryTask",
    capability: TASKEN_CORE_PROPOSE_REPOSITORY_TASK_CAPABILITY,
    schema: proposeRepositoryTaskRequestSchema,
  },
  {
    path: "/v1/commands/propose-content",
    kind: "command",
    provider: "proposeContent",
    capability: TASKEN_CORE_PROPOSE_CONTENT_CAPABILITY,
    schema: proposeContentRequestSchema,
  },
];

const META_PATHS = new Set(["/health", "/version", "/capabilities"]);

function parseRouteRequest(route: RouteDefinition, body: unknown): unknown {
  const result = route.schema.safeParse(body);
  if (!result.success) throw new RequestValidationError(result.error.issues);
  return result.data;
}

function publicRequestError(error: unknown) {
  if (
    error instanceof Error &&
    error.name === "CorePublicError" &&
    "code" in error &&
    "status" in error
  ) {
    const details =
      "details" in error && error.details && typeof error.details === "object"
        ? (error.details as Record<string, unknown>)
        : {};
    return {
      status: Number(error.status),
      body: errorResponse(String(error.code), error.message, { details }),
    };
  }
  if (error instanceof RequestValidationError) {
    return {
      status: 400,
      body: errorResponse("VALIDATION_FAILED", "requestがschemaに適合しません。", {
        details: {
          issues: error.issues.map((issue) => {
            const value = issue as { path?: unknown; code?: unknown };
            return {
              path: Array.isArray(value.path)
                ? value.path.filter(
                    (entry) => typeof entry === "string" || typeof entry === "number",
                  )
                : [],
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
  if (
    error instanceof Error &&
    [
      "AiItemCreationError",
      "ProposeTaskWorkError",
      "ProposeRepositoryTaskError",
      "ProposeContentError",
      "ProposeAgentSessionError",
    ].includes(error.name) &&
    "code" in error &&
    error.code === "IDEMPOTENCY_CONFLICT"
  ) {
    return {
      status: 409,
      body: errorResponse("IDEMPOTENCY_CONFLICT", error.message, {
        details:
          "details" in error && error.details && typeof error.details === "object"
            ? (error.details as Record<string, unknown>)
            : {},
      }),
    };
  }
  if (error instanceof Error && error.name === "ProposeAgentSessionError" && "code" in error) {
    const details =
      "details" in error && error.details && typeof error.details === "object"
        ? (error.details as Record<string, unknown>)
        : {};
    if (error.code === "SESSION_NOT_FOUND") {
      return { status: 404, body: errorResponse("SESSION_NOT_FOUND", error.message, { details }) };
    }
    if (error.code === "SESSION_CONFLICT") {
      return { status: 409, body: errorResponse("SESSION_CONFLICT", error.message, { details }) };
    }
    if (error.code === "INVALID_REFERENCE") {
      return { status: 400, body: errorResponse("INVALID_REFERENCE", error.message, { details }) };
    }
  }
  if (
    error instanceof Error &&
    error.name === "ProposeRepositoryTaskError" &&
    "code" in error &&
    error.code === "INVALID_PROPOSAL"
  ) {
    return {
      status: 400,
      body: errorResponse("VALIDATION_FAILED", error.message, {
        details:
          "details" in error && error.details && typeof error.details === "object"
            ? (error.details as Record<string, unknown>)
            : {},
      }),
    };
  }
  if (error instanceof Error && error.name === "CoreWriteNotAllowedError") {
    const details =
      "details" in error && error.details && typeof error.details === "object"
        ? (error.details as Record<string, unknown>)
        : {};
    return {
      status: 403,
      body: errorResponse("WRITE_NOT_ALLOWED", error.message, { details }),
    };
  }
  if (error instanceof Error && error.name === "ProposeContentError" && "code" in error) {
    if (error.code === "PROPOSAL_TOO_LARGE") {
      return { status: 413, body: errorResponse("PROPOSAL_TOO_LARGE", error.message) };
    }
    if (error.code === "VALIDATION_FAILED") {
      return { status: 400, body: errorResponse("VALIDATION_FAILED", error.message) };
    }
  }
  return {
    status: 500,
    body: errorResponse("INTERNAL_ERROR", "Tasken Core queryの処理に失敗しました。"),
  };
}

function bearerMatches(header: string | undefined, token: string) {
  const prefix = "Bearer ";
  if (!header?.startsWith(prefix)) return false;
  const provided = Buffer.from(header.slice(prefix.length));
  const expected = Buffer.from(token);
  return provided.length === expected.length && timingSafeEqual(provided, expected);
}

async function requestBody(request: IncomingMessage, maxBytes = MAX_BODY_BYTES): Promise<unknown> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buffer.length;
    if (size > maxBytes) {
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

async function atomicWriteDiscovery(
  filePath: string,
  document: DiscoveryDocument | EndpointDocument,
) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  const temporary = `${filePath}.${process.pid}.${randomBytes(8).toString("hex")}.tmp`;
  try {
    await fs.writeFile(temporary, `${JSON.stringify(document)}\n`, {
      encoding: "utf8",
      flag: "wx",
      mode: 0o600,
    });
    try {
      await fs.chmod(temporary, 0o600);
    } catch {
      // Windows ACL is inherited from userData; chmod is best effort there.
    }
    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        await fs.rename(temporary, filePath);
        break;
      } catch (error) {
        if (
          process.platform !== "win32" ||
          (error as NodeJS.ErrnoException).code !== "EPERM" ||
          attempt === 2
        ) {
          throw error;
        }
        // Retry a brief Windows rename denial without removing the current discovery.
        await setTimeout(50);
      }
    }
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
  private readonly endpointPath: string;
  private server: http.Server | null = null;
  private writeGate: WriteGate | null = null;
  private routes = new Map<string, RouteDefinition>();
  private directWriteEnabled: (() => boolean) | null = null;

  constructor(options: TaskenCoreHostOptions) {
    this.options = options;
    this.discoveryPath = path.join(options.userDataPath, TASKEN_CORE_DISCOVERY_FILE);
    this.endpointPath = path.join(
      options.userDataPath,
      TASKEN_CORE_ENDPOINT_DIR,
      TASKEN_CORE_ENDPOINT_FILE,
    );
  }

  /**
   * `directWriteEnabled`はDesktopだけが渡す。経路は常に公開し、使えるかは本人の設定を要求のたびに読む
   * （設定の切り替えでCoreを作り直さない）。`/capabilities`にも今の値を添え、AIが試す前に分かるようにする。
   */
  enableAiItemCreation(
    provider: QueryProvider<AiItemCreationRequest, AiItemCreationResponse>,
    directWriteEnabled?: () => boolean,
  ) {
    if (this.server) throw new Error("Core起動後の権限変更はできません。");
    this.options.createAiItem = provider;
    this.directWriteEnabled = directWriteEnabled || null;
  }

  /** NAS replicaだけが、同期の状態と鮮度を読み取りに公開する。Core起動前に一度だけ呼ぶ。 */
  enableSourceStatus(provider: QueryProvider<GetSourceStatusRequest, GetSourceStatusResponse>) {
    if (this.server) throw new Error("Core起動後の権限変更はできません。");
    this.options.getSourceStatus = provider;
  }

  /**
   * NAS replicaだけが、書き込みの経路を処理の前に断れるようにする。Core起動前に一度だけ呼ぶ。
   * checkは経路ごとに呼ばれ、nullなら通し、コードを返したら409で断る。読み取りの経路は対象外。
   */
  enableWriteGate(check: WriteGate) {
    if (this.server) throw new Error("Core起動後の権限変更はできません。");
    this.writeGate = check;
  }

  private capabilities() {
    return [...new Set([...this.routes.values()].map((route) => route.capability))];
  }

  async start() {
    if (this.server) throw new Error("Tasken Core hostは起動済みです。");
    // providerを渡された経路だけを公開する。起動時に一度だけ決め、稼働中は変えない。
    this.routes = new Map(
      ROUTES.filter((route) => this.options[route.provider]).map((route) => [route.path, route]),
    );
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
    if (!address || typeof address === "string")
      throw new Error("Tasken Core addressを取得できませんでした。");
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
    try {
      await atomicWriteDiscovery(this.endpointPath, {
        schema_version: TASKEN_CORE_DISCOVERY_SCHEMA_VERSION,
        api_version: discovery.api_version,
        origin: discovery.origin,
        pid: discovery.pid,
        started_at: discovery.started_at,
      });
    } catch (error) {
      await this.stop();
      throw error;
    }
    return { origin: discovery.origin, discoveryPath: this.discoveryPath };
  }

  async stop() {
    await this.closeServer();
    await fs.rm(this.discoveryPath, { force: true });
    await fs.rm(this.endpointPath, { force: true });
  }

  private async closeServer() {
    const server = this.server;
    this.server = null;
    if (!server) return;
    await new Promise<void>((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
      // `server.close()` alone can wait indefinitely for a child MCP process
      // that still owns a keep-alive or partially-open request on Windows.
      // Start graceful shutdown first, then retire every remaining connection.
      server.closeIdleConnections?.();
      server.closeAllConnections?.();
    });
  }

  private async handle(request: IncomingMessage, response: ServerResponse) {
    try {
      const authorization = request.headers.authorization;
      const fullAccess = bearerMatches(authorization, this.token);
      const readClient = fullAccess
        ? null
        : await findCoreClient(
            this.options.userDataPath,
            authorization?.startsWith("Bearer ") ? authorization.slice("Bearer ".length) : "",
          );
      if (!fullAccess && !readClient) {
        json(response, 401, errorResponse("UNAUTHORIZED", "認証できません。"));
        return;
      }
      const url = request.url || "";
      const route = this.routes.get(url);
      if ((route || META_PATHS.has(url)) && request.method !== (route ? "POST" : "GET")) {
        response.setHeader("allow", route ? "POST" : "GET");
        json(response, 405, errorResponse("METHOD_NOT_ALLOWED", "methodが許可されていません。"));
        return;
      }
      if (readClient && route && (route.kind === "command" || route.hiddenFromReadClients)) {
        json(
          response,
          403,
          errorResponse("READ_ONLY_CLIENT", "このclient tokenは読み取り専用です。"),
        );
        return;
      }
      if (request.method === "GET" && url === "/health") {
        json(response, 200, { status: "ok", api_version: TASKEN_CORE_API_VERSION });
        return;
      }
      if (request.method === "GET" && url === "/version") {
        json(response, 200, { api_version: TASKEN_CORE_API_VERSION });
        return;
      }
      if (request.method === "GET" && url === "/capabilities") {
        json(response, 200, {
          capabilities: this.capabilities(),
          ...(this.directWriteEnabled
            ? { direct_write_enabled: this.directWriteEnabled() === true }
            : {}),
        });
        return;
      }
      if (request.method === "POST" && route) {
        if (
          request.headers["content-type"]?.split(";", 1)[0].trim().toLowerCase() !==
          "application/json"
        ) {
          json(
            response,
            415,
            errorResponse("UNSUPPORTED_MEDIA_TYPE", "application/jsonを指定してください。"),
          );
          return;
        }
        // 古いDesktopが取り込めない差分を書かないよう、書き込みは処理の前に断る（dry_runも含む）。
        const blocked = route.kind === "command" ? this.writeGate?.(url) : null;
        if (blocked) {
          json(response, 409, errorResponse(blocked, WRITE_GATE_MESSAGES[blocked]));
          return;
        }
        const allowsNoteProposalImages =
          url === "/v1/commands/propose-content" &&
          request.headers["x-tasken-proposal-images"] === "1";
        const body = parseRouteRequest(
          route,
          await requestBody(
            request,
            allowsNoteProposalImages ? MAX_NOTE_PROPOSAL_WITH_IMAGES_BODY_BYTES : MAX_BODY_BYTES,
          ),
        );
        const provider = this.options[route.provider] as unknown as QueryProvider<unknown, unknown>;
        json(response, 200, provider.execute(body));
        return;
      }
      json(response, 404, errorResponse("NOT_FOUND", "endpointがありません。"));
    } catch (error) {
      const mapped = publicRequestError(error);
      if (mapped.status === 413) {
        response.setHeader("connection", "close");
        json(response, mapped.status, mapped.body);
        response.once("finish", () => request.destroy());
      } else json(response, mapped.status, mapped.body);
    }
  }
}
