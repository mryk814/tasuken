import { useEffect, useMemo, useState } from "react";
import {
  IconChevronDown,
  IconChevronRight,
  IconCopy,
  IconExternalLink,
  IconFoldDown,
  IconFoldUp,
  IconLinkPlus,
  IconSortAscending,
  IconSortDescending,
  IconStar,
  IconStarFilled,
} from "@tabler/icons-react";

import { workspaceApi } from "../../../services/workspaceApi";
import type { PageProps, Theme } from "../types";
import type { Resource } from "../domain-model/types";
import { buildSaveResourceOperations } from "../domain-model/persistence";
import { themeColor, themeLabel } from "../lib/domain";
import { formatDate, str } from "../lib/format";
import { EmptyState, PageHeader } from "../components/common";

const CHAT_LINK_TYPES = ["chatgpt", "claude", "gemini", "copilot"];
const UNGROUPED = "__ungrouped__";

type SortOrder = "newest" | "oldest";
type StatusFilter = "all" | "inbox" | "adopted";

function isChatReference(r: Resource): boolean {
  return CHAT_LINK_TYPES.includes(str(r.link_type)) || Boolean(r.reference_status);
}

function isAdopted(r: Resource): boolean {
  return str(r.reference_status) === "adopted";
}

function resourceDate(r: Resource): string {
  return str(r.captured_at || (r as unknown as Record<string, unknown>).created_at || (r as unknown as Record<string, unknown>).updated_at);
}

function themeTitle(themes: Theme[], id?: string | null): string {
  return themeLabel(themes.find((theme) => theme.id === id), "未設定");
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
  saveEntities,
  setToast,
}: PageProps) {
  const chatResources = useMemo(() => domain.resources.filter(isChatReference), [domain.resources]);
  const [selectedThemeId, setSelectedThemeId] = useState(activeThemeId || themes[0]?.id || "");
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [sortOrder, setSortOrder] = useState<SortOrder>("newest");
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

  function addChatLink() {
    openDrawer({
      type: "resource",
      mode: "edit",
      entity: {
        link_type: "chatgpt",
        reference_status: "inbox",
        project_id: selectedThemeId || null,
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
        <button className="primary-button" onClick={addChatLink}><IconLinkPlus size={16} />追加</button>
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
                  <strong>{themeLabel(theme)}</strong>
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
                    className="chat-group-copy"
                    onClick={() => copyGroupUrls(group.resources)}
                    aria-label={`${group.label}のURLをコピー`}
                  >
                    <IconCopy size={14} />
                  </button>
                </div>
                {!collapsed.has(group.key) && group.resources.map((r) => (
                  <div className="chat-link-row" key={r.id}>
                    <button
                      className={`chat-star ${isAdopted(r) ? "is-adopted" : ""}`}
                      onClick={() => toggleAdopted(r)}
                      aria-label={isAdopted(r) ? "採用を解除" : "採用にする"}
                    >
                      {isAdopted(r) ? <IconStarFilled size={16} /> : <IconStar size={16} />}
                    </button>
                    <button className="chat-link-title" onClick={() => openDrawer({ type: "resource", mode: "edit", entity: r as unknown as Record<string, unknown> })}>
                      {r.title || "無題"}
                    </button>
                    <a className="chat-link-open" href={r.url || ""} target="_blank" rel="noreferrer" aria-label="リンクを開く">
                      <IconExternalLink size={16} />
                    </a>
                    <span className="chat-link-date">{formatDate(resourceDate(r))}</span>
                  </div>
                ))}
              </div>
            ))}
            {!visibleResources.length && <EmptyState title="チャット参照がありません" action="チャットリンクを追加" onAction={addChatLink} />}
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
