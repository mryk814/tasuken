import { createHash, timingSafeEqual } from "node:crypto";
import { readFile, stat } from "node:fs/promises";
import { createServer } from "node:http";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";

import {
  TASKEN_CORE_AI_TASK_CHANGE_CAPABILITY,
  TASKEN_CORE_TASK_START_WORK_CAPABILITY,
  coreWriteProfile,
} from "../../shared/contracts/core/public.mjs";
import { createTaskenMcpServer } from "./server.mjs";
import { TaskenCoreClient } from "./taskenCoreClient.mjs";
import { MCP_TOOL_REQUIREMENTS, parseMcpToolsets } from "./toolAvailability.mjs";
import { apiErrorStatus, toolResultValue } from "./toolErrorStatus.mjs";

export { apiErrorStatus };

const digest = (value) => createHash("sha256").update(value).digest();
const MAX_BODY_BYTES = 35 * 1024 * 1024;
const STATS_METHODS = new Set(["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"]);
const STATS_FIXED_PATHS = new Set(["/mcp", "/api/v1", "/api/stats", "/health"]);
const STATS_CODE = /^[A-Z][A-Z0-9_]{0,47}$/;

/**
 * 入口ごとの計測（#733）の入口の名前。決まったpathだけを名前にし、ほかは{unknown}にする。
 * `/api/v1/<tool>`のtool名は名前に使わず、まとめて`/api/v1/{tool}`にする（toolごとの数はtool側の行にある）。
 */
function statsEntry(method, url) {
  const pathname = (url || "").split("?", 1)[0];
  const path = STATS_FIXED_PATHS.has(pathname)
    ? pathname
    : /^\/api\/v1\/[A-Za-z0-9_]+$/.test(pathname)
      ? "/api/v1/{tool}"
      : "{unknown}";
  return `mcp-http ${STATS_METHODS.has(method) ? method : "OTHER"} ${path}`;
}

/** 応答の本文のerrorから計測のcodeを作る。形に合わなければOTHER、成功は空。 */
function statsErrorCode(body) {
  const error = body?.error;
  const code = typeof error === "string" ? error : error?.code;
  if (typeof code !== "string") return "";
  const upper = code.toUpperCase();
  return STATS_CODE.test(upper) ? upper : "OTHER";
}

/** `/api/stats?days=N`のdays。省略は7、1〜366の整数以外はnull。 */
function statsDays(url) {
  const values = new URLSearchParams(url.split("?")[1] ?? "").getAll("days");
  if (values.length === 0) return 7;
  const days = values.length === 1 && /^[0-9]{1,4}$/.test(values[0]) ? Number(values[0]) : 0;
  return days >= 1 && days <= 366 ? days : null;
}

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
 * `/api/v1`の二つの口（describeと`<name>`の呼び出し）が共有する、要求ごとのMCP serverとin-memoryのclient。
 * ツールの関数を直に呼ばないのは、readOnly・toolsets・capabilityの絞り込みが
 * 「一覧から外す」形でしか効かないため（直に呼ぶと素通りする）。
 */
async function withApiClient(server, run) {
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const mcpClient = new Client({ name: "tasken-http-api", version: "1.0.0" });
  try {
    await server.connect(serverTransport);
    await mcpClient.connect(clientTransport);
    return await run(mcpClient);
  } finally {
    await mcpClient.close().catch(() => {});
    await server.close().catch(() => {});
  }
}

async function listAllTools(mcpClient) {
  const tools = [];
  let cursor;
  do {
    const page = await mcpClient.listTools(cursor ? { cursor } : undefined);
    tools.push(...page.tools);
    cursor = page.nextCursor;
  } while (cursor);
  return tools;
}

/**
 * `GET /api/v1`: そのclientのその時点の`tools/list`に出るツールだけを、名前・access・説明・入力の形で返す。
 * `hash`は名前順の`[{name, inputSchema}]`のSHA-256。名前か入力の形が変わると変わるので、
 * 呼ぶ側（helperや手順書）はこれで「ツールの形を読み直すべきか」を知る。
 */
async function describeApiTools(server) {
  const tools = await withApiClient(server, listAllTools);
  const described = tools
    .map((tool) => ({
      name: tool.name.replace(/^tasken\./, ""),
      access: MCP_TOOL_REQUIREMENTS[tool.name]?.access ?? "read",
      description: tool.description ?? "",
      inputSchema: tool.inputSchema,
    }))
    .sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  const hash = createHash("sha256")
    .update(JSON.stringify(described.map(({ name, inputSchema }) => ({ name, inputSchema }))))
    .digest("hex");
  return { tools: described, hash };
}

/** `POST /api/v1/<name>`: 一覧に出ているツールだけを、同じin-memoryのclientでtools/callに通す。 */
function callApiTool(server, clientName, name, args) {
  return withApiClient(server, (mcpClient) => callListedTool(mcpClient, clientName, name, args));
}

