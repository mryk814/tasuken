import { IconEdit, IconStackBack, IconStackFront } from "@tabler/icons-react";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ClipboardEvent as ReactClipboardEvent,
  type PointerEvent as ReactPointerEvent,
  type WheelEvent as ReactWheelEvent,
} from "react";

import { clipboardImageFile } from "../lib/clipboardImage";
import { anchoredSketchScroll, sketchZoomFromWheel } from "../lib/sketchNavigation";
import {
  combinedObjectBounds,
  drawSketchPage,
  eraseSketchObjects,
  hitTest,
  lassoSelection,
  moveSketchObjectsToLayer,
  objectBounds,
  recognizeShape,
  resizeObject,
  snapObjectResize,
  snapObjectTranslation,
  translateObject,
  type SketchAlignmentGuides,
  type SketchBounds,
  type SketchEraserMode,
  type SketchObject,
  type SketchPage,
  type SketchPoint,
  type SketchShape,
  type SketchShapeKind,
  type SketchTool,
} from "../lib/sketch";

interface SketchCanvasProps {
  page: SketchPage;
  tool: SketchTool;
  color: string;
  strokeWidth: number;
  shapeKind: SketchShapeKind;
  eraserMode: SketchEraserMode;
  zoom: number;
  onZoom(zoom: number): void;
  onChange(page: SketchPage): void;
  onToolChange(tool: SketchTool): void;
  onUndo(): void;
  onRedo(): void;
  onPasteImage(file: File, point: SketchPoint): void;
}

type PointerMode =
  | { kind: "draw"; points: SketchPoint[] }
  | { kind: "erase"; points: SketchPoint[]; originObjects: SketchObject[] }
  | { kind: "text"; point: SketchPoint }
  | { kind: "pan"; clientX: number; clientY: number; scrollLeft: number; scrollTop: number }
  | { kind: "move"; start: SketchPoint; ids: string[]; originObjects: SketchObject[] }
  | { kind: "resize"; start: SketchPoint; id: string; bounds: SketchBounds; originObjects: SketchObject[] }
  | null;

function pointerPoint(event: ReactPointerEvent<HTMLCanvasElement>, page: SketchPage): SketchPoint {
  const rect = event.currentTarget.getBoundingClientRect();
  return {
    x: (event.clientX - rect.left) * page.width / rect.width,
    y: (event.clientY - rect.top) * page.height / rect.height,
    pressure: event.pressure > 0 ? event.pressure : event.pointerType === "mouse" ? 0.5 : 0.35,
  };
}

function coalescedPointerPoints(event: ReactPointerEvent<HTMLCanvasElement>, page: SketchPage): SketchPoint[] {
  const rect = event.currentTarget.getBoundingClientRect();
  const coalescedEvents = event.nativeEvent.getCoalescedEvents?.() || [];
  const events = coalescedEvents.length ? coalescedEvents : [event.nativeEvent];
  return events.map((entry) => ({
    x: (entry.clientX - rect.left) * page.width / rect.width,
    y: (entry.clientY - rect.top) * page.height / rect.height,
    pressure: entry.pressure > 0 ? entry.pressure : entry.pointerType === "mouse" ? 0.5 : 0.35,
  }));
}

function selectionBounds(page: SketchPage, selectedIds: string[]): SketchBounds | null {
  return combinedObjectBounds(page.objects.filter((object) => selectedIds.includes(object.id)));
}

function shapeFromPoints(
  points: SketchPoint[],
  shapeKind: SketchShapeKind,
  color: string,
  width: number,
  id = "draft",
): SketchShape {
  const bounds = objectBounds({ id: "", type: "stroke", tool: "pen", color, width, points });
  const first = points[0];
  const last = points.at(-1) || first;
  const shape = shapeKind === "auto" ? recognizeShape(points) : shapeKind;
  if (shape === "line" || shape === "bidirectional_arrow") {
    return { id, type: "shape", shape, color, width, x: first.x, y: first.y, w: last.x - first.x, h: last.y - first.y };
  }
  return {
    id,
    type: "shape",
    shape,
    color,
    width,
    x: bounds.x,
    y: bounds.y,
    w: Math.max(12, bounds.w),
    h: Math.max(12, bounds.h),
  };
}

