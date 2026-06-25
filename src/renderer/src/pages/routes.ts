export const crossNavigation = [
  ["inbox", "Inbox整理"],
  ["timeline", "Timeline"],
] as const;

export const toolNavigation = [
  ["proposal-inbox", "Proposal Inbox"],
  ["ai-io", "AI Import / Export"],
  ["settings", "Settings"],
] as const;

export const routeParent: Record<string, string> = {
  todo: "today",
  waiting: "today",
  notes: "knowledge",
  "chat-refs": "knowledge",
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
  | "chat-refs"
  | "home"
  | "todo"
  | "timeline"
  | "themes"
  | "notes"
  | "knowledge"
  | "waiting"
  | "proposal-inbox"
  | "ai-io"
  | "settings";
