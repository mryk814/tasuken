import {
  IconAlertTriangle,
  IconBulb,
  IconCheck,
  IconChevronDown,
  IconDeviceFloppy,
  IconFileText,
  IconInfoCircle,
  IconLinkPlus,
  IconPlus,
  IconTrash,
  IconX,
  type Icon,
} from "@tabler/icons-react";

import { AI_ICON } from "./semanticIcons";

export type ActionRole = "primary" | "secondary" | "ghost" | "danger" | "ai" | "status";
export type ActionAvailability = "always" | "when-selection" | "when-editing" | "when-ai-enabled" | "when-theme-selected";

export interface ActionDefinition {
  id: string;
  label: string;
  icon?: Icon;
  role: ActionRole;
  shortcut?: string;
  availability: ActionAvailability;
}

/**
 * 主要な意味付き操作の正本。全buttonを登録するのではなく、画面間で
 * label・icon・role・shortcut・availabilityが揺れる操作だけをここへ集約する。
 */
export const ACTION_DEFINITIONS = {
  todayAddTask: { id: "todayAddTask", label: "今日のTaskを追加", icon: IconPlus, role: "primary", availability: "always" },
  todoAddTask: { id: "todoAddTask", label: "タスクを追加", icon: IconPlus, role: "primary", availability: "always" },
  inboxAddMemo: { id: "inboxAddMemo", label: "Memo", icon: IconPlus, role: "primary", availability: "always" },
  inboxOrganize: { id: "inboxOrganize", label: "一括整理", role: "primary", availability: "when-selection" },
  themesAdd: { id: "themesAdd", label: "テーマを追加", icon: IconPlus, role: "primary", availability: "always" },
  themeAddTask: { id: "themeAddTask", label: "タスクを追加", icon: IconPlus, role: "primary", availability: "when-theme-selected" },
  themeAddReport: { id: "themeAddReport", label: "報告書を追加", icon: IconFileText, role: "primary", availability: "when-theme-selected" },
  timelineAddPlan: { id: "timelineAddPlan", label: "実施事項を追加", icon: IconPlus, role: "primary", availability: "always" },
  waitingAdd: { id: "waitingAdd", label: "待ちを追加", icon: IconPlus, role: "primary", availability: "always" },
  knowledgeAddQuestion: { id: "knowledgeAddQuestion", label: "問いを追加", icon: IconBulb, role: "primary", availability: "always" },
  knowledgeQuickAdd: { id: "knowledgeQuickAdd", label: "追加する", icon: IconPlus, role: "secondary", availability: "always" },
  notesCreate: { id: "notesCreate", label: "Noteを追加", icon: IconPlus, role: "primary", availability: "always" },
  notesCreateMenu: { id: "notesCreateMenu", label: "追加する種類を選ぶ", icon: IconChevronDown, role: "primary", availability: "always" },
  notesSave: { id: "notesSave", label: "保存", icon: IconDeviceFloppy, role: "primary", shortcut: "Ctrl+S", availability: "when-editing" },
  chatRefsAdd: { id: "chatRefsAdd", label: "追加", icon: IconLinkPlus, role: "primary", availability: "always" },
  aiAnswer: { id: "aiAnswer", label: "AI回答を受け取る", icon: AI_ICON, role: "ai", availability: "when-ai-enabled" },
  aiDraft: { id: "aiDraft", label: "AI Draft", icon: AI_ICON, role: "ai", availability: "when-ai-enabled" },
  aiContext: { id: "aiContext", label: "AI Context", icon: AI_ICON, role: "ai", availability: "when-ai-enabled" },
  aiProposalPreview: { id: "aiProposalPreview", label: "Preview", role: "primary", availability: "when-selection" },
  aiProposalAccept: { id: "aiProposalAccept", label: "採用を保存", icon: IconCheck, role: "primary", availability: "when-selection" },
  actionCancel: { id: "actionCancel", label: "キャンセル", icon: IconX, role: "secondary", availability: "always" },
  actionReject: { id: "actionReject", label: "却下", icon: IconX, role: "secondary", availability: "when-selection" },
  actionDelete: { id: "actionDelete", label: "削除する", icon: IconTrash, role: "danger", availability: "when-selection" },
  toastInfo: { id: "toastInfo", label: "情報", icon: IconInfoCircle, role: "status", availability: "always" },
  toastSuccess: { id: "toastSuccess", label: "完了", icon: IconCheck, role: "status", availability: "always" },
  toastWarning: { id: "toastWarning", label: "注意", icon: IconAlertTriangle, role: "status", availability: "always" },
  toastDanger: { id: "toastDanger", label: "エラー", icon: IconAlertTriangle, role: "status", availability: "always" },
} as const satisfies Record<string, ActionDefinition>;

export type ActionId = keyof typeof ACTION_DEFINITIONS;
export type ToastActionTone = "info" | "success" | "warning" | "danger";

export const TOAST_ACTIONS: Record<ToastActionTone, ActionId> = {
  info: "toastInfo",
  success: "toastSuccess",
  warning: "toastWarning",
  danger: "toastDanger",
};

export function actionDefinition(id: ActionId): ActionDefinition {
  return ACTION_DEFINITIONS[id];
}
