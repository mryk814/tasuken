import type { ConversationMessage } from "./conversationParser";

/** Viewerからのコピーは常に本文の原文（Markdown source）を出す。要約・書き換えはしない。 */
export type ConversationCopyOptions = {
  /** 話者見出し（`## User`）を付けるか。falseなら本文だけ。 */
  withSpeaker?: boolean;
  /** tool / system messageを含めるか。既定は除外。 */
  includeToolAndSystem?: boolean;
};

export type ConversationCopySelection = {
  markdown: string;
  /** コピーしたmessage件数。 */
  count: number;
  /** 既定ルールで除外したtool / system messageの件数。 */
  excluded: number;
};

function isMainMessage(message: ConversationMessage): boolean {
  return message.role === "user" || message.role === "assistant";
}

export function conversationMessageMarkdown(
  message: ConversationMessage,
  { withSpeaker = true }: Pick<ConversationCopyOptions, "withSpeaker"> = {},
): string {
  const body = message.content.trim();
  if (!withSpeaker) return body;
  return `## ${message.displayName}\n\n${body}`;
}

/**
 * 1つのやり取り（User質問とその直後のAssistant回答）の範囲を返す。
 * Assistant側のmessageを起点にした場合も、直前のUser質問から始まる同じ組を返す。
 * 間に挟まるtool / system messageは範囲に含めるが、Markdown化の時点で既定は除外する。
 */
export function conversationTurnRange(
  messages: ConversationMessage[],
  index: number,
): { from: number; to: number } | null {
  if (!messages[index]) return null;

  let from = index;
  while (from > 0 && messages[from].role !== "user") from -= 1;
  if (messages[from].role !== "user") from = index;

  let to = from;
  let sawAssistant = false;
  for (let cursor = from + 1; cursor < messages.length; cursor += 1) {
    const role = messages[cursor].role;
    if (role === "user") break;
    if (role === "assistant") {
      if (sawAssistant) break;
      sawAssistant = true;
    }
    to = cursor;
  }
  // Assistant回答が続かない単独messageは、そのmessage1件として扱う。
  if (!sawAssistant) return { from: index, to: index };
  return { from, to };
}

export function conversationRangeMarkdown(
  messages: ConversationMessage[],
  from: number,
  to: number,
  { withSpeaker = true, includeToolAndSystem = false }: ConversationCopyOptions = {},
): ConversationCopySelection {
  const start = Math.max(0, Math.min(from, to));
  const end = Math.min(messages.length - 1, Math.max(from, to));
  if (!messages.length || start > end) return { markdown: "", count: 0, excluded: 0 };

  const range = messages.slice(start, end + 1);
  const picked = includeToolAndSystem ? range : range.filter(isMainMessage);
  const markdown = picked
    .map((message) => conversationMessageMarkdown(message, { withSpeaker }))
    .join(withSpeaker ? "\n\n" : "\n\n---\n\n")
    .trim();

  return { markdown, count: picked.length, excluded: range.length - picked.length };
}
