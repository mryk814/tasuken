import { Component, memo, type ClipboardEvent, type ErrorInfo, type MouseEvent, type ReactNode, useEffect, useMemo, useRef, useState } from "react";
import {
  BlockTypeSelect,
  BoldItalicUnderlineToggles,
  codeBlockPlugin,
  codeMirrorPlugin,
  CodeToggle,
  CreateLink,
  frontmatterPlugin,
  headingsPlugin,
  imagePlugin,
  InsertImage,
  InsertTable,
  linkPlugin,
  listsPlugin,
  ListsToggle,
  markdownShortcutPlugin,
  MDXEditor,
  type MDXEditorMethods,
  quotePlugin,
  Separator,
  tablePlugin,
  thematicBreakPlugin,
  toolbarPlugin,
  UndoRedo,
} from "@mdxeditor/editor";
import { IconExternalLink, IconLink, IconMessageCircle, IconSparkles } from "@tabler/icons-react";

import { workspaceApi } from "../../../services/workspaceApi";
import { noteExportSignature } from "../../../../../shared/fileExport";
import type { BaseRecord, NoteComment, PageProps } from "../types";
import { NOTE_TYPE_LABELS } from "../lib/domain";
import { str } from "../lib/format";
import { PROMPT_PURPOSE_LABELS } from "../lib/prompts";
import { buildKnowledgeNodeDraftFromNote, isLongKnowledgeSource } from "../lib/knowledgeExtraction";
import { insertStructuredMarkdownPaste, isStructuredMarkdownPaste, previewDocument, previewHtml } from "../lib/markdown";
import { isChatReference } from "../lib/chatRefs";
import { ContextMenu, EmptyState, PageHeader, StatusBadge, type ContextMenuItem } from "../components/common";
import { markdownMathPlugin } from "../components/markdownMathPlugin";

type Combined = BaseRecord & { recordType: "note" | "resource" };
type PreviewMode = "edit" | "preview" | "raw";
type NoteScope = "all" | "memo" | "document" | "resource" | "report" | "prompt" | "learning";
type MarkdownRichEditorProps = {
  markdown: string;
  onChange: (value: string) => void;
  onImageUpload: (file: File) => Promise<string>;
  onError: (message: string) => void;
};
type MarkdownEditorBoundaryProps = {
  markdown: string;
  resetKey: string;
  children: ReactNode;
  onChange: (value: string) => void;
  onPaste: (event: ClipboardEvent<HTMLTextAreaElement>) => void;
  onError: (message: string) => void;
};
type MarkdownEditorBoundaryState = { error: string | null };

function clipboardImageFile(data: DataTransfer): File | null {
  for (const item of Array.from(data.items)) {
    if (item.kind === "file" && item.type.startsWith("image/")) {
      const file = item.getAsFile();
      if (file) return file;
    }
  }
  return Array.from(data.files).find((file) => file.type.startsWith("image/")) || null;
}

function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ""));
    reader.onerror = () => reject(reader.error || new Error("画像を読み取れませんでした。"));
    reader.readAsDataURL(file);
  });
}


class MarkdownEditorBoundary extends Component<MarkdownEditorBoundaryProps, MarkdownEditorBoundaryState> {
  state: MarkdownEditorBoundaryState = { error: null };

  static getDerivedStateFromError(error: unknown): MarkdownEditorBoundaryState {
    return { error: error instanceof Error ? error.message : String(error) };
  }

  componentDidCatch(error: unknown, _info: ErrorInfo): void {
    this.props.onError(error instanceof Error ? error.message : String(error));
  }

  componentDidUpdate(previousProps: MarkdownEditorBoundaryProps): void {
    if (previousProps.resetKey !== this.props.resetKey && this.state.error) {
      this.setState({ error: null });
    }
  }

  render() {
    if (this.state.error) {
      return (
        <textarea
          className="note-main-editor note-main-editor-raw note-editor-fallback"
          value={this.props.markdown}
          onPaste={this.props.onPaste}
          onChange={(event) => this.props.onChange(event.target.value)}
        />
      );
    }
    return this.props.children;
  }
}

