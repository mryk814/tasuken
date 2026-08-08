import { useEffect, useMemo, useRef, useState } from "react";
import { IconCopy, IconFileText, IconSparkles, IconX } from "@tabler/icons-react";

import { workspaceApi } from "../../../services/workspaceApi";
import { buildContextPackMarkdown, contextPackExcerpt } from "../../../../../shared/contextPack.mjs";
import type { Entity, OpenDrawer, SaveEntity, Theme, WorkspaceData } from "../types";
import type { WorkspaceDomain } from "../domain-model/types";
import { str } from "../lib/format";
import { MarkdownPreview } from "./MarkdownPreview";
import { previewHtml } from "../lib/markdown";
import { themeRefFromEntity } from "../../../../../shared/themeRef.mjs";

type CandidateType = "task" | "note" | "resource" | "artifact";

interface ContextCandidate {
  id: string;
  type: CandidateType;
  title: string;
  summary?: string;
  body?: string;
  url?: string;
  completed?: boolean;
  selected: boolean;
}

function themeCandidates(themeId: string, domain: WorkspaceDomain, data: WorkspaceData): ContextCandidate[] {
  const matchesTheme = (record: object) => themeRefFromEntity(record as Record<string, unknown>).id === themeId;
  const tasks = domain.tasks
    .filter(matchesTheme)
    .map((task) => ({
      id: task.id,
      type: "task" as const,
      title: task.title,
      summary: str(task.description),
      completed: task.state === "done",
      selected: false,
    }));
  const notes = domain.notes
    .filter(matchesTheme)
    .map((note) => ({
      id: note.id,
      type: "note" as const,
      title: note.title,
      body: str(note.body_markdown),
      selected: false,
    }));
  const resources = domain.resources
    .filter(matchesTheme)
    .map((resource) => ({
      id: resource.id,
      type: "resource" as const,
      title: resource.title,
      summary: str(resource.description),
      url: str(resource.url),
      selected: false,
    }));
  const artifacts = (data.artifacts || [])
    .filter(matchesTheme)
    .map((artifact) => ({
      id: artifact.id,
      type: "artifact" as const,
      title: str(artifact.title || artifact.filename || "Artifact"),
      summary: [str(artifact.file_type || artifact.mime_type), str(artifact.original_path || artifact.stored_path || artifact.target)]
        .filter(Boolean)
        .join(" / "),
      selected: false,
    }));
  return [...tasks, ...notes, ...resources, ...artifacts];
}

const TYPE_LABELS: Record<CandidateType, string> = {
  task: "Task",
  note: "Note / Document",
  resource: "Resource",
  artifact: "Artifact",
};

