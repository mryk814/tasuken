/**
 * Feed投稿の投稿者の識別。DesktopのFeed画面とAndroidへ渡すread modelが同じ規則を使う。
 *
 * 出所の表示名（`source_app` / `request.caller`）から投稿者を決める。
 * 実在の名前を変えず、判別できなければ `external_ai` にする。
 */

/** @typedef {"human" | "ai" | "auto_record"} FeedAuthorKind */

export const FEED_AUTHOR_IDENTITIES = Object.freeze({
  self: { label: "自分", kind: "human" },
  codex: { label: "Codex", kind: "ai" },
  claude: { label: "Claude Code", kind: "ai" },
  github_copilot: { label: "GitHub Copilot", kind: "ai" },
  cursor: { label: "Cursor", kind: "ai" },
  gemini: { label: "Gemini", kind: "ai" },
  deepseek: { label: "DeepSeek", kind: "ai" },
  antigravity: { label: "Antigravity", kind: "ai" },
  opencode: { label: "OpenCode", kind: "ai" },
  tasken: { label: "Tasken", kind: "auto_record" },
  external_ai: { label: "外部AI", kind: "ai" },
});

/** @param {string} label */
export function authorIdForLabel(label) {
  const value = String(label).toLowerCase();
  if (value.includes("codex")) return "codex";
  if (value.includes("claude")) return "claude";
  if (value.includes("copilot") || value.includes("github copilot")) return "github_copilot";
  if (value.includes("cursor")) return "cursor";
  if (value.includes("gemini")) return "gemini";
  if (value.includes("deepseek")) return "deepseek";
  if (value.includes("antigravity")) return "antigravity";
  if (value.includes("opencode") || value.includes("open code")) return "opencode";
  if (value.includes("tasken")) return "tasken";
  return "external_ai";
}
