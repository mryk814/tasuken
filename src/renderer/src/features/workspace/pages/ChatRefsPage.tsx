import {
  IconArchive,
  IconArchiveOff,
  IconBrandGoogle,
  IconBrandOpenai,
  IconBrandWindows,
  IconChevronDown,
  IconChevronRight,
  IconCopy,
  IconExternalLink,
  IconFoldDown,
  IconFoldUp,
  IconGripVertical,
  IconLinkPlus,
  IconMessageCircleQuestion,
  IconPencil,
  IconStar,
  IconStarFilled,
  IconTrash,
} from "@tabler/icons-react";
import { useEffect, useMemo, useState, type DragEvent, type KeyboardEvent, type MouseEvent } from "react";

import { workspaceApi } from "../../../services/workspaceApi";
import { usePersistentState } from "../../../utils/usePersistentState";
import { ContextMenu, EmptyState, PageHeader, type ContextMenuItem } from "../components/common";
import { buildSaveResourceOperations } from "../domain-model/persistence";
import type { Resource } from "../domain-model/types";
import {
  archiveChatResource,
  archiveChatResources,
  chatThreadMetaLabels,
  clearChatGroupResources,
  filterChatResourcesByArchive,
  formatChatResourceDate,
  groupChatResources,
  isChatArchived,
  isChatReference,
  renameChatGroupResources,
  reorderChatGroupResources,
  restoreChatResource,
  restoreChatResources,
  UNGROUPED_CHAT_GROUP,
  type ChatGroupSortOrder,
  type ChatRefGroup,
  type ChatRefSortOrder,
} from "../lib/chatRefs";
import { CHAT_SERVICE_LABELS, resolveChatService, type ChatServiceType } from "../lib/chatServices";
import { themeColor } from "../lib/domain";
import { str } from "../lib/format";
import type { PageProps, Theme } from "../types";

type StatusFilter = "all" | "inbox" | "adopted";
type ListMode = "active" | "archive";
type DragPlacement = "before" | "after";
type DragTarget = { id: string; placement: DragPlacement } | null;

interface ChatRefsPrefs {
  /** グループ内リンクの並び */
  sortOrder: ChatRefSortOrder;
  /** グループ同士の並び */
  groupSortOrder: ChatGroupSortOrder;
  statusFilter: StatusFilter;
  /** 通常一覧 / Archive棚 */
  listMode: ListMode;
  /** 通常一覧の検索時に Archive も含める */
  includeArchivedInSearch: boolean;
}

const DEFAULT_CHAT_REFS_PREFS: ChatRefsPrefs = {
  sortOrder: "newest",
  groupSortOrder: "recent",
  statusFilter: "all",
  listMode: "active",
  includeArchivedInSearch: false,
};

function isAdopted(r: Resource): boolean {
  return str(r.reference_status) === "adopted";
}

function themeTitle(themes: Theme[], id?: string | null): string {
  return themes.find((theme) => theme.id === id)?.name || "未設定";
}

function ChatServiceIcon({ service }: { service: ChatServiceType }) {
  if (service === "chatgpt") return <IconBrandOpenai size={16} />;
  if (service === "claude") return <IconMessageCircleQuestion size={16} />;
  if (service === "gemini") return <IconBrandGoogle size={16} />;
  if (service === "copilot") return <IconBrandWindows size={16} />;
  return <IconMessageCircleQuestion size={16} />;
}

