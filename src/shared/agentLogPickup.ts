import * as z from "zod/v4";

import { safeReceiptText as redactAgentText } from "./taskContext.mjs";

// 読み取りが依拠する公式形式（確認済み。上流コードはコピー・実行せず、本文の構造だけを参照する）:
// - Codex rollout fixture: https://github.com/openai/codex/blob/main/codex-rs/app-server/tests/common/rollout.rs
// - Codex ResponseItem/ContentItem: https://github.com/openai/codex/blob/main/codex-rs/protocol/src/models.rs
// - Claude session reader: https://github.com/anthropics/claude-agent-sdk-python/blob/main/src/claude_agent_sdk/_internal/sessions.py
// - Claude session 保存先: https://code.claude.com/docs/en/agent-sdk/sessions
// 保存先候補の根拠:
// - Codex home の解決: https://github.com/openai/codex/blob/main/codex-rs/utils/home-dir/src/lib.rs
// - Codex rollout の保存構造: 上の rollout fixture

type RecordValue = Record<string, unknown>;
function record(value: unknown): RecordValue {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as RecordValue) : {};
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

/**
 * 静かになった会話 1 つから拾う物（#751）。これだけが読み取りの境界を越える。会話の本文・
 * 途中の依頼と回答・tool の入出力は残らない。変えた物・確かめたこと・残りは作らない
 * （ログから推測で作らない）。
 */
export interface AgentLogPickup {
  client_kind: "codex" | "claude_code";
  source_session: string;
  started_at: string;
  /** ログの最後の動き。 */
  ended_at: string;
  /** 最初の依頼の先頭。依頼が読めなければ null。 */
  intent: string | null;
  /** 最後の回答の先頭。回答が読めなければ null。 */
  summary: string | null;
  /** 作業場所。リポジトリに直すためだけに渡し、保存しない。 */
  cwd: string | null;
}

/** 読み取りの境界で残す字数。記録の上限（要約 400 字・依頼 160 字）へは Core が切る。 */
const HEAD_CHARS = 500;

/**
 * 保存先のログ 1 ファイルを 1 行ずつ受けて、拾う物だけを残す。
 * 残すのは会話の ID・始まりと最後の動きの時刻・最初の依頼の先頭・最後の回答の先頭・作業場所。
 */
export function createNativeAgentLogAccumulator(service: "codex" | "claude_code") {
  let source = "";
  let start = "";
  let until = "";
  let metaCount = 0;
  let headerStart = "";
  let delegated = false;
  let mainSeen = false;
  let sidechainSeen = false;
  let cwd = "";
  let first: { timestamp: string; text: string } | undefined;
  let last: { timestamp: string; text: string } | undefined;
  const stamp = (value: unknown) => {
    if (typeof value !== "string" || !z.iso.datetime({ offset: true }).safeParse(value).success)
      throw new Error("観測時刻にはタイムゾーン付きISO時刻が必要です。");
    return new Date(value).toISOString();
  };
  const place = (value: unknown) => {
    if (!cwd && typeof value === "string" && value.trim() && value.length <= 2000)
      cwd = value.trim();
  };
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
        const id = typeof header.id === "string" ? header.id : "";
        if (metaCount > 0 && source !== id) throw new Error("複数Sessionが混在しています。");
        const at = stamp(header.timestamp || line.timestamp);
        if (metaCount > 0 && headerStart !== at)
          throw new Error("同じSessionの開始時刻が一致しません。ログの形式を確認してください。");
        if (metaCount++ === 0) {
          source = id;
          headerStart = at;
        }
        place(header.cwd);
        // 親の会話から起動されたsubagent・レビュー用のthreadは、単独の作業として並べない。
        delegated =
          delegated ||
          typeof header.parent_thread_id === "string" ||
          header.thread_source === "subagent" ||
          header.thread_source === "guardian_review";
      }
      if (service === "claude_code" && typeof line.sessionId === "string") {
        if (source && source !== line.sessionId) throw new Error("複数Sessionが混在しています。");
        source = line.sessionId;
        place(line.cwd);
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
      const entry = { timestamp: at, text: text.slice(0, HEAD_CHARS) };
      if (role === "assistant") {
        if (!last || at >= last.timestamp) last = entry;
      } else if (!first || at < first.timestamp) first = entry;
    },
    sourceSession(): string {
      return source;
    },
    /** 単独の作業として拾わない理由。null なら拾う。 */
    skipReason(): "delegated_thread" | null {
      // Claude Codeのsubagentは親と同じsessionIdで別ファイルに書かれ、発言はすべてsidechainになる。
      return delegated || (service === "claude_code" && sidechainSeen && !mainSeen)
        ? "delegated_thread"
        : null;
    },
    finish(): AgentLogPickup {
      if (!source || !start || !until || (service === "codex" && metaCount === 0))
        throw new Error("選んだサービスのSession形式ではありません。");
      if (!/^[A-Za-z0-9_.:-]{1,200}$/.test(source))
        throw new Error("Session ID の形式が不正です。");
      if (!first && !last) throw new Error("このJSONLには対応する依頼・回答の本文がありません。");
      const startedAt = service === "codex" && headerStart < start ? headerStart : start;
      return {
        client_kind: service,
        source_session: source,
        started_at: startedAt,
        ended_at: until,
        intent: first?.text || null,
        summary: last?.text || null,
        cwd: cwd || null,
      };
    },
  };
}
