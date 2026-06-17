import { useEffect, useMemo, useState } from "react";
import { IconCalendarCheck, IconFlag, IconFlagFilled } from "@tabler/icons-react";

import { todayIso } from "../../../utils/dataFormat.js";
import type { Item, PageProps } from "../types";
import { defaultLevel } from "../lib/domain";
import { uuid } from "../lib/format";
import { EmptyState, PageHeader } from "../components/common";

type InboxKind = "task" | "memo" | "link" | "waiting" | "idea";

interface InboxDraft {
  output: InboxKind;
  title: string;
  theme_id: string;
  planned_end: string;
  today_flag: boolean;
  priority: string;
  description: string;
  link_url: string;
}

function draftFromItem(item: Item): InboxDraft {
  return {
    output: item.kind === "waiting" || item.status === "waiting" ? "waiting" : item.kind === "idea" ? "idea" : "task",
    title: item.title,
    theme_id: item.theme_id || "",
    planned_end: item.planned_end || "",
    today_flag: item.today_flag === true,
    priority: item.priority === "high" ? "high" : "normal",
    description: item.description || "",
    link_url: "",
  };
}

function isInboxLike(item: Item): boolean {
  return item.status === "inbox" || item.kind === "idea";
}

export function InboxPage({ themes, items, openDrawer, saveEntity, removeEntityQuiet, setToast }: PageProps) {
  const inboxItems = useMemo(() => items.filter(isInboxLike), [items]);
  const [drafts, setDrafts] = useState<Record<string, InboxDraft>>({});
  const [selected, setSelected] = useState<string[]>([]);
  const today = todayIso();

  useEffect(() => {
    setDrafts((current) => {
      const next = { ...current };
      for (const item of inboxItems) {
        if (!next[item.id]) next[item.id] = draftFromItem(item);
      }
      for (const id of Object.keys(next)) {
        if (!inboxItems.some((item) => item.id === id)) delete next[id];
      }
      return next;
    });
  }, [inboxItems]);

  function patchDraft(id: string, patch: Partial<InboxDraft>) {
    setDrafts((current) => ({ ...current, [id]: { ...current[id], ...patch } }));
  }

  async function organize(item: Item) {
    const draft = drafts[item.id] || draftFromItem(item);
    const title = draft.title.trim();
    if (!title) {
      setToast("タイトルを入力してください。入力内容は保持されています。");
      return;
    }
    if (draft.output === "link" && !draft.link_url.trim()) {
      setToast("リンクに整理するにはURLを入力してください。入力内容は保持されています。");
      return;
    }
    const themeId = draft.theme_id || null;
    const common = {
      title,
      theme_id: themeId,
      description: draft.description,
      source_record_id: item.source_record_id || null,
    };
    try {
      if (draft.output === "memo") {
        await saveEntity("note", {
          id: uuid(),
          title,
          body_markdown: draft.description || item.description || title,
          note_type: "memo",
          theme_id: themeId,
          item_id: null,
          source_url: "",
          source_record_id: item.source_record_id || null,
        });
        await removeEntityQuiet("item", item.id);
      } else if (draft.output === "link") {
        await saveEntity("link", {
          id: uuid(),
          ...common,
          url: draft.link_url.trim(),
          link_type: "other",
          item_id: null,
          note_id: null,
        });
        await removeEntityQuiet("item", item.id);
      } else {
        const kind = draft.output === "waiting" ? "waiting" : draft.output === "idea" ? "idea" : "task";
        await saveEntity("item", {
          ...item,
          title,
          kind,
          level: defaultLevel(kind),
          theme_id: themeId,
          status: draft.output === "waiting" ? "waiting" : draft.output === "idea" ? "inbox" : "todo",
          priority: draft.priority,
          planned_end: draft.planned_end || null,
          planned_start: item.planned_start || null,
          today_flag: draft.today_flag,
          is_personal_task: !themeId,
          description: draft.description,
        });
      }
      setSelected((current) => current.filter((id) => id !== item.id));
      setToast("Inboxを整理しました。");
    } catch {
      // saveEntity側のtoastを使い、draftは消さない。
    }
  }

  async function organizeSelectedAsTasks() {
    for (const id of selected) {
      const item = inboxItems.find((entry) => entry.id === id);
      if (item) await organize(item);
    }
  }

  return (
    <div className="page inbox-page">
      <PageHeader title="Inbox整理" subtitle="クイック記録を行の中で分類し、今日の作業やThemeへ接続します。">
        <button className="secondary-button" onClick={() => openDrawer({ type: "item", mode: "edit", entity: { status: "inbox", kind: "idea" } })}>記録を追加</button>
        <button className="primary-button" disabled={!selected.length} onClick={organizeSelectedAsTasks}>{selected.length ? `${selected.length}件を整理` : "選択して整理"}</button>
      </PageHeader>
      <section className="panel inbox-panel">
        <div className="section-heading">
          <h2>未整理</h2>
          <span>{inboxItems.length}件</span>
        </div>
        {inboxItems.length ? (
          <div className="inbox-list">
            {inboxItems.map((item) => {
              const draft = drafts[item.id] || draftFromItem(item);
              return (
                <div className="inbox-card" key={item.id}>
                  <div className="inbox-card-main">
                    <input
                      type="checkbox"
                      checked={selected.includes(item.id)}
                      onChange={(event) => setSelected((current) => event.target.checked ? [...current, item.id] : current.filter((id) => id !== item.id))}
                      aria-label={`${item.title}を選択`}
                    />
                    <label>種類
                      <select value={draft.output} onChange={(event) => patchDraft(item.id, { output: event.target.value as InboxKind })}>
                        <option value="task">タスク</option>
                        <option value="memo">メモ</option>
                        <option value="link">リンク</option>
                        <option value="waiting">待ち</option>
                        <option value="idea">アイデア</option>
                      </select>
                    </label>
                    <label className="inbox-title-field">タイトル
                      <input value={draft.title} onChange={(event) => patchDraft(item.id, { title: event.target.value })} />
                    </label>
                    <label>Theme
                      <select value={draft.theme_id} onChange={(event) => patchDraft(item.id, { theme_id: event.target.value })}>
                        <option value="">個人業務</option>
                        {themes.map((theme) => <option key={theme.id} value={theme.id}>{theme.name}</option>)}
                      </select>
                    </label>
                    <label>予定日
                      <input type="date" value={draft.planned_end} onChange={(event) => patchDraft(item.id, { planned_end: event.target.value })} />
                    </label>
                    <button
                      className={`today-plan-button ${draft.today_flag ? "is-active" : ""}`}
                      onClick={() => patchDraft(item.id, { today_flag: !draft.today_flag, planned_end: !draft.today_flag && !draft.planned_end ? today : draft.planned_end })}
                      aria-label={draft.today_flag ? "今日やるから外す" : "今日やるに入れる"}
                      title={draft.today_flag ? "今日やるから外す" : "今日やるに入れる"}
                    >
                      <IconCalendarCheck size={16} />
                    </button>
                    <button
                      className={`priority-flag-button ${draft.priority === "high" ? "is-active" : ""}`}
                      onClick={() => patchDraft(item.id, { priority: draft.priority === "high" ? "normal" : "high" })}
                      aria-label={draft.priority === "high" ? "優先フラグを外す" : "優先フラグを付ける"}
                      title={draft.priority === "high" ? "優先フラグを外す" : "優先フラグを付ける"}
                    >
                      {draft.priority === "high" ? <IconFlagFilled size={16} /> : <IconFlag size={16} />}
                    </button>
                  </div>
                  <div className="inbox-card-details">
                    {draft.output === "link" && (
                      <label>URL
                        <input value={draft.link_url} onChange={(event) => patchDraft(item.id, { link_url: event.target.value })} placeholder="https://example.com" />
                      </label>
                    )}
                    <label>説明・補足
                      <textarea value={draft.description} onChange={(event) => patchDraft(item.id, { description: event.target.value })} />
                    </label>
                    <div className="form-actions">
                      <button className="secondary-button compact" onClick={() => openDrawer({ type: "item", entity: item })}>詳細</button>
                      <button className="primary-button compact" onClick={() => organize(item)}>整理する</button>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
          <EmptyState title="未整理の記録はありません" action="記録を追加" onAction={() => openDrawer({ type: "item", mode: "edit", entity: { status: "inbox", kind: "idea" } })} />
        )}
      </section>
    </div>
  );
}
