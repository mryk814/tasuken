import { useEffect, useMemo, useState } from "react";
import { IconCalendarCheck, IconCheck, IconFlag, IconFlagFilled, IconRefresh } from "@tabler/icons-react";

import { todayIso } from "../../../utils/dataFormat.js";
import type { PageProps } from "../types";
import { themeColor, themeLabel } from "../lib/domain";
import { uuid } from "../lib/format";
import { EmptyState, PageHeader } from "../components/common";
import { buildInboxView } from "../domain-model/selectors";
import {
  buildSaveTaskOperations,
  buildSaveWaitingOperations,
  buildSaveScheduleOperations,
  buildSaveResourceOperations,
  buildSaveNoteOperations,
  buildTriageCaptureEntryOperations,
} from "../domain-model/persistence";
import type { CaptureEntry, Note as DomainNote, Resource, Schedule, Task, Waiting } from "../domain-model/types";
import type { SaveOperation } from "../types";

type InboxKind = "task" | "memo" | "link" | "waiting" | "idea";

const INBOX_KIND_OPTIONS: Array<[InboxKind, string]> = [
  ["task", "タスク"],
  ["memo", "メモ"],
  ["link", "リンク"],
  ["waiting", "待ち"],
  ["idea", "アイデア"],
];

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
  waiting_for: string;
}

interface InboxRow {
  entry: CaptureEntry;
}

function draftFromEntry(entry: CaptureEntry): InboxDraft {
  return {
    output: "task",
    title: entry.title || entry.text,
    theme_id: "",
    item_id: "",
    planned_end: "",
    today_flag: false,
    priority: "normal",
    description: entry.text,
    link_url: "",
    link_type: "chatgpt",
    reference_status: "inbox",
    waiting_for: "",
  };
}

