export const crossNavigation = ["inbox", "timeline"] as const;

export const toolNavigation = ["ai-io", "settings"] as const;

export const routeParent: Record<string, string> = {
  todo: "today",
  waiting: "today",
  "micro-memos": "inbox",
  notes: "knowledge",
  "sketch-editor": "sketch",
  prompts: "notes",
  "chat-refs": "knowledge",
  artifacts: "knowledge",
  "proposal-inbox": "ai-io",
};

// 旧hashとの互換用リダイレクト表。ルートIDを変更・廃止した際にここへ追記し、
// 旧リンク・履歴からの遷移先を保つ。
export const routeAliases: Record<string, string> = {
  home: "theme",
  "todo-done": "todo",
};

export const todayHubTabs = ["today", "todo"] as const;

export const knowledgeHubTabs = ["knowledge", "notes", "sketch", "chat-refs", "artifacts"] as const;

/**
 * 画面名の正本（#301）。Sidebar・ページ見出し・Command Paletteは必ずここを参照し、
 * 画面ごとに名称を手書きしない。descriptionは常時表示せずinfoから開く用途説明。
 * routeIdは内部識別子なので、表示名を変えてもここのキーは変えない。
 */
export interface RouteMeta {
  label: string;
  description?: string;
}

export const ROUTE_META = {
  today: { label: "Today", description: "今日見るものを一か所に集めます。" },
  todo: { label: "ToDo", description: "今日の作業と予定なしの仕事を整理します。" },
  waiting: { label: "Waiting", description: "誰を、何を、いつまで待っているかを確認します。" },
  inbox: { label: "Inbox", description: "クイック記録を行の中で分類し、今日の作業やThemeへ接続します。" },
  timeline: { label: "Timeline", description: "実施事項ごとに、分析依頼・試験依頼・整理などの計画を並べます。" },
  knowledge: { label: "Knowledge", description: "後から判断に使う問い・主張・根拠・決定を整理します。" },
  notes: { label: "Notes", description: "Note・Resource・Report・Promptをまとめて扱います。Markdownを書き、関連資料を参照しながら整理できます。" },
  sketch: { label: "Sketch" },
  "chat-refs": { label: "Chat Refs", description: "外部AIチャットをTheme単位で保管し、あとからNoteやKnowledgeに展開します。" },
  artifacts: { label: "Artifacts", description: "AI作業や調査から生まれた Excel・画像・PDF・Markdown などの実ファイル。メモ本文・URL・Chat Refs とは役割が違います。" },
  themes: { label: "Themes", description: "研究テーマごとの現在地と負荷を確認します。" },
  "ai-io": { label: "AI IO", description: "外部AIへ渡し、戻ってきた候補を確認してTaskenに取り込みます。" },
  settings: { label: "Settings" },
} as const satisfies Record<string, RouteMeta>;

export type LabeledRouteId = keyof typeof ROUTE_META;

export function routeLabel(id: string): string {
  return (ROUTE_META as Record<string, RouteMeta>)[id]?.label || id;
}

export function routeDescription(id: string): string | undefined {
  return (ROUTE_META as Record<string, RouteMeta>)[id]?.description;
}

export type RouteId =
  | "today"
  | "inbox"
  | "micro-memos"
  | "chat-refs"
  | "artifacts"
  | "theme"
  | "todo"
  | "timeline"
  | "themes"
  | "notes"
  | "sketch"
  | "sketch-editor"
  | "prompts"
  | "knowledge"
  | "waiting"
  | "proposal-inbox"
  | "ai-io"
  | "settings";
