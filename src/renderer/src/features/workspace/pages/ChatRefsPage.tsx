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
import type { Link, PageProps, Theme } from "../types";
import { themeColor } from "../lib/domain";
import { formatDate, str } from "../lib/format";
import { EmptyState, PageHeader } from "../components/common";

const CHAT_LINK_TYPES = ["chatgpt", "claude", "gemini", "copilot"];
const UNGROUPED = "__ungrouped__";

type SortOrder = "newest" | "oldest";
type StatusFilter = "all" | "inbox" | "adopted";

function isChatReference(link: Link): boolean {
  return CHAT_LINK_TYPES.includes(str(link.link_type)) || Boolean(link.reference_status);
}

function isAdopted(link: Link): boolean {
  return str(link.reference_status) === "adopted";
}

function linkDate(link: Link): string {
  return str(link.captured_at || link.created_at || link.updated_at);
}

function themeTitle(themes: Theme[], id?: string | null): string {
  return themes.find((theme) => theme.id === id)?.name || "未設定";
}

function sortLinks(links: Link[], order: SortOrder): Link[] {
  const sorted = [...links].sort((a, b) => linkDate(a).localeCompare(linkDate(b)));
  return order === "newest" ? sorted.reverse() : sorted;
}

function groupLinks(links: Link[], order: SortOrder): { key: string; label: string; links: Link[] }[] {
  const map = new Map<string, Link[]>();
  for (const link of links) {
    const key = str(link.chat_group).trim() || UNGROUPED;
    const list = map.get(key);
    if (list) list.push(link);
    else map.set(key, [link]);
  }
  const groups: { key: string; label: string; links: Link[] }[] = [];
  for (const [key, list] of map) {
    if (key !== UNGROUPED) groups.push({ key, label: key, links: sortLinks(list, order) });
  }
  groups.sort((a, b) => a.label.localeCompare(b.label, "ja-JP"));
  const ungrouped = map.get(UNGROUPED);
  if (ungrouped) groups.push({ key: UNGROUPED, label: "未分類", links: sortLinks(ungrouped, order) });
  return groups;
}

