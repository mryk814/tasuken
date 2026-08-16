import type { Entity, EntityType } from "./types/workspace";

export const DEFAULT_ROOT_SHORTCUT = "CommandOrControl+Shift+Space";
export const ROOT_SHORTCUT_PREFERENCE_KEY = "taskenRoot.globalShortcut";
export const ROOT_USAGE_PREFERENCE_KEY = "taskenRoot.usage.v1";

export const DIRECT_SHORTCUT_DEFINITIONS = [
  { id: "quick-capture", label: "Quick Capture", accelerator: "CommandOrControl+Shift+N" },
  { id: "today-task", label: "Taskを追加", accelerator: "CommandOrControl+Shift+M" },
  { id: "done-task", label: "完了Taskを記録", accelerator: "CommandOrControl+Shift+," },
  { id: "micro-memo", label: "Micro Memoを記録", accelerator: "CommandOrControl+Shift+." },
] as const;

export type RootTargetKind = "command" | "task" | "note" | "theme" | "resource" | "artifact";
export type RootActionSafety = "read" | "write" | "destructive" | "external";
export type RootActionRole = "primary" | "secondary" | "danger";

export interface RootActionTarget {
  kind: RootTargetKind;
  id: string;
  entity?: Entity;
}

export interface RootActionAvailability {
  available: boolean;
  reason?: string;
}

export interface RootActionDefinition {
  id: string;
  label: string;
  icon: string;
  keywords: string[];
  appliesTo: RootTargetKind[];
  primaryFor?: RootTargetKind[];
  shortcut?: string;
  role: RootActionRole;
  safety: RootActionSafety;
  availability?: (target: RootActionTarget) => RootActionAvailability;
}

const available = (): RootActionAvailability => ({ available: true });
const taskIsActive = (target: RootActionTarget): RootActionAvailability => {
  const state = String(target.entity?.state || "");
  return state === "done" || state === "cancelled"
    ? { available: false, reason: "完了・中止済みのTaskでは開始できません。" }
    : available();
};
const taskCanComplete = (target: RootActionTarget): RootActionAvailability => (
  String(target.entity?.state || "") === "done"
    ? { available: false, reason: "このTaskは完了済みです。" }
    : available()
);
const taskCanReopen = (target: RootActionTarget): RootActionAvailability => (
  String(target.entity?.state || "") === "done"
    ? available()
    : { available: false, reason: "完了済みのTaskだけ再開できます。" }
);

/**
 * Main UI・Context Menu・Tasken Root・将来のAI routingで共有するActionの意味契約。
 * 実行処理は各surfaceのadapterへ渡し、Task mutationはApplication Commandへ集約する。
 */
export const ROOT_ACTION_DEFINITIONS: readonly RootActionDefinition[] = [
  { id: "open", label: "開く", icon: "open", keywords: ["open", "表示"], appliesTo: ["task", "note", "theme", "resource", "artifact"], primaryFor: ["task", "note", "theme", "resource", "artifact"], shortcut: "Enter", role: "primary", safety: "read" },
  { id: "execute", label: "実行", icon: "command", keywords: ["run", "実行"], appliesTo: ["command"], primaryFor: ["command"], shortcut: "Enter", role: "primary", safety: "read" },
  { id: "focus", label: "Focusを開始", icon: "focus", keywords: ["集中", "session"], appliesTo: ["task"], role: "secondary", safety: "write", availability: taskIsActive },
  { id: "complete", label: "完了", icon: "complete", keywords: ["done", "finish"], appliesTo: ["task"], role: "secondary", safety: "write", availability: taskCanComplete },
  { id: "reopen", label: "再開", icon: "reopen", keywords: ["戻す", "open"], appliesTo: ["task"], role: "secondary", safety: "write", availability: taskCanReopen },
  { id: "edit", label: "編集", icon: "edit", keywords: ["change", "変更"], appliesTo: ["task", "note"], role: "secondary", safety: "write" },
  { id: "open-window", label: "別Windowで開く", icon: "window", keywords: ["detach", "切り離す"], appliesTo: ["note"], role: "secondary", safety: "read" },
  { id: "open-external", label: "外部で開く", icon: "external", keywords: ["file", "browser"], appliesTo: ["artifact"], role: "secondary", safety: "external" },
  { id: "show-folder", label: "フォルダを開く", icon: "folder", keywords: ["directory", "場所"], appliesTo: ["artifact"], role: "secondary", safety: "external" },
  { id: "copy-link", label: "stable linkをコピー", icon: "link", keywords: ["URL", "参照"], appliesTo: ["task", "note", "theme", "resource", "artifact"], role: "secondary", safety: "read" },
];

export function rootActionsForTarget(target: RootActionTarget): Array<RootActionDefinition & RootActionAvailability> {
  return ROOT_ACTION_DEFINITIONS
    .filter((definition) => definition.appliesTo.includes(target.kind))
    .map((definition) => ({ ...definition, ...(definition.availability?.(target) || available()) }));
}

export function rootPrimaryAction(target: RootActionTarget): RootActionDefinition | undefined {
  return ROOT_ACTION_DEFINITIONS.find((definition) => definition.primaryFor?.includes(target.kind));
}

export function normalizeRootShortcut(value: unknown): string {
  const shortcut = typeof value === "string" ? value.trim() : "";
  return shortcut || DEFAULT_ROOT_SHORTCUT;
}

export function rootEntityType(kind: RootTargetKind): EntityType | null {
  if (kind === "task" || kind === "note" || kind === "theme" || kind === "resource" || kind === "artifact") return kind;
  return null;
}