const MarkdownRichEditor = memo(function MarkdownRichEditor({
  markdown,
  onChange,
  onImageUpload,
  onError,
}: MarkdownRichEditorProps) {
  const editorRef = useRef<MDXEditorMethods | null>(null);
  const [editorFailed, setEditorFailed] = useState(false);
  const lastInternalMarkdown = useRef(markdown);
  const mountedRef = useRef(false);
  const plugins = useMemo(() => [
    toolbarPlugin({
      toolbarContents: () => (
        <>
          <UndoRedo />
          <Separator />
          <BlockTypeSelect />
          <Separator />
          <BoldItalicUnderlineToggles />
          <CodeToggle />
          <Separator />
          <ListsToggle />
          <CreateLink />
          <InsertImage />
          <InsertTable />
        </>
      ),
    }),
    headingsPlugin(),
    listsPlugin(),
    quotePlugin(),
    thematicBreakPlugin(),
    linkPlugin(),
    markdownMathPlugin(),
    imagePlugin({
      imageUploadHandler: onImageUpload,
      disableImageResize: false,
      disableImageSettingsButton: false,
    }),
    tablePlugin(),
    codeBlockPlugin({ defaultCodeBlockLanguage: "text" }),
    codeMirrorPlugin({
      codeBlockLanguages: {
        text: "Text",
        markdown: "Markdown",
        js: "JavaScript",
        ts: "TypeScript",
        python: "Python",
        css: "CSS",
        json: "JSON",
        sql: "SQL",
      },
    }),
    frontmatterPlugin(),
    markdownShortcutPlugin(),
  ], [onImageUpload]);

  useEffect(() => {
    mountedRef.current = false;
    const timer = window.setTimeout(() => { mountedRef.current = true; }, 200);
    return () => window.clearTimeout(timer);
  }, [markdown]);

  useEffect(() => {
    if (markdown === lastInternalMarkdown.current) return;
    if (editorRef.current?.getMarkdown() !== markdown) {
      editorRef.current?.setMarkdown(markdown);
    }
    lastInternalMarkdown.current = markdown;
    setEditorFailed(false);
  }, [markdown]);

  function handleRichEditorPaste(event: ClipboardEvent<HTMLDivElement>) {
    if (clipboardImageFile(event.clipboardData)) return;
    const text = event.clipboardData.getData("text/plain");
    if (!isStructuredMarkdownPaste(text)) return;
    event.preventDefault();
    event.stopPropagation();
    const current = editorRef.current?.getMarkdown() || markdown;
    const selection = window.getSelection();
    const anchorText = selection?.anchorNode?.nodeType === Node.TEXT_NODE ? selection.anchorNode.nodeValue || "" : "";
    const anchorOffset = typeof selection?.anchorOffset === "number" ? selection.anchorOffset : 0;
    const next = insertStructuredMarkdownPaste(current, text, anchorText, anchorOffset);
    lastInternalMarkdown.current = next;
    editorRef.current?.setMarkdown(next);
    onChange(next);
  }

  if (editorFailed) {
    return (
      <textarea
        className="note-main-editor note-main-editor-raw"
        value={markdown}
        onChange={(event) => onChange(event.target.value)}
      />
    );
  }

  return (
    <div className="note-live-editor-paste-scope" onPasteCapture={handleRichEditorPaste}>
      <MDXEditor
        ref={editorRef}
        className="note-live-editor note-mdx-editor"
        contentEditableClassName="note-mdx-content markdown-preview"
        markdown={markdown}
        onChange={(value) => {
          lastInternalMarkdown.current = value;
          if (!mountedRef.current && value === markdown) return;
          onChange(value);
        }}
        onError={({ error }) => {
          setEditorFailed(true);
          onError(error);
        }}
        plugins={plugins}
        spellCheck
      />
    </div>
  );
});

function noteFormat(record: BaseRecord): string {
  return str(record.content_format) || (str(record.note_type) === "artifact" ? "markdown" : "plain");
}

