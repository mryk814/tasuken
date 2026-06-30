import type { Resource } from "../domain-model/types";

export const UNGROUPED_CHAT_GROUP = "__ungrouped__";

export type ChatRefSortOrder = "manual" | "newest" | "oldest";
export type ChatRefGroup = { key: string; label: string; resources: Resource[] };

export function chatResourceDate(resource: Resource): string {
  return String(resource.captured_at || (resource as unknown as Record<string, unknown>).created_at || (resource as unknown as Record<string, unknown>).updated_at || "");
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

export function groupChatResources(resources: Resource[], order: ChatRefSortOrder): ChatRefGroup[] {
  const map = new Map<string, Resource[]>();
  for (const resource of resources) {
    const key = String(resource.chat_group || "").trim() || UNGROUPED_CHAT_GROUP;
    const list = map.get(key);
    if (list) list.push(resource);
    else map.set(key, [resource]);
  }

  const groups: ChatRefGroup[] = [];
  for (const [key, list] of map) {
    if (key !== UNGROUPED_CHAT_GROUP) {
      groups.push({ key, label: key, resources: sortChatResources(list, order) });
    }
  }
  groups.sort((a, b) => a.label.localeCompare(b.label, "ja-JP"));

  const ungrouped = map.get(UNGROUPED_CHAT_GROUP);
  if (ungrouped) {
    groups.push({ key: UNGROUPED_CHAT_GROUP, label: "未分類", resources: sortChatResources(ungrouped, order) });
  }
  return groups;
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
