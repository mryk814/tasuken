import fs from "node:fs/promises";
import path from "node:path";

import { resolveTaskenUserDataPath } from "../../shared/taskenPaths.mjs";
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
} from "../../shared/contracts/core/public.mjs";

export const TASKEN_CORE_CLIENT_TIMEOUT_MS = 5_000;

export class TaskenCoreClientError extends Error {
  constructor(code, message, options = {}) {
    super(message, options);
    this.name = "TaskenCoreClientError";
    this.code = code;
    this.status = options.status;
    this.details = options.details;
  }

  toPublicError() {
    return {
      code: this.code,
      message: this.message,
      ...(this.status === undefined ? {} : { status: this.status }),
      ...(this.details === undefined ? {} : { details: this.details }),
    };
  }
}

export function taskenCoreDiscoveryPath(options = {}) {
  const userDataPath = options.userDataPath || resolveTaskenUserDataPath(options);
  return path.join(userDataPath, TASKEN_CORE_DISCOVERY_FILE);
}

function parseDiscovery(value) {
  if (!value || typeof value !== "object") throw new TaskenCoreClientError("INVALID_DISCOVERY", "Tasken Core discoveryが不正です。");
  if (value.schema_version !== TASKEN_CORE_DISCOVERY_SCHEMA_VERSION) {
    throw new TaskenCoreClientError("INVALID_DISCOVERY", "Tasken Core discovery versionが不正です。");
  }
  if (value.api_version !== TASKEN_CORE_API_VERSION) {
    throw new TaskenCoreClientError("VERSION_MISMATCH", "Tasken Core API versionが一致しません。");
  }
  if (!Array.isArray(value.capabilities) || value.capabilities.some((capability) => typeof capability !== "string")) {
    throw new TaskenCoreClientError("INVALID_DISCOVERY", "Tasken Core capabilitiesが不正です。");
  }
  let origin;
  try {
    origin = typeof value.origin === "string" ? new URL(value.origin) : null;
  } catch {
    origin = null;
  }
  const port = Number(origin?.port);
  if (!origin
    || origin.protocol !== "http:"
    || origin.hostname !== "127.0.0.1"
    || origin.pathname !== "/"
    || origin.search
    || origin.hash
    || !Number.isInteger(port)
    || port < 1
    || port > 65_535) {
    throw new TaskenCoreClientError("INVALID_DISCOVERY", "Tasken Core originが不正です。");
  }
  const token = typeof value.token === "string" && /^[A-Za-z0-9_-]{43}$/.test(value.token)
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
      throw new TaskenCoreClientError("INVALID_DISCOVERY", "Tasken Core discoveryにsymlinkは使用できません。");
    }
    handle = await fs.open(discoveryPath, "r");
    const stat = await handle.stat();
    if (linkStat.dev !== stat.dev || linkStat.ino !== stat.ino) {
      throw new TaskenCoreClientError("INVALID_DISCOVERY", "Tasken Core discoveryが読み取り中に変更されました。");
    }
    if (typeof process.getuid === "function") {
      if (stat.uid !== process.getuid()) {
        throw new TaskenCoreClientError("DISCOVERY_OWNER_MISMATCH", "Tasken Core discoveryの所有者が一致しません。");
      }
      if ((stat.mode & 0o077) !== 0) {
        throw new TaskenCoreClientError("DISCOVERY_PERMISSION_INVALID", "Tasken Core discoveryの権限が安全ではありません。");
      }
    }
    if (stat.size > 8 * 1024) {
      throw new TaskenCoreClientError("INVALID_DISCOVERY", "Tasken Core discoveryが大きすぎます。");
    }
    return parseDiscovery(JSON.parse(await handle.readFile("utf8")));
  } catch (error) {
    if (error instanceof TaskenCoreClientError) throw error;
    throw new TaskenCoreClientError("CORE_UNAVAILABLE", "Tasken Coreへ接続できません。Taskenを起動してください。", { cause: error });
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
    return this.query("list-agent-ready-tasks", TASKEN_CORE_LIST_AGENT_READY_TASKS_CAPABILITY, request);
  }

  async resolveRepositoryContext(request = {}) {
    return this.query("resolve-repository-context", TASKEN_CORE_RESOLVE_REPOSITORY_CONTEXT_CAPABILITY, request);
  }

  async findTasksForRepository(request = {}) {
    return this.query("find-tasks-for-repository", TASKEN_CORE_FIND_TASKS_FOR_REPOSITORY_CAPABILITY, request);
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

  async query(path, capability, request) {
    const discovery = await readDiscovery(this.discoveryPath);
    if (!discovery.capabilities.includes(capability)) {
      throw new TaskenCoreClientError("CAPABILITY_UNAVAILABLE", `Tasken Core operation capabilityが利用できません（${capability}）。`);
    }
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const response = await this.fetch(`${discovery.origin}/v1/queries/${path}`, {
        method: "POST",
        headers: {
          authorization: `Bearer ${discovery.token}`,
          "content-type": "application/json",
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
        if (publicError && typeof publicError.code === "string" && typeof publicError.message === "string") {
          throw new TaskenCoreClientError(publicError.code, publicError.message, {
            status: response.status,
            details: publicError.details,
          });
        }
        if (response.status === 401) throw new TaskenCoreClientError("UNAUTHORIZED", "Tasken Coreの認証に失敗しました。", { status: 401 });
        if (response.status === 409) throw new TaskenCoreClientError("VERSION_MISMATCH", "Tasken Core API versionが一致しません。", { status: 409 });
        throw new TaskenCoreClientError("CORE_REQUEST_FAILED", `Tasken Core queryが失敗しました（${response.status}）。`, { status: response.status });
      }
      const version = response.headers.get("x-tasken-core-version");
      if (version !== TASKEN_CORE_API_VERSION) {
        throw new TaskenCoreClientError("VERSION_MISMATCH", "Tasken Core API versionが一致しません。");
      }
      return await response.json();
    } catch (error) {
      if (error instanceof TaskenCoreClientError) throw error;
      throw new TaskenCoreClientError("CORE_UNAVAILABLE", "Tasken Coreへ接続できません。Taskenを起動してください。", { cause: error });
    } finally {
      clearTimeout(timeout);
    }
  }
}
