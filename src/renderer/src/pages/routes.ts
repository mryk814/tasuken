export const crossNavigation = [
  ["inbox", "Inbox整理"],
  ["timeline", "Timeline"],
] as const;

export const toolNavigation = [
  ["ai-io", "AI連携"],
  ["settings", "Settings"],
] as const;

export const routeParent: Record<string, string> = {
  todo: "today",
  waiting: "today",
  "micro-memos": "inbox",
  notes: "knowledge",
  prompts: "notes",
  "chat-refs": "knowledge",
  "proposal-inbox": "ai-io",
};

// 旧hashとの互換用リダイレクト表。ルートIDを変更・廃止した際にここへ追記し、
// 旧リンク・履歴からの遷移先を保つ。
export const routeAliases: Record<string, string> = {
  home: "theme",
  "todo-done": "todo",
};

export const todayHubTabs = [
  ["today", "Today"],
  ["todo", "ToDo"],
  ["waiting", "Waiting"],
] as const;

export const knowledgeHubTabs = [
  ["knowledge", "Knowledge"],
  ["notes", "Notes"],
  ["chat-refs", "チャット参照"],
] as const;

export type RouteId =
  | "today"
  | "inbox"
  | "micro-memos"
  | "chat-refs"
  | "theme"
  | "todo"
  | "timeline"
  | "themes"
  | "notes"
  | "prompts"
  | "knowledge"
  | "waiting"
  | "proposal-inbox"
  | "ai-io"
  | "settings";
