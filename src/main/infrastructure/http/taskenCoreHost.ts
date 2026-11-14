import {
  aiNoteEditRequestSchema,
  aiProposalDecisionRequestSchema,
  type AiNoteEditRequest,
  type AiNoteEditResponse,
  type AiProposalDecisionRequest,
  type AiProposalDecisionResponse,
  aiChangeUndoRequestSchema,
  aiTaskChangeRequestSchema,
  type AiChangeUndoRequest,
  type AiChangeUndoResponse,
  type AiTaskChangeRequest,
  type AiTaskChangeResponse,
  aiItemCreationRequestSchema,
  aiTaskStartRequestSchema,
  type AiTaskStartRequest,
  type AiItemCreationRequest,
  type AiItemCreationResponse,
  getSourceStatusRequestSchema,
  type GetSourceStatusRequest,
  type GetSourceStatusResponse,
  recordAgentWorkRequestSchema,
  type RecordAgentWorkRequest,
  type RecordAgentWorkResponse,
} from "../../../shared/contracts/task/public.ts";
import { randomBytes, timingSafeEqual } from "node:crypto";
import fs from "node:fs/promises";
import http, { type IncomingMessage, type ServerResponse } from "node:http";
import path from "node:path";
import { setTimeout } from "node:timers/promises";
import * as z from "zod/v4";
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
  taskQuerySchema,
} from "../../../shared/contracts/task/public.ts";
import {
  TASKEN_CORE_AI_DIRECT_WRITE_CAPABILITY,
  TASKEN_CORE_AI_TASK_CHANGE_CAPABILITY,
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
  TASKEN_CORE_RECORD_AGENT_WORK_CAPABILITY,
  TASKEN_CORE_PROPOSE_AGENT_SESSION_CAPABILITY,
  TASKEN_CORE_PROPOSE_REPOSITORY_TASK_CAPABILITY,
  TASKEN_CORE_PROPOSE_CONTENT_CAPABILITY,
  TASKEN_CORE_LIST_OPEN_ITEMS_CAPABILITY,
  TASKEN_CORE_LIST_AGENT_READY_TASKS_CAPABILITY,
  TASKEN_CORE_RESOLVE_REPOSITORY_CONTEXT_CAPABILITY,
  TASKEN_CORE_SEARCH_ITEMS_CAPABILITY,
  TASKEN_CORE_DISCOVERY_FILE,
  TASKEN_CORE_DISCOVERY_SCHEMA_VERSION,
  TASKEN_CORE_TASK_START_WORK_CAPABILITY,
  TASKEN_CORE_TASK_QUERY_CAPABILITY,
  taskenCorePublicError,
} from "../../../shared/contracts/core/public.mjs";
import { findCoreClient } from "./coreClientTokens.mjs";
import { RequestStats } from "./requestStats.ts";

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
// 計測の置き場。本体のDBとは別のファイルにする理由はrequestStats.ts。
const REQUEST_STATS_FILE = "request-stats.sqlite";
const STATS_PATH = "/v1/stats";
const STATS_RECORD_PATH = "/v1/stats/record";
const STATS_DEFAULT_DAYS = 7;
const STATS_MAX_DAYS = 366;

export interface ListAgentReadyTasksProvider {
  execute(request: ListAgentReadyTasksRequest): ListAgentReadyTasksResponse;
}

interface QueryProvider<Request, Response> {
  execute(request: Request): Response;
}

