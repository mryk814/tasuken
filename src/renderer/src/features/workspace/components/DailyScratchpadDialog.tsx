import { useEffect, useMemo, useRef, useState } from "react";
import {
  IconArrowRight,
  IconCalendar,
  IconCheck,
  IconFileText,
  IconSearch,
  IconX,
} from "@tabler/icons-react";

import {
  DAILY_SCRATCHPAD_ROLE,
  dailyScratchpadDate,
  dailyScratchpadDraftKey,
  dailyScratchpadProperties,
  dailyScratchpadTitle,
  filterDailyScratchpads,
} from "../../../../../shared/dailyScratchpad.mjs";
import {
  buildSelectionExtractionOperations,
  markdownHeadingBeforeOffset,
  selectionTitleCandidate,
  type SelectionExtractionKind,
} from "../lib/selectionExtraction";
import { renderMarkdownPreview } from "../lib/markdown";
import { MarkdownPreview } from "./MarkdownPreview";
import type { Reference, Task } from "../domain-model/types";
import type { BaseRecord, OpenDrawer, SaveEntities, SaveEntity } from "../types";

const LIST_LIMIT = 200;
const AUTO_SAVE_DELAY = 450;

function bodyOf(record: BaseRecord | null): string {
  return String(record?.body_markdown || "");
}

