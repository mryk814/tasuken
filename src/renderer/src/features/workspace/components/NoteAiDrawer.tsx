import { useEffect, useMemo, useRef, useState } from "react";
import {
  IconArrowBackUp,
  IconCheck,
  IconChevronRight,
  IconCopy,
  IconPlayerStop,
  IconRefresh,
  IconSend,
  IconSettings,
  IconX,
} from "@tabler/icons-react";

import type { AiNoteGenerateRequest, AiNoteGenerateResult } from "../../../../../shared/ai";
import { markdownSignature } from "../../../../../shared/canonicalMarkdown.mjs";
import {
  buildNoteAiHistory,
  buildNoteAiProposal,
  noteAiSecretWarning,
  proposalResponseText,
} from "../../../../../shared/noteAiConversation.mjs";
import type { NoteAiHistoryEntry } from "../../../../../shared/noteAiConversation.mjs";
import { workspaceApi } from "../../../services/workspaceApi";
import type { BaseRecord, Entity, SaveEntities, SaveEntity, Theme } from "../types";
import type { CommandEnvelope } from "../../../../../shared/applicationCommand";
import { applyMarkdownDiffHunks, buildMarkdownDiffHunks, diffMarkdownLines } from "../lib/markdownEditing";
import { previewHtml } from "../lib/markdown";
import { str, uuid } from "../lib/format";
import { MarkdownPreview } from "./MarkdownPreview";

export interface NoteAiTarget {
  scope: "document" | "selection";
  start?: number;
  end?: number;
  text?: string;
  heading?: string;
  baseRevision: number;
  bodySignature: string;
  anchorOffset: number;
}

type ReviewAction = "insert" | "replace_selection" | "replace_document" | "new_note";

function withoutProjection(record: BaseRecord): Entity {
  const { recordType: _recordType, ...entity } = record;
  return entity as Entity;
}

function withoutCanonicalBinding(entity: Entity): Entity {
  const properties = entity.properties_json && typeof entity.properties_json === "object" && !Array.isArray(entity.properties_json)
    ? { ...(entity.properties_json as Record<string, unknown>) }
    : {};
  delete properties.canonical_markdown;
  delete properties.markdown_export;
  return { ...entity, properties_json: properties };
}

function proposalBody(proposal: BaseRecord | null): string {
  const payload = proposal?.payload && typeof proposal.payload === "object" ? proposal.payload as Record<string, unknown> : {};
  const notes = Array.isArray(payload.notes) ? payload.notes : [];
  const first = notes[0] && typeof notes[0] === "object" ? notes[0] as Record<string, unknown> : {};
  return str(first.body);
}

function resourceSummary(resource: BaseRecord): string {
  return str(resource.description || resource.body_markdown || resource.summary || resource.url).slice(0, 20_000);
}

function statusLabel(status: string): string {
  return ({ pending: "確認待ち", accepted: "採用済み", partially_accepted: "一部採用", rejected: "却下", historical: "旧AI Draft" } as Record<string, string>)[status] || status;
}

