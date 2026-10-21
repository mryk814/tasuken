import { createHash, timingSafeEqual } from "node:crypto";
import { readFile, stat } from "node:fs/promises";
import { createServer } from "node:http";

import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";

import { coreWriteProfile } from "../../shared/contracts/core/public.mjs";
import { createTaskenMcpServer } from "./server.mjs";
import { TaskenCoreClient } from "./taskenCoreClient.mjs";

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
      Object.keys(client).some((key) => !["token", "readOnly"].includes(key)) ||
      typeof client.token !== "string" ||
      !/^[A-Za-z0-9_-]{43}$/.test(client.token) ||
      Buffer.from(client.token, "base64url").toString("base64url") !== client.token ||
      (client.readOnly !== undefined && typeof client.readOnly !== "boolean") ||
      tokens.has(client.token)
    )
      invalid();
    tokens.add(client.token);
    return { name, tokenHash: digest(client.token), readOnly: client.readOnly !== false };
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
  const coreClient = options.coreClient || new TaskenCoreClient({ env });
  const httpServer = createServer(async (request, response) => {
    response.setHeader("Cache-Control", "no-store");
    const reply = (status, body) => {
      response.writeHead(status, { "Content-Type": "application/json" });
      response.end(JSON.stringify(body));
    };
    if (request.url === "/health" && request.method === "GET") return reply(200, { status: "ok" });
    if (request.url !== "/mcp") return reply(404, { error: "not_found" });
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
    let server;
    try {
      const readOnly = globalReadOnly || client.readOnly;
      const { capabilities } = await coreClient.status();
      // Never fall back to registering all writes if Core is unavailable or has
      // a desktop/full/start grant. HTTP writes are restricted to NAS profiles.
      if (
        !Array.isArray(capabilities) ||
        (!readOnly &&
          !["read-only", "proposals", "create-only"].includes(
            coreWriteProfile(capabilities).profile,
          ))
      ) {
        return reply(503, { error: "core_profile_not_allowed" });
      }
      server = createTaskenMcpServer({ coreClient, capabilities, readOnly });
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