export function ChatRefsPage({
  themes,
  links,
  activeThemeId,
  setActiveThemeId,
  openDrawer,
  saveEntity,
  setToast,
}: PageProps) {
  const chatLinks = useMemo(() => links.filter(isChatReference), [links]);
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

  const inboxLinks = chatLinks.filter((link) => !link.theme_id);

  const scopedLinks = chatLinks.filter((link) => {
    if (selectedThemeId) return link.theme_id === selectedThemeId;
    return !link.theme_id;
  });

  const visibleLinks = scopedLinks.filter((link) => {
    if (statusFilter === "adopted" && !isAdopted(link)) return false;
    if (statusFilter === "inbox" && isAdopted(link)) return false;
    const haystack = `${link.title} ${link.description} ${link.url} ${link.chat_group || ""} ${themeTitle(themes, link.theme_id)}`.toLowerCase();
    return haystack.includes(query.toLowerCase());
  });

  const groups = useMemo(() => groupLinks(visibleLinks, sortOrder), [visibleLinks, sortOrder]);
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

  function toggleAdopted(link: Link) {
    void saveEntity("link", { ...link, reference_status: isAdopted(link) ? "inbox" : "adopted" });
  }

  function selectTheme(themeId: string) {
    setSelectedThemeId(themeId);
    setActiveThemeId(themeId);
  }

  function copyGroupUrls(groupLinks: Link[]) {
    workspaceApi.copyText(groupLinks.map((link) => link.url).join("\n")).then(() => setToast(`${groupLinks.length}件のURLをコピーしました。`));
  }

  function copyList() {
    const header = "タイトル\tグループ\tTheme\t採用\tURL\t要約";
    const rows = visibleLinks.map((link) => [
      str(link.title),
      str(link.chat_group),
      themeTitle(themes, link.theme_id),
      isAdopted(link) ? "★" : "",
      str(link.url),
      str(link.description).replace(/\s+/g, " "),
    ].join("\t"));
    workspaceApi.copyText([header, ...rows].join("\n")).then(() => setToast("チャット参照一覧をコピーしました。"));
  }

  function copyUrls() {
    workspaceApi.copyText(visibleLinks.map((link) => link.url).join("\n")).then(() => setToast("チャットURLをコピーしました。"));
  }

  function addChatLink() {
    openDrawer({
      type: "link",
      mode: "edit",
      entity: {
        link_type: "chatgpt",
        reference_status: "inbox",
        theme_id: selectedThemeId || null,
        item_id: null,
        importance: "normal",
        captured_at: new Date().toISOString().slice(0, 10),
      },
    });
  }

  return (
    <div className="page chat-refs-page">
      <PageHeader title="チャット参照棚" subtitle="外部AIチャットをTheme単位で保管し、あとからNoteやKnowledgeに展開します。">
        <button className="secondary-button" onClick={copyUrls} disabled={!visibleLinks.length}><IconCopy size={16} />URLをコピー</button>
        <button className="secondary-button" onClick={copyList} disabled={!visibleLinks.length}><IconCopy size={16} />一覧をコピー</button>
        <button className="primary-button" onClick={addChatLink}><IconLinkPlus size={16} />追加</button>
      </PageHeader>

      <section className="chat-ref-toolbar panel">
        <div>
          <span>未整理</span>
          <strong className="metric-value">{inboxLinks.length}</strong>
        </div>
        <div>
          <span>表示中</span>
          <strong className="metric-value">{visibleLinks.length}</strong>
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
              const count = chatLinks.filter((link) => link.theme_id === theme.id).length;
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
            <span>{visibleLinks.length}件</span>
          </div>
          <div className="chat-link-list">
            {groups.map((group) => (
              <div className="chat-link-group" key={group.key}>
                <div className="chat-group-header">
                  <button className="chat-group-toggle" onClick={() => toggleGroup(group.key)}>
                    {collapsed.has(group.key) ? <IconChevronRight size={16} /> : <IconChevronDown size={16} />}
                    <strong>{group.label}</strong>
                    <span className="count">{group.links.length}</span>
                  </button>
                  <button
                    className="chat-group-copy"
                    onClick={() => copyGroupUrls(group.links)}
                    aria-label={`${group.label}のURLをコピー`}
                  >
                    <IconCopy size={14} />
                  </button>
                </div>
                {!collapsed.has(group.key) && group.links.map((link) => (
                  <div className="chat-link-row" key={link.id}>
                    <button
                      className={`chat-star ${isAdopted(link) ? "is-adopted" : ""}`}
                      onClick={() => toggleAdopted(link)}
                      aria-label={isAdopted(link) ? "採用を解除" : "採用にする"}
                    >
                      {isAdopted(link) ? <IconStarFilled size={16} /> : <IconStar size={16} />}
                    </button>
                    <button className="chat-link-title" onClick={() => openDrawer({ type: "link", mode: "edit", entity: link })}>
                      {link.title || "無題"}
                    </button>
                    <a className="chat-link-open" href={link.url} target="_blank" rel="noreferrer" aria-label="リンクを開く">
                      <IconExternalLink size={16} />
                    </a>
                    <span className="chat-link-date">{formatDate(linkDate(link))}</span>
                  </div>
                ))}
              </div>
            ))}
            {!visibleLinks.length && <EmptyState title="チャット参照がありません" action="チャットリンクを追加" onAction={addChatLink} />}
          </div>
        </div>
      </section>

      {inboxLinks.length > 0 && (
        <section className="panel chat-inbox-strip">
          <div className="section-heading">
            <h2>未整理チャット</h2>
            <span>{inboxLinks.length}件</span>
          </div>
          <div>
            {inboxLinks.slice(0, 6).map((link) => (
              <button key={link.id} onClick={() => openDrawer({ type: "link", mode: "edit", entity: link })}>
                <strong>{link.title}</strong>
                <span>{themeTitle(themes, link.theme_id)}</span>
              </button>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
