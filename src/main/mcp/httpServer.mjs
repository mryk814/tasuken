import { createHash, timingSafeEqual } from "node:crypto";
import { readFile, stat } from "node:fs/promises";
import { createServer } from "node:http";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";

import {
  TASKEN_CORE_TASK_START_WORK_CAPABILITY,
  coreWriteProfile,
} from "../../shared/contracts/core/public.mjs";
import { createTaskenMcpServer } from "./server.mjs";
import { TaskenCoreClient } from "./taskenCoreClient.mjs";
import { MCP_TOOL_REQUIREMENTS, parseMcpToolsets } from "./toolAvailability.mjs";

const digest = (value) => createHash("sha256").update(value).digest();
const MAX_BODY_BYTES = 35 * 1024 * 1024;

async function readJsonBody(request) {
  const chunks = [];
  let size = 0;
  if (Number(request.headers["content-length"]) > MAX_BODY_BYTES) {
    throw new Error("BODY_TOO_LARGE");
  }
  for await (const chunk of request.iterator({ destroyOnReturn: false })) {
    size += chunk.length;
    if (size > MAX_BODY_BYTES) throw new Error("BODY_TOO_LARGE");
    chunks.push(chunk);
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

/**
 * isErrorの結果の`error.code`をHTTP statusへ写す。personal-infrastructureのawai
 * (`/api/v1/<tool>`)と同じ対応にして、Muse・Grok Botが両方を同じ扱いで呼べるようにする。
 * Taskのtransport(taskHttpAdapter)の対応(FORBIDDEN・INVALID_TRANSITION・UNAVAILABLE・INTERNAL_ERROR)とも揃える。
 * 結果が`{error}`の形でないisErrorは、SDKの入力検証の失敗（-32602）だけを呼び方の誤りとして400にし、
 * それ以外（tool内部の想定外の例外）は500にする。サーバー側の不具合を「要求の誤り」に見せないため。
 */
export function apiErrorStatus(value) {
  const code = value?.error?.code;
  if (typeof code !== "string") {
    const text = typeof value?.text === "string" ? value.text : "";
    return /-32602|Input validation error/i.test(text) ? 400 : 500;
  }
  const upper = code.toUpperCase();
  // INVALID_*を503にする規則より先に、入力の誤りの400を判定する。
  if (["VALIDATION_FAILED", "INVALID_JSON"].includes(upper)) return 400;
  if (["WRITE_NOT_ALLOWED", "FORBIDDEN"].includes(upper)) return 403;
  if (upper.includes("NOT_FOUND")) return 404;
  if (["IDEMPOTENCY_CONFLICT", "CONFLICT", "STALE_VERSION", "INVALID_TRANSITION"].includes(upper))
    return 409;
  if (["PROPOSAL_TOO_LARGE", "BODY_TOO_LARGE"].includes(upper)) return 413;
  if (
    [
      "CORE_UNAVAILABLE",
      "CAPABILITY_UNAVAILABLE",
      "VERSION_MISMATCH",
      "CORE_REQUEST_FAILED",
      "UNAUTHORIZED",
      "INVALID_RESPONSE",
      "INVALID_DISCOVERY",
      "DISCOVERY_OWNER_MISMATCH",
      "DISCOVERY_PERMISSION_INVALID",
      "UNAVAILABLE",
    ].includes(upper)
  )
    return 503;
  if (upper === "INTERNAL_ERROR") return 500;
  // 表に無いcodeでも、サーバー側の一時的な失敗を「要求の誤り」と読ませない（botが再送を諦めて失われる）。
  if (value.error.retryable === true) return 503;
  if (typeof value.error.status === "number" && value.error.status >= 500) return 500;
  return 422;
}

function apiResultValue(result) {
  if (result.structuredContent !== undefined) return result.structuredContent;
  const text = result.content?.find((part) => part.type === "text")?.text ?? "";
  try {
    return JSON.parse(text);
  } catch {
    return { text };
  }
}

/**
 * `/api/v1/<name>`: 要求ごとのMCP serverをin-memoryで繋いでtools/list・tools/callを通す。
 * ツールの関数を直に呼ばないのは、readOnly・toolsets・capabilityの絞り込みが
 * 「一覧から外す」形でしか効かないため（直に呼ぶと素通りする）。
 */
async function callApiTool(server, clientName, name, args) {
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const mcpClient = new Client({ name: "tasken-http-api", version: "1.0.0" });
  try {
    await server.connect(serverTransport);
    await mcpClient.connect(clientTransport);
    const tools = [];
    let cursor;
    do {
      const page = await mcpClient.listTools(cursor ? { cursor } : undefined);
      tools.push(...page.tools);
      cursor = page.nextCursor;
    } while (cursor);
    const tool = tools.find((entry) => entry.name === name);
    if (!tool) {
      return MCP_TOOL_REQUIREMENTS[name]
        ? { status: 403, body: { error: "tool_not_allowed" } }
        : { status: 404, body: { error: "unknown_tool" } };
    }
    // MCPの入力は未知のキーを黙って捨てるため、綴り違い(idempotencyKey等)が通ってしまうのを断る。
    const properties = tool.inputSchema?.properties ?? {};
    const unknown = Object.keys(args).filter((key) => !Object.hasOwn(properties, key));
    if (unknown.length > 0) {
      return { status: 400, body: { error: "unknown_arguments", arguments: unknown } };
    }
    const isWrite = MCP_TOOL_REQUIREMENTS[name]?.access !== "read";
    // 提案系は鍵が無いと毎回新しく作るので、再送でFeed投稿やProposalが増えるのを防ぐ。
    if (isWrite && "idempotency_key" in properties && args.idempotency_key === undefined) {
      return { status: 400, body: { error: "idempotency_key_required" } };
    }
    // callerが必須のtoolでも本文に書かせない。bridgeが認証済みのclient名で上書きする。
    const callArgs = isWrite && "caller" in properties ? { ...args, caller: clientName } : args;
    let result;
    try {
      result = await mcpClient.callTool({ name, arguments: callArgs });
    } catch (error) {
      // 古いSDKは入力検証の失敗をInvalidParamsの例外で返す。
      if (error?.code === -32602) return { status: 400, body: { error: "invalid_arguments" } };
      throw error;
    }
    const value = apiResultValue(result);
    return { status: result.isError ? apiErrorStatus(value) : 200, body: value };
  } finally {
    await mcpClient.close().catch(() => {});
    await server.close().catch(() => {});
  }
}

/** HTTP credentials are independent of the privileged Core discovery token. */
export function parseHttpClients(value) {
  const invalid = () => {
    throw new Error("MCP_HTTP_CLIENTS_INVALID");
  };
  if (!value || typeof value !== "object" || Array.isArray(value)) invalid();
  const entries = Object.entries(value);
  if (entries.length === 0 || entries.length > 100) invalid();
  const tokens = new Set();
  return entries.map(([name, client]) => {
    if (
      !/^[a-zA-Z0-9_-]{1,64}$/.test(name) ||
      !client ||
      typeof client !== "object" ||
      Array.isArray(client) ||
      Object.keys(client).some(
        (key) => !["token", "readOnly", "toolsets", "allowStart"].includes(key),
      ) ||
      typeof client.token !== "string" ||
      !/^[A-Za-z0-9_-]{43}$/.test(client.token) ||
      Buffer.from(client.token, "base64url").toString("base64url") !== client.token ||
      (client.readOnly !== undefined && typeof client.readOnly !== "boolean") ||
      (client.allowStart !== undefined && typeof client.allowStart !== "boolean") ||
      tokens.has(client.token)
    )
      invalid();
    let toolsets;
    try {
      if (client.toolsets !== undefined && !Array.isArray(client.toolsets)) invalid();
      if (client.toolsets !== undefined) toolsets = parseMcpToolsets(client.toolsets);
    } catch {
      invalid();
    }
    tokens.add(client.token);
    return {
      name,
      tokenHash: digest(client.token),
      readOnly: client.readOnly !== false,
      // 開始は既存Taskの直接の書き換えなので、clientごとに明示したときだけ出す。
      allowStart: client.allowStart === true,
      toolsets,
    };
  });
}

async function loadClients(file) {
  try {
    const info = await stat(file);
    if (
      !info.isFile() ||
      info.size > 64 * 1024 ||
      (process.platform !== "win32" && (info.uid !== process.getuid() || (info.mode & 0o077) !== 0))
    )
      throw Error();
    return JSON.parse(await readFile(file, "utf8"));
  } catch {
    throw new Error("MCP_HTTP_CLIENTS_INVALID");
  }
}

/** Stateless requests do not share sessions, credentials, or McpServer instances. */
export async function startTaskenMcpHttpServer(options = {}) {
  const env = options.env || process.env;
  const clients = parseHttpClients(
    options.clients || (await loadClients(env.TASKEN_MCP_HTTP_CLIENTS_FILE)),
  );
  const port = options.port ?? Number(env.TASKEN_MCP_HTTP_PORT || 18181);
  if (!Number.isInteger(port) || port < 0 || port > 65535) throw new Error("MCP_HTTP_PORT_INVALID");
  // Only an explicit 0 relaxes the global read-only ceiling.
  const globalReadOnly = env.TASKEN_MCP_READ_ONLY !== "0";
  const defaultToolsets = parseMcpToolsets(env.TASKEN_MCP_TOOLSETS);
  const coreClient = options.coreClient || new TaskenCoreClient({ env });
  const httpServer = createServer(async (request, response) => {
    response.setHeader("Cache-Control", "no-store");
    const reply = (status, body) => {
      response.writeHead(status, { "Content-Type": "application/json" });
      response.end(JSON.stringify(body));
    };
    if (request.url === "/health" && request.method === "GET") return reply(200, { status: "ok" });
    const apiMatch = /^\/api\/v1\/([A-Za-z0-9_]+)$/.exec(request.url || "");
    if (request.url !== "/mcp" && !apiMatch) return reply(404, { error: "not_found" });
    const authorization = request.headers.authorization || "";
    const match = /^Bearer ([A-Za-z0-9_-]{43})$/i.exec(authorization);
    const supplied = digest(match?.[1] || "");
    const client = clients.find(({ tokenHash }) => timingSafeEqual(tokenHash, supplied));
    if (!match || !client) {
      response.setHeader("WWW-Authenticate", 'Bearer realm="tasken-mcp"');
      return reply(401, { error: "unauthorized" });
    }
    // This endpoint is for native AI clients, not credentialed browser requests.
    if (request.headers.origin) return reply(403, { error: "origin_not_allowed" });
    if (request.method !== "POST") {
      response.setHeader("Allow", "POST");
      return reply(405, { error: "method_not_allowed" });
    }
    let body;
    try {
      body = await readJsonBody(request);
    } catch (error) {
      // Drain without retaining the rejected body so clients can receive 413
      // while still sending a chunked request.
      request.resume();
      return reply(error.message === "BODY_TOO_LARGE" ? 413 : 400, { error: "invalid_body" });
    }
    if (apiMatch && (!body || typeof body !== "object" || Array.isArray(body))) {
      return reply(400, { error: "invalid_body" });
    }
    let server;
    try {
      const readOnly = globalReadOnly || client.readOnly;
      const core = await coreClient.status();
      // 開始(start_work)はallowStartのclientにだけ見せる。外したcapabilityで作るので、
      // そのclientから見たprofileは開始なしになり、start_task_workは一覧から外れる。
      const withheldCapabilities =
        client.allowStart && !readOnly ? [] : [TASKEN_CORE_TASK_START_WORK_CAPABILITY];
      const capabilities = Array.isArray(core.capabilities)
        ? core.capabilities.filter((value) => !withheldCapabilities.includes(value))
        : core.capabilities;
      // Never fall back to registering all writes if Core is unavailable or has
      // a desktop/full grant. HTTP writes are restricted to NAS profiles (full,
      // partial and unknown profiles are refused; start variants are accepted
      // because start itself is gated per client above).
      if (
        !Array.isArray(capabilities) ||
        (!readOnly &&
          ![
            "read-only",
            "proposals",
            "create-only",
            "start-only",
            "proposals-and-start",
            "create-and-start",
          ].includes(coreWriteProfile(capabilities).profile))
      ) {
        return reply(503, { error: "core_profile_not_allowed" });
      }
      server = createTaskenMcpServer({
        coreClient,
        capabilities,
        readOnly,
        toolsets: client.toolsets ?? defaultToolsets,
        withheldCapabilities,
        verifiedClient: client.name,
        env,
      });
      if (apiMatch) {
        const { status, body: result } = await callApiTool(
          server,
          client.name,
          `tasken.${apiMatch[1]}`,
          body,
        );
        return reply(status, result);
      }
      const transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: undefined,
        enableJsonResponse: true,
      });
      response.once("close", () => {
        void server.close();
      });
      await server.connect(transport);
      await transport.handleRequest(request, response, body);
    } catch {
      if (!response.headersSent) reply(503, { error: "mcp_unavailable" });
      else response.end();
      await server?.close();
    }
  });
  httpServer.requestTimeout = 60_000;
  httpServer.headersTimeout = 15_000;
  await new Promise((resolve, reject) => {
    httpServer.once("error", reject);
    httpServer.listen(port, "127.0.0.1", resolve);
  });
  return httpServer;
}
