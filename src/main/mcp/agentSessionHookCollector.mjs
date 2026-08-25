import { createHash, randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";

import { resolveTaskenUserDataPath } from "../../shared/taskenPaths.mjs";
import { TaskenCoreClient } from "./taskenCoreClient.mjs";

const CLIENT_KINDS = new Set(["codex", "claude_code", "cursor", "github_copilot"]);
const STATE_SCHEMA_VERSION = 2;
const MAX_SESSION_CHECKPOINTS = 200;

function text(value, max) {
  return typeof value === "string" ? sanitizeText(value).trim().slice(0, max) : "";
}

function sanitizeText(value) {
  return value
    .replace(/\b[A-Za-z]:\\(?:[^\s"'<>|]+\\)*[^\s"'<>|]*/g, "[local path]")
    .replace(/(^|\s)\/(?:Users|home|mnt|workspace|tmp|var|opt)\/[^\s"'<>]*/g, "$1[local path]")
    .replace(/https?:\/\/[^\s)\]}]+/g, (raw) => {
      try {
        const url = new URL(raw);
        url.username = "";
        url.password = "";
        url.search = "";
        url.hash = "";
        return url.toString();
      } catch {
        return "[external URL]";
      }
    });
}

function timestamp(value, fallback) {
  if (typeof value === "number" && Number.isFinite(value)) return new Date(value).toISOString();
  if (typeof value === "string" && !Number.isNaN(Date.parse(value)))
    return new Date(value).toISOString();
  return fallback;
}

function eventName(input) {
  return String(input.hook_event_name || input.hookEventName || input.event || "")
    .replace(/[^A-Za-z]/g, "")
    .toLowerCase();
}

function sessionId(input) {
  return text(
    input.session_id || input.sessionId || input.conversation_id || input.conversationId,
    500,
  );
}

function cwd(input) {
  if (typeof input.cwd === "string") return input.cwd;
  const roots = input.workspace_roots || input.workspaceRoots;
  return Array.isArray(roots) && typeof roots[0] === "string" ? roots[0] : "";
}

function statusFrom(reason) {
  const normalized = String(reason || "").toLowerCase();
  if (/error|timeout|blocked|failure/.test(normalized)) return "blocked";
  if (/abort|user_exit|window_close|user_close|logout|clear/.test(normalized)) return "abandoned";
  return "completed";
}

export function normalizeAgentHookEvent(clientKind, input, now = () => new Date().toISOString()) {
  if (!CLIENT_KINDS.has(clientKind)) throw new Error(`未対応のclient_kindです: ${clientKind}`);
  if (!input || typeof input !== "object" || Array.isArray(input))
    throw new Error("hook inputはJSON objectが必要です。");
  const sourceSession = sessionId(input);
  if (!sourceSession) throw new Error("hook inputにsession IDがありません。");
  const observedAt = timestamp(input.timestamp, now());
  const name = eventName(input);
  const base = {
    client_kind: clientKind,
    source_session: sourceSession,
    observed_at: observedAt,
    cwd: cwd(input),
    model_label: text(input.model || input.model_id || input.modelId, 200),
  };

  if (name === "sessionstart") {
    return {
      ...base,
      kind: "start",
      intent: text(input.initial_prompt || input.initialPrompt, 4000),
    };
  }
  if (
    name === "userpromptsubmit" ||
    name === "userpromptsubmitted" ||
    name === "beforesubmitprompt"
  ) {
    return { ...base, kind: "intent", intent: text(input.prompt, 4000) };
  }
  if (name === "stop" || name === "agentstop" || name === "afteragentresponse") {
    return {
      ...base,
      kind: "progress",
      outcome: text(
        input.last_assistant_message || input.lastAssistantMessage || input.text || input.response,
        8000,
      ),
      reason: text(input.status || input.stop_reason || input.stopReason, 200),
    };
  }
  if (name === "sessionend") {
    const reason =
      text(input.reason || input.final_status || input.finalStatus, 200) || "session_end";
    return { ...base, kind: "end", reason, status: statusFrom(reason) };
  }
  return { ...base, kind: "ignored" };
}

function stateKey(clientKind, sourceSession) {
  return createHash("sha256").update(`${clientKind}\0${sourceSession}`).digest("hex");
}

function stateDirectory(options = {}) {
  return (
    options.stateDirectory ||
    path.join(resolveTaskenUserDataPath(options), "agent-session-observations")
  );
}

async function writeState(filePath, state) {
  await fs.mkdir(path.dirname(filePath), { recursive: true, mode: 0o700 });
  const temporary = `${filePath}.${randomUUID()}.tmp`;
  await fs.writeFile(temporary, `${JSON.stringify(state, null, 2)}\n`, {
    encoding: "utf8",
    mode: 0o600,
  });
  await fs.rename(temporary, filePath);
}

async function readState(filePath) {
  try {
    return JSON.parse(await fs.readFile(filePath, "utf8"));
  } catch (error) {
    if (error?.code === "ENOENT") return null;
    throw error;
  }
}

async function withStateLock(filePath, callback) {
  const lockPath = `${filePath}.lock`;
  await fs.mkdir(path.dirname(filePath), { recursive: true, mode: 0o700 });
  for (let attempt = 0; attempt < 200; attempt += 1) {
    try {
      await fs.mkdir(lockPath, { mode: 0o700 });
      try {
        return await callback();
      } finally {
        await fs.rmdir(lockPath).catch(() => {});
      }
    } catch (error) {
      if (error?.code !== "EEXIST") throw error;
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
  }
  throw Object.assign(new Error("session observationの排他待ちがtimeoutしました。"), {
    code: "OBSERVATION_LOCK_TIMEOUT",
  });
}

function mergeEvent(current, event) {
  const state = current
    ? {
        ...current,
        schema_version: STATE_SCHEMA_VERSION,
        request_events: Array.isArray(current.request_events)
          ? current.request_events
          : current.intent
            ? [
                {
                  observed_at: current.intent_observed_at || current.started_at,
                  text: current.intent,
                },
              ]
            : [],
        response_checkpoints: Array.isArray(current.response_checkpoints)
          ? current.response_checkpoints
          : current.last_outcome
            ? [
                {
                  observed_at: current.last_outcome_observed_at || current.last_observed_at,
                  text: current.last_outcome,
                },
              ]
            : [],
      }
    : {
        schema_version: STATE_SCHEMA_VERSION,
        client_kind: event.client_kind,
        source_session: event.source_session,
        started_at: event.observed_at,
        intent: "",
        last_outcome: "",
        cwd: "",
        model_label: "",
        request_events: [],
        response_checkpoints: [],
      };
  if (event.kind === "start" && event.observed_at < state.started_at)
    state.started_at = event.observed_at;
  if (
    event.intent &&
    (!state.intent || !state.intent_observed_at || event.observed_at < state.intent_observed_at)
  ) {
    state.intent = event.intent;
    state.intent_observed_at = event.observed_at;
  }
  if (event.intent) {
    state.request_events = mergeCheckpoint(state.request_events, {
      observed_at: event.observed_at,
      text: event.intent,
    });
  }
  if (
    event.outcome &&
    (!state.last_outcome ||
      !state.last_outcome_observed_at ||
      event.observed_at >= state.last_outcome_observed_at)
  ) {
    state.last_outcome = event.outcome;
    state.last_outcome_observed_at = event.observed_at;
  }
  if (event.outcome) {
    state.response_checkpoints = mergeCheckpoint(state.response_checkpoints, {
      observed_at: event.observed_at,
      text: event.outcome,
    });
  }
  if (event.cwd) state.cwd = event.cwd;
  if (event.model_label) state.model_label = event.model_label;
  if (event.kind === "end") {
    state.ended_at = event.observed_at;
    state.status = event.status;
    state.end_reason = event.reason;
  }
  state.last_observed_at = event.observed_at;
  return state;
}

function mergeCheckpoint(current, checkpoint) {
  const checkpoints = Array.isArray(current) ? [...current] : [];
  if (
    !checkpoints.some(
      (entry) => entry.observed_at === checkpoint.observed_at && entry.text === checkpoint.text,
    )
  ) {
    checkpoints.push(checkpoint);
  }
  return checkpoints
    .sort((left, right) => left.observed_at.localeCompare(right.observed_at))
    .slice(-MAX_SESSION_CHECKPOINTS);
}

function splitIds(value) {
  return String(value || "")
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);
}

async function submitState(state, options = {}) {
  const client = options.coreClient || new TaskenCoreClient(options);
  let context = null;
  try {
    context = await client.getAgentSessionContext({
      client_kind: state.client_kind,
      source_session: state.source_session,
      ...(state.cwd ? { cwd: state.cwd } : {}),
    });
  } catch {
    // The complete record can still be reviewed without repository relations.
  }
  const repositoryIds = context?.repository_context?.id ? [context.repository_context.id] : [];
  const workingCopyIds =
    context?.working_copies?.length === 1 ? [context.working_copies[0].id] : [];
  const inferredThemeIds = context?.themes?.length === 1 ? [context.themes[0].id] : [];
  const themeIds = splitIds(
    options.env?.TASKEN_AGENT_SESSION_THEME_IDS || process.env.TASKEN_AGENT_SESSION_THEME_IDS,
  );
  const taskIds = splitIds(
    options.env?.TASKEN_AGENT_SESSION_TASK_IDS || process.env.TASKEN_AGENT_SESSION_TASK_IDS,
  );
  const reason = text(state.end_reason, 200) || "session_end";
  return client.proposeAgentSession({
    action: "capture",
    idempotency_key: `${state.client_kind}:${state.source_session}:terminal:v1`,
    caller: `${state.client_kind} lifecycle hook`,
    source: "mcp",
    source_app: `tasken-session-hook:${state.client_kind}`,
    source_session: state.source_session,
    actor: { kind: "ai_agent" },
    started_at: state.started_at,
    ended_at: state.ended_at,
    status: state.status,
    client_kind: state.client_kind,
    ...(state.model_label ? { model_label: state.model_label } : {}),
    request_events: state.request_events || [],
    response_checkpoints: state.response_checkpoints || [],
    intent: { summary: state.intent || "Session lifecycle hookで開始を観測しました。" },
    outcome: {
      summary: state.last_outcome || `Session lifecycle hookが終了を観測しました（${reason}）。`,
      verification: [`collector: ${state.client_kind} / end reason: ${reason}`],
    },
    ...(themeIds.length || inferredThemeIds.length
      ? { theme_ids: themeIds.length ? themeIds : inferredThemeIds }
      : {}),
    ...(taskIds.length ? { task_ids: taskIds } : {}),
    ...(repositoryIds.length ? { repository_context_ids: repositoryIds } : {}),
    ...(workingCopyIds.length ? { working_copy_ids: workingCopyIds } : {}),
  });
}

export async function collectAgentHookEvent(clientKind, input, options = {}) {
  const event = normalizeAgentHookEvent(clientKind, input, options.now);
  if (event.kind === "ignored") return { status: "ignored", event: eventName(input) };
  const directory = stateDirectory(options);
  const filePath = path.join(directory, `${stateKey(clientKind, event.source_session)}.json`);
  const state = await withStateLock(filePath, async () => {
    const merged = mergeEvent(await readState(filePath), event);
    await writeState(filePath, merged);
    return merged;
  });
  if (!state.ended_at) return { status: "observed", kind: event.kind };
  const settleDelayMs = Number.isFinite(options.settleDelayMs)
    ? Math.max(0, options.settleDelayMs)
    : 250;
  if (settleDelayMs > 0) await new Promise((resolve) => setTimeout(resolve, settleDelayMs));
  const settledState = await withStateLock(filePath, () => readState(filePath));
  if (!settledState?.ended_at) return { status: "observed", kind: event.kind };
  try {
    const response = await submitState(settledState, options);
    await fs.unlink(filePath).catch((error) => {
      if (error?.code !== "ENOENT") throw error;
    });
    return {
      status: "submitted",
      proposal_id: response.proposal_id,
      submission_status: response.status,
    };
  } catch (error) {
    const lastSubmissionError = {
      code: typeof error?.code === "string" ? error.code : "SUBMISSION_FAILED",
      at: (options.now || (() => new Date().toISOString()))(),
    };
    await withStateLock(filePath, async () => {
      const latestState = (await readState(filePath)) || settledState;
      await writeState(filePath, { ...latestState, last_submission_error: lastSubmissionError });
    });
    return { status: "pending", error_code: lastSubmissionError.code };
  }
}

export async function flushPendingAgentSessions(options = {}) {
  const directory = stateDirectory(options);
  let names;
  try {
    names = await fs.readdir(directory);
  } catch (error) {
    if (error?.code === "ENOENT") return { submitted: 0, pending: 0 };
    throw error;
  }
  let submitted = 0;
  let pending = 0;
  for (const name of names.filter((entry) => /^[a-f0-9]{64}\.json$/.test(entry))) {
    const filePath = path.join(directory, name);
    const state = await readState(filePath);
    if (!state?.ended_at) continue;
    try {
      await submitState(state, options);
      await fs.unlink(filePath);
      submitted += 1;
    } catch {
      pending += 1;
    }
  }
  return { submitted, pending };
}
