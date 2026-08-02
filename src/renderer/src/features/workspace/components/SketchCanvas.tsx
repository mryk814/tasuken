import { useCallback, useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";

import {
  boundsContainPoint,
  drawSketchPage,
  hitTest,
  lassoSelection,
  objectBounds,
  recognizeShape,
  resizeObject,
  translateObject,
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
}

type PointerMode =
  | { kind: "draw"; points: SketchPoint[] }
  | { kind: "move"; start: SketchPoint; ids: string[] }
  | { kind: "resize"; start: SketchPoint; id: string; bounds: SketchBounds }
  | null;

function pointerPoint(event: ReactPointerEvent<HTMLCanvasElement>, page: SketchPage): SketchPoint {
  const rect = event.currentTarget.getBoundingClientRect();
  return {
    x: (event.clientX - rect.left) * page.width / rect.width,
    y: (event.clientY - rect.top) * page.height / rect.height,
    pressure: event.pressure > 0 ? event.pressure : event.pointerType === "mouse" ? 0.5 : 0.35,
  };
}

function selectionBounds(page: SketchPage, selectedIds: string[]): SketchBounds | null {
  const bounds = page.objects.filter((object) => selectedIds.includes(object.id)).map(objectBounds);
  if (!bounds.length) return null;
  const x = Math.min(...bounds.map((entry) => entry.x));
  const y = Math.min(...bounds.map((entry) => entry.y));
  const x2 = Math.max(...bounds.map((entry) => entry.x + entry.w));
  const y2 = Math.max(...bounds.map((entry) => entry.y + entry.h));
  return { x, y, w: x2 - x, h: y2 - y };
}

export function SketchCanvas({ page, tool, color, strokeWidth, zoom, onChange, onToolChange }: SketchCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const pointerModeRef = useRef<PointerMode>(null);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [draftPoints, setDraftPoints] = useState<SketchPoint[]>([]);
  const [textEditor, setTextEditor] = useState<{ x: number; y: number; value: string } | null>(null);

  const render = useCallback(() => {
    const canvas = canvasRef.current;
    const context = canvas?.getContext("2d");
    if (!canvas || !context) return;
    drawSketchPage(context, page, {
      selectedIds,
      draftPoints: tool === "lasso" ? undefined : draftPoints,
      lassoPoints: tool === "lasso" ? draftPoints : undefined,
    });
  }, [draftPoints, page, selectedIds, tool]);

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
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onChange, page, selectedIds]);

  function commitObjects(objects: SketchObject[]) {
    onChange({ ...page, objects });
  }

  function onPointerDown(event: ReactPointerEvent<HTMLCanvasElement>) {
    if (event.button !== 0) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    const point = pointerPoint(event, page);

    if (tool === "text") {
      setTextEditor({ x: point.x, y: point.y, value: "" });
      return;
    }
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
          pointerModeRef.current = { kind: "resize", start: point, id: selectedIds[0], bounds: selectedBounds };
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
      pointerModeRef.current = { kind: "move", start: point, ids };
    }
  }

  function onPointerMove(event: ReactPointerEvent<HTMLCanvasElement>) {
    const point = pointerPoint(event, page);
    const mode = pointerModeRef.current;
    if (tool === "eraser" && event.buttons === 1) {
      const hit = hitTest(page.objects, point);
      if (hit) commitObjects(page.objects.filter((object) => object.id !== hit.id));
      return;
    }
    if (mode?.kind === "draw") {
      const points = [...mode.points, point];
      pointerModeRef.current = { ...mode, points };
      setDraftPoints(points);
    }
  }

  function onPointerUp(event: ReactPointerEvent<HTMLCanvasElement>) {
    const point = pointerPoint(event, page);
    const mode = pointerModeRef.current;
    pointerModeRef.current = null;
    setDraftPoints([]);
    if (!mode) return;

    if (mode.kind === "move") {
      const dx = point.x - mode.start.x;
      const dy = point.y - mode.start.y;
      if (Math.hypot(dx, dy) > 1) {
        commitObjects(page.objects.map((object) => mode.ids.includes(object.id) ? translateObject(object, dx, dy) : object));
      }
      return;
    }
    if (mode.kind === "resize") {
      const object = page.objects.find((entry) => entry.id === mode.id);
      if (!object) return;
      const nextBounds = {
        ...mode.bounds,
        w: Math.max(16, mode.bounds.w + point.x - mode.start.x),
        h: Math.max(16, mode.bounds.h + point.y - mode.start.y),
      };
      commitObjects(page.objects.map((entry) => entry.id === object.id ? resizeObject(entry, nextBounds) : entry));
      return;
    }

    const points = mode.points.length > 1 ? mode.points : [...mode.points, point];
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
      onToolChange("select");
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
      onToolChange("select");
    }
  }

  function commitText() {
    if (!textEditor) return;
    const text = textEditor.value.trim();
    if (text) {
      const object: SketchObject = {
        id: crypto.randomUUID(),
        type: "text",
        color,
        x: textEditor.x,
        y: textEditor.y + 24,
        text,
        font_size: 24,
      };
      commitObjects([...page.objects, object]);
      setSelectedIds([object.id]);
      onToolChange("select");
    }
    setTextEditor(null);
  }

  return (
    <div className="sketch-canvas-scroll">
      <div className="sketch-canvas-stage" style={{ width: `${page.width * zoom}px`, height: `${page.height * zoom}px` }}>
        <canvas
          ref={canvasRef}
          className={`sketch-canvas is-${tool}`}
          width={page.width}
          height={page.height}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
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
              if (event.key === "Escape") setTextEditor(null);
              if ((event.ctrlKey || event.metaKey) && event.key === "Enter") commitText();
            }}
            aria-label="Sketchテキスト"
          />
        )}
      </div>
    </div>
  );
}
