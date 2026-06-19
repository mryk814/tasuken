import type {
  CaptureEntryState,
  PlanNodeState,
  PlanNodeType,
  ProjectState,
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