export interface TaskenCoreHostOptions {
  userDataPath: string;
  createAiItem?: QueryProvider<AiItemCreationRequest, AiItemCreationResponse>;
  changeTask?: QueryProvider<AiTaskChangeRequest, AiTaskChangeResponse>;
  undoChange?: QueryProvider<AiChangeUndoRequest, AiChangeUndoResponse>;
  decideProposal?: QueryProvider<AiProposalDecisionRequest, AiProposalDecisionResponse>;
  editNote?: QueryProvider<AiNoteEditRequest, AiNoteEditResponse>;
  getSourceStatus?: QueryProvider<GetSourceStatusRequest, GetSourceStatusResponse>;
  startAiTaskWork?: QueryProvider<AiTaskStartRequest, TaskCommandResponse>;
  taskQuery?: QueryProvider<unknown, TaskQueryResponse>;
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
  recordAgentWork?: QueryProvider<RecordAgentWorkRequest, RecordAgentWorkResponse>;
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

// 計測のために、jsonが書いたerror codeを応答に結びつけて覚えておく（応答の本文は読み直さない）。
const responseErrorCodes = new WeakMap<ServerResponse, string>();

function json(response: ServerResponse, status: number, body: unknown) {
  const encoded = JSON.stringify(body);
  const code = (body as { error?: { code?: unknown } } | null)?.error?.code;
  if (typeof code === "string") responseErrorCodes.set(response, code);
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

/**
 * 管理用の口（/v1/admin/...）。discoveryの全権tokenを持つ呼び出し（同じhostの運用者）だけが使え、
 * 読み取り専用のclient tokenでは403。capabilityには出さない（AIの道具ではない）。
 * NASのMobile Gatewayのペアリングコードの発行など、稼働中のプロセスの中の状態を操作するために使う。
 */
export type AdminHandler = (body: unknown) => unknown;
const ADMIN_PATH_PREFIX = "/v1/admin/";

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
    path: "/v1/commands/change-task",
    kind: "command",
    provider: "changeTask",
    capability: TASKEN_CORE_AI_TASK_CHANGE_CAPABILITY,
    schema: aiTaskChangeRequestSchema,
  },
  {
    path: "/v1/commands/decide-proposal",
    kind: "command",
    provider: "decideProposal",
    capability: TASKEN_CORE_AI_DIRECT_WRITE_CAPABILITY,
    schema: aiProposalDecisionRequestSchema,
  },
  {
    path: "/v1/commands/edit-note",
    kind: "command",
    provider: "editNote",
    capability: TASKEN_CORE_AI_DIRECT_WRITE_CAPABILITY,
    schema: aiNoteEditRequestSchema,
  },
  {
    path: "/v1/commands/undo-change",
    kind: "command",
    provider: "undoChange",
    capability: TASKEN_CORE_AI_TASK_CHANGE_CAPABILITY,
    schema: aiChangeUndoRequestSchema,
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
    // AIの作業（#751）。actor・書き手・経路はCoreが決め、新しい1件を足すだけ。
    path: "/v1/commands/record-agent-work",
    kind: "command",
    provider: "recordAgentWork",
    capability: TASKEN_CORE_RECORD_AGENT_WORK_CAPABILITY,
    schema: recordAgentWorkRequestSchema,
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

const STATS_METHODS = new Set(["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"]);

/**
 * MCP側（stdio・HTTP）が送る計測の行。入口の名前と呼び手は決まった集合の形だけを受け、題名・本文・
 * IDなどが紛れ込む余地を閉じる。1件でも外れたらまとめて断り、何も記録しない。
 */
const statsRowSchema = z.strictObject({
  entry: z
    .string()
    .regex(
      /^(POST \/mcp:(tasken\.[a-z][a-z0-9_]{0,63}|tools\/list|resources\/list|resources\/read|resources\/templates\/list|prompts\/list|prompts\/get|completion\/complete|logging\/setLevel|\{unknown\})|(GET|HEAD|POST|PUT|PATCH|DELETE|OPTIONS|OTHER) (\/mcp|\/api\/v1|\/api\/v1\/\{tool\}|\/api\/stats|\/health|\{unknown\}))$/,
    ),
  caller: z
    .string()
    .regex(
      /^(anonymous|local|mcp:local\/[a-z0-9._-]{1,32}|mcp:[A-Za-z0-9_-]{1,64}|token:[A-Za-z0-9_-]{1,64})$/,
    ),
  status: z.number().int().min(100).max(599),
  code: z.string().regex(/^([A-Z][A-Z0-9_]{0,47})?$/),
  us: z.number().int().min(0).max(3_600_000_000),
  bytes: z.number().int().min(0).max(1_000_000_000),
});
const statsRecordRequestSchema = z.strictObject({
  rows: z.array(statsRowSchema).min(1).max(100),
});

/** MCPやGatewayの側と同じく、決まった形の大文字の名前だけを残す（成功は空）。 */
function statsCode(code: string | undefined) {
  if (!code) return "";
  const upper = code.toUpperCase();
  return /^[A-Z][A-Z0-9_]{0,47}$/.test(upper) ? upper : "OTHER";
}

function statsMethod(method: string | undefined) {
  return method && STATS_METHODS.has(method) ? method : "OTHER";
}

/** `/v1/stats?days=N`のdays。省略は7、1〜366の整数以外は不正。 */
function statsDays(searchParams: URLSearchParams): number {
  const values = searchParams.getAll("days");
  if (values.length === 0) return STATS_DEFAULT_DAYS;
  const days = values.length === 1 && /^[0-9]{1,4}$/.test(values[0]) ? Number(values[0]) : 0;
  if (days < 1 || days > STATS_MAX_DAYS) {
    throw new RequestValidationError([{ path: ["days"], code: "invalid_value" }]);
  }
  return days;
}

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
  private adminRoutes = new Map<string, AdminHandler>();
  /** 入口ごとの計測。DBは最初に書く（または読む）ときまで開かない。MCPやMobile Gatewayもここへ送る。 */
  readonly stats: RequestStats;

  constructor(options: TaskenCoreHostOptions) {
    this.options = options;
    this.stats = new RequestStats({
      filePath: path.join(options.userDataPath, REQUEST_STATS_FILE),
    });
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

  /**
   * 既存Taskの直接変更と取り消し。Desktopと、明示したNAS replicaが公開する。
   * 使えるかの判定（Desktopは本人の設定）はproviderが持つ。
   */
  enableAiTaskChange(providers: {
    changeTask: QueryProvider<AiTaskChangeRequest, AiTaskChangeResponse>;
    undoChange: QueryProvider<AiChangeUndoRequest, AiChangeUndoResponse>;
  }) {
    if (this.server) throw new Error("Core起動後の権限変更はできません。");
    this.options.changeTask = providers.changeTask;
    this.options.undoChange = providers.undoChange;
  }

  /** Desktopだけが、取り消せない直接の書き込み（Noteの編集と採否）を公開する。 */
  enableAiDirectWrite(providers: {
    decideProposal: QueryProvider<AiProposalDecisionRequest, AiProposalDecisionResponse>;
    editNote: QueryProvider<AiNoteEditRequest, AiNoteEditResponse>;
  }) {
    if (this.server) throw new Error("Core起動後の権限変更はできません。");
    this.options.decideProposal = providers.decideProposal;
    this.options.editNote = providers.editNote;
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

  /** 管理用の口を足す。Core起動前に呼ぶ。pathは/v1/admin/で始める。 */
  enableAdminRoutes(handlers: Record<string, AdminHandler>) {
    if (this.server) throw new Error("Core起動後の権限変更はできません。");
    for (const [route, handler] of Object.entries(handlers)) {
      if (!route.startsWith(ADMIN_PATH_PREFIX)) throw new Error("管理用の口のpathが不正です。");
      this.adminRoutes.set(route, handler);
    }
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
    this.stats.close();
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

  /**
   * 入口の名前は、既知の経路（ROUTES・META_PATHS・管理用の口・/v1/stats）に完全一致したpathだけから作る。
   * それ以外はqueryも含めて{unknown}にし、題名・検索語・IDが入口の名前に混ざらないようにする。
   */
  private statsEntry(request: IncomingMessage) {
    const pathname = (request.url || "").split("?", 1)[0];
    const known =
      ROUTES.some((route) => route.path === pathname) ||
      META_PATHS.has(pathname) ||
      this.adminRoutes.has(pathname) ||
      pathname === STATS_PATH;
    return `${statsMethod(request.method)} ${known ? pathname : "{unknown}"}`;
  }

  private handle(request: IncomingMessage, response: ServerResponse) {
    const startedAt = process.hrtime.bigint();
    const context = { caller: "anonymous" };
    response.once("finish", () => {
      try {
        // 計測の書き込み自体は記録しない（記録が記録を呼ぶのを避ける）。
        if ((request.url || "").split("?", 1)[0] === STATS_RECORD_PATH) return;
        // 全権tokenを使うのはTasken自身の部品（MCPの橋渡し・管理の道具・statsの読み出し）で、
        // その要求はMCP側の行と二重になる。「1つの要求は1行」にするため数えず、
        // 読み取りclient token（token:<名前>）と認証できない要求（anonymous）だけを数える。
        if (context.caller === "local") return;
        const length = Number(response.getHeader("content-length"));
        this.stats.record({
          entry: this.statsEntry(request),
          caller: context.caller,
          status: response.statusCode,
          code: statsCode(responseErrorCodes.get(response)),
          us: Number((process.hrtime.bigint() - startedAt) / 1000n),
          bytes: Number.isFinite(length) ? length : 0,
        });
      } catch {
        // 計測の失敗で応答を変えない。
      }
    });
    return this.dispatch(request, response, context);
  }

  /** `/v1/stats`（読む）と`/v1/stats/record`（MCPからの書き込み）。どちらもcapabilityには載せない。 */
  private async handleStats(
    request: IncomingMessage,
    response: ServerResponse,
    url: string,
    pathname: string,
    fullAccess: boolean,
  ) {
    const recording = pathname === STATS_RECORD_PATH;
    const method = recording ? "POST" : "GET";
    if (request.method !== method) {
      response.setHeader("allow", method);
      json(response, 405, errorResponse("METHOD_NOT_ALLOWED", "methodが許可されていません。"));
      return;
    }
    if (!recording) {
      const days = statsDays(new URL(url, `http://${LOOPBACK_HOST}`).searchParams);
      json(response, 200, this.stats.read(days));
      return;
    }
    if (!fullAccess) {
      json(
        response,
        403,
        errorResponse("READ_ONLY_CLIENT", "このclient tokenは読み取り専用です。"),
      );
      return;
    }
    if (
      request.headers["content-type"]?.split(";", 1)[0].trim().toLowerCase() !== "application/json"
    ) {
      json(
        response,
        415,
        errorResponse("UNSUPPORTED_MEDIA_TYPE", "application/jsonを指定してください。"),
      );
      return;
    }
    const parsed = statsRecordRequestSchema.safeParse(await requestBody(request));
    if (!parsed.success) throw new RequestValidationError(parsed.error.issues);
    for (const row of parsed.data.rows) this.stats.record(row);
    json(response, 200, { recorded: parsed.data.rows.length });
  }

  private async dispatch(
    request: IncomingMessage,
    response: ServerResponse,
    context: { caller: string },
  ) {
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
      context.caller = fullAccess ? "local" : `token:${readClient?.name}`;
      const url = request.url || "";
      const [pathname] = url.split("?", 1);
      if (pathname === STATS_PATH || pathname === STATS_RECORD_PATH) {
        await this.handleStats(request, response, url, pathname, fullAccess);
        return;
      }
      const adminHandler = this.adminRoutes.get(url);
      if (adminHandler) {
        if (!fullAccess) {
          json(
            response,
            403,
            errorResponse("FORBIDDEN", "管理用の口は全権のtokenだけが使えます。"),
          );
          return;
        }
        if (request.method !== "POST") {
          response.setHeader("allow", "POST");
          json(response, 405, errorResponse("METHOD_NOT_ALLOWED", "methodが許可されていません。"));
          return;
        }
        json(response, 200, adminHandler(await requestBody(request)));
        return;
      }
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
