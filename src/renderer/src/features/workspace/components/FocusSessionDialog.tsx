import { useEffect, useMemo, useRef, useState } from "react";
import {
  IconBook,
  IconCheck,
  IconClock,
  IconFile,
  IconFileText,
  IconLink,
  IconPlayerStop,
  IconX,
} from "@tabler/icons-react";

import {
  FOCUS_SESSION_ROLE,
  focusDocumentDraftKey,
  focusSessionDraftKey,
  focusSessionProperties,
  isFocusSession,
} from "../../../../../shared/focusSession.mjs";
import { todayIso } from "../../../utils/dataFormat.js";
import {
  buildSelectionExtractionOperations,
  markdownHeadingBeforeOffset,
  selectionTitleCandidate,
  type SelectionExtractionKind,
} from "../lib/selectionExtraction";
import { previewHtml } from "../lib/markdown";
import { buildSaveNoteOperations, buildSaveTaskOperations } from "../domain-model/persistence";
import type {
  Artifact,
  BaseRecord,
  OpenContentViewer,
  OpenDrawer,
  SaveEntities,
  SaveEntity,
  WorkspaceData,
} from "../types";
import type { RemoveEntity } from "../types";
import type { Note, Reference, Resource, Task, WorkspaceDomain } from "../domain-model/types";
import { ArtifactSection } from "./artifacts";
import { MarkdownPreview } from "./MarkdownPreview";

type FocusTarget = { type: "scratchpad" } | { type: "note"; id: string };
type SaveState = "saved" | "dirty" | "saving" | "error";

function text(value: unknown): string {
  return String(value || "");
}