export function ChatRefsPage({
  themes,
  domain,
  activeThemeId,
  setActiveThemeId,
  openDrawer,
  saveEntities,
  setToast,
}: PageProps) {
  const chatResources = useMemo(() => domain.resources.filter(isChatReference), [domain.resources]);
  const [selectedThemeId, setSelectedThemeId] = useState(activeThemeId || themes[0]?.id || "");
  const [query, setQuery] = useState("");
  const [prefs, setPrefs] = usePersistentState<ChatRefsPrefs>("chat-refs:prefs:v1", DEFAULT_CHAT_REFS_PREFS);
  const {
    sortOrder,
    groupSortOrder,
    statusFilter,
    listMode = "active",
    includeArchivedInSearch = false,
  } = prefs;
  const updatePrefs = (patch: Partial<ChatRefsPrefs>) => setPrefs((current) => ({ ...current, ...patch }));
  const isArchiveView = listMode === "archive";
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [draggingGroupKey, setDraggingGroupKey] = useState<string | null>(null);
  const [dragTarget, setDragTarget] = useState<DragTarget>(null);
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; items: ContextMenuItem[] } | null>(null);

  useEffect(() => {
    if (!selectedThemeId && themes[0]) setSelectedThemeId(themes[0].id);
  }, [selectedThemeId, themes]);

  useEffect(() => {
    if (activeThemeId && activeThemeId !== selectedThemeId) setSelectedThemeId(activeThemeId);
  }, [activeThemeId, selectedThemeId]);

  const inboxResources = chatResources.filter((r) => !r.project_id && !isChatArchived(r));
  const archivedCount = chatResources.filter(isChatArchived).length;

  const scopedResources = chatResources.filter((r) => {
    if (selectedThemeId) return r.project_id === selectedThemeId;
    return !r.project_id;
  });

  const archiveScopedResources = useMemo(() => {
    const searching = query.trim().length > 0;
    const includeArchived = isArchiveView || (searching && includeArchivedInSearch);
    return filterChatResourcesByArchive(scopedResources, isArchiveView ? "archive" : "active", {
      includeArchivedInActive: includeArchived && !isArchiveView,
    });
  }, [scopedResources, isArchiveView, includeArchivedInSearch, query]);

  const visibleResources = archiveScopedResources.filter((r) => {
    if (statusFilter === "adopted" && !isAdopted(r)) return false;
    if (statusFilter === "inbox" && isAdopted(r)) return false;
    const haystack = `${r.title} ${r.description} ${r.url} ${r.chat_group || ""} ${themeTitle(themes, r.project_id)}`.toLowerCase();
    return haystack.includes(query.toLowerCase());
  });

  // 最近利用 = メンバの保存時刻（updated_at 優先）。クリックやリンクを開いただけでは動かさない
  const groups = useMemo(
    () => groupChatResources(visibleResources, {
      resourceOrder: sortOrder,
      groupOrder: groupSortOrder,
    }),
    [visibleResources, sortOrder, groupSortOrder],
  );
  const resourceById = useMemo(() => new Map(chatResources.map((resource) => [resource.id, resource])), [chatResources]);
  const childrenByParentId = useMemo(() => {
    const map = new Map<string, Resource[]>();
    for (const resource of chatResources) {
      const parentId = str(resource.parent_resource_id);
      if (!parentId) continue;
      map.set(parentId, [...(map.get(parentId) || []), resource]);
    }
    return map;
  }, [chatResources]);
  const allGroupKeys = useMemo(() => groups.map((g) => g.key), [groups]);
  const allCollapsed = allGroupKeys.length > 0 && allGroupKeys.every((key) => collapsed.has(key));

  function toggleGroup(key: string) {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  function toggleAllGroups() {
    if (allCollapsed) {
      setCollapsed(new Set());
    } else {
      setCollapsed(new Set(allGroupKeys));
    }
  }

  function toggleAdopted(r: Resource) {
    void saveEntities(
      buildSaveResourceOperations({ ...r, reference_status: isAdopted(r) ? "inbox" : "adopted" }),
      isAdopted(r) ? "採用を解除しました。" : "採用にしました。",
    );
  }

  function selectTheme(themeId: string) {
    setSelectedThemeId(themeId);
    setActiveThemeId(themeId);
  }

  function copyGroupUrls(groupResources: Resource[]) {
    workspaceApi.copyText(groupResources.map((r) => r.url || "").join("\n")).then(() => setToast(`${groupResources.length}件のURLをコピーしました。`));
  }

  function saveGroupResources(resources: Resource[], message: string) {
    void saveEntities(resources.flatMap((resource) => buildSaveResourceOperations(resource)), message);
  }

  function renameGroup(group: ChatRefGroup) {
    if (group.key === UNGROUPED_CHAT_GROUP) {
      setToast("未分類グループは名前を変更できません。");
      return;
    }
    const nextName = window.prompt("新しいグループ名", group.label)?.trim();
    if (!nextName || nextName === group.label) return;
    const targetExists = groups.some((candidate) => candidate.key !== group.key && candidate.key === nextName);
    if (targetExists && !window.confirm(`「${nextName}」に統合します。リンクは削除されません。続けますか？`)) return;
    saveGroupResources(
      renameChatGroupResources(group.resources, nextName),
      targetExists ? "グループを統合しました。" : "グループ名を変更しました。",
    );
    setCollapsed((prev) => {
      const next = new Set(prev);
      next.delete(group.key);
      return next;
    });
  }

  function clearGroup(group: ChatRefGroup) {
    if (group.key === UNGROUPED_CHAT_GROUP) {
      setToast("未分類グループは解除できません。");
      return;
    }
    if (!window.confirm(`「${group.label}」のグループだけ解除し、${group.resources.length}件のリンクは未分類へ移します。続けますか？`)) return;
    saveGroupResources(
      clearChatGroupResources(group.resources),
      "グループを解除し、リンクを未分類へ移しました。",
    );
    setCollapsed((prev) => {
      const next = new Set(prev);
      next.delete(group.key);
      return next;
    });
  }

  function moveChatLink(group: ChatRefGroup, draggedId: string, targetId: string, placement: DragPlacement) {
    const reordered = reorderChatGroupResources(group.resources, draggedId, targetId, placement);
    if (!reordered.length) return;
    saveGroupResources(reordered, "並び替えを保存しました。");
  }

  function archiveChatLink(resource: Resource) {
    if (isChatArchived(resource)) return;
    void saveEntities(
      buildSaveResourceOperations(archiveChatResource(resource)),
      "Archiveしました。通常一覧からは隠れます。",
    );
  }

  function restoreChatLink(resource: Resource) {
    if (!isChatArchived(resource)) return;
    void saveEntities(
      buildSaveResourceOperations(restoreChatResource(resource)),
      "Archiveを解除し、元のグループへ戻しました。",
    );
  }

  function archiveGroup(group: ChatRefGroup) {
    const targets = group.resources.filter((resource) => !isChatArchived(resource));
    if (!targets.length) return;
    if (!window.confirm(`「${group.label}」の${targets.length}件をArchiveします。削除ではなく保管です。続けますか？`)) return;
    saveGroupResources(
      archiveChatResources(targets),
      `「${group.label}」をArchiveしました。`,
    );
  }

  function restoreGroup(group: ChatRefGroup) {
    const targets = group.resources.filter(isChatArchived);
    if (!targets.length) return;
    if (!window.confirm(`「${group.label}」の${targets.length}件を元のグループへ戻します。続けますか？`)) return;
    saveGroupResources(
      restoreChatResources(targets),
      `「${group.label}」のArchiveを解除しました。`,
    );
  }

  function clearDragState() {
    setDraggingId(null);
    setDraggingGroupKey(null);
    setDragTarget(null);
  }

  function showChatLinkMenu(event: MouseEvent, resource: Resource) {
    event.preventDefault();
    const url = str(resource.url);
    const archived = isChatArchived(resource);
    const items: ContextMenuItem[] = [
      { label: "編集する", onSelect: () => openChatResource(resource) },
      { label: isAdopted(resource) ? "採用を解除" : "採用にする", onSelect: () => toggleAdopted(resource) },
      { label: "タイトルをコピー", onSelect: () => workspaceApi.copyText(str(resource.title)) },
    ];
    if (url) {
      items.push(
        { label: "リンクを開く", onSelect: () => openChatUrl(resource) },
        { label: "URLをコピー", onSelect: () => workspaceApi.copyText(url) },
      );
    }
    items.push(
      archived
        ? { label: "Archiveを解除", onSelect: () => restoreChatLink(resource) }
        : { label: "Archiveする", onSelect: () => archiveChatLink(resource) },
    );
    // 削除はドロワーの Danger Zone のみ（一覧アイコン・メニューからは出さない）
    setContextMenu({ x: event.clientX, y: event.clientY, items });
  }

  function openChatResource(resource: Resource) {
    openDrawer({ type: "resource", mode: "edit", entity: resource as unknown as Record<string, unknown> });
  }

  function openChatUrl(resource: Resource) {
    const url = str(resource.url);
    if (url) window.open(url, "_blank", "noreferrer");
  }

  function stopRowClick(event: MouseEvent<HTMLElement>) {
    event.stopPropagation();
  }

  function openRowFromKeyboard(event: KeyboardEvent<HTMLElement>, resource: Resource) {
    if (event.key !== "Enter" && event.key !== " ") return;
    event.preventDefault();
    openChatResource(resource);
  }

  function dragPlacement(event: DragEvent<HTMLElement>): DragPlacement {
    const rect = event.currentTarget.getBoundingClientRect();
    return event.clientY > rect.top + rect.height / 2 ? "after" : "before";
  }

  function copyList() {
    const header = "タイトル\tグループ\tTheme\t採用\tURL\t要約";
    const rows = visibleResources.map((r) => [
      str(r.title),
      str(r.chat_group),
      themeTitle(themes, r.project_id),
      isAdopted(r) ? "★" : "",
      str(r.url),
      str(r.description).replace(/\s+/g, " "),
    ].join("\t"));
    workspaceApi.copyText([header, ...rows].join("\n")).then(() => setToast("チャット参照一覧をコピーしました。"));
  }

  function copyUrls() {
    workspaceApi.copyText(visibleResources.map((r) => r.url || "").join("\n")).then(() => setToast("チャットURLをコピーしました。"));
  }

  function addChatLink(chatGroup = "") {
    const activeSiblings = scopedResources.filter((resource) => !isChatArchived(resource));
    const nextSortOrder = Math.max(
      0,
      ...activeSiblings
        .filter((resource) => str(resource.chat_group).trim() === chatGroup.trim())
        .map((resource) => Number(resource.sort_order) || 0),
    ) + 10;
    openDrawer({
      type: "resource",
      mode: "edit",
      entity: {
        reference_status: "inbox",
        project_id: selectedThemeId || null,
        chat_group: chatGroup,
        importance: "normal",
        captured_at: new Date().toISOString(),
        sort_order: nextSortOrder,
      },
    });
  }

  function addContinuation(parent: Resource) {
    const activeSiblings = scopedResources.filter((resource) => !isChatArchived(resource));
    const nextSortOrder = Math.max(
      0,
      ...activeSiblings
        .filter((resource) => str(resource.chat_group).trim() === str(parent.chat_group).trim())
        .map((resource) => Number(resource.sort_order) || 0),
    ) + 10;
    openDrawer({
      type: "resource",
      mode: "edit",
      entity: {
        reference_status: "inbox",
        project_id: parent.project_id || selectedThemeId || null,
        chat_group: parent.chat_group || "",
        parent_resource_id: parent.id,
        importance: "normal",
        captured_at: new Date().toISOString(),
        sort_order: nextSortOrder,
      },
    });
  }

  return (
    <div className="page chat-refs-page">
      <PageHeader
        title="チャット参照"
        subtitle={isArchiveView
          ? "Archiveしたチャットリンクを確認し、必要なら元のグループへ戻します。"
          : "外部AIチャットをTheme単位で保管し、あとからNoteやKnowledgeに展開します。"}
      >
        <button className="secondary-button" onClick={copyUrls} disabled={!visibleResources.length}><IconCopy size={16} />URLをコピー</button>
        <button className="secondary-button" onClick={copyList} disabled={!visibleResources.length}><IconCopy size={16} />一覧をコピー</button>
        {!isArchiveView && (
          <button className="primary-button" onClick={() => addChatLink()}><IconLinkPlus size={16} />追加</button>
        )}
      </PageHeader>

      <section className="chat-ref-toolbar panel">
        <div className="segmented" aria-label="チャット参照の表示">
          <button
            type="button"
            className={!isArchiveView ? "is-active" : ""}
            onClick={() => updatePrefs({ listMode: "active" })}
          >
            通常
          </button>
          <button
            type="button"
            className={isArchiveView ? "is-active" : ""}
            onClick={() => updatePrefs({ listMode: "archive" })}
          >
            Archive
            {archivedCount > 0 ? ` ${archivedCount}` : ""}
          </button>
        </div>
        <div>
          <span>未整理</span>
          <strong className="metric-value">{inboxResources.length}</strong>
        </div>
        <div>
          <span>表示中</span>
          <strong className="metric-value">{visibleResources.length}</strong>
        </div>
        <input data-search value={query} onChange={(event) => setQuery(event.target.value)} placeholder="タイトル、グループ、URLを検索" />
        {!isArchiveView && query.trim() && (
          <label className="chat-ref-search-option">
            <input
              type="checkbox"
              checked={includeArchivedInSearch}
              onChange={(event) => updatePrefs({ includeArchivedInSearch: event.target.checked })}
            />
            Archiveも含める
          </label>
        )}
        <select
          value={statusFilter}
          onChange={(event) => updatePrefs({ statusFilter: event.target.value as StatusFilter })}
          aria-label="参照状態で絞り込み"
        >
          <option value="all">すべて</option>
          <option value="adopted">採用のみ</option>
          <option value="inbox">未整理のみ</option>
        </select>
        <select
          value={groupSortOrder}
          onChange={(event) => updatePrefs({ groupSortOrder: event.target.value as ChatGroupSortOrder })}
          aria-label="グループの並び順"
        >
          <option value="recent">グループ：最近利用順</option>
          <option value="name">グループ：名前順</option>
        </select>
        <select
          value={sortOrder}
          onChange={(event) => updatePrefs({ sortOrder: event.target.value as ChatRefSortOrder })}
          aria-label="リンクの並び順"
        >
          <option value="newest">リンク：新しい順</option>
          <option value="oldest">リンク：古い順</option>
          <option value="manual">リンク：任意順</option>
        </select>
        {groups.length > 1 && (
          <button
            className="secondary-button compact icon-only"
            onClick={toggleAllGroups}
            aria-label={allCollapsed ? "すべて展開" : "すべて折りたたむ"}
            title={allCollapsed ? "すべて展開" : "すべて折りたたむ"}
          >
            {allCollapsed ? <IconFoldDown size={16} /> : <IconFoldUp size={16} />}
          </button>
        )}
      </section>

      <section className="chat-ref-board">
        <div className="panel chat-ref-column theme-column">
          <div className="section-heading">
            <h2>Theme</h2>
            <span>{themes.length}件</span>
          </div>
          <div className="chat-theme-list">
            {themes.map((theme, index) => {
              const count = chatResources.filter((r) => {
                if (r.project_id !== theme.id) return false;
                return isArchiveView ? isChatArchived(r) : !isChatArchived(r);
              }).length;
              return (
                <button
                  key={theme.id}
                  className={selectedThemeId === theme.id ? "is-active" : ""}
                  style={{ "--chip-color": `var(--color-${themeColor(theme, index)})` } as React.CSSProperties}
                  onClick={() => selectTheme(theme.id)}
                >
                  <span className="chip-dot" />
                  <strong>{theme.name}</strong>
                  <span className="count">{count}</span>
                </button>
              );
            })}
            {!themes.length && <EmptyState title="Themeがありません" action="Themeを追加" onAction={() => openDrawer({ type: "theme", mode: "edit", entity: {} })} />}
          </div>
        </div>

        <div className="panel chat-ref-column link-column">
          <div className="section-heading">
            <h2>{isArchiveView ? "Archive" : "チャットリンク"}</h2>
            <span>{visibleResources.length}件</span>
          </div>
          <div className="chat-link-list">
            {groups.map((group) => (
              <div className="chat-link-group" key={group.key}>
                <div className="chat-group-header">
                  <button className="chat-group-toggle" onClick={() => toggleGroup(group.key)}>
                    {collapsed.has(group.key) ? <IconChevronRight size={16} /> : <IconChevronDown size={16} />}
                    <strong>{isArchiveView && group.key !== UNGROUPED_CHAT_GROUP ? `元グループ: ${group.label}` : group.label}</strong>
                    <span className="count">{group.resources.length}</span>
                  </button>
                  {!isArchiveView && (
                    <>
                      <button
                        className="chat-group-add"
                        onClick={() => addChatLink(group.key === UNGROUPED_CHAT_GROUP ? "" : group.key)}
                        aria-label={`${group.label}にチャットリンクを追加`}
                        title="このグループに追加"
                      >
                        <IconLinkPlus size={14} />
                      </button>
                      <button
                        className="chat-group-copy"
                        onClick={() => copyGroupUrls(group.resources)}
                        aria-label={`${group.label}のURLをコピー`}
                        title="URLをコピー"
                      >
                        <IconCopy size={14} />
                      </button>
                      <button
                        className="chat-group-archive"
                        onClick={() => archiveGroup(group)}
                        aria-label={`${group.label}をまとめてArchive`}
                        title="グループをArchive（削除ではなく保管）"
                      >
                        <IconArchive size={14} />
                      </button>
                      {group.key !== UNGROUPED_CHAT_GROUP && (
                        <>
                          <button
                            className="chat-group-edit"
                            onClick={() => renameGroup(group)}
                            aria-label={`${group.label}のグループ名を変更`}
                            title="グループ名を変更"
                          >
                            <IconPencil size={14} />
                          </button>
                          <button
                            className="chat-group-clear"
                            onClick={() => clearGroup(group)}
                            aria-label={`${group.label}のグループを解除`}
                            title="グループ解除（リンクは残る）"
                          >
                            <IconTrash size={14} />
                          </button>
                        </>
                      )}
                    </>
                  )}
                  {isArchiveView && (
                    <>
                      <button
                        className="chat-group-copy"
                        onClick={() => copyGroupUrls(group.resources)}
                        aria-label={`${group.label}のURLをコピー`}
                        title="URLをコピー"
                      >
                        <IconCopy size={14} />
                      </button>
                      <button
                        className="chat-group-restore"
                        onClick={() => restoreGroup(group)}
                        aria-label={`${group.label}のArchiveをまとめて解除`}
                        title="グループのArchiveを解除"
                      >
                        <IconArchiveOff size={14} />
                      </button>
                    </>
                  )}
                </div>
                {!collapsed.has(group.key) && group.resources.map((r) => {
                  const service = resolveChatService(r);
                  const archived = isChatArchived(r);
                  const canDrag = !isArchiveView && !archived && sortOrder === "manual" && group.resources.length > 1;
                  const isSameDragGroup = draggingGroupKey === null || draggingGroupKey === group.key;
                  const activeDropTarget = dragTarget?.id === r.id && draggingId !== r.id;
                  const parent = resourceById.get(str(r.parent_resource_id));
                  const childCount = childrenByParentId.get(r.id)?.length || 0;
                  const threadLabels = chatThreadMetaLabels({ parentTitle: parent ? str(parent.title || parent.url) : "", childCount });
                  return (
                    <div
                      className={`chat-link-row ${draggingId === r.id ? "is-dragging" : ""} ${activeDropTarget ? `is-drop-${dragTarget.placement}` : ""} ${archived ? "is-archived" : ""}`}
                      key={r.id}
                      role="button"
                      tabIndex={0}
                      onClick={() => openChatResource(r)}
                      onContextMenu={(event) => showChatLinkMenu(event, r)}
                      onKeyDown={(event) => openRowFromKeyboard(event, r)}
                      onDragOver={canDrag && isSameDragGroup ? (event) => {
                        event.preventDefault();
                        event.dataTransfer.dropEffect = "move";
                        const placement = dragPlacement(event);
                        setDragTarget((current) => (
                          current?.id === r.id && current.placement === placement ? current : { id: r.id, placement }
                        ));
                      } : undefined}
                      onDragLeave={canDrag ? () => setDragTarget((current) => current?.id === r.id ? null : current) : undefined}
                      onDrop={canDrag && isSameDragGroup ? (event) => {
                        event.preventDefault();
                        const draggedId = event.dataTransfer.getData("application/x-tasken-chat-ref") || draggingId;
                        const placement = dragPlacement(event);
                        if (draggedId) moveChatLink(group, draggedId, r.id, placement);
                        clearDragState();
                      } : undefined}
                    >
                      {sortOrder === "manual" && !isArchiveView && (
                        <span
                          className={`chat-row-drag-handle ${canDrag ? "" : "is-disabled"}`}
                          draggable={canDrag}
                          onClick={stopRowClick}
                          onDragStart={(event) => {
                            if (!canDrag) return;
                            event.dataTransfer.effectAllowed = "move";
                            event.dataTransfer.setData("application/x-tasken-chat-ref", r.id);
                            setDraggingId(r.id);
                            setDraggingGroupKey(group.key);
                            setDragTarget(null);
                          }}
                          onDragEnd={clearDragState}
                          aria-label={`${r.title || "チャットリンク"}をドラッグして並び替え`}
                          title={canDrag ? "ドラッグして並び替え" : "並び替え対象が1件だけです"}
                        >
                          <IconGripVertical size={16} />
                        </span>
                      )}
                      <button
                        className={`chat-star ${isAdopted(r) ? "is-adopted" : ""}`}
                        onClick={(event) => {
                          event.stopPropagation();
                          toggleAdopted(r);
                        }}
                        aria-label={isAdopted(r) ? "採用を解除" : "採用にする"}
                      >
                        {isAdopted(r) ? <IconStarFilled size={16} /> : <IconStar size={16} />}
                      </button>
                      <span className={`chat-service-chip chat-service-${service}`} title={CHAT_SERVICE_LABELS[service]} aria-label={CHAT_SERVICE_LABELS[service]}>
                        <ChatServiceIcon service={service} />
                      </span>
                      <span className="chat-link-title">
                        {r.title || "無題"}
                        {archived && <small className="chat-thread-meta">Archive</small>}
                        {threadLabels.length > 0 && <small className="chat-thread-meta">{threadLabels.join(" / ")}</small>}
                      </span>
                      {parent && (
                        <button
                          className="row-action-button"
                          onClick={(event) => {
                            event.stopPropagation();
                            openChatResource(parent);
                          }}
                          aria-label={`${r.title || "チャットリンク"}の元チャットを開く`}
                          title="元チャットを開く"
                        >
                          <IconChevronRight size={15} />
                        </button>
                      )}
                      {!archived && (
                        <button
                          className="row-action-button"
                          onClick={(event) => {
                            event.stopPropagation();
                            addContinuation(r);
                          }}
                          aria-label={`${r.title || "チャットリンク"}の続きチャットを追加`}
                          title="続きとして追加"
                        >
                          <IconLinkPlus size={15} />
                        </button>
                      )}
                      <a
                        className="row-action-button chat-link-open"
                        href={r.url || ""}
                        target="_blank"
                        rel="noreferrer"
                        onClick={stopRowClick}
                        aria-label={`${r.title || "リンク"}を開く`}
                        title="開く"
                      >
                        <IconExternalLink size={16} />
                      </a>
                      {archived ? (
                        <button
                          className="row-action-button chat-link-restore"
                          onClick={(event) => {
                            event.stopPropagation();
                            restoreChatLink(r);
                          }}
                          aria-label={`${r.title || "チャットリンク"}のArchiveを解除`}
                          title="Archiveを解除"
                        >
                          <IconArchiveOff size={15} />
                        </button>
                      ) : (
                        <button
                          className="row-action-button chat-link-archive"
                          onClick={(event) => {
                            event.stopPropagation();
                            archiveChatLink(r);
                          }}
                          aria-label={`${r.title || "チャットリンク"}をArchive`}
                          title="Archive（削除ではなく保管）"
                        >
                          <IconArchive size={15} />
                        </button>
                      )}
                      <span className="chat-link-date">{formatChatResourceDate(r)}</span>
                    </div>
                  );
                })}
              </div>
            ))}
            {!visibleResources.length && (
              isArchiveView
                ? <EmptyState title="Archiveはまだありません" />
                : <EmptyState title="チャット参照がありません" action="チャットリンクを追加" onAction={() => addChatLink()} />
            )}
          </div>
        </div>
      </section>

      {!isArchiveView && inboxResources.length > 0 && (
        <section className="panel chat-inbox-strip">
          <div className="section-heading">
            <h2>未整理チャット</h2>
            <span>{inboxResources.length}件</span>
          </div>
          <div>
            {inboxResources.slice(0, 6).map((r) => (
              <button key={r.id} onClick={() => openDrawer({ type: "resource", mode: "edit", entity: r as unknown as Record<string, unknown> })}>
                <strong>{r.title}</strong>
                <span>{themeTitle(themes, r.project_id)}</span>
              </button>
            ))}
          </div>
        </section>
      )}
      {contextMenu && <ContextMenu x={contextMenu.x} y={contextMenu.y} items={contextMenu.items} onClose={() => setContextMenu(null)} />}
    </div>
  );
}
