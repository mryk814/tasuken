import {
  IconArrowBackUp,
  IconArrowForwardUp,
  IconArrowUpRight,
  IconChevronDown,
  IconDots,
  IconEraser,
  IconGridDots,
  IconHighlight,
  IconLasso,
  IconMaximize,
  IconNotes,
  IconPhoto,
  IconPointer,
  IconPlus,
  IconShape,
  IconSparkles,
  IconTextSize,
  IconTrash,
  IconWriting,
  IconZoomIn,
  IconZoomOut,
} from "@tabler/icons-react";
import { useEffect, useMemo, useRef, useState } from "react";

import { workspaceApi } from "../../../services/workspaceApi";
import { SketchCanvas } from "../components/SketchCanvas";
import {
  cloneSketchDocument,
  createSketchDraft,
  createSketchPage,
  drawSketchPage,
  renderSketchPageToDataUrl,
  sketchAiPrompt,
  sketchPageToSvg,
  type SketchDocument,
  type SketchObject,
  type SketchPage,
  type SketchTool,
} from "../lib/sketch";
import type { BaseRecord, PageProps, Sketch } from "../types";

const ACTIVE_SKETCH_KEY = "tasken:sketch:active-id";
const SKETCH_COLORS = ["#211e1d", "#2f6fa6", "#3f7a4f", "#8a2f3b", "#c47a18"];
const TOOL_ITEMS: Array<{ id: SketchTool; label: string; icon: typeof IconPointer }> = [
  { id: "select", label: "選択", icon: IconPointer },
  { id: "lasso", label: "投げ縄", icon: IconLasso },
  { id: "pen", label: "ペン", icon: IconWriting },
  { id: "highlighter", label: "蛍光ペン", icon: IconHighlight },
  { id: "eraser", label: "消しゴム", icon: IconEraser },
  { id: "shape", label: "図形", icon: IconShape },
  { id: "arrow", label: "矢印", icon: IconArrowUpRight },
  { id: "text", label: "テキスト", icon: IconTextSize },
  { id: "image", label: "画像", icon: IconPhoto },
];

function SketchThumbnail({ page }: { page: SketchPage }) {
  const ref = useRef<HTMLCanvasElement | null>(null);
  useEffect(() => {
    const context = ref.current?.getContext("2d");
    if (!context) return;
    drawSketchPage(context, page);
  }, [page]);
  return <canvas ref={ref} width={page.width} height={page.height} aria-hidden="true" />;
}

function sketchRecord(record: BaseRecord): Sketch {
  return record as Sketch;
}