function noteProperties(record: BaseRecord): Record<string, unknown> {
  return record.properties_json && typeof record.properties_json === "object" && !Array.isArray(record.properties_json)
    ? record.properties_json as Record<string, unknown>
    : {};
}

function noteScope(record: Combined): NoteScope {
  if (record.recordType === "resource") return "resource";
  const type = str(record.note_type) || "memo";
  if (type === "artifact") return "document";
  if (type === "report") return "report";
  if (type === "prompt" || type === "report_prompt") return "prompt";
  if (type === "learning" || type === "reflection") return "learning";
  return "memo";
}

function canCreateKnowledge(record: Combined): boolean {
  const scope = noteScope(record);
  return record.recordType === "note" && (scope === "memo" || scope === "learning");
}

export function NotesPage({ themes, domain, activeTheme, openDrawer, saveEntity, setToast }: PageProps) {
  const [query, setQuery] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [previewMode, setPreviewMode] = useState<PreviewMode>("edit");
  const [scope, setScope] = useState<NoteScope>("all");
  const [draftBody, setDraftBody] = useState("");
  const [draftState, setDraftState] = useState("");
  const [pdfExporting, setPdfExporting] = useState(false);
  const [markdownExporting, setMarkdownExporting] = useState(false);
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; items: ContextMenuItem[] } | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const previewPanelRef = useRef<HTMLElement | null>(null);
  const ctxRef = useRef<{ selected: Combined | null; draftBody: string; draftDirty: boolean }>({ selected: null, draftBody: "", draftDirty: false });
  const records: Combined[] = [
    ...domain.notes.map((note) => ({ ...note, recordType: "note" as const } as Combined)),
    ...domain.resources.filter((resource) => !isChatReference(resource)).map((r) => ({ ...r, recordType: "resource" as const } as Combined)),
  ].sort((a, b) => String(b.updated_at || "").localeCompare(String(a.updated_at || "")));
  const visible = records.filter((record) => {
    if (scope !== "all" && noteScope(record) !== scope) return false;
    return `${str(record.title)} ${str(record.body_markdown || record.description)} ${str(record.url || record.source_url)}`
      .toLowerCase()
      .includes(query.toLowerCase());
  });
  const markdownNotes = visible.filter((record) => record.recordType === "note" && noteFormat(record) === "markdown" && str(record.body_markdown).trim());
  const selected = markdownNotes.find((record) => record.id === selectedId) || markdownNotes[0] || null;
  const selectedTheme = selected ? themes.find((theme) => theme.id === selected.theme_id) : null;
  const selectedBody = selected ? str(selected.body_markdown) : "";
  const effectiveBody = previewMode === "preview" ? selectedBody : draftBody;
  const selectedProperties = selected ? noteProperties(selected) : {};
  const markdownExport = selectedProperties.markdown_export && typeof selectedProperties.markdown_export === "object" && !Array.isArray(selectedProperties.markdown_export)
    ? selectedProperties.markdown_export as Record<string, unknown>
    : null;
  const markdownExportFilePath = str(markdownExport?.filePath);
  const markdownExportDirectory = str(markdownExport?.directory);
  const markdownExportOpenPath = markdownExportFilePath || markdownExportDirectory;
  const currentExportSignature = noteExportSignature(selectedBody);
  const markdownExportStale = Boolean(str(markdownExport?.bodySignature) && str(markdownExport?.bodySignature) !== currentExportSignature);
  const hasMarkdownExportDirectory = Boolean(str(markdownExport?.directory));
  const draftDirty = Boolean(selected && draftBody !== selectedBody);

  useEffect(() => {
    setDraftBody(selectedBody);
    setDraftState("");
  }, [selected?.id, selectedBody]);

  ctxRef.current = { selected, draftBody, draftDirty };

  // 未保存の変更を、別ノートへの切り替え時・Notesページからの離脱時に自動保存する。
  // ctxRefはレンダー中に新しい選択で上書きされるため、コミット済みの値を保持する専用refを使う。
  const autosaveRef = useRef<{ selected: Combined | null; draftBody: string; draftDirty: boolean }>({ selected: null, draftBody: "", draftDirty: false });
  useEffect(() => {
    autosaveRef.current = { selected, draftBody, draftDirty };
  });
  useEffect(() => {
    return () => {
      const { selected: previous, draftBody: body, draftDirty: dirty } = autosaveRef.current;
      if (!previous || !dirty) return;
      // 本文が空だとnote.body_markdownの必須項目バリデーションに失敗するため、自動保存では既存内容を残して何もしない。
      if (!body.trim()) return;
      saveEntity("note", { ...previous, body_markdown: body })
        .catch((error: unknown) => setToast(`自動保存に失敗しました。${error instanceof Error ? error.message : String(error)}`));
    };
  }, [selected?.id, saveEntity, setToast]);

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if ((event.ctrlKey || event.metaKey) && event.key === "s") {
        event.preventDefault();
        const { selected: s, draftBody: body, draftDirty: dirty } = ctxRef.current;
        if (dirty && s) {
          if (!body.trim()) {
            setDraftState("本文を空にしたままでは保存できません。内容を入力してください。");
            return;
          }
          setDraftState("保存しています。");
          saveEntity("note", { ...s, body_markdown: body })
            .then(() => setDraftState("保存しました。"))
            .catch((error: unknown) => setDraftState(error instanceof Error ? error.message : "保存できませんでした。"));
        }
      }
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [saveEntity]);

  function copy() {
    workspaceApi
      .copyText(visible.map((record) => `${str(record.title)}\t${record.recordType === "resource" ? "リソース" : str(record.note_type)}\t${themes.find((theme) => theme.id === (record.project_id || record.theme_id))?.name || "—"}\t${str(record.url || record.source_url)}`).join("\n"))
      .then(() => setToast("Notes一覧をコピーしました。"));
  }

  function addPrompt(purpose = "report") {
    openDrawer({
      type: "note",
      mode: "edit",
      entity: {
        theme_id: activeTheme?.id || null,
        note_type: "prompt",
        content_format: "markdown",
        title: `${PROMPT_PURPOSE_LABELS[purpose] || "汎用"}プロンプト`,
        properties_json: {
          prompt_purpose: purpose,
          prompt_variables: "themeName, periodStart, periodEnd",
          is_default: false,
          ai_export_enabled: true,
        },
        body_markdown: "",
      },
    });
  }

  async function moveResourceToChatRefs(record: Combined) {
    if (record.recordType !== "resource") return;
    await saveEntity("resource", {
      ...record,
      resource_scope: "chat_ref",
      reference_status: str(record.reference_status) || "inbox",
    });
    setToast("チャット参照へ移しました。");
  }

  async function copySelectedRaw() {
    if (!selected) return;
    await workspaceApi.copyText(effectiveBody);
    setToast("本文をコピーしました。");
  }

  function openRecord(record: Combined, isMarkdown: boolean) {
    if (isMarkdown) {
      setSelectedId(record.id);
      setPreviewMode("edit");
      return;
    }
    openDrawer({ type: record.recordType, entity: record });
  }

  function knowledgeFromNote(record: Combined) {
    if (isLongKnowledgeSource(record.body_markdown)) {
      openDrawer({ type: "note", entity: record });
      setToast("本文が長いため、Knowledge候補の抽出導線を開きました。");
      return;
    }
    openDrawer({
      type: "knowledge_node",
      mode: "edit",
      entity: buildKnowledgeNodeDraftFromNote(record),
    });
  }

  function showRecordMenu(event: MouseEvent, record: Combined, isMarkdown: boolean, url: string) {
    event.preventDefault();
    const items: ContextMenuItem[] = [
      { label: isMarkdown ? "本文を開く" : "詳細を開く", onSelect: () => openRecord(record, isMarkdown) },
      { label: "編集する", onSelect: () => openDrawer({ type: record.recordType, mode: "edit", entity: record }) },
      { label: "タイトルをコピー", onSelect: () => workspaceApi.copyText(str(record.title)) },
    ];
    if (canCreateKnowledge(record)) items.push({ label: "学びとしてKnowledge化", onSelect: () => knowledgeFromNote(record) });
    if (url) {
      items.push(
        { label: "リンクを開く", onSelect: () => window.open(url, "_blank", "noreferrer") },
        { label: "URLをコピー", onSelect: () => workspaceApi.copyText(url) },
      );
    }
    setContextMenu({ x: event.clientX, y: event.clientY, items });
  }

  async function openMarkdownExportPath(filePath: string) {
    const result = await workspaceApi.openPath(filePath);
    if (result.ok) {
      setToast("Markdownファイルを開きました。", "success");
      return;
    }
    setToast(result.error || "Markdownファイルを開けませんでした。", "danger");
  }

  function modeScroller(mode: PreviewMode): HTMLElement | null {
    const panel = previewPanelRef.current;
    if (!panel) return null;
    if (mode === "raw") return panel.querySelector<HTMLElement>("textarea.note-main-editor-raw");
    if (mode === "preview") return panel.querySelector<HTMLElement>(".note-main-preview");
    return panel.querySelector<HTMLElement>('[class*="_rootContentEditableWrapper_"]');
  }

  function scrollRatio(element: HTMLElement | null): number {
    if (!element) return 0;
    const scrollable = element.scrollHeight - element.clientHeight;
    return scrollable > 0 ? element.scrollTop / scrollable : 0;
  }

  // MDXEditorはマウント直後に本文の高さが伸びていくため、高さが安定するまで数フレーム復元を続ける。
  function restoreModeScroll(mode: PreviewMode, ratio: number) {
    let frames = 0;
    let lastHeight = -1;
    const apply = () => {
      frames += 1;
      const target = modeScroller(mode);
      if (target) {
        const scrollable = target.scrollHeight - target.clientHeight;
        if (scrollable > 0) target.scrollTop = ratio * scrollable;
        if (scrollable > 0 && target.scrollHeight === lastHeight) return;
        lastHeight = target.scrollHeight;
      }
      if (frames < 20) window.requestAnimationFrame(apply);
    };
    window.requestAnimationFrame(apply);
  }

  function switchPreviewMode(nextMode: PreviewMode) {
    if (nextMode === previewMode) return;
    const ratio = scrollRatio(modeScroller(previewMode));
    setPreviewMode(nextMode);
    restoreModeScroll(nextMode, ratio);
  }

  function insertDraftMarkdown(markdown: string, selectionStart: number, selectionEnd: number) {
    setDraftBody((current) => `${current.slice(0, selectionStart)}${markdown}${current.slice(selectionEnd)}`);
    window.setTimeout(() => {
      const position = selectionStart + markdown.length;
      textareaRef.current?.focus();
      textareaRef.current?.setSelectionRange(position, position);
    }, 0);
  }

  async function handleDraftPaste(event: ClipboardEvent<HTMLTextAreaElement>) {
    const image = clipboardImageFile(event.clipboardData);
    if (!image) return;

    event.preventDefault();
    const target = event.currentTarget;
    const selectionStart = target.selectionStart;
    const selectionEnd = target.selectionEnd;
    setDraftState("画像を保存しています。");

    try {
      const result = await workspaceApi.saveMarkdownImageAttachment({
        fileName: image.name || "pasted-image",
        mimeType: image.type || "image/png",
        dataUrl: await readFileAsDataUrl(image),
      });
      const alt = result.fileName.replace(/\.[^.]+$/, "") || "貼り付け画像";
      insertDraftMarkdown(`![${alt}](${result.url})`, selectionStart, selectionEnd);
      setDraftState("画像を挿入しました。");
    } catch (error) {
      setDraftState(error instanceof Error ? error.message : "画像を挿入できませんでした。");
    }
  }

  async function uploadEditorImage(image: File): Promise<string> {
    setDraftState("画像を保存しています。");
    try {
      const result = await workspaceApi.saveMarkdownImageAttachment({
        fileName: image.name || "pasted-image",
        mimeType: image.type || "image/png",
        dataUrl: await readFileAsDataUrl(image),
      });
      setDraftState("画像を挿入しました。");
      return result.url;
    } catch (error) {
      const message = error instanceof Error ? error.message : "画像を挿入できませんでした。";
      setDraftState(message);
      throw new Error(message);
    }
  }

  async function saveSelectedDraft() {
    if (!selected || !draftDirty) return;
    if (!draftBody.trim()) {
      setDraftState("本文を空にしたままでは保存できません。内容を入力してください。");
      return;
    }
    setDraftState("保存しています。");
    try {
      await saveEntity("note", {
        ...selected,
        body_markdown: draftBody,
      });
      setDraftState("保存しました。");
    } catch (error) {
      setDraftState(error instanceof Error ? error.message : "保存できませんでした。");
    }
  }

  function publishMarkdownContent(note: Combined, themeName: string, bodyMarkdown: string): string {
    const metadata = [
      "---",
      `title: ${JSON.stringify(str(note.title))}`,
      themeName ? `theme: ${JSON.stringify(themeName)}` : "",
      str(note.updated_at || note.created_at) ? `updated_at: ${JSON.stringify(str(note.updated_at || note.created_at))}` : "",
      "---",
      "",
    ].filter((line) => line !== "").join("\n");
    return `${metadata}${bodyMarkdown.trim()}\n`;
  }

  async function exportSelectedMarkdown(chooseDirectory: boolean) {
    if (!selected) return;
    setMarkdownExporting(true);
    try {
      const bodyForExport = draftBody || selectedBody;
      const content = publishMarkdownContent(selected, selectedTheme?.name || "", bodyForExport);
      const result = await workspaceApi.exportMarkdownFile({
        title: str(selected.title),
        content,
        directory: str(markdownExport?.directory) || null,
        chooseDirectory,
        fileName: `${str(selected.title) || "markdown-document"}.md`,
      });
      if (result.canceled) {
        setToast("Markdown出力をキャンセルしました。", "info");
        return;
      }
      await saveEntity("note", {
        ...selected,
        properties_json: {
          ...selectedProperties,
          markdown_export: {
            directory: result.directory,
            filePath: result.filePath,
            exportedAt: result.exportedAt,
            bodySignature: noteExportSignature(bodyForExport),
          },
        },
      });
      setToast(`Markdownを出力しました。${result.filePath || ""}`, "success");
    } catch (error) {
      setToast(`Markdown出力に失敗しました。${error instanceof Error ? error.message : String(error)}`, "danger");
    } finally {
      setMarkdownExporting(false);
    }
  }

  async function exportSelectedPdf() {
    if (!selected) return;
    setPdfExporting(true);
    try {
      const content = publishMarkdownContent(selected, selectedTheme?.name || "", draftBody || selectedBody);
      const result = await workspaceApi.exportMarkdownPdf({
        title: str(selected.title),
        html: previewDocument(content, "markdown"),
        chooseDirectory: true,
        fileName: `${str(selected.title) || "markdown-document"}.pdf`,
      });
      if (result.canceled) {
        setToast("PDF出力をキャンセルしました。", "info");
        return;
      }
      setToast(`PDFを出力しました。${result.filePath || ""}`, "success");
    } catch (error) {
      setToast(`PDF出力に失敗しました。${error instanceof Error ? error.message : String(error)}`, "danger");
    } finally {
      setPdfExporting(false);
    }
  }

  return (
    <div className="page notes-page">
      <PageHeader title="Notes & Resources" subtitle="作業ログや素材はここへ入れ、判断に使う部品だけKnowledge化します">
        <button className="secondary-button" onClick={copy}>一覧をコピー</button>
        <button className="secondary-button" onClick={() => openDrawer({ type: "resource", mode: "edit", entity: {} })}>リソースを追加</button>
        <button className="secondary-button" onClick={() => openDrawer({ type: "note", mode: "edit", entity: { note_type: "artifact", content_format: "markdown" } })}>Markdown文書</button>
        <button className="secondary-button" onClick={() => addPrompt()}>プロンプトを追加</button>
        <button className="primary-button" onClick={() => openDrawer({ type: "note", mode: "edit", entity: {} })}>メモを書く</button>
      </PageHeader>
      <div className="filter-bar panel">
        <input data-search value={query} onChange={(event) => setQuery(event.target.value)} placeholder="タイトル、本文、URLを検索" />
        <div className="segmented" aria-label="表示する種類">
          {[
            ["all", "すべて"],
            ["memo", "メモ"],
            ["document", "文書"],
            ["resource", "リソース"],
            ["report", "報告書"],
            ["prompt", "プロンプト"],
            ["learning", "学び"],
          ].map(([value, label]) => (
            <button key={value} className={scope === value ? "is-active" : ""} onClick={() => setScope(value as NoteScope)}>
              {label}
            </button>
          ))}
        </div>
        <span>{visible.length}件</span>
      </div>
      <div className="notes-workbench">
        <section className="panel list-page notes-list-panel">
          {visible.map((record) => {
            const comments = record.comments as NoteComment[] | undefined;
            const url = str(record.source_url || record.url);
            const isMarkdown = record.recordType === "note" && noteFormat(record) === "markdown" && Boolean(str(record.body_markdown).trim());
            const isSelected = selected?.id === record.id;
            return (
              <div
                className={`note-row ${isSelected ? "is-selected" : ""}`}
                key={`${record.recordType}-${record.id}`}
                onContextMenu={(event) => showRecordMenu(event, record, isMarkdown, url)}
              >
                <button
                  className="note-row-main"
                  onClick={() => openRecord(record, isMarkdown)}
                >
                  <span className="note-row-head">
                    <StatusBadge value="neutral" label={record.recordType === "resource" ? "リソース" : (NOTE_TYPE_LABELS[str(record.note_type)] || str(record.note_type))} />
                    <strong className="note-row-title">{str(record.title)}</strong>
                    {record.recordType === "note" && comments && comments.length > 0 && <span className="comment-count" aria-label={`${comments.length}件のコメント`}>{comments.length}</span>}
                  </span>
                  <span className="note-row-body">{str(record.body_markdown || record.description || record.url) || "本文なし"}</span>
                </button>
                {canCreateKnowledge(record) && (
                  <button
                    className="row-action-button note-row-open"
                    onClick={() => knowledgeFromNote(record)}
                    aria-label={`${str(record.title) || "メモ"}をKnowledge化`}
                    title="Knowledge化"
                  >
                    <IconSparkles size={15} />
                  </button>
                )}
                {url && (
                  <a
                    className="row-action-button note-row-open"
                    href={url}
                    target="_blank"
                    rel="noreferrer"
                    aria-label={`${str(record.title) || "リンク"}を開く`}
                    title="開く"
                  >
                    <IconExternalLink size={15} />
                  </a>
                )}
                {record.recordType === "resource" && (
                  <button
                    className="row-action-button note-row-open"
                    onClick={() => moveResourceToChatRefs(record)}
                    aria-label={`${str(record.title) || "リソース"}をチャット参照へ移す`}
                    title="チャット参照へ移す"
                  >
                    <IconMessageCircle size={15} />
                  </button>
                )}
              </div>
            );
          })}
          {!visible.length && <EmptyState title="一致するメモはありません" action="メモを書く" onAction={() => openDrawer({ type: "note", mode: "edit", entity: {} })} />}
        </section>
        {contextMenu && <ContextMenu x={contextMenu.x} y={contextMenu.y} items={contextMenu.items} onClose={() => setContextMenu(null)} />}
        <section className="panel note-preview-panel" ref={previewPanelRef}>
          {selected ? (
            <>
              <div className="note-preview-header">
                <div>
                  <span className="note-preview-theme">{selectedTheme?.name || "Theme未設定"}</span>
                  <h2>{str(selected.title)}</h2>
                </div>
                <div className="note-preview-actions">
                  <button className="secondary-button compact" onClick={copySelectedRaw}>本文をコピー</button>
                  <button className="secondary-button compact" disabled={!draftDirty} onClick={() => {
                    setDraftBody(selectedBody);
                    setDraftState("変更を戻しました。");
                  }}>戻す</button>
                  <button className="primary-button compact" disabled={!draftDirty} onClick={saveSelectedDraft} title="Ctrl+S">保存</button>
                  <button
                    className="secondary-button compact"
                    onClick={() => knowledgeFromNote(selected)}
                  >
                    Knowledge化
                  </button>
                </div>
              </div>
              {(draftState || draftDirty) && <span className={`note-draft-state ${draftDirty ? "is-dirty" : ""}`}>{draftState || "本文変更あり"}</span>}
              <div className={`document-publish-panel document-publish-strip ${markdownExportStale ? "needs-export" : ""}`}>
                <div className="document-publish-title">
                  <strong>Document Publish</strong>
                  {markdownExportOpenPath && (
                    <button
                      className="document-publish-open"
                      type="button"
                      title={markdownExportOpenPath}
                      aria-label="出力先を開く"
                      onClick={() => openMarkdownExportPath(markdownExportOpenPath)}
                    >
                      <IconLink size={15} stroke={1.8} />
                    </button>
                  )}
                  {markdownExportStale && <span className="save-status save-status-error">要再出力</span>}
                </div>
                <div className="document-publish-actions">
                  <div className="segmented note-editor-mode-tabs" aria-label="Markdown表示">
                    <button className={previewMode === "edit" ? "is-active" : ""} onClick={() => switchPreviewMode("edit")}>編集</button>
                    <button className={previewMode === "preview" ? "is-active" : ""} onClick={() => switchPreviewMode("preview")}>Preview</button>
                    <button className={previewMode === "raw" ? "is-active" : ""} onClick={() => switchPreviewMode("raw")}>Raw</button>
                  </div>
                  <button className="primary-button compact" disabled={markdownExporting} onClick={() => exportSelectedMarkdown(!hasMarkdownExportDirectory)}>
                    {markdownExporting ? "出力中" : hasMarkdownExportDirectory ? "Markdown" : "出力先を選ぶ"}
                  </button>
                  {hasMarkdownExportDirectory && (
                    <button className="secondary-button compact" disabled={markdownExporting} onClick={() => exportSelectedMarkdown(true)}>変更</button>
                  )}
                  <button className="secondary-button compact" disabled={pdfExporting} onClick={exportSelectedPdf}>
                    {pdfExporting ? "出力中" : "PDF"}
                  </button>
                </div>
              </div>
              {previewMode === "edit" ? (
                <MarkdownEditorBoundary
                  markdown={draftBody}
                  resetKey={selected.id}
                  onChange={(value) => {
                    setDraftBody(value);
                    if (draftState) setDraftState("");
                  }}
                  onPaste={handleDraftPaste}
                  onError={(message) => setDraftState(`Markdownを読み込めませんでした。${message}`)}
                >
                  <MarkdownRichEditor
                    markdown={draftBody}
                    onChange={(value) => {
                      setDraftBody(value);
                      if (draftState) setDraftState("");
                    }}
                    onImageUpload={uploadEditorImage}
                    onError={(message) => setDraftState(`Markdownを読み込めませんでした。${message}`)}
                  />
                </MarkdownEditorBoundary>
              ) : previewMode === "preview" ? (
                <div className="note-main-preview markdown-preview" dangerouslySetInnerHTML={{ __html: previewHtml(draftBody, "markdown") }} />
              ) : (
                <textarea
                  ref={textareaRef}
                  className="note-main-editor note-main-editor-raw"
                  value={draftBody}
                  onPaste={handleDraftPaste}
                  onChange={(event) => {
                    setDraftBody(event.target.value);
                    if (draftState) setDraftState("");
                  }}
                />
              )}
            </>
          ) : (
            <EmptyState title="Markdown文書はありません" action="Markdown文書" onAction={() => openDrawer({ type: "note", mode: "edit", entity: { note_type: "artifact", content_format: "markdown" } })} />
          )}
        </section>
      </div>
    </div>
  );
}
