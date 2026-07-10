import type { Resource } from "../domain-model/types";
import { isKnownChatService, resolveChatService } from "./chatServices";

export const UNGROUPED_CHAT_GROUP = "__ungrouped__";
const CHAT_DISPLAY_TIME_ZONE = "Asia/Tokyo";

/** グループ内のリンク並び順 */
export type ChatRefSortOrder = "manual" | "newest" | "oldest";
/** グループ同士の並び順。将来のピン留めは recent/name の前段で優先する想定 */
export type ChatGroupSortOrder = "recent" | "name";

export type ChatRefGroup = {
  key: string;
  label: string;
  resources: Resource[];
  /** グループの最終利用時刻（ISO等）。recent 並びとピン留め共存時の二次キーに使う */
  activityAt: string;
  /** 将来のピン留め用。現状は常に false。true のグループを recent/name より前へ出す */
  pinned?: boolean;
};

export type GroupChatResourcesOptions = {
  resourceOrder?: ChatRefSortOrder;
  groupOrder?: ChatGroupSortOrder;
  /**
   * テストや特殊用途向けの上書き。通常UIでは使わない。
   * 「最近利用」は保存後の updated_at 等から導出する（クリックだけでは動かさない）。
   */
  groupActivityByKey?: Record<string, string>;
  /** groupActivityByKey を引くときの Theme スコープ */
  themeId?: string | null;
};

export function chatGroupKey(resource: Pick<Resource, "chat_group"> | { chat_group?: string | null }): string {
  return String(resource.chat_group || "").trim() || UNGROUPED_CHAT_GROUP;
}

export function chatGroupActivityKey(themeId: string | null | undefined, groupKey: string): string {
  return `${themeId || "_"}:${groupKey}`;
}

/**
 * 1リソースの「編集・保存」時刻。updated_at を最優先し、なければ作成・取得日。
 * クリックやリンクを開いただけでは更新されない正本フィールドだけを見る。
 */
export function chatResourceActivityAt(resource: Resource): string {
  for (const key of ["updated_at", "created_at", "captured_at"] as const) {
    const value = textField(resource, key);
    if (value) return value;
  }
  return "";
}

/** グループの最終利用時刻 = メンバの保存時刻の最大（任意の external 上書きはテスト用） */
export function chatGroupActivityAt(resources: Resource[], externalTouch?: string): string {
  let max = String(externalTouch || "");
  for (const resource of resources) {
    const value = chatResourceActivityAt(resource);
    if (value && value > max) max = value;
  }
  return max;
}

/**
 * ピン留め将来対応: pinned を先に、続けて groupOrder、最後に名前で安定化。
 * 未分類は常に末尾（フォルダ運用の逃げ場として固定）。
 */
export function compareChatGroups(a: ChatRefGroup, b: ChatRefGroup, groupOrder: ChatGroupSortOrder): number {
  if (a.key === UNGROUPED_CHAT_GROUP && b.key !== UNGROUPED_CHAT_GROUP) return 1;
  if (b.key === UNGROUPED_CHAT_GROUP && a.key !== UNGROUPED_CHAT_GROUP) return -1;

  const aPinned = Boolean(a.pinned);
  const bPinned = Boolean(b.pinned);
  if (aPinned !== bPinned) return aPinned ? -1 : 1;

  if (groupOrder === "recent") {
    const activityCompare = b.activityAt.localeCompare(a.activityAt);
    if (activityCompare) return activityCompare;
  }
  return a.label.localeCompare(b.label, "ja-JP");
}

export function isChatReference(resource: Resource): boolean {
  if (resource.resource_scope === "note") return false;
  if (resource.resource_scope === "chat_ref") return true;
  return isKnownChatService(resource.link_type) || resolveChatService(resource) !== "other" || Boolean(resource.reference_status);
}

/** Archive 済みか（削除・グループ解除とは独立） */
export function isChatArchived(resource: Resource): boolean {
  return Boolean(String(resource.archived_at || "").trim());
}

