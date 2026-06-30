import { useEffect, useMemo, useRef, useState } from "react";
import {
  IconArrowDown,
  IconArrowUp,
  IconBrandGoogle,
  IconBrandOpenai,
  IconBrandWindows,
  IconBulb,
  IconChevronDown,
  IconChevronRight,
  IconCopy,
  IconExternalLink,
  IconFoldDown,
  IconFoldUp,
  IconLinkPlus,
  IconPencil,
  IconSortAscending,
  IconSortDescending,
  IconSparkles,
  IconStar,
  IconStarFilled,
  IconMessageCircleQuestion,
  IconTrash,
  IconX,
} from "@tabler/icons-react";

import { workspaceApi } from "../../../services/workspaceApi";
import type { PageProps, Theme } from "../types";
import type { Resource } from "../domain-model/types";
import { buildSaveResourceOperations } from "../domain-model/persistence";
import { CHAT_SERVICE_LABELS, type ChatServiceType, isKnownChatService, resolveChatService } from "../lib/chatServices";
import { themeColor } from "../lib/domain";
import { formatDate, str } from "../lib/format";
import { EmptyState, PageHeader } from "../components/common";

const UNGROUPED = "__ungrouped__";

type SortOrder = "newest" | "oldest";
type StatusFilter = "all" | "inbox" | "adopted";

function isChatReference(r: Resource): boolean {
  return isKnownChatService(r.link_type) || resolveChatService(r) !== "other" || Boolean(r.reference_status);
}

function isAdopted(r: Resource): boolean {
  return str(r.reference_status) === "adopted";
}

function resourceDate(r: Resource): string {
  return str(r.captured_at || (r as unknown as Record<string, unknown>).created_at || (r as unknown as Record<string, unknown>).updated_at);
}

function themeTitle(themes: Theme[], id?: string | null): string {
  return themes.find((theme) => theme.id === id)?.name || "未設定";
}

function ChatServiceIcon({ service }: { service: ChatServiceType }) {
  if (service === "chatgpt") return <IconBrandOpenai size={16} />;
  if (service === "claude") return <IconSparkles size={16} />;
  if (service === "gemini") return <IconBrandGoogle size={16} />;
  if (service === "copilot") return <IconBrandWindows size={16} />;
  return <IconMessageCircleQuestion size={16} />;
}

function sortResources(resources: Resource[], order: SortOrder): Resource[] {
  const sorted = [...resources].sort((a, b) => resourceDate(a).localeCompare(resourceDate(b)));
  return order === "newest" ? sorted.reverse() : sorted;
}

function groupResources(resources: Resource[], order: SortOrder): { key: string; label: string; resources: Resource[] }[] {
  const map = new Map<string, Resource[]>();
  for (const r of resources) {
    const key = str(r.chat_group).trim() || UNGROUPED;
    const list = map.get(key);
    if (list) list.push(r);
    else map.set(key, [r]);
  }
  const groups: { key: string; label: string; resources: Resource[] }[] = [];
  for (const [key, list] of map) {
    if (key !== UNGROUPED) groups.push({ key, label: key, resources: sortResources(list, order) });
  }
  groups.sort((a, b) => a.label.localeCompare(b.label, "ja-JP"));
  const ungrouped = map.get(UNGROUPED);
  if (ungrouped) groups.push({ key: UNGROUPED, label: "未分類", resources: sortResources(ungrouped, order) });
  return groups;
}

