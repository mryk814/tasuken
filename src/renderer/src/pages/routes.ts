export const crossNavigation = [
  ["today", "Today"],
  ["inbox", "Inbox整理"],
  ["chat-refs", "チャット参照"],
  ["todo", "ToDo"],
  ["timeline", "Timeline"],
  ["notes", "Notes"],
  ["waiting", "Waiting"],
] as const;

export const toolNavigation = [
  ["ai-io", "AI Import / Export"],
  ["settings", "Settings"],
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
  | "waiting"
  | "ai-io"
  | "settings";