export function InboxPage({ data, domain: v2, themes, openDrawer, saveEntity, saveEntities, refreshWorkspace, removeEntityQuiet, setToast }: PageProps) {
  const v2Tasks = v2.tasks;
  const inboxRows = useMemo(() => {
    return buildInboxView(v2).entries.map((entry) => ({ entry }));
  }, [v2]);
  const [drafts, setDrafts] = useState<Record<string, InboxDraft>>({});
  const [selected, setSelected] = useState<string[]>([]);
  const [refreshing, setRefreshing] = useState(false);
  const [organizing, setOrganizing] = useState<Record<string, boolean>>({});
  const [feedback, setFeedback] = useState("");
  const today = todayIso();

  useEffect(() => {
    setDrafts((current) => {
      const next = { ...current };
      for (const row of inboxRows) {
        if (!next[row.entry.id]) next[row.entry.id] = draftFromEntry(row.entry);
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
    const draft = drafts[row.entry.id] || draftFromEntry(row.entry);
    const title = draft.title.trim();
    if (!title) {
      setToast("タイトルを入力してください。入力内容は保持されています。");
      return;
    }
    if (draft.output === "link" && !draft.link_url.trim()) {
      setToast("リンクに整理するにはURLを入力してください。入力内容は保持されています。");
      return;
    }
    if (draft.output === "waiting" && !draft.waiting_for.trim()) {
      setToast("相手を入力してください。入力内容は保持されています。");
      return;
    }
    const themeId = draft.theme_id || null;
    const sourceRecordId = row.entry.source_record_id || null;

    try {
      setFeedback("");
      setOrganizing((current) => ({ ...current, [row.entry.id]: true }));
      if (draft.output === "task" || draft.output === "idea") {
        const taskId = crypto.randomUUID();
        const task: Task = {
          id: taskId,
          project_id: themeId,
          title,
          description: draft.description || null,
          state: "todo",
          priority: draft.priority === "high" ? "high" : "normal",
          source_record_id: sourceRecordId,
          created_at: new Date().toISOString(),
        };
        const ops: SaveOperation[] = [...buildSaveTaskOperations(task)];
        if (draft.planned_end || draft.today_flag) {
          const schedule: Schedule = {
            id: crypto.randomUUID(),
            owner_type: "task",
            owner_id: taskId,
            end_date: draft.planned_end || (draft.today_flag ? today : null),
            date_kind: "deadline",
            confidence: "tentative",
            granularity: "day",
          };
          ops.push(...buildSaveScheduleOperations(schedule));
        }
        ops.push(...buildTriageCaptureEntryOperations(row.entry, { type: "task", id: taskId }));
        await saveEntities(ops, "タスクに整理しました。");
        setFeedback("タスクに整理しました。");

      } else if (draft.output === "waiting") {
        const waitingId = crypto.randomUUID();
        const waiting: Waiting = {
          id: waitingId,
          project_id: themeId,
          title,
          waiting_for: draft.waiting_for.trim(),
          description: draft.description || null,
          state: "waiting",
          source_record_id: sourceRecordId,
          created_at: new Date().toISOString(),
        };
        const ops: SaveOperation[] = [...buildSaveWaitingOperations(waiting)];
        if (draft.planned_end) {
          const schedule: Schedule = {
            id: crypto.randomUUID(),
            owner_type: "waiting",
            owner_id: waitingId,
            end_date: draft.planned_end,
            date_kind: "deadline",
            confidence: "tentative",
            granularity: "day",
          };
          ops.push(...buildSaveScheduleOperations(schedule));
        }
        ops.push(...buildTriageCaptureEntryOperations(row.entry, { type: "waiting", id: waitingId }));
        await saveEntities(ops, "待ちに整理しました。");
        setFeedback("待ちに整理しました。");

      } else if (draft.output === "memo") {
        const noteId = uuid();
        const note: DomainNote = {
          id: noteId,
          title,
          body_markdown: draft.description || title,
          project_id: themeId,
          source_record_id: sourceRecordId,
        };
        const ops: SaveOperation[] = [
          ...buildSaveNoteOperations(note),
          ...buildTriageCaptureEntryOperations(row.entry, { type: "note", id: noteId }),
        ];
        await saveEntities(ops, "メモに整理しました。");
        setFeedback("メモに整理しました。");

      } else if (draft.output === "link") {
        const resourceId = uuid();
        const resource: Resource = {
          id: resourceId,
          title,
          url: draft.link_url.trim(),
          description: draft.description || null,
          project_id: themeId,
          source_record_id: sourceRecordId,
        };
        const ops: SaveOperation[] = [
          ...buildSaveResourceOperations(resource),
          ...buildTriageCaptureEntryOperations(row.entry, { type: "resource", id: resourceId }),
        ];
        await saveEntities(ops, "リンクに整理しました。");
        setFeedback("リンクに整理しました。");

      }
      setSelected((current) => current.filter((id) => id !== row.entry.id));
    } catch {
      // saveEntity側のtoastを使い、draftは消さない。
    } finally {
      setOrganizing((current) => {
        const next = { ...current };
        delete next[row.entry.id];
        return next;
      });
    }
  }

  function bulkPatch(patch: Partial<InboxDraft>) {
    setDrafts((current) => {
      const next = { ...current };
      for (const id of selected) {
        if (next[id]) next[id] = { ...next[id], ...patch };
      }
      return next;
    });
  }

  function toggleSelectAll() {
    if (selected.length === inboxRows.length) {
      setSelected([]);
    } else {
      setSelected(inboxRows.map((row) => row.entry.id));
    }
  }

  async function organizeSelected() {
    for (const id of selected) {
      const row = inboxRows.find((entry) => entry.entry.id === id);
      if (row) await organize(row);
    }
  }

  async function handleRefresh() {
    setRefreshing(true);
    try {
      await refreshWorkspace();
      setToast("Inboxを更新しました。");
    } catch (error) {
      setToast(`Inboxを更新できませんでした。${error instanceof Error ? error.message : String(error)}`);
    } finally {
      setRefreshing(false);
    }
  }

  return (
    <div className="page inbox-page">
      <PageHeader title="Inbox整理" subtitle="クイック記録を行の中で分類し、今日の作業やThemeへ接続します。">
        <button className="secondary-button" onClick={handleRefresh} disabled={refreshing}>
          <IconRefresh size={16} /> {refreshing ? "更新中" : "更新"}
        </button>
        <button className="secondary-button" onClick={() => openDrawer({ type: "capture_entry", mode: "edit", entity: { state: "untriaged", captured_at: new Date().toISOString().slice(0, 10) } })}>記録を追加</button>
        <button className="secondary-button" onClick={() => openDrawer({ type: "resource", mode: "edit", entity: { link_type: "chatgpt", reference_status: "inbox", captured_at: new Date().toISOString().slice(0, 10) } })}>チャットリンクを追加</button>
        <button className="primary-button" disabled={!selected.length} onClick={organizeSelected}>{selected.length ? `${selected.length}件を整理` : "選択して整理"}</button>
      </PageHeader>
      {selected.length > 0 && (
        <section className="panel inbox-bulk-toolbar">
          <label className="inbox-bulk-check">
            <input type="checkbox" checked={selected.length === inboxRows.length} onChange={toggleSelectAll} />
            {selected.length}件選択中
          </label>
          <label>種類
            <select defaultValue="" onChange={(e) => { if (e.target.value) bulkPatch({ output: e.target.value as InboxKind }); e.target.value = ""; }}>
              <option value="" disabled>一括変更</option>
              <option value="task">タスク</option>
              <option value="memo">メモ</option>
              <option value="link">リンク</option>
              <option value="waiting">待ち</option>
              <option value="idea">アイデア</option>
            </select>
          </label>
          <label>Theme
            <select defaultValue="" onChange={(e) => { if (e.target.value === "__clear") bulkPatch({ theme_id: "" }); else if (e.target.value) bulkPatch({ theme_id: e.target.value }); e.target.value = ""; }}>
              <option value="" disabled>一括変更</option>
              <option value="__clear">個人業務</option>
              {themes.map((theme) => <option key={theme.id} value={theme.id}>{themeLabel(theme)}</option>)}
            </select>
          </label>
          <label>予定日
            <input type="date" defaultValue="" onChange={(e) => { if (e.target.value) bulkPatch({ planned_end: e.target.value }); }} />
          </label>
          <button className="secondary-button compact" onClick={() => bulkPatch({ today_flag: true, planned_end: today })}>今日やる</button>
          <button className="secondary-button compact" onClick={() => bulkPatch({ priority: "high" })}>優先</button>
          <button className="primary-button compact" onClick={organizeSelected}>一括整理</button>
        </section>
      )}
      <section className="panel inbox-panel">
        <div className="section-heading">
          <h2>未整理</h2>
          <span>{inboxRows.length}件</span>
        </div>
        {feedback && (
          <div className="inbox-feedback" role="status" aria-live="polite">
            <IconCheck size={16} />
            {feedback}
          </div>
        )}
        {inboxRows.length ? (
          <div className="inbox-list">
            {inboxRows.map((row) => {
              const draft = drafts[row.entry.id] || draftFromEntry(row.entry);
              const isOrganizing = Boolean(organizing[row.entry.id]);
              return (
                <div className={`inbox-card ${isOrganizing ? "is-organizing" : ""}`} key={row.entry.id}>
                  <div className="inbox-card-main">
                    <input
                      type="checkbox"
                      checked={selected.includes(row.entry.id)}
                      onChange={(event) => setSelected((current) => event.target.checked ? [...current, row.entry.id] : current.filter((id) => id !== row.entry.id))}
                      aria-label={`${draft.title}を選択`}
                    />
                    <div className="inbox-kind-picker" aria-label="種類">
                      {INBOX_KIND_OPTIONS.map(([value, label]) => (
                        <button
                          key={value}
                          type="button"
                          className={draft.output === value ? "is-selected" : ""}
                          onClick={() => patchDraft(row.entry.id, { output: value })}
                        >
                          {label}
                        </button>
                      ))}
                    </div>
                    <label className="inbox-title-field">タイトル
                      <input value={draft.title} onChange={(event) => patchDraft(row.entry.id, { title: event.target.value })} />
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
                    <div className="inbox-theme-field">
                      <span>Theme</span>
                      <div className="inbox-theme-picker" aria-label="Theme">
                        <button
                          type="button"
                          className={`theme-chip ${!draft.theme_id ? "is-selected" : ""}`}
                          onClick={() => patchDraft(row.entry.id, { theme_id: "" })}
                        >
                          個人業務
                        </button>
                        {themes.map((theme, index) => (
                          <button
                            key={theme.id}
                            type="button"
                            className={`theme-chip ${draft.theme_id === theme.id ? "is-selected" : ""}`}
                            style={{ "--chip-color": `var(--color-${themeColor(theme, index)})` } as React.CSSProperties}
                            onClick={() => patchDraft(row.entry.id, { theme_id: theme.id })}
                          >
                            <span className="chip-dot" />
                            {themeLabel(theme)}
                          </button>
                        ))}
                      </div>
                    </div>
                    {draft.output === "waiting" && (
                      <div className="inbox-waiting-fields">
                        <label>相手
                          <input value={draft.waiting_for} onChange={(event) => patchDraft(row.entry.id, { waiting_for: event.target.value })} placeholder="例: 田中さん、外注先A" />
                        </label>
                      </div>
                    )}
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
                            {v2Tasks
                              .filter((t) => !draft.theme_id || t.project_id === draft.theme_id)
                              .map((t) => <option key={t.id} value={t.id}>{t.title}</option>)}
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
                      <button className="secondary-button compact" onClick={() => openDrawer({ type: "capture_entry", mode: "edit", entity: row.entry as unknown as Record<string, unknown> })}>編集</button>
                      <button className="primary-button compact" disabled={isOrganizing} onClick={() => organize(row)}>
                        {isOrganizing ? "整理中..." : "整理する"}
                      </button>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
          <EmptyState title="未整理の記録はありません" action="記録を追加" onAction={() => openDrawer({ type: "capture_entry", mode: "edit", entity: { state: "untriaged", captured_at: new Date().toISOString().slice(0, 10) } })} />
        )}
      </section>
    </div>
  );
}