export function ChatRefsPage({
  themes,
  domain,
  activeThemeId,
  setActiveThemeId,
  openDrawer,
  removeEntity,
  saveEntities,
  setToast,
}: PageProps) {
  const chatResources = useMemo(() => domain.resources.filter(isChatReference), [domain.resources]);
  const [selectedThemeId, setSelectedThemeId] = useState(activeThemeId || themes[0]?.id || "");
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [sortOrder, setSortOrder] = useState<SortOrder>("newest");
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [editingGroup, setEditingGroup] = useState<{ key: string; value: string } | null>(null);
  const editInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!selectedThemeId && themes[0]) setSelectedThemeId(themes[0].id);
  }, [selectedThemeId, themes]);

  useEffect(() => {
    if (activeThemeId && activeThemeId !== selectedThemeId) setSelectedThemeId(activeThemeId);
  }, [activeThemeId, selectedThemeId]);

  const inboxResources = chatResources.filter((r) => !r.project_id);

  const scopedResources = chatResources.filter((r) => {
    if (selectedThemeId) return r.project_id === selectedThemeId;
    return !r.project_id;
  });

  const visibleResources = scopedResources.filter((r) => {
    if (statusFilter === "adopted" && !isAdopted(r)) return false;
    if (statusFilter === "inbox" && isAdopted(r)) return false;
    const haystack = `${r.title} ${r.description} ${r.url} ${r.chat_group || ""} ${themeTitle(themes, r.project_id)}`.toLowerCase();
    return haystack.includes(query.toLowerCase());
  });

  const groups = useMemo(() => groupResources(visibleResources, sortOrder), [visibleResources, sortOrder]);
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

  function startEditingGroup(groupKey: string) {
    if (groupKey === UNGROUPED) return;
    setEditingGroup({ key: groupKey, value: groupKey });
    requestAnimationFrame(() => editInputRef.current?.select());
  }

  function commitGroupRename() {
    if (!editingGroup) return;
    const newName = editingGroup.value.trim();
    const oldName = editingGroup.key;
    setEditingGroup(null);
    if (!newName || newName === oldName) return;
    const group = groups.find((g) => g.key === oldName);
    if (!group) return;
    const ops = group.resources.flatMap((r) => buildSaveResourceOperations({ ...r, chat_group: newName }));
    void saveEntities(ops, `グループ名を「${newName}」に変更しました。`);
  }

  function deleteGroup(groupKey: string, groupResources: Resource[]) {
    if (groupKey === UNGROUPED) return;
    const ops = groupResources.flatMap((r) => buildSaveResourceOperations({ ...r, chat_group: null }));
    void saveEntities(ops, `グループ「${groupKey}」を解除しました（${groupResources.length}件を未分類に移動）。`);
  }

  function moveResourceInGroup(groupKey: string, groupResources: Resource[], index: number, direction: -1 | 1) {
    const targetIndex = index + direction;
    if (targetIndex < 0 || targetIndex >= groupResources.length) return;
    const reordered = [...groupResources];
    const [moved] = reordered.splice(index, 1);
    reordered.splice(targetIndex, 0, moved);
    const now = new Date();
    const ops = reordered.flatMap((r, i) => {
      const newDate = new Date(now.getTime() - (sortOrder === "newest" ? i : reordered.length - 1 - i) * 1000);
      return buildSaveResourceOperations({ ...r, captured_at: newDate.toISOString().slice(0, 19) });
    });
    void saveEntities(ops, "並び順を変更しました。");
  }

  function copyKnowledgePrompt(groupLabel: string, groupResources: Resource[]) {
    const urls = groupResources.map((r) => `- ${r.title || "無題"}: ${r.url || "(URLなし)"}`).join("\n");
    const prompt = `以下の「${groupLabel}」に関するチャット履歴から、重要な知見・決定事項・学びをKnowledge（構造化されたナレッジノード）として抽出してください。\n\n## 対象チャット\n${urls}\n\n## 抽出してほしい内容\n- 事実・根拠（evidence）: データや検証結果に基づく発見\n- 主張・結論（claim）: 議論の結果得られた結論\n- 問い（question）: 未解決の疑問や今後の検討課題\n- 決定（decision）: 意思決定とその理由\n- 洞察（insight）: 気づきや教訓\n\nそれぞれのノードについて、タイトル、本文（根拠・文脈を含む）、種別を明記してください。`;
    workspaceApi.copyText(prompt).then(() => setToast(`「${groupLabel}」のKnowledge抽出プロンプトをコピーしました。`));
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
    openDrawer({
      type: "resource",
      mode: "edit",
      entity: {
        reference_status: "inbox",
        project_id: selectedThemeId || null,
        chat_group: chatGroup,
        importance: "normal",
        captured_at: new Date().toISOString().slice(0, 10),
      },
    });
  }

  return (
    <div className="page chat-refs-page">
      <PageHeader title="チャット参照棚" subtitle="外部AIチャットをTheme単位で保管し、あとからNoteやKnowledgeに展開します。">
        <button className="secondary-button" onClick={copyUrls} disabled={!visibleResources.length}><IconCopy size={16} />URLをコピー</button>
        <button className="secondary-button" onClick={copyList} disabled={!visibleResources.length}><IconCopy size={16} />一覧をコピー</button>
        <button className="primary-button" onClick={() => addChatLink()}><IconLinkPlus size={16} />追加</button>
      </PageHeader>

      <section className="chat-ref-toolbar panel">
        <div>
          <span>未整理</span>
          <strong className="metric-value">{inboxResources.length}</strong>
        </div>
        <div>
          <span>表示中</span>
          <strong className="metric-value">{visibleResources.length}</strong>
        </div>
        <input data-search value={query} onChange={(event) => setQuery(event.target.value)} placeholder="タイトル、グループ、URLを検索" />
        <select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value as StatusFilter)} aria-label="参照状態で絞り込み">
          <option value="all">すべて</option>
          <option value="adopted">採用のみ</option>
          <option value="inbox">未整理のみ</option>
        </select>
        <button
          className="secondary-button compact icon-only"
          onClick={() => setSortOrder((prev) => prev === "newest" ? "oldest" : "newest")}
          aria-label={sortOrder === "newest" ? "古い順にする" : "新しい順にする"}
          title={sortOrder === "newest" ? "新しい順" : "古い順"}
        >
          {sortOrder === "newest" ? <IconSortDescending size={16} /> : <IconSortAscending size={16} />}
        </button>
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
              const count = chatResources.filter((r) => r.project_id === theme.id).length;
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
            <h2>チャットリンク</h2>
            <span>{visibleResources.length}件</span>
          </div>
          <div className="chat-link-list">
            {groups.map((group) => (
              <div className="chat-link-group" key={group.key}>
                <div className="chat-group-header">
                  <button className="chat-group-toggle" onClick={() => toggleGroup(group.key)}>
                    {collapsed.has(group.key) ? <IconChevronRight size={16} /> : <IconChevronDown size={16} />}
                    {editingGroup?.key === group.key ? (
                      <input
                        ref={editInputRef}
                        className="chat-group-name-input"
                        value={editingGroup.value}
                        onChange={(e) => setEditingGroup({ ...editingGroup, value: e.target.value })}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") commitGroupRename();
                          if (e.key === "Escape") setEditingGroup(null);
                        }}
                        onBlur={commitGroupRename}
                        onClick={(e) => e.stopPropagation()}
                        autoFocus
                      />
                    ) : (
                      <strong>{group.label}</strong>
                    )}
                    <span className="count">{group.resources.length}</span>
                  </button>
                  {group.key !== UNGROUPED && (
                    <>
                      <button
                        className="chat-group-action"
                        onClick={() => startEditingGroup(group.key)}
                        aria-label={`${group.label}のグループ名を編集`}
                        title="グループ名を編集"
                      >
                        <IconPencil size={14} />
                      </button>
                      <button
                        className="chat-group-action"
                        onClick={() => copyKnowledgePrompt(group.label, group.resources)}
                        aria-label={`${group.label}のKnowledge抽出プロンプトをコピー`}
                        title="Knowledge抽出プロンプトをコピー"
                      >
                        <IconBulb size={14} />
                      </button>
                      <button
                        className="chat-group-action danger"
                        onClick={() => deleteGroup(group.key, group.resources)}
                        aria-label={`${group.label}グループを解除`}
                        title="グループを解除（リンクは未分類に移動）"
                      >
                        <IconX size={14} />
                      </button>
                    </>
                  )}
                  <button
                    className="chat-group-add"
                    onClick={() => addChatLink(group.key === UNGROUPED ? "" : group.key)}
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
                </div>
                {!collapsed.has(group.key) && group.resources.map((r, rIndex) => {
                  const service = resolveChatService(r);
                  return (
                    <div className="chat-link-row" key={r.id}>
                      <button
                        className={`chat-star ${isAdopted(r) ? "is-adopted" : ""}`}
                        onClick={() => toggleAdopted(r)}
                        aria-label={isAdopted(r) ? "採用を解除" : "採用にする"}
                      >
                        {isAdopted(r) ? <IconStarFilled size={16} /> : <IconStar size={16} />}
                      </button>
                      <span className={`chat-service-chip chat-service-${service}`} title={CHAT_SERVICE_LABELS[service]} aria-label={CHAT_SERVICE_LABELS[service]}>
                        <ChatServiceIcon service={service} />
                      </span>
                      <button className="chat-link-title" onClick={() => openDrawer({ type: "resource", mode: "edit", entity: r as unknown as Record<string, unknown> })}>
                        {r.title || "無題"}
                      </button>
                      <span className="chat-link-reorder">
                        <button
                          className="chat-link-move"
                          onClick={() => moveResourceInGroup(group.key, group.resources, rIndex, -1)}
                          disabled={rIndex === 0}
                          aria-label="上に移動"
                          title="上に移動"
                        >
                          <IconArrowUp size={14} />
                        </button>
                        <button
                          className="chat-link-move"
                          onClick={() => moveResourceInGroup(group.key, group.resources, rIndex, 1)}
                          disabled={rIndex === group.resources.length - 1}
                          aria-label="下に移動"
                          title="下に移動"
                        >
                          <IconArrowDown size={14} />
                        </button>
                      </span>
                      <a className="chat-link-open" href={r.url || ""} target="_blank" rel="noreferrer" aria-label="リンクを開く">
                        <IconExternalLink size={16} />
                      </a>
                      <button
                        className="chat-link-delete"
                        onClick={() => removeEntity("resource", r as unknown as Record<string, unknown>)}
                        aria-label={`${r.title || "チャットリンク"}を削除`}
                        title="削除"
                      >
                        <IconTrash size={15} />
                      </button>
                      <span className="chat-link-date">{formatDate(resourceDate(r))}</span>
                    </div>
                  );
                })}
              </div>
            ))}
            {!visibleResources.length && <EmptyState title="チャット参照がありません" action="チャットリンクを追加" onAction={() => addChatLink()} />}
          </div>
        </div>
      </section>

      {inboxResources.length > 0 && (
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
    </div>
  );
}