/** 通常一覧用: Archive を除く / Archive棚用: Archive のみ */
export function filterChatResourcesByArchive(
  resources: Resource[],
  mode: "active" | "archive",
  options: { includeArchivedInActive?: boolean } = {},
): Resource[] {
  if (mode === "archive") return resources.filter(isChatArchived);
  if (options.includeArchivedInActive) return resources;
  return resources.filter((resource) => !isChatArchived(resource));
}

export function archiveChatResource(resource: Resource, at: string = new Date().toISOString()): Resource {
  if (isChatArchived(resource)) return resource;
  return {
    ...resource,
    archived_at: at,
  };
}

export function restoreChatResource(resource: Resource): Resource {
  if (!isChatArchived(resource)) return resource;
  return {
    ...resource,
    archived_at: null,
  };
}

export function archiveChatResources(resources: Resource[], at: string = new Date().toISOString()): Resource[] {
  return resources.map((resource) => archiveChatResource(resource, at));
}

export function restoreChatResources(resources: Resource[]): Resource[] {
  return resources.map((resource) => restoreChatResource(resource));
}

/**
 * 編集ドロワーのグループ候補。
 * アクティブ（非Archive）リンクが1件以上あるグループ名だけを返す。
 * 全件Archive済みのグループは選択肢に出さない（手入力での再作成は可能）。
 */
export function listActiveChatGroupNames(
  resources: Array<{
    chat_group?: string | null;
    project_id?: string | null;
    theme_id?: string | null;
    archived_at?: string | null;
  }>,
  projectId?: string | null,
): string[] {
  const names = new Set<string>();
  for (const resource of resources) {
    if (isChatArchived(resource as Resource)) continue;
    const theme = String(resource.project_id || resource.theme_id || "");
    if (String(projectId || "") !== theme) continue;
    const group = String(resource.chat_group || "").trim();
    if (group) names.add(group);
  }
  return [...names].sort((a, b) => a.localeCompare(b, "ja-JP"));
}

function textField(resource: Resource, key: string): string {
  return String((resource as unknown as Record<string, unknown>)[key] || "");
}

function datePart(value: string): string {
  const match = value.match(/^\d{4}-\d{2}-\d{2}/);
  return match?.[0] || "";
}

function hasMinuteTime(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(value);
}

function hasExplicitTimeZone(value: string): boolean {
  return /(Z|[+-]\d{2}:?\d{2})$/.test(value);
}

function localDateTimeKey(value: string): string {
  if (!hasMinuteTime(value)) return datePart(value);
  if (!hasExplicitTimeZone(value)) return `${datePart(value)}T${value.slice(11, 16)}`;

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return `${datePart(value)}T${value.slice(11, 16)}`;

  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: CHAT_DISPLAY_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);
  const part = (type: string) => parts.find((entry) => entry.type === type)?.value || "";
  return `${part("year")}-${part("month")}-${part("day")}T${part("hour")}:${part("minute")}`;
}

function localDatePart(value: string): string {
  return localDateTimeKey(value).slice(0, 10);
}

function timestampFallback(resource: Resource, capturedDate: string): string {
  for (const key of ["created_at", "updated_at"]) {
    const value = textField(resource, key);
    if (!hasMinuteTime(value)) continue;
    if (!capturedDate || localDatePart(value) === capturedDate) return value;
  }
  return "";
}

export function chatResourceDate(resource: Resource): string {
  const captured = String(resource.captured_at || "");
  if (hasMinuteTime(captured)) return localDateTimeKey(captured);
  const capturedDate = datePart(captured);
  const fallback = timestampFallback(resource, capturedDate) || captured || textField(resource, "created_at") || textField(resource, "updated_at");
  return hasMinuteTime(fallback) ? localDateTimeKey(fallback) : fallback;
}

