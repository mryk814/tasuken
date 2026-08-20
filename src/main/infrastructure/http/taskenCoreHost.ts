import { randomBytes, timingSafeEqual } from "node:crypto";
import fs from "node:fs/promises";
import http, { type IncomingMessage, type ServerResponse } from "node:http";
import path from "node:path";

import type { ListAgentReadyTasksRequest, ListAgentReadyTasksResponse } from "../../../shared/contracts/task/public.ts";
import {
  TASKEN_CORE_API_VERSION,
  TASKEN_CORE_CAPABILITY,
  TASKEN_CORE_DISCOVERY_FILE,
  TASKEN_CORE_DISCOVERY_SCHEMA_VERSION,
} from "../../../shared/contracts/core/public.mjs";

const LOOPBACK_HOST = "127.0.0.1";
const MAX_BODY_BYTES = 64 * 1024;
const REQUEST_TIMEOUT_MS = 5_000;

export interface ListAgentReadyTasksProvider {
  execute(request: ListAgentReadyTasksRequest): ListAgentReadyTasksResponse;
}

export interface TaskenCoreHostOptions {
  userDataPath: string;
  listAgentReadyTasks: ListAgentReadyTasksProvider;
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
      capabilities: [TASKEN_CORE_CAPABILITY],
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
        json(response, 401, { error: { code: "UNAUTHORIZED", message: "認証できません。" } });
        return;
      }
      const knownPaths = new Set(["/health", "/version", "/capabilities", "/v1/queries/list-agent-ready-tasks"]);
      if (knownPaths.has(request.url || "")
        && request.method !== (request.url === "/v1/queries/list-agent-ready-tasks" ? "POST" : "GET")) {
        response.setHeader("allow", request.url === "/v1/queries/list-agent-ready-tasks" ? "POST" : "GET");
        json(response, 405, { error: { code: "METHOD_NOT_ALLOWED", message: "methodが許可されていません。" } });
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
        json(response, 200, { capabilities: [TASKEN_CORE_CAPABILITY] });
        return;
      }
      if (request.method === "POST" && request.url === "/v1/queries/list-agent-ready-tasks") {
        if (request.headers["content-type"]?.split(";", 1)[0].trim().toLowerCase() !== "application/json") {
          json(response, 415, { error: { code: "UNSUPPORTED_MEDIA_TYPE", message: "application/jsonを指定してください。" } });
          return;
        }
        const body = await requestBody(request);
        json(response, 200, this.options.listAgentReadyTasks.execute(body as ListAgentReadyTasksRequest));
        return;
      }
      json(response, 404, { error: { code: "NOT_FOUND", message: "endpointがありません。" } });
    } catch (error) {
      const message = error instanceof Error ? error.message : "";
      if (message === "BODY_TOO_LARGE") {
        response.setHeader("connection", "close");
        json(response, 413, { error: { code: message, message: "request bodyが大きすぎます。" } });
        response.once("finish", () => request.destroy());
      }
      else if (message === "INVALID_JSON") json(response, 400, { error: { code: message, message: "JSONが不正です。" } });
      else json(response, 400, { error: { code: "INVALID_REQUEST", message: "requestが不正です。" } });
    }
  }
}
