import { useEffect, useMemo, useRef, useState } from "react";
import {
  IconArrowBackUp,
  IconCheck,
  IconCopy,
  IconDeviceFloppy,
  IconHistory,
  IconPlus,
  IconReplace,
  IconX,
} from "@tabler/icons-react";

import {
  addDraftSnapshot,
  addSourceDraft,
  buildDraftRerequest,
  normalizeDraftWorkspace,
} from "../../../../../shared/draftWorkspace.mjs";
import { workspaceApi } from "../../../services/workspaceApi";
import type { BaseRecord, Entity, SaveEntity, Theme } from "../types";
import { buildMarkdownDiffHunks, diffMarkdownLines, restoreMarkdownDiffHunk } from "../lib/markdownEditing";
import { str } from "../lib/format";
import { MarkdownPreview } from "./MarkdownPreview";
import { previewHtml } from "../lib/markdown";

interface DraftSource {
  id: string;
  body: string;
  created_at: string;
  ai_service: string;
  chat_url: string;
  instruction: string;
}

interface DraftSnapshot {
  id: string;
  label: string;
  body: string;
  created_at: string;
}

interface DraftWorkspace {
  version: number;
  active_source_id: string;
  sources: DraftSource[];
  snapshots: DraftSnapshot[];
  working_updated_at: string;
}
type DraftView = "source" | "edit" | "diff" | "history";

