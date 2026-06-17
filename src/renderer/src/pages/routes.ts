export const crossNavigation = [
  ["today", "Today"],
  ["inbox", "Inbox整理"],
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
  | "home"
  | "todo"
  | "timeline"
  | "themes"
  | "notes"
  | "waiting"
  | "ai-io"
  | "settings";
