import { useEffect, useMemo, useState } from "react";
import {
  IconArrowRight,
  IconCalendarCheck,
  IconCheck,
  IconCopy,
  IconExternalLink,
  IconFlag,
  IconFlagFilled,
  IconInbox,
  IconPencil,
  IconTrash,
} from "@tabler/icons-react";

import { workspaceApi } from "../../../services/workspaceApi";
import { todayIso } from "../../../utils/dataFormat.js";
import type { PageProps } from "../types";
import { inferChatServiceFromUrl } from "../lib/chatServices";
import { themeColor } from "../lib/domain";
import { formatDate, uuid } from "../lib/format";
import { EmptyState, PageHeader } from "../components/common";
import { buildInboxView, buildMicroMemoView } from "../domain-model/selectors";
import {
  buildSaveTaskOperations,
  buildSaveWaitingOperations,
  buildSaveScheduleOperations,
  buildSaveResourceOperations,
  buildSaveNoteOperations,
  buildTriageCaptureEntryOperations,
  buildSendMicroMemoToInboxOperations,
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

type InboxLane = "untriaged" | "micro";

type OrganizedTargetType = "task" | "waiting" | "note" | "resource";
type OrganizedEntity = Task | Waiting | DomainNote | Resource;

interface OrganizedResult {
  id: string;
  targetType: OrganizedTargetType;
  targetId: string;
  title: string;
  label: string;
  route: string;
  entity: OrganizedEntity;
  schedule?: Schedule;
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
    link_type: "",
    reference_status: "inbox",
    waiting_for: "",
  };
}

function routeForTarget(type: OrganizedTargetType): string {
  if (type === "task") return "todo";
  if (type === "waiting") return "waiting";
  if (type === "note") return "notes";
  return "chat-refs";
}

function labelForTarget(type: OrganizedTargetType): string {
  if (type === "task") return "タスク";
  if (type === "waiting") return "待ち";
  if (type === "note") return "メモ";
  return "リンク";
}

function copyTextForTarget(result: OrganizedResult): string {
  if (result.targetType === "resource") {
    const resource = result.entity as Resource;
    return [resource.title, resource.url, resource.description].filter(Boolean).join("\n");
  }
  if (result.targetType === "note") {
    const note = result.entity as DomainNote;
    return [`# ${note.title}`, note.body_markdown || ""].filter(Boolean).join("\n\n");
  }
  const description = "description" in result.entity ? result.entity.description : "";
  return [result.title, description].filter(Boolean).join("\n");
}

