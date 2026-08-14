import {
  IconExternalLink,
  IconFolder,
  IconLink,
  IconNotes,
  IconPrompt,
  IconReport,
  IconSearch,
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

import type { MermaidPowerPointAction } from "../../../../../shared/mermaidPowerPoint";
import { canonicalThemeId } from "../../../../../shared/themeRef.mjs";
import {
  markdownSignature,
  buildCanonicalMarkdownContent,
  canonicalMarkdownBindingFromProperties,
  canonicalMarkdownFileState,
  withCanonicalMarkdownBinding,
  noteSaveStateLabel,
  shouldCreateExportArtifact,
  type CanonicalMarkdownFileState,
} from "../../../../../shared/canonicalMarkdown.mjs";
import { isFocusSession } from "../../../../../shared/focusSession.mjs";
import { markdownHeadingAt } from "../../../../../shared/noteAiConversation.mjs";
import { workspaceApi } from "../../../services/workspaceApi";
import { ActionButton, Button, ContextMenu, EmptyState, PageHeader, ThemePickerSelect, type ContextMenuItem } from "../components/common";
import { ChatRefArtifactLinkDialog } from "../components/ChatRefArtifactLinkDialog";
import { MarkdownHeadingIndex } from "../components/MarkdownHeadingIndex";
import { MarkdownDiffMarkerRail } from "../components/MarkdownDiffMarkerRail";
import { MarkdownEditorBoundary } from "../components/MarkdownEditorBoundary";
import { MarkdownPreview } from "../components/MarkdownPreview";
import { NoteAiDrawer, type NoteAiTarget } from "../components/NoteAiDrawer";
import { NoteCreateMenu } from "../components/NoteCreateMenu";
import { ToolbarMenu, type ToolbarMenuItem } from "../components/ToolbarMenu";
import type { SelectionCommandRequest } from "../components/MarkdownRichEditor";
import { clipboardImageFile, readFileAsDataUrl } from "../lib/clipboardImage";
import { isChatReference } from "../lib/chatRefs";
import { NOTES_KIND_LABELS, notesKindFromNoteType, themeColor, type NotesKind } from "../lib/domain";
import { str } from "../lib/format";
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
import { extractMermaidPptxDiagram, mermaidPowerPointCapabilities } from "../lib/mermaidPowerPoint";
import { renderMermaidDocumentForPdf, renderMermaidSvgForOffice } from "../lib/mermaid";
import {
  captureNoteModeScroll,
  rawHeadingScrollTop,
  restoreNoteModeScroll,
  type NoteModeScrollAnchor,
} from "../lib/noteModeScroll";
import {
  makeNoteDraftSnapshot,
  noteDraftOwner,
  noteDraftOwnerKey,
  readNoteDraftBody,
  renderNoteDraftBody,
  sameNoteDraftOwner,
  type NoteDraftEditorSession,
  type NoteDraftOwner,
  type NoteDraftSnapshot,
} from "../lib/noteDraftIdentity";
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
import type { Artifact, BaseRecord, Entity, NoteComment, PageProps, SaveOperation, SaveOptions, Sketch } from "../types";
import { usePreference } from "../../../utils/usePreference";
import { compactNotesBodyPreview, compareNotesRecords, type NotesPreferences, type NotesSortOrder } from "../lib/notes";
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
import { flushPendingNoteDraftSaves, trackPendingNoteDraftSave } from "../lib/noteDraftFlushRegistry";
import { startLatestSaveQueue, type LatestSaveQueueState } from "../lib/noteDraftSaveQueue";

type Combined = BaseRecord & { recordType: "note" | "resource" };
type PreviewMode = "edit" | "preview" | "raw";
type NoteScope = "all" | NotesKind;
type DraftSaveJob = {
  request: { selected: Combined; snapshot: NoteDraftSnapshot };
  options: SaveOptions;
  entityPatch: Record<string, unknown>;
};
type DraftSaveQueue = LatestSaveQueueState<DraftSaveJob, CanonicalMarkdownFileState> & {
  lastSavedBody: string | null;
  lastSavedRevision: number | null;
};
type DraftSaveResult = { ok: boolean; fileState: CanonicalMarkdownFileState };

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
  const [prefs, setPrefs] = usePreference("notes.preferences");
  const [resizeDraft, setResizeDraft] = useState<Partial<Pick<NotesPreferences, "listWidth" | "listCollapsed">> | null>(null);
  const resizeDraftRef = useRef(resizeDraft);
  resizeDraftRef.current = resizeDraft;
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
  const themeId = prefs.themeId !== "all" && prefs.themeId !== ""
    && !themes.some((t) => t.id === prefs.themeId) ? "all" : prefs.themeId;
  const normalizedQuery = query.trim().toLocaleLowerCase();
  const visible = useMemo(() => records.filter((record) => {
    if (scope !== "all" && recordKind(record) !== scope) return false;
    if (themeId === "") {
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
  const selectedOwner = selected ? noteDraftOwner(selected.recordType, selected.id) : null;
  const selectedOwnerKey = selectedOwner ? noteDraftOwnerKey(selectedOwner) : null;
  // 初回描画を空本文→実本文の二段階にせず、Preview/Editの再構築を一度にする。
  const [draftOwner, setDraftOwner] = useState<NoteDraftOwner | null>(selectedOwner);
  const [draftBodyState, setDraftBodyState] = useState(() => normalizeRichEditorMarkdown(selectedBody));
  // 選択切替のrenderでは、前文書のsnapshotを新文書へ渡さない。切替先の保存済み本文を使う。
  const draftSnapshotState: NoteDraftSnapshot | null = draftOwner
    ? { owner: draftOwner, body: draftBodyState, dirty: true, expectedRevision: Number(selected?.version || 0) }
    : null;
  const draftBody = renderNoteDraftBody(selectedOwner, draftSnapshotState, selectedBody);
  const [richEditorDirty, setRichEditorDirty] = useState(false);
  const [draftState, setDraftState] = useState("");
  // 直近の正本Markdown同期の結果（#291）。署名比較では分からない外部変更・失敗を保持する。
  const [canonicalSyncState, setCanonicalSyncState] = useState<CanonicalMarkdownFileState | null>(null);
  /** 選択範囲の変換を明示commandで呼ぶための合図（#313）。 */
  const [selectionCommand, setSelectionCommand] = useState<SelectionCommandRequest | null>(null);
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchIndex, setSearchIndex] = useState(0);
  const [replaceOpen, setReplaceOpen] = useState(false);
  const [replaceQuery, setReplaceQuery] = useState("");
  const [diffOpen, setDiffOpen] = useState(false);
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
  const listWidth = resizeDraft?.listWidth ?? prefs.listWidth;
  const listCollapsed = resizeDraft?.listCollapsed ?? prefs.listCollapsed;
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
        const next = { listCollapsed: true, listWidth: MIN_WIDTH } as const;
        resizeDraftRef.current = next;
        setResizeDraft(next);
      } else {
        const clamped = Math.max(MIN_WIDTH, Math.min(x, rect.width * 0.6));
        const next = { listCollapsed: false, listWidth: clamped } as const;
        resizeDraftRef.current = next;
        setResizeDraft(next);
      }
    };
    const onUp = () => {
      draggingRef.current = false;
      document.removeEventListener("pointermove", onMove);
      document.removeEventListener("pointerup", onUp);
      const draft = resizeDraftRef.current;
      if (draft) setPrefs((current) => ({ ...current, ...draft }));
      resizeDraftRef.current = null;
      setResizeDraft(null);
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
  const mdxMarkdownSourceRef = useRef<NoteDraftEditorSession | null>(null);
  const modeScrollRestoreCleanupRef = useRef<(() => void) | null>(null);
  const selectedOwnerKeyRef = useRef<string | null>(selectedOwnerKey);
  selectedOwnerKeyRef.current = selectedOwnerKey;
  const selectedOwnerRef = useRef<NoteDraftOwner | null>(selectedOwner);
  selectedOwnerRef.current = selectedOwner;

  useEffect(() => () => modeScrollRestoreCleanupRef.current?.(), []);

  function setDraftBodyForSelected(next: string | ((current: string) => string)): void {
    if (!selectedOwner) return;
    const resolved = typeof next === "function" ? next(draftBody) : next;
    setDraftOwner(selectedOwner);
    setDraftBodyState(resolved);
  }

  function currentDraftBodyForSelected(): string {
    if (!selectedOwner) return "";
    return readNoteDraftBody({
      owner: selectedOwner,
      snapshot: draftSnapshotState,
      editor: mdxMarkdownSourceRef.current,
      savedBody: selectedBody,
    });
  }

  function captureCurrentDraftSnapshot(): { selected: Combined; snapshot: NoteDraftSnapshot } | null {
    if (!selected || !selectedOwner) return null;
    const body = currentDraftBodyForSelected();
    return {
      selected,
      snapshot: makeNoteDraftSnapshot(selectedOwner, body, selectedBody, Number(selected.version || 0)),
    };
  }

  function openSelectionAi(selection: MarkdownTextSelection) {
    const source = currentDraftBodyForSelected();
    const first = source.indexOf(selection.text);
    const second = first >= 0 ? source.indexOf(selection.text, first + selection.text.length) : -1;
    if (first < 0 || second >= 0) {
      setToast("選択範囲をMarkdown本文上で一意に特定できません。Rawで選び直すか文書全体を指定してください。", "warning");
      return;
    }
    setAiTarget({
      scope: "selection", start: first, end: first + selection.text.length, text: selection.text,
      heading: selection.heading || markdownHeadingAt(source, first),
      baseRevision: Number(selected?.version || 0), bodySignature: markdownSignature(source), anchorOffset: first,
    });
  }

  function openNoteAi() {
    const textarea = textareaRef.current;
    const body = currentDraftBodyForSelected();
    if (textarea && (previewMode === "raw" || hasMarkdownFootnotes(draftBody)) && textarea.selectionEnd > textarea.selectionStart) {
      const start = textarea.selectionStart;
      const end = textarea.selectionEnd;
      setAiTarget({
        scope: "selection", start, end, text: body.slice(start, end), heading: markdownHeadingAt(body, start),
        baseRevision: Number(selected?.version || 0), bodySignature: markdownSignature(body), anchorOffset: start,
      });
      return;
    }
    const richAnchor = previewMode === "edit" ? richAiAnchorRef.current : null;
    const start = richAnchor?.offset ?? textarea?.selectionStart ?? body.length;
    setAiTarget({
      scope: "document", start, end: start, heading: richAnchor?.heading || markdownHeadingAt(body, start),
      baseRevision: Number(selected?.version || 0), bodySignature: markdownSignature(body), anchorOffset: start,
    });
  }
  const mdxMarkdownInsertRef = useRef<((markdown: string) => void) | null>(null);
  const richAiAnchorRef = useRef<{ heading: string; offset: number } | null>(null);
  useEffect(() => {
    richAiAnchorRef.current = null;
  }, [selectedOwnerKey]);
  const selectedBodyRef = useRef<NoteDraftSnapshot | null>(selectedOwner
    ? makeNoteDraftSnapshot(selectedOwner, selectedBody, selectedBody, Number(selected?.version || 0))
    : null);
  const ctxRef = useRef<{ selected: Combined | null; snapshot: NoteDraftSnapshot | null }>({ selected: null, snapshot: null });
  const commandActionsRef = useRef<Record<string, () => void | Promise<void>>>({});
  const selectedKind = selected ? recordKind(selected) : null;
  // Markdown・PDF 出力は Note と Report だけ。Resource / Prompt は出さない。
  const showDocumentPublish = selectedKind === "note" || selectedKind === "report";
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
  const canonicalBinding = canonicalMarkdownBindingFromProperties(selectedProperties, { noteId: selected?.id || "" });
  const markdownExport = canonicalBinding ? {
    filePath: canonicalBinding.canonical_path,
    directory: canonicalBinding.directory,
    fileSignature: canonicalBinding.file_signature,
    bodySignature: canonicalBinding.body_signature,
    storageMode: "linked",
    syncState: canonicalBinding.sync_state,
  } : null;
  const markdownExportFilePath = str(markdownExport?.filePath);
  const markdownExportDirectory = str(markdownExport?.directory);
  const markdownExportOpenPath = markdownExportFilePath || markdownExportDirectory;
  const currentExportSignature = markdownSignature(selectedBody);
  const markdownExportStale = Boolean(str(markdownExport?.bodySignature) && str(markdownExport?.bodySignature) !== currentExportSignature);
  const hasMarkdownExportDirectory = Boolean(str(markdownExport?.directory));
  const draftDirty = Boolean(selected && (richEditorDirty || draftBody !== selectedBody));
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
    // scope / Themeの変更で選択文書がvisibleから外れる場合も、切替前のsnapshotを確定する。
    if (patch.scope !== undefined || patch.themeId !== undefined) {
      flushCurrentDraft();
    }
    setPrefs((current) => ({ ...current, ...patch }));
  }

  function flushCurrentDraft(): void {
    const current = captureCurrentDraftSnapshot();
    if (!current?.snapshot.dirty) return;
    void flushDraftSnapshot(current);
    // 選択切替effectが同じsnapshotを二重保存しないよう、明示flushの所有権を移す。
    if (autosaveRef.current && sameNoteDraftOwner(autosaveRef.current.snapshot.owner, current.snapshot.owner)) {
      autosaveRef.current = null;
    }
  }

  function switchDocument(next: Combined | null): void {
    const nextOwnerKey = next ? noteDraftOwnerKey(noteDraftOwner(next.recordType, next.id)) : null;
    if (nextOwnerKey !== selectedOwnerKey) flushCurrentDraft();
    setSelectedId(next?.id || null);
    if (next) setPreviewMode("edit");
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
    return previewMode === "edit" ? currentDraftBodyForSelected() : draftBody;
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
    window.requestAnimationFrame(() => focusMarkdownEditorSurface());
  }

  function openMarkdownReplace() {
    setDraftBodyForSelected(currentDraftBodyForSelected());
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


  /**
   * 置換結果をEditorへ流す（#286）。
   *
   * Rich Editorへは setMarkdown で流し込むが、Lexicalはroot全体の入れ替えを
   * 1つのHISTORY_PUSHとして積むため、一件置換も一括置換もCtrl+Zで一度に戻り、
   * Ctrl+Yでやり直せる。
   *
   * Raw（textarea）はReactの制御値なので、setStateだけではブラウザのUndo履歴へ
   * 入らない。全体を選択して execCommand("insertText") で書き換え、標準のUndoに
   * 1手として乗せる。失敗した環境ではstate更新へ落とす（置換自体は成立させる）。
   */
  function applyReplacedBody(nextBody: string): void {
    const textarea = textareaRef.current;
    const usesTextarea = previewMode === "raw" || hasMarkdownFootnotes(draftBody);
    if (usesTextarea && textarea) {
      textarea.focus();
      textarea.setSelectionRange(0, textarea.value.length);
      if (document.execCommand("insertText", false, nextBody)) return;
    }
    setDraftBodyForSelected(nextBody);
  }

  function replaceCurrentMatch() {
    const source = currentDraftSource();
    const result = replaceMarkdownMatch(source, searchQuery, searchIndex, replaceQuery);
    if (!result.count) {
      setDraftState("置換できる一致がありません。検索語を確認してください。");
      return;
    }
    applyReplacedBody(result.text);
    setSearchIndex(result.nextIndex);
    setDraftState("1件置換しました。Ctrl+Zで戻せます。");
    window.requestAnimationFrame(() => focusSearchMatch(result.nextIndex));
  }

  function replaceAllMatches() {
    const source = currentDraftSource();
    const result = replaceAllMarkdownMatches(source, searchQuery, replaceQuery);
    if (!result.count) {
      setDraftState("置換できる一致がありません。検索語を確認してください。");
      return;
    }
    applyReplacedBody(result.text);
    setSearchIndex(0);
    setDraftState(`${result.count}件を置換しました。Ctrl+Zで一度に戻せます。`);
  }

  /**
   * 選択中のNoteを別ウィンドウへ切り離す（#290）。
   * 既に開いていればMain側が前面へ出すだけなので、押し直しても二枚目にならない。
   */
  async function detachSelectedNote() {
    if (!selected || selected.recordType !== "note") return;
    // 切り離す前に、この画面の未保存分を確定させる。別ウィンドウが古い本文を読まないようにする。
    const current = captureCurrentDraftSnapshot();
    await flushDraftSnapshot(current);
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
    setDraftBodyForSelected(formatted);
    setDraftState("Markdownを整形しました。");
  }

  function restoreMarkdownDiffMarker(marker: MarkdownDiffMarker) {
    const restored = restoreMarkdownDiffHunk(draftBody, marker.hunk);
    if (restored === draftBody) return;
    setDraftBodyForSelected(restored);
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
    const previous = autosaveRef.current;
    if (previous && (!selectedOwnerKey || noteDraftOwnerKey(previous.snapshot.owner) !== selectedOwnerKey)) {
      if (autosaveTimerRef.current) {
        window.clearTimeout(autosaveTimerRef.current);
        autosaveTimerRef.current = null;
      }
      void flushDraftSnapshot(previous);
    }
    selectedBodyRef.current = selectedOwner
      ? makeNoteDraftSnapshot(selectedOwner, selectedBody, selectedBody, Number(selected?.version || 0))
      : null;
    setDraftOwner(selectedOwner);
    setDraftBodyState(normalizeRichEditorMarkdown(selectedBody));
    setIndexedDraftBody(normalizeRichEditorMarkdown(selectedBody));
    setRichEditorDirty(false);
    setDraftState("");
    setDiffOpen(false);
    setSearchIndex(0);
    setAutoLinked(null);
    setRecentExtraction(null);
  }, [selectedOwnerKey, selectedBody]);

  ctxRef.current = {
    selected,
    snapshot: selectedOwner ? makeNoteDraftSnapshot(selectedOwner, draftBody, selectedBody, Number(selected?.version || 0)) : null,
  };

  // ctxRefはレンダー中に新しい選択で上書きされるため、コミット済みの値を保持する専用refを使う。
  const autosaveRef = useRef<{ selected: Combined; snapshot: NoteDraftSnapshot } | null>(null);
  const autosaveTimerRef = useRef<number | null>(null);
  const draftSaveQueuesRef = useRef(new Map<string, DraftSaveQueue>());
  const saveEntityRef = useRef(saveEntity);
  const setToastRef = useRef(setToast);
  saveEntityRef.current = saveEntity;
  setToastRef.current = setToast;
  useEffect(() => {
    const current = captureCurrentDraftSnapshot();
    autosaveRef.current = current;
    if (autosaveTimerRef.current) window.clearTimeout(autosaveTimerRef.current);
    autosaveTimerRef.current = null;
    if (current?.snapshot.dirty) {
      autosaveTimerRef.current = window.setTimeout(() => {
        autosaveTimerRef.current = null;
        void autoSaveDraft(autosaveRef.current);
      }, 1500);
    }
  }, [selectedOwnerKey, selectedBody, draftBody, draftDirty]);

  // 本体へ戻すときに、対象Noteを選び直す（#290）。
  useEffect(() => {
    const onSelect = (event: Event) => {
      const noteId = (event as CustomEvent<string>).detail;
      if (typeof noteId === "string" && noteId) setSelectedId(noteId);
    };
    window.addEventListener("tasken:select-note", onSelect);
    return () => window.removeEventListener("tasken:select-note", onSelect);
  }, []);

  /**
   * 正本Markdownの状態（#291）。
   * Tasken内部の保存と、OneDrive等にある `.md` の更新は別の事実なので、
   * 「保存しました」の一言に混ぜない。本文を変えた直後はファイルが古いので pending。
   */
  const canonicalFileState: CanonicalMarkdownFileState = (() => {
    const canonicalPath = str(markdownExport?.filePath);
    if (!canonicalPath) return "none";
    // 直近の同期結果があればそれを優先する。外部変更や失敗は署名比較では分からない。
    if (canonicalSyncState && canonicalSyncState !== "synced") return canonicalSyncState;
    if (markdownExport?.syncState) return canonicalMarkdownFileState(str(markdownExport.syncState));
    const written = str(markdownExport?.bodySignature);
    if (!written) return "pending";
    return written === markdownSignature(currentDraftBody() || selectedBody) ? "synced" : "pending";
  })();

  /**
   * 保存状態（#331）。一時messageが無くても「いまどうなっているか」を必ず言う。
   * 保存直後にEditorのonChangeで一時messageが消えても、静止状態を読み取れるようにする。
   */
  const saveStateLabel = draftState
    || (draftDirty
      ? "未保存の変更があります"
      : noteSaveStateLabel({ internalSaved: true, fileState: canonicalFileState }));

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

  async function persistDraftSnapshot(
    request: { selected: Combined; snapshot: NoteDraftSnapshot },
    options: SaveOptions = {},
    entityPatch: Record<string, unknown> = {},
  ): Promise<CanonicalMarkdownFileState> {
    const { selected: previous, snapshot } = request;
    const expectedOwner = noteDraftOwner(previous.recordType, previous.id);
    if (!sameNoteDraftOwner(snapshot.owner, expectedOwner)) return "none";
    const body = snapshot.body;
    if (body === recordBody(previous) && Object.keys(entityPatch).length === 0) return "none";
    // Note は本文必須。Resource は空メモも許す（リンクを見ながらの下書き）。
    if (previous.recordType === "note" && !body.trim()) return "none";
    // Theme選択など別の保存経路が先に完了しても、古いselected行で本文保存が
    // canonical project_idを巻き戻さない。保存直前に同じownerの正本を読み直し、
    // snapshotは本文だけを担う。
    const latest = await workspaceApi.get(previous.recordType, previous.id);
    const current = latest ? { ...previous, ...latest } : previous;
    const { recordType, ...entity } = current;
    const saved = previous.recordType === "note"
      ? await saveEntityRef.current(
        recordType,
        { ...entity, ...entityPatch, body_markdown: body },
        options,
        {
          owner: { recordType: "note", entityId: previous.id },
          body,
          expectedRevision: snapshot.expectedRevision,
        },
      )
      : await saveEntityRef.current(recordType, { ...entity, body_markdown: body }, options);
    const ownerKey = noteDraftOwnerKey(snapshot.owner);
    const queue = draftSaveQueuesRef.current.get(ownerKey);
    const savedRevision = Number(saved.version);
    const nextRevision = Number.isInteger(savedRevision) && savedRevision >= 0
      ? savedRevision
      : snapshot.expectedRevision + 1;
    if (queue) {
      queue.lastSavedBody = body;
      queue.lastSavedRevision = nextRevision;
    }
    const savedBinding = canonicalMarkdownBindingFromProperties(
      saved.properties_json,
      { noteId: saved.id },
    );
    const savedFileState = canonicalMarkdownFileState(savedBinding?.sync_state);
    // 保存対象がまだ表示中のownerならEditorの基準本文も同じsnapshotへ進める。
    const currentDraft = autosaveRef.current;
    const stillEditingSavedSnapshot = Boolean(
      currentDraft
      && sameNoteDraftOwner(currentDraft.snapshot.owner, snapshot.owner)
      && currentDraft.snapshot.body === body,
    );
    if (selectedOwnerKeyRef.current === ownerKey && stillEditingSavedSnapshot) {
      selectedBodyRef.current = snapshot;
      autosaveRef.current = {
        selected: { ...previous, ...saved, recordType: previous.recordType },
        snapshot: makeNoteDraftSnapshot(snapshot.owner, body, body, nextRevision),
      };
      setDraftOwner(snapshot.owner);
      setDraftBodyState(snapshot.body);
      setRichEditorDirty(false);
      setCanonicalSyncState(savedFileState);
    }
    return savedFileState;
  }

  function cancelAutosaveTimer(): void {
    if (!autosaveTimerRef.current) return;
    window.clearTimeout(autosaveTimerRef.current);
    autosaveTimerRef.current = null;
  }

  function sameDraftSaveJob(left: DraftSaveJob, right: DraftSaveJob): boolean {
    return sameNoteDraftOwner(left.request.snapshot.owner, right.request.snapshot.owner)
      && left.request.snapshot.body === right.request.snapshot.body
      && left.request.snapshot.expectedRevision === right.request.snapshot.expectedRevision
      && left.options.canonicalMarkdown === right.options.canonicalMarkdown
      && left.options.reason === right.options.reason
      && left.options.source === right.options.source
      && left.options.quiet === right.options.quiet
      && JSON.stringify(left.entityPatch) === JSON.stringify(right.entityPatch);
  }

  function startDraftSaveQueue(queue: DraftSaveQueue): Promise<CanonicalMarkdownFileState> {
    return startLatestSaveQueue(queue, {
      prepare: (pending) => {
        if (
          queue.lastSavedRevision !== null
          && pending.request.snapshot.expectedRevision < queue.lastSavedRevision
        ) {
          return {
            ...pending,
            request: {
              ...pending.request,
              snapshot: {
                ...pending.request.snapshot,
                expectedRevision: queue.lastSavedRevision,
              },
            },
          };
        }
        return pending;
      },
      save: (job) => persistDraftSnapshot(job.request, job.options, job.entityPatch),
      onStart: trackPendingNoteDraftSave,
    });
  }

  function enqueueDraftSave(
    request: { selected: Combined; snapshot: NoteDraftSnapshot },
    options: SaveOptions = {},
    entityPatch: Record<string, unknown> = {},
  ): Promise<CanonicalMarkdownFileState> {
    const ownerKey = noteDraftOwnerKey(request.snapshot.owner);
    let queue = draftSaveQueuesRef.current.get(ownerKey);
    if (!queue) {
      queue = {
        current: null,
        latest: null,
        inFlight: null,
        lastSavedBody: null,
        lastSavedRevision: null,
      };
      draftSaveQueuesRef.current.set(ownerKey, queue);
    }
    const job = { request, options, entityPatch };
    if (queue.current && sameDraftSaveJob(queue.current, job)) return queue.inFlight || startDraftSaveQueue(queue);
    if (queue.latest && sameDraftSaveJob(queue.latest, job)) return queue.inFlight || startDraftSaveQueue(queue);
    // 同じownerでは最新snapshotだけを残す。古いsnapshotを順番待ちにすると、
    // 前の保存がversionを進めた後に同じexpectedRevisionで自分自身をstaleにする。
    queue.latest = job;
    return queue.inFlight || startDraftSaveQueue(queue);
  }

  async function saveQueuedDraft(
    request: { selected: Combined; snapshot: NoteDraftSnapshot },
    options: SaveOptions = {},
    entityPatch: Record<string, unknown> = {},
  ): Promise<DraftSaveResult> {
    try {
      return { ok: true, fileState: await enqueueDraftSave(request, options, entityPatch) };
    } catch (error: unknown) {
      setToastRef.current(`自動保存に失敗しました。${error instanceof Error ? error.message : String(error)}`);
      return { ok: false, fileState: "none" };
    }
  }

  async function autoSaveDraft(snapshot = autosaveRef.current): Promise<boolean> {
    if (!snapshot) return true;
    return (await saveQueuedDraft(snapshot)).ok;
  }

  async function flushDraftSnapshot(
    snapshot: { selected: Combined; snapshot: NoteDraftSnapshot } | null,
    options: SaveOptions = {},
  ): Promise<DraftSaveResult> {
    cancelAutosaveTimer();
    if (!snapshot?.snapshot.dirty) return { ok: true, fileState: "none" };
    const ownerKey = noteDraftOwnerKey(snapshot.snapshot.owner);
    const first = await saveQueuedDraft(snapshot, options);
    if (!first.ok) return first;

    // 保存中に入力された最新版があれば、in-flight完了後に同じownerで一度だけ続けて保存する。
    const latest = autosaveRef.current;
    const queue = draftSaveQueuesRef.current.get(ownerKey);
    if (
      latest?.snapshot.dirty
      && sameNoteDraftOwner(latest.snapshot.owner, snapshot.snapshot.owner)
      && latest.snapshot.body !== queue?.lastSavedBody
    ) {
      return saveQueuedDraft(latest, options);
    }
    return first;
  }

  async function flushCurrentNoteAndReadLatest(target: Combined): Promise<Combined> {
    cancelAutosaveTimer();
    const targetOwner = noteDraftOwner("note", target.id);
    const current = captureCurrentDraftSnapshot();
    if (current && sameNoteDraftOwner(current.snapshot.owner, targetOwner)) {
      const flushed = await flushDraftSnapshot(current);
      if (!flushed.ok) throw new Error("本文を先に保存できませんでした。入力を保持したまま再試行してください。");
    }

    let latest = await workspaceApi.get("note", target.id);
    if (!latest) throw new Error("対象Noteが見つかりません。");
    let latestNote: Combined = { ...target, ...latest, recordType: "note" };

    // 初回flush中に入力された最新版がある場合は、metadata-only更新が古い本文を
    // patchしないよう、同じowner queueでその最新版まで確定してから再読込する。
    const pending = autosaveRef.current;
    if (
      pending?.snapshot.dirty
      && sameNoteDraftOwner(pending.snapshot.owner, targetOwner)
      && pending.snapshot.body !== recordBody(latestNote)
    ) {
      const flushed = await flushDraftSnapshot(pending);
      if (!flushed.ok) throw new Error("本文を先に保存できませんでした。入力を保持したまま再試行してください。");
      latest = await workspaceApi.get("note", target.id);
      if (!latest) throw new Error("対象Noteが見つかりません。");
      latestNote = { ...target, ...latest, recordType: "note" };
    }
    return latestNote;
  }

  async function saveCurrentNoteMetadata(
    target: Combined,
    buildPatch: (latest: Combined) => Record<string, unknown>,
    options: SaveOptions = {},
  ): Promise<CanonicalMarkdownFileState> {
    if (target.recordType !== "note") return "none";
    const latest = await flushCurrentNoteAndReadLatest(target);
    const body = recordBody(latest);
    const owner = noteDraftOwner("note", latest.id);
    const snapshot = makeNoteDraftSnapshot(owner, body, body, Number(latest.version || 0));
    const result = await saveQueuedDraft(
      { selected: latest, snapshot },
      options,
      buildPatch(latest),
    );
    if (!result.ok) throw new Error("Noteの設定を保存できませんでした。入力を保持したまま再試行してください。");
    return result.fileState;
  }

  useEffect(() => () => {
    cancelAutosaveTimer();
    const pending = autosaveRef.current;
    if (pending?.snapshot.dirty) void saveQueuedDraft(pending);
  }, []);

  useEffect(() => {
    const onAppFlushRequested = (event: Event) => {
      const detail = (event as CustomEvent<{
        handled: boolean;
        flush: Promise<boolean> | null;
      }>).detail;
      if (!detail || detail.handled) return;
      detail.handled = true;
      detail.flush = flushDraftSnapshot(captureCurrentDraftSnapshot()).then((result) => result.ok);
    };
    window.addEventListener("tasken:app-flush-requested", onAppFlushRequested);
    return () => window.removeEventListener("tasken:app-flush-requested", onAppFlushRequested);
  }, [detachedNoteId, draftBody, draftDirty, selectedBody, selectedOwnerKey, saveEntity]);

  useEffect(() => {
    if (!detachedNoteId) return undefined;
    return workspaceApi.onNoteWindowFlushRequested((request) => {
      const pageFlush = flushDraftSnapshot(captureCurrentDraftSnapshot()).then((result) => result.ok);
      void Promise.all([pageFlush, flushPendingNoteDraftSaves()])
        .then(([pageOk, pendingOk]) => workspaceApi.ackNoteWindowFlush(request.requestId, pageOk && pendingOk))
        .catch(() => workspaceApi.ackNoteWindowFlush(request.requestId, false));
    });
  }, [detachedNoteId, draftBody, draftDirty, selectedBody, selectedOwnerKey, saveEntity]);

  // Noteを切り替えたら、前のNoteの同期結果を持ち越さない（#291）。
  useEffect(() => {
    setCanonicalSyncState(null);
  }, [selected?.id]);

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "f") {
        event.preventDefault();
        setDraftBodyForSelected(currentDraftBodyForSelected());
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
        cancelAutosaveTimer();
        const request = captureCurrentDraftSnapshot();
        const s = request?.selected;
        const body = request?.snapshot.body || "";
        if (request?.snapshot.dirty && s) {
          if (s.recordType === "note" && !body.trim()) {
            setDraftState("本文を空にしたままでは保存できません。内容を入力してください。");
            return;
          }
          setDraftState("保存しています。");
          const overwrite = canonicalFileState === "external_change" && window.confirm(
            "Markdownが外部で変更されています。Taskenの本文で上書きしますか。",
          );
          flushDraftSnapshot(request, overwrite ? { canonicalMarkdown: "overwrite" } : {})
            .then((result) => {
              if (!result.ok) {
                setDraftState("保存できませんでした。入力は保持しています。再試行してください。");
                return;
              }
              setDraftState(noteSaveStateLabel({ internalSaved: true, fileState: result.fileState }));
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
        project_id: canonicalThemeId(activeTheme?.id, { defaultPersonal: true }),
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
        project_id: canonicalThemeId(activeTheme?.id, { defaultPersonal: true }),
        note_type: noteType,
        content_format: "markdown",
        title: noteType === "report" ? "Report" : "",
        body_markdown: "",
        ...(noteType === "report" ? { properties_json: { report_type: "weekly" } } : {}),
      },
    });
  }

  /**
   * 選択範囲の変換はCommand Palette等からの明示commandで呼ぶ（#313）。
   * 選択しただけでtoolbarを出すと、通常のコピー・IME操作を妨げる。
   */
  function requestSelectionCommand(kind: SelectionCommandRequest["kind"]) {
    if (previewMode !== "edit") {
      setToast("Editで本文の範囲を選んでから実行してください。", "warning");
      return;
    }
    setSelectionCommand((current) => ({ kind, nonce: (current?.nonce ?? 0) + 1 }));
  }

  /** 追加の既定種別（#313）。種別filter中はその種類、`すべて`ではNote。 */
  const createDefaultKind: NotesKind = scope === "all" ? "note" : scope;

  function createRecord(kind: NotesKind) {
    if (kind === "resource") {
      openDrawer({ type: "resource", mode: "edit", entity: { project_id: canonicalThemeId(activeTheme?.id, { defaultPersonal: true }) } });
      return;
    }
    if (kind === "prompt") {
      addPrompt();
      return;
    }
    addNote(kind);
  }

  async function copySelectedRaw() {
    if (!selected) return;
    await workspaceApi.copyText(currentDraftBody());
    setToast("本文をコピーしました。");
  }

  function openRecord(record: Combined) {
    // 一覧クリックは右ペイン選択 + 編集ドロワー（メタ・タイトル・種別の編集）。
    if (isWorkbenchRecord(record)) {
      if (record.id !== selected?.id) setAiTarget(null);
      switchDocument(record);
    }
    openDrawer({ type: record.recordType, mode: "edit", entity: record });
  }

  function showRecordMenu(event: MouseEvent, record: Combined, url: string) {
    event.preventDefault();
    const items: ContextMenuItem[] = [
      { label: "編集する", onSelect: () => openRecord(record) },
      { label: "本文を開く", onSelect: () => {
        if (isWorkbenchRecord(record)) {
          switchDocument(record);
        }
      } },
      { label: "タイトルをコピー", onSelect: () => workspaceApi.copyText(str(record.title)) },
    ];
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
      const latest = currentDraftBodyForSelected();
      if (latest !== draftBody) setDraftBodyForSelected(latest);
    }
    const scrollState = captureModeScroll(previewMode);
    setPreviewMode(nextMode);
    restoreModeScroll(nextMode, scrollState);
  }

  function currentDraftBody(): string {
    return previewMode === "edit" ? currentDraftBodyForSelected() : effectiveBody;
  }

  function insertDraftMarkdown(markdown: string, selectionStart: number, selectionEnd: number) {
    setDraftBodyForSelected((current) => `${current.slice(0, selectionStart)}${markdown}${current.slice(selectionEnd)}`);
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

  const updateRichEditorDraft = useCallback((ownerKey: string, value: string) => {
    if (selectedOwnerKeyRef.current !== ownerKey) return;
    // Lexicalの入力・IME描画を先に確定し、全文由来のNotes表示更新は低優先度で追従させる。
    startTransition(() => {
      setDraftOwner(selectedOwnerRef.current);
      setDraftBodyState(value);
      setRichEditorDirty(value !== selectedBodyRef.current?.body);
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
    const request = captureCurrentDraftSnapshot();
    const body = request?.snapshot.body || "";
    if (!request || !request.snapshot.dirty) return;
    const { selected: current } = request;
    if (current.recordType === "note" && !body.trim()) {
      setDraftState("本文を空にしたままでは保存できません。内容を入力してください。");
      return;
    }
    setDraftState("保存しています。");
    try {
      const overwrite = canonicalFileState === "external_change" && window.confirm(
        "Markdownが外部で変更されています。Taskenの本文で上書きしますか。",
      );
      const result = await flushDraftSnapshot(request, overwrite ? { canonicalMarkdown: "overwrite" } : {});
      if (!result.ok) {
        setDraftState("保存できませんでした。入力は保持しています。再試行してください。");
        return;
      }
      setDraftState(noteSaveStateLabel({ internalSaved: true, fileState: result.fileState }));
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
    const lines = ctxRef.current.snapshot?.body.split(/\r?\n/) || [];
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
      const target = selected;
      const nextEnabled = patch.heading_numbers ?? headingNumbersEnabled;
      const nextLevels = patch.heading_number_levels ?? headingNumberLevels;
      await saveCurrentNoteMetadata(target, (latest) => ({
        properties_json: {
          ...noteProperties(latest),
          heading_numbers: nextEnabled,
          heading_number_levels: nextLevels,
          // 旧版が読めるよう開始階層も併記する。表示の正本はlevels。
          heading_number_start: nextLevels[0] ?? headingNumberStart,
        },
      }));
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
    return buildCanonicalMarkdownContent({
      title: str(note.title),
      themeName,
      updatedAt: str(note.updated_at || note.created_at),
      body: bodyMarkdown,
    });
  }

  /**
   * 出力先ChatRefが確定済みなら、書き出したArtifactを確認なしで同じ参照へ追加する（#288）。
   * 追加に失敗しても書き出したファイルと文書は触らず、通常の紐づけ導線へ戻す。
   */
  async function autoLinkExportArtifacts(exported: NoteDocumentExport, purpose: "canonical" | "copy" | "derived" = "derived") {
    // canonical保存は同じ正本ファイルを更新するだけなのでArtifactを増やさない（#291）。
    // 明示的なMarkdownコピーと派生出力（PDF・SVG等）は別ファイルとして扱う。
    if (!shouldCreateExportArtifact(exported.format, purpose)) {
      setRecentExport(exported);
      return;
    }
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
    const target = selected;
    try {
      await saveCurrentNoteMetadata(target, (latest) => {
        const next = [...new Set([...noteArtifactExportTargetIds(latest), chatRefId])];
        return { properties_json: withNoteArtifactExportTargets(noteProperties(latest), next) };
      }, { quiet: true });
    } catch (error) {
      setToast(`Markdown出力先の記憶に失敗しました。${error instanceof Error ? error.message : String(error)}`, "danger");
    }
  }

  async function clearExportTargets() {
    if (!selected) return;
    const target = selected;
    try {
      await saveCurrentNoteMetadata(target, (latest) => ({
        properties_json: withNoteArtifactExportTargets(noteProperties(latest), []),
      }), { quiet: true });
      setToast("自動追加先を解除しました。次回の書き出しでは紐づけ先を選び直します。", "success");
    } catch (error) {
      setToast(`自動追加先を解除できませんでした。${error instanceof Error ? error.message : String(error)}`, "danger");
    }
  }

  async function exportSelectedMarkdown(changeCanonicalPath: boolean) {
    if (!selected || !showDocumentPublish) return;
    setMarkdownExporting(true);
    try {
      // Exportも現在のEditor本文を先にowner queueへ通す。古いselectedをそのまま
      // 履歴保存へ渡して、copyだけ新本文になるpartial saveを作らない。
      const current = captureCurrentDraftSnapshot();
      const flushed = await flushDraftSnapshot(current);
      if (!flushed.ok) {
        setToast("Markdownを作成できませんでした。入力は保持しています。保存を再試行してください。", "danger");
        return;
      }
      const persisted = await workspaceApi.get("note", selected.id);
      const exportNote: Combined = { ...selected, ...(persisted || {}), recordType: "note" as const };
      const bodyForExport = str(exportNote.body_markdown);
      const exportThemeId = str(exportNote.project_id || exportNote.theme_id);
      const exportThemeName = themes.find((theme) => theme.id === exportThemeId)?.name || "";
      const content = publishMarkdownContent(exportNote, exportThemeName, bodyForExport);
      const result = await workspaceApi.exportMarkdownFile({
        title: str(exportNote.title),
        content,
        directory: changeCanonicalPath ? str(markdownExport?.directory) || null : null,
        chooseDirectory: true,
        fileName: `${str(exportNote.title) || "markdown-document"}.md`,
        themeId: exportThemeId || null,
      });
      if (result.canceled) {
        setToast("Markdown出力をキャンセルしました。", "info");
        return;
      }
      const exported = createNoteDocumentExport(exportNote, {
        format: "markdown",
        filePath: str(result.filePath),
        directory: str(result.directory),
        exportedAt: str(result.exportedAt) || new Date().toISOString(),
        storageMode: "linked",
      });
      if (changeCanonicalPath) {
        await saveCurrentNoteMetadata(exportNote, (latest) => {
          const latestBody = recordBody(latest);
          const latestThemeId = str(latest.project_id || latest.theme_id);
          const latestThemeName = themes.find((theme) => theme.id === latestThemeId)?.name || "";
          const latestContent = publishMarkdownContent(latest, latestThemeName, latestBody);
          const exportBinding = canonicalMarkdownBindingFromProperties(latest.properties_json, { noteId: latest.id });
          const nextBinding = {
            ...(exportBinding || {}),
            binding_id: exportBinding?.binding_id || `note:${latest.id}`,
            canonical_path: str(result.filePath),
            directory: str(result.directory),
            file_name: str(result.filePath).split(/[\\/]/).pop() || "",
            body_signature: markdownSignature(latestBody),
            file_signature: markdownSignature(latestContent),
            sync_state: "in_sync",
            last_synced_at: str(result.exportedAt) || new Date().toISOString(),
            last_error: "",
          };
          return { properties_json: withCanonicalMarkdownBinding(noteProperties(latest), nextBinding) };
        }, { canonicalMarkdown: "overwrite" });
        setToast(`Markdownの保存先を変更しました。${result.filePath || ""}`, "success");
        setCanonicalSyncState("synced");
        setDraftState(noteSaveStateLabel({ internalSaved: true, fileState: "synced" }));
      } else {
        // MarkdownコピーはNote本体を再保存しない。直前flushでDB/canonicalと本文を揃え、
        // Recent exportと明示Artifactだけを更新するので、古いselected/versionをcanonicalへ戻さない。
        setRecentExport(exported);
        setToast(`Markdownコピーを作成しました。${result.filePath || ""}`, "success");
        await autoLinkExportArtifacts(exported, "copy");
      }
    } catch (error) {
      // Tasken内部は保存済みでもファイルだけ失敗しうる。片方だけの失敗を区別して示す。
      setCanonicalSyncState("failed");
      setDraftState(noteSaveStateLabel({ internalSaved: true, fileState: "failed" }));
      setToast(`Markdownを更新できませんでした。${error instanceof Error ? error.message : String(error)}`, "danger");
    } finally {
      setMarkdownExporting(false);
    }
  }

  async function exportMermaidForPowerPoint(request: { action: MermaidPowerPointAction; blockId: string; source: string }): Promise<void> {
    const title = `${str(selected?.title) || "Mermaid"}-${request.blockId}`;
    try {
      const svg = await renderMermaidSvgForOffice(request.source);
      if (request.action === "copy-svg") {
        const result = await workspaceApi.copySvg({ svg });
        if (result.verified) {
          setToast("PowerPoint編集用SVGをクリップボードへコピーしました。貼り付け結果はPowerPointのversionに依存します。", "success");
        } else {
          setToast("WindowsのSVGクリップボード形式を確認できませんでした。SVGを書き出すか、編集可能なPowerPointを作成してください。", "warning");
        }
        return;
      }
      if (request.action === "export-svg") {
        const result = await workspaceApi.exportMermaidSvg({ title, svg });
        setToast(result.canceled ? "Mermaid SVG出力をキャンセルしました。" : `PowerPoint用SVGを保存しました。${result.filePath || ""}`, result.canceled ? "info" : "success");
        return;
      }
      const capability = mermaidPowerPointCapabilities(request.source);
      if (!capability.nativePptx) {
        setToast(capability.reason || "ネイティブPPTXの対象外です。SVGを書き出してください。", "warning");
        return;
      }
      const diagram = extractMermaidPptxDiagram(svg, request.source);
      const result = await workspaceApi.exportMermaidPptx({ title, diagram });
      if (result.canceled) {
        setToast("編集可能なPowerPoint出力をキャンセルしました。", "info");
        return;
      }
      const warningText = result.warnings.length
        ? `（注意: ${result.warnings[0]}${result.warnings.length > 1 ? ` 他${result.warnings.length - 1}件` : ""}）`
        : "";
      setToast(`編集可能なPowerPointを保存しました。${result.filePath || ""}${warningText}`, result.warnings.length ? "warning" : "success");
    } catch (error) {
      setToast(`MermaidのPowerPoint出力に失敗しました。${error instanceof Error ? error.message : String(error)}`, "danger");
    }
  }

  async function exportSelectedPdf() {
    if (!selected || !showDocumentPublish) return;
    setPdfExporting(true);
    try {
      const exportNote = await flushCurrentNoteAndReadLatest(selected);
      const exportThemeId = str(exportNote.project_id || exportNote.theme_id);
      const exportThemeName = themes.find((theme) => theme.id === exportThemeId)?.name || "";
      const content = publishMarkdownContent(exportNote, exportThemeName, recordBody(exportNote));
      const result = await workspaceApi.exportMarkdownPdf({
        title: str(exportNote.title),
        html: await renderMermaidDocumentForPdf(previewDocument(content, "markdown", publishRenderOptions)),
        chooseDirectory: true,
        fileName: `${str(exportNote.title) || "markdown-document"}.pdf`,
        themeId: exportThemeId || null,
      });
      if (result.canceled) {
        setToast("PDF出力をキャンセルしました。", "info");
        return;
      }
      const exported = createNoteDocumentExport(exportNote, {
        format: "pdf",
        filePath: str(result.filePath),
        directory: str(result.directory),
        exportedAt: str(result.exportedAt) || new Date().toISOString(),
        storageMode: "linked",
      });
      await saveCurrentNoteMetadata(exportNote, (latest) => ({
        properties_json: withNoteDocumentExport(noteProperties(latest), exported),
      }), { quiet: true });
      const warningText = result.warnings?.length ? `（注意: ${result.warnings[0]}${result.warnings.length > 1 ? ` 他${result.warnings.length - 1}件` : ""}）` : "";
      setToast(`PDFを出力しました。${result.filePath || ""}${warningText}`, result.warnings?.length ? "warning" : "success");
      await autoLinkExportArtifacts(exported);
    } catch (error) {
      setToast(`PDF出力に失敗しました。${error instanceof Error ? error.message : String(error)}`, "danger");
    } finally {
      setPdfExporting(false);
    }
  }

  function handleNoteAiApplied(saved: BaseRecord, body: string) {
    if (saved.id !== selected?.id) setAiTarget(null);
    setSelectedId(saved.id);
    const owner = noteDraftOwner("note", saved.id);
    setDraftOwner(owner);
    setDraftBodyState(body);
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
      : setToast("先にNoteを保存して正本Markdownの保存先を決めてください。", "warning"),
    draft: () => selected?.recordType === "note"
      ? openNoteAi()
      : setToast("Note AIで扱うNoteを選択してください。", "warning"),
    // 選択範囲の変換（#313）。自動toolbarを撤去したので、ここが正規の入口。
    "selection-task": () => requestSelectionCommand("task"),
    "selection-note": () => requestSelectionCommand("note"),
    "selection-ai": () => requestSelectionCommand("ai"),
  };

  /**
   * 派生出力（#331）。Note正本の`保存`と語彙を分け、出力先を選ぶ操作と混同させない。
   */
  const headingNumberMenuItems: ToolbarMenuItem[] = showDocumentPublish ? [
    {
      kind: "toggle",
      id: "heading-numbers",
      label: "Edit・Preview・PDFに通し番号を付ける",
      hint: "本文は書き換えません。Markdownファイル出力には含めません。",
      checked: headingNumbersEnabled,
      onToggle: (checked) => updateHeadingNumberSettings({ heading_numbers: checked }),
    },
    ...(headingNumbersEnabled ? HEADING_NUMBER_LEVELS.map((level): ToolbarMenuItem => ({
      kind: "toggle",
      id: `heading-level-${level}`,
      label: HEADING_NUMBER_LEVEL_LABELS[level],
      checked: headingNumberLevels.includes(level),
      onToggle: (checked) => updateHeadingNumberSettings({
        heading_number_levels: normalizeHeadingNumberLevels(
          checked
            ? [...headingNumberLevels, level]
            : headingNumberLevels.filter((current) => current !== level),
        ),
      }),
    })) : []),
  ] : [];

  const outputMenuItems: ToolbarMenuItem[] = showDocumentPublish ? [
    { kind: "group", id: "group-export", label: "書き出し" },
    {
      id: "export-markdown",
      label: markdownExporting ? "Markdownコピーを作成しています" : "Markdownコピーを作成",
      hint: "正本Markdownとは別のファイルを作成します。",
      disabled: markdownExporting,
      onSelect: () => void exportSelectedMarkdown(false),
    },
    {
      id: "export-pdf",
      label: pdfExporting ? "PDFを作成しています" : "PDFを作成",
      disabled: pdfExporting,
      onSelect: () => void exportSelectedPdf(),
    },
    { kind: "group", id: "group-destination", label: "保存先" },
    ...(markdownExportOpenPath ? [{
      id: "open-destination",
      label: "保存先フォルダを開く",
      hint: markdownExportDirectory || markdownExportFilePath,
      onSelect: () => void openMarkdownExportDirectory(markdownExportDirectory || markdownExportFilePath),
    } as ToolbarMenuItem] : []),
    ...(hasMarkdownExportDirectory ? [{
      id: "change-destination",
      label: "保存先を変更",
      disabled: markdownExporting,
      onSelect: () => void exportSelectedMarkdown(true),
    } as ToolbarMenuItem] : []),
  ] : [
    {
      id: "export-unavailable",
      label: "この種別では書き出しできません",
      disabled: true,
      onSelect: () => {},
    },
  ];

  /**
   * この文書に対する低頻度操作（#331）。
   * 同格buttonとして並べず、意味の分かる一つのlabelの下へ畳む。
   */
  const documentMenuItems: ToolbarMenuItem[] = selected ? [
    { kind: "group", id: "group-editor", label: "本文" },
    { id: "format", label: "整形する", hint: "行末空白と過剰な空行を整えます", onSelect: () => formatSelectedDraft() },
    {
      id: "insert-sketch",
      label: "Sketchを挿入",
      hint: sketches.length ? "カーソル位置に既存Sketchを挿入します" : "先にSketchを作成してください",
      disabled: previewMode !== "edit" || !sketches.length,
      onSelect: () => showSketchPicker(),
    },
    { id: "copy-body", label: "本文をすべてコピー", onSelect: () => void copySelectedRaw() },
    ...(!detachedNoteId && selected.recordType === "note" ? [{
      kind: "group" as const, id: "group-window", label: "ウィンドウ",
    }, {
      id: "detach",
      label: openNoteWindowIds.includes(selected.id) ? "別ウィンドウを前面に出す" : "別ウィンドウで開く",
      hint: "本文を別ウィンドウへ切り離し、本体では別の画面へ移動できます",
      onSelect: () => void detachSelectedNote(),
    } as ToolbarMenuItem] : []),
    { kind: "group", id: "group-ai", label: "AI" },
    ...(selected.recordType === "note" ? [{
      id: "ai-edit",
      label: "Note AIを開く",
      onSelect: () => openNoteAi(),
    } as ToolbarMenuItem] : []),
  ] : [];

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
            <Button variant="secondary" onClick={() => void workspaceApi.openNoteWindowInMain("notes")}>Taskenを表示</Button>
            <Button variant="primary" onClick={() => void workspaceApi.returnNoteWindowToMain()}>本体へ戻す</Button>
          </>
        ) : (
          <>
            <Button variant="secondary" onClick={copy}>一覧をコピー</Button>
            {/* 作成は一つのprimary actionへ集約する。既定の種類は現在のfilterから決める（#313）。 */}
            <NoteCreateMenu defaultKind={createDefaultKind} onCreate={createRecord} />
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
        <ThemePickerSelect
          themes={themes}
          value={themeId}
          onChange={(next) => updatePrefs({ themeId: next })}
          allowAll
          allowNone
          allLabel="Theme: すべて"
          ariaLabel="Themeで絞り込み"
        />
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
        className={`notes-workbench${listCollapsed || documentFocus || detachedNoteId ? " is-list-collapsed" : ""}${aiTarget ? " has-note-ai-drawer" : ""}`}
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
                  <Button variant="secondary" compact onClick={() => void detachSelectedNote()}>別ウィンドウを表示</Button>
                </div>
              )}
              <div className="note-preview-header">
                <div>
                  <h2>{str(selected.title) || (selectedKind === "resource" ? selectedUrl || "無題のResource" : "無題")}</h2>
                  {(selected.created_at || selected.updated_at || draftState) && (
                    <div className="note-date-meta">
                      {selected.created_at && <span>追加 {noteDateLabel(selected.created_at)}</span>}
                      {selected.updated_at && <span>更新 {noteDateLabel(selected.updated_at)}</span>}
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
                {/*
                  文書レベルの操作（#331）。この段は「この文書を確定する」ことだけを扱う。
                  Editor操作は下のtoolbarへ、低頻度・派生出力はmenuへ置く。
                */}
                <div className="note-preview-actions">
                  {/* 保存状態は保存操作の隣に置く。自動保存と手動保存の関係を読み取れるようにする（#331）。 */}
                  <span className="note-draft-state" role="status" aria-live="polite">{saveStateLabel}</span>
                  <Button variant="secondary" compact disabled={!draftDirty} onClick={() => {
                    setDraftBodyForSelected(selectedBody);
                    setRichEditorDirty(false);
                    setDraftState("変更を戻しました。");
                  }}>戻す</Button>
                  <ActionButton action="notesSave" compact disabled={!draftDirty} onClick={saveSelectedDraft} />
                  <ToolbarMenu label="この文書" title="この文書に対する操作" items={documentMenuItems} />
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
                  {/* Editorの高頻度操作。本体と別ウィンドウで同じ位置・順序にする（#331）。 */}
                  <Button
                    variant="secondary"
                    compact
                    className="icon-only"
                    onClick={() => {
                      setDraftBodyForSelected(currentDraftBodyForSelected());
                      setSearchOpen(true);
                      window.requestAnimationFrame(() => searchInputRef.current?.focus());
                    }}
                    aria-label="本文を検索・置換"
                    title="本文を検索・置換（Ctrl+F）"
                  >
                    <IconSearch size={15} stroke={1.8} aria-hidden="true" />
                  </Button>
                  <Button
                    variant="secondary"
                    compact
                    className={diffOpen ? "is-active" : ""}
                    disabled={!draftDirty}
                    aria-pressed={diffOpen}
                    onClick={() => {
                      if (!diffOpen) {
                        setDraftBodyForSelected(currentDraftBodyForSelected());
                      }
                      setDiffOpen((current) => !current);
                    }}
                  >
                    {markdownDiffHunks.length ? `変更 ${markdownDiffHunks.length}か所` : "変更を確認"}
                  </Button>
                  {/* 派生出力は正本保存と語彙を分ける（#331）。`保存`とは呼ばない。 */}
                  {showDocumentPublish && (
                    <ToolbarMenu label="見出し番号" title="見出し番号の設定" items={headingNumberMenuItems} />
                  )}
                  <ToolbarMenu label="出力" title="書き出しと保存先" items={outputMenuItems} />
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
                  <Button
                    type="button"
                    variant="secondary"
                    compact
                    onClick={() => setExportLinkDialogOpen(true)}
                  >
                    Chat Refへ紐づける
                  </Button>
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
                  <Button
                    type="button"
                    variant="secondary"
                    compact
                    onClick={() => openDrawer({
                      type: "resource",
                      mode: "edit",
                      entity: autoLinked.chatRefs[0] as unknown as Record<string, unknown>,
                    })}
                  >
                    Chat Refを開く
                  </Button>
                  <Button type="button" variant="secondary" compact onClick={undoAutoLink}>取り消す</Button>
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
                    <Button type="button" variant="secondary" compact disabled={!searchMatches.length} onClick={() => moveSearchMatch(-1)}>前へ</Button>
                    <Button type="button" variant="secondary" compact disabled={!searchMatches.length} onClick={() => moveSearchMatch(1)}>次へ</Button>
                    <Button
                      type="button"
                      variant="secondary"
                      compact
                      aria-expanded={replaceOpen}
                      onClick={() => (replaceOpen ? setReplaceOpen(false) : openMarkdownReplace())}
                    >
                      置換
                    </Button>
                    <Button type="button" variant="secondary" compact onClick={closeMarkdownSearch}>閉じる</Button>
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
                      <Button type="button" variant="secondary" compact disabled={!replaceEnabled} onClick={replaceCurrentMatch}>置換</Button>
                      <Button type="button" variant="secondary" compact disabled={!replaceEnabled} onClick={replaceAllMatches}>すべて置換</Button>
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
                      setDraftBodyForSelected(event.target.value);
                      if (draftState) setDraftState("");
                    }}
                    aria-label="脚注を含むMarkdown本文"
                  />
                ) : (
                  <MarkdownEditorBoundary
                    key={selected.id}
                    markdown={draftBody}
                    resetKey={selected.id}
                    onChange={(value) => updateRichEditorDraft(selectedOwnerKey || "", value)}
                    onPaste={handleDraftPaste}
                    onError={reportRichEditorError}
                  >
                    <Suspense fallback={<div className="note-editor-loading" role="status">エディタを読み込んでいます…</div>}>
                      <MarkdownRichEditor
                        ownerKey={selectedOwnerKey || ""}
                        markdown={draftBody}
                        headingNumberOptions={previewRenderOptions}
                        markdownSourceRef={mdxMarkdownSourceRef}
                        markdownInsertRef={mdxMarkdownInsertRef}
                        onChange={(value) => updateRichEditorDraft(selectedOwnerKey || "", value)}
                        onDirty={markRichEditorDirty}
                        onImageUpload={uploadEditorImage}
                        onImagePreview={previewSketchImage}
                        onError={reportRichEditorError}
                        onExtractSelection={selected.recordType === "note" ? extractSelection : undefined}
                        onAiEditSelection={selected.recordType === "note" ? openSelectionAi : undefined}
                        onCaretAnchorChange={(anchor) => { richAiAnchorRef.current = anchor; }}
                        selectionCommand={selectionCommand}
                        onSelectionUnavailable={() => setToast("先に本文の範囲を選択してください。", "warning")}
                      />
                    </Suspense>
                  </MarkdownEditorBoundary>
                ) : previewMode === "preview" ? (
                  <MarkdownPreview className="note-main-preview markdown-preview"
                    html={previewHtml(draftBody, "markdown", previewRenderOptions)}
                    onClick={openEmbeddedSketch}
                    onMermaidAction={exportMermaidForPowerPoint}
                  />
                ) : (
                  <textarea
                    ref={textareaRef}
                    className="note-main-editor note-main-editor-raw"
                    value={draftBody}
                    onPaste={handleDraftPaste}
                    onChange={(event) => {
                      setDraftBodyForSelected(event.target.value);
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
        {selected && selected.recordType === "note" && aiTarget && (
          <NoteAiDrawer
            note={selected}
            body={currentDraftBodyForSelected()}
            target={aiTarget}
            proposals={data.ai_proposals || []}
            theme={themes.find((entry) => entry.id === str(selected.project_id || selected.theme_id)) || null}
            resources={(data.resources || []).filter((entry) => !str(selected.project_id || selected.theme_id) || str(entry.project_id || entry.theme_id) === str(selected.project_id || selected.theme_id))}
            saveEntity={saveEntity}
            saveEntities={saveEntities}
            setToast={setToast}
            onApplied={handleNoteAiApplied}
            onClose={() => setAiTarget(null)}
            onOpenSettings={() => navigate("settings")}
          />
        )}
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
              <Button variant="secondary" type="button" onClick={() => setSketchPickerOpen(false)}>取消</Button>
              <Button variant="primary" type="button" onClick={insertSelectedSketch}>カーソル位置へ挿入</Button>
            </div>
          </section>
        </div>
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
