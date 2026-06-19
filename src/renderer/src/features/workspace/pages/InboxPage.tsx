import { useEffect, useMemo, useState } from "react";
import { IconCalendarCheck, IconFlag, IconFlagFilled } from "@tabler/icons-react";

import { todayIso } from "../../../utils/dataFormat.js";
import type { Item, PageProps } from "../types";
import { defaultLevel } from "../lib/domain";
import { uuid } from "../lib/format";
import { EmptyState, PageHeader } from "../components/common";
import { workspaceToV2 } from "../../workspace-v2/domain/legacyAdapter";
import { buildInboxView } from "../../workspace-v2/domain/selectors";
import type { CaptureEntry } from "../../workspace-v2/domain/types";

type InboxKind = "task" | "memo" | "link" | "waiting" | "idea";

interface InboxDraft {
  output: InboxKind;
  title: string;
  theme_id: string;
  item_id: string;
  planned_end: string;
  today_flag: boolean;
  priority: string;
  description: string;
  link_url: string;
  link_type: string;
  reference_status: string;
}

interface InboxRow {
  entry: CaptureEntry;
  legacyItem?: Item;
}

function draftFromEntry(entry: CaptureEntry, legacyItem?: Item): InboxDraft {
  return {
    output: "task",
    title: entry.title || legacyItem?.title || entry.text,
    theme_id: legacyItem?.theme_id || "",
    item_id: "",
    planned_end: legacyItem?.planned_end || "",
    today_flag: legacyItem?.today_flag === true,
    priority: legacyItem?.priority === "high" ? "high" : "normal",
    description: legacyItem?.description || entry.text,
    link_url: "",
    link_type: "chatgpt",
    reference_status: "inbox",
  };
}