export function ContextPackDialog({
  theme,
  domain,
  data,
  saveEntity,
  openDrawer,
  setToast,
  close,
}: {
  theme: Theme;
  domain: WorkspaceDomain;
  data: WorkspaceData;
  saveEntity: SaveEntity;
  openDrawer: OpenDrawer;
  setToast: (message: string, tone?: "info" | "success" | "warning" | "danger") => void;
  close: () => void;
}) {
  const initialCandidates = useMemo(() => themeCandidates(theme.id, domain, data), [data, domain, theme.id]);
  const [candidates, setCandidates] = useState(initialCandidates);
  const [purpose, setPurpose] = useState("");
  const [request, setRequest] = useState("");
  const [view, setView] = useState<"select" | "preview">("select");
  const [saving, setSaving] = useState(false);
  const [savedPack, setSavedPack] = useState<Entity | null>(null);
  const [generatedAt] = useState(() => new Date().toISOString());
  const firstFieldRef = useRef<HTMLInputElement | null>(null);
  const restoreFocusRef = useRef(true);
  const markdown = buildContextPackMarkdown({
    theme,
    purpose,
    request,
    candidates,
    generatedAt,
  });
  const selectedCount = candidates.filter((candidate) => candidate.selected).length;
  const estimatedTokens = Math.ceil(markdown.length / 3);

  useEffect(() => {
    const previousFocus = document.activeElement as HTMLElement | null;
    const focusFrame = window.requestAnimationFrame(() => firstFieldRef.current?.focus());
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      closeDialog();
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      window.cancelAnimationFrame(focusFrame);
      document.removeEventListener("keydown", handleKeyDown);
      if (restoreFocusRef.current) {
        window.requestAnimationFrame(() => previousFocus?.focus?.({ preventScroll: true }));
      }
    };
  }, [close]);

  function closeDialog(restoreFocus = true) {
    restoreFocusRef.current = restoreFocus;
    close();
  }

  function toggleCandidate(id: string, type: CandidateType) {
    setCandidates((current) => current.map((candidate) => (
      candidate.id === id && candidate.type === type
        ? { ...candidate, selected: !candidate.selected }
        : candidate
    )));
    setSavedPack(null);
  }

  async function copyMarkdown() {
    try {
      await workspaceApi.copyText(markdown);
      setToast("Context Packをコピーしました。", "success");
    } catch {
      setToast("Context Packをコピーできませんでした。もう一度お試しください。", "danger");
    }
  }

  async function savePack(): Promise<Entity | null> {
    if (savedPack) return savedPack;
    setSaving(true);
    try {
      const saved = await saveEntity("note", {
        title: `Context Pack: ${theme.name}`,
        body_markdown: markdown,
        note_type: "prompt",
        content_format: "markdown",
        theme_id: theme.id,
        properties_json: {
          prompt_purpose: "other",
          publish_enabled: false,
          context_pack: {
            generated_at: generatedAt,
            source_theme_id: theme.id,
            included_entities: candidates
              .filter((candidate) => candidate.selected)
              .map((candidate) => ({ type: candidate.type, id: candidate.id, title: candidate.title })),
            purpose,
            request,
            character_count: markdown.length,
          },
        },
      }, { reason: "context_pack_snapshot" });
      setSavedPack(saved);
      setToast("Context Packを保存しました。", "success");
      return saved;
    } catch {
      return null;
    } finally {
      setSaving(false);
    }
  }

  async function createAnswerDraft() {
    const pack = await savePack();
    if (!pack) return;
    closeDialog(false);
    openDrawer({
      type: "note",
      mode: "edit",
      entity: {
        title: `AI回答: ${theme.name}`,
        body_markdown: "# AI回答\n\n",
        note_type: "note",
        content_format: "markdown",
        theme_id: theme.id,
        properties_json: {
          source_draft: true,
          source_context_pack_id: pack.id,
        },
      },
    });
  }

  return (
    <div className="context-pack-backdrop" role="presentation">
      <section
        className="context-pack-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="context-pack-title"
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            event.preventDefault();
            closeDialog();
          }
        }}
      >
        <header>
          <div>
            <span>Theme Context</span>
            <h2 id="context-pack-title">Context Pack · {theme.name}</h2>
          </div>
          <button type="button" className="icon-button" onClick={() => closeDialog()} aria-label="閉じる"><IconX size={18} /></button>
        </header>
        <div className="context-pack-summary">
          <span>{selectedCount}件を選択</span>
          <span>{markdown.length.toLocaleString()}文字</span>
          <span>約{estimatedTokens.toLocaleString()} tokens</span>
        </div>
        <div className="segmented context-pack-tabs" aria-label="Context Pack表示">
          <button type="button" className={view === "select" ? "is-active" : ""} onClick={() => setView("select")}>選択</button>
          <button type="button" className={view === "preview" ? "is-active" : ""} onClick={() => setView("preview")}>Preview</button>
        </div>
        <div className="context-pack-body">
          {view === "select" ? (
            <>
              <div className="context-pack-request-fields">
                <label>
                  <span>目的</span>
                  <input ref={firstFieldRef} value={purpose} onChange={(event) => { setPurpose(event.target.value); setSavedPack(null); }} placeholder="例: 次の実験計画を整理する" />
                </label>
                <label>
                  <span>AIへの依頼</span>
                  <textarea value={request} onChange={(event) => { setRequest(event.target.value); setSavedPack(null); }} placeholder="この文脈を踏まえて、判断材料と次の行動を整理してください。" />
                </label>
              </div>
              <p className="context-pack-privacy-note">
                選んだ項目だけを含めます。Artifactはファイル本文を読まず、名前・種別・場所だけを記録します。
              </p>
              {(["task", "note", "resource", "artifact"] as CandidateType[]).map((type) => {
                const entries = candidates.filter((candidate) => candidate.type === type);
                if (!entries.length) return null;
                return (
                  <section className="context-pack-candidate-group" key={type}>
                    <h3>{TYPE_LABELS[type]} <span>{entries.filter((entry) => entry.selected).length}/{entries.length}</span></h3>
                    {entries.map((candidate) => (
                      <label key={`${type}:${candidate.id}`} className="context-pack-candidate">
                        <input type="checkbox" checked={candidate.selected} onChange={() => toggleCandidate(candidate.id, type)} />
                        <span>
                          <strong>{candidate.title}</strong>
                          {(candidate.summary || candidate.body) && <small>{contextPackExcerpt(candidate.summary || candidate.body, 180)}</small>}
                        </span>
                      </label>
                    ))}
                  </section>
                );
              })}
              {!candidates.length && <div className="command-palette-empty"><strong>含められる項目がありません</strong><span>ThemeにTaskやNoteを追加してから作成してください。</span></div>}
            </>
          ) : (
            <MarkdownPreview className="context-pack-preview markdown-preview" html={previewHtml(markdown, "markdown")} />
          )}
        </div>
        <footer>
          <button type="button" className="secondary-button" onClick={() => void copyMarkdown()}><IconCopy size={16} />Markdownをコピー</button>
          <button type="button" className="secondary-button" disabled={saving} onClick={() => void savePack()}><IconFileText size={16} />{savedPack ? "保存済み" : "Context Packを保存"}</button>
          <button type="button" className="primary-button" disabled={saving} onClick={() => void createAnswerDraft()}><IconSparkles size={16} />AI回答を受け取る</button>
        </footer>
      </section>
    </div>
  );
}
