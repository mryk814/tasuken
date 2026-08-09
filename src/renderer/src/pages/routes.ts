import {
  IconBulb,
  IconChecklist,
  IconInbox,
  IconMessageCircle,
  IconNotes,
  IconPaperclip,
  IconSettings,
  IconSparkles,
  IconSun,
  IconTimeline,
  IconWriting,
  type Icon,
} from "@tabler/icons-react";

export type CanonicalRouteId =
  | "today"
  | "todo"
  | "waiting"
  | "inbox"
  | "timeline"
  | "knowledge"
  | "notes"
  | "sketch"
  | "chat-refs"
  | "artifacts"
  | "theme"
  | "themes"
  | "ai-io"
  | "settings";

export type RouteId = CanonicalRouteId
  | "home"
  | "todo-done"
  | "micro-memos"
  | "sketch-editor"
  | "prompts"
  | "proposal-inbox";

export type RouteGroup = "today" | "cross" | "knowledge" | "themes" | "tools";
export type RouteAvailability = "always" | "requires-active-theme";
export type RouteSemanticRole = "hub" | "view" | "tool" | "context";

export interface RouteAliasDefinition {
  id: string;
  parent?: CanonicalRouteId;
  /**
   * redirect は旧URLを正規画面へ寄せる。child は親のlabel/iconを共有しつつ、
   * 自身の画面IDを保つ（例: Sketch一覧に対する編集画面）。
   */
  kind?: "redirect" | "child";
}

export interface RouteDefinition {
  id: CanonicalRouteId;
  label: string;
  description?: string;
  icon: Icon;
  semanticRole: RouteSemanticRole;
  shortcut?: string;
  availability: RouteAvailability;
  navigation: {
    group: RouteGroup;
    parent?: CanonicalRouteId;
    order: number;
  };
  aliases?: readonly RouteAliasDefinition[];
}

/**
 * Route label・icon・navigation・availabilityの唯一の正本。
 * Sidebar、PageHeader、Command Paletteはこの定義から投影する。
 */
export const ROUTE_DEFINITIONS = {
  today: {
    id: "today", label: "Today", description: "今日見るものを一か所に集めます。", icon: IconSun,
    semanticRole: "hub", availability: "always", navigation: { group: "today", order: 1 },
  },
  todo: {
    id: "todo", label: "ToDo", description: "今日の作業と予定なしの仕事を整理します。", icon: IconChecklist,
    semanticRole: "view", availability: "always", navigation: { group: "today", parent: "today", order: 2 },
    aliases: [{ id: "todo-done" }],
  },
  waiting: {
    id: "waiting", label: "Waiting", description: "誰を、何を、いつまで待っているかを確認します。", icon: IconTimeline,
    semanticRole: "view", availability: "always", navigation: { group: "today", parent: "today", order: 3 },
  },
  inbox: {
    id: "inbox", label: "Inbox", description: "クイック記録を行の中で分類し、今日の作業やThemeへ接続します。", icon: IconInbox,
    semanticRole: "hub", availability: "always", navigation: { group: "cross", order: 1 },
    aliases: [{ id: "micro-memos", parent: "inbox" }],
  },
  timeline: {
    id: "timeline", label: "Timeline", description: "実施事項ごとに、分析依頼・試験依頼・整理などの計画を並べます。", icon: IconTimeline,
    semanticRole: "view", availability: "always", navigation: { group: "cross", order: 2 },
  },
  knowledge: {
    id: "knowledge", label: "Knowledge", description: "既存データを読み取り、Research / Diagnosticとして確認します。", icon: IconBulb,
    semanticRole: "tool", availability: "always", navigation: { group: "tools", order: 3 },
  },
  notes: {
    id: "notes", label: "Notes", description: "Note・Resource・Report・Promptをまとめて扱います。Markdownを書き、関連資料を参照しながら整理できます。", icon: IconNotes,
    semanticRole: "view", availability: "always", navigation: { group: "knowledge", parent: "knowledge", order: 2 },
    aliases: [{ id: "prompts", parent: "notes" }],
  },
  sketch: {
    id: "sketch", label: "Sketch", icon: IconWriting,
    semanticRole: "view", availability: "always", navigation: { group: "knowledge", parent: "knowledge", order: 3 },
    aliases: [{ id: "sketch-editor", parent: "sketch", kind: "child" }],
  },
  "chat-refs": {
    id: "chat-refs", label: "Chat Refs", description: "外部AIチャットをTheme単位で保管し、あとからNoteやKnowledgeに展開します。", icon: IconMessageCircle,
    semanticRole: "view", availability: "always", navigation: { group: "knowledge", parent: "knowledge", order: 4 },
  },
  artifacts: {
    id: "artifacts", label: "Artifacts", description: "AI作業や調査から生まれた Excel・画像・PDF・Markdown などの実ファイル。メモ本文・URL・Chat Refs とは役割が違います。", icon: IconPaperclip,
    semanticRole: "view", availability: "always", navigation: { group: "knowledge", parent: "knowledge", order: 5 },
  },
  theme: {
    id: "theme", label: "Theme", description: "選択中の研究テーマの現在地と作業を確認します。", icon: IconBulb,
    semanticRole: "context", availability: "requires-active-theme", navigation: { group: "themes", order: 1 },
    aliases: [{ id: "home" }],
  },
  themes: {
    id: "themes", label: "Themes", description: "研究テーマごとの現在地と負荷を確認します。", icon: IconBulb,
    semanticRole: "view", availability: "always", navigation: { group: "themes", order: 2 },
  },
  "ai-io": {
    id: "ai-io", label: "AI Inbox", description: "外部AIから届いたProposalを確認し、採用する内容だけをTaskenへ反映します。", icon: IconSparkles,
    semanticRole: "tool", availability: "always", navigation: { group: "tools", order: 1 },
    aliases: [{ id: "proposal-inbox", parent: "ai-io" }],
  },
  settings: {
    id: "settings", label: "Settings", icon: IconSettings,
    semanticRole: "tool", availability: "always", navigation: { group: "tools", order: 2 },
  },
} as const satisfies Record<CanonicalRouteId, RouteDefinition>;

