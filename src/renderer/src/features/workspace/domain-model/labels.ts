import type {
  CaptureEntryState,
  PlanNodeState,
  PlanNodeType,
  ProjectState,
  TaskShelf,
  TaskState,
  WaitingState,
} from "./types";

export const PROJECT_STATE_LABELS: Record<ProjectState, string> = {
  idea: "構想",
  active: "進行中",
  paused: "保留",
  closed: "終了",
};

export const CAPTURE_ENTRY_STATE_LABELS: Record<CaptureEntryState, string> = {
  untriaged: "未整理",
  triaged: "整理済み",
  archived: "アーカイブ",
};

export const TASK_STATE_LABELS: Record<TaskState, string> = {
  todo: "未着手",
  doing: "進行中",
  waiting: "待ち",
  review: "確認待ち",
  done: "完了",
  cancelled: "中止",
};

export const TASK_SHELF_LABELS: Record<TaskShelf, string> = {
  maybe_today: "今日できたら",
  this_evening: "夜/後で",
  this_week: "今週",
  someday: "いつか",
  backlog: "Backlog",
};

export const WAITING_STATE_LABELS: Record<WaitingState, string> = {
  waiting: "待ち",
  received: "受領",
  cancelled: "中止",
};

export const PLAN_NODE_TYPE_LABELS: Record<PlanNodeType, string> = {
  phase: "フェーズ",
  milestone: "マイルストーン",
  deliverable: "成果物",
};

export const PLAN_NODE_STATE_LABELS: Record<PlanNodeState, string> = {
  planned: "計画中",
  active: "進行中",
  done: "完了",
  cancelled: "中止",
};

export const ARTIFACT_SOURCE_TYPE_LABELS: Record<string, string> = {
  chat_ref: "Chat参照",
  task: "タスク",
  note: "メモ",
  report: "報告",
  theme: "Theme",
};

export const ARTIFACT_GENERATED_BY_LABELS: Record<string, string> = {
  chatgpt: "ChatGPT",
  claude: "Claude",
  copilot: "Copilot",
  gemini: "Gemini",
  manual: "手動",
};

export const ARTIFACT_STORAGE_MODE_LABELS: Record<string, string> = {
  managed: "Tasken管理",
  linked: "リンク",
};

export const ARTIFACT_LINK_TYPE_LABELS: Record<string, string> = {
  url: "URL",
  local_path: "ローカルパス",
  shared_path: "共有パス",
  onedrive: "OneDrive",
  sharepoint: "SharePoint",
  teams: "Teams",
};

export const ARTIFACT_LINK_STATUS_LABELS: Record<string, string> = {
  unknown: "未確認",
  ok: "到達可",
  broken: "リンク切れ",
  inaccessible: "アクセス不可",
};
