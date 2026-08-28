import { constants as fsConstants } from "node:fs";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const DEFAULT_MAX_TRANSCRIPT_BYTES = 4 * 1024 * 1024;

function transcriptPath(input) {
  const value = input?.transcriptPath || input?.transcript_path;
  return typeof value === "string" && value.trim() ? value : "";
}

function lastAssistantContent(raw) {
  let latest = "";
  for (const line of raw.split(/\r?\n/)) {
    if (!line.trim()) continue;
    try {
      const event = JSON.parse(line);
      if (
        event?.type === "assistant.message" &&
        !event.agentId &&
        !event.data?.agentId &&
        !event.parentToolCallId &&
        !event.data?.parentToolCallId &&
        typeof event.data?.content === "string" &&
        event.data.content.trim()
      ) {
        latest = event.data.content;
      }
    } catch {
      // A partial or future transcript event must not break lifecycle collection.
    }
  }
  return latest;
}

function configuredTranscriptRoots(options) {
  if (Array.isArray(options.allowedTranscriptRoots)) {
    return options.allowedTranscriptRoots.filter((entry) => typeof entry === "string" && entry);
  }
  const environment = options.env || process.env;
  const copilotHome =
    environment.COPILOT_HOME || path.join(options.home || os.homedir(), ".copilot");
  return [path.join(copilotHome, "session-state")];
}

function isWithinRoot(root, target) {
  const relative = path.relative(root, target);
  return (
    relative === "" ||
    (!path.isAbsolute(relative) && relative !== ".." && !relative.startsWith(`..${path.sep}`))
  );
}

async function canonicalTranscriptPath(filePath, options) {
  const canonicalTarget = await fs.realpath(filePath);
  for (const root of configuredTranscriptRoots(options)) {
    try {
      const canonicalRoot = await fs.realpath(root);
      if (isWithinRoot(canonicalRoot, canonicalTarget)) return canonicalTarget;
    } catch {
      // A missing optional root does not make another root trusted.
    }
  }
  return "";
}

export async function extractGitHubCopilotOutcome(input, options = {}) {
  const filePath = transcriptPath(input);
  if (!filePath) return "";
  const maxBytes = Number.isFinite(options.maxTranscriptBytes)
    ? Math.max(1024, options.maxTranscriptBytes)
    : DEFAULT_MAX_TRANSCRIPT_BYTES;
  let handle;
  try {
    const canonicalPath = await canonicalTranscriptPath(filePath, options);
    if (!canonicalPath) return "";
    const linkState = await fs.lstat(canonicalPath);
    if (linkState.isSymbolicLink() || !linkState.isFile()) return "";
    handle = await fs.open(canonicalPath, fsConstants.O_RDONLY | (fsConstants.O_NOFOLLOW || 0));
    const fileState = await handle.stat();
    if (!fileState.isFile() || fileState.dev !== linkState.dev || fileState.ino !== linkState.ino) {
      return "";
    }
    const start = Math.max(0, fileState.size - maxBytes);
    const buffer = Buffer.alloc(fileState.size - start);
    let bytesRead = 0;
    while (bytesRead < buffer.length) {
      const chunk = await handle.read(
        buffer,
        bytesRead,
        buffer.length - bytesRead,
        start + bytesRead,
      );
      if (chunk.bytesRead === 0) break;
      bytesRead += chunk.bytesRead;
    }
    let raw = buffer.subarray(0, bytesRead).toString("utf8");
    if (start > 0) {
      const firstCompleteLine = raw.indexOf("\n");
      raw = firstCompleteLine >= 0 ? raw.slice(firstCompleteLine + 1) : "";
    }
    return lastAssistantContent(raw);
  } catch {
    // The transcript is optional evidence; session completion still has value without it.
    return "";
  } finally {
    await handle?.close().catch(() => {});
  }
}