export function InboxPage({ data, themes, items, openDrawer, saveEntity, removeEntityQuiet, setToast }: PageProps) {
  const inboxRows = useMemo(() => {
    const legacyItemsById = new Map(items.map((item) => [item.id, item]));
    return buildInboxView(workspaceToV2(data)).entries.map((entry) => ({
      entry,
      legacyItem: entry.legacy_item_id ? legacyItemsById.get(entry.legacy_item_id) : undefined,
    }));
  }, [data, items]);
  const [drafts, setDrafts] = useState<Record<string, InboxDraft>>({});
  const [selected, setSelected] = useState<string[]>([]);
  const today = todayIso();
  const legacyItemsByTheme = useMemo(() => {
    const byTheme = new Map<string, Item[]>();
    for (const item of items) {
      const key = item.theme_id || "";
      byTheme.set(key, [...(byTheme.get(key) || []), item]);
    }
    return byTheme;
  }, [items]);

  useEffect(() => {
    setDrafts((current) => {
      const next = { ...current };
      for (const row of inboxRows) {
        if (!next[row.entry.id]) next[row.entry.id] = draftFromEntry(row.entry, row.legacyItem);
      }
      for (const id of Object.keys(next)) {
        if (!inboxRows.some((row) => row.entry.id === id)) delete next[id];
      }
      return next;
    });
  }, [inboxRows]);

  function patchDraft(id: string, patch: Partial<InboxDraft>) {
    setDrafts((current) => ({ ...current, [id]: { ...current[id], ...patch } }));
  }

  async function organize(row: InboxRow) {
    const item = row.legacyItem;
    if (!item) {
      setToast("この記録はまだlegacy itemに紐づいていないため、次のv2保存フェーズで整理します。");
      return;
    }
    const draft = drafts[row.entry.id] || draftFromEntry(row.entry, item);
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
          link_type: draft.link_type,
          item_id: draft.item_id || null,
          note_id: null,
          reference_status: draft.reference_status,
          importance: draft.priority === "high" ? "high" : "normal",
          captured_at: new Date().toISOString().slice(0, 10),
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
          status: draft.output === "waiting" ? "waiting" : "todo",
          priority: draft.priority,
          planned_end: draft.planned_end || null,
          planned_start: null,
          today_flag: draft.today_flag,
          is_personal_task: !themeId,
          description: draft.description,
        });
      }
      setSelected((current) => current.filter((id) => id !== row.entry.id));
      setToast("Inboxを整理しました。");
    } catch {
      // saveEntity側のtoastを使い、draftは消さない。
    }
  }

  async function organizeSelectedAsTasks() {
    for (const id of selected) {
      const row = inboxRows.find((entry) => entry.entry.id === id);
      if (row) await organize(row);
    }
  }

  return (
    <div className="page inbox-page">
      <PageHeader title="Inbox整理" subtitle="クイック記録を行の中で分類し、今日の作業やThemeへ接続します。">
        <button className="secondary-button" onClick={() => openDrawer({ type: "item", mode: "edit", entity: { status: "inbox", kind: "idea" } })}>記録を追加</button>
        <button className="secondary-button" onClick={() => openDrawer({ type: "link", mode: "edit", entity: { link_type: "chatgpt", reference_status: "inbox", captured_at: new Date().toISOString().slice(0, 10) } })}>チャットリンクを追加</button>
        <button className="primary-button" disabled={!selected.length} onClick={organizeSelectedAsTasks}>{selected.length ? `${selected.length}件を整理` : "選択して整理"}</button>
      </PageHeader>
      <section className="panel inbox-panel">
        <div className="section-heading">
          <h2>未整理</h2>
          <span>{inboxRows.length}件</span>
        </div>
        {inboxRows.length ? (
          <div className="inbox-list">
            {inboxRows.map((row) => {
              const item = row.legacyItem;
              const draft = drafts[row.entry.id] || draftFromEntry(row.entry, item);
              const linkTargetItems = draft.theme_id ? (legacyItemsByTheme.get(draft.theme_id) || []) : items;
              return (
                <div className="inbox-card" key={row.entry.id}>
                  <div className="inbox-card-main">
                    <input
                      type="checkbox"
                      checked={selected.includes(row.entry.id)}
                      onChange={(event) => setSelected((current) => event.target.checked ? [...current, row.entry.id] : current.filter((id) => id !== row.entry.id))}
                      aria-label={`${draft.title}を選択`}
                      disabled={!item}
                    />
                    <label>種類
                      <select value={draft.output} onChange={(event) => patchDraft(row.entry.id, { output: event.target.value as InboxKind })}>
                        <option value="task">タスク</option>
                        <option value="memo">メモ</option>
                        <option value="link">リンク</option>
                        <option value="waiting">待ち</option>
                        <option value="idea">アイデア</option>
                      </select>
                    </label>
                    <label className="inbox-title-field">タイトル
                      <input value={draft.title} onChange={(event) => patchDraft(row.entry.id, { title: event.target.value })} />
                    </label>
                    <label>Theme
                      <select value={draft.theme_id} onChange={(event) => patchDraft(row.entry.id, { theme_id: event.target.value })}>
                        <option value="">個人業務</option>
                        {themes.map((theme) => <option key={theme.id} value={theme.id}>{theme.name}</option>)}
                      </select>
                    </label>
                    <label>予定日
                      <input type="date" value={draft.planned_end} onChange={(event) => patchDraft(row.entry.id, { planned_end: event.target.value })} />
                    </label>
                    <button
                      className={`today-plan-button ${draft.today_flag ? "is-active" : ""}`}
                      onClick={() => patchDraft(row.entry.id, { today_flag: !draft.today_flag, planned_end: !draft.today_flag && !draft.planned_end ? today : draft.planned_end })}
                      aria-label={draft.today_flag ? "今日やるから外す" : "今日やるに入れる"}
                      title={draft.today_flag ? "今日やるから外す" : "今日やるに入れる"}
                    >
                      <IconCalendarCheck size={16} />
                    </button>
                    <button
                      className={`priority-flag-button ${draft.priority === "high" ? "is-active" : ""}`}
                      onClick={() => patchDraft(row.entry.id, { priority: draft.priority === "high" ? "normal" : "high" })}
                      aria-label={draft.priority === "high" ? "優先フラグを外す" : "優先フラグを付ける"}
                      title={draft.priority === "high" ? "優先フラグを外す" : "優先フラグを付ける"}
                    >
                      {draft.priority === "high" ? <IconFlagFilled size={16} /> : <IconFlag size={16} />}
                    </button>
                  </div>
                  <div className="inbox-card-details">
                    {draft.output === "link" && (
                      <div className="inbox-link-fields">
                        <label>URL
                          <input value={draft.link_url} onChange={(event) => patchDraft(row.entry.id, { link_url: event.target.value })} placeholder="https://chatgpt.com/..." />
                        </label>
                        <label>サービス
                          <select value={draft.link_type} onChange={(event) => patchDraft(row.entry.id, { link_type: event.target.value })}>
                            <option value="chatgpt">ChatGPT</option>
                            <option value="claude">Claude</option>
                            <option value="gemini">Gemini</option>
                            <option value="copilot">Copilot</option>
                            <option value="other">その他</option>
                          </select>
                        </label>
                        <label>実施事項
                          <select value={draft.item_id} onChange={(event) => patchDraft(row.entry.id, { item_id: event.target.value })}>
                            <option value="">未設定</option>
                            {linkTargetItems.map((entry) => <option key={entry.id} value={entry.id}>{entry.title}</option>)}
                          </select>
                        </label>
                        <label>参照状態
                          <select value={draft.reference_status} onChange={(event) => patchDraft(row.entry.id, { reference_status: event.target.value })}>
                            <option value="inbox">未整理</option>
                            <option value="keep">参照</option>
                            <option value="adopted">採用</option>
                            <option value="pending">再確認</option>
                            <option value="stale">古い</option>
                          </select>
                        </label>
                      </div>
                    )}
                    <label>説明・補足
                      <textarea value={draft.description} onChange={(event) => patchDraft(row.entry.id, { description: event.target.value })} />
                    </label>
                    <div className="form-actions">
                      <button className="secondary-button compact" onClick={() => item && openDrawer({ type: "item", entity: item })} disabled={!item}>詳細</button>
                      <button className="primary-button compact" onClick={() => organize(row)} disabled={!item}>整理する</button>
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
