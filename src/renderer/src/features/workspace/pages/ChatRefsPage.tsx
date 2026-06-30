import { useEffect, useMemo, useState } from "react";
import {
  IconArrowDown,
  IconArrowUp,
  IconBrandGoogle,
  IconBrandOpenai,
  IconBrandWindows,
  IconChevronDown,
  IconChevronRight,
  IconCopy,
  IconExternalLink,
  IconFoldDown,
  IconFoldUp,
  IconLinkPlus,
  IconPencil,
  IconSparkles,
  IconStar,
  IconStarFilled,
  IconMessageCircleQuestion,
  IconTrash,
} from "@tabler/icons-react";

import { workspaceApi } from "../../../services/workspaceApi";
import type { PageProps, Theme } from "../types";
import type { Resource } from "../domain-model/types";
import { buildSaveResourceOperations } from "../domain-model/persistence";
import { CHAT_SERVICE_LABELS, type ChatServiceType, isKnownChatService, resolveChatService } from "../lib/chatServices";
import {
  buildChatGroupKnowledgePrompt,
  chatResourceDate,
  clearChatGroupResources,
  groupChatResources,
  renameChatGroupResources,
  reorderChatGroupResources,
  UNGROUPED_CHAT_GROUP,
  type ChatRefGroup,
  type ChatRefSortOrder,
} from "../lib/chatRefs";
import { themeColor } from "../lib/domain";
import { formatDate, str } from "../lib/format";
import { isDefaultPrompt, isPromptNote, promptPurpose } from "../lib/prompts";
import { EmptyState, PageHeader } from "../components/common";

type StatusFilter = "all" | "inbox" | "adopted";

function isChatReference(r: Resource): boolean {
  return isKnownChatService(r.link_type) || resolveChatService(r) !== "other" || Boolean(r.reference_status);
}

function isAdopted(r: Resource): boolean {
  return str(r.reference_status) === "adopted";
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
  const [sortOrder, setSortOrder] = useState<ChatRefSortOrder>("manual");
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());

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

  const groups = useMemo(() => groupChatResources(visibleResources, sortOrder), [visibleResources, sortOrder]);
  const allGroupKeys = useMemo(() => groups.map((g) => g.key), [groups]);
  const allCollapsed = allGroupKeys.length > 0 && allGroupKeys.every((key) => collapsed.has(key));
  const currentThemeName = themeTitle(themes, selectedThemeId);

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

  function copyGroupKnowledgePrompt(group: ChatRefGroup) {
    const candidates = domain.notes
      .filter((note) => isPromptNote(note) && promptPurpose(note) === "knowledge")
      .sort((a, b) => Number(isDefaultPrompt(b)) - Number(isDefaultPrompt(a)));
    const scoped = candidates.find((note) => str((note as unknown as Record<string, unknown>).theme_id || note.project_id) === selectedThemeId);
    const basePrompt = str((scoped || candidates[0])?.body_markdown);
    const prompt = buildChatGroupKnowledgePrompt({
      groupLabel: group.label,
      themeName: currentThemeName,
      resources: group.resources,
      basePrompt,
    });
    workspaceApi.copyText(prompt).then(() => setToast(`${group.label}のKnowledge化プロンプトをコピーしました。`));
  }

  function moveChatLink(group: ChatRefGroup, resource: Resource, direction: "up" | "down") {
    const reordered = reorderChatGroupResources(group.resources, resource.id, direction);
    if (!reordered.length) return;
    saveGroupResources(reordered, "並び替えを保存しました。");
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
    const nextSortOrder = Math.max(
      0,
      ...scopedResources
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
        captured_at: new Date().toISOString().slice(0, 10),
        sort_order: nextSortOrder,
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
        <select value={sortOrder} onChange={(event) => setSortOrder(event.target.value as ChatRefSortOrder)} aria-label="並び順">
          <option value="manual">任意順</option>
          <option value="newest">新しい順</option>
          <option value="oldest">古い順</option>
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
                    <strong>{group.label}</strong>
                    <span className="count">{group.resources.length}</span>
                  </button>
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
                    className="chat-group-knowledge"
                    onClick={() => copyGroupKnowledgePrompt(group)}
                    aria-label={`${group.label}をKnowledge化するプロンプトをコピー`}
                    title="Knowledge化プロンプト"
                  >
                    <IconSparkles size={14} />
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
                        title="グループ解除"
                      >
                        <IconTrash size={14} />
                      </button>
                    </>
                  )}
                </div>
                {!collapsed.has(group.key) && group.resources.map((r, index) => {
                  const service = resolveChatService(r);
                  return (
                    <div className="chat-link-row" key={r.id}>
                      {sortOrder === "manual" && (
                        <span className="chat-row-order-actions">
                          <button
                            className="row-action-button"
                            onClick={() => moveChatLink(group, r, "up")}
                            disabled={index === 0}
                            aria-label={`${r.title || "チャットリンク"}を上へ移動`}
                            title="上へ"
                          >
                            <IconArrowUp size={14} />
                          </button>
                          <button
                            className="row-action-button"
                            onClick={() => moveChatLink(group, r, "down")}
                            disabled={index === group.resources.length - 1}
                            aria-label={`${r.title || "チャットリンク"}を下へ移動`}
                            title="下へ"
                          >
                            <IconArrowDown size={14} />
                          </button>
                        </span>
                      )}
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
                      <button
                        className="row-action-button"
                        onClick={() => openDrawer({ type: "resource", mode: "edit", entity: r as unknown as Record<string, unknown> })}
                        aria-label={`${r.title || "チャットリンク"}を編集`}
                        title="編集"
                      >
                        <IconPencil size={15} />
                      </button>
                      <a className="row-action-button chat-link-open" href={r.url || ""} target="_blank" rel="noreferrer" aria-label={`${r.title || "リンク"}を開く`} title="開く">
                        <IconExternalLink size={16} />
                      </a>
                      <button
                        className="row-action-button danger chat-link-delete"
                        onClick={() => removeEntity("resource", r as unknown as Record<string, unknown>)}
                        aria-label={`${r.title || "チャットリンク"}を削除`}
                        title="削除"
                      >
                        <IconTrash size={15} />
                      </button>
                      <span className="chat-link-date">{formatDate(chatResourceDate(r))}</span>
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