export function formatChatResourceDate(resource: Resource): string {
  const value = chatResourceDate(resource);
  const date = datePart(value);
  if (!date) return "—";
  const formattedDate = date.replaceAll("-", "/");
  return hasMinuteTime(value) ? `${formattedDate} ${value.slice(11, 16)}` : formattedDate;
}

export function resolveSubmittedChatCapturedAt(submittedDate: string, initialValue?: string | null): string | null {
  const submitted = submittedDate.trim();
  const initial = String(initialValue || "");
  if (!submitted) return initial || null;
  if (hasMinuteTime(initial) && localDatePart(initial) === submitted) return initial;
  return submitted;
}

export function chatThreadMetaLabels({ parentTitle, childCount }: { parentTitle?: string; childCount: number }): string[] {
  const labels: string[] = [];
  const parent = String(parentTitle || "").trim();
  if (parent) labels.push(`元チャット：${parent}`);
  if (childCount > 0) labels.push(`続き${childCount}件`);
  return labels;
}

function titleValue(resource: Resource): string {
  return String(resource.title || "");
}

function manualSortOrder(resource: Resource): number | null {
  const value = Number(resource.sort_order);
  return Number.isFinite(value) && value > 0 ? value : null;
}

export function sortChatResources(resources: Resource[], order: ChatRefSortOrder): Resource[] {
  return [...resources].sort((a, b) => {
    if (order === "manual") {
      const aOrder = manualSortOrder(a);
      const bOrder = manualSortOrder(b);
      if (aOrder !== null && bOrder !== null && aOrder !== bOrder) return aOrder - bOrder;
      if (aOrder !== null && bOrder === null) return -1;
      if (aOrder === null && bOrder !== null) return 1;
      const dateFallback = chatResourceDate(b).localeCompare(chatResourceDate(a));
      if (dateFallback) return dateFallback;
      return titleValue(a).localeCompare(titleValue(b), "ja-JP");
    }
    const dateCompare = chatResourceDate(a).localeCompare(chatResourceDate(b));
    if (dateCompare) return order === "newest" ? -dateCompare : dateCompare;
    return titleValue(a).localeCompare(titleValue(b), "ja-JP");
  });
}

export function groupChatResources(
  resources: Resource[],
  orderOrOptions: ChatRefSortOrder | GroupChatResourcesOptions = "newest",
): ChatRefGroup[] {
  const options: GroupChatResourcesOptions = typeof orderOrOptions === "string"
    ? { resourceOrder: orderOrOptions, groupOrder: "name" }
    : orderOrOptions;
  const resourceOrder = options.resourceOrder || "newest";
  const groupOrder = options.groupOrder || "name";
  const activityByKey = options.groupActivityByKey || {};
  const themeId = options.themeId;

  const map = new Map<string, Resource[]>();
  for (const resource of resources) {
    const key = chatGroupKey(resource);
    const list = map.get(key);
    if (list) list.push(resource);
    else map.set(key, [resource]);
  }

  const groups: ChatRefGroup[] = [];
  for (const [key, list] of map) {
    const externalTouch = activityByKey[chatGroupActivityKey(themeId, key)];
    const activityAt = chatGroupActivityAt(list, externalTouch);
    const sorted = sortChatResources(list, resourceOrder);
    if (key === UNGROUPED_CHAT_GROUP) {
      groups.push({ key: UNGROUPED_CHAT_GROUP, label: "未分類", resources: sorted, activityAt });
    } else {
      groups.push({ key, label: key, resources: sorted, activityAt });
    }
  }

  groups.sort((a, b) => compareChatGroups(a, b, groupOrder));
  return groups;
}

/** テストや将来の明示操作向け。通常UIのクリックでは呼ばない */
export function touchChatGroupActivity(
  current: Record<string, string>,
  themeId: string | null | undefined,
  groupKey: string,
  at: string = new Date().toISOString(),
): Record<string, string> {
  if (!groupKey) return current;
  const key = chatGroupActivityKey(themeId, groupKey);
  const previous = current[key] || "";
  if (previous && previous >= at) return current;
  return { ...current, [key]: at };
}