const definitions = Object.values(ROUTE_DEFINITIONS) as RouteDefinition[];

export const routeAliases: Record<string, string> = Object.fromEntries(
  definitions.flatMap((definition) => (definition.aliases || []).map((alias) => [alias.id, definition.id])),
);

const routeRedirects: Record<string, string> = Object.fromEntries(
  definitions.flatMap((definition) => (definition.aliases || [])
    .filter((alias) => alias.kind !== "child")
    .map((alias) => [alias.id, definition.id])),
);

export const routeParent: Record<string, string> = Object.fromEntries(
  definitions.flatMap((definition) => {
    const entries: [string, string][] = [];
    if (definition.navigation.parent) entries.push([definition.id, definition.navigation.parent]);
    for (const alias of definition.aliases || []) {
      if (alias.parent) entries.push([alias.id, alias.parent]);
    }
    return entries;
  }),
);

function routeIdsForGroup(group: RouteGroup): string[] {
  return definitions
    .filter((definition) => definition.navigation.group === group)
    .sort((a, b) => a.navigation.order - b.navigation.order)
    .map((definition) => definition.id);
}

export const crossNavigation = routeIdsForGroup("cross");
export const toolNavigation = routeIdsForGroup("tools");
export const todayHubTabs = routeIdsForGroup("today").filter((id) => id !== "waiting");
export const knowledgeHubTabs = routeIdsForGroup("knowledge");

export function resolveRouteId(id: string): CanonicalRouteId | undefined {
  const resolved = routeAliases[id] || id;
  return resolved in ROUTE_DEFINITIONS ? resolved as CanonicalRouteId : undefined;
}

/** URL・保存済みrouteを、実在する子画面を潰さずに正規化する。 */
export function normalizeRoute(route: string): string {
  if (/^settings(?:[/?].*)?$/.test(route)) return "settings";
  return routeRedirects[route] || route;
}

export function routeDefinition(id: string): RouteDefinition | undefined {
  const resolved = resolveRouteId(id);
  return resolved ? ROUTE_DEFINITIONS[resolved] : undefined;
}

export function routeIcon(id: string): Icon | undefined {
  return routeDefinition(id)?.icon;
}

export function routeLabel(id: string): string {
  return routeDefinition(id)?.label || id;
}

export function routeDescription(id: string): string | undefined {
  return routeDefinition(id)?.description;
}

export function routeAvailability(id: string): RouteAvailability | undefined {
  return routeDefinition(id)?.availability;
}

export const navigationGroups = {
  today: todayHubTabs,
  cross: crossNavigation,
  knowledge: knowledgeHubTabs,
  tools: toolNavigation,
} as const;
