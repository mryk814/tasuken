import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ClipboardEvent as ReactClipboardEvent,
  type PointerEvent as ReactPointerEvent,
} from "react";

import { clipboardImageFile } from "../lib/clipboardImage";
import {
  boundsContainPoint,
  combinedObjectBounds,
  drawSketchPage,
  hitTest,
  lassoSelection,
  objectBounds,
  recognizeShape,
  resizeObject,
  snapObjectResize,
  snapObjectTranslation,
  translateObject,
  type SketchAlignmentGuides,
  type SketchBounds,
  type SketchObject,
  type SketchPage,
  type SketchPoint,
  type SketchTool,
} from "../lib/sketch";

interface SketchCanvasProps {
  page: SketchPage;
  tool: SketchTool;
  color: string;
  strokeWidth: number;
  zoom: number;
  onChange(page: SketchPage): void;
  onToolChange(tool: SketchTool): void;
  onUndo(): void;
  onRedo(): void;
  onPasteImage(file: File, point: SketchPoint): void;
}

type PointerMode =
  | { kind: "draw"; points: SketchPoint[] }
  | { kind: "text"; point: SketchPoint }
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

export function SketchCanvas({
  page,
  tool,
  color,
  strokeWidth,
  zoom,
  onChange,
  onToolChange,
  onUndo,
  onRedo,
  onPasteImage,
}: SketchCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const pointerModeRef = useRef<PointerMode>(null);
  const copiedObjectsRef = useRef<SketchObject[]>([]);
  const pasteGenerationRef = useRef(0);
  const lastPointerRef = useRef<SketchPoint>({ x: page.width / 2, y: page.height / 2, pressure: 0.5 });
  const textCommitRef = useRef(false);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [draftPoints, setDraftPoints] = useState<SketchPoint[]>([]);
  const [previewObjects, setPreviewObjects] = useState<SketchObject[] | null>(null);
  const [alignmentGuides, setAlignmentGuides] = useState<SketchAlignmentGuides>({ vertical: [], horizontal: [] });
  const [textEditor, setTextEditor] = useState<{ x: number; y: number; value: string } | null>(null);

  const render = useCallback(() => {
    const canvas = canvasRef.current;
    const context = canvas?.getContext("2d");
    if (!canvas || !context) return;
    const renderedPage = previewObjects ? { ...page, objects: previewObjects } : page;
    const draftWidth = tool === "highlighter" ? Math.max(12, strokeWidth * 5) : strokeWidth;
    drawSketchPage(context, renderedPage, {
      selectedIds,
      draftObject: tool === "lasso" || !draftPoints.length ? undefined : {
        id: "draft",
        type: "stroke",
        tool: tool === "highlighter" ? "highlighter" : "pen",
        color,
        width: draftWidth,
        points: draftPoints,
      },
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
  }, [alignmentGuides, color, draftPoints, page, previewObjects, selectedIds, strokeWidth, tool]);

  useEffect(() => render(), [render]);
  useEffect(() => setSelectedIds((current) => current.filter((id) => page.objects.some((object) => object.id === id))), [page.objects]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target?.closest("input, textarea, select, [contenteditable='true']")) return;
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
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onChange, onRedo, onUndo, page, selectedIds]);

  function commitObjects(objects: SketchObject[]) {
    onChange({ ...page, objects });
  }

  function onPointerDown(event: ReactPointerEvent<HTMLCanvasElement>) {
    if (event.button !== 0) return;
    const point = pointerPoint(event, page);
    lastPointerRef.current = point;

    if (["shape", "arrow", "text"].includes(tool)) {
      const hit = hitTest(page.objects, point);
      if (hit) {
        event.currentTarget.focus();
        event.currentTarget.setPointerCapture(event.pointerId);
        setSelectedIds([hit.id]);
        onToolChange("select");
        pointerModeRef.current = {
          kind: "move",
          start: point,
          ids: [hit.id],
          originObjects: structuredClone(page.objects),
        };
        return;
      }
    }

    if (tool === "text") {
      pointerModeRef.current = { kind: "text", point };
      return;
    }

    event.currentTarget.focus();
    event.currentTarget.setPointerCapture(event.pointerId);
    if (tool === "eraser") {
      const hit = hitTest(page.objects, point);
      if (hit) commitObjects(page.objects.filter((object) => object.id !== hit.id));
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
    const mode = pointerModeRef.current;
    if (tool === "eraser" && event.buttons === 1) {
      const hit = hitTest(page.objects, point);
      if (hit) commitObjects(page.objects.filter((object) => object.id !== hit.id));
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
    }
  }

  function onPointerUp(event: ReactPointerEvent<HTMLCanvasElement>) {
    const point = pointerPoint(event, page);
    const mode = pointerModeRef.current;
    pointerModeRef.current = null;
    setDraftPoints([]);
    setPreviewObjects(null);
    setAlignmentGuides({ vertical: [], horizontal: [] });
    if (!mode) return;

    if (mode.kind === "text") {
      textCommitRef.current = false;
      setTextEditor({ x: mode.point.x, y: mode.point.y, value: "" });
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
        width: tool === "highlighter" ? Math.max(12, strokeWidth * 5) : strokeWidth,
        points,
      };
      commitObjects([...page.objects, object]);
      return;
    }
    if (tool === "shape") {
      const bounds = objectBounds({ id: "", type: "stroke", tool: "pen", color, width: strokeWidth, points });
      const object: SketchObject = {
        id: crypto.randomUUID(),
        type: "shape",
        shape: recognizeShape(points),
        color,
        width: strokeWidth,
        x: bounds.x,
        y: bounds.y,
        w: Math.max(12, bounds.w),
        h: Math.max(12, bounds.h),
      };
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
  }

  function commitText() {
    if (!textEditor || textCommitRef.current) return;
    textCommitRef.current = true;
    const editor = textEditor;
    const text = editor.value.trim();
    if (text) {
      const object: SketchObject = {
        id: crypto.randomUUID(),
        type: "text",
        color,
        x: editor.x,
        y: editor.y + 24,
        text,
        font_size: 24,
      };
      commitObjects([...page.objects, object]);
      setSelectedIds([object.id]);
    }
    setTextEditor(null);
  }

  function onPaste(event: ReactClipboardEvent<HTMLCanvasElement>) {
    const image = clipboardImageFile(event.clipboardData);
    if (!image) return;
    event.preventDefault();
    onPasteImage(image, lastPointerRef.current);
  }

  return (
    <div className="sketch-canvas-scroll">
      <div className="sketch-canvas-stage" style={{ width: `${page.width * zoom}px`, height: `${page.height * zoom}px` }}>
        <canvas
          ref={canvasRef}
          className={`sketch-canvas is-${tool}`}
          width={page.width}
          height={page.height}
          tabIndex={0}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerCancel}
          onPaste={onPaste}
          aria-label="Sketchキャンバス"
        />
        {textEditor && (
          <textarea
            className="sketch-inline-text"
            style={{ left: `${textEditor.x * zoom}px`, top: `${textEditor.y * zoom}px`, fontSize: `${24 * zoom}px` }}
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
