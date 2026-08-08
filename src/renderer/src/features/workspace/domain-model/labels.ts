import type { TimelineItemState } from "../lib/timeline";
import type {
  AiAudience,
  AiAuthority,
  AiFreshness,
  AiSourceRefKind,
  AiSummaryAuthority,
  AiVisibilityPreset,
} from "../../../../../shared/aiMetadata.mjs";
import type {
  CaptureEntryState,
  EntityRefType,
  PlanNodeState,
  PlanNodeType,
  ProjectState,
  ScheduleRangeSemantics,
  TaskShelf,
  TaskState,
  WaitingState,
} from "./types";
import type { ScheduleKind } from "./scheduleSemantics";

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

/** 日付範囲の意味（#309）。内部コードを画面へ出さないための対応表。 */
export const SCHEDULE_RANGE_SEMANTICS_LABELS: Record<ScheduleRangeSemantics, string> = {
  once_within_window: "期間内に一度",
  ongoing: "期間中継続",
};

/** 選択肢の補助説明。常設の長文にせず、選択時の一行として使う。 */
export const SCHEDULE_RANGE_SEMANTICS_HINTS: Record<ScheduleRangeSemantics, string> = {
  once_within_window: "期間内に一回完了すれば終了します。",
  ongoing: "今日の実施を記録してもTask全体は継続します。",
};

/** 意味が未設定の既存範囲。分類していないことが分かる語にする。 */
export const UNSPECIFIED_RANGE_LABEL = "期間未分類";

/** ScheduleKindの画面表示。意味判定はscheduleSemantics.ts、表示語はここを正本にする。 */
export const SCHEDULE_KIND_LABELS: Record<ScheduleKind, string> = {
  none: "予定なし",
  point: "単日",
  deadline: "期限",
  execution_window: "期間内に一度",
  ongoing_period: "期間中継続",
  unspecified_range: UNSPECIFIED_RANGE_LABEL,
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
  capture_entry: "Inbox",
  ai_proposal: "AI Proposal",
};

export const ARTIFACT_GENERATED_BY_LABELS: Record<string, string> = {
  chatgpt: "ChatGPT",
  claude: "Claude",
  copilot: "Copilot",
  gemini: "Gemini",
  openai: "OpenAI",
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

/** AI可読metadata（#294）。内部コードを画面へ出さないための対応表。 */
export const AI_AUDIENCE_LABELS: Record<AiAudience, string> = {
  m365: "Microsoft 365",
  coding_agent: "Coding Agent",
  external_ai: "外部AI",
};

export const AI_VISIBILITY_PRESET_LABELS: Record<AiVisibilityPreset, string> = {
  local_only: "ローカルのみ",
  m365_allowed: "Microsoft 365まで",
  coding_agent_allowed: "Coding Agentまで",
  m365_and_coding_agent_allowed: "M365とCoding Agent",
  external_ai_allowed: "外部AIまで",
};

export const AI_FRESHNESS_LABELS: Record<AiFreshness, string> = {
  current: "現在有効",
  stale: "要再確認",
  superseded: "置き換え済み",
  unknown: "未判定",
};

export const AI_AUTHORITY_LABELS: Record<AiAuthority, string> = {
  user_confirmed: "ユーザー確認済み",
  imported: "取り込み原文",
  ai_generated: "AI生成",
  inferred: "推定",
  external_source: "外部資料の要約",
};

export const AI_SUMMARY_AUTHORITY_LABELS: Record<AiSummaryAuthority, string> = {
  user_confirmed: "ユーザー確定",
  rule_generated: "ルール生成",
  ai_generated: "AI生成",
  excerpt: "本文からの暫定",
};

export const AI_SOURCE_REF_KIND_LABELS: Record<AiSourceRefKind, string> = {
  url: "URL",
  file: "ファイル",
  canonical_document: "正本文書",
  conversation: "会話",
  meeting: "会議",
  repository: "リポジトリ",
  external_system: "外部システム",
};

/** 公開範囲がどこから来たか。未設定と明示許可を混同させないための語。 */
export const AI_VISIBILITY_SOURCE_LABELS: Record<"entity" | "theme" | "workspace_default", string> = {
  entity: "この項目で設定",
  theme: "Themeの既定を継承",
  workspace_default: "全体の既定",
};

/** 未設定であることを示す語。「無い」ではなく「決めていない」と読ませる。 */
export const AI_UNSET_LABEL = "未設定";

/** Entity参照の種別。置き換え先の指定など、種別を選ばせる場面で使う。 */
export const ENTITY_REF_TYPE_LABELS: Record<EntityRefType, string> = {
  project: "Theme",
  capture_entry: "Inbox",
  task: "タスク",
  waiting: "待ち",
  plan_node: "計画ノード",
  note: "メモ",
  resource: "リソース",
  knowledge_node: "Knowledge",
  sketch: "Sketch",
  artifact: "Artifact",
};

/** Timeline itemの状態（#318）。色だけで伝えないための語と記号の対応表。 */
export const TIMELINE_ITEM_STATE_LABELS: Record<TimelineItemState, string> = {
  completed: "完了",
  cancelled: "中止",
  overdue: "期限超過",
  ongoing: "継続中",
  execution_window: "期間内に一度",
  active: "進行中",
  planned: "未着手",
};

/** barの中でも状態が分かるようにする記号。読み上げからは外し、labelを正本にする。 */
export const TIMELINE_ITEM_STATE_MARKS: Record<TimelineItemState, string> = {
  completed: "✓",
  cancelled: "×",
  overdue: "!",
  ongoing: "→",
  execution_window: "◇",
  active: "▶",
  planned: "",
};
