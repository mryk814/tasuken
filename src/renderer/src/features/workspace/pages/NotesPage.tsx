import {
  IconExternalLink,
  IconFileTypePdf,
  IconFolder,
  IconLink,
  IconNotes,
  IconPrompt,
  IconReport,
  IconSparkles,
} from "@tabler/icons-react";
import {
  lazy,
  startTransition,
  Suspense,
  useCallback,
  useDeferredValue,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ClipboardEvent,
  type MouseEvent,
} from "react";

import { noteExportSignature } from "../../../../../shared/fileExport";
import { isFocusSession } from "../../../../../shared/focusSession.mjs";
import { workspaceApi } from "../../../services/workspaceApi";
import { ContextMenu, EmptyState, PageHeader, type ContextMenuItem } from "../components/common";
import { DraftWorkspaceDialog } from "../components/DraftWorkspaceDialog";
import { MarkdownHeadingIndex } from "../components/MarkdownHeadingIndex";
import { MarkdownDiffMarkerRail } from "../components/MarkdownDiffMarkerRail";
import { MarkdownEditorBoundary } from "../components/MarkdownEditorBoundary";
import { MarkdownPreview } from "../components/MarkdownPreview";
import { clipboardImageFile, readFileAsDataUrl } from "../lib/clipboardImage";
import { isChatReference } from "../lib/chatRefs";
import { NOTES_KIND_LABELS, notesKindFromNoteType, themeColor, type NotesKind } from "../lib/domain";
import { str } from "../lib/format";
import { buildKnowledgeNodeDraftFromNote, isLongKnowledgeSource } from "../lib/knowledgeExtraction";
import { buildMarkdownDiffHunks, buildMarkdownDiffMarkers, diffMarkdownLines, findMarkdownMatches, formatMarkdown, restoreMarkdownDiffHunk, type MarkdownDiffMarker } from "../lib/markdownEditing";
import {
  extractMarkdownHeadings,
  HEADING_NUMBER_LEVELS,
  HEADING_NUMBER_LEVEL_LABELS,
  headingNumberOptionsFromProperties,
  normalizeHeadingNumberLevels,
  normalizeHeadingNumberStart,
  normalizeRichEditorMarkdown,
  previewDocument,
  previewHtml,
  type HeadingNumberLevel,
  type MarkdownHeadingItem,
} from "../lib/markdown";
import { renderMermaidDocumentForPdf } from "../lib/mermaid";
import { PROMPT_PURPOSE_LABELS } from "../lib/prompts";
import type { BaseRecord, NoteComment, PageProps } from "../types";
import { usePersistentState } from "../../../utils/usePersistentState";
import { compactNotesBodyPreview, DEFAULT_NOTES_PREFS, compareNotesRecords, type NotesPreferences, type NotesSortOrder } from "../lib/notes";
import {
  buildSelectionExtractionOperations,
  type MarkdownTextSelection,
  type SelectionExtractionKind,
} from "../lib/selectionExtraction";

type Combined = BaseRecord & { recordType: "note" | "resource" };
type PreviewMode = "edit" | "preview" | "raw";
type NoteScope = "all" | NotesKind;

const NOTES_RENDER_BATCH_SIZE = 48;
const loadMarkdownRichEditor = async () => {
  const module = await import("../components/MarkdownRichEditor");
  return { default: module.MarkdownRichEditor };
};
const MarkdownRichEditor = lazy(loadMarkdownRichEditor);

function NotesKindIcon({ kind, size = 15 }: { kind: NotesKind; size?: number }) {
  const props = { size, stroke: 1.75, "aria-hidden": true as const };
  switch (kind) {
    case "resource":
      return <IconLink {...props} />;
    case "report":
      return <IconReport {...props} />;
    case "prompt":
      return <IconPrompt {...props} />;
    default:
      return <IconNotes {...props} />;
  }
}

function noteProperties(record: BaseRecord): Record<string, unknown> {
  return record.properties_json && typeof record.properties_json === "object" && !Array.isArray(record.properties_json)
    ? record.properties_json as Record<string, unknown>
    : {};
}

function recordKind(record: Combined): NotesKind {
  if (record.recordType === "resource") return "resource";
  return notesKindFromNoteType(str(record.note_type));
}

function recordBody(record: Combined): string {
  if (record.recordType === "resource") {
    return str(record.body_markdown) || str(record.description);
  }
  return str(record.body_markdown);
}

function recordBodyPreview(record: Combined, limit = 180): string {
  return compactNotesBodyPreview(recordBody(record), limit);
}

function hasMarkdownFootnotes(value: string): boolean {
  return /(?:^|\n)\[\^[^\]\n]+\]:|\[\^[^\]\n]+\]/.test(value);
}

