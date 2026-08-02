import {
  IconArrowBackUp,
  IconArrowForwardUp,
  IconArrowUpRight,
  IconArrowsLeftRight,
  IconChevronDown,
  IconCircle,
  IconDiamond,
  IconEraser,
  IconGridDots,
  IconHandMove,
  IconHighlight,
  IconLasso,
  IconLine,
  IconLineDashed,
  IconMaximize,
  IconMessage,
  IconNote,
  IconPhoto,
  IconPointer,
  IconPlus,
  IconRectangle,
  IconSquareRounded,
  IconShape,
  IconSparkles,
  IconTextSize,
  IconTriangle,
  IconTrash,
  IconWriting,
  IconZoomIn,
  IconZoomOut,
} from "@tabler/icons-react";
import { useEffect, useMemo, useRef, useState } from "react";

import { workspaceApi } from "../../../services/workspaceApi";
import { usePersistentState } from "../../../utils/usePersistentState";
import { SketchCanvas } from "../components/SketchCanvas";
import {
  cloneSketchDocument,
  createEmptySketchDocument,
  createSketchPage,
  cropSketchPageToContent,
  drawSketchPage,
  expandInfinitePage,
  renderSketchPageToDataUrl,
  sketchAiPrompt,
  sketchCanvasMode,
  sketchPageToSvg,
  type SketchDocument,
  type SketchEraserMode,
  type SketchObject,
  type SketchPage,
  type SketchPoint,
  type SketchShapeKind,
  type SketchTool,
} from "../lib/sketch";
import { ACTIVE_SKETCH_ID_KEY, ACTIVE_SKETCH_PAGE_KEY } from "../lib/sketchEmbed";
import { clampSketchZoom } from "../lib/sketchNavigation";
import {
  DEFAULT_SKETCH_TOOL_PRESETS,
  isSketchPresetTool,
  normalizeSketchToolPresets,
  SKETCH_TOOL_WIDTHS,
  type SketchPresetTool,
  type SketchToolPresets,
} from "../lib/sketchToolPresets";
import type { BaseRecord, PageProps, Sketch } from "../types";