function propertiesOf(note: BaseRecord | null): Record<string, unknown> {
  const value = note?.properties_json;
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function noteWithoutProjection(note: BaseRecord): Record<string, unknown> {
  const { recordType: _recordType, ...entity } = note as BaseRecord & { recordType?: string };
  return entity;
}

export function DraftWorkspaceDialog({
  note,
  themes,
  activeThemeId,
  saveEntity,
  setToast,
  onSaved,
  close,
}: {
  note: BaseRecord | null;
  themes: Theme[];
  activeThemeId: string | null;
  saveEntity: SaveEntity;
  setToast: (message: string, tone?: "info" | "success" | "warning" | "danger") => void;
  onSaved: (note: Entity, workingBody: string) => void;
  close: () => void;
}) {
  const initialProperties = propertiesOf(note);
  const [currentNote, setCurrentNote] = useState<BaseRecord | null>(note);
  const [workspace, setWorkspace] = useState<DraftWorkspace>(() => normalizeDraftWorkspace(initialProperties.draft_workspace) as DraftWorkspace);
  const [workingBody, setWorkingBody] = useState(() => str(note?.body_markdown));
  const [title, setTitle] = useState(() => str(note?.title));
  const [themeId, setThemeId] = useState(() => str(note?.theme_id || note?.project_id || activeThemeId));
  const [view, setView] = useState<DraftView>(() => workspace.sources.length ? "edit" : "source");
  const [addingSource, setAddingSource] = useState(() => !workspace.sources.length);
  const [sourceBody, setSourceBody] = useState(() => workspace.sources.length ? "" : str(note?.body_markdown));
  const [aiService, setAiService] = useState("");
  const [chatUrl, setChatUrl] = useState("");
  const [instruction, setInstruction] = useState("");
  const [snapshotLabel, setSnapshotLabel] = useState("大幅修正前");
  const [rerequest, setRerequest] = useState("");
  const [undoStack, setUndoStack] = useState<string[]>([]);
  const [confirmReplace, setConfirmReplace] = useState(false);
  const [confirmClose, setConfirmClose] = useState(false);
  const [saving, setSaving] = useState(false);
  const firstFieldRef = useRef<HTMLInputElement | HTMLTextAreaElement | null>(null);
  const restoreFocusRef = useRef(true);
  const unsavedRef = useRef(false);
  const activeSource = workspace.sources.find((source) => source.id === workspace.active_source_id)
    || workspace.sources.at(-1)
    || null;
  const diffLines = useMemo(
    () => view === "diff" && activeSource ? diffMarkdownLines(activeSource.body, workingBody) : [],
    [activeSource, view, workingBody],
  );
  const diffHunks = useMemo(() => buildMarkdownDiffHunks(diffLines), [diffLines]);
  const dirty = currentNote ? workingBody !== str(currentNote.body_markdown) : Boolean(workingBody);
  const hasUnsavedInput = dirty || Boolean(sourceBody.trim()) || (!currentNote && Boolean(title.trim()));
  unsavedRef.current = hasUnsavedInput;

  useEffect(() => {
    const previousFocus = document.activeElement as HTMLElement | null;
    const frame = window.requestAnimationFrame(() => firstFieldRef.current?.focus());
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      closeDialog();
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      window.cancelAnimationFrame(frame);
      document.removeEventListener("keydown", handleKeyDown);
      if (restoreFocusRef.current) {
        window.requestAnimationFrame(() => previousFocus?.focus?.({ preventScroll: true }));
      }
    };
  }, [close]);

  function closeDialog(force = false, restoreFocus = true) {
    if (!force && unsavedRef.current) {
      setConfirmClose(true);
      return;
    }
    restoreFocusRef.current = restoreFocus;
    close();
  }

  function pushUndo(body: string) {
    setUndoStack((current) => [...current.slice(-19), body]);
  }

  function undoWorkingChange() {
    const previous = undoStack.at(-1);
    if (previous == null) return;
    setWorkingBody(previous);
    setUndoStack((current) => current.slice(0, -1));
    setToast("Draft Workspaceの変更を戻しました。", "info");
  }

  async function persist(nextWorkspace: DraftWorkspace, nextWorkingBody: string): Promise<Entity | null> {
    if (!nextWorkingBody.trim()) {
      setToast("Working Draftが空です。本文を入力してください。", "warning");
      return null;
    }
    if (!title.trim()) {
      setToast("文書タイトルを入力してください。", "warning");
      return null;
    }
    setSaving(true);
    try {
      const baseProperties = propertiesOf(currentNote);
      const entity = currentNote ? noteWithoutProjection(currentNote) : {};
      const saved = await saveEntity("note", {
        ...entity,
        title: title.trim(),
        body_markdown: nextWorkingBody,
        note_type: str(currentNote?.note_type) || "note",
        content_format: "markdown",
        project_id: themeId || null,
        properties_json: {
          ...baseProperties,
          source_draft: false,
          draft_workspace: {
            ...nextWorkspace,
            working_updated_at: new Date().toISOString(),
          },
        },
      }, { reason: currentNote ? "draft_workspace_update" : "draft_workspace_create" });
      setCurrentNote(saved);
      setWorkspace(normalizeDraftWorkspace((saved.properties_json as Record<string, unknown> | undefined)?.draft_workspace || nextWorkspace) as DraftWorkspace);
      setWorkingBody(nextWorkingBody);
      onSaved(saved, nextWorkingBody);
      return saved;
    } catch {
      return null;
    } finally {
      setSaving(false);
    }
  }

  async function saveSourceDraft() {
    if (!sourceBody.trim()) {
      setToast("AI原稿を貼り付けてください。", "warning");
      return;
    }
    if (chatUrl.trim()) {
      try {
        const url = new URL(chatUrl);
        if (!["http:", "https:"].includes(url.protocol)) throw new Error("unsupported protocol");
      } catch {
        setToast("元チャットURLはhttp://またはhttps://で入力してください。", "warning");
        return;
      }
    }
    const nextWorkspace = addSourceDraft(workspace, {
      id: crypto.randomUUID(),
      body: sourceBody,
      created_at: new Date().toISOString(),
      ai_service: aiService,
      chat_url: chatUrl,
      instruction,
    }) as DraftWorkspace;
    const nextWorking = currentNote ? workingBody : sourceBody;
    const saved = await persist(nextWorkspace, nextWorking);
    if (!saved) return;
    setSourceBody("");
    setAiService("");
    setChatUrl("");
    setInstruction("");
    setAddingSource(false);
    setView("edit");
    setToast(currentNote
      ? "新しいSource Draftを追加しました。Working Draftは上書きしていません。"
      : "Source DraftからWorking Draftを作成しました。", "success");
  }

  async function saveWorkingDraft() {
    const saved = await persist(workspace, workingBody);
    if (saved) setToast("Working Draftを通常のMarkdown文書として保存しました。", "success");
  }

  function adoptSourceHunk(index: number) {
    const hunk = diffHunks[index];
    if (!hunk) return;
    const next = restoreMarkdownDiffHunk(workingBody, hunk);
    if (next === workingBody) return;
    pushUndo(workingBody);
    setWorkingBody(next);
    setToast(`変更ブロック ${index + 1} をSource側へ戻しました。`, "info");
  }

  function replaceWithSource() {
    if (!activeSource) return;
    pushUndo(workingBody);
    setWorkingBody(activeSource.body);
    setConfirmReplace(false);
    setView("edit");
    setToast("Source Draftで全文置換しました。保存前なら元に戻せます。", "warning");
  }

  async function createSnapshot() {
    const nextWorkspace = addDraftSnapshot(workspace, {
      id: crypto.randomUUID(),
      label: snapshotLabel,
      body: workingBody,
      created_at: new Date().toISOString(),
    }) as DraftWorkspace;
    const saved = await persist(nextWorkspace, workingBody);
    if (saved) setToast("Working Draftのスナップショットを保存しました。", "success");
  }

  function restoreSnapshot(snapshot: DraftWorkspace["snapshots"][number]) {
    pushUndo(workingBody);
    setWorkingBody(snapshot.body);
    setView("edit");
    setToast(`「${snapshot.label}」を復元しました。保存するまで確定しません。`, "info");
  }

  async function copyRerequest() {
    await workspaceApi.copyText(buildDraftRerequest({
      title,
      workingBody,
      source: activeSource,
      request: rerequest,
    }));
    setToast("AIへの再依頼文をコピーしました。返答は新しいSource Draftとして追加してください。", "success");
  }

  function sourceLabel(source: DraftSource, index: number) {
    const service = source.ai_service || "AI原稿";
    const date = source.created_at ? new Date(source.created_at).toLocaleString("ja-JP") : "";
    return `${index + 1}. ${service}${date ? ` · ${date}` : ""}`;
  }

  return (
    <div className="draft-workspace-backdrop" role="presentation">
      <section className="draft-workspace-dialog" role="dialog" aria-modal="true" aria-labelledby="draft-workspace-title">
        <header>
          <div>
            <span>AI DRAFT</span>
            <h2 id="draft-workspace-title">{currentNote ? title : "新しいDraft Workspace"}</h2>
          </div>
          <div className="draft-workspace-header-actions">
            {confirmClose ? (
              <div className="draft-close-confirm">
                <span>未保存の入力があります</span>
                <button className="secondary-button compact" onClick={() => setConfirmClose(false)}>続ける</button>
                <button className="danger-button compact" onClick={() => closeDialog(true)}>破棄して閉じる</button>
              </div>
            ) : (
              <>
                {currentNote && <span className={dirty ? "is-dirty" : ""}>{dirty ? "未保存" : "保存済み"}</span>}
                <button type="button" className="icon-button" onClick={() => closeDialog()} aria-label="閉じる"><IconX size={18} /></button>
              </>
            )}
          </div>
        </header>

        {!currentNote && (
          <div className="draft-workspace-create-fields">
            <label><span>文書タイトル</span><input ref={firstFieldRef as React.RefObject<HTMLInputElement>} value={title} onChange={(event) => setTitle(event.target.value)} placeholder="AI原稿を仕上げる文書名" /></label>
            <label>
              <span>Theme</span>
              <select value={themeId} onChange={(event) => setThemeId(event.target.value)}>
                <option value="">Theme未設定</option>
                {themes.map((theme) => <option key={theme.id} value={theme.id}>{theme.name}</option>)}
              </select>
            </label>
          </div>
        )}

        {workspace.sources.length > 0 && !addingSource && (
          <div className="draft-workspace-toolbar">
            <div className="segmented" aria-label="Draft Workspace表示">
              {([
                ["source", "Source"],
                ["edit", "Edit"],
                ["diff", `Diff${diffHunks.length ? ` ${diffHunks.length}` : ""}`],
                ["history", `履歴 ${workspace.snapshots.length}`],
              ] as Array<[DraftView, string]>).map(([value, label]) => (
                <button key={value} className={view === value ? "is-active" : ""} onClick={() => setView(value)}>{label}</button>
              ))}
            </div>
            <div>
              <button className="secondary-button compact" disabled={!undoStack.length} onClick={undoWorkingChange}><IconArrowBackUp size={15} />戻す</button>
              <button className="secondary-button compact" onClick={() => setAddingSource(true)}><IconPlus size={15} />Source追加</button>
              <button className="primary-button compact" disabled={saving || !dirty} onClick={() => void saveWorkingDraft()}><IconDeviceFloppy size={15} />Workingを保存</button>
            </div>
          </div>
        )}

        <div className="draft-workspace-body">
          {addingSource ? (
            <div className="draft-source-form">
              <div className="draft-source-meta-grid">
                <label><span>AIサービス（任意）</span><input ref={currentNote ? firstFieldRef as React.RefObject<HTMLInputElement> : undefined} value={aiService} onChange={(event) => setAiService(event.target.value)} placeholder="ChatGPT / Claude / Gemini…" /></label>
                <label><span>元チャットURL（任意）</span><input value={chatUrl} onChange={(event) => setChatUrl(event.target.value)} placeholder="https://…" /></label>
              </div>
              <label><span>元の指示メモ（任意）</span><input value={instruction} onChange={(event) => setInstruction(event.target.value)} placeholder="この原稿を作らせた目的や条件" /></label>
              <label className="draft-source-body-field">
                <span>AI原稿 / Source Draft</span>
                <textarea ref={!currentNote ? firstFieldRef as React.RefObject<HTMLTextAreaElement> : undefined} value={sourceBody} onChange={(event) => setSourceBody(event.target.value)} placeholder="AIから受け取ったMarkdownを貼り付け" />
              </label>
              <div className="draft-source-form-actions">
                {workspace.sources.length > 0 && <button className="secondary-button" onClick={() => setAddingSource(false)}>キャンセル</button>}
                <button className="primary-button" disabled={saving || !sourceBody.trim()} onClick={() => void saveSourceDraft()}><IconCheck size={16} />{currentNote ? "Source Draftを追加" : "Working Draftを作る"}</button>
              </div>
            </div>
          ) : view === "source" && activeSource ? (
            <div className="draft-source-view">
              <div className="draft-source-selector">
                <select
                  value={activeSource.id}
                  onChange={(event) => setWorkspace((current) => ({ ...current, active_source_id: event.target.value }))}
                  aria-label="比較するSource Draft"
                >
                  {workspace.sources.map((source, index) => <option key={source.id} value={source.id}>{sourceLabel(source, index)}</option>)}
                </select>
                {activeSource.chat_url && <a href={activeSource.chat_url} target="_blank" rel="noreferrer">元チャットを開く</a>}
              </div>
              {activeSource.instruction && <p className="draft-source-instruction">{activeSource.instruction}</p>}
              <MarkdownPreview className="draft-workspace-preview markdown-preview" html={previewHtml(activeSource.body, "markdown")} />
            </div>
          ) : view === "edit" ? (
            <div className="draft-edit-view">
              <textarea value={workingBody} onChange={(event) => setWorkingBody(event.target.value)} aria-label="Working Draft本文" />
              <div className="draft-rerequest">
                <label><span>AIへの再依頼</span><textarea value={rerequest} onChange={(event) => setRerequest(event.target.value)} placeholder="直してほしい箇所や条件" /></label>
                <button className="secondary-button compact" onClick={() => void copyRerequest()}><IconCopy size={15} />再依頼をコピー</button>
              </div>
            </div>
          ) : view === "diff" && activeSource ? (
            <div className="draft-diff-view">
              <div className="draft-diff-heading">
                <span>Source → Working</span>
                {!confirmReplace ? (
                  <button className="secondary-button compact" onClick={() => setConfirmReplace(true)}><IconReplace size={15} />全文をSourceへ戻す</button>
                ) : (
                  <div className="draft-replace-confirm">
                    <span>Working全文を置換します</span>
                    <button className="secondary-button compact" onClick={() => setConfirmReplace(false)}>やめる</button>
                    <button className="danger-button compact" onClick={replaceWithSource}>置換する</button>
                  </div>
                )}
              </div>
              {!diffHunks.length && <div className="command-palette-empty"><strong>差分はありません</strong><span>SourceとWorkingは同じ内容です。</span></div>}
              {diffHunks.map((hunk, index) => (
                <section className="draft-diff-hunk" key={`${index}:${hunk.changedLines}`}>
                  <header><strong>変更ブロック {index + 1}</strong><span>+{hunk.addedLines} / -{hunk.removedLines}</span><button className="secondary-button compact" onClick={() => adoptSourceHunk(index)}>Source側を採用</button></header>
                  <div className="draft-diff-lines">
                    {hunk.lines.map((line, lineIndex) => (
                      <div className={`markdown-diff-line is-${line.kind}`} key={`${lineIndex}:${line.beforeLine}:${line.afterLine}`}>
                        <span className="markdown-diff-line-marker">{line.kind === "added" ? "+" : line.kind === "removed" ? "−" : " "}</span>
                        <span className="markdown-diff-line-text">{line.text || " "}</span>
                      </div>
                    ))}
                  </div>
                </section>
              ))}
            </div>
          ) : (
            <div className="draft-history-view">
              <div className="draft-snapshot-create">
                <label><span>スナップショット名</span><input value={snapshotLabel} onChange={(event) => setSnapshotLabel(event.target.value)} /></label>
                <button className="primary-button compact" disabled={saving} onClick={() => void createSnapshot()}><IconHistory size={15} />現在版を保存</button>
              </div>
              {workspace.snapshots.slice().reverse().map((snapshot) => (
                <article key={snapshot.id}>
                  <div><strong>{snapshot.label}</strong><span>{snapshot.created_at ? new Date(snapshot.created_at).toLocaleString("ja-JP") : ""}</span></div>
                  <button className="secondary-button compact" onClick={() => restoreSnapshot(snapshot)}>復元</button>
                </article>
              ))}
              {!workspace.snapshots.length && <div className="command-palette-empty"><strong>スナップショットはありません</strong><span>大幅修正やPDF出力の前に現在版を残せます。</span></div>}
            </div>
          )}
        </div>
      </section>
    </div>
  );
}
