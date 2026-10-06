import * as z from "zod/v4";

import { safeReceiptText as redactAgentText } from "./taskContext.mjs";

export const AGENT_LOG_ADAPTERS = {
  "codex-hooks/1": "codex",
  "claude-hooks/1": "claude_code",
  "copilot-cli-hooks/1": "github_copilot",
  "opencode-export/1": "opencode",
  "deepseek-native/1": "deepseek_harness",
  "codex-rollout/1": "codex",
  "claude-transcript/1": "claude_code",
} as const;

const envelope = z
  .object({
    schema: z.literal("tasken-ai-work-log/1"),
    adapter: z.enum(
      Object.keys(AGENT_LOG_ADAPTERS) as [
        keyof typeof AGENT_LOG_ADAPTERS,
        ...Array<keyof typeof AGENT_LOG_ADAPTERS>,
      ],
    ),
    client_version: z.string().trim().min(1).max(120),
    // User-selected exported slice, never a private-store locator.
    source_session: z
      .string()
      .trim()
      .min(1)
      .max(500)
      .regex(/^[A-Za-z0-9_.:-]+$/),
    started_at: z.iso.datetime({ offset: true }),
    observed_until: z.iso.datetime({ offset: true }),
    coverage: z.enum(["complete", "partial"]),
    /** clientが付けた会話名（Codexのthread_name、Claude Codeのcustom-title / ai-title）。 */
    title: z.string().trim().max(200).optional(),
    /** clientが記録したターン処理時間の合計。 */
    active_duration_ms: z
      .number()
      .int()
      .min(0)
      .max(30 * 24 * 60 * 60 * 1000)
      .optional(),
    payload: z.unknown(),
  })
  .strict();

/** 一覧に出す見出し。旧記録（titleなし）は依頼から作る。 */
export function agentSessionHeading(intent: { summary: string; title?: string | null }): string {
  return intent.title?.trim() || shortAgentSessionTitle(intent.summary);
}

/** AIが動いていた時間の表示。経過区間（開始〜最終観測）とは別に示す。 */
export function formatAgentActiveDuration(ms: number | null | undefined): string | null {
  if (typeof ms !== "number" || !Number.isFinite(ms) || ms < 0) return null;
  const minutes = Math.round(ms / 60000);
  if (minutes < 1) return "1分未満";
  if (minutes < 60) return `${minutes}分`;
  const hours = Math.floor(minutes / 60);
  return minutes % 60 ? `${hours}時間${minutes % 60}分` : `${hours}時間`;
}

/**
 * 一覧の見出し用に、依頼の最初の一文を短くする。全文は詳細（intent.summary）に残す。
 * AIで要約せず、文の切れ目と文字数だけで決める。
 */
export function shortAgentSessionTitle(text: string, max = 40): string {
  const firstLine =
    text
      .split(/\r?\n/)
      .map((line) => line.trim())
      .find(Boolean) ?? "";
  // 日本語の句点はその場で切り、英語の終止符は後ろが空白か行末のときだけ切る（"v1.2"等を切らない）。
  const sentence = /^(.+?(?:[。！？]|[.!?](?=\s|$)))/u.exec(firstLine)?.[1] ?? firstLine;
  const chars = [...sentence];
  return chars.length > max ? `${chars.slice(0, max - 1).join("")}…` : sentence;
}

type RecordValue = Record<string, unknown>;
function record(value: unknown): RecordValue {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as RecordValue) : {};
}
function date(value: unknown): string {
  const time =
    typeof value === "number" || typeof value === "string" ? new Date(value).getTime() : NaN;
  if (!Number.isFinite(time))
    throw new Error("観測時刻がありません。時刻付きのexportを選択してください。");
  return new Date(time).toISOString();
}
function visibleText(value: unknown): string {
  if (typeof value === "string") return redactAgentText(value).trim();
  if (!Array.isArray(value)) return "";
  return value
    .flatMap((part) => {
      const item = record(part);
      return item.type === "text" && typeof item.text === "string"
        ? [redactAgentText(item.text)]
        : [];
    })
    .join("\n")
    .trim();
}

