import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";

// Per-client Core credentials for local readers that must not hold the full
// discovery token. Only SHA-256 digests are stored; the token is shown once.
export const TASKEN_CORE_CLIENTS_FILE = "tasken-core-clients.json";
export const TASKEN_CORE_CLIENTS_SCHEMA_VERSION = 1;
export const TASKEN_CORE_READ_CLIENT_SCOPE = "read";

const TOKEN_PREFIX = "tkr_";
const TOKEN_PATTERN = /^tkr_[A-Za-z0-9_-]{43}$/;
const NAME_PATTERN = /^[a-z0-9][a-z0-9-]{0,39}$/;

function digest(token) {
  return createHash("sha256").update(token, "utf8").digest();
}

function registryPath(userDataPath) {
  return path.join(userDataPath, TASKEN_CORE_CLIENTS_FILE);
}

async function readRegistry(userDataPath) {
  let text;
  try {
    text = await fs.readFile(registryPath(userDataPath), "utf8");
  } catch (error) {
    if (error.code === "ENOENT")
      return { schema_version: TASKEN_CORE_CLIENTS_SCHEMA_VERSION, clients: [] };
    throw error;
  }
  const registry = JSON.parse(text);
  if (
    registry?.schema_version !== TASKEN_CORE_CLIENTS_SCHEMA_VERSION ||
    !Array.isArray(registry.clients)
  ) {
    throw new Error("Tasken Core client registryの形式が不正です。");
  }
  return registry;
}

async function writeRegistry(userDataPath, registry) {
  const filePath = registryPath(userDataPath);
  await fs.mkdir(userDataPath, { recursive: true });
  const temporary = `${filePath}.${process.pid}.${randomBytes(8).toString("hex")}.tmp`;
  try {
    await fs.writeFile(temporary, `${JSON.stringify(registry, null, 2)}\n`, {
      encoding: "utf8",
      flag: "wx",
      mode: 0o600,
    });
    await fs.rename(temporary, filePath);
  } finally {
    await fs.rm(temporary, { force: true });
  }
}

function assertName(name) {
  if (typeof name !== "string" || !NAME_PATTERN.test(name)) {
    throw new Error("client nameは英小文字・数字・ハイフンで40文字以内にしてください。");
  }
}

/** Issues a read-only token. The caller must show it once and never store it. */
export async function issueCoreClientToken(userDataPath, name) {
  assertName(name);
  const registry = await readRegistry(userDataPath);
  if (registry.clients.some((client) => client.name === name && client.revoked_at === null)) {
    throw new Error(`client "${name}" には有効なtokenがあります。先にrevokeしてください。`);
  }
  const token = `${TOKEN_PREFIX}${randomBytes(32).toString("base64url")}`;
  registry.clients.push({
    name,
    scope: TASKEN_CORE_READ_CLIENT_SCOPE,
    token_sha256: digest(token).toString("hex"),
    created_at: new Date().toISOString(),
    revoked_at: null,
  });
  await writeRegistry(userDataPath, registry);
  return { name, scope: TASKEN_CORE_READ_CLIENT_SCOPE, token };
}

export async function revokeCoreClientToken(userDataPath, name) {
  assertName(name);
  const registry = await readRegistry(userDataPath);
  const active = registry.clients.filter(
    (client) => client.name === name && client.revoked_at === null,
  );
  if (active.length === 0) throw new Error(`client "${name}" に有効なtokenはありません。`);
  const now = new Date().toISOString();
  for (const client of active) client.revoked_at = now;
  await writeRegistry(userDataPath, registry);
}

export async function listCoreClients(userDataPath) {
  const registry = await readRegistry(userDataPath);
  return registry.clients.map(({ name, scope, created_at, revoked_at }) => ({
    name,
    scope,
    created_at,
    revoked_at,
  }));
}

/**
 * Returns the active client a bearer token belongs to, or null. Read on every
 * request so a revocation applies without restarting Core.
 */
export async function findCoreClient(userDataPath, token) {
  if (typeof token !== "string" || !TOKEN_PATTERN.test(token)) return null;
  let registry;
  try {
    registry = await readRegistry(userDataPath);
  } catch {
    return null;
  }
  const provided = digest(token);
  let match = null;
  for (const client of registry.clients) {
    if (client.revoked_at !== null || typeof client.token_sha256 !== "string") continue;
    const stored = Buffer.from(client.token_sha256, "hex");
    if (stored.length === provided.length && timingSafeEqual(stored, provided)) match = client;
  }
  return match && { name: match.name, scope: match.scope };
}