function noteDateLabel(value: unknown): string {
  const raw = str(value);
  if (!raw) return "";
  const date = new Date(raw);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleString("ja-JP", { year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" });
}

function canCreateKnowledge(record: Combined): boolean {
  return record.recordType === "note" && recordKind(record) === "note";
}

function isWorkbenchRecord(record: Combined): boolean {
  if (record.recordType === "resource") return true;
  return record.recordType === "note";
}

export function NotesPage({ data, themes, domain, activeTheme, openDrawer, navigate, saveEntity, saveEntities, setToast }: PageProps) {
  const [query, setQuery] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  // Notesへ入った瞬間は読む面だけを出し、重いMDXEditorはEditを選んだ時に初めて起動する。
  const [previewMode, setPreviewMode] = useState<PreviewMode>("preview");
  const [prefs, setPrefs] = usePersistentState<NotesPreferences>("notes:prefs:v1", DEFAULT_NOTES_PREFS);
  const scope = prefs.scope;
  const sortOrder = prefs.sortOrder;
  const records = useMemo<Combined[]>(() => [
    ...domain.notes
      .filter((note) => !isFocusSession(note as unknown as Record<string, unknown>))
      .map((note) => ({ ...note, recordType: "note" as const } as Combined)),
    ...domain.resources
      .filter((resource) => !isChatReference(resource))
      .map((resource) => ({ ...resource, recordType: "resource" as const } as Combined)),
  ].sort((a, b) => compareNotesRecords(a, b, sortOrder)), [domain.notes, domain.resources, sortOrder]);
  const normalizedQuery = query.trim().toLocaleLowerCase();
  const visible = useMemo(() => records.filter((record) => {
    if (scope !== "all" && recordKind(record) !== scope) return false;
    if (!normalizedQuery) return true;
    return `${str(record.title)} ${recordBody(record)} ${str(record.url || record.source_url)}`
      .toLocaleLowerCase()
      .includes(normalizedQuery);
  }), [normalizedQuery, records, scope]);
  const [visibleLimit, setVisibleLimit] = useState(NOTES_RENDER_BATCH_SIZE);
  const renderedRecords = visible.slice(0, visibleLimit);
  const workbenchRecords = useMemo(() => visible.filter(isWorkbenchRecord), [visible]);
  const selected = useMemo(
    () => workbenchRecords.find((record) => record.id === selectedId) || workbenchRecords[0] || null,
    [selectedId, workbenchRecords],
  );
  const selectedBody = selected ? recordBody(selected) : "";
  // 初回描画を空本文→実本文の二段階にせず、Preview/Editの再構築を一度にする。
  const [draftBody, setDraftBody] = useState(() => normalizeRichEditorMarkdown(selectedBody));
  const [richEditorDirty, setRichEditorDirty] = useState(false);
  const [draftState, setDraftState] = useState("");
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchIndex, setSearchIndex] = useState(0);
  const [diffOpen, setDiffOpen] = useState(false);
  const [draftWorkspaceTarget, setDraftWorkspaceTarget] = useState<BaseRecord | null | undefined>(undefined);
  const [pdfExporting, setPdfExporting] = useState(false);
  const [markdownExporting, setMarkdownExporting] = useState(false);
  const [recentExtraction, setRecentExtraction] = useState<{
    type: SelectionExtractionKind;
    title: string;
    entity: BaseRecord;
  } | null>(null);
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; items: ContextMenuItem[] } | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const searchInputRef = useRef<HTMLInputElement | null>(null);
  const previewPanelRef = useRef<HTMLElement | null>(null);
  const markdownSurfaceRef = useRef<HTMLDivElement | null>(null);
  const mdxMarkdownSourceRef = useRef<(() => string) | null>(null);
  const selectedBodyRef = useRef(selectedBody);
  const ctxRef = useRef<{ selected: Combined | null; draftBody: string; draftDirty: boolean }>({ selected: null, draftBody: "", draftDirty: false });
  const commandActionsRef = useRef<Record<string, () => void | Promise<void>>>({});
  const selectedKind = selected ? recordKind(selected) : null;
  // Markdown・PDF 出力は Note と Report だけ。Resource / Prompt は出さない。
  const showDocumentPublish = selectedKind === "note" || selectedKind === "report";
  const selectedTheme = selected
    ? themes.find((theme) => theme.id === (selected.theme_id || selected.project_id))
    : null;
  const effectiveBody = previewMode === "preview" ? selectedBody : draftBody;
  const selectedUrl = selected ? str(selected.url || selected.source_url) : "";
  const selectedProperties = selected ? noteProperties(selected) : {};
  const headingNumberOptions = useMemo(
    () => headingNumberOptionsFromProperties(selectedProperties),
    [selectedProperties],
  );
  const headingNumbersEnabled = headingNumberOptions.preview.headingNumbers === true;
  const headingNumberStart = normalizeHeadingNumberStart(headingNumberOptions.preview.headingNumberStart);
  const headingNumberLevels = normalizeHeadingNumberLevels(headingNumberOptions.preview.headingNumberLevels);
  const headingNumberLevelSummary = headingNumberLevels.length
    ? headingNumberLevels.map((level) => HEADING_NUMBER_LEVEL_LABELS[level as HeadingNumberLevel]).join("–")
    : "選択なし";
  const markdownExport = selectedProperties.markdown_export && typeof selectedProperties.markdown_export === "object" && !Array.isArray(selectedProperties.markdown_export)
    ? selectedProperties.markdown_export as Record<string, unknown>
    : null;
  const markdownExportFilePath = str(markdownExport?.filePath);
  const markdownExportDirectory = str(markdownExport?.directory);
  const markdownExportOpenPath = markdownExportFilePath || markdownExportDirectory;
  const currentExportSignature = noteExportSignature(selectedBody);
  const markdownExportStale = Boolean(str(markdownExport?.bodySignature) && str(markdownExport?.bodySignature) !== currentExportSignature);
  const hasMarkdownExportDirectory = Boolean(str(markdownExport?.directory));
  const draftDirty = Boolean(selected && (richEditorDirty || draftBody !== selectedBody));
  const closeDraftWorkspace = useCallback(() => setDraftWorkspaceTarget(undefined), []);
  // Editのキー入力を最優先し、見出し索引など全文走査が必要な派生表示は後続レンダーへ送る。
  const deferredDraftBody = useDeferredValue(draftBody);
  const [indexedDraftBody, setIndexedDraftBody] = useState(draftBody);
  const markdownHeadings = useMemo(() => extractMarkdownHeadings(indexedDraftBody), [indexedDraftBody]);
  const searchMatches = useMemo(
    () => searchOpen && searchQuery.trim() ? findMarkdownMatches(deferredDraftBody, searchQuery) : [],
    [deferredDraftBody, searchOpen, searchQuery],
  );
  const markdownDiff = useMemo(
    () => diffOpen && draftDirty ? diffMarkdownLines(selectedBody, deferredDraftBody) : [],
    [deferredDraftBody, diffOpen, draftDirty, selectedBody],
  );
  const markdownDiffHunks = useMemo(() => buildMarkdownDiffHunks(markdownDiff), [markdownDiff]);
  const markdownDiffMarkers = useMemo(() => buildMarkdownDiffMarkers(markdownDiff), [markdownDiff]);
  const draftLineCount = useMemo(
    () => diffOpen ? deferredDraftBody.replace(/\r\n?/g, "\n").split("\n").length : 0,
    [deferredDraftBody, diffOpen],
  );

  useEffect(() => {
    setVisibleLimit(NOTES_RENDER_BATCH_SIZE);
  }, [normalizedQuery, scope, sortOrder]);

  useEffect(() => {
    const timer = window.setTimeout(() => setIndexedDraftBody(draftBody), 240);
    return () => window.clearTimeout(timer);
  }, [draftBody]);

  useEffect(() => {
    if (visibleLimit >= visible.length) return;
    const addNextBatch = () => {
      setVisibleLimit((current) => Math.min(current + NOTES_RENDER_BATCH_SIZE, visible.length));
    };
    const idleId = window.requestIdleCallback(addNextBatch, { timeout: 180 });
    return () => window.cancelIdleCallback(idleId);
  }, [visible.length, visibleLimit]);

  function updatePrefs(patch: Partial<NotesPreferences>) {
    setPrefs((current) => ({ ...current, ...patch }));
  }

  function focusSearchMatch(index: number) {
    const match = searchMatches[index];
    if (!match) return;
    if (previewMode === "raw") {
      const textarea = textareaRef.current;
      if (!textarea) return;
      textarea.focus();
      textarea.setSelectionRange(match.index, match.index + match.length);
      return;
    }
    const root = previewPanelRef.current?.querySelector<HTMLElement>(".note-mdx-content");
    if (!root) return;
    const needle = searchQuery.trim().toLocaleLowerCase();
    if (!needle) return;
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    let matchIndex = 0;
    let node: Node | null = walker.nextNode();
    while (node) {
      const text = node.nodeValue || "";
      const lower = text.toLocaleLowerCase();
      let cursor = 0;
      while (cursor <= lower.length - needle.length) {
        const localIndex = lower.indexOf(needle, cursor);
        if (localIndex < 0) break;
        if (matchIndex === index) {
          const target = node.parentElement;
          target?.scrollIntoView({ block: "center", behavior: "smooth" });
          return;
        }
        matchIndex += 1;
        cursor = localIndex + needle.length;
      }
      node = walker.nextNode();
    }
  }

  function moveSearchMatch(direction: 1 | -1) {
    if (!searchMatches.length) return;
    const next = (searchIndex + direction + searchMatches.length) % searchMatches.length;
    setSearchIndex(next);
    window.requestAnimationFrame(() => focusSearchMatch(next));
  }

  function formatSelectedDraft() {
    const current = previewMode === "edit" ? mdxMarkdownSourceRef.current?.() || draftBody : draftBody;
    const formatted = formatMarkdown(current);
    if (formatted === current) {
      setDraftState("整形できる変更はありません。");
      return;
    }
    setDraftBody(formatted);
    setDraftState("Markdownを整形しました。");
  }

  function restoreMarkdownDiffMarker(marker: MarkdownDiffMarker) {
    const restored = restoreMarkdownDiffHunk(draftBody, marker.hunk);
    if (restored === draftBody) return;
    setDraftBody(restored);
    setDraftState(`変更箇所 ${marker.lineNumber}行目を元に戻しました。`);
  }

  useEffect(() => {
    const runtime = globalThis as typeof globalThis & {
      CSS?: { highlights?: { set(name: string, value: unknown): void; delete(name: string): void } };
      Highlight?: new (...ranges: Range[]) => unknown;
    };
    const registry = runtime.CSS?.highlights;
    registry?.delete("tasken-markdown-search");
    if (!searchOpen || !searchQuery.trim() || previewMode !== "edit" || !registry || !runtime.Highlight) return;
    const root = previewPanelRef.current?.querySelector<HTMLElement>(".note-mdx-content");
    if (!root) return;
    const needle = searchQuery.trim().toLocaleLowerCase();
    const ranges: Range[] = [];
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    let node: Node | null = walker.nextNode();
    while (node) {
      const text = node.nodeValue || "";
      const lower = text.toLocaleLowerCase();
      let cursor = 0;
      while (cursor <= lower.length - needle.length) {
        const index = lower.indexOf(needle, cursor);
        if (index < 0) break;
        const range = document.createRange();
        range.setStart(node, index);
        range.setEnd(node, index + needle.length);
        ranges.push(range);
        cursor = index + needle.length;
      }
      node = walker.nextNode();
    }
    if (ranges.length) registry.set("tasken-markdown-search", new runtime.Highlight(...ranges));
    return () => {
      registry.delete("tasken-markdown-search");
    };
  }, [searchOpen, searchQuery, previewMode, draftBody]);

  useEffect(() => {
    selectedBodyRef.current = selectedBody;
    setDraftBody(normalizeRichEditorMarkdown(selectedBody));
    setIndexedDraftBody(normalizeRichEditorMarkdown(selectedBody));
    setRichEditorDirty(false);
    setDraftState("");
    setDiffOpen(false);
    setSearchIndex(0);
    setRecentExtraction(null);
  }, [selected?.id, selectedBody]);

  ctxRef.current = { selected, draftBody, draftDirty };

  // 未保存の変更を、Markdown本文が画面から外れる時だけ自動保存する。
  // ctxRefはレンダー中に新しい選択で上書きされるため、コミット済みの値を保持する専用refを使う。
  const autosaveRef = useRef<{ selected: Combined | null; draftBody: string; draftDirty: boolean }>({ selected: null, draftBody: "", draftDirty: false });
  const saveEntityRef = useRef(saveEntity);
  const setToastRef = useRef(setToast);
  saveEntityRef.current = saveEntity;
  setToastRef.current = setToast;
  useEffect(() => {
    autosaveRef.current = { selected, draftBody, draftDirty };
  });

  async function autoSaveDraft(snapshot = autosaveRef.current): Promise<void> {
    const previous = snapshot.selected;
    const liveBody = mdxMarkdownSourceRef.current?.();
    const body = typeof liveBody === "string" ? liveBody : snapshot.draftBody;
    if (!previous || body === recordBody(previous)) return;
    // Note は本文必須。Resource は空メモも許す（リンクを見ながらの下書き）。
    if (previous.recordType === "note" && !body.trim()) return;
    const { recordType, ...entity } = previous;
    try {
      await saveEntityRef.current(recordType, { ...entity, body_markdown: body });
    } catch (error: unknown) {
      setToastRef.current(`自動保存に失敗しました。${error instanceof Error ? error.message : String(error)}`);
    }
  }

  useEffect(() => {
    return () => {
      void autoSaveDraft();
    };
  }, [selected?.id]);

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "f") {
        event.preventDefault();
        const liveBody = mdxMarkdownSourceRef.current?.();
        if (typeof liveBody === "string") setDraftBody(liveBody);
        setSearchOpen(true);
        window.requestAnimationFrame(() => searchInputRef.current?.focus());
        return;
      }
      if ((event.ctrlKey || event.metaKey) && event.key === "s") {
        event.preventDefault();
        const { selected: s, draftBody: stateBody } = ctxRef.current;
        const liveBody = mdxMarkdownSourceRef.current?.();
        const body = typeof liveBody === "string" ? liveBody : stateBody;
        const dirty = Boolean(s && body !== recordBody(s));
        if (dirty && s) {
          if (s.recordType === "note" && !body.trim()) {
            setDraftState("本文を空にしたままでは保存できません。内容を入力してください。");
            return;
          }
          setDraftState("保存しています。");
          const { recordType, ...entity } = s;
          saveEntity(recordType, { ...entity, body_markdown: body })
            .then(() => {
              selectedBodyRef.current = body;
              setDraftBody(body);
              setRichEditorDirty(false);
              setDraftState("保存しました。");
            })
            .catch((error: unknown) => setDraftState(error instanceof Error ? error.message : "保存できませんでした。"));
        }
      }
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [saveEntity]);

  function copy() {
    workspaceApi
      .copyText(visible.map((record) => `${str(record.title)}\t${NOTES_KIND_LABELS[recordKind(record)]}\t${themes.find((theme) => theme.id === (record.project_id || record.theme_id))?.name || "—"}\t${str(record.url || record.source_url)}`).join("\n"))
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

  function addNote(noteType: "note" | "report" = "note") {
    openDrawer({
      type: "note",
      mode: "edit",
      entity: {
        theme_id: activeTheme?.id || null,
        note_type: noteType,
        content_format: "markdown",
        title: noteType === "report" ? "Report" : "",
        body_markdown: "",
        ...(noteType === "report" ? { properties_json: { report_type: "weekly" } } : {}),
      },
    });
  }

  async function copySelectedRaw() {
    if (!selected) return;
    await workspaceApi.copyText(currentDraftBody());
    setToast("本文をコピーしました。");
  }

  function openRecord(record: Combined) {
    // 一覧クリックは右ペイン選択 + 編集ドロワー（メタ・タイトル・種別の編集）。
    if (isWorkbenchRecord(record)) {
      setSelectedId(record.id);
      setPreviewMode("edit");
    }
    openDrawer({ type: record.recordType, mode: "edit", entity: record });
  }

  function knowledgeFromNote(record: Combined) {
    if (record.recordType !== "note") return;
    if (isLongKnowledgeSource(recordBody(record))) {
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

  function showRecordMenu(event: MouseEvent, record: Combined, url: string) {
    event.preventDefault();
    const items: ContextMenuItem[] = [
      { label: "編集する", onSelect: () => openRecord(record) },
      { label: "本文を開く", onSelect: () => {
        if (isWorkbenchRecord(record)) {
          setSelectedId(record.id);
          setPreviewMode("edit");
        }
      } },
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

  async function openMarkdownExportDirectory(directory: string) {
    const result = await workspaceApi.openPath(directory);
    if (result.ok) {
      setToast("Markdownの保存先フォルダを開きました。", "success");
      return;
    }
    setToast(result.error || "Markdownの保存先フォルダを開けませんでした。", "danger");
  }

  function modeScroller(mode: PreviewMode): HTMLElement | null {
    const panel = previewPanelRef.current;
    if (!panel) return null;
    if (mode === "raw") return panel.querySelector<HTMLElement>("textarea.note-main-editor-raw");
    if (mode === "preview") return panel.querySelector<HTMLElement>(".note-main-preview");
    // Edit: 選択ドラッグの自動スクロールが暴走しないよう、contenteditable の外枠だけをスクロールさせる。
    return panel.querySelector<HTMLElement>(".note-live-editor [class*='_rootContentEditableWrapper_']")
      || panel.querySelector<HTMLElement>(".note-mdx-content")
      || panel.querySelector<HTMLElement>("textarea.note-main-editor-raw");
  }

  function scrollRatio(element: HTMLElement | null): number {
    if (!element) return 0;
    const scrollable = element.scrollHeight - element.clientHeight;
    return scrollable > 0 ? element.scrollTop / scrollable : 0;
  }

  type ModeScrollState = {
    ratio: number;
    headingIndex: number | null;
    headingOffset: number;
  };

  function captureModeScroll(mode: PreviewMode): ModeScrollState {
    const element = modeScroller(mode);
    const state: ModeScrollState = { ratio: scrollRatio(element), headingIndex: null, headingOffset: 0 };
    if (!element || mode === "raw") return state;
    const headings = Array.from(element.querySelectorAll<HTMLElement>("h1, h2, h3, h4"));
    if (!headings.length) return state;
    const scrollTop = element.getBoundingClientRect().top;
    let headingIndex = 0;
    for (let index = 0; index < headings.length; index += 1) {
      if (headings[index].getBoundingClientRect().top - scrollTop > 8) break;
      headingIndex = index;
    }
    state.headingIndex = headingIndex;
    state.headingOffset = headings[headingIndex].getBoundingClientRect().top - scrollTop;
    return state;
  }

  // EditとPreviewではMermaid等のブロック高が異なるため、比率より見出し位置を優先して復元する。
  // MDXEditorはマウント直後に本文の高さが伸びるので、高さが安定するまで数フレーム続ける。
  function restoreModeScroll(mode: PreviewMode, state: ModeScrollState) {
    let frames = 0;
    let lastHeight = -1;
    const apply = () => {
      frames += 1;
      const target = modeScroller(mode);
      if (target) {
        const scrollable = target.scrollHeight - target.clientHeight;
        const headings = mode === "raw" ? [] : Array.from(target.querySelectorAll<HTMLElement>("h1, h2, h3, h4"));
        const anchor = state.headingIndex == null ? null : headings[state.headingIndex];
        if (anchor) {
          const offset = anchor.getBoundingClientRect().top - target.getBoundingClientRect().top;
          target.scrollTop = Math.max(0, Math.min(scrollable, target.scrollTop + offset - state.headingOffset));
        } else if (scrollable > 0) {
          target.scrollTop = state.ratio * scrollable;
        }
        if (scrollable > 0 && target.scrollHeight === lastHeight) return;
        lastHeight = target.scrollHeight;
      }
      if (frames < 20) window.requestAnimationFrame(apply);
    };
    window.requestAnimationFrame(apply);
  }

  function switchPreviewMode(nextMode: PreviewMode) {
    if (nextMode === previewMode) return;
    // Editを離れる直前にMDXから最新本文を取り込み、Preview/Rawへ最新の下書きを渡す。
    // モード切替では自動保存しない。
    if (previewMode === "edit" && nextMode !== "edit") {
      const latest = mdxMarkdownSourceRef.current?.();
      if (typeof latest === "string" && latest !== draftBody) {
        setDraftBody(latest);
      }
    }
    const scrollState = captureModeScroll(previewMode);
    setPreviewMode(nextMode);
    restoreModeScroll(nextMode, scrollState);
  }

  function currentDraftBody(): string {
    if (previewMode === "edit") {
      const liveBody = mdxMarkdownSourceRef.current?.();
      if (typeof liveBody === "string") return liveBody;
    }
    return effectiveBody;
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

  const uploadEditorImage = useCallback(async (image: File): Promise<string> => {
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
  }, []);

  const updateRichEditorDraft = useCallback((value: string) => {
    // Lexicalの入力・IME描画を先に確定し、全文由来のNotes表示更新は低優先度で追従させる。
    startTransition(() => {
      setDraftBody(value);
      setRichEditorDirty(value !== selectedBodyRef.current);
      setDraftState((current) => current ? "" : current);
    });
  }, []);

  const markRichEditorDirty = useCallback(() => {
    setRichEditorDirty(true);
  }, []);

  const reportRichEditorError = useCallback((message: string) => {
    setDraftState(`Markdownを読み込めませんでした。${message}`);
  }, []);

  const extractSelection = useCallback(async (
    kind: SelectionExtractionKind,
    selection: MarkdownTextSelection,
    title: string,
  ) => {
    const source = ctxRef.current.selected;
    if (!source || source.recordType !== "note") {
      throw new Error("元のNoteを確認できません。Noteを開き直して再度選択してください。");
    }
    const result = buildSelectionExtractionOperations(
      {
        kind,
        title,
        selection,
        source: {
          id: source.id,
          title: str(source.title) || "無題",
          projectId: str(source.project_id || source.theme_id) || null,
        },
      },
      { entityId: crypto.randomUUID(), referenceId: crypto.randomUUID() },
    );
    await saveEntities(
      result.operations,
      `${kind === "task" ? "Task" : "Note"}「${result.entity.title}」を作成しました。`,
    );
    setRecentExtraction({
      type: result.entityType,
      title: result.entity.title,
      entity: result.entity as unknown as BaseRecord,
    });
    setDraftState("選択範囲を切り出しました。元の本文は変更していません。");
  }, [saveEntities]);

  async function saveSelectedDraft() {
    const liveBody = mdxMarkdownSourceRef.current?.();
    const body = typeof liveBody === "string" ? liveBody : draftBody;
    if (!selected || body === selectedBody) return;
    if (selected.recordType === "note" && !body.trim()) {
      setDraftState("本文を空にしたままでは保存できません。内容を入力してください。");
      return;
    }
    setDraftState("保存しています。");
    try {
      const { recordType, ...entity } = selected;
      await saveEntity(recordType, {
        ...entity,
        body_markdown: body,
      });
      selectedBodyRef.current = body;
      setDraftBody(body);
      setRichEditorDirty(false);
      setDraftState("保存しました。");
    } catch (error) {
      setDraftState(error instanceof Error ? error.message : "保存できませんでした。");
    }
  }

  /** 見出しをビューポート上端から fraction の位置（既定 2/5 = やや上）に来るようスクロールする。 */
  function scrollHeadingIntoView(scrollEl: HTMLElement, target: HTMLElement, fraction = 0.4) {
    const scrollRect = scrollEl.getBoundingClientRect();
    const targetRect = target.getBoundingClientRect();
    const topInScroll = targetRect.top - scrollRect.top + scrollEl.scrollTop;
    const maxScroll = Math.max(0, scrollEl.scrollHeight - scrollEl.clientHeight);
    const nextTop = Math.min(maxScroll, Math.max(0, topInScroll - scrollEl.clientHeight * fraction));
    scrollEl.scrollTo({ top: nextTop, behavior: "smooth" });
  }

  const jumpToMarkdownHeading = useCallback((heading: MarkdownHeadingItem) => {
    const panel = previewPanelRef.current;
    if (!panel) return;
    if (previewMode === "preview") {
      const scrollEl = modeScroller("preview");
      const el = panel.querySelector(`#${CSS.escape(heading.id)}`) as HTMLElement | null
        || panel.querySelector(`[data-md-heading-index="${heading.index}"]`) as HTMLElement | null;
      if (scrollEl && el) scrollHeadingIntoView(scrollEl, el);
      else el?.scrollIntoView({ behavior: "smooth", block: "center" });
      return;
    }
    if (previewMode === "edit") {
      const scrollEl = modeScroller("edit");
      const content = panel.querySelector(".note-mdx-content");
      const nodes = content?.querySelectorAll("h1, h2, h3, h4");
      const el = nodes?.[heading.index] as HTMLElement | undefined;
      if (scrollEl && el) scrollHeadingIntoView(scrollEl, el);
      else el?.scrollIntoView({ behavior: "smooth", block: "center" });
      return;
    }
    const ta = textareaRef.current;
    if (!ta) return;
    const lines = ctxRef.current.draftBody.split(/\r?\n/);
    let inCode = false;
    let count = 0;
    let found = -1;
    for (let i = 0; i < lines.length; i += 1) {
      if (lines[i].trim().startsWith("```")) {
        inCode = !inCode;
        continue;
      }
      if (inCode) continue;
      if (/^#{1,4}\s+\S/.test(lines[i])) {
        if (count === heading.index) {
          found = i;
          break;
        }
        count += 1;
      }
    }
    if (found < 0) return;
    const before = lines.slice(0, found).join("\n");
    const pos = before.length + (found > 0 ? 1 : 0);
    ta.focus();
    ta.setSelectionRange(pos, pos);
    const lineHeight = Number.parseFloat(window.getComputedStyle(ta).lineHeight) || 20;
    // 見出し行がビューポートの約 2/5 に来る位置へ
    const nextTop = Math.max(0, found * lineHeight - ta.clientHeight * 0.4);
    ta.scrollTo({ top: nextTop, behavior: "smooth" });
  }, [previewMode]);

  async function updateHeadingNumberSettings(patch: { heading_numbers?: boolean; heading_number_levels?: HeadingNumberLevel[] }) {
    if (!selected || selected.recordType !== "note") return;
    try {
      const nextEnabled = patch.heading_numbers ?? headingNumbersEnabled;
      const nextLevels = patch.heading_number_levels ?? headingNumberLevels;
      await saveEntity("note", {
        ...selected,
        body_markdown: draftDirty ? draftBody : selectedBody,
        properties_json: {
          ...selectedProperties,
          heading_numbers: nextEnabled,
          heading_number_levels: nextLevels,
          // 旧版が読めるよう開始階層も併記する。表示の正本はlevels。
          heading_number_start: nextLevels[0] ?? headingNumberStart,
        },
      });
      if (patch.heading_numbers !== undefined && patch.heading_number_levels === undefined) {
        setToast(nextEnabled ? "見出し番号を表示します（Edit / Preview / PDF）。" : "見出し番号を非表示にしました。", "success");
      } else if (patch.heading_number_levels !== undefined) {
        setToast(`番号対象を${nextLevels.length ? nextLevels.map((level) => `h${level}`).join("・") : "なし"}にしました。`, "success");
      }
    } catch (error) {
      setToast(`設定を保存できませんでした。${error instanceof Error ? error.message : String(error)}`, "danger");
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
    if (!selected || !showDocumentPublish) return;
    setMarkdownExporting(true);
    try {
      const bodyForExport = currentDraftBody() || selectedBody;
      const content = publishMarkdownContent(selected, selectedTheme?.name || "", bodyForExport);
      const result = await workspaceApi.exportMarkdownFile({
        title: str(selected.title),
        content,
        directory: str(markdownExport?.directory) || null,
        chooseDirectory,
        fileName: `${str(selected.title) || "markdown-document"}.md`,
        themeId: str(selected.project_id || selected.theme_id) || null,
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
      setToast(`Markdownを保存しました。${result.filePath || ""}`, "success");
    } catch (error) {
      setToast(`Markdown出力に失敗しました。${error instanceof Error ? error.message : String(error)}`, "danger");
    } finally {
      setMarkdownExporting(false);
    }
  }

  async function exportSelectedPdf() {
    if (!selected || !showDocumentPublish) return;
    setPdfExporting(true);
    try {
      const content = publishMarkdownContent(selected, selectedTheme?.name || "", currentDraftBody() || selectedBody);
      const result = await workspaceApi.exportMarkdownPdf({
        title: str(selected.title),
        html: await renderMermaidDocumentForPdf(previewDocument(content, "markdown", headingNumberOptions.publish)),
        chooseDirectory: true,
        fileName: `${str(selected.title) || "markdown-document"}.pdf`,
        themeId: str(selected.project_id || selected.theme_id) || null,
      });
      if (result.canceled) {
        setToast("PDF出力をキャンセルしました。", "info");
        return;
      }
      const warningText = result.warnings?.length ? `（注意: ${result.warnings[0]}${result.warnings.length > 1 ? ` 他${result.warnings.length - 1}件` : ""}）` : "";
      setToast(`PDFを出力しました。${result.filePath || ""}${warningText}`, result.warnings?.length ? "warning" : "success");
    } catch (error) {
      setToast(`PDF出力に失敗しました。${error instanceof Error ? error.message : String(error)}`, "danger");
    } finally {
      setPdfExporting(false);
    }
  }

  function handleDraftWorkspaceSaved(saved: BaseRecord, body: string) {
    setSelectedId(saved.id);
    setDraftBody(body);
    setIndexedDraftBody(body);
    setRichEditorDirty(false);
    setPreviewMode("edit");
  }

  commandActionsRef.current = {
    save: () => selected ? saveSelectedDraft() : setToast("保存する文書を選択してください。", "warning"),
    edit: () => selected ? switchPreviewMode("edit") : setToast("編集する文書を選択してください。", "warning"),
    preview: () => selected ? switchPreviewMode("preview") : setToast("表示する文書を選択してください。", "warning"),
    format: () => selected ? formatSelectedDraft() : setToast("整形する文書を選択してください。", "warning"),
    pdf: () => showDocumentPublish ? exportSelectedPdf() : setToast("PDF出力できるNoteまたはReportを選択してください。", "warning"),
    folder: () => markdownExportOpenPath
      ? openMarkdownExportDirectory(markdownExportDirectory || markdownExportFilePath)
      : setToast("先にMarkdownを出力して保存先を決めてください。", "warning"),
    draft: () => selected?.recordType === "note"
      ? setDraftWorkspaceTarget(selected)
      : setToast("Draft Workspaceで扱うNoteまたはMarkdown文書を選択してください。", "warning"),
  };

  useEffect(() => {
    const runCommand = (event: Event) => {
      const command = (event as CustomEvent<string>).detail;
      void commandActionsRef.current[command]?.();
    };
    window.addEventListener("tasken:notes-command", runCommand);
    return () => window.removeEventListener("tasken:notes-command", runCommand);
  }, []);

  return (
    <div className="page notes-page">
      <PageHeader title="Notes" subtitle="Note / Resource / Report / Prompt。書く・読む・リンクを見ながらメモする場所">
        <button className="secondary-button" onClick={copy}>一覧をコピー</button>
        <button className="secondary-button" onClick={() => setDraftWorkspaceTarget(null)}><IconSparkles size={16} />AI Draft</button>
        <button className="primary-button" onClick={() => addNote("note")}>Note</button>
        <button className="primary-button" onClick={() => openDrawer({ type: "resource", mode: "edit", entity: { project_id: activeTheme?.id || null } })}>Resource</button>
        <button className="primary-button" onClick={() => addNote("report")}>Report</button>
        <button className="primary-button" onClick={() => addPrompt()}>Prompt</button>
      </PageHeader>
      <div className="filter-bar panel">
        <input data-search value={query} onChange={(event) => setQuery(event.target.value)} placeholder="タイトル、本文、URLを検索" />
        <div className="segmented" aria-label="表示する種類">
          {[
            ["all", "すべて"],
            ["note", "Note"],
            ["resource", "Resource"],
            ["report", "Report"],
            ["prompt", "Prompt"],
          ].map(([value, label]) => (
            <button key={value} className={scope === value ? "is-active" : ""} onClick={() => updatePrefs({ scope: value as NoteScope })}>
              {label}
            </button>
          ))}
        </div>
        <label className="notes-sort-field">
          <span className="sr-only">Notesの並び順</span>
          <select
            value={sortOrder}
            onChange={(event) => updatePrefs({ sortOrder: event.target.value as NotesSortOrder })}
            aria-label="Notesの並び順"
          >
            <option value="updated_desc">更新日：新しい順</option>
            <option value="updated_asc">更新日：古い順</option>
            <option value="created_desc">作成日：新しい順</option>
            <option value="created_asc">作成日：古い順</option>
          </select>
        </label>
        <span>{visible.length}件</span>
      </div>
      <div className="notes-workbench">
        <section className="panel list-page notes-list-panel">
          {renderedRecords.map((record) => {
            const comments = record.comments as NoteComment[] | undefined;
            const url = str(record.source_url || record.url);
            const kind = recordKind(record);
            const kindLabel = NOTES_KIND_LABELS[kind];
            const isSelected = selected?.id === record.id;
            const themeId = str(record.project_id || record.theme_id) || null;
            const theme = themes.find((entry) => entry.id === themeId);
            const themeIndex = Math.max(0, themes.findIndex((entry) => entry.id === themeId));
            const chipColor = `var(--color-${themeColor(theme, themeIndex)})`;
            const bodyPreview = kind === "resource"
              ? (url || recordBodyPreview(record) || "URLなし")
              : (recordBodyPreview(record) || url || "本文なし");
            return (
              <div
                className={`note-row ${isSelected ? "is-selected" : ""}`}
                key={`${record.recordType}-${record.id}`}
                style={{ "--chip-color": chipColor } as React.CSSProperties}
                onContextMenu={(event) => showRecordMenu(event, record, url)}
              >
                <span className="todo-theme-bar note-theme-bar" aria-hidden="true" />
                <button
                  className="note-row-main"
                  onClick={() => openRecord(record)}
                >
                  <span className="note-row-head">
                    <span className="note-kind" title={kindLabel} aria-label={kindLabel}>
                      <NotesKindIcon kind={kind} />
                    </span>
                    <strong className="note-row-title">{str(record.title) || (kind === "resource" ? url || "無題のResource" : "無題")}</strong>
                    {record.recordType === "note" && comments && comments.length > 0 && <span className="comment-count" aria-label={`${comments.length}件のコメント`}>{comments.length}</span>}
                  </span>
                  <span className={`note-row-body ${kind === "resource" && url ? "is-url" : ""}`}>{bodyPreview}</span>
                  <span className="note-row-meta">
                    <span className="theme-inline">
                      <span className="chip-dot" />
                      {theme?.name || "Theme未設定"}
                    </span>
                  </span>
                </button>
                {canCreateKnowledge(record) && (
                  <button
                    className="row-action-button note-row-open"
                    onClick={() => knowledgeFromNote(record)}
                    aria-label={`${str(record.title) || "Note"}をKnowledge化`}
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
              </div>
            );
          })}
          {!visible.length && <EmptyState title="一致する項目はありません" action="Noteを書く" onAction={() => addNote("note")} />}
        </section>
        {contextMenu && <ContextMenu x={contextMenu.x} y={contextMenu.y} items={contextMenu.items} onClose={() => setContextMenu(null)} />}
        <section className="panel note-preview-panel" ref={previewPanelRef}>
          {selected ? (
            <>
              <div className="note-preview-header">
                <div>
                  <h2>{str(selected.title) || (selectedKind === "resource" ? selectedUrl || "無題のResource" : "無題")}</h2>
                  {(selected.created_at || selected.updated_at || draftState) && (
                    <div className="note-date-meta">
                      {selected.created_at && <span>追加 {noteDateLabel(selected.created_at)}</span>}
                      {selected.updated_at && <span>更新 {noteDateLabel(selected.updated_at)}</span>}
                      {draftState && <span className="note-draft-state" role="status" aria-live="polite">{draftState}</span>}
                      {recentExtraction && (
                        <button
                          type="button"
                          className="note-extraction-result"
                          onClick={() => openDrawer({
                            type: recentExtraction.type,
                            entity: recentExtraction.entity as Record<string, unknown>,
                          })}
                        >
                          {recentExtraction.type === "task" ? "Task" : "Note"}「{recentExtraction.title}」を開く
                        </button>
                      )}
                    </div>
                  )}
                  {selectedUrl && (
                    <a className="note-preview-url" href={selectedUrl} target="_blank" rel="noreferrer">{selectedUrl}</a>
                  )}
                </div>
                <div className="note-preview-actions">
                  <button className="secondary-button compact" onClick={copySelectedRaw}>本文をコピー</button>
                  {selected.recordType === "note" && (
                    <button className="secondary-button compact" onClick={() => setDraftWorkspaceTarget(selected)}><IconSparkles size={15} />Draft Workspace</button>
                  )}
                  <button className="secondary-button compact" disabled={!draftDirty} onClick={() => {
                    setDraftBody(selectedBody);
                    setRichEditorDirty(false);
                    setDraftState("変更を戻しました。");
                  }}>戻す</button>
                  <button className="primary-button compact" disabled={!draftDirty} onClick={saveSelectedDraft} title="Ctrl+S">保存</button>
                  {canCreateKnowledge(selected) && (
                    <button
                      className="secondary-button compact"
                      onClick={() => knowledgeFromNote(selected)}
                    >
                      Knowledge化
                    </button>
                  )}
                </div>
              </div>
              <div className={`document-publish-panel document-publish-strip ${markdownExportStale && showDocumentPublish ? "needs-export" : ""}`}>
                <div className="document-publish-title">
                  {showDocumentPublish ? (
                    <>
                      {markdownExportOpenPath && (
                        <button
                          className="document-publish-open"
                          type="button"
                          title={markdownExportDirectory || markdownExportFilePath}
                          aria-label="保存先フォルダを開く"
                          onClick={() => openMarkdownExportDirectory(markdownExportDirectory || markdownExportFilePath)}
                        >
                          <IconFolder size={15} stroke={1.8} />
                        </button>
                      )}
                      {markdownExportStale && <span className="save-status save-status-error">要再出力</span>}
                    </>
                  ) : selectedKind === "resource" ? (
                    <strong>リンクメモ</strong>
                  ) : selectedKind === "prompt" ? (
                    <strong>Prompt</strong>
                  ) : null}
                </div>
                <div className="document-publish-actions">
                  <div className="segmented note-editor-mode-tabs" aria-label="Markdown表示">
                    <button
                      className={previewMode === "edit" ? "is-active" : ""}
                      onMouseEnter={() => { void loadMarkdownRichEditor(); }}
                      onFocus={() => { void loadMarkdownRichEditor(); }}
                      onClick={() => switchPreviewMode("edit")}
                    >
                      Edit
                    </button>
                    <button className={previewMode === "preview" ? "is-active" : ""} onClick={() => switchPreviewMode("preview")}>Preview</button>
                    <button className={previewMode === "raw" ? "is-active" : ""} onClick={() => switchPreviewMode("raw")}>Raw</button>
                  </div>
                  <button className="secondary-button compact" onClick={formatSelectedDraft} title="行末空白と過剰な空行を整えます">整形</button>
                  <button
                    className={`secondary-button compact ${diffOpen ? "is-active" : ""}`}
                    disabled={!draftDirty}
                    aria-pressed={diffOpen}
                    onClick={() => {
                      if (!diffOpen) {
                        const liveBody = mdxMarkdownSourceRef.current?.();
                        if (typeof liveBody === "string") setDraftBody(liveBody);
                      }
                      setDiffOpen((current) => !current);
                    }}
                  >
                    {markdownDiffHunks.length ? `変更 ${markdownDiffHunks.length}か所` : "変更を確認"}
                  </button>
                  {showDocumentPublish && (
                    <>
                      <label className="toggle note-heading-number-toggle" title="本文は書き換えず、Edit・Preview・PDF に通し番号を付けます。Markdownファイル出力には含めません">
                        <input
                          type="checkbox"
                          checked={headingNumbersEnabled}
                          onChange={(event) => updateHeadingNumberSettings({ heading_numbers: event.target.checked })}
                        />
                        見出し番号
                      </label>
                      {headingNumbersEnabled && (
                        <details className="note-heading-level-picker">
                          <summary title="番号を付ける見出しレベル">{headingNumberLevelSummary}</summary>
                          <div className="note-heading-level-menu" aria-label="番号を付ける見出し">
                            {HEADING_NUMBER_LEVELS.map((level) => (
                              <label key={level}>
                                <input
                                  type="checkbox"
                                  checked={headingNumberLevels.includes(level)}
                                  onChange={(event) => updateHeadingNumberSettings({
                                    heading_number_levels: normalizeHeadingNumberLevels(
                                      event.target.checked
                                        ? [...headingNumberLevels, level]
                                        : headingNumberLevels.filter((current) => current !== level),
                                    ),
                                  })}
                                />
                                {HEADING_NUMBER_LEVEL_LABELS[level]}
                              </label>
                            ))}
                          </div>
                        </details>
                      )}
                      <button className="primary-button compact" disabled={markdownExporting} onClick={() => exportSelectedMarkdown(false)}>
                        {markdownExporting ? "保存中" : "保存"}
                      </button>
                      {hasMarkdownExportDirectory && (
                        <button className="secondary-button compact" disabled={markdownExporting} onClick={() => exportSelectedMarkdown(true)} title="保存先フォルダを変更">
                          <IconFolder size={15} stroke={1.8} aria-hidden />
                          保存先を変更
                        </button>
                      )}
                      <button className="secondary-button compact" disabled={pdfExporting} onClick={exportSelectedPdf} title="PDFを出力">
                        <IconFileTypePdf size={15} stroke={1.8} aria-hidden />
                        {pdfExporting ? "出力中" : "PDF"}
                      </button>
                    </>
                  )}
                </div>
              </div>
              {searchOpen && (
                <div className="markdown-search-bar" role="search" aria-label="Markdown本文を検索">
                  <input
                    ref={searchInputRef}
                    value={searchQuery}
                    onChange={(event) => {
                      setSearchQuery(event.target.value);
                      setSearchIndex(0);
                    }}
                    onKeyDown={(event) => {
                      if (event.key === "Enter") {
                        event.preventDefault();
                        moveSearchMatch(event.shiftKey ? -1 : 1);
                      }
                      if (event.key === "Escape") setSearchOpen(false);
                    }}
                    placeholder="本文を検索"
                    aria-label="本文を検索"
                  />
                  <span className="markdown-search-count" aria-live="polite">
                    {searchMatches.length ? `${searchIndex + 1}/${searchMatches.length}` : searchQuery.trim() ? "一致なし" : "検索語を入力"}
                  </span>
                  <button type="button" className="secondary-button compact" disabled={!searchMatches.length} onClick={() => moveSearchMatch(-1)}>前へ</button>
                  <button type="button" className="secondary-button compact" disabled={!searchMatches.length} onClick={() => moveSearchMatch(1)}>次へ</button>
                  <button type="button" className="secondary-button compact" onClick={() => setSearchOpen(false)}>閉じる</button>
                </div>
              )}
              <div ref={markdownSurfaceRef} className="note-markdown-surface">
                {diffOpen && previewMode !== "preview" && markdownDiffMarkers.length > 0 && (
                  <MarkdownDiffMarkerRail
                    markers={markdownDiffMarkers}
                    totalLines={draftLineCount}
                    mode={previewMode}
                    surfaceRef={markdownSurfaceRef}
                    onRestoreHunk={restoreMarkdownDiffMarker}
                  />
                )}
                <MarkdownHeadingIndex
                  headings={markdownHeadings}
                  headingNumberOptions={headingNumberOptions.preview}
                  onSelect={jumpToMarkdownHeading}
                />
                {previewMode === "edit" ? hasMarkdownFootnotes(draftBody) ? (
                  <textarea
                    ref={textareaRef}
                    className="note-main-editor note-main-editor-raw note-editor-footnotes"
                    value={draftBody}
                    onPaste={handleDraftPaste}
                    onChange={(event) => {
                      setDraftBody(event.target.value);
                      if (draftState) setDraftState("");
                    }}
                    aria-label="脚注を含むMarkdown本文"
                  />
                ) : (
                  <MarkdownEditorBoundary
                    key={selected.id}
                    markdown={draftBody}
                    resetKey={selected.id}
                    onChange={updateRichEditorDraft}
                    onPaste={handleDraftPaste}
                    onError={reportRichEditorError}
                  >
                    <Suspense fallback={<div className="note-editor-loading" role="status">エディタを読み込んでいます…</div>}>
                      <MarkdownRichEditor
                        markdown={draftBody}
                        headingNumberOptions={headingNumberOptions.preview}
                        markdownSourceRef={mdxMarkdownSourceRef}
                        onChange={updateRichEditorDraft}
                        onDirty={markRichEditorDirty}
                        onImageUpload={uploadEditorImage}
                        onError={reportRichEditorError}
                        onExtractSelection={selected.recordType === "note" ? extractSelection : undefined}
                      />
                    </Suspense>
                  </MarkdownEditorBoundary>
                ) : previewMode === "preview" ? (
                  <MarkdownPreview className="note-main-preview markdown-preview" html={previewHtml(draftBody, "markdown", headingNumberOptions.preview)} />
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
              </div>
            </>
          ) : (
            <EmptyState title="項目がありません" action="Noteを書く" onAction={() => addNote("note")} />
          )}
        </section>
      </div>
      {draftWorkspaceTarget !== undefined && (
        <DraftWorkspaceDialog
          note={draftWorkspaceTarget}
          themes={themes}
          activeThemeId={activeTheme?.id || null}
          saveEntity={saveEntity}
          setToast={setToast}
          onSaved={handleDraftWorkspaceSaved}
          close={closeDraftWorkspace}
        />
      )}
    </div>
  );
}