export function SketchPage({
  data,
  themes,
  activeTheme,
  navigate,
  saveEntity,
  saveEntities,
  removeEntity,
  setToast,
}: PageProps) {
  const sketches = useMemo(() => data.sketches.map(sketchRecord), [data.sketches]);
  const [activeId, setActiveId] = useState(() => localStorage.getItem(ACTIVE_SKETCH_KEY) || sketches[0]?.id || "");
  const selected = sketches.find((entry) => entry.id === activeId) || sketches[0] || null;
  const [title, setTitle] = useState(selected?.title || "");
  const [projectId, setProjectId] = useState(selected?.project_id || activeTheme?.id || "");
  const [document, setDocument] = useState<SketchDocument>(selected?.document || createSketchDraft().document);
  const [activePageId, setActivePageId] = useState(document.pages[0]?.id || "");
  const [tool, setTool] = useState<SketchTool>("pen");
  const [color, setColor] = useState(SKETCH_COLORS[0]);
  const [strokeWidth, setStrokeWidth] = useState(2);
  const [zoom, setZoom] = useState(0.82);
  const [saveState, setSaveState] = useState("保存済み");
  const [dirty, setDirty] = useState(false);
  const [undoStack, setUndoStack] = useState<SketchDocument[]>([]);
  const [redoStack, setRedoStack] = useState<SketchDocument[]>([]);
  const [exportOpen, setExportOpen] = useState(false);
  const [insertOpen, setInsertOpen] = useState(false);
  const [targetNoteId, setTargetNoteId] = useState("");
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const saveTimerRef = useRef<number | null>(null);

  useEffect(() => {
    if (!selected) return;
    localStorage.setItem(ACTIVE_SKETCH_KEY, selected.id);
    setActiveId(selected.id);
    setTitle(selected.title);
    setProjectId(selected.project_id || "");
    setDocument(selected.document);
    setActivePageId(selected.document.pages[0]?.id || "");
    setDirty(false);
    setSaveState("保存済み");
    setUndoStack([]);
    setRedoStack([]);
  }, [selected?.id]);

  useEffect(() => {
    if (!selected || !dirty) return;
    if (saveTimerRef.current) window.clearTimeout(saveTimerRef.current);
    setSaveState("保存中…");
    saveTimerRef.current = window.setTimeout(() => {
      void saveEntity("sketch", {
        ...selected,
        title: title.trim() || "無題のSketch",
        project_id: projectId || null,
        document,
      }).then(() => {
        setDirty(false);
        setSaveState("自動保存済み");
      }).catch((error) => {
        setSaveState("保存できませんでした");
        setToast(`Sketchを保存できませんでした。${error instanceof Error ? error.message : String(error)}`, "danger");
      });
    }, 700);
    return () => {
      if (saveTimerRef.current) window.clearTimeout(saveTimerRef.current);
    };
  }, [dirty, document, projectId, saveEntity, selected, setToast, title]);

  useEffect(() => {
    if (tool === "image") fileInputRef.current?.click();
  }, [tool]);

  const activePage = document.pages.find((page) => page.id === activePageId) || document.pages[0];

  function changeDocument(next: SketchDocument) {
    setUndoStack((current) => [...current.slice(-49), cloneSketchDocument(document)]);
    setRedoStack([]);
    setDocument(next);
    setDirty(true);
  }

  function changePage(page: SketchPage) {
    changeDocument({ ...document, pages: document.pages.map((entry) => entry.id === page.id ? page : entry) });
  }

  function undo() {
    const previous = undoStack.at(-1);
    if (!previous) return;
    setRedoStack((current) => [...current, cloneSketchDocument(document)]);
    setUndoStack((current) => current.slice(0, -1));
    setDocument(previous);
    setDirty(true);
  }

  function redo() {
    const next = redoStack.at(-1);
    if (!next) return;
    setUndoStack((current) => [...current, cloneSketchDocument(document)]);
    setRedoStack((current) => current.slice(0, -1));
    setDocument(next);
    setDirty(true);
  }

  async function createSketch(originCaptureId: string | null = null) {
    const draft = createSketchDraft("新しいSketch", activeTheme?.id || null, originCaptureId);
    const saved = await saveEntity("sketch", draft);
    localStorage.setItem(ACTIVE_SKETCH_KEY, saved.id);
    setActiveId(saved.id);
    setToast("Sketchを作成しました。", "success");
  }

  function addPage() {
    const page = createSketchPage(String(document.pages.length + 1));
    changeDocument({ ...document, pages: [...document.pages, page] });
    setActivePageId(page.id);
  }

  function removePage(pageId: string) {
    if (document.pages.length === 1) {
      setToast("Sketchには1ページ以上必要です。", "warning");
      return;
    }
    const index = document.pages.findIndex((page) => page.id === pageId);
    const pages = document.pages.filter((page) => page.id !== pageId);
    changeDocument({ ...document, pages });
    setActivePageId(pages[Math.max(0, index - 1)]?.id || pages[0].id);
  }

  async function deleteSketch() {
    if (!selected) return;
    await removeEntity("sketch", selected);
    const next = sketches.find((entry) => entry.id !== selected.id);
    if (next) {
      localStorage.setItem(ACTIVE_SKETCH_KEY, next.id);
      setActiveId(next.id);
    } else {
      localStorage.removeItem(ACTIVE_SKETCH_KEY);
      navigate("notes");
    }
  }

  async function insertImage(file: File) {
    if (!activePage || !file.type.startsWith("image/")) return;
    const dataUrl = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result));
      reader.onerror = () => reject(reader.error);
      reader.readAsDataURL(file);
    });
    const image = new Image();
    image.src = dataUrl;
    await image.decode();
    const maxWidth = 420;
    const ratio = Math.min(1, maxWidth / image.width);
    const object: SketchObject = {
      id: crypto.randomUUID(),
      type: "image",
      color: "#211e1d",
      x: 80,
      y: 80,
      w: Math.max(80, image.width * ratio),
      h: Math.max(60, image.height * ratio),
      data_url: dataUrl,
    };
    changePage({ ...activePage, objects: [...activePage.objects, object] });
    setTool("select");
  }

  async function exportPayload() {
    if (!selected || !activePage) throw new Error("出力するSketchがありません。");
    const dataUrl = await renderSketchPageToDataUrl(activePage);
    return {
      title: selected.title,
      themeId: selected.project_id || null,
      dataUrl,
      svg: sketchPageToSvg(activePage),
      markdown: `# ${selected.title}\n\n![${selected.title}]({{SKETCH_IMAGE}})\n\n> Tasken Sketchから書き出しました。`,
    };
  }

  async function exportSketch(format: "png" | "svg" | "markdown") {
    setExportOpen(false);
    try {
      const result = await workspaceApi.exportSketch({ ...await exportPayload(), format });
      if (result.canceled) {
        setToast("書き出しをキャンセルしました。", "info");
        return;
      }
      setToast(`Sketchを書き出しました。${result.filePath || ""}`, "success");
    } catch (error) {
      setToast(`Sketchを書き出せませんでした。${error instanceof Error ? error.message : String(error)}`, "danger");
    }
  }

  async function copyForAi() {
    if (!selected || !activePage) return;
    try {
      await workspaceApi.copySketch({
        text: sketchAiPrompt(selected.title),
        dataUrl: await renderSketchPageToDataUrl(activePage),
      });
      setToast("Sketch画像とAI向け指示をクリップボードへコピーしました。AIへそのまま貼り付けられます。", "success");
    } catch (error) {
      setToast(`AI向けにコピーできませんでした。${error instanceof Error ? error.message : String(error)}`, "danger");
    }
  }

  async function insertIntoNote() {
    if (!selected || !activePage) return;
    try {
      const attachment = await workspaceApi.saveMarkdownImageAttachment({
        fileName: `${selected.title}.png`,
        mimeType: "image/png",
        dataUrl: await renderSketchPageToDataUrl(activePage),
      });
      const existing = data.notes.find((note) => note.id === targetNoteId);
      const noteId = existing?.id || crypto.randomUUID();
      const body = [String(existing?.body_markdown || ""), `![${selected.title}](${attachment.url})`].filter(Boolean).join("\n\n");
      const note = existing || {
        id: noteId,
        title: selected.title,
        note_type: "note",
        content_format: "markdown",
        theme_id: selected.project_id || null,
      };
      await saveEntities([
        { action: "save", type: "note", entity: { ...note, body_markdown: body } },
        {
          action: "save",
          type: "reference",
          entity: {
            id: crypto.randomUUID(),
            source_type: "note",
            source_id: noteId,
            target_type: "sketch",
            target_id: selected.id,
            relation_type: "derived_from",
            note: `Sketch「${selected.title}」の${document.pages.findIndex((page) => page.id === activePage.id) + 1}ページ目`,
          },
        },
      ], existing ? "NoteへSketchを挿入しました。" : "SketchからNoteを作成しました。");
      setInsertOpen(false);
      setTargetNoteId("");
    } catch (error) {
      setToast(`Noteへ挿入できませんでした。${error instanceof Error ? error.message : String(error)}`, "danger");
    }
  }

  if (!selected || !activePage) {
    return (
      <div className="page sketch-empty">
        <IconWriting size={48} aria-hidden="true" />
        <h1>Sketchはまだありません</h1>
        <button className="primary-button" onClick={() => void createSketch()}>Sketchを作る</button>
        <button className="text-button" onClick={() => navigate("notes")}>Notesへ戻る</button>
      </div>
    );
  }

  return (
    <div className="sketch-page">
      <header className="sketch-header">
        <div className="sketch-title-group">
          <button className="text-button compact" onClick={() => navigate("notes")}>Notes</button>
          <span aria-hidden="true">/</span>
          <span>Sketch</span>
          <input
            className="sketch-title-input"
            value={title}
            onChange={(event) => {
              setTitle(event.target.value);
              setDirty(true);
            }}
            onBlur={() => !title.trim() && setTitle("無題のSketch")}
            aria-label="Sketchタイトル"
          />
          <select
            className="sketch-theme-select"
            value={projectId}
            onChange={(event) => {
              setProjectId(event.target.value);
              setDirty(true);
            }}
            aria-label="SketchのTheme"
          >
            <option value="">Theme未設定</option>
            {themes.map((theme) => <option key={theme.id} value={theme.id}>{theme.name}</option>)}
          </select>
        </div>
        <div className="sketch-header-meta">
          {selected.origin_capture_id && <span>Ink Captureから</span>}
          <span className={saveState.includes("できません") ? "is-error" : ""} role="status">{saveState}</span>
          <button className="primary-button" onClick={() => setInsertOpen(true)}><IconNotes size={16} />Noteへ挿入</button>
          <div className="sketch-menu">
            <button className="secondary-button" onClick={() => setExportOpen((value) => !value)}>エクスポート <IconChevronDown size={15} /></button>
            {exportOpen && (
              <div className="sketch-menu-popover" role="menu">
                <button role="menuitem" onClick={() => void exportSketch("markdown")}>Markdown + PNG</button>
                <button role="menuitem" onClick={() => void exportSketch("png")}>PNG画像</button>
                <button role="menuitem" onClick={() => void exportSketch("svg")}>SVG画像</button>
                <button role="menuitem" onClick={() => void copyForAi()}><IconSparkles size={15} />AIへ貼り付け</button>
                <button className="is-danger" role="menuitem" onClick={() => void deleteSketch()}><IconTrash size={15} />Sketchを削除</button>
              </div>
            )}
          </div>
        </div>
      </header>

      <div className="sketch-toolbar" role="toolbar" aria-label="Sketchツール">
        <div className="sketch-tool-group">
          {TOOL_ITEMS.map((item) => {
            const Icon = item.icon;
            return (
              <button
                key={item.id}
                className={tool === item.id ? "is-active" : ""}
                aria-pressed={tool === item.id}
                onClick={() => setTool(item.id)}
              >
                <Icon size={17} />
                <span>{item.label}</span>
              </button>
            );
          })}
        </div>
        <div className="sketch-tool-group is-colors" aria-label="線の色">
          {SKETCH_COLORS.map((entry) => (
            <button
              key={entry}
              className={color === entry ? "is-active" : ""}
              style={{ "--ink-color": entry } as React.CSSProperties}
              onClick={() => setColor(entry)}
              aria-label={`色 ${entry}`}
            />
          ))}
        </div>
        <label className="sketch-width-field">
          <span className="sr-only">線幅</span>
          <select value={strokeWidth} onChange={(event) => setStrokeWidth(Number(event.target.value))}>
            <option value={1}>1 px</option>
            <option value={2}>2 px</option>
            <option value={4}>4 px</option>
            <option value={7}>7 px</option>
          </select>
        </label>
        <div className="sketch-tool-group is-history">
          <button disabled={!undoStack.length} onClick={undo} title="元に戻す"><IconArrowBackUp size={18} /><span>戻す</span></button>
          <button disabled={!redoStack.length} onClick={redo} title="やり直す"><IconArrowForwardUp size={18} /><span>やり直す</span></button>
        </div>
      </div>

      <div className="sketch-workspace">
        <aside className="sketch-page-rail" aria-label="Sketchページ">
          <div className="sketch-page-rail-heading">
            <span>ページ</span>
            <button className="row-action-button" onClick={() => void createSketch()} aria-label="別のSketchを作る" title="別のSketchを作る"><IconPlus size={16} /></button>
          </div>
          <select
            className="sketch-document-select"
            value={selected.id}
            onChange={(event) => {
              localStorage.setItem(ACTIVE_SKETCH_KEY, event.target.value);
              setActiveId(event.target.value);
            }}
            aria-label="Sketchを切り替える"
          >
            {sketches.map((sketch) => <option key={sketch.id} value={sketch.id}>{sketch.title}</option>)}
          </select>
          <div className="sketch-thumbnails">
            {document.pages.map((page, index) => (
              <div className={`sketch-thumbnail ${page.id === activePage.id ? "is-active" : ""}`} key={page.id}>
                <button onClick={() => setActivePageId(page.id)} aria-current={page.id === activePage.id ? "page" : undefined}>
                  <SketchThumbnail page={page} />
                  <span>{index + 1}</span>
                </button>
                <button className="sketch-page-remove" onClick={() => removePage(page.id)} aria-label={`${index + 1}ページ目を削除`}><IconTrash size={13} /></button>
              </div>
            ))}
          </div>
          <button className="secondary-button compact sketch-add-page" onClick={addPage}><IconPlus size={15} />ページを追加</button>
        </aside>

        <section className="sketch-canvas-area">
          <SketchCanvas
            page={activePage}
            tool={tool}
            color={color}
            strokeWidth={strokeWidth}
            zoom={zoom}
            onChange={changePage}
            onToolChange={setTool}
          />
          <div className="sketch-bottom-controls">
            <span>{document.pages.findIndex((page) => page.id === activePage.id) + 1} / {document.pages.length}</span>
            <button onClick={() => setZoom((value) => Math.max(0.35, Number((value - 0.1).toFixed(2))))} aria-label="縮小"><IconZoomOut size={17} /></button>
            <span>{Math.round(zoom * 100)}%</span>
            <button onClick={() => setZoom((value) => Math.min(1.6, Number((value + 0.1).toFixed(2))))} aria-label="拡大"><IconZoomIn size={17} /></button>
            <button onClick={() => setZoom(0.82)} aria-label="ページ全体を表示"><IconMaximize size={17} /></button>
            <button
              onClick={() => {
                const order: SketchPage["background"][] = ["dot", "grid", "plain"];
                changePage({ ...activePage, background: order[(order.indexOf(activePage.background) + 1) % order.length] });
              }}
            >
              <IconGridDots size={17} />背景: {activePage.background === "dot" ? "ドット" : activePage.background === "grid" ? "グリッド" : "無地"}
            </button>
          </div>
        </section>
      </div>

      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        hidden
        onChange={(event) => {
          const file = event.target.files?.[0];
          if (file) void insertImage(file);
          event.target.value = "";
          if (!file) setTool("select");
        }}
      />

      {insertOpen && (
        <div className="modal-backdrop" role="presentation" onMouseDown={(event) => {
          if (event.currentTarget === event.target) setInsertOpen(false);
        }}>
          <section className="modal-card sketch-note-dialog" role="dialog" aria-modal="true" aria-labelledby="sketch-note-title">
            <div className="section-heading">
              <h2 id="sketch-note-title">Noteへ挿入</h2>
              <button className="row-action-button" onClick={() => setInsertOpen(false)} aria-label="閉じる"><IconDots size={16} /></button>
            </div>
            <label>挿入先
              <select value={targetNoteId} onChange={(event) => setTargetNoteId(event.target.value)}>
                <option value="">新しいNoteを作る</option>
                {data.notes.map((note) => <option key={note.id} value={note.id}>{String(note.title || "無題")}</option>)}
              </select>
            </label>
            <div className="form-actions">
              <button className="secondary-button" onClick={() => setInsertOpen(false)}>閉じる</button>
              <button className="primary-button" onClick={() => void insertIntoNote()}>挿入する</button>
            </div>
          </section>
        </div>
      )}
    </div>
  );
}
