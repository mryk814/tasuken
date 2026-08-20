import fs from "node:fs/promises";
import path from "node:path";

import { resolveTaskenUserDataPath } from "../../shared/taskenPaths.mjs";
import {
  TASKEN_CORE_API_VERSION,
  TASKEN_CORE_CAPABILITY,
  TASKEN_CORE_DISCOVERY_FILE,
  TASKEN_CORE_DISCOVERY_SCHEMA_VERSION,
} from "../../shared/contracts/core/public.mjs";

export const TASKEN_CORE_CLIENT_TIMEOUT_MS = 5_000;

export class TaskenCoreClientError extends Error {
  constructor(code, message, options = {}) {
    super(message, options);
    this.name = "TaskenCoreClientError";
    this.code = code;
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
  if (!Array.isArray(value.capabilities) || !value.capabilities.includes(TASKEN_CORE_CAPABILITY)) {
    throw new TaskenCoreClientError("CAPABILITY_UNAVAILABLE", "Tasken Core query capabilityが利用できません。");
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
    const discovery = await readDiscovery(this.discoveryPath);
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const response = await this.fetch(`${discovery.origin}/v1/queries/list-agent-ready-tasks`, {
        method: "POST",
        headers: {
          authorization: `Bearer ${discovery.token}`,
          "content-type": "application/json",
        },
        body: JSON.stringify(request),
        signal: controller.signal,
      });
      if (response.status === 401) throw new TaskenCoreClientError("UNAUTHORIZED", "Tasken Coreの認証に失敗しました。");
      if (response.status === 409) throw new TaskenCoreClientError("VERSION_MISMATCH", "Tasken Core API versionが一致しません。");
      if (!response.ok) throw new TaskenCoreClientError("CORE_REQUEST_FAILED", `Tasken Core queryが失敗しました（${response.status}）。`);
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