async function callListedTool(mcpClient, clientName, name, args) {
  const tools = await listAllTools(mcpClient);
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
  const value = toolResultValue(result);
  return { status: result.isError ? apiErrorStatus(value) : 200, body: value };
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
        (key) => !["token", "readOnly", "toolsets", "allowStart", "allowTaskChange"].includes(key),
      ) ||
      typeof client.token !== "string" ||
      !/^[A-Za-z0-9_-]{43}$/.test(client.token) ||
      Buffer.from(client.token, "base64url").toString("base64url") !== client.token ||
      (client.readOnly !== undefined && typeof client.readOnly !== "boolean") ||
      (client.allowStart !== undefined && typeof client.allowStart !== "boolean") ||
      (client.allowTaskChange !== undefined && typeof client.allowTaskChange !== "boolean") ||
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
      // 既存Taskの直接変更と取り消し（#688）も、clientごとに明示したときだけ出す。
      allowTaskChange: client.allowTaskChange === true,
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
    // 入口ごとの計測。応答の終わりに1行をCoreへ送る（待たない。届かなくても応答は変えない）。
    const startedAt = process.hrtime.bigint();
    const stats = { caller: "anonymous", code: "" };
    response.once("close", () => {
      try {
        if (typeof coreClient.recordStats !== "function") return;
        const length = Number(response.getHeader("content-length"));
        void Promise.resolve(
          coreClient.recordStats([
            {
              entry: statsEntry(request.method, request.url),
              caller: stats.caller,
              status: response.statusCode,
              code: stats.code,
              us: Number((process.hrtime.bigint() - startedAt) / 1000n),
              bytes: Number.isFinite(length) ? length : 0,
            },
          ]),
        ).catch(() => {});
      } catch {
        // 計測の失敗で応答を変えない。
      }
    });
    const reply = (status, body) => {
      stats.code = statsErrorCode(body);
      const encoded = JSON.stringify(body);
      response.writeHead(status, {
        "Content-Type": "application/json",
        "Content-Length": Buffer.byteLength(encoded),
      });
      response.end(encoded);
    };
    if (request.url === "/health" && request.method === "GET") return reply(200, { status: "ok" });
    const apiMatch = /^\/api\/v1\/([A-Za-z0-9_]+)$/.exec(request.url || "");
    const isDescribe = request.url === "/api/v1";
    const isStats = (request.url || "").split("?", 1)[0] === "/api/stats";
    if (request.url !== "/mcp" && !apiMatch && !isDescribe && !isStats)
      return reply(404, { error: "not_found" });
    const authorization = request.headers.authorization || "";
    const match = /^Bearer ([A-Za-z0-9_-]{43})$/i.exec(authorization);
    const supplied = digest(match?.[1] || "");
    const client = clients.find(({ tokenHash }) => timingSafeEqual(tokenHash, supplied));
    if (!match || !client) {
      response.setHeader("WWW-Authenticate", 'Bearer realm="tasken-mcp"');
      return reply(401, { error: "unauthorized" });
    }
    // /mcpはMCPのclientとして、/api/v1*と/api/statsはtokenを持つ呼び出しとして数える。
    stats.caller = `${request.url === "/mcp" ? "mcp" : "token"}:${client.name}`;
    // This endpoint is for native AI clients, not credentialed browser requests.
    if (request.headers.origin) return reply(403, { error: "origin_not_allowed" });
    // describeと/api/statsはGETだけ、それ以外（/mcpと/api/v1/<tool>）はPOSTだけ。
    const allowedMethod = isDescribe || isStats ? "GET" : "POST";
    if (request.method !== allowedMethod) {
      response.setHeader("Allow", allowedMethod);
      return reply(405, { error: "method_not_allowed" });
    }
    let body;
    try {
      // GETの本文は読まない（読むと空の本文がJSONの誤りになる）。
      body = isDescribe || isStats ? undefined : await readJsonBody(request);
    } catch (error) {
      // Drain without retaining the rejected body so clients can receive 413
      // while still sending a chunked request.
      request.resume();
      return reply(error.message === "BODY_TOO_LARGE" ? 413 : 400, { error: "invalid_body" });
    }
    if (apiMatch && (!body || typeof body !== "object" || Array.isArray(body))) {
      return reply(400, { error: "invalid_body" });
    }
    if (isStats) {
      // 読み取り専用のclientも読める。Coreから読んだものをそのまま返す（tokenの種類で中身は変わらない）。
      const days = statsDays(request.url);
      if (days === null) return reply(400, { error: "invalid_days" });
      try {
        return reply(200, await coreClient.getStats(days));
      } catch {
        return reply(503, { error: "core_unavailable" });
      }
    }
    let server;
    try {
      const readOnly = globalReadOnly || client.readOnly;
      const core = await coreClient.status();
      // 開始(start_work)はallowStartの、直接変更(task.ai_change)はallowTaskChangeのclientにだけ見せる。
      // 外したcapabilityで作るので、そのclientから見たprofileからも外れ、toolは一覧から外れる。
      const withheldCapabilities = [
        ...(client.allowStart && !readOnly ? [] : [TASKEN_CORE_TASK_START_WORK_CAPABILITY]),
        ...(client.allowTaskChange && !readOnly ? [] : [TASKEN_CORE_AI_TASK_CHANGE_CAPABILITY]),
      ];
      const capabilities = Array.isArray(core.capabilities)
        ? core.capabilities.filter((value) => !withheldCapabilities.includes(value))
        : core.capabilities;
      // Never fall back to registering all writes if Core is unavailable or has
      // a desktop/full grant. HTTP writes are restricted to NAS profiles (full,
      // partial and unknown profiles are refused; start variants are accepted
      // because start itself is gated per client above). The direct Task change
      // does not change the profile name and is gated per client above as well.
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
        statsCaller: `${apiMatch ? "token" : "mcp"}:${client.name}`,
        env,
      });
      if (isDescribe) return reply(200, await describeApiTools(server));
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