export function SketchCanvas({
  page,
  tool,
  color,
  strokeWidth,
  shapeKind,
  eraserMode,
  zoom,
  onZoom,
  onChange,
  onToolChange,
  onUndo,
  onRedo,
  onPasteImage,
}: SketchCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const pointerModeRef = useRef<PointerMode>(null);
  const copiedObjectsRef = useRef<SketchObject[]>([]);
  const pasteGenerationRef = useRef(0);
  const lastPointerRef = useRef<SketchPoint>({ x: page.width / 2, y: page.height / 2, pressure: 0.5 });
  const textCommitRef = useRef(false);
  const pointerOverCanvasRef = useRef(false);
  const spacePressedRef = useRef(false);
  const zoomAnchorRef = useRef<{ left: number; top: number } | null>(null);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [draftPoints, setDraftPoints] = useState<SketchPoint[]>([]);
  const [previewObjects, setPreviewObjects] = useState<SketchObject[] | null>(null);
  const [alignmentGuides, setAlignmentGuides] = useState<SketchAlignmentGuides>({ vertical: [], horizontal: [] });
  const [textEditor, setTextEditor] = useState<{
    id?: string;
    x: number;
    y: number;
    value: string;
    color: string;
    fontSize: number;
  } | null>(null);
  const [hoverIntent, setHoverIntent] = useState<"move" | "resize" | null>(null);
  const [eraserPoint, setEraserPoint] = useState<SketchPoint | null>(null);
  const [temporaryPanReady, setTemporaryPanReady] = useState(false);
  const [panning, setPanning] = useState(false);

  const render = useCallback(() => {
    const canvas = canvasRef.current;
    const context = canvas?.getContext("2d");
    if (!canvas || !context) return;
    const sourceObjects = previewObjects || page.objects;
    const renderedPage = {
      ...page,
      objects: textEditor?.id ? sourceObjects.filter((object) => object.id !== textEditor.id) : sourceObjects,
    };
    const draftShape = tool === "shape" && draftPoints.length
      ? shapeFromPoints(draftPoints, shapeKind, color, strokeWidth)
      : undefined;
    drawSketchPage(context, renderedPage, {
      selectedIds,
      draftObject: tool === "lasso" || tool === "shape" || !draftPoints.length ? undefined : {
        id: "draft",
        type: "stroke",
        tool: tool === "highlighter" ? "highlighter" : "pen",
        color,
        width: strokeWidth,
        points: draftPoints,
      },
      draftShape,
      lassoPoints: tool === "lasso" ? draftPoints : undefined,
    });
    context.save();
    context.strokeStyle = "#2f6fa6";
    context.lineWidth = 1.5;
    context.setLineDash([7, 5]);
    for (const x of alignmentGuides.vertical) {
      context.beginPath();
      context.moveTo(x, 0);
      context.lineTo(x, page.height);
      context.stroke();
    }
    for (const y of alignmentGuides.horizontal) {
      context.beginPath();
      context.moveTo(0, y);
      context.lineTo(page.width, y);
      context.stroke();
    }
    context.restore();
  }, [alignmentGuides, color, draftPoints, page, previewObjects, selectedIds, shapeKind, strokeWidth, textEditor?.id, tool]);

  useEffect(() => render(), [render]);
  useEffect(() => setSelectedIds((current) => current.filter((id) => page.objects.some((object) => object.id === id))), [page.objects]);
  useLayoutEffect(() => {
    const scroll = scrollRef.current;
    const anchor = zoomAnchorRef.current;
    if (!scroll || !anchor) return;
    scroll.scrollLeft = anchor.left;
    scroll.scrollTop = anchor.top;
    zoomAnchorRef.current = null;
  }, [zoom]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target?.closest("input, textarea, select, [contenteditable='true']")) return;
      if (event.code === "Space" && (pointerOverCanvasRef.current || document.activeElement === canvasRef.current)) {
        event.preventDefault();
        if (!spacePressedRef.current) {
          spacePressedRef.current = true;
          setTemporaryPanReady(true);
        }
        return;
      }
      if ((event.key === "Delete" || event.key === "Backspace") && selectedIds.length) {
        event.preventDefault();
        onChange({ ...page, objects: page.objects.filter((object) => !selectedIds.includes(object.id)) });
        setSelectedIds([]);
      }
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "a") {
        event.preventDefault();
        setSelectedIds(page.objects.map((object) => object.id));
      }
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "c" && selectedIds.length) {
        event.preventDefault();
        copiedObjectsRef.current = structuredClone(page.objects.filter((object) => selectedIds.includes(object.id)));
        pasteGenerationRef.current = 0;
      }
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "v" && copiedObjectsRef.current.length) {
        event.preventDefault();
        pasteGenerationRef.current += 1;
        const offset = 24 * pasteGenerationRef.current;
        const copies = copiedObjectsRef.current.map((object) => ({
          ...translateObject(structuredClone(object), offset, offset),
          id: crypto.randomUUID(),
        }));
        onChange({ ...page, objects: [...page.objects, ...copies] });
        setSelectedIds(copies.map((object) => object.id));
      }
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "d" && selectedIds.length) {
        event.preventDefault();
        const copies = page.objects
          .filter((object) => selectedIds.includes(object.id))
          .map((object) => ({ ...translateObject(structuredClone(object), 24, 24), id: crypto.randomUUID() }));
        onChange({ ...page, objects: [...page.objects, ...copies] });
        setSelectedIds(copies.map((object) => object.id));
      }
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "z") {
        event.preventDefault();
        if (event.shiftKey) onRedo();
        else onUndo();
      } else if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "y") {
        event.preventDefault();
        onRedo();
      }
    };
    const onKeyUp = (event: KeyboardEvent) => {
      if (event.code !== "Space") return;
      spacePressedRef.current = false;
      setTemporaryPanReady(false);
    };
    const resetTemporaryPan = () => {
      spacePressedRef.current = false;
      setTemporaryPanReady(false);
      setPanning(false);
    };
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    window.addEventListener("blur", resetTemporaryPan);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
      window.removeEventListener("blur", resetTemporaryPan);
    };
  }, [onChange, onRedo, onUndo, page, selectedIds]);

  function commitObjects(objects: SketchObject[]) {
    onChange({ ...page, objects });
  }

  function startTextEditing(object: Extract<SketchObject, { type: "text" }>) {
    textCommitRef.current = false;
    setTextEditor({
      id: object.id,
      x: object.x,
      y: object.y,
      value: object.text,
      color: object.color,
      fontSize: object.font_size,
    });
  }

  function onPointerDown(event: ReactPointerEvent<HTMLCanvasElement>) {
    if (event.button !== 0 && event.button !== 1) return;
    const point = pointerPoint(event, page);
    lastPointerRef.current = point;
    if (tool === "pan" || event.button === 1 || (event.button === 0 && spacePressedRef.current)) {
      const scroll = scrollRef.current;
      if (!scroll) return;
      event.preventDefault();
      event.currentTarget.setPointerCapture(event.pointerId);
      pointerModeRef.current = {
        kind: "pan",
        clientX: event.clientX,
        clientY: event.clientY,
        scrollLeft: scroll.scrollLeft,
        scrollTop: scroll.scrollTop,
      };
      setPanning(true);
      return;
    }

    if (tool === "text") {
      const hit = hitTest(page.objects, point);
      if (hit?.type === "text") {
        event.currentTarget.focus();
        setSelectedIds([hit.id]);
        startTextEditing(hit);
        return;
      }
      pointerModeRef.current = { kind: "text", point };
      return;
    }

    event.currentTarget.focus();
    event.currentTarget.setPointerCapture(event.pointerId);
    if (tool === "eraser") {
      pointerModeRef.current = { kind: "erase", points: [point], originObjects: structuredClone(page.objects) };
      setPreviewObjects(eraseSketchObjects(page.objects, [point], strokeWidth, eraserMode));
      return;
    }
    if (["pen", "highlighter", "shape", "arrow", "lasso"].includes(tool)) {
      pointerModeRef.current = { kind: "draw", points: [point] };
      setDraftPoints([point]);
      return;
    }
    if (tool === "select") {
      const selectedBounds = selectionBounds(page, selectedIds);
      if (selectedIds.length === 1 && selectedBounds) {
        const handle = { x: selectedBounds.x + selectedBounds.w + 6, y: selectedBounds.y + selectedBounds.h + 6 };
        if (Math.hypot(point.x - handle.x, point.y - handle.y) <= 18) {
          pointerModeRef.current = {
            kind: "resize",
            start: point,
            id: selectedIds[0],
            bounds: selectedBounds,
            originObjects: structuredClone(page.objects),
          };
          return;
        }
      }
      const hit = hitTest(page.objects, point);
      if (!hit) {
        setSelectedIds([]);
        return;
      }
      const ids = event.shiftKey
        ? (selectedIds.includes(hit.id) ? selectedIds.filter((id) => id !== hit.id) : [...selectedIds, hit.id])
        : (selectedIds.includes(hit.id) ? selectedIds : [hit.id]);
      setSelectedIds(ids);
      pointerModeRef.current = { kind: "move", start: point, ids, originObjects: structuredClone(page.objects) };
    }
  }

  function moveObjects(mode: Extract<NonNullable<PointerMode>, { kind: "move" }>, point: SketchPoint) {
    const snapped = snapObjectTranslation(
      mode.originObjects,
      mode.ids,
      point.x - mode.start.x,
      point.y - mode.start.y,
    );
    return {
      objects: mode.originObjects.map((object) => (
        mode.ids.includes(object.id) ? translateObject(object, snapped.dx, snapped.dy) : object
      )),
      guides: snapped.guides,
      distance: Math.hypot(snapped.dx, snapped.dy),
    };
  }

  function resizeObjects(mode: Extract<NonNullable<PointerMode>, { kind: "resize" }>, point: SketchPoint) {
    const object = mode.originObjects.find((entry) => entry.id === mode.id);
    if (!object) return null;
    const nextBounds = {
      ...mode.bounds,
      w: Math.max(16, mode.bounds.w + point.x - mode.start.x),
      h: Math.max(16, mode.bounds.h + point.y - mode.start.y),
    };
    const snapped = snapObjectResize(nextBounds, mode.originObjects, mode.id);
    return {
      objects: mode.originObjects.map((entry) => (
        entry.id === object.id ? resizeObject(entry, snapped.bounds) : entry
      )),
      guides: snapped.guides,
    };
  }

  function onPointerMove(event: ReactPointerEvent<HTMLCanvasElement>) {
    const point = pointerPoint(event, page);
    lastPointerRef.current = point;
    if (tool === "eraser") setEraserPoint(point);
    const mode = pointerModeRef.current;
    if (mode?.kind === "pan") {
      const scroll = scrollRef.current;
      if (!scroll) return;
      scroll.scrollLeft = mode.scrollLeft - (event.clientX - mode.clientX);
      scroll.scrollTop = mode.scrollTop - (event.clientY - mode.clientY);
      return;
    }
    if (mode?.kind === "erase") {
      const points = [...mode.points, ...coalescedPointerPoints(event, page)];
      pointerModeRef.current = { ...mode, points };
      setPreviewObjects(eraseSketchObjects(mode.originObjects, points, strokeWidth, eraserMode));
      return;
    }
    if (mode?.kind === "draw") {
      const points = [...mode.points, ...coalescedPointerPoints(event, page)];
      pointerModeRef.current = { ...mode, points };
      setDraftPoints(points);
      return;
    }
    if (mode?.kind === "move") {
      const preview = moveObjects(mode, point);
      setPreviewObjects(preview.objects);
      setAlignmentGuides(preview.guides);
      return;
    }
    if (mode?.kind === "resize") {
      const preview = resizeObjects(mode, point);
      if (!preview) return;
      setPreviewObjects(preview.objects);
      setAlignmentGuides(preview.guides);
      return;
    }
    if (!mode && tool === "select") {
      const selectedBounds = selectionBounds(page, selectedIds);
      if (selectedIds.length === 1 && selectedBounds) {
        const handle = { x: selectedBounds.x + selectedBounds.w + 6, y: selectedBounds.y + selectedBounds.h + 6 };
        if (Math.hypot(point.x - handle.x, point.y - handle.y) <= 18) {
          setHoverIntent("resize");
          return;
        }
      }
      setHoverIntent(hitTest(page.objects, point) ? "move" : null);
    }
  }

  function onPointerUp(event: ReactPointerEvent<HTMLCanvasElement>) {
    const point = pointerPoint(event, page);
    const mode = pointerModeRef.current;
    pointerModeRef.current = null;
    setPanning(false);
    setDraftPoints([]);
    setPreviewObjects(null);
    setAlignmentGuides({ vertical: [], horizontal: [] });
    if (!mode) return;
    if (mode.kind === "pan") return;
    if (mode.kind === "erase") {
      const points = [...mode.points, ...coalescedPointerPoints(event, page)];
      const objects = eraseSketchObjects(mode.originObjects, points, strokeWidth, eraserMode);
      const changed = objects.length !== mode.originObjects.length
        || objects.some((object, index) => object !== mode.originObjects[index]);
      if (changed) commitObjects(objects);
      return;
    }

    if (mode.kind === "text") {
      textCommitRef.current = false;
      setTextEditor({
        x: mode.point.x,
        y: mode.point.y + strokeWidth,
        value: "",
        color,
        fontSize: strokeWidth,
      });
      return;
    }
    if (mode.kind === "move") {
      const result = moveObjects(mode, point);
      if (result.distance > 1) commitObjects(result.objects);
      return;
    }
    if (mode.kind === "resize") {
      if (Math.hypot(point.x - mode.start.x, point.y - mode.start.y) <= 1) return;
      const result = resizeObjects(mode, point);
      if (result) commitObjects(result.objects);
      return;
    }

    const releasePoints = coalescedPointerPoints(event, page);
    const points = mode.points.length > 1 ? [...mode.points, ...releasePoints] : [...mode.points, point];
    if (tool === "lasso") {
      setSelectedIds(lassoSelection(page.objects, points));
      onToolChange("select");
      return;
    }
    if (tool === "pen" || tool === "highlighter") {
      const object: SketchObject = {
        id: crypto.randomUUID(),
        type: "stroke",
        tool,
        color,
        width: strokeWidth,
        points,
      };
      commitObjects([...page.objects, object]);
      return;
    }
    if (tool === "shape") {
      const object = shapeFromPoints(points, shapeKind, color, strokeWidth, crypto.randomUUID());
      commitObjects([...page.objects, object]);
      setSelectedIds([object.id]);
      return;
    }
    if (tool === "arrow") {
      const first = points[0];
      const last = points[points.length - 1];
      const object: SketchObject = {
        id: crypto.randomUUID(),
        type: "shape",
        shape: "arrow",
        color,
        width: strokeWidth,
        x: first.x,
        y: first.y,
        w: last.x - first.x,
        h: last.y - first.y,
      };
      commitObjects([...page.objects, object]);
      setSelectedIds([object.id]);
    }
  }

  function onPointerCancel() {
    pointerModeRef.current = null;
    setDraftPoints([]);
    setPreviewObjects(null);
    setAlignmentGuides({ vertical: [], horizontal: [] });
    setPanning(false);
  }

  function commitText() {
    if (!textEditor || textCommitRef.current) return;
    textCommitRef.current = true;
    const editor = textEditor;
    const text = editor.value.trim();
    if (text) {
      const object: SketchObject = {
        id: editor.id || crypto.randomUUID(),
        type: "text",
        color: editor.color,
        x: editor.x,
        y: editor.y,
        text,
        font_size: editor.fontSize,
      };
      commitObjects(editor.id
        ? page.objects.map((entry) => entry.id === editor.id ? object : entry)
        : [...page.objects, object]);
      setSelectedIds([object.id]);
    } else if (editor.id) {
      commitObjects(page.objects.filter((object) => object.id !== editor.id));
      setSelectedIds([]);
    }
    setTextEditor(null);
  }

  function onPaste(event: ReactClipboardEvent<HTMLCanvasElement>) {
    const image = clipboardImageFile(event.clipboardData);
    if (!image) return;
    event.preventDefault();
    onPasteImage(image, lastPointerRef.current);
  }

  function onWheel(event: ReactWheelEvent<HTMLDivElement>) {
    const scroll = scrollRef.current;
    if (!scroll) return;
    if (event.ctrlKey || event.metaKey) {
      event.preventDefault();
      const nextZoom = sketchZoomFromWheel(zoom, event.deltaY);
      if (nextZoom === zoom) return;
      const rect = scroll.getBoundingClientRect();
      const pointerX = event.clientX - rect.left;
      const pointerY = event.clientY - rect.top;
      const nextScroll = anchoredSketchScroll({
        zoom,
        nextZoom,
        scrollLeft: scroll.scrollLeft,
        scrollTop: scroll.scrollTop,
        pointerX,
        pointerY,
      });
      zoomAnchorRef.current = nextScroll;
      onZoom(nextZoom);
      return;
    }
  }

  function onDoubleClick(event: ReactPointerEvent<HTMLCanvasElement>) {
    if (tool !== "select") return;
    const hit = hitTest(page.objects, pointerPoint(event, page));
    if (hit?.type !== "text") return;
    setSelectedIds([hit.id]);
    startTextEditing(hit);
  }

  const selectedBounds = selectionBounds(page, selectedIds);
  const selectedText = selectedIds.length === 1
    ? page.objects.find((object): object is Extract<SketchObject, { type: "text" }> => object.id === selectedIds[0] && object.type === "text")
    : undefined;

  return (
    <div className="sketch-canvas-scroll" ref={scrollRef} onWheel={onWheel}>
      <div className="sketch-canvas-stage" style={{ width: `${page.width * zoom}px`, height: `${page.height * zoom}px` }}>
        <canvas
          ref={canvasRef}
          className={`sketch-canvas is-${tool}${temporaryPanReady ? " is-temporary-pan" : ""}${panning ? " is-panning" : ""}${hoverIntent ? ` has-${hoverIntent}-target` : ""}`}
          width={page.width}
          height={page.height}
          tabIndex={0}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerCancel}
          onDoubleClick={onDoubleClick}
          onPointerEnter={() => {
            pointerOverCanvasRef.current = true;
          }}
          onPointerLeave={() => {
            pointerOverCanvasRef.current = false;
            setHoverIntent(null);
            setEraserPoint(null);
          }}
          onAuxClick={(event) => event.preventDefault()}
          onPaste={onPaste}
          aria-label="Sketchキャンバス"
        />
        {tool === "eraser" && eraserPoint && (
          <span
            className="sketch-eraser-preview"
            style={{
              left: `${eraserPoint.x * zoom}px`,
              top: `${eraserPoint.y * zoom}px`,
              width: `${strokeWidth * zoom}px`,
              height: `${strokeWidth * zoom}px`,
            }}
            aria-hidden="true"
          />
        )}
        {selectedBounds && selectedIds.length > 0 && !textEditor && (
          <div
            className="sketch-selection-actions"
            style={{
              left: `${Math.max(4, selectedBounds.x * zoom)}px`,
              top: `${Math.max(4, selectedBounds.y * zoom - 42)}px`,
            }}
            role="toolbar"
            aria-label="選択オブジェクトの操作"
          >
            {selectedText && (
              <button onClick={() => startTextEditing(selectedText)} title="テキストを編集" aria-label="テキストを編集">
                <IconEdit size={16} />
              </button>
            )}
            <button
              onClick={() => commitObjects(moveSketchObjectsToLayer(page.objects, selectedIds, "front"))}
              title="最前面へ"
              aria-label="最前面へ"
            >
              <IconStackFront size={16} />
            </button>
            <button
              onClick={() => commitObjects(moveSketchObjectsToLayer(page.objects, selectedIds, "back"))}
              title="最背面へ"
              aria-label="最背面へ"
            >
              <IconStackBack size={16} />
            </button>
          </div>
        )}
        {textEditor && (
          <textarea
            className="sketch-inline-text"
            style={{
              left: `${textEditor.x * zoom}px`,
              top: `${(textEditor.y - textEditor.fontSize) * zoom}px`,
              width: `${Math.max(120, Math.max(...textEditor.value.split("\n").map((line) => line.length), 5) * textEditor.fontSize * 0.68) * zoom}px`,
              height: `${Math.max(textEditor.fontSize * 1.35, textEditor.value.split("\n").length * textEditor.fontSize * 1.35) * zoom}px`,
              color: textEditor.color,
              fontSize: `${textEditor.fontSize * zoom}px`,
              lineHeight: 1.35,
            }}
            autoFocus
            value={textEditor.value}
            onChange={(event) => setTextEditor({ ...textEditor, value: event.target.value })}
            onBlur={commitText}
            onKeyDown={(event) => {
              if (event.key === "Escape") {
                textCommitRef.current = true;
                setTextEditor(null);
              }
              if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
                event.preventDefault();
                commitText();
              }
            }}
            aria-label="Sketchテキスト"
          />
        )}
      </div>
    </div>
  );
}
