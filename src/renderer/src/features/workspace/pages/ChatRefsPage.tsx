import {
  IconArchive,
  IconArchiveOff,
  IconBrandGoogle,
  IconBrandOpenai,
  IconBrandWindows,
  IconCheck,
  IconChevronDown,
  IconChevronRight,
  IconCopy,
  IconArrowUpLeft,
  IconFileImport,
  IconFoldDown,
  IconFoldUp,
  IconGripVertical,
  IconLinkPlus,
  IconMessage,
  IconMessageCircleQuestion,
  IconPencil,
  IconStar,
  IconStarFilled,
  IconTrash,
  IconX,
} from "@tabler/icons-react";
import { useEffect, useMemo, useRef, useState, type DragEvent, type FormEvent, type KeyboardEvent, type MouseEvent } from "react";

import { workspaceApi } from "../../../services/workspaceApi";
import { applyOptimisticSortOrders, clearOptimisticSortOrders } from "../../../../../shared/viewOrdering.mjs";
import { canonicalThemeId, PERSONAL_DEFAULT_THEME_ID, themePickerOptions } from "../../../../../shared/themeRef.mjs";
import { usePreference } from "../../../utils/usePreference";
import { Button, ContextMenu, EmptyState, PageHeader, type ContextMenuItem } from "../components/common";
import { ToolbarMenu } from "../components/ToolbarMenu";
import { ConversationImportDialog } from "../components/ConversationImportDialog";
import { isConversationMarkdown } from "../lib/conversationParser";
import { buildSaveResourceOperations } from "../domain-model/persistence";
import type { Resource } from "../domain-model/types";
import {
  archiveChatResource,
  archiveChatResources,
  chatGroupCollapsePreferenceKey,
  chatGroupNameExists,
  chatThreadVisualDepth,
  chatThreadMetaLabels,
  clearChatGroupResources,
  filterChatResourcesByArchive,
  formatChatResourceDate,
  groupChatResources,
  isChatArchived,
  isChatReference,
  listResourcesInChatGroup,
  moveCollapsedChatGroupPreference,
  renameChatGroupResources,
  reorderChatGroupResources,
  sortChatResources,
  restoreChatResource,
  restoreChatResources,
  UNGROUPED_CHAT_GROUP,
  updateCollapsedChatGroupPreferences,
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
type OptimisticSortOrder = { token: string; value: number };

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
  openContentViewer,
  saveEntities,
  setToast,
}: PageProps) {
  const [optimisticSortOrders, setOptimisticSortOrders] = useState<Record<string, OptimisticSortOrder>>({});
  const optimisticSortOrdersRef = useRef(optimisticSortOrders);
  optimisticSortOrdersRef.current = optimisticSortOrders;
  const reorderQueueRef = useRef(Promise.resolve());
  const chatResources = useMemo(() => applyOptimisticSortOrders(
    domain.resources.filter(isChatReference),
    optimisticSortOrders,
  ), [domain.resources, optimisticSortOrders]);
  const latestChatResourcesRef = useRef(chatResources);
  latestChatResourcesRef.current = chatResources;
  const [selectedThemeId, setSelectedThemeId] = useState(activeThemeId || PERSONAL_DEFAULT_THEME_ID);
  const [query, setQuery] = useState("");
  const [prefs, setPrefs] = usePreference("chatRefs.preferences");
  const {
    sortOrder,
    groupSortOrder,
    statusFilter,
    listMode = "active",
    includeArchivedInSearch = false,
  } = prefs;
  const updatePrefs = (patch: Partial<ChatRefsPrefs>) => setPrefs((current) => ({ ...current, ...patch }));
  const isArchiveView = listMode === "archive";
  const [collapsedPreferences, setCollapsedPreferences] = usePreference("chatRefs.collapsedGroups");
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [draggingGroupKey, setDraggingGroupKey] = useState<string | null>(null);
  const [dragTarget, setDragTarget] = useState<DragTarget>(null);
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; items: ContextMenuItem[] } | null>(null);
  /** Electron では window.prompt が使えないため、グループ名変更はインライン編集にする */
  const [renamingGroupKey, setRenamingGroupKey] = useState<string | null>(null);
  const [renameDraft, setRenameDraft] = useState("");
  const [importDialogOpen, setImportDialogOpen] = useState(false);

  useEffect(() => {
    if (!selectedThemeId) setSelectedThemeId(PERSONAL_DEFAULT_THEME_ID);
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
  const collapsePreferenceKey = (groupKey: string, mode: ListMode = listMode) => (
    chatGroupCollapsePreferenceKey(selectedThemeId || null, mode, groupKey)
  );
  const collapsed = useMemo(
    () => new Set(groups
      .filter((group) => collapsedPreferences.includes(
        chatGroupCollapsePreferenceKey(selectedThemeId || null, listMode, group.key),
      ))
      .map((group) => group.key)),
    [collapsedPreferences, groups, listMode, selectedThemeId],
  );
  const allCollapsed = allGroupKeys.length > 0 && allGroupKeys.every((key) => collapsed.has(key));

  function toggleGroup(key: string) {
    const preferenceKey = collapsePreferenceKey(key);
    setCollapsedPreferences((current) => updateCollapsedChatGroupPreferences(
      current,
      [preferenceKey],
      !current.includes(preferenceKey),
    ));
  }

  function toggleAllGroups() {
    setCollapsedPreferences((current) => updateCollapsedChatGroupPreferences(
      current,
      allGroupKeys.map((key) => collapsePreferenceKey(key)),
      !allCollapsed,
    ));
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

  /** 表示フィルタを通さない Theme 内の正本メンバ（Archive 含む） */
  function themeGroupResources(groupKey: string): Resource[] {
    return listResourcesInChatGroup(scopedResources, groupKey);
  }

  function startRenameGroup(group: ChatRefGroup) {
    if (group.key === UNGROUPED_CHAT_GROUP) {
      setToast("未分類グループは名前を変更できません。", "warning");
      return;
    }
    setRenamingGroupKey(group.key);
    setRenameDraft(group.label);
  }

  function cancelRenameGroup() {
    setRenamingGroupKey(null);
    setRenameDraft("");
  }

  function commitRenameGroup(group: ChatRefGroup) {
    if (group.key === UNGROUPED_CHAT_GROUP) {
      setToast("未分類グループは名前を変更できません。", "warning");
      cancelRenameGroup();
      return;
    }
    const nextName = renameDraft.trim();
    if (!nextName) {
      setToast("グループ名を入力してください。", "warning");
      return;
    }
    if (nextName === group.label) {
      cancelRenameGroup();
      return;
    }
    // 検索・採用フィルタや Archive 状態に隠れたメンバも含め、Theme 内の該当グループを一括更新する
    const targets = themeGroupResources(group.key);
    if (!targets.length) {
      cancelRenameGroup();
      return;
    }
    const targetExists = chatGroupNameExists(scopedResources, nextName, group.key);
    if (targetExists && !window.confirm(`「${nextName}」に統合します。リンクは削除されません。続けますか？`)) return;
    saveGroupResources(
      renameChatGroupResources(targets, nextName),
      targetExists ? "グループを統合しました。" : "グループ名を変更しました。",
    );
    setCollapsedPreferences((current) => moveCollapsedChatGroupPreference(
      current,
      collapsePreferenceKey(group.key),
      collapsePreferenceKey(nextName),
    ));
    cancelRenameGroup();
  }

  function onRenameGroupSubmit(event: FormEvent, group: ChatRefGroup) {
    event.preventDefault();
    commitRenameGroup(group);
  }

  function clearGroup(group: ChatRefGroup) {
    if (group.key === UNGROUPED_CHAT_GROUP) {
      setToast("未分類グループは解除できません。", "warning");
      return;
    }
    const targets = themeGroupResources(group.key);
    if (!targets.length) return;
    if (!window.confirm(`「${group.label}」のグループだけ解除し、${targets.length}件のリンクは未分類へ移します。続けますか？`)) return;
    saveGroupResources(
      clearChatGroupResources(targets),
      "グループを解除し、リンクを未分類へ移しました。",
    );
    setCollapsedPreferences((current) => updateCollapsedChatGroupPreferences(
      current,
      [
        collapsePreferenceKey(group.key, "active"),
        collapsePreferenceKey(group.key, "archive"),
      ],
      false,
    ));
    if (renamingGroupKey === group.key) cancelRenameGroup();
  }

  function moveChatLink(group: ChatRefGroup, draggedId: string, targetId: string, placement: DragPlacement) {
    const token = crypto.randomUUID();
    const operation = reorderQueueRef.current.then(async () => {
      // 手動順の正本全体を渡し、検索・Archive・採用フィルタで隠れた同一Groupの順序を保つ。
      // overlayはsort_orderだけなので、保存中に届いたtitle/state等の更新を隠さない。
      const latestScoped = latestChatResourcesRef.current.filter((resource) => {
        const sameTheme = selectedThemeId ? resource.project_id === selectedThemeId : !resource.project_id;
        const key = String(resource.chat_group || "").trim() || UNGROUPED_CHAT_GROUP;
        return sameTheme && key === group.key;
      });
      const fullGroup = sortChatResources(latestScoped, "manual");
      const reordered = reorderChatGroupResources(fullGroup, draggedId, targetId, placement, group.resources.map((resource) => resource.id));
      if (!reordered.length) return;
      optimisticSortOrdersRef.current = {
        ...optimisticSortOrdersRef.current,
        ...Object.fromEntries(reordered.map((resource) => [resource.id, { token, value: Number(resource.sort_order) || 0 }])),
      };
      setOptimisticSortOrders(optimisticSortOrdersRef.current);
      try {
        await saveEntities(reordered.flatMap((resource) => buildSaveResourceOperations(resource)), "並び替えを保存しました。");
        optimisticSortOrdersRef.current = clearOptimisticSortOrders(optimisticSortOrdersRef.current, token);
        setOptimisticSortOrders(optimisticSortOrdersRef.current);
      } catch {
        // saveEntitiesが原因と復旧操作をtoastへ出す。ここでは自分のtokenだけを解除する。
        optimisticSortOrdersRef.current = clearOptimisticSortOrders(optimisticSortOrdersRef.current, token);
        setOptimisticSortOrders(optimisticSortOrdersRef.current);
      }
    });
    reorderQueueRef.current = operation.catch(() => {});
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
    const targets = themeGroupResources(group.key).filter((resource) => !isChatArchived(resource));
    if (!targets.length) return;
    if (!window.confirm(`「${group.label}」の${targets.length}件をArchiveします。削除ではなく保管です。続けますか？`)) return;
    saveGroupResources(
      archiveChatResources(targets),
      `「${group.label}」をArchiveしました。`,
    );
  }

  function restoreGroup(group: ChatRefGroup) {
    const targets = themeGroupResources(group.key).filter(isChatArchived);
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
        project_id: canonicalThemeId(selectedThemeId, { defaultPersonal: true }),
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
        project_id: canonicalThemeId(parent.project_id || selectedThemeId, { defaultPersonal: true }),
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
        route="chat-refs"
        info={isArchiveView ? "Archiveしたチャットリンクを確認し、必要なら元のグループへ戻します。" : undefined}
      >
        {/*
          主操作は会話へ戻る・ログを読む・必要な部分を再利用すること（#322）。
          URL・一覧のまとめコピーは低頻度なのでmenuへ畳む。
          会話の再利用はConversation側のmessage / turn / codeコピー（#305）が実用。
        */}
        <ToolbarMenu
          label="コピー"
          title="一覧のまとめコピー"
          items={[
            { id: "copy-urls", label: "表示中のURLをまとめてコピー", disabled: !visibleResources.length, onSelect: copyUrls },
            { id: "copy-list", label: "表示中の一覧をコピー", disabled: !visibleResources.length, onSelect: copyList },
          ]}
        />
        {!isArchiveView && (
          <>
            <Button variant="secondary" onClick={() => setImportDialogOpen(true)}><IconFileImport size={16} />会話ログを取り込む</Button>
            <Button variant="primary" onClick={() => addChatLink()}><IconLinkPlus size={16} />追加</Button>
          </>
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
            className="icon-only"
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
            {themePickerOptions(themes, { allowPersonal: true, allowNone: false }).map((option, index) => {
              const theme = themes.find((entry) => entry.id === option.value);
              const count = chatResources.filter((r) => {
                if (r.project_id !== option.value) return false;
                return isArchiveView ? isChatArchived(r) : !isChatArchived(r);
              }).length;
              return (
                <button
                  key={`${option.kind}-${option.value}`}
                  className={selectedThemeId === option.value ? "is-active" : ""}
                  style={theme ? { "--chip-color": `var(--color-${themeColor(theme, index)})` } as React.CSSProperties : undefined}
                  onClick={() => selectTheme(option.value)}
                >
                  {theme && <span className="chip-dot" />}
                  <strong>{option.label}</strong>
                  <span className="count">{count}</span>
                </button>
              );
            })}
            {!themes.length && <EmptyState title="Themeがありません" action="Themeを追加" onAction={() => openDrawer({ type: "theme", mode: "edit", entity: {} })} />}
          </div>
        </div>

        <div className="panel chat-ref-column link-column">
          <div className="section-heading">
            <h2>{isArchiveView ? "Archive" : "会話"}</h2>
            <span>{visibleResources.length}件</span>
          </div>
          <div className="chat-link-list">
            {groups.map((group) => (
              <div className="chat-link-group" key={group.key}>
                <div className="chat-group-header">
                  {renamingGroupKey === group.key ? (
                    <form className="chat-group-rename" onSubmit={(event) => onRenameGroupSubmit(event, group)}>
                      <input
                        className="chat-group-rename-input"
                        autoFocus
                        value={renameDraft}
                        onChange={(event) => setRenameDraft(event.target.value)}
                        onKeyDown={(event) => {
                          if (event.key === "Escape") {
                            event.preventDefault();
                            cancelRenameGroup();
                          }
                        }}
                        aria-label={`${group.label}の新しいグループ名`}
                        placeholder="グループ名"
                      />
                      <button
                        type="submit"
                        className="chat-group-rename-save"
                        aria-label="グループ名を保存"
                        title="保存"
                      >
                        <IconCheck size={14} />
                      </button>
                      <button
                        type="button"
                        className="chat-group-rename-cancel"
                        onClick={cancelRenameGroup}
                        aria-label="グループ名変更をキャンセル"
                        title="キャンセル"
                      >
                        <IconX size={14} />
                      </button>
                    </form>
                  ) : (
                    <>
                      <button
                        className="chat-group-toggle"
                        aria-expanded={!collapsed.has(group.key)}
                        onClick={() => toggleGroup(group.key)}
                      >
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
                                onClick={() => startRenameGroup(group)}
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
                  const threadDepth = chatThreadVisualDepth(r, group.resources);
                  const threadLabels = chatThreadMetaLabels({ parentTitle: parent ? str(parent.title || parent.url) : "", childCount });
                  const chatDate = formatChatResourceDate(r);
                  return (
                    <div
                      className={`chat-link-row ${draggingId === r.id ? "is-dragging" : ""} ${activeDropTarget ? `is-drop-${dragTarget.placement}` : ""} ${archived ? "is-archived" : ""}`}
                      data-thread-depth={threadDepth || undefined}
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
                      {childCount > 0 && (
                        <span className="chat-thread-branch" aria-hidden="true">
                          <IconArrowUpLeft size={15} />
                        </span>
                      )}
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
                      {/* 一覧では会話の入口と派生関係だけを見せ、URL・内部時刻は隠す。 */}
                      <span className="chat-link-title">
                        {r.title || "無題"}
                        {(archived || threadLabels.length > 0) && <span className="chat-link-meta">
                          {archived && <small className="chat-thread-meta">Archive</small>}
                          {threadLabels.length > 0 && <small className="chat-thread-meta">{threadLabels.join(" / ")}</small>}
                        </span>}
                      </span>
                      {chatDate !== "—" && <time className="chat-link-date" dateTime={chatDate.replaceAll("/", "-").replace(" ", "T")}>
                        {chatDate}
                      </time>}
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
                      {isConversationMarkdown(String(r.body_markdown || "")) && (
                        <button
                          className="row-action-button chat-conversation-action"
                          onClick={(event) => {
                            event.stopPropagation();
                            openContentViewer({ type: "chat_log", resourceId: String(r.id) });
                          }}
                          aria-label={`${r.title || "チャットリンク"}の会話ログを読む`}
                          title="会話ログを読む"
                        >
                          <IconMessage size={15} />
                        </button>
                      )}
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

      {contextMenu && <ContextMenu x={contextMenu.x} y={contextMenu.y} items={contextMenu.items} onClose={() => setContextMenu(null)} />}
      {importDialogOpen && (
        <ConversationImportDialog
          themes={themes}
          resources={domain.resources}
          initialThemeId={selectedThemeId}
          saveEntities={saveEntities}
          setToast={setToast}
          close={() => setImportDialogOpen(false)}
        />
      )}
    </div>
  );
}