const SKETCH_COLORS = ["#211e1d", "#2f6fa6", "#3f7a4f", "#8a2f3b", "#c47a18"];
const SHAPE_ITEMS: Array<{ id: SketchShapeKind; label: string; icon: typeof IconShape }> = [
  { id: "auto", label: "自動", icon: IconSparkles },
  { id: "line", label: "線", icon: IconLine },
  { id: "rectangle", label: "四角", icon: IconRectangle },
  { id: "rounded_rectangle", label: "角丸四角", icon: IconSquareRounded },
  { id: "ellipse", label: "円・楕円", icon: IconCircle },
  { id: "triangle", label: "三角", icon: IconTriangle },
  { id: "diamond", label: "ひし形", icon: IconDiamond },
  { id: "sticky_note", label: "付箋", icon: IconNote },
  { id: "callout", label: "吹き出し", icon: IconMessage },
  { id: "bidirectional_arrow", label: "両矢印", icon: IconArrowsLeftRight },
];
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
  navigate,
  openDrawer,
  saveEntity,
  setToast,
}: PageProps) {
  const sketches = useMemo(() => data.sketches.map(sketchRecord), [data.sketches]);
  const [activeId, setActiveId] = useState(() => localStorage.getItem(ACTIVE_SKETCH_ID_KEY) || sketches[0]?.id || "");
  const selected = sketches.find((entry) => entry.id === activeId) || sketches[0] || null;
  const [document, setDocument] = useState<SketchDocument>(selected?.document || createEmptySketchDocument());
  const [activePageId, setActivePageId] = useState(() => localStorage.getItem(ACTIVE_SKETCH_PAGE_KEY) || document.pages[0]?.id || "");
  const [tool, setTool] = useState<SketchTool>("pen");
  const [storedPresets, setStoredPresets] = usePersistentState<SketchToolPresets>(
    "sketch:tool-presets:v1",
    DEFAULT_SKETCH_TOOL_PRESETS,
  );
  const toolPresets = useMemo(() => normalizeSketchToolPresets(storedPresets), [storedPresets]);
  const activePresetTool: SketchPresetTool = isSketchPresetTool(tool) ? tool : "pen";
  const activePreset = toolPresets[activePresetTool];
  const [storedShapeKind, setShapeKind] = usePersistentState<SketchShapeKind>("sketch:shape-kind:v1", "auto");
  const shapeKind = SHAPE_ITEMS.some((item) => item.id === storedShapeKind) ? storedShapeKind : "auto";
  const [eraserMode, setEraserMode] = usePersistentState<SketchEraserMode>("sketch:eraser-mode:v1", "partial");
  const [shapeMenuOpen, setShapeMenuOpen] = useState(false);
  const [zoom, setZoom] = useState(0.82);
  const [saveState, setSaveState] = useState("保存済み");
  const [dirty, setDirty] = useState(false);
  const [undoStack, setUndoStack] = useState<SketchDocument[]>([]);
  const [redoStack, setRedoStack] = useState<SketchDocument[]>([]);
  const [exportOpen, setExportOpen] = useState(false);
  const [exportRange, setExportRange] = useState<"drawing" | "canvas">("drawing");
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const saveTimerRef = useRef<number | null>(null);

  useEffect(() => {
    if (!selected) return;
    localStorage.setItem(ACTIVE_SKETCH_ID_KEY, selected.id);
    setActiveId(selected.id);
    setDocument(selected.document);
    const requestedPageId = localStorage.getItem(ACTIVE_SKETCH_PAGE_KEY);
    setActivePageId(selected.document.pages.some((page) => page.id === requestedPageId)
      ? requestedPageId || ""
      : selected.document.pages[0]?.id || "");
    setDirty(false);
    setSaveState("保存済み");
    setUndoStack([]);
    setRedoStack([]);
  }, [selected?.id]);

  useEffect(() => {
    if (activePageId) localStorage.setItem(ACTIVE_SKETCH_PAGE_KEY, activePageId);
  }, [activePageId]);

  useEffect(() => {
    if (!selected || !dirty) return;
    if (saveTimerRef.current) window.clearTimeout(saveTimerRef.current);
    setSaveState("保存中…");
    saveTimerRef.current = window.setTimeout(() => {
      void saveEntity("sketch", {
        ...selected,
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
  }, [dirty, document, saveEntity, selected, setToast]);

  useEffect(() => {
    if (tool === "image") fileInputRef.current?.click();
  }, [tool]);

  useEffect(() => {
    const input = fileInputRef.current;
    if (!input) return;
    const handleCancel = () => setTool("select");
    input.addEventListener("cancel", handleCancel);
    return () => input.removeEventListener("cancel", handleCancel);
  }, []);

  const activePage = document.pages.find((page) => page.id === activePageId) || document.pages[0];
  const canvasMode = sketchCanvasMode(document);
  const selectedTheme = themes.find((theme) => theme.id === selected?.project_id);

  function updateActivePreset(next: Partial<{ color: string; width: number }>) {
    if (!isSketchPresetTool(tool)) return;
    setStoredPresets((current) => {
      const normalized = normalizeSketchToolPresets(current);
      return { ...normalized, [tool]: { ...normalized[tool], ...next } };
    });
  }

  function changeDocument(next: SketchDocument) {
    setUndoStack((current) => [...current.slice(-49), cloneSketchDocument(document)]);
    setRedoStack([]);
    setDocument(next);
    setDirty(true);
  }

  function changePage(page: SketchPage) {
    const nextPage = canvasMode === "infinite" ? expandInfinitePage(page) : page;
    changeDocument({ ...document, pages: document.pages.map((entry) => entry.id === nextPage.id ? nextPage : entry) });
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

  function addPage() {
    const page = createSketchPage(String(document.pages.length + 1), "page");
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

  async function insertImage(file: File, point?: Pick<SketchPoint, "x" | "y">) {
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
    const width = Math.max(80, image.width * ratio);
    const height = Math.max(60, image.height * ratio);
    const object: SketchObject = {
      id: crypto.randomUUID(),
      type: "image",
      color: "#211e1d",
      x: point ? Math.max(0, Math.min(activePage.width - width, point.x - width / 2)) : 80,
      y: point ? Math.max(0, Math.min(activePage.height - height, point.y - height / 2)) : 80,
      w: width,
      h: height,
      data_url: dataUrl,
    };
    changePage({ ...activePage, objects: [...activePage.objects, object] });
    setTool("select");
  }

  async function exportPayload() {
    if (!selected || !activePage) throw new Error("出力するSketchがありません。");
    const exportPage = canvasMode === "infinite" && exportRange === "drawing"
      ? cropSketchPageToContent(activePage)
      : activePage;
    const dataUrl = await renderSketchPageToDataUrl(exportPage);
    return {
      title: selected.title,
      themeId: selected.project_id || null,
      dataUrl,
      svg: sketchPageToSvg(exportPage),
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

  async function copyImageForAi() {
    if (!selected || !activePage) return;
    try {
      await workspaceApi.copyImage({
        dataUrl: await renderSketchPageToDataUrl(activePage),
      });
      setToast("1/2 Sketch画像をコピーしました。AIの入力欄へ貼り付けてください。", "success");
    } catch (error) {
      setToast(`Sketch画像をコピーできませんでした。${error instanceof Error ? error.message : String(error)}`, "danger");
    }
  }

  async function copyAiPrompt() {
    if (!selected) return;
    try {
      await workspaceApi.copyText(sketchAiPrompt(selected.title));
      setToast("2/2 AI向け指示をコピーしました。画像を貼った会話へ続けて貼り付けてください。", "success");
    } catch (error) {
      setToast(`AI向け指示をコピーできませんでした。${error instanceof Error ? error.message : String(error)} もう一度試してください。`, "danger");
    }
  }

  if (!selected || !activePage) {
    return (
      <div className="page sketch-empty">
        <IconWriting size={48} aria-hidden="true" />
        <h1>Sketchを選択できません</h1>
        <button className="primary-button" onClick={() => navigate("sketch")}>Sketch一覧へ</button>
      </div>
    );
  }

  return (
    <div className="sketch-page">
      <header className="sketch-header">
        <div className="sketch-title-group">
          <button className="text-button compact" onClick={() => navigate("sketch")}>Sketch</button>
          <span aria-hidden="true">/</span>
          <strong className="sketch-editor-title">{selected.title || "無題のSketch"}</strong>
          <span className="sketch-mode-badge">{canvasMode === "infinite" ? "Infinite" : "Page"}</span>
          <span>{selectedTheme?.name || "Theme未設定"}</span>
        </div>
        <div className="sketch-header-meta">
          {selected.origin_capture_id && <span>Ink Captureから</span>}
          <span className={saveState.includes("できません") ? "is-error" : ""} role="status">{saveState}</span>
          <button className="secondary-button" onClick={() => openDrawer({ type: "sketch", entity: selected })}>情報</button>
          <div className="sketch-menu">
            <button className="secondary-button" onClick={() => setExportOpen((value) => !value)}>エクスポート <IconChevronDown size={15} /></button>
            {exportOpen && (
              <div className="sketch-menu-popover" role="menu">
                <button role="menuitem" onClick={() => void exportSketch("markdown")}>Markdown + PNG</button>
                <button role="menuitem" onClick={() => void exportSketch("png")}>PNG画像</button>
                <button role="menuitem" onClick={() => void exportSketch("svg")}>SVG画像</button>
                {canvasMode === "infinite" && (
                  <label className="sketch-export-range">
                    <span>出力範囲</span>
                    <select value={exportRange} onChange={(event) => setExportRange(event.target.value as "drawing" | "canvas")}>
                      <option value="drawing">描画範囲</option>
                      <option value="canvas">キャンバス全体</option>
                    </select>
                  </label>
                )}
                <button role="menuitem" onClick={() => void copyImageForAi()}><IconSparkles size={15} />1. AIへ画像をコピー</button>
                <button role="menuitem" onClick={() => void copyAiPrompt()}><IconSparkles size={15} />2. AI向け指示をコピー</button>
              </div>
            )}
          </div>
        </div>
      </header>

      <div className="sketch-toolbar" role="toolbar" aria-label="Sketchツール">
        <div className="sketch-tool-group">
          {[...TOOL_ITEMS, ...(canvasMode === "infinite" ? [{ id: "pan" as const, label: "移動", icon: IconHandMove }] : [])].map((item) => {
            const Icon = item.icon;
            return (
              <button
                key={item.id}
                className={tool === item.id ? "is-active" : ""}
                aria-pressed={tool === item.id}
                onClick={() => setTool(item.id)}
                title={item.id === "pan" ? "移動（中ボタン / Space+ドラッグ）" : undefined}
              >
                <Icon size={17} />
                <span>{item.label}</span>
              </button>
            );
          })}
        </div>
        {tool === "shape" && (
          <div className="sketch-tool-group sketch-shape-picker">
            <button
              className="sketch-shape-picker-trigger is-active"
              aria-haspopup="menu"
              aria-expanded={shapeMenuOpen}
              onClick={() => setShapeMenuOpen((value) => !value)}
              title="図形の種類"
            >
              {(() => {
                const CurrentIcon = SHAPE_ITEMS.find((item) => item.id === shapeKind)?.icon || IconShape;
                return <CurrentIcon size={18} />;
              })()}
              <span>{SHAPE_ITEMS.find((item) => item.id === shapeKind)?.label}</span>
              <IconChevronDown size={14} />
            </button>
            {shapeMenuOpen && (
              <div className="sketch-shape-popover" role="menu" aria-label="図形の種類">
                {SHAPE_ITEMS.map((item) => {
                  const Icon = item.icon;
                  return (
                    <button
                      key={item.id}
                      role="menuitemradio"
                      aria-checked={shapeKind === item.id}
                      className={shapeKind === item.id ? "is-active" : ""}
                      onClick={() => {
                        setShapeKind(item.id);
                        setShapeMenuOpen(false);
                      }}
                    >
                      <Icon size={18} />
                      <span>{item.label}</span>
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        )}
        {tool === "eraser" && (
          <div className="sketch-tool-group is-eraser-modes" aria-label="消しゴムの種類">
            <button
              className={eraserMode === "partial" ? "is-active" : ""}
              aria-pressed={eraserMode === "partial"}
              onClick={() => setEraserMode("partial")}
              title="線の触れた部分だけを消す"
            >
              <IconLineDashed size={18} />
              <span>部分消し</span>
            </button>
            <button
              className={eraserMode === "stroke" ? "is-active" : ""}
              aria-pressed={eraserMode === "stroke"}
              onClick={() => setEraserMode("stroke")}
              title="触れた線やオブジェクトをまとめて消す"
            >
              <IconEraser size={18} />
              <span>線ごと</span>
            </button>
          </div>
        )}
        {isSketchPresetTool(tool) && tool !== "eraser" && (
          <div className="sketch-tool-group is-colors" aria-label={`${TOOL_ITEMS.find((item) => item.id === tool)?.label || "道具"}の色`}>
            {SKETCH_COLORS.map((entry) => (
              <button
                key={entry}
                className={activePreset.color === entry ? "is-active" : ""}
                style={{ "--ink-color": entry } as React.CSSProperties}
                onClick={() => updateActivePreset({ color: entry })}
                aria-label={`色 ${entry}`}
              />
            ))}
          </div>
        )}
        {isSketchPresetTool(tool) && (
          <div
            className={`sketch-width-options is-${tool}`}
            role="radiogroup"
            aria-label={tool === "eraser" ? "消しゴムの大きさ" : tool === "text" ? "文字サイズ" : `${TOOL_ITEMS.find((item) => item.id === tool)?.label || "線"}の太さ`}
          >
            {SKETCH_TOOL_WIDTHS[tool].map((width) => (
              <button
                key={width}
                className={activePreset.width === width ? "is-active" : ""}
                role="radio"
                aria-checked={activePreset.width === width}
                aria-label={`${width}px`}
                onClick={() => updateActivePreset({ width })}
                title={`${width}px`}
              >
                <span style={tool === "eraser"
                  ? { width: `${Math.min(22, width / 2)}px`, height: `${Math.min(22, width / 2)}px` }
                  : tool === "text"
                    ? { height: `${Math.max(2, Math.min(12, width / 3))}px` }
                    : { height: `${Math.max(1, Math.min(12, width))}px` }}
                />
              </button>
            ))}
          </div>
        )}
        <div className="sketch-tool-group is-history">
          <button disabled={!undoStack.length} onClick={undo} title="元に戻す"><IconArrowBackUp size={18} /><span>戻す</span></button>
          <button disabled={!redoStack.length} onClick={redo} title="やり直す"><IconArrowForwardUp size={18} /><span>やり直す</span></button>
        </div>
      </div>

      <div className={`sketch-workspace is-${canvasMode}`}>
        {canvasMode === "page" && <aside className="sketch-page-rail" aria-label="Sketchページ">
          <div className="sketch-page-rail-heading">
            <span>ページ</span>
          </div>
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
        </aside>}

        <section className="sketch-canvas-area">
          <SketchCanvas
            page={activePage}
            tool={tool}
            color={activePreset.color}
            strokeWidth={activePreset.width}
            shapeKind={shapeKind}
            eraserMode={eraserMode}
            zoom={zoom}
            onZoom={setZoom}
            onChange={changePage}
            onToolChange={setTool}
            onUndo={undo}
            onRedo={redo}
            onPasteImage={(file, point) => void insertImage(file, point)}
          />
          <div className="sketch-bottom-controls">
            <span>{canvasMode === "page" ? `${document.pages.findIndex((page) => page.id === activePage.id) + 1} / ${document.pages.length}` : `${activePage.width} × ${activePage.height}`}</span>
            <button onClick={() => setZoom((value) => clampSketchZoom(value - 0.1))} aria-label="縮小" title="縮小（Ctrl+ホイール）"><IconZoomOut size={17} /></button>
            <span>{Math.round(zoom * 100)}%</span>
            <button onClick={() => setZoom((value) => clampSketchZoom(value + 0.1))} aria-label="拡大" title="拡大（Ctrl+ホイール）"><IconZoomIn size={17} /></button>
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

    </div>
  );
}