export function parseAgentWorkLog(raw: string) {
  if (typeof raw !== "string" || new TextEncoder().encode(raw).length > 2 * 1024 * 1024)
    throw new Error("取込ファイルは2MB以下のJSONにしてください。");
  let decoded: unknown;
  try {
    decoded = JSON.parse(raw);
  } catch {
    try {
      decoded = raw
        .split(/\r?\n/)
        .filter((line) => line.trim())
        .map((line) => JSON.parse(line));
    } catch {
      throw new Error("JSONLに壊れた行があります。書き込み終了後のログを選択してください。");
    }
  }
  if (Array.isArray(decoded)) decoded = nativeEnvelope(decoded);
  else if (record(decoded).type === "session_meta" || record(decoded).sessionId)
    decoded = nativeEnvelope([decoded]);
  let input;
  try {
    input = envelope.parse(decoded);
  } catch {
    throw new Error(
      "対応する版付きAI作業ログではありません。tasken-ai-work-log/1の形式を確認してください。",
    );
  }
  const start = date(input.started_at);
  const until = date(input.observed_until);
  if (until < start) throw new Error("観測終了は開始以降にしてください。");
  const requests: Array<{ observed_at: string; text: string; event_id?: string }> = [];
  const responses: typeof requests = [];
  let status: "completed" | "interrupted" | "blocked" | "unknown" = "unknown";
  let terminalAt: string | null = null;
  const add = (list: typeof requests, at: unknown, content: unknown, identity?: unknown) => {
    const text = visibleText(content);
    if (!text) return;
    const observed_at = date(at);
    if (observed_at < start || observed_at > until) return;
    if (text.length > (list === requests ? 4000 : 8000))
      throw new Error("発言が長すぎます。必要な範囲に絞ってください。");
    const event_id = typeof identity === "string" && identity.length <= 200 ? identity : undefined;
    const prior = list.find((item) =>
      event_id
        ? item.event_id === event_id
        : item.observed_at === observed_at && item.text === text,
    );
    if (prior && (prior.text !== text || prior.observed_at !== observed_at))
      throw new Error("同じevent IDの内容が異なります。exportを確認してください。");
    if (!prior) list.push({ observed_at, text, ...(event_id ? { event_id } : {}) });
  };
  const terminal = (at: unknown, reason: unknown) => {
    const time = date(at);
    if (time < start || time > until || (terminalAt && time < terminalAt)) return;
    terminalAt = time;
    const value = String(reason || "").toLowerCase();
    status = /interrupt|cancel|abort|exit|close|logout|clear/.test(value)
      ? "interrupted"
      : /error|fail|block|timeout/.test(value)
        ? "blocked"
        : ["success", "completed", "complete", "done", "normal"].includes(value)
          ? "completed"
          : "unknown";
  };

  if (input.adapter === "codex-rollout/1" || input.adapter === "claude-transcript/1") {
    const messages = Array.isArray(input.payload) ? input.payload : [];
    for (const message of messages) {
      const entry = record(message);
      if (entry.role !== "user" && entry.role !== "assistant") continue;
      add(entry.role === "user" ? requests : responses, entry.timestamp, entry.text, entry.id);
    }
  } else if (input.adapter === "opencode-export/1") {
    const exported = record(input.payload);
    const info = record(exported.info);
    if (
      info.id !== input.source_session ||
      !Array.isArray(exported.messages) ||
      exported.messages.length > 2000
    )
      throw new Error("OpenCode exportのsession IDと2000件以内の収録範囲を確認してください。");
    for (const rawMessage of exported.messages) {
      const message = record(rawMessage);
      const meta = record(message.info);
      if (meta.role !== "user" && meta.role !== "assistant") continue;
      const at = record(meta.time).created;
      const parts = Array.isArray(message.parts) ? message.parts : [];
      for (const rawPart of parts) {
        const part = record(rawPart);
        if (part.type === "text" && !part.synthetic && !part.ignored)
          add(meta.role === "user" ? requests : responses, at, part.text, part.id);
      }
    }
    // An export's updated timestamp does not establish session completion.
  } else if (input.adapter === "deepseek-native/1") {
    const payload = record(input.payload);
    if (
      record(payload.header).id !== input.source_session ||
      !Array.isArray(payload.events) ||
      payload.events.length > 2000
    )
      throw new Error("DeepSeekの選択logのsession IDと2000件以内の収録範囲を確認してください。");
    if (record(payload.header).version !== 4)
      throw new Error("DeepSeek native logは確認済みのformat version 4を選択してください。");
    const seen = new Map<number, string>();
    for (const rawEvent of [...payload.events].sort(
      (a, b) => Number(record(a).seq) - Number(record(b).seq),
    )) {
      const event = record(rawEvent);
      if (!Number.isSafeInteger(event.seq) || Number(event.seq) < 0)
        throw new Error("DeepSeek logにはnative seqが必要です。");
      const signature = JSON.stringify(event);
      if (seen.has(Number(event.seq)) && seen.get(Number(event.seq)) !== signature)
        throw new Error("DeepSeek seqが衝突しています。");
      seen.set(Number(event.seq), signature);
      const observedAt = date(event.time);
      if (observedAt < start || observedAt > until) continue;
      const data = record(event.data);
      if (event.type === "user/message" && record(data.source).kind === "user")
        add(requests, event.time, data.content, `seq:${event.seq}`);
      if (event.type === "assistant/message") {
        add(responses, event.time, record(data.message).content, `seq:${event.seq}`);
        // The latest visible assistant message may be interrupted. Later turns can resume.
        status = data.interrupted ? "interrupted" : "unknown";
      }
      // turn/end ends a turn, never the whole native session.
    }
  } else {
    if (!Array.isArray(input.payload) || input.payload.length > 2000)
      throw new Error("hook payloadは2000件以内のイベント配列にしてください。");
    for (const rawEvent of input.payload) {
      const event = record(rawEvent);
      if ((event.session_id || event.sessionId) !== input.source_session)
        throw new Error("hookのsession IDが一致しません。");
      const name = String(event.hook_event_name || event.hookEventName || "").toLowerCase();
      if (name === "sessionstart") {
        const observedAt = date(event.timestamp);
        if (observedAt > start && observedAt <= until)
          throw new Error("再開を含むログはSessionStartごとの区間に分けてください。");
      }
      if (name === "userpromptsubmit" || name === "userpromptsubmitted")
        add(requests, event.timestamp, event.prompt, event.prompt_id);
      if (name === "stop" && input.adapter !== "copilot-cli-hooks/1")
        add(
          responses,
          event.timestamp,
          event.last_assistant_message,
          event.turn_id || event.prompt_id,
        );
      if (name === "sessionend") terminal(event.timestamp, event.reason);
      // No transcript_path/Path, tool IO, headers, env, system, reasoning, attachments.
    }
  }
  requests.sort(
    (a, b) =>
      a.observed_at.localeCompare(b.observed_at) ||
      (a.event_id || "").localeCompare(b.event_id || ""),
  );
  responses.sort(
    (a, b) =>
      a.observed_at.localeCompare(b.observed_at) ||
      (a.event_id || "").localeCompare(b.event_id || ""),
  );
  if (terminalAt && [...requests, ...responses].some((event) => event.observed_at > terminalAt!))
    throw new Error("SessionEnd後の発言が含まれています。再開した区間を分けてください。");
  if (requests.length > 200 || responses.length > 200)
    throw new Error("発言は各200件以内の範囲を選択してください。");
  const finalStatus =
    input.coverage === "partial" && String(status) === "completed"
      ? "unknown"
      : (status as "completed" | "interrupted" | "blocked" | "unknown");
  return {
    client_kind: AGENT_LOG_ADAPTERS[input.adapter],
    source_session: input.source_session,
    started_at: start,
    ended_at: terminalAt || until,
    status: finalStatus,
    intent: {
      summary: requests[0]?.text || "依頼の記録なし",
      ...(input.title
        ? { title: redactAgentText(input.title).trim().slice(0, 200) }
        : requests[0]
          ? { title: shortAgentSessionTitle(requests[0].text) }
          : {}),
    },
    outcome: {
      summary: responses.at(-1)?.text || "成果の記録なし",
      remaining_work: [] as string[],
    },
    request_events: requests,
    response_checkpoints: responses,
    observation: {
      schema_version: 1 as const,
      adapter: input.adapter,
      client_version: input.client_version,
      coverage: input.coverage,
      observed_until: until,
      mode: "history" as const,
      ...(input.active_duration_ms !== undefined
        ? { active_duration_ms: input.active_duration_ms }
        : {}),
    },
  };
}