export function InboxPage({ domain: v2, themes, openDrawer, navigate, saveEntities, removeEntity, setToast }: PageProps) {
  const v2Tasks = v2.tasks;
  const inboxRows = useMemo(() => {
    return buildInboxView(v2).entries.map((entry) => ({ entry }));
  }, [v2]);
  const microMemoRows = useMemo(() => buildMicroMemoView(v2).entries, [v2]);
  const [lane, setLane] = useState<InboxLane>("untriaged");
  const [drafts, setDrafts] = useState<Record<string, InboxDraft>>({});
  const [selected, setSelected] = useState<string[]>([]);
  const [organizing, setOrganizing] = useState<Record<string, boolean>>({});
  const [feedback, setFeedback] = useState("");
  const [recentOrganized, setRecentOrganized] = useState<OrganizedResult[]>([]);
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

  function rememberOrganized(targetType: OrganizedTargetType, targetId: string, title: string, entity: OrganizedEntity, schedule?: Schedule) {
    const result: OrganizedResult = {
      id: `${targetType}:${targetId}`,
      targetType,
      targetId,
      title,
      label: labelForTarget(targetType),
      route: routeForTarget(targetType),
      entity,
      schedule,
    };
    setFeedback(`${result.label}「${title}」に整理しました。`);
    setRecentOrganized((current) => [
      result,
      ...current.filter((entry) => entry.id !== result.id),
    ].slice(0, 5));
  }

  function openOrganized(result: OrganizedResult) {
    const entity = result.targetType === "task" || result.targetType === "waiting"
      ? { ...result.entity, _schedule: result.schedule }
      : result.entity;
    openDrawer({ type: result.targetType, mode: "edit", entity: entity as unknown as Record<string, unknown> });
  }

  function copyOrganized(result: OrganizedResult) {
    workspaceApi.copyText(copyTextForTarget(result))
      .then(() => setToast(`${result.label}をコピーしました。`))
      .catch((error) => setToast(`コピーできませんでした。${error instanceof Error ? error.message : String(error)}`));
  }

  function copyMicroMemo(memo: CaptureEntry) {
    const body = [memo.title, memo.text].filter(Boolean).join("\n");
    workspaceApi.copyText(body)
      .then(() => setToast("付箋メモをコピーしました。"))
      .catch((error) => setToast(`コピーできませんでした。${error instanceof Error ? error.message : String(error)}`));
  }

  async function sendMicroMemoToInbox(memo: CaptureEntry) {
    await saveEntities(buildSendMicroMemoToInboxOperations(memo), "Inboxへ送りました。Inboxで整理できます。");
    setLane("untriaged");
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
        let schedule: Schedule | undefined;
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
          schedule = {
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
        await saveEntities(ops, `タスク「${title}」に整理しました。`);
        rememberOrganized("task", taskId, title, task, schedule);

      } else if (draft.output === "waiting") {
        const waitingId = crypto.randomUUID();
        let schedule: Schedule | undefined;
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
          schedule = {
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
        await saveEntities(ops, `待ち「${title}」に整理しました。`);
        rememberOrganized("waiting", waitingId, title, waiting, schedule);

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
        await saveEntities(ops, `メモ「${title}」に整理しました。`);
        rememberOrganized("note", noteId, title, note);

      } else if (draft.output === "link") {
        const resourceId = uuid();
        const inferredLinkType = inferChatServiceFromUrl(draft.link_url);
        const linkType = draft.link_type || (inferredLinkType !== "other" ? inferredLinkType : null);
        const resource: Resource = {
          id: resourceId,
          title,
          url: draft.link_url.trim(),
          description: draft.description || null,
          project_id: themeId,
          source_record_id: sourceRecordId,
          link_type: linkType,
          reference_status: linkType ? draft.reference_status : null,
        };
        const ops: SaveOperation[] = [
          ...buildSaveResourceOperations(resource),
          ...buildTriageCaptureEntryOperations(row.entry, { type: "resource", id: resourceId }),
        ];
        if (draft.item_id) {
          ops.push({
            action: "save",
            type: "reference",
            entity: {
              id: uuid(),
              source_type: "resource",
              source_id: resourceId,
              target_type: "task",
              target_id: draft.item_id,
              relation_type: "related_to",
            },
          });
        }
        await saveEntities(ops, `リンク「${title}」に整理しました。`);
        rememberOrganized("resource", resourceId, title, resource);

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

  async function deleteEntry(row: InboxRow) {
    setSelected((current) => current.filter((id) => id !== row.entry.id));
    await removeEntity("capture_entry", row.entry as unknown as Record<string, unknown>);
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

  return (
    <div className="page inbox-page">
      <PageHeader title="Inbox整理" subtitle="クイック記録を行の中で分類し、今日の作業やThemeへ接続します。">
        <button className="secondary-button" onClick={() => openDrawer({ type: "capture_entry", mode: "edit", entity: { state: "untriaged", captured_at: new Date().toISOString().slice(0, 10) } })}>記録を追加</button>
        <button className="secondary-button" onClick={() => openDrawer({ type: "resource", mode: "edit", entity: { reference_status: "inbox", captured_at: new Date().toISOString().slice(0, 10) } })}>チャットリンクを追加</button>
        <button className="primary-button" disabled={!selected.length} onClick={organizeSelected}>{selected.length ? `${selected.length}件を整理` : "選択して整理"}</button>
      </PageHeader>
      <div className="hub-tabs inbox-tabs" aria-label="Inboxレーン">
        <button className={lane === "untriaged" ? "is-active" : ""} aria-current={lane === "untriaged" ? "page" : undefined} onClick={() => setLane("untriaged")}>
          未整理 <span>{inboxRows.length}</span>
        </button>
        <button className={lane === "micro" ? "is-active" : ""} aria-current={lane === "micro" ? "page" : undefined} onClick={() => setLane("micro")}>
          付箋メモ <span>{microMemoRows.length}</span>
        </button>
      </div>
      {lane === "untriaged" && selected.length > 0 && (
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
              {themes.map((theme) => <option key={theme.id} value={theme.id}>{theme.name}</option>)}
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
      {lane === "untriaged" ? <section className="panel inbox-panel">
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
        {recentOrganized.length > 0 && (
          <div className="inbox-organized-history" aria-label="最近整理した項目">
            {recentOrganized.map((result) => (
              <div className="inbox-organized-item" key={result.id}>
                <span className="inbox-organized-kind">{result.label}</span>
                <strong>{result.title}</strong>
                <div className="inbox-organized-actions">
                  <button className="text-button compact" onClick={() => openOrganized(result)}>
                    <IconExternalLink size={14} />開く
                  </button>
                  <button className="text-button compact" onClick={() => navigate(result.route)}>
                    <IconArrowRight size={14} />一覧へ
                  </button>
                  <button className="row-action-button" onClick={() => copyOrganized(result)} aria-label={`${result.title}をコピー`} title="コピー">
                    <IconCopy size={14} />
                  </button>
                </div>
              </div>
            ))}
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
                            {theme.name}
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
                            <option value="">URLから推定</option>
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
                            <option value="adopted">採用</option>
                          </select>
                        </label>
                      </div>
                    )}
                    <label>説明・補足
                      <textarea value={draft.description} onChange={(event) => patchDraft(row.entry.id, { description: event.target.value })} />
                    </label>
                    <div className="form-actions">
                      <button
                        className="row-action-button"
                        onClick={() => openDrawer({ type: "capture_entry", mode: "edit", entity: row.entry as unknown as Record<string, unknown> })}
                        aria-label={`${draft.title || "記録"}を編集`}
                        title="編集"
                      >
                        <IconPencil size={15} />
                      </button>
                      <button
                        className="row-action-button danger"
                        onClick={() => void deleteEntry(row)}
                        aria-label={`${draft.title || "記録"}を削除`}
                        title="削除"
                      >
                        <IconTrash size={15} />
                      </button>
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
      </section> : <section className="panel inbox-panel">
        <div className="section-heading">
          <h2>付箋メモ</h2>
          <span>{microMemoRows.length}件</span>
        </div>
        {microMemoRows.length ? (
          <div className="micro-memo-grid">
            {microMemoRows.map((memo) => (
              <article className="micro-memo-card" key={memo.id}>
                <div className="micro-memo-card-meta">
                  <time dateTime={memo.captured_at} title={`記録日 ${memo.captured_at}`}>記録 {formatDate(memo.captured_at)}</time>
                </div>
                {memo.title ? <>
                  <strong>{memo.title}</strong>
                  <p>{memo.text}</p>
                </> : <p>{memo.text}</p>}
                <div className="micro-memo-actions">
                  <button className="row-action-button" onClick={() => copyMicroMemo(memo)} aria-label="付箋メモをコピー" title="コピー"><IconCopy size={15} /></button>
                  <button className="row-action-button" onClick={() => openDrawer({ type: "capture_entry", mode: "edit", entity: memo as unknown as Record<string, unknown> })} aria-label="付箋メモを編集" title="編集"><IconPencil size={15} /></button>
                  <button className="row-action-button" onClick={() => void sendMicroMemoToInbox(memo)} aria-label="付箋メモをInboxへ送る" title="Inboxへ送る"><IconInbox size={15} /></button>
                  <button className="row-action-button danger" onClick={() => removeEntity("capture_entry", memo as unknown as Record<string, unknown>)} aria-label="付箋メモを削除" title="削除"><IconTrash size={15} /></button>
                </div>
              </article>
            ))}
          </div>
        ) : (
          <EmptyState title="付箋メモはありません" />
        )}
      </section>}
    </div>
  );
}
