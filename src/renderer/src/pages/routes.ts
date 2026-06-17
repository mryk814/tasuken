export const crossNavigation = [
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
  | "home"
  | "todo"
  | "timeline"
  | "themes"
  | "notes"
  | "waiting"
  | "ai-io"
  | "settings";