export function reorderChatGroupResources(resources: Resource[], draggedId: string, targetId: string, placement: "before" | "after" = "before"): Resource[] {
  if (draggedId === targetId) return [];
  const fromIndex = resources.findIndex((resource) => resource.id === draggedId);
  const targetIndex = resources.findIndex((resource) => resource.id === targetId);
  if (fromIndex < 0 || targetIndex < 0) return [];

  const next = [...resources];
  const [moved] = next.splice(fromIndex, 1);
  const adjustedTargetIndex = fromIndex < targetIndex ? targetIndex - 1 : targetIndex;
  const insertIndex = placement === "after" ? adjustedTargetIndex + 1 : adjustedTargetIndex;
  next.splice(insertIndex, 0, moved);
  return next.map((resource, orderIndex) => ({
    ...resource,
    sort_order: (orderIndex + 1) * 10,
  }));
}

export function renameChatGroupResources(resources: Resource[], nextGroupName: string): Resource[] {
  const chatGroup = nextGroupName.trim();
  return resources.map((resource) => ({
    ...resource,
    chat_group: chatGroup || null,
  }));
}

export function clearChatGroupResources(resources: Resource[]): Resource[] {
  return resources.map((resource) => ({
    ...resource,
    chat_group: null,
  }));
}

/**
 * 指定グループに属するリソースを返す（Archive含む）。
 * Theme 絞り込みは呼び出し側で行い、この関数は groupKey のみで判定する。
 * 表示フィルタ（検索・採用状態）を通した部分集合ではなく、正本一覧から渡すこと。
 */
export function listResourcesInChatGroup(resources: Resource[], groupKey: string): Resource[] {
  if (!groupKey || groupKey === UNGROUPED_CHAT_GROUP) {
    return resources.filter((resource) => chatGroupKey(resource) === UNGROUPED_CHAT_GROUP);
  }
  return resources.filter((resource) => chatGroupKey(resource) === groupKey);
}

/** 同一集合内に、excludeKey 以外で nextGroupKey のメンバがあるか（統合判定用） */
export function chatGroupNameExists(
  resources: Resource[],
  nextGroupKey: string,
  excludeKey?: string,
): boolean {
  const target = String(nextGroupKey || "").trim();
  if (!target || target === UNGROUPED_CHAT_GROUP) return false;
  return resources.some((resource) => {
    const key = chatGroupKey(resource);
    if (excludeKey && key === excludeKey) return false;
    return key === target;
  });
}

export function buildChatGroupKnowledgePrompt({
  groupLabel,
  themeName,
  resources,
  basePrompt,
}: {
  groupLabel: string;
  themeName: string;
  resources: Resource[];
  basePrompt?: string;
}): string {
  const lines = resources.map((resource, index) => {
    const title = String(resource.title || `チャット${index + 1}`);
    const url = String(resource.url || "");
    const description = String(resource.description || "").replace(/\s+/g, " ").trim();
    return [
      `${index + 1}. ${title}`,
      url ? `   URL: ${url}` : "",
      description ? `   メモ: ${description}` : "",
    ].filter(Boolean).join("\n");
  });

  const task = [
    `Theme: ${themeName || "未設定"}`,
    `チャットグループ: ${groupLabel}`,
    "",
    "以下のチャットリンク群を読み、TaskenのKnowledge候補として整理してください。",
    "出力には、主張、根拠、未解決の問い、意思決定、次に確認すべきことを分けて含めてください。",
    "リンク先を参照した場合は、どのリンクに基づくか分かるようにしてください。",
    "",
    "チャットリンク:",
    ...lines,
  ].join("\n");

  return [basePrompt?.trim(), task].filter(Boolean).join("\n\n---\n\n");
}
