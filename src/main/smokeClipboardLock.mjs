import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";

export const SMOKE_CLIPBOARD_LOCK_PATH = path.join(os.tmpdir(), "tasken-smoke-native-clipboard.lock");
export const SMOKE_CLIPBOARD_LOCK_LEASE_MS = 30_000;
export const SMOKE_CLIPBOARD_LOCK_WAIT_MS = 60_000;

function processIsAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error?.code === "EPERM";
  }
}

function readOwner(lockPath) {
  try {
    return JSON.parse(fs.readFileSync(path.join(lockPath, "owner.json"), "utf8"));
  } catch {
    return null;
  }
}

function recoverExpiredLock(lockPath, now, leaseMs) {
  const owner = readOwner(lockPath);
  if (owner) {
    const startedAt = Number(owner.startedAt);
    const pid = Number(owner.pid);
    if (Number.isFinite(startedAt) && now - startedAt >= leaseMs && !processIsAlive(pid)) {
      fs.rmSync(lockPath, { recursive: true, force: true });
    }
    return;
  }
  try {
    const age = now - fs.statSync(lockPath).mtimeMs;
    if (age >= leaseMs) fs.rmSync(lockPath, { recursive: true, force: true });
  } catch {
    // Another waiter may have recovered the lock between stat and remove.
  }
}

/**
 * The native Windows clipboard is a process-global resource. Smoke runs stay
 * concurrent for the application/data checks, but serialize only the native
 * image write/read-back interval through this atomic directory lock.
 */
export async function acquireSmokeClipboardLock({
  lockPath = SMOKE_CLIPBOARD_LOCK_PATH,
  runId = "",
  pid = process.pid,
  now = () => Date.now(),
  leaseMs = SMOKE_CLIPBOARD_LOCK_LEASE_MS,
  waitMs = SMOKE_CLIPBOARD_LOCK_WAIT_MS,
  retryMs = 100,
} = {}) {
  const deadline = now() + waitMs;
  while (true) {
    try {
      const startedAt = now();
      await fs.promises.mkdir(lockPath);
      try {
        await fs.promises.writeFile(
          path.join(lockPath, "owner.json"),
          JSON.stringify({ pid, startedAt, runId }),
          { encoding: "utf8", flag: "wx" },
        );
      } catch (error) {
        fs.rmSync(lockPath, { recursive: true, force: true });
        throw error;
      }
      return () => fs.rmSync(lockPath, { recursive: true, force: true });
    } catch (error) {
      if (error?.code !== "EEXIST") throw error;
      recoverExpiredLock(lockPath, now(), leaseMs);
      if (now() >= deadline) {
        throw new Error(`Smoke用native clipboard lockの待機がタイムアウトしました: ${lockPath}`);
      }
      await new Promise((resolve) => setTimeout(resolve, retryMs));
    }
  }
}
