import { useEffect, useMemo, useState } from "react";
import { IconCopy, IconExternalLink, IconLinkPlus } from "@tabler/icons-react";

import { workspaceApi } from "../../../services/workspaceApi";
import type { Link, PageProps, Theme } from "../types";
import { themeColor } from "../lib/domain";
import { formatDate, str } from "../lib/format";
import { EmptyState, PageHeader, StatusBadge } from "../components/common";

const CHAT_LINK_TYPES = ["chatgpt", "claude", "gemini", "copilot"];
const SERVICE_LABELS: Record<string, string> = {
  chatgpt: "ChatGPT",
  claude: "Claude",
  gemini: "Gemini",
  copilot: "Copilot",
  other: "その他",
};
const REFERENCE_STATUS_LABELS: Record<string, string> = {
  inbox: "未整理",
  keep: "参照",
  adopted: "採用",
  pending: "再確認",
  stale: "古い",
};

function isChatReference(link: Link): boolean {
  return CHAT_LINK_TYPES.includes(str(link.link_type)) || Boolean(link.reference_status);
}

function referenceStatus(link: Link): string {
  const value = str(link.reference_status);
  if (value && REFERENCE_STATUS_LABELS[value]) return value;
  if (!link.theme_id) return "inbox";
  return "keep";
}

function serviceLabel(link: Link): string {
  return SERVICE_LABELS[str(link.link_type)] || str(link.link_type) || "リンク";
}

function linkDate(link: Link): string {
  return str(link.captured_at || link.created_at || link.updated_at);
}

function themeTitle(themes: Theme[], id?: string | null): string {
  return themes.find((theme) => theme.id === id)?.name || "未設定";
}

export function ChatRefsPage({
  themes,
  links,
  activeThemeId,
  setActiveThemeId,
  openDrawer,
  setToast,
}: PageProps) {
  const chatLinks = useMemo(() => links.filter(isChatReference), [links]);
  const [selectedThemeId, setSelectedThemeId] = useState(activeThemeId || themes[0]?.id || "");
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");

  useEffect(() => {
    if (!selectedThemeId && themes[0]) setSelectedThemeId(themes[0].id);
  }, [selectedThemeId, themes]);

  useEffect(() => {
    if (activeThemeId && activeThemeId !== selectedThemeId) setSelectedThemeId(activeThemeId);
  }, [activeThemeId, selectedThemeId]);

  const inboxLinks = chatLinks.filter((link) => referenceStatus(link) === "inbox" || !link.theme_id);

  const scopedLinks = chatLinks.filter((link) => {
    if (selectedThemeId) return link.theme_id === selectedThemeId;
    return !link.theme_id;
  });

  const visibleLinks = scopedLinks.filter((link) => {
    if (statusFilter !== "all" && referenceStatus(link) !== statusFilter) return false;
    const haystack = `${link.title} ${link.description} ${link.url} ${serviceLabel(link)} ${themeTitle(themes, link.theme_id)}`.toLowerCase();
    return haystack.includes(query.toLowerCase());
  });

  function selectTheme(themeId: string) {
    setSelectedThemeId(themeId);
    setActiveThemeId(themeId);
  }

  function copyList() {
    const header = "タイトル\tサービス\tTheme\t状態\tURL\t要約";
    const rows = visibleLinks.map((link) => [
      str(link.title),
      serviceLabel(link),
      themeTitle(themes, link.theme_id),
      REFERENCE_STATUS_LABELS[referenceStatus(link)],
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
        reference_status: selectedThemeId ? "keep" : "inbox",
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
        <button className="primary-button" onClick={addChatLink}><IconLinkPlus size={16} />チャットリンクを追加</button>
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
        <input data-search value={query} onChange={(event) => setQuery(event.target.value)} placeholder="タイトル、要約、URLを検索" />
        <select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)} aria-label="参照状態で絞り込み">
          <option value="all">すべての状態</option>
          {Object.entries(REFERENCE_STATUS_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
        </select>
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
            {visibleLinks.map((link) => (
              <article className="chat-link-card" key={link.id}>
                <div className="badge-row">
                  <StatusBadge value="neutral" label={serviceLabel(link)} />
                  <StatusBadge value={referenceStatus(link)} label={REFERENCE_STATUS_LABELS[referenceStatus(link)]} />
                  {link.importance === "high" && <StatusBadge value="review" label="重要" />}
                </div>
                <button className="chat-link-title" onClick={() => openDrawer({ type: "link", entity: link })}>
                  <strong>{link.title}</strong>
                  <span>{link.description || link.url}</span>
                </button>
                <div className="chat-link-meta">
                  <span>{formatDate(linkDate(link))}</span>
                  <button className="text-button compact" onClick={() => openDrawer({ type: "link", mode: "edit", entity: link })}>編集</button>
                  <a className="secondary-button compact" href={link.url} target="_blank" rel="noreferrer"><IconExternalLink size={15} />開く</a>
                </div>
              </article>
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
                <span>{serviceLabel(link)} / {themeTitle(themes, link.theme_id)}</span>
              </button>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