export function NoteAiDrawer({
  note,
  body,
  target,
  proposals,
  theme,
  resources,
  saveEntity,
  saveEntities,
  setToast,
  onApplied,
  onClose,
  onOpenSettings,
}: {
  note: BaseRecord;
  body: string;
  target: NoteAiTarget;
  proposals: BaseRecord[];
  theme: Theme | null;
  resources: BaseRecord[];
  saveEntity: SaveEntity;
  saveEntities: SaveEntities;
  setToast: (message: string, tone?: "info" | "success" | "warning" | "danger") => void;
  onApplied: (saved: BaseRecord, nextBody: string) => void;
  onClose: () => void;
  onOpenSettings: () => void;
}) {
  const [instruction, setInstruction] = useState("");
  const [streaming, setStreaming] = useState(false);
  const [streamText, setStreamText] = useState("");
  const [error, setError] = useState("");
  const [providerConfigured, setProviderConfigured] = useState<boolean | null>(null);
  const [includeTitle, setIncludeTitle] = useState(true);
  const [includeBody, setIncludeBody] = useState(target.scope !== "selection");
  const [includeSelection, setIncludeSelection] = useState(target.scope === "selection");
  const [includeHeading, setIncludeHeading] = useState(Boolean(target.heading));
  const [includeHistory, setIncludeHistory] = useState(true);
  const [includeTheme, setIncludeTheme] = useState(false);
  const [resourceId, setResourceId] = useState("");
  const [contextConfirmed, setContextConfirmed] = useState(false);
  const [activeProposal, setActiveProposal] = useState<BaseRecord | null>(null);
  const [reviewAction, setReviewAction] = useState<ReviewAction | null>(null);
  const [acceptedHunks, setAcceptedHunks] = useState<Set<number>>(new Set());
  const [undoApply, setUndoApply] = useState<{ saved: BaseRecord; body: string } | null>(null);
  const [collapsed, setCollapsed] = useState(false);
  const [width, setWidth] = useState(390);
  const [narrow, setNarrow] = useState(() => window.matchMedia("(max-width: 820px)").matches);
  const requestIdRef = useRef("");
  const inputRef = useRef<HTMLTextAreaElement | null>(null);
  const drawerRef = useRef<HTMLElement | null>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);

  const history = useMemo(() => buildNoteAiHistory(note, proposals), [note, proposals]);
  const selectedResource = resources.find((entry) => entry.id === resourceId) || null;
  const responseText = activeProposal ? proposalResponseText(activeProposal) : "";
  const storedProposalBody = proposalBody(activeProposal);
  const activeProposalIsPending = Boolean(activeProposal?.status === "pending" && proposals.some((entry) => entry.id === activeProposal.id && !entry.deleted_at));

  const reviewBody = useMemo(() => {
    if (!reviewAction || !activeProposal) return "";
    if (reviewAction === "replace_document" || reviewAction === "new_note") return responseText;
    const insertionPoint = Number.isInteger(target.start) ? Math.max(0, Math.min(body.length, target.start!)) : body.length;
    if (reviewAction === "insert") return `${body.slice(0, insertionPoint)}${responseText}${body.slice(insertionPoint)}`;
    if (target.scope !== "selection" || target.start == null || target.end == null) return body;
    return `${body.slice(0, target.start)}${responseText}${body.slice(target.end)}`;
  }, [activeProposal, body, responseText, reviewAction, target]);
  const reviewBefore = reviewAction === "new_note" ? "" : body;
  const reviewLines = useMemo(() => diffMarkdownLines(reviewBefore, reviewBody), [reviewBefore, reviewBody]);
  const reviewHunks = useMemo(() => buildMarkdownDiffHunks(reviewLines, 1), [reviewLines]);
  const acceptedBody = useMemo(
    () => reviewHunks.length ? applyMarkdownDiffHunks(reviewBefore, reviewBody, [...acceptedHunks]) : reviewBody,
    [acceptedHunks, reviewBefore, reviewBody, reviewHunks.length],
  );
  const anchorStale = Number(note.version || 0) !== target.baseRevision || markdownSignature(body) !== target.bodySignature;
  const selectionStale = anchorStale || reviewAction === "replace_selection" && (
    target.scope !== "selection" || target.start == null || target.end == null || body.slice(target.start, target.end) !== target.text
  );
  const contextText = [
    includeTitle ? str(note.title) : "",
    includeBody ? body : "",
    includeSelection ? str(target.text) : "",
    includeHeading ? str(target.heading) : "",
    includeTheme ? str(theme?.description) : "",
    selectedResource ? resourceSummary(selectedResource) : "",
    ...(includeHistory ? history.flatMap((entry) => [entry.prompt, entry.response]) : []),
  ].filter(Boolean).join("\n");
  const secretWarning = noteAiSecretWarning(contextText);

  useEffect(() => {
    setContextConfirmed(false);
  }, [includeTitle, includeBody, includeSelection, includeHeading, includeHistory, includeTheme, resourceId, target]);

  useEffect(() => {
    previousFocusRef.current = document.activeElement as HTMLElement | null;
    const frame = window.requestAnimationFrame(() => inputRef.current?.focus());
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
        return;
      }
      if (event.key !== "Tab" || !narrow || collapsed) return;
      const focusable = [...(drawerRef.current?.querySelectorAll<HTMLElement>("button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex='-1'])") || [])]
        .filter((element) => !element.hidden && element.getClientRects().length > 0);
      if (!focusable.length) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (!drawerRef.current?.contains(document.activeElement)) { event.preventDefault(); (event.shiftKey ? last : first).focus(); }
      else if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    };
    document.addEventListener("keydown", onKeyDown);
    void workspaceApi.getAiConfig()
      .then((config) => setProviderConfigured(Boolean(config.defaultProviderProfileId && config.defaultModelProfileId)))
      .catch(() => setProviderConfigured(false));
    return () => {
      window.cancelAnimationFrame(frame);
      document.removeEventListener("keydown", onKeyDown);
      if (requestIdRef.current) void workspaceApi.cancelNoteAiStream(requestIdRef.current);
      window.requestAnimationFrame(() => previousFocusRef.current?.focus?.({ preventScroll: true }));
    };
  }, [collapsed, narrow, onClose]);

  useEffect(() => {
    const query = window.matchMedia("(max-width: 820px)");
    const change = () => setNarrow(query.matches);
    change();
    query.addEventListener("change", change);
    return () => query.removeEventListener("change", change);
  }, []);

  useEffect(() => {
    if (!narrow || collapsed || !drawerRef.current) return;
    const workbench = drawerRef.current.parentElement;
    const page = drawerRef.current.closest<HTMLElement>(".notes-page");
    const workbenchSiblings = [...(workbench?.children || [])]
      .filter((entry): entry is HTMLElement => entry instanceof HTMLElement && entry !== drawerRef.current);
    const pageSiblings = [...(page?.children || [])]
      .filter((entry): entry is HTMLElement => entry instanceof HTMLElement && entry !== workbench && !entry.contains(drawerRef.current));
    const siblings = [...new Set([...workbenchSiblings, ...pageSiblings])];
    const previous = siblings.map((entry) => ({ entry, inert: entry.inert, ariaHidden: entry.getAttribute("aria-hidden") }));
    for (const sibling of siblings) {
      sibling.inert = true;
      sibling.setAttribute("aria-hidden", "true");
    }
    return () => {
      for (const state of previous) {
        state.entry.inert = state.inert;
        if (state.ariaHidden === null) state.entry.removeAttribute("aria-hidden");
        else state.entry.setAttribute("aria-hidden", state.ariaHidden);
      }
    };
  }, [collapsed, narrow]);

  useEffect(() => workspaceApi.onNoteAiStreamEvent((requestId, event) => {
    if (requestId !== requestIdRef.current || event.type !== "text_delta") return;
    setStreamText((current) => current + event.text);
  }), []);

  useEffect(() => {
    const latestPending = [...history].reverse().find((entry) => entry.status === "pending" && entry.proposal);
    if (latestPending?.proposal && !activeProposal) setActiveProposal(latestPending.proposal as BaseRecord);
  }, [activeProposal, history]);

  async function sendMessage() {
    const prompt = instruction.trim();
    if (!prompt || streaming) return;
    if (!includeTitle && !includeBody && !includeSelection && !includeHeading && !includeTheme && !selectedResource && !(includeHistory && history.length)) {
      setError("送信するContextを1件以上選んでください。");
      return;
    }
    if (!contextConfirmed) {
      setError("外部AIへ送るContextを確認してチェックしてください。");
      return;
    }
    if (anchorStale) {
      setError("Noteが更新されています。AI drawerを開き直してContextを確認してください。");
      return;
    }
    const request: AiNoteGenerateRequest = {
      noteId: note.id,
      baseRevision: Number(note.version || 0),
      expectedBodySignature: markdownSignature(body),
      confirmationToken: "note-ai-context-confirmed/v1",
      anchorOffset: target.anchorOffset,
      scope: target.scope,
      title: str(note.title),
      body,
      instruction: prompt,
      selection: target.scope === "selection" && target.start != null && target.end != null && target.text
        ? { start: target.start, end: target.end, text: target.text }
        : undefined,
      context: {
        includeTitle,
        includeBody,
        includeSelection,
        includeHeading,
        includeHistory,
        ...(includeHeading && target.heading ? { heading: target.heading } : {}),
        ...(includeTheme && theme ? { theme: { id: theme.id, title: "", summary: "" } } : {}),
        ...(selectedResource ? { resource: { id: selectedResource.id, title: "", summary: "" } } : {}),
      },
    };
    const requestId = uuid();
    requestIdRef.current = requestId;
    setStreaming(true);
    setStreamText("");
    setError("");
    setReviewAction(null);
    try {
      const result: AiNoteGenerateResult = await workspaceApi.startNoteAiStream(requestId, request);
      const proposal = buildNoteAiProposal({
        id: uuid(),
        note: withoutProjection(note),
        instruction: prompt,
        request,
        result,
        generatedAt: new Date().toISOString(),
      }) as BaseRecord;
      const saved = await saveEntity("ai_proposal", proposal, { source: "embedded_llm" });
      setActiveProposal(saved);
      setInstruction("");
      setStreamText("");
      setToast("AI回答をProposalとして保存しました。差分を確認して採用できます。", "success");
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : String(cause);
      setError(message.includes("cancel") || message.includes("キャンセル") ? "生成を中止しました。入力は保持しています。" : `AI回答を取得できませんでした。${message}`);
    } finally {
      requestIdRef.current = "";
      setStreaming(false);
    }
  }

  async function cancelStream() {
    const requestId = requestIdRef.current;
    if (requestId) await workspaceApi.cancelNoteAiStream(requestId);
  }

  async function copyResponse() {
    if (!responseText) return;
    await workspaceApi.copyText(responseText);
    setToast("AI回答をコピーしました。", "success");
  }

  function beginReview(action: ReviewAction) {
    if (!activeProposalIsPending) return;
    setReviewAction(action);
    const before = action === "new_note" ? "" : body;
    const after = action === "replace_document" || action === "new_note"
      ? responseText
      : action === "insert"
        ? `${body.slice(0, target.start ?? body.length)}${responseText}${body.slice(target.start ?? body.length)}`
        : `${body.slice(0, target.start ?? 0)}${responseText}${body.slice(target.end ?? body.length)}`;
    const hunks = buildMarkdownDiffHunks(diffMarkdownLines(before, after), 1);
    setAcceptedHunks(new Set(hunks.map((_hunk, index) => index)));
  }

  async function acceptReview() {
    if (!activeProposal || !activeProposalIsPending || !reviewAction || selectionStale || !acceptedBody.trim()) return;
    const nextId = reviewAction === "new_note" ? uuid() : note.id;
    let candidate: Entity = {
      ...withoutProjection(note),
      id: nextId,
      title: reviewAction === "new_note" ? `${str(note.title) || "無題"} - AI` : str(note.title),
      body_markdown: acceptedBody,
      ...(reviewAction === "new_note" ? { version: 1, created_at: undefined, updated_at: undefined } : {}),
    };
    if (reviewAction === "new_note") candidate = withoutCanonicalBinding(candidate);
    const acceptedProposal = { ...withoutProjection(activeProposal), status: acceptedHunks.size < reviewHunks.length ? "partially_accepted" : "accepted" } as Entity;
    let savedNote: BaseRecord | undefined;
    if (reviewAction === "new_note") {
      const saved = await saveEntities([
        { action: "save", type: "ai_proposal", entity: acceptedProposal },
        { action: "save", type: "note", entity: candidate },
      ], "AI回答を新しいNoteとして保存しました。", "main_ui");
      savedNote = saved.find((entry) => entry.id === nextId) as BaseRecord | undefined;
    } else {
      const envelope: CommandEnvelope = {
        commandId: uuid(), name: "ApplyAiProposal",
        payload: { proposal: acceptedProposal, candidates: [{ type: "note", entity: candidate }] },
        actor: { kind: "user" }, source: "main_ui",
        expectedVersions: [
          { type: "ai_proposal", id: activeProposal.id, version: Number(activeProposal.version || 0) },
          { type: "note", id: note.id, version: Number(note.version || 0) },
        ],
        issuedAt: new Date().toISOString(),
      };
      const receipt = await workspaceApi.applyCanonicalNoteAiProposal({
        entity: candidate,
        snapshot: { owner: { recordType: "note", entityId: note.id }, body: acceptedBody, expectedRevision: Number(note.version || 0) },
        options: { source: "main_ui", reason: "note_ai_apply" },
      }, envelope);
      savedNote = receipt.changes.find((change) => change.type === "note")?.entity as BaseRecord | undefined;
      setToast("AI Proposalを採用しました。", "success");
    }
    if (savedNote) {
      if (reviewAction !== "new_note") setUndoApply({ saved: savedNote, body });
      onApplied(savedNote, acceptedBody);
    }
    setActiveProposal(null);
    setReviewAction(null);
  }

  async function rejectProposal() {
    if (!activeProposal || !activeProposalIsPending) return;
    await workspaceApi.executeCommand({
      commandId: uuid(), name: "ApplyAiProposal",
      payload: { proposal: { ...withoutProjection(activeProposal), status: "rejected" }, candidates: [] },
      actor: { kind: "user" }, source: "main_ui",
      expectedVersions: [{ type: "ai_proposal", id: activeProposal.id, version: Number(activeProposal.version || 0) }],
      issuedAt: new Date().toISOString(),
    });
    setActiveProposal(null);
    setReviewAction(null);
    setToast("AI Proposalを却下しました。", "info");
  }

  async function undoLastApply() {
    if (!undoApply) return;
    const undoProposal = await saveEntity("ai_proposal", {
      id: uuid(), source: "manual", source_app: "Tasken Note AI", payload_type: "notes", status: "pending",
      payload: { notes: [{ action: "merge", target_id: undoApply.saved.id, base_version: Number(undoApply.saved.version || 0), title: str(undoApply.saved.title), body: undoApply.body, reason: "直前のAI採用を元に戻す" }] },
      request: { conversation_id: `note-ai:${undoApply.saved.id}`, instruction: "直前のAI採用を元に戻す", target: { type: "note", id: undoApply.saved.id, base_version: Number(undoApply.saved.version || 0) } },
      response: { text: undoApply.body, generated_at: new Date().toISOString() },
    }, { source: "main_ui" }) as BaseRecord;
    const candidate = { ...withoutProjection(undoApply.saved), body_markdown: undoApply.body } as Entity;
    const receipt = await workspaceApi.applyCanonicalNoteAiProposal({
      entity: candidate,
      snapshot: { owner: { recordType: "note", entityId: undoApply.saved.id }, body: undoApply.body, expectedRevision: Number(undoApply.saved.version || 0) },
      options: { reason: "note_ai_undo", source: "main_ui" },
    }, {
      commandId: uuid(), name: "ApplyAiProposal",
      payload: { proposal: { ...withoutProjection(undoProposal), status: "accepted" }, candidates: [{ type: "note", entity: candidate }] },
      actor: { kind: "user" }, source: "main_ui",
      expectedVersions: [
        { type: "ai_proposal", id: undoProposal.id, version: Number(undoProposal.version || 0) },
        { type: "note", id: undoApply.saved.id, version: Number(undoApply.saved.version || 0) },
      ],
      issuedAt: new Date().toISOString(),
    });
    const saved = receipt.changes.find((change) => change.type === "note")?.entity as BaseRecord | undefined;
    if (!saved) throw new Error("UndoしたNoteを再読込できませんでした。");
    onApplied(saved, undoApply.body);
    setUndoApply(null);
    setToast("AIの採用を元に戻しました。", "info");
  }

  function selectHistory(entry: NoteAiHistoryEntry) {
    if (entry.proposal) setActiveProposal(entry.proposal as BaseRecord);
    else setActiveProposal({ id: entry.id, status: "historical", response: { text: entry.response } });
    setReviewAction(null);
  }

  function startResize(event: React.PointerEvent<HTMLDivElement>) {
    const startX = event.clientX;
    const startWidth = width;
    const move = (next: PointerEvent) => setWidth(Math.max(320, Math.min(620, startWidth + startX - next.clientX)));
    const stop = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", stop);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", stop, { once: true });
  }

  function resizeFromKeyboard(event: React.KeyboardEvent<HTMLDivElement>) {
    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight" && event.key !== "Home" && event.key !== "End") return;
    event.preventDefault();
    if (event.key === "Home") setWidth(320);
    else if (event.key === "End") setWidth(620);
    else setWidth((current) => Math.max(320, Math.min(620, current + (event.key === "ArrowLeft" ? 16 : -16))));
  }

  return (
    <aside ref={drawerRef} className={`note-ai-drawer${collapsed ? " is-collapsed" : ""}`} style={{ width: collapsed ? 46 : width }} aria-label="Note AI chat" role={narrow && !collapsed ? "dialog" : "complementary"} aria-modal={narrow && !collapsed ? "true" : undefined}>
      {!collapsed && <div className="note-ai-resize" role="separator" tabIndex={0} aria-orientation="vertical" aria-label="Note本文とAI drawerの境界" aria-valuemin={320} aria-valuemax={620} aria-valuenow={width} onKeyDown={resizeFromKeyboard} onPointerDown={startResize} />}
      <header className="note-ai-header">
        {!collapsed && <div><span>NOTE AI</span><strong>{str(note.title) || "無題"}</strong></div>}
        <div>
          <button className="icon-button" type="button" onClick={() => setCollapsed((current) => !current)} aria-label={collapsed ? "AI drawerを展開" : "AI drawerを折りたたむ"}><IconChevronRight size={17} /></button>
          {!collapsed && <button className="icon-button" type="button" onClick={onClose} aria-label="AI drawerを閉じる"><IconX size={17} /></button>}
        </div>
      </header>
      {!collapsed && (
        <>
          <div className="note-ai-history" aria-live="polite">
            {!history.length && !streaming && <div className="note-ai-empty"><strong>このNoteの会話はまだありません</strong><span>下の入力欄から依頼できます。</span></div>}
            {history.map((entry) => (
              <button key={`${entry.kind}:${entry.id}`} className={`note-ai-turn${activeProposal?.id === entry.id ? " is-active" : ""}`} type="button" onClick={() => selectHistory(entry)}>
                {entry.prompt && <span className="note-ai-human">{entry.prompt}</span>}
                <span className="note-ai-assistant">{entry.response}</span>
                <small>{entry.provider}{entry.model ? ` / ${entry.model}` : ""} · {statusLabel(entry.status)}{entry.created_at ? ` · ${new Date(entry.created_at).toLocaleString("ja-JP")}` : ""}</small>
              </button>
            ))}
            {streaming && <div className="note-ai-turn is-streaming"><span className="note-ai-human">{instruction}</span><span className="note-ai-assistant">{streamText || "生成を開始しています…"}</span></div>}
          </div>

          {activeProposal && !streaming && (
            <section className="note-ai-result" aria-label="AI回答の操作">
              <div className="note-ai-result-actions">
                <button className="secondary-button compact" onClick={() => void copyResponse()}><IconCopy size={14} />コピー</button>
                {activeProposalIsPending && <button className="secondary-button compact" onClick={() => beginReview("insert")}>現在位置へ挿入</button>}
                {activeProposalIsPending && target.scope === "selection" && <button className="secondary-button compact" onClick={() => beginReview("replace_selection")}>選択範囲を置換</button>}
                {activeProposalIsPending && <button className="secondary-button compact" onClick={() => beginReview("replace_document")}>全文を置換</button>}
                {activeProposalIsPending && <button className="secondary-button compact" onClick={() => beginReview("new_note")}>新しいNote</button>}
                {activeProposalIsPending && <button className="text-button compact" onClick={() => void rejectProposal()}>却下</button>}
              </div>
              {storedProposalBody && storedProposalBody !== responseText && <p className="field-help">生成時の文書全体proposalも履歴に保持されています。</p>}
            </section>
          )}

          {reviewAction && activeProposal && (
            <section className="note-ai-review" aria-label="AI Proposalの差分確認">
              <header><strong>Diff review</strong><button className="text-button compact" onClick={() => setReviewAction(null)}>閉じる</button></header>
              {selectionStale && <p className="inline-alert is-warning">選択範囲が生成後に変わりました。選び直して再依頼してください。</p>}
              {reviewHunks.map((hunk, index) => (
                <article className="note-ai-diff-hunk" key={`${index}:${hunk.changedLines}`}>
                  <label><input type="checkbox" checked={acceptedHunks.has(index)} onChange={(event) => setAcceptedHunks((current) => {
                    const next = new Set(current);
                    if (event.target.checked) next.add(index); else next.delete(index);
                    return next;
                  })} />変更 {index + 1}を採用</label>
                  {hunk.lines.map((line, lineIndex) => <div className={`markdown-diff-line is-${line.kind}`} key={`${lineIndex}:${line.beforeLine}:${line.afterLine}`}><span className="markdown-diff-line-marker">{line.kind === "added" ? "+" : line.kind === "removed" ? "−" : " "}</span><span className="markdown-diff-line-text">{line.text || " "}</span></div>)}
                </article>
              ))}
              <button className="primary-button compact" disabled={selectionStale || !acceptedHunks.size} onClick={() => void acceptReview()}><IconCheck size={15} />採用を保存</button>
            </section>
          )}

          {undoApply && <button className="secondary-button note-ai-undo" onClick={() => void undoLastApply()}><IconArrowBackUp size={15} />直前のAI採用を元に戻す</button>}

          <div className="note-ai-composer">
            <details className="note-ai-context" open>
              <summary>送信するContextを確認</summary>
              <label><input type="checkbox" checked={includeTitle} onChange={(event) => setIncludeTitle(event.target.checked)} />見出し</label>
              <label><input type="checkbox" checked={includeBody} onChange={(event) => setIncludeBody(event.target.checked)} />Note全文</label>
              <label><input type="checkbox" checked={includeSelection} disabled={target.scope !== "selection"} onChange={(event) => setIncludeSelection(event.target.checked)} />明示した選択範囲</label>
              <label><input type="checkbox" checked={includeHeading} disabled={!target.heading} onChange={(event) => setIncludeHeading(event.target.checked)} />現在の見出し{target.heading ? `: ${target.heading}` : "（なし）"}</label>
              <label><input type="checkbox" checked={includeHistory} onChange={(event) => setIncludeHistory(event.target.checked)} />このNoteの会話履歴（最大12件）</label>
              <label><input type="checkbox" checked={includeTheme} disabled={!theme} onChange={(event) => setIncludeTheme(event.target.checked)} />Theme要約</label>
              <label className="note-ai-resource"><span>関連Resource</span><select value={resourceId} onChange={(event) => setResourceId(event.target.value)}><option value="">送らない</option>{resources.map((resource) => <option key={resource.id} value={resource.id}>{str(resource.title) || "Resource"}</option>)}</select></label>
              {secretWarning && <p className="inline-alert is-warning">{secretWarning}</p>}
              {anchorStale && <p className="inline-alert is-warning">Noteが更新されています。drawerを開き直してください。</p>}
              <label className="note-ai-confirm"><input type="checkbox" checked={contextConfirmed} onChange={(event) => setContextConfirmed(event.target.checked)} />上記の内容を外部AIへ送ることを確認しました</label>
            </details>
            {providerConfigured === false && <div className="note-ai-provider-warning"><span>AI provider/modelが未設定です。</span><button className="text-button compact" onClick={onOpenSettings}><IconSettings size={14} />Settingsを開く</button></div>}
            {error && <div className="inline-alert is-danger" role="alert"><span>{error}</span><button className="text-button compact" onClick={() => void sendMessage()}><IconRefresh size={14} />再試行</button></div>}
            <textarea ref={inputRef} value={instruction} disabled={streaming} onChange={(event) => setInstruction(event.target.value)} onKeyDown={(event) => {
              if (event.key === "Enter" && (event.ctrlKey || event.metaKey) && !event.nativeEvent.isComposing) { event.preventDefault(); void sendMessage(); }
            }} placeholder="このNoteについてAIに依頼…" aria-label="Note AIへの依頼" />
            <div className="note-ai-send-row"><span>Ctrl+Enterで送信</span>{streaming ? <button className="secondary-button compact" onClick={() => void cancelStream()}><IconPlayerStop size={15} />中止</button> : <button className="primary-button compact" disabled={!instruction.trim() || providerConfigured === false || !contextConfirmed || anchorStale} onClick={() => void sendMessage()}><IconSend size={15} />送信</button>}</div>
          </div>
        </>
      )}
    </aside>
  );
}