/**
 * 保存先のlogを読むparserの版。正規化を変えたら上げると、取り込み済みのファイルも次の同期で読み直す。
 * 2: Codex IDE拡張・Claude Codeの前置きを外して依頼本文だけを残し、委任threadを除き、
 *    会話名・AIが動いた時間・依頼の抜粋を加える（#629）。
 */
export const NATIVE_AGENT_LOG_PARSER_VERSION = 2;

const CLIENT_ONLY_MESSAGE =
  /^(?:# AGENTS\.md|<environment_context>|<user_instructions>|<system-reminder>|<local-command|<session-start-hook>)/;

/**
 * clientが依頼の前後に付ける文脈（開いているファイル・選択範囲・指示ファイル）を外し、
 * 利用者が書いた依頼だけを返す。依頼が残らないメッセージは空文字。
 */
export function userRequestText(text: string): string {
  let value = text.trim();
  // Codex IDE拡張: "# Context from my IDE setup: ... ## My request for Codex: <依頼>"
  if (/^#\s*Context from my IDE setup:/i.test(value)) {
    const marker = /##\s*My request for Codex:\s*/i.exec(value);
    if (!marker) return "";
    value = value.slice(marker.index + marker[0].length);
  }
  // Claude Code: IDEの添付・system reminderは依頼ではない。
  value = value.replace(
    /<(ide_opened_file|ide_selection|ide_diagnostics|system-reminder)>[\s\S]*?<\/\1>/g,
    "",
  );
  // slash command は「/name args」として読む。
  const command = /<command-name>\s*([^<]*?)\s*<\/command-name>/.exec(value);
  if (command) {
    const args = /<command-args>\s*([\s\S]*?)\s*<\/command-args>/.exec(value)?.[1] ?? "";
    value = value.replace(/<command-(message|name|args)>[\s\S]*?<\/command-\1>/g, "");
    value = `${command[1]} ${args}`.trim() + (value.trim() ? `\n${value.trim()}` : "");
  }
  value = value.trim();
  if (!value || CLIENT_ONLY_MESSAGE.test(value)) return "";
  return value;
}

/** Selected native file only: never follow a path found inside a transcript. */
function nativeEnvelope(values: unknown[]) {
  if (!values.length || values.length > 20000)
    throw new Error("JSONLは20000行以内のSessionを選択してください。");
  const lines = values.map(record);
  const meta = lines.filter((line) => line.type === "session_meta");
  const codex = meta.length > 0;
  if (meta.length > 1 || (codex && lines.some((line) => line.sessionId)))
    throw new Error("複数Sessionが混在しています。Sessionごとのログを選択してください。");
  const ids = new Set(lines.map((line) => line.sessionId).filter((id) => typeof id === "string"));
  if (!codex && ids.size !== 1) throw new Error("対応する単一SessionのJSONLではありません。");
  const header = codex ? record(meta[0].payload) : lines.find((line) => line.version) || {};
  const source = codex ? header.id : [...ids][0];
  const timestamp = (value: unknown) => {
    if (typeof value !== "string" || !z.iso.datetime({ offset: true }).safeParse(value).success)
      throw new Error("JSONLの観測時刻にはタイムゾーン付きISO時刻が必要です。");
    return date(value);
  };
  const timestamps = lines
    .filter((line) => line.timestamp)
    .map((line) => timestamp(line.timestamp))
    .sort();
  if (!timestamps.length) throw new Error("JSONLに観測時刻がありません。");
  const payload = lines.flatMap((line) => {
    const message = codex ? record(line.payload) : record(line.message);
    const role = message.role;
    if (
      codex
        ? line.type !== "response_item" || message.type !== "message"
        : !["user", "assistant"].includes(String(line.type)) ||
          line.type !== role ||
          line.isMeta ||
          line.isCompactSummary ||
          line.isSidechain
    )
      return [];
    if (!["user", "assistant"].includes(String(role)) || message.channel === "analysis") return [];
    const content =
      codex && Array.isArray(message.content)
        ? message.content.flatMap((part) => {
            const block = record(part);
            return block.type === (role === "user" ? "input_text" : "output_text")
              ? [{ type: "text", text: block.text }]
              : [];
          })
        : message.content;
    const visible = visibleText(content);
    const text = role === "user" ? userRequestText(visible) : visible;
    if (!text) return [];
    return [{ role, timestamp: line.timestamp, text, id: codex ? message.id : line.uuid }];
  });
  if (!payload.length) throw new Error("このJSONLには対応する依頼・回答の本文がありません。");
  return {
    schema: "tasken-ai-work-log/1",
    adapter: codex ? "codex-rollout/1" : "claude-transcript/1",
    client_version: header.cli_version || header.version || "未記録",
    source_session: source,
    started_at: codex ? timestamp(header.timestamp || meta[0].timestamp) : timestamps[0],
    observed_until: timestamps.at(-1),
    coverage: "partial",
    payload,
  };
}

export type ImportedAgentWorkLog = ReturnType<typeof parseAgentWorkLog>;

/** 1セッションから残す依頼の抜粋の上限。全文やtool出力は残さない。 */
export const NATIVE_REQUEST_EXCERPTS = { count: 5, chars: 200 } as const;

/**
 * Bounded metadata projection for the PC collector; no transcript survives this boundary.
 * 残すのは依頼の短い抜粋（最大5件×200文字）、最後の回答（500文字）、会話名、ターン処理時間の合計だけ。
 */
export function createNativeAgentLogAccumulator(service: "codex" | "claude_code") {
  let source = "";
  let version = "未記録";
  let start = "";
  let until = "";
  let metaCount = 0;
  let headerStart = "";
  let delegated = false;
  let mainSeen = false;
  let sidechainSeen = false;
  let clientTitle = "";
  let customTitle = "";
  let activeMs = 0;
  let activeSeen = false;
  let claudeActiveMs: number | null = null;
  const requests: Array<{ role: string; timestamp: string; text: string }> = [];
  let last: { role: string; timestamp: string; text: string } | undefined;
  const stamp = (value: unknown) => {
    if (typeof value !== "string" || !z.iso.datetime({ offset: true }).safeParse(value).success)
      throw new Error("観測時刻にはタイムゾーン付きISO時刻が必要です。");
    return date(value);
  };
  const duration = (value: unknown) =>
    typeof value === "number" && Number.isFinite(value) && value >= 0 ? Math.round(value) : 0;
  return {
    add(value: unknown) {
      const line = record(value);
      if (
        (service === "codex" && line.sessionId) ||
        (service === "claude_code" && line.type === "session_meta")
      )
        throw new Error("選んだサービス以外のログが混在しています。");
      if (line.timestamp) {
        const at = stamp(line.timestamp);
        if (!start || at < start) start = at;
        if (!until || at > until) until = at;
      }
      if (service === "codex" && line.type === "session_meta") {
        const header = record(line.payload);
        if (++metaCount > 1) throw new Error("複数Sessionが混在しています。");
        source = typeof header.id === "string" ? header.id : "";
        if (header.cli_version !== undefined && typeof header.cli_version !== "string")
          throw new Error("Client version の形式が不正です。");
        version = String(header.cli_version || version).slice(0, 120);
        headerStart = stamp(header.timestamp || line.timestamp);
        // 親の会話から起動されたsubagent・レビュー用のthreadは、単独のSessionとして並べない。
        delegated =
          typeof header.parent_thread_id === "string" ||
          header.thread_source === "subagent" ||
          header.thread_source === "guardian_review";
      }
      if (service === "codex" && line.type === "event_msg") {
        const event = record(line.payload);
        if (event.type === "task_complete" || event.type === "turn_aborted") {
          activeMs += duration(event.duration_ms);
          activeSeen = true;
        }
      }
      if (service === "claude_code") {
        if (line.type === "custom-title" && typeof line.customTitle === "string")
          customTitle = line.customTitle;
        if (line.type === "ai-title" && typeof line.aiTitle === "string")
          clientTitle = line.aiTitle;
        if (line.type === "cost-state")
          claudeActiveMs = duration(line.totalAPIDuration) + duration(line.totalToolDuration);
      }
      if (service === "claude_code" && typeof line.sessionId === "string") {
        if (source && source !== line.sessionId) throw new Error("複数Sessionが混在しています。");
        source = line.sessionId;
        if (line.version !== undefined && typeof line.version !== "string")
          throw new Error("Client version の形式が不正です。");
        if (line.version) version = line.version.slice(0, 120);
      }
      const message = record(service === "codex" ? line.payload : line.message);
      const role = message.role;
      if (role !== "user" && role !== "assistant") return;
      if (service === "claude_code" && line.type === role) {
        if (line.isSidechain) sidechainSeen = true;
        else mainSeen = true;
      }
      if (
        service === "codex"
          ? line.type !== "response_item" ||
            message.type !== "message" ||
            message.channel === "analysis"
          : line.type !== role || line.isMeta || line.isCompactSummary || line.isSidechain
      )
        return;
      const content =
        service === "codex" && Array.isArray(message.content)
          ? message.content.flatMap((part) => {
              const block = record(part);
              return block.type === (role === "user" ? "input_text" : "output_text")
                ? [{ type: "text", text: block.text }]
                : [];
            })
          : message.content;
      const visible = visibleText(content);
      const text = role === "user" ? userRequestText(visible) : visible;
      if (!text) return;
      const at = stamp(line.timestamp);
      if (role === "assistant") {
        if (!last || at >= last.timestamp) last = { role, timestamp: at, text: text.slice(0, 500) };
        return;
      }
      // 依頼は時刻順に先頭から数件だけ残す（同じ時刻・本文の重複は数えない）。
      if (
        requests.some((entry) => entry.timestamp === at && entry.text.startsWith(text.slice(0, 50)))
      )
        return;
      requests.push({ role, timestamp: at, text: text.slice(0, NATIVE_REQUEST_EXCERPTS.chars) });
      requests.sort((a, b) => a.timestamp.localeCompare(b.timestamp));
      if (requests.length > NATIVE_REQUEST_EXCERPTS.count) requests.pop();
    },
    sourceSession(): string {
      return source;
    },
    /** 単独のSessionとして取り込まない理由。null なら取り込む。 */
    skipReason(): "delegated_thread" | null {
      // Claude Codeのsubagentは親と同じsessionIdで別ファイルに書かれ、発言はすべてsidechainになる。
      return delegated || (service === "claude_code" && sidechainSeen && !mainSeen)
        ? "delegated_thread"
        : null;
    },
    finish(options: { title?: string } = {}): ImportedAgentWorkLog {
      if (!source || !start || !until || (service === "codex" && metaCount !== 1))
        throw new Error("選んだサービスのSession形式ではありません。");
      const title = (customTitle || options.title || clientTitle).trim().slice(0, 200);
      const active = service === "codex" ? (activeSeen ? activeMs : null) : claudeActiveMs;
      const result = parseAgentWorkLog(
        JSON.stringify({
          schema: "tasken-ai-work-log/1",
          adapter: service === "codex" ? "codex-rollout/1" : "claude-transcript/1",
          client_version: version,
          source_session: source,
          started_at: service === "codex" ? headerStart : start,
          observed_until: until,
          coverage: "partial",
          ...(title ? { title } : {}),
          ...(active !== null
            ? { active_duration_ms: Math.min(active, 30 * 24 * 60 * 60 * 1000) }
            : {}),
          payload: [...requests, ...(last ? [last] : [])],
        }),
      );
      return { ...result, response_checkpoints: [] };
    },
  };
}