function properties(record: BaseRecord | null): Record<string, unknown> {
  const value = record?.properties_json;
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function elapsedLabel(startedAt: unknown, now: number): string {
  const started = new Date(text(startedAt)).getTime();
  if (!Number.isFinite(started)) return "0分";
  const minutes = Math.max(0, Math.floor((now - started) / 60000));
  if (minutes < 60) return `${minutes}分`;
  return `${Math.floor(minutes / 60)}時間${minutes % 60}分`;
}

function uniqueById<T extends { id: string }>(records: T[]): T[] {
  return [...new Map(records.map((record) => [record.id, record])).values()];
}

function relatedToTask(
  task: Task,
  data: WorkspaceData,
  domain: WorkspaceDomain,
): { notes: BaseRecord[]; resources: Resource[]; artifacts: Artifact[] } {
  const refs = domain.references.filter(
    (reference) =>
      (reference.source_type === "task" && reference.source_id === task.id) ||
      (reference.target_type === "task" && reference.target_id === task.id),
  );
  const relatedIds = new Set(
    refs.map((reference) =>
      reference.source_type === "task"
        ? `${reference.target_type}:${reference.target_id}`
        : `${reference.source_type}:${reference.source_id}`,
    ),
  );
  const notes = uniqueById(
    data.notes.filter(
      (note) =>
        !isFocusSession(note) &&
        (relatedIds.has(`note:${note.id}`) ||
          note.item_id === task.id ||
          (note.properties_json as Record<string, unknown> | undefined)?.source_task_id ===
            task.id),
    ),
  );
  const resources = uniqueById(
    domain.resources.filter((resource) => relatedIds.has(`resource:${resource.id}`)),
  );
  const noteIds = new Set(notes.map((note) => note.id));
  const artifacts = uniqueById(
    data.artifacts.filter(
      (artifact) =>
        (artifact.source_type === "task" && artifact.source_id === task.id) ||
        ((artifact.source_type === "note" || artifact.source_type === "report") &&
          noteIds.has(artifact.source_id)),
    ),
  );
  return { notes, resources, artifacts };
}

export function FocusSessionDialog({
  task,
  session,
  data,
  domain,
  saveEntity,
  saveEntities,
  removeEntity,
  openDrawer,
  openContentViewer,
  setToast,
  close,
}: {
  task: Task;
  session: BaseRecord | null;
  data: WorkspaceData;
  domain: WorkspaceDomain;
  saveEntity: SaveEntity;
  saveEntities: SaveEntities;
  removeEntity: RemoveEntity;
  openDrawer: OpenDrawer;
  openContentViewer: OpenContentViewer;
  setToast: (message: string, tone?: "info" | "success" | "warning" | "danger") => void;
  close: () => void;
}) {
  const [target, setTarget] = useState<FocusTarget>({ type: "scratchpad" });
  const [scratchpad, setScratchpad] = useState("");
  const [documentBody, setDocumentBody] = useState("");
  const [markdownMode, setMarkdownMode] = useState<"edit" | "preview">("edit");
  const [saveState, setSaveState] = useState<SaveState>("saved");
  const [now, setNow] = useState(Date.now());
  const [endOpen, setEndOpen] = useState(false);
  const [completeTask, setCompleteTask] = useState(true);
  const [keepScratchpad, setKeepScratchpad] = useState(false);
  const [summary, setSummary] = useState("");
  const [nextTaskTitle, setNextTaskTitle] = useState("");
  const [ending, setEnding] = useState(false);
  const creating = useRef(false);
  const scratchpadRef = useRef<HTMLTextAreaElement | null>(null);
  const related = useMemo(() => relatedToTask(task, data, domain), [data, domain, task]);
  const selectedNote =
    target.type === "note" ? data.notes.find((note) => note.id === target.id) || null : null;
  const sessionId = session?.id || `task:${task.id}`;
  const sessionProps = focusSessionProperties(session);
  const recentActivity = data.status_updates
    .filter((entry) => !task.project_id || entry.theme_id === task.project_id)
    .sort((left, right) =>
      text(right.updated_at || right.created_at || right.date).localeCompare(
        text(left.updated_at || left.created_at || left.date),
      ),
    )
    .slice(0, 3);

  useEffect(() => {
    if (session || creating.current) return;
    creating.current = true;
    const startedAt = new Date().toISOString();
    const noteId = crypto.randomUUID();
    const referenceId = crypto.randomUUID();
    const initialBody = localStorage.getItem(focusSessionDraftKey(`task:${task.id}`)) || "";
    void saveEntities(
      [
        ...buildSaveNoteOperations(
          {
            id: noteId,
            title: `Focus Session: ${task.title}`,
            body_markdown: initialBody,
            note_type: "note",
            content_format: "markdown",
            project_id: task.project_id || null,
            properties_json: {
              document_role: FOCUS_SESSION_ROLE,
              session_state: "active",
              task_id: task.id,
              started_at: startedAt,
            },
          },
          { now: startedAt, reason: "focus_session_started" },
        ),
        {
          action: "save",
          type: "reference",
          entity: {
            id: referenceId,
            source_type: "note",
            source_id: noteId,
            target_type: "task",
            target_id: task.id,
            relation_type: "related_to",
            note: "Focus Session",
          },
          options: { source: "manual", reason: "focus_session_started" },
        },
      ],
      `「${task.title}」のFocus Sessionを開始しました。`,
    ).catch(() => {
      creating.current = false;
      setSaveState("error");
    });
  }, [saveEntities, session, task]);

  useEffect(() => {
    const draft =
      localStorage.getItem(focusSessionDraftKey(sessionId)) ??
      localStorage.getItem(focusSessionDraftKey(`task:${task.id}`));
    setScratchpad(draft ?? text(session?.body_markdown));
  }, [session?.id, sessionId, task.id]);

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 30000);
    return () => window.clearInterval(timer);
  }, []);

  /**
   * Escで表示だけを閉じる（#316）。closeはsetFocusTaskId(null)なので、
   * sessionは動いたまま残る。終了は「終了する」の明示操作だけが行う。
   */
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      // 終了確認を開いているときは、そちらを先に閉じる。
      if (endOpen) {
        event.preventDefault();
        setEndOpen(false);
        return;
      }
      event.preventDefault();
      close();
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [close, endOpen]);

  useEffect(() => {
    if (!session || scratchpad === text(session.body_markdown)) return;
    setSaveState("dirty");
    const body = scratchpad;
    const timer = window.setTimeout(() => {
      setSaveState("saving");
      void saveEntity(
        "note",
        { ...session, body_markdown: body },
        { reason: "focus_session_autosave", quiet: true },
      )
        .then(() => {
          localStorage.removeItem(focusSessionDraftKey(session.id));
          localStorage.removeItem(focusSessionDraftKey(`task:${task.id}`));
          setSaveState("saved");
        })
        .catch(() => setSaveState("error"));
    }, 450);
    return () => window.clearTimeout(timer);
  }, [saveEntity, scratchpad, session, task.id]);

  useEffect(() => {
    if (
      !session ||
      scratchpad !== text(session.body_markdown) ||
      localStorage.getItem(focusSessionDraftKey(session.id)) !== null ||
      localStorage.getItem(focusSessionDraftKey(`task:${task.id}`)) !== null
    )
      return;
    setSaveState((state) => (state === "dirty" ? "saved" : state));
  }, [scratchpad, session, task.id]);

  useEffect(() => {
    if (!selectedNote) {
      setDocumentBody("");
      return;
    }
    setDocumentBody(
      localStorage.getItem(focusDocumentDraftKey(selectedNote.id)) ??
        text(selectedNote.body_markdown),
    );
  }, [selectedNote?.id]);

  useEffect(() => {
    if (!selectedNote || documentBody === text(selectedNote.body_markdown)) return;
    setSaveState("dirty");
    const body = documentBody;
    const timer = window.setTimeout(() => {
      setSaveState("saving");
      void saveEntity(
        "note",
        { ...selectedNote, body_markdown: body },
        { reason: "focus_session_document_autosave", quiet: true },
      )
        .then(() => {
          localStorage.removeItem(focusDocumentDraftKey(selectedNote.id));
          setSaveState("saved");
        })
        .catch(() => setSaveState("error"));
    }, 600);
    return () => window.clearTimeout(timer);
  }, [documentBody, saveEntity, selectedNote]);

  useEffect(() => {
    if (
      !selectedNote ||
      documentBody !== text(selectedNote.body_markdown) ||
      localStorage.getItem(focusDocumentDraftKey(selectedNote.id)) !== null
    )
      return;
    setSaveState((state) => (state === "dirty" ? "saved" : state));
  }, [documentBody, selectedNote]);

  function updateScratchpad(value: string) {
    setScratchpad(value);
    localStorage.setItem(focusSessionDraftKey(sessionId), value);
    setSaveState("dirty");
  }

  function updateDocument(value: string) {
    if (!selectedNote) return;
    setDocumentBody(value);
    localStorage.setItem(focusDocumentDraftKey(selectedNote.id), value);
    setSaveState("dirty");
  }

  async function extractScratchpad(kind: SelectionExtractionKind) {
    if (!session || !scratchpadRef.current) return;
    const start = scratchpadRef.current.selectionStart;
    const end = scratchpadRef.current.selectionEnd;
    const selected = scratchpad.slice(start, end).trim();
    if (!selected) {
      setToast("切り出す範囲を選択してください。", "warning");
      return;
    }
    const result = buildSelectionExtractionOperations(
      {
        kind,
        title: selectionTitleCandidate(selected),
        selection: { text: selected, heading: markdownHeadingBeforeOffset(scratchpad, start) },
        source: { id: session.id, title: text(session.title), projectId: task.project_id || null },
      },
      { entityId: crypto.randomUUID(), referenceId: crypto.randomUUID() },
    );
    await saveEntities(result.operations, `${kind === "task" ? "Task" : "Note"}へ切り出しました。`);
  }

  async function endSession() {
    if (!session) return;
    creating.current = true;
    setEnding(true);
    try {
      const endedAt = new Date().toISOString();
      const operations = [
        ...buildSaveNoteOperations(
          {
            ...session,
            body_markdown: keepScratchpad ? scratchpad : "",
            properties_json: {
              ...sessionProps,
              document_role: FOCUS_SESSION_ROLE,
              session_state: "ended",
              task_id: task.id,
              ended_at: endedAt,
              summary: summary.trim(),
            },
          } as Note,
          { now: endedAt, reason: "focus_session_ended" },
        ),
      ];
      if (selectedNote && documentBody !== text(selectedNote.body_markdown)) {
        operations.push(
          ...buildSaveNoteOperations(
            {
              ...selectedNote,
              body_markdown: documentBody,
            },
            { now: endedAt, reason: "focus_session_document_saved_on_end" },
          ),
        );
      }
      if (completeTask) {
        operations.push(
          ...buildSaveTaskOperations(
            {
              ...task,
              state: "done",
              completed_at: endedAt,
            },
            { now: endedAt, reason: "focus_session_completed_task" },
          ),
        );
      }
      if (keepScratchpad && scratchpad.trim()) {
        const noteId = crypto.randomUUID();
        operations.push(
          ...buildSaveNoteOperations(
            {
              id: noteId,
              title: `作業メモ: ${task.title}`,
              body_markdown: scratchpad,
              note_type: "note",
              content_format: "markdown",
              project_id: task.project_id || null,
              properties_json: { source_task_id: task.id, focus_session_id: session.id },
            },
            { now: endedAt, reason: "focus_session_scratchpad_promoted" },
          ),
          {
            action: "save",
            type: "reference",
            entity: {
              id: crypto.randomUUID(),
              source_type: "note",
              source_id: noteId,
              target_type: "task",
              target_id: task.id,
              relation_type: "related_to",
              note: "Focus Sessionの作業メモ",
            },
            options: { source: "manual", reason: "focus_session_scratchpad_promoted" },
          },
        );
      }
      if (nextTaskTitle.trim()) {
        operations.push(
          ...buildSaveTaskOperations(
            {
              id: crypto.randomUUID(),
              project_id: task.project_id || null,
              parent_task_id: task.id,
              title: nextTaskTitle.trim(),
              state: "todo",
              priority: "normal",
              created_at: endedAt,
            },
            { now: endedAt, reason: "focus_session_next_task" },
          ),
        );
      }
      if (task.project_id) {
        operations.push({
          action: "save",
          type: "status_update",
          entity: {
            id: crypto.randomUUID(),
            theme_id: task.project_id,
            date: todayIso(),
            status: "on_track",
            summary: `Focus: ${task.title}${summary.trim() ? ` — ${summary.trim()}` : ""}`,
          },
          options: { source: "manual", reason: "focus_session_summary" },
        });
      }
      await saveEntities(
        operations,
        completeTask
          ? "Focus Sessionを終了し、Taskを完了しました。"
          : "Focus Sessionを終了しました。",
      );
      localStorage.removeItem(focusSessionDraftKey(session.id));
      localStorage.removeItem(focusSessionDraftKey(`task:${task.id}`));
      close();
    } finally {
      setEnding(false);
    }
  }

  const statusLabel =
    saveState === "saved"
      ? "保存済み"
      : saveState === "saving"
        ? "保存中"
        : saveState === "error"
          ? "保存エラー"
          : "保存待ち";

  return (
    // 表示だけを閉じる（#316）。sessionは動いたままで、終了は明示操作にする。
    <div
      className="focus-session-backdrop"
      role="presentation"
      onPointerDown={(event) => {
        if (event.target === event.currentTarget) close();
      }}
    >
      <section
        className="focus-session-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="focus-session-title"
      >
        <header>
          <div className="focus-session-heading">
            <span>FOCUS SESSION</span>
            <h2 id="focus-session-title">{task.title}</h2>
          </div>
          <div className="focus-session-meta">
            <span>
              <IconClock size={15} />
              {elapsedLabel(sessionProps.started_at, now)}
            </span>
            <span className={`is-${saveState}`}>
              {saveState === "saved" && <IconCheck size={14} />}
              {statusLabel}
            </span>
            <button className="secondary-button compact" onClick={() => setEndOpen(true)}>
              <IconPlayerStop size={15} />
              終了
            </button>
            <button className="icon-button" onClick={close} aria-label="Focus Sessionを閉じる">
              <IconX size={18} />
            </button>
          </div>
        </header>
        <div className="focus-session-layout">
          <aside className="focus-session-context">
            <section>
              <span>Task</span>
              <p>{task.description || "説明なし"}</p>
              <button
                className="text-button compact"
                onClick={() => openDrawer({ type: "task", entity: task as unknown as BaseRecord })}
              >
                詳細を開く
              </button>
            </section>
            {session && (
              <ArtifactSection
                sourceType="note"
                sourceId={session.id}
                themeId={task.project_id || null}
                artifacts={data.artifacts || []}
                data={data}
                openDrawer={openDrawer}
                openContentViewer={openContentViewer}
                saveEntities={saveEntities}
                removeEntity={removeEntity}
                setToast={setToast}
              />
            )}
            <section>
              <span>Related</span>
              <button
                className={target.type === "scratchpad" ? "is-active" : ""}
                onClick={() => {
                  setTarget({ type: "scratchpad" });
                  setMarkdownMode("edit");
                }}
              >
                <IconBook size={15} />
                Session Scratchpad
              </button>
              {related.notes.map((note) => (
                <button
                  key={note.id}
                  className={target.type === "note" && target.id === note.id ? "is-active" : ""}
                  onClick={() => {
                    setTarget({ type: "note", id: note.id });
                    setMarkdownMode("edit");
                  }}
                >
                  <IconFileText size={15} />
                  {text(note.title) || "無題"}
                </button>
              ))}
              {related.artifacts.map((artifact) => (
                <button
                  key={artifact.id}
                  onClick={() => openContentViewer({ type: "artifact", artifactId: artifact.id })}
                >
                  <IconFile size={15} />
                  {artifact.title}
                </button>
              ))}
              {related.resources.map((resource) => (
                <a key={resource.id} href={resource.url || "#"} target="_blank" rel="noreferrer">
                  <IconLink size={15} />
                  {resource.title}
                </a>
              ))}
            </section>
            {recentActivity.length > 0 && (
              <section className="focus-session-activity">
                <span>Recent Activity</span>
                {recentActivity.map((entry) => (
                  <p key={entry.id}>{text(entry.summary || entry.next_actions || entry.risks)}</p>
                ))}
              </section>
            )}
          </aside>
          <main className="focus-session-work">
            {target.type === "scratchpad" ? (
              <>
                <div className="focus-session-toolbar">
                  <strong>Session Scratchpad</strong>
                  <div>
                    <div className="segmented" aria-label="Session Scratchpadの表示">
                      <button
                        type="button"
                        className={markdownMode === "edit" ? "is-active" : ""}
                        onClick={() => setMarkdownMode("edit")}
                      >
                        Edit
                      </button>
                      <button
                        type="button"
                        className={markdownMode === "preview" ? "is-active" : ""}
                        onClick={() => setMarkdownMode("preview")}
                      >
                        Preview
                      </button>
                    </div>
                    <button
                      className="secondary-button compact"
                      disabled={markdownMode !== "edit"}
                      onClick={() => void extractScratchpad("task")}
                    >
                      選択をTaskへ
                    </button>
                    <button
                      className="secondary-button compact"
                      disabled={markdownMode !== "edit"}
                      onClick={() => void extractScratchpad("note")}
                    >
                      選択をNoteへ
                    </button>
                  </div>
                </div>
                {markdownMode === "preview" ? (
                  <MarkdownPreview
                    className="focus-session-markdown-preview markdown-preview"
                    html={previewHtml(scratchpad || "_まだ何も書いていません_", "markdown")}
                  />
                ) : (
                  <textarea
                    ref={scratchpadRef}
                    value={scratchpad}
                    onChange={(event) => updateScratchpad(event.target.value)}
                    placeholder="作業中の判断、途中結果、次に試すこと。終了時にNoteとして残せます。Markdownで書けます。"
                    aria-label="Session Scratchpad本文"
                  />
                )}
              </>
            ) : selectedNote ? (
              <>
                <div className="focus-session-toolbar">
                  <strong>{text(selectedNote.title) || "無題"}</strong>
                  <div>
                    <div className="segmented" aria-label="Note本文の表示">
                      <button
                        type="button"
                        className={markdownMode === "edit" ? "is-active" : ""}
                        onClick={() => setMarkdownMode("edit")}
                      >
                        Edit
                      </button>
                      <button
                        type="button"
                        className={markdownMode === "preview" ? "is-active" : ""}
                        onClick={() => setMarkdownMode("preview")}
                      >
                        Preview
                      </button>
                    </div>
                    <span>自動保存</span>
                  </div>
                </div>
                {markdownMode === "preview" ? (
                  <MarkdownPreview
                    className="focus-session-markdown-preview markdown-preview"
                    html={previewHtml(documentBody || "_本文はまだありません_", "markdown")}
                  />
                ) : (
                  <textarea
                    value={documentBody}
                    onChange={(event) => updateDocument(event.target.value)}
                    aria-label={`${text(selectedNote.title)}のMarkdown本文`}
                  />
                )}
              </>
            ) : (
              <p>文書が見つかりません。</p>
            )}
          </main>
        </div>
        {endOpen && (
          <div className="focus-session-end">
            <section>
              <div className="section-heading">
                <div>
                  <span>SESSION END</span>
                  <h3>作業を整理する</h3>
                </div>
                <button
                  className="icon-button"
                  onClick={() => setEndOpen(false)}
                  aria-label="終了整理を閉じる"
                >
                  <IconX size={17} />
                </button>
              </div>
              <label>
                <input
                  type="checkbox"
                  checked={completeTask}
                  onChange={(event) => setCompleteTask(event.target.checked)}
                />
                Taskを完了する
              </label>
              <label>
                <input
                  type="checkbox"
                  checked={keepScratchpad}
                  onChange={(event) => setKeepScratchpad(event.target.checked)}
                  disabled={!scratchpad.trim()}
                />
                ScratchpadをNoteとして残す
              </label>
              <label>
                <span>短い作業概要</span>
                <input
                  value={summary}
                  onChange={(event) => setSummary(event.target.value)}
                  placeholder="省略可。Activity Logへ記録します"
                />
              </label>
              <label>
                <span>次のTask</span>
                <input
                  value={nextTaskTitle}
                  onChange={(event) => setNextTaskTitle(event.target.value)}
                  placeholder="必要なときだけ入力"
                />
              </label>
              <footer>
                <button className="secondary-button" onClick={() => setEndOpen(false)}>
                  作業へ戻る
                </button>
                <button
                  className="primary-button"
                  disabled={ending || !session}
                  onClick={() => void endSession()}
                >
                  {ending ? "終了しています…" : "Sessionを終了"}
                </button>
              </footer>
            </section>
          </div>
        )}
      </section>
    </div>
  );
}
