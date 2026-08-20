import { randomBytes, timingSafeEqual } from "node:crypto";
import fs from "node:fs/promises";
import http, { type IncomingMessage, type ServerResponse } from "node:http";
import path from "node:path";

import type {
  FindTasksForRepositoryResponse,
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
} from "../../../shared/contracts/task/public.ts";
import {
  getTaskAssignmentRequestSchema,
  getTaskContextRequestSchema,
  listAgentReadyTasksRequestSchema,
  listOpenItemsRequestSchema,
  repositoryLookupRequestSchema,
  searchItemsRequestSchema,
} from "../../../shared/contracts/task/public.ts";
import {
  TASKEN_CORE_API_VERSION,
  TASKEN_CORE_FIND_TASKS_FOR_REPOSITORY_CAPABILITY,
  TASKEN_CORE_GET_TASK_ASSIGNMENT_CAPABILITY,
  TASKEN_CORE_GET_TASK_CONTEXT_CAPABILITY,
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
  getTaskAssignment?: QueryProvider<GetTaskAssignmentRequest, GetTaskAssignmentResponse>;
  getTaskContext?: QueryProvider<GetTaskContextRequest, GetTaskContextResponse>;
  searchItems?: QueryProvider<SearchItemsRequest, SearchItemsResponse>;
  listOpenItems?: QueryProvider<ListOpenItemsRequest, ListOpenItemsResponse>;
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

function parseQueryRequest(url: string, body: unknown): unknown {
  const schema = url === "/v1/queries/list-agent-ready-tasks" ? listAgentReadyTasksRequestSchema
    : url === "/v1/queries/resolve-repository-context" || url === "/v1/queries/find-tasks-for-repository" ? repositoryLookupRequestSchema
      : url === "/v1/queries/get-task-assignment" ? getTaskAssignmentRequestSchema
        : url === "/v1/queries/get-task-context" ? getTaskContextRequestSchema
          : url === "/v1/queries/search-items" ? searchItemsRequestSchema
            : listOpenItemsRequestSchema;
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
      ...(this.options.getTaskAssignment ? [TASKEN_CORE_GET_TASK_ASSIGNMENT_CAPABILITY] : []),
      ...(this.options.getTaskContext ? [TASKEN_CORE_GET_TASK_CONTEXT_CAPABILITY] : []),
      ...(this.options.searchItems ? [TASKEN_CORE_SEARCH_ITEMS_CAPABILITY] : []),
      ...(this.options.listOpenItems ? [TASKEN_CORE_LIST_OPEN_ITEMS_CAPABILITY] : []),
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
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
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
        ...(this.options.getTaskAssignment ? ["/v1/queries/get-task-assignment"] : []),
        ...(this.options.getTaskContext ? ["/v1/queries/get-task-context"] : []),
        ...(this.options.searchItems ? ["/v1/queries/search-items"] : []),
        ...(this.options.listOpenItems ? ["/v1/queries/list-open-items"] : []),
      ]);
      const knownPaths = new Set(["/health", "/version", "/capabilities", ...queryPaths]);
      if (knownPaths.has(request.url || "")
        && request.method !== (queryPaths.has(request.url || "") ? "POST" : "GET")) {
        response.setHeader("allow", queryPaths.has(request.url || "") ? "POST" : "GET");
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
      if (request.method === "POST" && queryPaths.has(request.url || "")) {
        if (request.headers["content-type"]?.split(";", 1)[0].trim().toLowerCase() !== "application/json") {
          json(response, 415, errorResponse("UNSUPPORTED_MEDIA_TYPE", "application/jsonを指定してください。"));
          return;
        }
        const body = parseQueryRequest(request.url || "", await requestBody(request));
        if (request.url === "/v1/queries/list-agent-ready-tasks") {
          json(response, 200, this.options.listAgentReadyTasks.execute(body as ListAgentReadyTasksRequest));
        } else if (request.url === "/v1/queries/resolve-repository-context") {
          json(response, 200, this.options.resolveRepositoryContext!.execute(body as RepositoryLookupRequest));
        } else if (request.url === "/v1/queries/find-tasks-for-repository") {
          json(response, 200, this.options.findTasksForRepository!.execute(body as RepositoryLookupRequest));
        } else if (request.url === "/v1/queries/get-task-context") {
          json(response, 200, this.options.getTaskContext!.execute(body as GetTaskContextRequest));
        } else if (request.url === "/v1/queries/search-items") {
          json(response, 200, this.options.searchItems!.execute(body as SearchItemsRequest));
        } else if (request.url === "/v1/queries/list-open-items") {
          json(response, 200, this.options.listOpenItems!.execute(body as ListOpenItemsRequest));
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
