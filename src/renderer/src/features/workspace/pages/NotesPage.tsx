import {
  IconExternalLink,
  IconFileTypePdf,
  IconFolder,
  IconLink,
  IconNotes,
  IconPrompt,
  IconReport,
  IconSparkles,
  IconWriting,
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
import { ChatRefArtifactLinkDialog } from "../components/ChatRefArtifactLinkDialog";
import { DraftWorkspaceDialog } from "../components/DraftWorkspaceDialog";
import { MarkdownHeadingIndex } from "../components/MarkdownHeadingIndex";
import { MarkdownDiffMarkerRail } from "../components/MarkdownDiffMarkerRail";
import { MarkdownEditorBoundary } from "../components/MarkdownEditorBoundary";
import { MarkdownPreview } from "../components/MarkdownPreview";
import { NoteAiDialog, type NoteAiTarget } from "../components/NoteAiDialog";
import { clipboardImageFile, readFileAsDataUrl } from "../lib/clipboardImage";
import { isChatReference } from "../lib/chatRefs";
import { NOTES_KIND_LABELS, notesKindFromNoteType, themeColor, type NotesKind } from "../lib/domain";
import { str } from "../lib/format";
import { buildKnowledgeNodeDraftFromNote, isLongKnowledgeSource } from "../lib/knowledgeExtraction";
import { buildMarkdownDiffHunks, buildMarkdownDiffMarkers, diffMarkdownLines, findMarkdownMatches, formatMarkdown, replaceAllMarkdownMatches, replaceMarkdownMatch, restoreMarkdownDiffHunk, type MarkdownDiffMarker } from "../lib/markdownEditing";
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
import {
  captureNoteModeScroll,
  rawHeadingScrollTop,
  restoreNoteModeScroll,
  type NoteModeScrollAnchor,
} from "../lib/noteModeScroll";
import { PROMPT_PURPOSE_LABELS } from "../lib/prompts";
import {
  cropSketchPageToContent,
  drawSketchPage,
  renderSketchPageToDataUrl,
  sketchCanvasMode,
  type SketchPage,
} from "../lib/sketch";
import {
  ACTIVE_SKETCH_ID_KEY,
  ACTIVE_SKETCH_PAGE_KEY,
  extractSketchEmbedRefs,
  findSketchPage,
  parseSketchEmbedUrl,
  sketchEmbedMarkdown,
  type SketchEmbedPreview,
} from "../lib/sketchEmbed";
import type { Artifact, BaseRecord, Entity, NoteComment, PageProps, SaveOperation, Sketch } from "../types";
import { usePersistentState } from "../../../utils/usePersistentState";
import { compactNotesBodyPreview, DEFAULT_NOTES_PREFS, compareNotesRecords, type NotesPreferences, type NotesSortOrder } from "../lib/notes";
import {
  buildNoteExportArtifactOperation,
  createNoteDocumentExport,
  noteArtifactExportTargetIds,
  resolveNoteExportTargets,
  withNoteArtifactExportTargets,
  withNoteDocumentExport,
  type ChatRefRecord,
  type NoteDocumentExport,
} from "../lib/noteExportArtifacts";
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

function SketchPickerPreview({ page }: { page: SketchPage }) {
  const ref = useRef<HTMLCanvasElement | null>(null);
  useEffect(() => {
    const context = ref.current?.getContext("2d");
    if (context) drawSketchPage(context, page);
  }, [page]);
  return <canvas ref={ref} width={page.width} height={page.height} aria-label={`${page.title}のSketch Preview`} />;
}

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

type AutoLinkUndoEntry = { artifactId: string; previous: Artifact | null };
type AutoLinkResult = { exported: NoteDocumentExport; chatRefs: ChatRefRecord[]; undo: AutoLinkUndoEntry[] };

function isWorkbenchRecord(record: Combined): boolean {
  if (record.recordType === "resource") return true;
  return record.recordType === "note";
}

export function NotesPage({ data, themes, domain, activeTheme, detachedNoteId, openDrawer, navigate, saveEntity, saveEntities, removeEntityQuiet, setToast }: PageProps) {
  const [query, setQuery] = useState("");
  // 切り離しウィンドウは対象Noteが決まっているので、選択をそこへ固定する（#290）。
  const [selectedId, setSelectedId] = useState<string | null>(detachedNoteId ?? null);
  // 別ウィンドウで開いているNote。正本はMainのwindow registryなので購読するだけ。
  const [openNoteWindowIds, setOpenNoteWindowIds] = useState<string[]>([]);
  // Notesは書く場所としてEditを初期表示にする。Preview / Rawは必要なときだけ切り替える。
  const [previewMode, setPreviewMode] = useState<PreviewMode>("edit");
  const [prefs, setPrefs] = usePersistentState<NotesPreferences>("notes:prefs:v1", DEFAULT_NOTES_PREFS);
  const sketches = useMemo(() => data.sketches as Sketch[], [data.sketches]);
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
  const themeId = prefs.themeId && prefs.themeId !== "all" && prefs.themeId !== "none"
    && !themes.some((t) => t.id === prefs.themeId) ? "all" : (prefs.themeId || "all");
  const normalizedQuery = query.trim().toLocaleLowerCase();
  const visible = useMemo(() => records.filter((record) => {
    if (scope !== "all" && recordKind(record) !== scope) return false;
    if (themeId === "none") {
      if (str(record.project_id || record.theme_id)) return false;
    } else if (themeId !== "all") {
      if (str(record.project_id || record.theme_id) !== themeId) return false;
    }
    if (!normalizedQuery) return true;
    return `${str(record.title)} ${recordBody(record)} ${str(record.url || record.source_url)}`
      .toLocaleLowerCase()
      .includes(normalizedQuery);
  }), [normalizedQuery, records, scope, themeId]);
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
  const [replaceOpen, setReplaceOpen] = useState(false);
  const [replaceQuery, setReplaceQuery] = useState("");
  // 置換直前の本文。Rich Editorへは setMarkdown で流し込むためEditorのUndo履歴に残らず、
  // 置換バー上の「元に戻す」を復旧経路にする。
  const [replaceUndo, setReplaceUndo] = useState<{ body: string; label: string } | null>(null);
  const [diffOpen, setDiffOpen] = useState(false);
  const [draftWorkspaceTarget, setDraftWorkspaceTarget] = useState<BaseRecord | null | undefined>(undefined);
  const [pdfExporting, setPdfExporting] = useState(false);
  const [markdownExporting, setMarkdownExporting] = useState(false);
  const [recentExport, setRecentExport] = useState<NoteDocumentExport | null>(null);
  const [autoLinked, setAutoLinked] = useState<AutoLinkResult | null>(null);
  const [exportLinkDialogOpen, setExportLinkDialogOpen] = useState(false);
  const [sketchPickerOpen, setSketchPickerOpen] = useState(false);
  const [aiTarget, setAiTarget] = useState<NoteAiTarget | null>(null);
  const [pickerSketchId, setPickerSketchId] = useState("");
  const [pickerPageId, setPickerPageId] = useState("");
  const [sketchEmbeds, setSketchEmbeds] = useState<Record<string, SketchEmbedPreview>>({});
  const [recentExtraction, setRecentExtraction] = useState<{
    type: SelectionExtractionKind;
    title: string;
    entity: BaseRecord;
  } | null>(null);
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; items: ContextMenuItem[] } | null>(null);
  const listWidth = prefs.listWidth;
  const listCollapsed = prefs.listCollapsed;
  const workbenchRef = useRef<HTMLDivElement | null>(null);
  const draggingRef = useRef(false);
  const handleResize = useCallback((event: React.PointerEvent) => {
    event.preventDefault();
    draggingRef.current = true;
    const target = event.currentTarget as HTMLElement;
    target.setPointerCapture(event.pointerId);
    const workbench = workbenchRef.current;
    if (!workbench) return;
    const onMove = (moveEvent: PointerEvent) => {
      if (!draggingRef.current) return;
      const rect = workbench.getBoundingClientRect();
      const x = moveEvent.clientX - rect.left;
      const MIN_WIDTH = 180;
      const COLLAPSE_THRESHOLD = 100;
      if (x < COLLAPSE_THRESHOLD) {
        updatePrefs({ listCollapsed: true, listWidth: MIN_WIDTH });
      } else {
        const clamped = Math.max(MIN_WIDTH, Math.min(x, rect.width * 0.6));
        updatePrefs({ listCollapsed: false, listWidth: clamped });
      }
    };
    const onUp = () => {
      draggingRef.current = false;
      document.removeEventListener("pointermove", onMove);
      document.removeEventListener("pointerup", onUp);
    };
    document.addEventListener("pointermove", onMove);
    document.addEventListener("pointerup", onUp);
  }, [updatePrefs]);
  const toggleListCollapsed = useCallback(() => {
    updatePrefs({ listCollapsed: !listCollapsed });
  }, [listCollapsed, updatePrefs]);
  // 本文集中表示。Taskenのウィンドウ内で使える縦領域を本文へ回す（#292）。
  const documentFocus = prefs.documentFocus;
  const toggleDocumentFocus = useCallback(() => {
    updatePrefs({ documentFocus: !documentFocus });
  }, [documentFocus, updatePrefs]);
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if ((event.ctrlKey || event.metaKey) && event.key === "b" && !event.shiftKey && !event.altKey) {
        event.preventDefault();
        toggleListCollapsed();
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [toggleListCollapsed]);
  useEffect(() => {
    if (!documentFocus) return;
    function onEscape(event: KeyboardEvent) {
      // 入力中のEscはエディタ側の操作を優先する。
      const target = event.target as HTMLElement | null;
      if (event.key !== "Escape" || target?.closest("input, textarea, [contenteditable=true]")) return;
      event.preventDefault();
      updatePrefs({ documentFocus: false });
    }
    window.addEventListener("keydown", onEscape);
    return () => window.removeEventListener("keydown", onEscape);
  }, [documentFocus, updatePrefs]);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const searchInputRef = useRef<HTMLInputElement | null>(null);
  const replaceInputRef = useRef<HTMLInputElement | null>(null);
  const previewPanelRef = useRef<HTMLElement | null>(null);
  const markdownSurfaceRef = useRef<HTMLDivElement | null>(null);
  const mdxMarkdownSourceRef = useRef<(() => string) | null>(null);
  const modeScrollRestoreCleanupRef = useRef<(() => void) | null>(null);

  useEffect(() => () => modeScrollRestoreCleanupRef.current?.(), []);

  function openSelectionAi(selection: MarkdownTextSelection) {
    const source = mdxMarkdownSourceRef.current?.() || draftBody;
    const first = source.indexOf(selection.text);
    const second = first >= 0 ? source.indexOf(selection.text, first + selection.text.length) : -1;
    if (first < 0 || second >= 0) {
      setToast("選択範囲をMarkdown本文上で一意に特定できません。Rawで選び直すか文書全体を指定してください。", "warning");
      return;
    }
    setAiTarget({ scope: "selection", start: first, end: first + selection.text.length, text: selection.text });
  }

  function openNoteAi() {
    const textarea = textareaRef.current;
    if (textarea && (previewMode === "raw" || hasMarkdownFootnotes(draftBody)) && textarea.selectionEnd > textarea.selectionStart) {
      const start = textarea.selectionStart;
      const end = textarea.selectionEnd;
      setAiTarget({ scope: "selection", start, end, text: draftBody.slice(start, end) });
      return;
    }
    setAiTarget({ scope: "document" });
  }
  const mdxMarkdownInsertRef = useRef<((markdown: string) => void) | null>(null);
  const selectedBodyRef = useRef(selectedBody);
  const ctxRef = useRef<{ selected: Combined | null; draftBody: string; draftDirty: boolean }>({ selected: null, draftBody: "", draftDirty: false });
  const commandActionsRef = useRef<Record<string, () => void | Promise<void>>>({});
  const selectedKind = selected ? recordKind(selected) : null;
  // Markdown・PDF 出力は Note と Report だけ。Resource / Prompt は出さない。
  const showDocumentPublish = selectedKind === "note" || selectedKind === "report";
  const selectedTheme = selected
    ? themes.find((theme) => theme.id === (selected.theme_id || selected.project_id))
    : null;
  const pickerSketch = sketches.find((entry) => entry.id === pickerSketchId) || null;
  const pickerPage = pickerSketch?.document.pages.find((entry) => entry.id === pickerPageId) || null;
  const effectiveBody = previewMode === "preview" ? selectedBody : draftBody;
  const selectedUrl = selected ? str(selected.url || selected.source_url) : "";
  const selectedProperties = selected ? noteProperties(selected) : {};
  const headingNumberOptions = useMemo(
    () => headingNumberOptionsFromProperties(selectedProperties),
    [selectedProperties],
  );
  // 書き出しArtifactの自動追加先。記憶済みで今も存在するChatRefだけを対象にする（#288）。
  const exportTargets = useMemo(
    () => selected ? resolveNoteExportTargets(selected, data.resources as unknown as ChatRefRecord[]) : [],
    [data.resources, selected],
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
  const indexedLineCount = useMemo(
    () => indexedDraftBody.replace(/\r\n?/g, "\n").split("\n").length,
    [indexedDraftBody],
  );
  const sketchEmbedRefs = useMemo(() => extractSketchEmbedRefs(draftBody), [draftBody]);
  const sketchEmbedVersionKey = useMemo(
    () => sketchEmbedRefs.map((ref) => {
      const sketch = sketches.find((entry) => entry.id === ref.sketchId);
      return `${ref.key}:${sketch?.version || 0}:${sketch?.updated_at || "missing"}`;
    }).join("|"),
    [sketchEmbedRefs, sketches],
  );
  useEffect(() => {
    let active = true;
    void Promise.all(sketchEmbedRefs.map(async (ref): Promise<SketchEmbedPreview> => {
      const sketch = sketches.find((entry) => entry.id === ref.sketchId);
      const page = sketch ? findSketchPage(sketch.document, ref.pageId) : null;
      if (!sketch || !page) {
        return { ...ref, title: sketch?.title || "参照切れのSketch", missing: true };
      }
      return {
        ...ref,
        title: sketch.title.trim() || "無題のSketch",
        dataUrl: await renderSketchPageToDataUrl(
          sketchCanvasMode(sketch.document) === "infinite" ? cropSketchPageToContent(page) : page,
        ),
      };
    })).then((previews) => {
      if (!active) return;
      setSketchEmbeds(Object.fromEntries(previews.map((preview) => [preview.key, preview])));
    });
    return () => {
      active = false;
    };
  }, [sketchEmbedVersionKey]);
  const previewRenderOptions = useMemo(
    () => ({ ...headingNumberOptions.preview, sketchEmbeds }),
    [headingNumberOptions.preview, sketchEmbeds],
  );
  const publishRenderOptions = useMemo(
    () => ({ ...headingNumberOptions.publish, sketchEmbeds }),
    [headingNumberOptions.publish, sketchEmbeds],
  );
  const searchMatches = useMemo(
    () => searchOpen && searchQuery.trim() ? findMarkdownMatches(deferredDraftBody, searchQuery) : [],
    [deferredDraftBody, searchOpen, searchQuery],
  );
  // Previewは保存済み本文の表示面なので、置換はEdit / Rawだけで実行できる。
  const replaceEnabled = replaceOpen && previewMode !== "preview" && searchMatches.length > 0;
  const replaceHint = previewMode === "preview"
    ? "Preview表示中は置換できません。Edit または Raw へ切り替えてください。"
    : !searchQuery.trim()
      ? "検索語を入力すると置換できます。"
      : !searchMatches.length
        ? "一致がないため置換できません。検索語を確認してください。"
        : "";
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

  /** Rich Editor編集中は、stateより新しいEditor本文を正とする。 */
  function currentDraftSource(): string {
    return previewMode === "edit" ? mdxMarkdownSourceRef.current?.() || draftBody : draftBody;
  }

  function focusMarkdownEditorSurface() {
    if (previewMode === "raw" || hasMarkdownFootnotes(draftBody)) {
      textareaRef.current?.focus();
      return;
    }
    previewPanelRef.current?.querySelector<HTMLElement>(".note-mdx-content")?.focus();
  }

  function closeMarkdownSearch() {
    setSearchOpen(false);
    setReplaceOpen(false);
    setReplaceUndo(null);
    window.requestAnimationFrame(() => focusMarkdownEditorSurface());
  }

  function openMarkdownReplace() {
    const liveBody = mdxMarkdownSourceRef.current?.();
    if (typeof liveBody === "string") setDraftBody(liveBody);
    setSearchOpen(true);
    setReplaceOpen(true);
    window.requestAnimationFrame(() => {
      if (searchQuery.trim()) replaceInputRef.current?.focus();
      else searchInputRef.current?.focus();
    });
  }

  // window keydownは再登録を避けているため、最新の操作をrefで参照する。
  const openReplaceRef = useRef(openMarkdownReplace);
  const closeSearchRef = useRef(closeMarkdownSearch);
  const searchOpenRef = useRef(searchOpen);
  openReplaceRef.current = openMarkdownReplace;
  closeSearchRef.current = closeMarkdownSearch;
  searchOpenRef.current = searchOpen;

  function replaceCurrentMatch() {
    const source = currentDraftSource();
    const result = replaceMarkdownMatch(source, searchQuery, searchIndex, replaceQuery);
    if (!result.count) {
      setDraftState("置換できる一致がありません。検索語を確認してください。");
      return;
    }
    setReplaceUndo({ body: source, label: "1件の置換" });
    setDraftBody(result.text);
    setSearchIndex(result.nextIndex);
    setDraftState("1件置換しました。");
    window.requestAnimationFrame(() => focusSearchMatch(result.nextIndex));
  }

  function replaceAllMatches() {
    const source = currentDraftSource();
    const result = replaceAllMarkdownMatches(source, searchQuery, replaceQuery);
    if (!result.count) {
      setDraftState("置換できる一致がありません。検索語を確認してください。");
      return;
    }
    setReplaceUndo({ body: source, label: `${result.count}件の一括置換` });
    setDraftBody(result.text);
    setSearchIndex(0);
    setDraftState(`${result.count}件を置換しました。`);
  }

  function undoReplace() {
    if (!replaceUndo) return;
    setDraftBody(replaceUndo.body);
    setSearchIndex(0);
    setDraftState(`${replaceUndo.label}を元に戻しました。`);
    setReplaceUndo(null);
  }

  /**
   * 選択中のNoteを別ウィンドウへ切り離す（#290）。
   * 既に開いていればMain側が前面へ出すだけなので、押し直しても二枚目にならない。
   */
  async function detachSelectedNote() {
    if (!selected || selected.recordType !== "note") return;
    // 切り離す前に、この画面の未保存分を確定させる。別ウィンドウが古い本文を読まないようにする。
    await autoSaveDraft();
    const opened = await workspaceApi.openNoteWindow(selected.id);
    if (!opened) setToast("別ウィンドウで開けませんでした。ノートが見つかりません。", "danger");
  }

  function formatSelectedDraft() {
    const current = currentDraftSource();
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
    setReplaceUndo(null);
    setAutoLinked(null);
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

  // 本体へ戻すときに、対象Noteを選び直す（#290）。
  useEffect(() => {
    const onSelect = (event: Event) => {
      const noteId = (event as CustomEvent<string>).detail;
      if (typeof noteId === "string" && noteId) setSelectedId(noteId);
    };
    window.addEventListener("tasken:select-note", onSelect);
    return () => window.removeEventListener("tasken:select-note", onSelect);
  }, []);

  /** 選択中のNoteが、この画面ではない別ウィンドウで編集中か（#290）。 */
  const detachedElsewhere = !detachedNoteId && Boolean(selected && openNoteWindowIds.includes(selected.id));

  // 別ウィンドウが編集主体のあいだ、本体はPreviewへ落として書き込ませない。
  useEffect(() => {
    if (detachedElsewhere) setPreviewMode("preview");
  }, [detachedElsewhere]);

  // 別ウィンドウで開いているNoteを本体から把握する（#290）。
  useEffect(() => {
    if (detachedNoteId) return;
    void workspaceApi.listOpenNoteWindows().then(setOpenNoteWindowIds).catch(() => setOpenNoteWindowIds([]));
    return workspaceApi.onNoteWindowOpenChanged(setOpenNoteWindowIds);
  }, [detachedNoteId]);

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
      // 置換ボタンへfocusが移った後もEscで閉じられるようにする。
      if (event.key === "Escape" && searchOpenRef.current) {
        closeSearchRef.current();
        return;
      }
      // Ctrl+R は既定では画面再読み込み。未保存本文を失わないよう置換UIを優先する（#286）。
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "r" && !event.shiftKey && !event.altKey) {
        event.preventDefault();
        openReplaceRef.current();
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

  function modeHeadingPositions(mode: PreviewMode, element: HTMLElement): number[] {
    if (mode === "raw") {
      const lineCount = Math.max(1, draftBody.split(/\r?\n/).length);
      return markdownHeadings.map((heading) => rawHeadingScrollTop(
        heading.sourceLine,
        lineCount,
        element.scrollHeight,
      ));
    }
    const elementTop = element.getBoundingClientRect().top;
    return Array.from(element.querySelectorAll<HTMLElement>("h1, h2, h3, h4"))
      .map((heading) => element.scrollTop + heading.getBoundingClientRect().top - elementTop);
  }

  function captureModeScroll(mode: PreviewMode): NoteModeScrollAnchor {
    const element = modeScroller(mode);
    if (!element) return { ratio: 0, headingIndex: null, sectionProgress: 0 };
    return captureNoteModeScroll(
      element.scrollTop,
      Math.max(0, element.scrollHeight - element.clientHeight),
      element.scrollHeight,
      modeHeadingPositions(mode, element),
    );
  }

  // モードごとの描画高ではなく、見出し間の相対位置を引き継ぐ。
  // Mermaid・画像は遅れて高さが確定するため、DOM更新も監視して同じアンカーへ戻す。
  function restoreModeScroll(mode: PreviewMode, state: NoteModeScrollAnchor) {
    modeScrollRestoreCleanupRef.current?.();
    let active = true;
    let observer: MutationObserver | null = null;
    const timers: number[] = [];
    const apply = () => {
      if (!active) return;
      const target = modeScroller(mode);
      if (!target) return;
      target.scrollTop = restoreNoteModeScroll(
        state,
        Math.max(0, target.scrollHeight - target.clientHeight),
        target.scrollHeight,
        modeHeadingPositions(mode, target),
      );
    };
    const cleanup = () => {
      if (!active) return;
      active = false;
      observer?.disconnect();
      timers.forEach((timer) => window.clearTimeout(timer));
      const target = modeScroller(mode);
      target?.removeEventListener("wheel", cleanup);
      target?.removeEventListener("pointerdown", cleanup);
      target?.removeEventListener("touchstart", cleanup);
      target?.removeEventListener("keydown", cleanup);
      if (modeScrollRestoreCleanupRef.current === cleanup) modeScrollRestoreCleanupRef.current = null;
    };
    modeScrollRestoreCleanupRef.current = cleanup;
    window.requestAnimationFrame(() => {
      if (!active) return;
      const target = modeScroller(mode);
      if (!target) return;
      apply();
      observer = new MutationObserver(() => window.requestAnimationFrame(apply));
      observer.observe(target, { childList: true, subtree: true });
      target.addEventListener("wheel", cleanup, { passive: true });
      target.addEventListener("pointerdown", cleanup);
      target.addEventListener("touchstart", cleanup, { passive: true });
      target.addEventListener("keydown", cleanup);
    });
    [50, 150, 350, 600, 1_000, 1_600].forEach((delay) => {
      timers.push(window.setTimeout(apply, delay));
    });
    timers.push(window.setTimeout(cleanup, 2_000));
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

  function showSketchPicker() {
    const sketch = sketches.find((entry) => entry.id === pickerSketchId) || sketches[0];
    setPickerSketchId(sketch?.id || "");
    setPickerPageId(sketch?.document.pages[0]?.id || "");
    setSketchPickerOpen(true);
  }

  function insertSelectedSketch() {
    const sketch = sketches.find((entry) => entry.id === pickerSketchId);
    const page = sketch?.document.pages.find((entry) => entry.id === pickerPageId);
    if (!sketch || !page) {
      setDraftState("挿入するSketchとページを選んでください。");
      return;
    }
    const markdown = `\n\n${sketchEmbedMarkdown(sketch, page)}\n\n`;
    if (mdxMarkdownInsertRef.current) {
      mdxMarkdownInsertRef.current(markdown);
    } else {
      const textarea = textareaRef.current;
      const start = textarea?.selectionStart ?? draftBody.length;
      const end = textarea?.selectionEnd ?? start;
      insertDraftMarkdown(markdown, start, end);
    }
    setRichEditorDirty(true);
    setDraftState(`Sketch「${sketch.title || "無題"}」を挿入しました。`);
    setSketchPickerOpen(false);
  }

  const previewSketchImage = useCallback(async (src: string): Promise<string> => {
    const ref = parseSketchEmbedUrl(src);
    if (!ref) return src;
    const cached = sketchEmbeds[ref.key]?.dataUrl;
    if (cached) return cached;
    const sketch = sketches.find((entry) => entry.id === ref.sketchId);
    const page = sketch ? findSketchPage(sketch.document, ref.pageId) : null;
    if (page && sketch) {
      return renderSketchPageToDataUrl(
        sketchCanvasMode(sketch.document) === "infinite" ? cropSketchPageToContent(page) : page,
      );
    }
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="720" height="240"><rect width="100%" height="100%" fill="#f6f1ed"/><text x="50%" y="50%" text-anchor="middle" dominant-baseline="middle" fill="#746a65" font-family="sans-serif" font-size="22">参照先のSketchが見つかりません</text></svg>`;
    return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
  }, [sketchEmbeds, sketches]);

  function openEmbeddedSketch(event: MouseEvent<HTMLDivElement>) {
    const target = (event.target as HTMLElement).closest<HTMLElement>("[data-sketch-id]");
    if (!target) return;
    const sketchId = target.dataset.sketchId;
    const pageId = target.dataset.sketchPageId;
    if (!sketchId || !sketches.some((entry) => entry.id === sketchId)) return;
    event.preventDefault();
    localStorage.setItem(ACTIVE_SKETCH_ID_KEY, sketchId);
    if (pageId) localStorage.setItem(ACTIVE_SKETCH_PAGE_KEY, pageId);
    navigate("sketch-editor");
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

  /**
   * 出力先ChatRefが確定済みなら、書き出したArtifactを確認なしで同じ参照へ追加する（#288）。
   * 追加に失敗しても書き出したファイルと文書は触らず、通常の紐づけ導線へ戻す。
   */
  async function autoLinkExportArtifacts(exported: NoteDocumentExport) {
    if (!exportTargets.length) {
      setRecentExport(exported);
      return;
    }
    const operations: SaveOperation[] = [];
    const undo: AutoLinkUndoEntry[] = [];
    for (const chatRef of exportTargets) {
      const { operation } = buildNoteExportArtifactOperation({ exported, chatRef, artifacts: data.artifacts });
      const artifactId = str((operation.entity as Record<string, unknown>).id);
      operations.push(operation);
      undo.push({ artifactId, previous: data.artifacts.find((artifact) => artifact.id === artifactId) || null });
    }

    try {
      await saveEntities(operations, `${exported.format === "pdf" ? "PDF" : "Markdown"}を保存し、Chat Refへ追加しました。`);
      setRecentExport(null);
      setAutoLinked({ exported, chatRefs: exportTargets, undo });
    } catch (error) {
      setToast(
        `Chat Refへ自動追加できませんでした。書き出したファイルはそのまま残っています。${error instanceof Error ? error.message : String(error)}`,
        "danger",
      );
      setRecentExport(exported);
    }
  }

  async function undoAutoLink() {
    if (!autoLinked) return;
    const restored = autoLinked.undo.filter((entry) => entry.previous);
    try {
      if (restored.length) {
        await saveEntities(
          restored.map((entry) => ({ action: "save" as const, type: "artifact" as const, entity: entry.previous as Entity })),
          "自動追加を取り消しました。",
        );
      }
      for (const entry of autoLinked.undo) {
        if (!entry.previous) await removeEntityQuiet("artifact", entry.artifactId);
      }
      if (!restored.length) setToast("自動追加を取り消しました。", "success");
      setRecentExport(autoLinked.exported);
      setAutoLinked(null);
    } catch (error) {
      setToast(`自動追加を取り消せませんでした。${error instanceof Error ? error.message : String(error)}`, "danger");
    }
  }

  /** 明示的に選ばれたChatRefだけを、次回以降の出力先として記憶する。 */
  async function rememberExportTarget(chatRefId: string) {
    if (!selected || !chatRefId) return;
    const next = [...new Set([...noteArtifactExportTargetIds(selected), chatRefId])];
    await saveEntity("note", {
      ...selected,
      properties_json: withNoteArtifactExportTargets(noteProperties(selected), next),
    }, { quiet: true });
  }

  async function clearExportTargets() {
    if (!selected) return;
    await saveEntity("note", {
      ...selected,
      properties_json: withNoteArtifactExportTargets(noteProperties(selected), []),
    }, { quiet: true });
    setToast("自動追加先を解除しました。次回の書き出しでは紐づけ先を選び直します。", "success");
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
      const exported = createNoteDocumentExport(selected, {
        format: "markdown",
        filePath: str(result.filePath),
        directory: str(result.directory),
        exportedAt: str(result.exportedAt) || new Date().toISOString(),
        storageMode: chooseDirectory
          ? "linked"
          : str(markdownExport?.storageMode) === "linked" ? "linked" : "managed",
      });
      await saveEntity("note", {
        ...selected,
        properties_json: withNoteDocumentExport({
          ...selectedProperties,
          markdown_export: {
            directory: result.directory,
            filePath: result.filePath,
            exportedAt: result.exportedAt,
            bodySignature: noteExportSignature(bodyForExport),
            storageMode: exported.storageMode,
          },
        }, exported),
      });
      setToast(`Markdownを保存しました。${result.filePath || ""}`, "success");
      await autoLinkExportArtifacts(exported);
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
        html: await renderMermaidDocumentForPdf(previewDocument(content, "markdown", publishRenderOptions)),
        chooseDirectory: true,
        fileName: `${str(selected.title) || "markdown-document"}.pdf`,
        themeId: str(selected.project_id || selected.theme_id) || null,
      });
      if (result.canceled) {
        setToast("PDF出力をキャンセルしました。", "info");
        return;
      }
      const exported = createNoteDocumentExport(selected, {
        format: "pdf",
        filePath: str(result.filePath),
        directory: str(result.directory),
        exportedAt: str(result.exportedAt) || new Date().toISOString(),
        storageMode: "linked",
      });
      await saveEntity("note", {
        ...selected,
        properties_json: withNoteDocumentExport(selectedProperties, exported),
      }, { quiet: true });
      const warningText = result.warnings?.length ? `（注意: ${result.warnings[0]}${result.warnings.length > 1 ? ` 他${result.warnings.length - 1}件` : ""}）` : "";
      setToast(`PDFを出力しました。${result.filePath || ""}${warningText}`, result.warnings?.length ? "warning" : "success");
      await autoLinkExportArtifacts(exported);
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
    <div className={`page notes-page${documentFocus ? " is-document-focus" : ""}${detachedNoteId ? " is-detached-note" : ""}`}>
      {/* 切り離しウィンドウでは新規作成や一覧操作を出さず、この文書の操作だけにする（#290）。 */}
      <PageHeader route="notes" title={detachedNoteId ? str(selected?.title) || "無題のノート" : undefined}>
        {detachedNoteId ? (
          <>
            <button className="secondary-button" onClick={() => void workspaceApi.openNoteWindowInMain("notes")}>Taskenを表示</button>
            <button className="primary-button" onClick={() => void workspaceApi.returnNoteWindowToMain()}>本体へ戻す</button>
          </>
        ) : (
          <>
            <button className="secondary-button" onClick={copy}>一覧をコピー</button>
            <button className="secondary-button" onClick={() => setDraftWorkspaceTarget(null)}><IconSparkles size={16} />AI Draft</button>
            <button className="primary-button" onClick={() => addNote("note")}>Note</button>
            <button className="primary-button" onClick={() => openDrawer({ type: "resource", mode: "edit", entity: { project_id: activeTheme?.id || null } })}>Resource</button>
            <button className="primary-button" onClick={() => addNote("report")}>Report</button>
            <button className="primary-button" onClick={() => addPrompt()}>Prompt</button>
          </>
        )}
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
        <select
          value={themeId}
          onChange={(event) => {
            const next = event.target.value;
            if (next !== "all" && !themes.some((t) => t.id === next) && next !== "none") {
              updatePrefs({ themeId: "all" });
            } else {
              updatePrefs({ themeId: next });
            }
          }}
          aria-label="Themeで絞り込み"
        >
          <option value="all">Theme: すべて</option>
          <option value="none">Themeなし</option>
          {themes.map((theme) => (
            <option key={theme.id} value={theme.id}>{theme.name}</option>
          ))}
        </select>
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
      <div
        className={`notes-workbench${listCollapsed || documentFocus || detachedNoteId ? " is-list-collapsed" : ""}`}
        ref={workbenchRef}
        style={!listCollapsed && !documentFocus && !detachedNoteId && listWidth ? { "--notes-list-width": `${listWidth}px` } as React.CSSProperties : undefined}
      >
        {/* 切り離しウィンドウでは一覧を畳む。gridの列を保つため要素自体は残す（#290）。 */}
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
        <div
          className="notes-resize-handle"
          role="separator"
          aria-orientation="vertical"
          aria-label="一覧と本文の境界"
          tabIndex={0}
          onPointerDown={handleResize}
          onDoubleClick={toggleListCollapsed}
          onKeyDown={(event) => {
            if (event.key === "Enter" || event.key === " ") { event.preventDefault(); toggleListCollapsed(); }
            if (event.key === "ArrowLeft") { event.preventDefault(); updatePrefs({ listWidth: Math.max(180, (listWidth || 280) - 40), listCollapsed: false }); }
            if (event.key === "ArrowRight") { event.preventDefault(); updatePrefs({ listWidth: Math.min(800, (listWidth || 280) + 40), listCollapsed: false }); }
          }}
        />
        {contextMenu && <ContextMenu x={contextMenu.x} y={contextMenu.y} items={contextMenu.items} onClose={() => setContextMenu(null)} />}
        <section className="panel note-preview-panel" ref={previewPanelRef}>
          {selected ? (
            <>
              {/* 同じNoteを二つのEditorで黙って同時編集させない（#290）。
                  別ウィンドウが編集主体のあいだ、本体はPreviewに固定して読むだけにする。 */}
              {detachedElsewhere && (
                <div className="note-detached-notice" role="status">
                  <span>このノートは別ウィンドウで編集中です。ここでは内容の確認だけできます。</span>
                  <button className="secondary-button compact" onClick={() => void detachSelectedNote()}>別ウィンドウを表示</button>
                </div>
              )}
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
                  {selected.recordType === "note" && (
                    <button className="secondary-button compact" onClick={openNoteAi}><IconSparkles size={15} />AI編集</button>
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
                      disabled={detachedElsewhere}
                      title={detachedElsewhere ? "別ウィンドウで編集中です" : undefined}
                      onMouseEnter={() => { void loadMarkdownRichEditor(); }}
                      onFocus={() => { void loadMarkdownRichEditor(); }}
                      onClick={() => switchPreviewMode("edit")}
                    >
                      Edit
                    </button>
                    <button className={previewMode === "preview" ? "is-active" : ""} onClick={() => switchPreviewMode("preview")}>Preview</button>
                    <button
                      className={previewMode === "raw" ? "is-active" : ""}
                      disabled={detachedElsewhere}
                      title={detachedElsewhere ? "別ウィンドウで編集中です" : undefined}
                      onClick={() => switchPreviewMode("raw")}
                    >Raw</button>
                  </div>
                  {!detachedNoteId && (
                    <button
                      className="secondary-button compact"
                      aria-pressed={documentFocus}
                      onClick={toggleDocumentFocus}
                      title={documentFocus ? "元の表示へ戻す（Esc）" : "一覧と補助行を畳んで本文を縦いっぱいに広げます"}
                    >
                      {documentFocus ? "表示を戻す" : "本文を広げる"}
                    </button>
                  )}
                  {/* 同じNoteの二枚目は作らない。既に開いていれば前面へ出すだけ（#290）。 */}
                  {!detachedNoteId && selected?.recordType === "note" && (
                    <button
                      className={`secondary-button compact ${openNoteWindowIds.includes(selected.id) ? "is-active" : ""}`}
                      onClick={() => void detachSelectedNote()}
                      title={openNoteWindowIds.includes(selected.id)
                        ? "別ウィンドウを前面に表示します"
                        : "本文を別ウィンドウへ切り離し、本体では別の画面へ移動できます"}
                    >
                      {openNoteWindowIds.includes(selected.id) ? "別ウィンドウを表示" : "別ウィンドウで開く"}
                    </button>
                  )}
                  <button className="secondary-button compact" onClick={formatSelectedDraft} title="行末空白と過剰な空行を整えます">整形</button>
                  <button
                    className="secondary-button compact"
                    disabled={previewMode !== "edit" || !sketches.length}
                    onClick={showSketchPicker}
                    title={sketches.length ? "カーソル位置に既存Sketchを挿入" : "先にSketchを作成してください"}
                  >
                    <IconWriting size={15} stroke={1.8} aria-hidden />
                    Sketch
                  </button>
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
              {showDocumentPublish && exportTargets.length > 0 && (
                <p className="note-export-target" role="status">
                  <span>
                    書き出しはChat Ref「{exportTargets.map((chatRef) => str(chatRef.title) || "無題").join("」「")}」へ自動追加します。
                  </span>
                  <button type="button" className="text-button compact" onClick={() => void clearExportTargets()}>解除</button>
                </p>
              )}
              {recentExport?.noteId === selected.id && (
                <div className="note-export-handoff" role="status">
                  <span>{recentExport.format === "pdf" ? "PDF" : "Markdown"}を書き出しました。</span>
                  <button
                    type="button"
                    className="secondary-button compact"
                    onClick={() => setExportLinkDialogOpen(true)}
                  >
                    Chat Refへ紐づける
                  </button>
                  <button
                    type="button"
                    className="text-button compact"
                    onClick={() => setRecentExport(null)}
                  >
                    閉じる
                  </button>
                </div>
              )}
              {autoLinked?.exported.noteId === selected.id && (
                <div className="note-export-handoff" role="status">
                  <span>
                    {autoLinked.exported.format === "pdf" ? "PDF" : "Markdown"}を保存し、Chat Ref「
                    {autoLinked.chatRefs.map((chatRef) => str(chatRef.title) || "無題").join("」「")}
                    」へ追加しました。
                  </span>
                  <button
                    type="button"
                    className="secondary-button compact"
                    onClick={() => openDrawer({
                      type: "resource",
                      mode: "edit",
                      entity: autoLinked.chatRefs[0] as unknown as Record<string, unknown>,
                    })}
                  >
                    Chat Refを開く
                  </button>
                  <button type="button" className="secondary-button compact" onClick={undoAutoLink}>取り消す</button>
                  <button
                    type="button"
                    className="text-button compact"
                    onClick={() => {
                      setRecentExport(autoLinked.exported);
                      setExportLinkDialogOpen(true);
                    }}
                  >
                    紐づけ先を変更
                  </button>
                  <button type="button" className="text-button compact" onClick={() => setAutoLinked(null)}>閉じる</button>
                </div>
              )}
              {searchOpen && (
                <div className="markdown-search-bar" role="search" aria-label="Markdown本文を検索・置換">
                  <div className="markdown-search-row">
                    <input
                      ref={searchInputRef}
                      value={searchQuery}
                      onChange={(event) => {
                        setSearchQuery(event.target.value);
                        setSearchIndex(0);
                      }}
                      onKeyDown={(event) => {
                        if (event.key === "Enter" && !event.nativeEvent.isComposing) {
                          event.preventDefault();
                          moveSearchMatch(event.shiftKey ? -1 : 1);
                        }
                        if (event.key === "Escape") closeMarkdownSearch();
                      }}
                      placeholder="本文を検索"
                      aria-label="本文を検索"
                    />
                    <span className="markdown-search-count" aria-live="polite">
                      {searchMatches.length ? `${searchIndex + 1}/${searchMatches.length}` : searchQuery.trim() ? "一致なし" : "検索語を入力"}
                    </span>
                    <button type="button" className="secondary-button compact" disabled={!searchMatches.length} onClick={() => moveSearchMatch(-1)}>前へ</button>
                    <button type="button" className="secondary-button compact" disabled={!searchMatches.length} onClick={() => moveSearchMatch(1)}>次へ</button>
                    <button
                      type="button"
                      className="secondary-button compact"
                      aria-expanded={replaceOpen}
                      onClick={() => (replaceOpen ? setReplaceOpen(false) : openMarkdownReplace())}
                    >
                      置換
                    </button>
                    <button type="button" className="secondary-button compact" onClick={closeMarkdownSearch}>閉じる</button>
                  </div>
                  {replaceOpen && (
                    <div className="markdown-search-row">
                      <input
                        ref={replaceInputRef}
                        value={replaceQuery}
                        onChange={(event) => setReplaceQuery(event.target.value)}
                        onKeyDown={(event) => {
                          if (event.key === "Enter" && !event.nativeEvent.isComposing) {
                            event.preventDefault();
                            if (replaceEnabled) replaceCurrentMatch();
                          }
                          if (event.key === "Escape") closeMarkdownSearch();
                        }}
                        placeholder="置換後の文字列"
                        aria-label="置換後の文字列"
                      />
                      <button type="button" className="secondary-button compact" disabled={!replaceEnabled} onClick={replaceCurrentMatch}>置換</button>
                      <button type="button" className="secondary-button compact" disabled={!replaceEnabled} onClick={replaceAllMatches}>すべて置換</button>
                      {replaceUndo && (
                        <button type="button" className="text-button compact" onClick={undoReplace}>元に戻す</button>
                      )}
                    </div>
                  )}
                  {replaceOpen && replaceHint && <p className="field-help">{replaceHint}</p>}
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
                  mode={previewMode}
                  sourceLineCount={indexedLineCount}
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
                        headingNumberOptions={previewRenderOptions}
                        markdownSourceRef={mdxMarkdownSourceRef}
                        markdownInsertRef={mdxMarkdownInsertRef}
                        onChange={updateRichEditorDraft}
                        onDirty={markRichEditorDirty}
                        onImageUpload={uploadEditorImage}
                        onImagePreview={previewSketchImage}
                        onError={reportRichEditorError}
                        onExtractSelection={selected.recordType === "note" ? extractSelection : undefined}
                        onAiEditSelection={selected.recordType === "note" ? openSelectionAi : undefined}
                      />
                    </Suspense>
                  </MarkdownEditorBoundary>
                ) : previewMode === "preview" ? (
                  <MarkdownPreview className="note-main-preview markdown-preview"
                    html={previewHtml(draftBody, "markdown", previewRenderOptions)}
                    onClick={openEmbeddedSketch}
                  />
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
      {sketchPickerOpen && (
        <div className="modal-backdrop" onMouseDown={() => setSketchPickerOpen(false)}>
          <section className="modal-card note-sketch-dialog" role="dialog" aria-modal="true" aria-labelledby="note-sketch-title" onMouseDown={(event) => event.stopPropagation()}>
            <div className="modal-card-header">
              <h2 id="note-sketch-title">Sketchを挿入</h2>
              <button className="text-button compact" type="button" onClick={() => setSketchPickerOpen(false)}>閉じる</button>
            </div>
            <label>
              Sketch
              <select
                value={pickerSketchId}
                onChange={(event) => {
                  const next = sketches.find((entry) => entry.id === event.target.value);
                  setPickerSketchId(event.target.value);
                  setPickerPageId(next?.document.pages[0]?.id || "");
                }}
              >
                {sketches.map((sketch) => <option key={sketch.id} value={sketch.id}>{sketch.title || "無題のSketch"}</option>)}
              </select>
            </label>
            <label>
              ページ
              <select value={pickerPageId} onChange={(event) => setPickerPageId(event.target.value)}>
                {pickerSketch?.document.pages.map((page, index) => <option key={page.id} value={page.id}>{index + 1}. {page.title}</option>)}
              </select>
            </label>
            {pickerPage && <div className="note-sketch-picker-preview"><SketchPickerPreview page={pickerPage} /></div>}
            <div className="modal-actions">
              <button className="secondary-button" type="button" onClick={() => setSketchPickerOpen(false)}>取消</button>
              <button className="primary-button" type="button" onClick={insertSelectedSketch}>カーソル位置へ挿入</button>
            </div>
          </section>
        </div>
      )}
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
      {selected && selected.recordType === "note" && aiTarget && (
        <NoteAiDialog
          note={selected}
          body={mdxMarkdownSourceRef.current?.() || draftBody}
          target={aiTarget}
          saveEntity={saveEntity}
          setToast={setToast}
          onClose={() => setAiTarget(null)}
        />
      )}
      {exportLinkDialogOpen && recentExport && (
        <ChatRefArtifactLinkDialog
          data={data}
          initialExport={recentExport}
          saveEntities={saveEntities}
          setToast={setToast}
          onLinked={(chatRefId) => {
            setRecentExport(null);
            setAutoLinked(null);
            // 明示的に選ばれた紐づけ先だけを、次回以降の自動追加先として記憶する。
            void rememberExportTarget(chatRefId);
          }}
          close={() => setExportLinkDialogOpen(false)}
        />
      )}
    </div>
  );
}