export function DailyScratchpadDialog({
  initialDate,
  today,
  notes,
  tasks,
  references,
  saveEntity,
  saveEntities,
  openDrawer,
  setToast,
  close,
}: {
  initialDate: string;
  today: string;
  notes: BaseRecord[];
  tasks: Task[];
  references: Reference[];
  saveEntity: SaveEntity;
  saveEntities: SaveEntities;
  openDrawer: OpenDrawer;
  setToast: (message: string, tone?: "info" | "success" | "warning" | "danger") => void;
  close: () => void;
}) {
  const [activeDate, setActiveDate] = useState(initialDate);
  const [query, setQuery] = useState("");
  const [body, setBody] = useState("");
  const [saveState, setSaveState] = useState<"creating" | "saved" | "dirty" | "saving" | "error">("creating");
  const [error, setError] = useState("");
  const [extracting, setExtracting] = useState(false);
  /** 本文はMarkdownが正本。書いた結果を確認できるようにする（#316）。 */
  const [mode, setMode] = useState<"edit" | "preview">("edit");
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const creatingDates = useRef(new Set<string>());
  const pads = useMemo(() => filterDailyScratchpads(notes), [notes]);
  const filteredPads = useMemo(() => filterDailyScratchpads(notes, query), [notes, query]);
  const current = pads.find((record: BaseRecord) => dailyScratchpadDate(record) === activeDate) || null;
  const derivedItems = useMemo(() => references
    .filter((reference) => reference.target_type === "note"
      && reference.target_id === current?.id
      && reference.relation_type === "derived_from")
    .map((reference) => {
      if (reference.source_type === "task") {
        const task = tasks.find((entry) => entry.id === reference.source_id);
        return task ? { type: "task" as const, record: task as unknown as BaseRecord } : null;
      }
      if (reference.source_type === "note") {
        const note = notes.find((entry) => entry.id === reference.source_id);
        return note ? { type: "note" as const, record: note } : null;
      }
      return null;
    })
    .filter((entry): entry is { type: "task" | "note"; record: BaseRecord } => Boolean(entry)), [current?.id, notes, references, tasks]);

  useEffect(() => {
    const previousFocus = document.activeElement as HTMLElement | null;
    const frame = window.requestAnimationFrame(() => textareaRef.current?.focus());
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      close();
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      window.cancelAnimationFrame(frame);
      document.removeEventListener("keydown", handleKeyDown);
      window.requestAnimationFrame(() => previousFocus?.focus?.({ preventScroll: true }));
    };
  }, [close]);

  useEffect(() => {
    const draft = localStorage.getItem(dailyScratchpadDraftKey(activeDate));
    setBody(draft ?? bodyOf(current));
    setError("");
    setSaveState(current ? (draft == null ? "saved" : "dirty") : "creating");
  }, [activeDate, current?.id]);

  useEffect(() => {
    if (current || creatingDates.current.has(activeDate)) return;
    creatingDates.current.add(activeDate);
    setSaveState("creating");
    void saveEntity("note", {
      id: crypto.randomUUID(),
      title: dailyScratchpadTitle(activeDate),
      body_markdown: localStorage.getItem(dailyScratchpadDraftKey(activeDate)) || "",
      note_type: "note",
      content_format: "markdown",
      theme_id: null,
      properties_json: {
        document_role: DAILY_SCRATCHPAD_ROLE,
        scratchpad_date: activeDate,
        ai_export_enabled: false,
      },
    }, { reason: "daily_scratchpad_create" }).catch((cause: unknown) => {
      creatingDates.current.delete(activeDate);
      setSaveState("error");
      setError(`Scratchpadを作成できませんでした。${cause instanceof Error ? cause.message : String(cause)}`);
    });
  }, [activeDate, current, saveEntity]);

  useEffect(() => {
    if (!current || body === bodyOf(current)) return;
    setSaveState("dirty");
    const date = activeDate;
    const nextBody = body;
    const timer = window.setTimeout(() => {
      setSaveState("saving");
      const properties = dailyScratchpadProperties(current);
      void saveEntity("note", {
        ...current,
        body_markdown: nextBody,
        properties_json: {
          ...properties,
          document_role: DAILY_SCRATCHPAD_ROLE,
          scratchpad_date: date,
        },
      }, { reason: "daily_scratchpad_autosave", quiet: true })
        .then(() => {
          if (localStorage.getItem(dailyScratchpadDraftKey(date)) === nextBody) {
            localStorage.removeItem(dailyScratchpadDraftKey(date));
          }
          setSaveState("saved");
          setError("");
        })
        .catch((cause: unknown) => {
          setSaveState("error");
          setError(`自動保存できませんでした。入力はこの端末に退避しています。${cause instanceof Error ? cause.message : String(cause)}`);
        });
    }, AUTO_SAVE_DELAY);
    return () => window.clearTimeout(timer);
  }, [activeDate, body, current, saveEntity]);

  useEffect(() => {
    if (!current || body !== bodyOf(current) || localStorage.getItem(dailyScratchpadDraftKey(activeDate)) != null) return;
    setSaveState((state) => state === "dirty" ? "saved" : state);
  }, [activeDate, body, current]);

  function updateBody(value: string) {
    setBody(value);
    localStorage.setItem(dailyScratchpadDraftKey(activeDate), value);
    setSaveState("dirty");
  }

  function moveToDate(date: string) {
    setActiveDate(date);
    window.requestAnimationFrame(() => textareaRef.current?.focus());
  }

  async function extractSelection(kind: SelectionExtractionKind) {
    if (!current || !textareaRef.current) return;
    const start = textareaRef.current.selectionStart;
    const end = textareaRef.current.selectionEnd;
    const text = body.slice(start, end).trim();
    if (!text) {
      setToast("切り出す範囲を選択してください。", "warning");
      textareaRef.current.focus();
      return;
    }
    setExtracting(true);
    try {
      const result = buildSelectionExtractionOperations({
        kind,
        title: selectionTitleCandidate(text),
        selection: {
          text,
          heading: markdownHeadingBeforeOffset(body, start),
        },
        source: {
          id: current.id,
          title: String(current.title || dailyScratchpadTitle(activeDate)),
          projectId: null,
        },
      }, {
        entityId: crypto.randomUUID(),
        referenceId: crypto.randomUUID(),
      });
      await saveEntities(result.operations, `${kind === "task" ? "Task" : "Note"}へ切り出しました。元のScratchpadは残しています。`);
    } finally {
      setExtracting(false);
    }
  }

  const saveLabel = saveState === "saved"
    ? "保存済み"
    : saveState === "saving"
      ? "保存中"
      : saveState === "creating"
        ? "準備中"
        : saveState === "error"
          ? "要確認"
          : "保存待ち";

  return (
    <div className="scratchpad-backdrop" role="presentation" onPointerDown={(event) => {
      if (event.target === event.currentTarget) close();
    }}>
      <section className="scratchpad-dialog" role="dialog" aria-modal="true" aria-labelledby="scratchpad-title">
        <header>
          <div>
            <span>Daily Scratchpad</span>
            <h2 id="scratchpad-title">{activeDate}</h2>
          </div>
          <div className="scratchpad-header-actions">
            {activeDate !== today && (
              <button className="secondary-button compact" onClick={() => moveToDate(today)}>
                <IconCalendar size={15} />今日へ
              </button>
            )}
            <span className={`scratchpad-save-state is-${saveState}`}>
              {saveState === "saved" && <IconCheck size={14} />}
              {saveLabel}
            </span>
            <button className="icon-button" onClick={close} aria-label="Daily Scratchpadを閉じる"><IconX size={18} /></button>
          </div>
        </header>
        <div className="scratchpad-layout">
          <aside className="scratchpad-history">
            <label className="scratchpad-search">
              <IconSearch size={15} />
              <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="過去の紙を検索" />
            </label>
            <div className="scratchpad-date-list">
              {filteredPads.slice(0, LIST_LIMIT).map((record: BaseRecord) => {
                const date = dailyScratchpadDate(record);
                return (
                  <button key={record.id} className={date === activeDate ? "is-active" : ""} onClick={() => moveToDate(date)}>
                    <strong>{date}</strong>
                    <span>{bodyOf(record).replace(/\s+/g, " ").trim() || "まだ何も書いていません"}</span>
                  </button>
                );
              })}
              {!filteredPads.length && <p>一致するScratchpadはありません。</p>}
            </div>
            {filteredPads.length > LIST_LIMIT && <small>先頭{LIST_LIMIT}件を表示中 / {filteredPads.length}件</small>}
          </aside>
          <main className="scratchpad-editor">
            {/*
              本文はMarkdownが正本（#316）。見出し・チェックリスト・コード・リンクを
              そのまま書けるので、書いた結果を確認できるようPreviewを用意する。
            */}
            <div className="scratchpad-toolbar">
              <div className="segmented" aria-label="Scratchpadの表示">
                <button className={mode === "edit" ? "is-active" : ""} onClick={() => setMode("edit")}>Edit</button>
                <button className={mode === "preview" ? "is-active" : ""} onClick={() => setMode("preview")}>Preview</button>
              </div>
              <div>
                <button
                  className="secondary-button compact"
                  disabled={extracting || !current || mode !== "edit"}
                  onClick={() => void extractSelection("task")}
                >
                  選択をTaskへ
                </button>
              </div>
              <span>Activity Logには全文転記されません</span>
            </div>
            {mode === "preview" ? (
              <MarkdownPreview
                className="scratchpad-preview markdown-preview"
                html={renderMarkdownPreview(body || "_まだ何も書いていません_")}
              />
            ) : (
              <textarea
                ref={textareaRef}
                value={body}
                onChange={(event) => updateBody(event.target.value)}
                placeholder="思いつき、途中の計算、URL、AIへの依頼文。分類せず、そのまま書けます。Markdownで書けます。"
                aria-label={`${activeDate}のDaily Scratchpad本文`}
                disabled={saveState === "creating" && !current}
              />
            )}
            {error && <p className="scratchpad-error" role="alert">{error}</p>}
            {derivedItems.length > 0 && (
              <section className="scratchpad-derived">
                <h3>ここから切り出したもの</h3>
                <div>
                  {derivedItems.map((entry) => (
                    <button key={`${entry.type}:${entry.record.id}`} onClick={() => openDrawer({ type: entry.type, entity: entry.record })}>
                      {entry.type === "task" ? <IconArrowRight size={14} /> : <IconFileText size={14} />}
                      <span>{String(entry.record.title || "無題")}</span>
                    </button>
                  ))}
                </div>
              </section>
            )}
          </main>
        </div>
      </section>
    </div>
  );
}
