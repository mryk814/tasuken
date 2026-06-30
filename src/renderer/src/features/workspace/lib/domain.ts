import type { BaseRecord, Item, Theme, WorkspaceData } from "../types";

export const DAY = 86400000;

export const STATUS_LABELS: Record<string, string> = {
  inbox: "Inbox",
  todo: "未着手",
  doing: "進行中",
  waiting: "待ち",
  review: "確認待ち",
  done: "完了",
  archived: "保留",
  cancelled: "中止",
};

export const KIND_LABELS: Record<string, string> = {
  task: "タスク",
  milestone: "マイルストーン",
  period: "期間予定",
  event: "イベント",
  waiting: "待ち",
  deliverable: "成果物",
  reminder: "備忘",
  idea: "アイデア",
};

export const THEME_STATUS_LABELS: Record<string, string> = {
  on_track: "順調",
  at_risk: "注意",
  delayed: "遅延",
  paused: "保留",
  completed: "完了",
};

export const NOTE_TYPE_LABELS: Record<string, string> = {
  memo: "メモ",
  decision: "意思決定",
  meeting: "会議メモ",
  experiment: "実験記録",
  analysis: "分析",
  ai_chat: "AI対話",
  artifact: "文章成果物",
  learning: "学習",
  reflection: "振り返り",
  report_prompt: "プロンプト",
};

export const KNOWLEDGE_NODE_LABELS: Record<string, string> = {
  question: "Question",
  claim: "Claim",
  evidence: "Evidence",
  decision: "Decision",
  source: "Source",
  insight: "Insight",
};

export const KNOWLEDGE_RELATION_LABELS: Record<string, string> = {
  supports: "supports",
  contradicts: "contradicts",
  explains: "explains",
  causes: "causes",
  example_of: "example_of",
  generalizes: "generalizes",
  depends_on: "depends_on",
  derived_from: "derived_from",
  answers: "answers",
  raises: "raises",
  similar_to: "similar_to",
  leads_to: "leads_to",
};

// レベル（粒度）。Timelineに出す「大きな線」と、ToDo中心の「細かい仕事」を区別する。
// kindとは直交。period/milestoneは既定でplan、それ以外はtask。明示値があればそれを優先。
export const PLAN_KINDS = ["period", "milestone"];
export const LEVEL_LABELS: Record<string, string> = { plan: "計画（大きな線）", task: "タスク" };
export const defaultLevel = (kind?: string): string => (kind && PLAN_KINDS.includes(kind) ? "plan" : "task");
export const itemLevel = (item: Item): string => item.level || defaultLevel(item.kind);
export const hasPlannedSchedule = (item: Pick<Item, "planned_start" | "planned_end">): boolean =>
  Boolean(item.planned_start || item.planned_end);

// 進捗率は廃止し、状態（未着手/進行中/完了）から到達度を導く。イナズマ線はこの値で描く。
export function statusProgress(status?: string): number {
  switch (status) {
    case "done": case "completed": case "完了":
      return 1;
    case "doing": case "review": case "進行中": case "確認待ち":
      return 0.5;
    default:
      return 0;
  }
}

// ワークフロー状態 → 状態色トーン（tokens.css の status パレット）。
// 能動的な状態（進行中）を前に、終端（完了・中止）を後退させる。未着手・分類タグは idle（中立）。
export function statusTone(status?: string): string {
  switch (status) {
    case "done": case "completed": case "on_track": case "adopted": case "完了":
      return "done";
    case "doing": case "進行中":
      return "active";
    case "review": case "pending": case "確認待ち":
      return "review";
    case "waiting": case "at_risk": case "paused": case "待ち": case "保留":
      return "blocked";
    case "delayed": case "open":
      return "danger"; // 遅延・未解決など明確な問題系のみ警告の赤
    case "cancelled": case "stale": case "中止":
      return "dropped";
    default:
      return "idle"; // inbox / todo / 計画中 / note_type・link_type 等の分類
  }
}

export function entityTitle(type: string, entity: BaseRecord): string {
  if (type === "theme") return String(entity.name ?? "");
  if (type === "status_update") return String(entity.summary ?? "");
  return String(entity.title ?? entity.name ?? "無題");
}

export const CHART_COLORS = [
  "chart-1",
  "chart-2",
  "chart-3",
  "chart-4",
  "chart-5",
  "chart-6",
  "theme-extra-1",
  "theme-extra-2",
  "theme-extra-3",
  "theme-extra-4",
];

export function themeColor(theme: Theme | null | undefined, index = 0): string {
  const color = typeof theme?.color === "string" ? theme.color.trim() : "";
  if (CHART_COLORS.includes(color)) return color;
  const safeIndex = ((index % CHART_COLORS.length) + CHART_COLORS.length) % CHART_COLORS.length;
  return CHART_COLORS[safeIndex];
}

export function relatedEntityTitle(data: WorkspaceData, type: string, id?: string): string {
  const keys: Record<string, keyof WorkspaceData> = {
    item: "items",
    note: "notes",
    link: "links",
    source_record: "source_records",
    knowledge_node: "knowledge_nodes",
  };
  const collection = (data[keys[type]] as BaseRecord[] | undefined) || [];
  const entity = collection.find((entry) => entry.id === id);
  return String(entity?.title ?? entity?.source_title ?? entity?.name ?? id ?? "未設定");
}
