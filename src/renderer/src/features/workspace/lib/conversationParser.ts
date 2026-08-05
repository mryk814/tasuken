import { splitFrontmatter } from "./markdown";

export interface ConversationMessage {
  role: "user" | "assistant" | "system" | "tool";
  displayName: string;
  content: string;
}

export interface ConversationFrontmatter {
  provider?: string;
  source_url?: string;
  title?: string;
  captured_at?: string;
  source_format?: string;
  fidelity?: string;
}

export interface ParsedConversation {
  frontmatter: ConversationFrontmatter;
  messages: ConversationMessage[];
  rawBody: string;
  messageCount: number;
  inferredTitle: string;
  inferredLinkType: string;
}

const PROVIDER_TO_LINK_TYPE: Record<string, string> = {
  chatgpt: "chatgpt",
  openai: "chatgpt",
  claude: "claude",
  claude_code: "claude",
  gemini: "gemini",
  google_ai_studio: "gemini",
  copilot: "copilot",
  microsoft_365_copilot: "copilot",
  vscode_copilot: "copilot",
  github_copilot: "copilot",
  codex: "chatgpt",
};

const USER_PATTERNS = [/you/i, /user/i, /ユーザー/, /🧑/, /human/i];
const ASSISTANT_PATTERNS = [
  /copilot/i, /assistant/i, /claude/i, /chatgpt/i, /gemini/i, /gpt/i,
  /ai/i, /🤖/, /bot/i,
];
const TOOL_PATTERNS = [/tool/i, /🔧/, /function/i];
const SYSTEM_PATTERNS = [/system/i, /🔒/];

const HEADING_RE = /^(#{2,3})\s+(.+)$/;

/**
 * 会話のロール見出しは同じレベルで揃っている前提で、明示的にロール判定できる
 * 見出しのうち最も浅いレベルを区切りに採用する。返答本文の中の小見出し
 * （例: `### 1. Setを使う方法`）を独立メッセージに切り出さないための判定。
 */
function detectRoleHeadingLevel(lines: string[]): number | null {
  let level: number | null = null;
  for (const line of lines) {
    const match = line.match(HEADING_RE);
    if (!match) continue;
    if (!isRoleHeading(match[2])) continue;
    const depth = match[1].length;
    if (level === null || depth < level) level = depth;
  }
  return level;
}

function isRoleHeading(heading: string): boolean {
  return (
    matchesAny(heading, USER_PATTERNS) ||
    matchesAny(heading, ASSISTANT_PATTERNS) ||
    matchesAny(heading, TOOL_PATTERNS) ||
    matchesAny(heading, SYSTEM_PATTERNS)
  );
}

function inferRole(heading: string): { role: ConversationMessage["role"]; displayName: string } {
  const cleaned = heading.replace(/[\p{Emoji_Presentation}\p{Extended_Pictographic}]/gu, "").trim();
  // 表示名から絵文字を落とす（design-standard: 絵文字アイコンは使わない）。
  const displayName = cleaned || heading.trim();

  for (const pattern of USER_PATTERNS) {
    if (pattern.test(cleaned)) return { role: "user", displayName };
  }
  for (const TOOL_PATTERN of TOOL_PATTERNS) {
    if (TOOL_PATTERN.test(cleaned)) return { role: "tool", displayName };
  }
  for (const pattern of SYSTEM_PATTERNS) {
    if (pattern.test(cleaned)) return { role: "system", displayName };
  }
  for (const pattern of ASSISTANT_PATTERNS) {
    if (pattern.test(cleaned)) return { role: "assistant", displayName };
  }
  return { role: "assistant", displayName };
}

export function parseFlatYaml(text: string): Record<string, string> {
  const result: Record<string, string> = {};
  for (const line of text.split(/\r?\n/)) {
    const match = line.match(/^([A-Za-z_][A-Za-z0-9_]*):\s*(.*)$/);
    if (!match) continue;
    const value = match[2].trim();
    result[match[1]] = value.replace(/^["']|["']$/g, "");
  }
  return result;
}

export function parseConversationMessages(body: string): ConversationMessage[] {
  const lines = body.split(/\r?\n/);
  const roleLevel = detectRoleHeadingLevel(lines);
  if (roleLevel === null) return [];

  const messages: ConversationMessage[] = [];
  let currentRole: ConversationMessage["role"] | null = null;
  let currentDisplayName = "";
  let currentLines: string[] = [];

  function flush() {
    if (currentRole === null) return;
    const content = currentLines.join("\n").trim();
    if (content) {
      messages.push({ role: currentRole, displayName: currentDisplayName, content });
    }
    currentLines = [];
  }

  for (const line of lines) {
    const headingMatch = line.match(HEADING_RE);
    if (headingMatch && headingMatch[1].length === roleLevel) {
      flush();
      const inferred = inferRole(headingMatch[2]);
      currentRole = inferred.role;
      currentDisplayName = inferred.displayName;
      continue;
    }
    if (currentRole !== null) {
      currentLines.push(line);
    }
  }
  flush();
  return messages;
}

export function mapProviderToLinkType(provider: string): string {
  const key = provider.toLowerCase().trim();
  return PROVIDER_TO_LINK_TYPE[key] || "other";
}

export function parseConversation(text: string): ParsedConversation {
  const { frontmatter: fmText, body } = splitFrontmatter(text);
  const fmRaw = fmText ? parseFlatYaml(fmText) : {};

  const frontmatter: ConversationFrontmatter = {
    provider: fmRaw.provider || undefined,
    source_url: fmRaw.source_url || undefined,
    title: fmRaw.title || undefined,
    captured_at: fmRaw.captured_at || undefined,
    source_format: fmRaw.source_format || undefined,
    fidelity: fmRaw.fidelity || undefined,
  };

  const messages = parseConversationMessages(body);

  const firstUserMessage = messages.find((m) => m.role === "user");
  const titleFromMessage = firstUserMessage
    ? firstUserMessage.content.split("\n")[0].slice(0, 60).trim()
    : "";
  const inferredTitle = frontmatter.title || titleFromMessage || "Imported conversation";

  const inferredLinkType = frontmatter.provider
    ? mapProviderToLinkType(frontmatter.provider)
    : "other";

  return {
    frontmatter,
    messages,
    rawBody: body,
    messageCount: messages.length,
    inferredTitle,
    inferredLinkType,
  };
}

export function isConversationMarkdown(body: string): boolean {
  const lines = body.split(/\r?\n/);
  let hasUser = false;
  let hasAssistant = false;
  for (const line of lines) {
    const match = line.match(HEADING_RE);
    if (!match) continue;
    const heading = match[2];
    if (matchesAny(heading, USER_PATTERNS)) hasUser = true;
    else if (matchesAny(heading, ASSISTANT_PATTERNS)) hasAssistant = true;
    if (hasUser && hasAssistant) return true;
  }
  return false;
}

function matchesAny(text: string, patterns: RegExp[]): boolean {
  const cleaned = text.replace(/[\p{Emoji_Presentation}\p{Extended_Pictographic}]/gu, "").trim();
  return patterns.some((p) => p.test(cleaned));
}
