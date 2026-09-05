import { IconCopy, IconEdit, IconStackBack, IconStackFront, IconTrash } from "@tabler/icons-react";
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
import {
  anchoredSketchScroll,
  anchoredSketchViewportZoom,
  normalizeSketchViewport,
  panSketchViewport,
  screenToSketchWorld,
  sketchWorldToScreen,
  sketchZoomFromWheel,
  type SketchViewport,
} from "../lib/sketchNavigation";
import {
  combinedObjectBounds,
  drawSketchObject,
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
  SKETCH_BACKGROUND_RENDERING,
  type SketchAlignmentGuides,
  type SketchBounds,
  type SketchEraserMode,
  type SketchObject,
  type SketchPage,
  type SketchPoint,
  type SketchShape,
  type SketchShapeKind,
  type SketchTool,
  type SketchCanvasMode,
} from "../lib/sketch";

interface SketchCanvasProps {
  page: SketchPage;
  mode: SketchCanvasMode;
  viewport: SketchViewport;
  tool: SketchTool;
  color: string;
  strokeWidth: number;
  temporaryEraserWidth: number;
  shapeKind: SketchShapeKind;
  eraserMode: SketchEraserMode;
  zoom: number;
  onZoom(zoom: number): void;
  onViewportChange(viewport: SketchViewport): void;
  onChange(page: SketchPage): void;
  onToolChange(tool: SketchTool): void;
  onUndo(): void;
  onRedo(): void;
  onPasteImage(file: File, point: SketchPoint): void;
}

type PointerMode =
  | { kind: "draw"; points: SketchPoint[] }
  | { kind: "erase"; points: SketchPoint[]; originObjects: SketchObject[]; width: number }
  | { kind: "text"; point: SketchPoint }
  | {
      kind: "pan";
      clientX: number;
      clientY: number;
      scrollLeft: number;
      scrollTop: number;
      viewport: SketchViewport;
    }
  | { kind: "move"; start: SketchPoint; ids: string[]; originObjects: SketchObject[] }
  | {
      kind: "resize";
      start: SketchPoint;
      id: string;
      bounds: SketchBounds;
      originObjects: SketchObject[];
    }
  | null;

function pointerPoint(
  event: ReactPointerEvent<HTMLCanvasElement>,
  page: SketchPage,
  mode: SketchCanvasMode,
  viewport: SketchViewport,
): SketchPoint {
  const rect = event.currentTarget.getBoundingClientRect();
  const localX = event.clientX - rect.left;
  const localY = event.clientY - rect.top;
  const point =
    mode === "infinite"
      ? screenToSketchWorld(viewport, localX, localY)
      : { x: (localX * page.width) / rect.width, y: (localY * page.height) / rect.height };
  return {
    ...point,
    pressure: event.pressure > 0 ? event.pressure : event.pointerType === "mouse" ? 0.5 : 0.35,
  };
}

function coalescedPointerPoints(
  event: ReactPointerEvent<HTMLCanvasElement>,
  page: SketchPage,
  mode: SketchCanvasMode,
  viewport: SketchViewport,
): SketchPoint[] {
  const rect = event.currentTarget.getBoundingClientRect();
  const coalescedEvents = event.nativeEvent.getCoalescedEvents?.() || [];
  const events = coalescedEvents.length ? coalescedEvents : [event.nativeEvent];
  return events.map((entry) => {
    const localX = entry.clientX - rect.left;
    const localY = entry.clientY - rect.top;
    const point =
      mode === "infinite"
        ? screenToSketchWorld(viewport, localX, localY)
        : { x: (localX * page.width) / rect.width, y: (localY * page.height) / rect.height };
    return {
      ...point,
      pressure: entry.pressure > 0 ? entry.pressure : entry.pointerType === "mouse" ? 0.5 : 0.35,
    };
  });
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
    return {
      id,
      type: "shape",
      shape,
      color,
      width,
      x: first.x,
      y: first.y,
      w: last.x - first.x,
      h: last.y - first.y,
    };
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
  mode,
  viewport,
  tool,
  color,
  strokeWidth,
  temporaryEraserWidth,
  shapeKind,
  eraserMode,
  zoom,
  onZoom,
  onViewportChange,
  onChange,
  onToolChange,
  onUndo,
  onRedo,
  onPasteImage,
}: SketchCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const baseCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const stageRef = useRef<HTMLDivElement | null>(null);
  const pointerModeRef = useRef<PointerMode>(null);
  const draftPointsRef = useRef<SketchPoint[]>([]);
  const renderFrameRef = useRef<number | null>(null);
  const viewportRef = useRef(normalizeSketchViewport(viewport, zoom));
  const canvasSizeRef = useRef({ width: page.width, height: page.height, dpr: 1 });
  const pendingInputAtRef = useRef<number | null>(null);
  const latencySamplesRef = useRef<number[]>([]);
  const latencyUiAtRef = useRef(0);
  const copiedObjectsRef = useRef<SketchObject[]>([]);
  const pasteGenerationRef = useRef(0);
  const lastPointerRef = useRef<SketchPoint>({
    x: page.width / 2,
    y: page.height / 2,
    pressure: 0.5,
  });
  const textCommitRef = useRef(false);
  const pointerOverCanvasRef = useRef(false);
  const spacePressedRef = useRef(false);
  const zoomAnchorRef = useRef<{ left: number; top: number } | null>(null);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [previewObjects, setPreviewObjects] = useState<SketchObject[] | null>(null);
  const [alignmentGuides, setAlignmentGuides] = useState<SketchAlignmentGuides>({
    vertical: [],
    horizontal: [],
  });
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
  const [temporaryErasing, setTemporaryErasing] = useState(false);
  const [latencyMetrics, setLatencyMetrics] = useState({ latest: 0, p95: 0, samples: 0 });

  function configureInfiniteContext(context: CanvasRenderingContext2D) {
    const { dpr } = canvasSizeRef.current;
    const camera = viewportRef.current;
    context.setTransform(
      dpr * camera.zoom,
      0,
      0,
      dpr * camera.zoom,
      -camera.x * dpr * camera.zoom,
      -camera.y * dpr * camera.zoom,
    );
  }

  function drawInfiniteBackground(context: CanvasRenderingContext2D) {
    const { width, height, dpr } = canvasSizeRef.current;
    const camera = viewportRef.current;
    context.setTransform(dpr, 0, 0, dpr, 0, 0);
    context.clearRect(0, 0, width, height);
    context.fillStyle = SKETCH_BACKGROUND_RENDERING.paperColor;
    context.fillRect(0, 0, width, height);
    if (page.background === "plain") return;
    configureInfiniteContext(context);
    const spacing = SKETCH_BACKGROUND_RENDERING.spacing;
    const minX = Math.floor(camera.x / spacing) * spacing;
    const minY = Math.floor(camera.y / spacing) * spacing;
    const maxX = camera.x + width / camera.zoom;
    const maxY = camera.y + height / camera.zoom;
    context.fillStyle = SKETCH_BACKGROUND_RENDERING.dotColor;
    context.strokeStyle = SKETCH_BACKGROUND_RENDERING.gridColor;
    context.lineWidth = SKETCH_BACKGROUND_RENDERING.gridLineWidth / camera.zoom;
    if (page.background === "dot") {
      for (let x = minX; x <= maxX; x += spacing) {
        for (let y = minY; y <= maxY; y += spacing) {
          context.beginPath();
          context.arc(x, y, SKETCH_BACKGROUND_RENDERING.dotRadius / camera.zoom, 0, Math.PI * 2);
          context.fill();
        }
      }
    } else {
      for (let x = minX; x <= maxX; x += spacing) {
        context.beginPath();
        context.moveTo(x, minY);
        context.lineTo(x, maxY);
        context.stroke();
      }
      for (let y = minY; y <= maxY; y += spacing) {
        context.beginPath();
        context.moveTo(minX, y);
        context.lineTo(maxX, y);
        context.stroke();
      }
    }
  }

  const renderBase = useCallback(() => {
    const canvas = baseCanvasRef.current;
    const context = canvas?.getContext("2d");
    if (!canvas || !context) return;
    const sourceObjects = previewObjects || page.objects;
    const renderedPage = {
      ...page,
      objects: textEditor?.id
        ? sourceObjects.filter((object) => object.id !== textEditor.id)
        : sourceObjects,
    };
    if (mode === "infinite") {
      drawInfiniteBackground(context);
      configureInfiniteContext(context);
      renderedPage.objects.forEach((object) => drawSketchObject(context, object));
      for (const id of ["select", "shape", "arrow"].includes(tool) ? selectedIds : []) {
        const object = renderedPage.objects.find((entry) => entry.id === id);
        if (!object) continue;
        const bounds = objectBounds(object);
        context.save();
        context.strokeStyle = "#2f6fa6";
        context.fillStyle = "#fffdfb";
        context.lineWidth = 2 / viewportRef.current.zoom;
        context.setLineDash([7 / viewportRef.current.zoom, 5 / viewportRef.current.zoom]);
        context.strokeRect(bounds.x - 6, bounds.y - 6, bounds.w + 12, bounds.h + 12);
        context.setLineDash([]);
        context.fillRect(bounds.x + bounds.w + 1, bounds.y + bounds.h + 1, 10, 10);
        context.strokeRect(bounds.x + bounds.w + 1, bounds.y + bounds.h + 1, 10, 10);
        context.restore();
      }
    } else {
      drawSketchPage(context, renderedPage, {
        selectedIds: ["select", "shape", "arrow"].includes(tool) ? selectedIds : [],
      });
    }
    context.save();
    if (mode === "infinite") configureInfiniteContext(context);
    context.strokeStyle = "#2f6fa6";
    context.lineWidth = mode === "infinite" ? 1.5 / viewportRef.current.zoom : 1.5;
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
  }, [alignmentGuides, mode, page, previewObjects, selectedIds, textEditor?.id, tool]);

  const renderLive = useCallback(() => {
    const canvas = canvasRef.current;
    const context = canvas?.getContext("2d");
    if (!canvas || !context) return;
    const { width, height, dpr } = canvasSizeRef.current;
    context.setTransform(dpr, 0, 0, dpr, 0, 0);
    context.clearRect(0, 0, width, height);
    if (mode === "infinite") configureInfiniteContext(context);
    const draftPoints = draftPointsRef.current;
    if (draftPoints.length) {
      if (tool === "shape") {
        drawSketchObject(context, shapeFromPoints(draftPoints, shapeKind, color, strokeWidth));
      } else if (tool === "lasso") {
        context.save();
        context.strokeStyle = "#2f6fa6";
        context.lineWidth = mode === "infinite" ? 2 / viewportRef.current.zoom : 2;
        context.setLineDash([8, 6]);
        context.beginPath();
        draftPoints.forEach((point, index) =>
          index ? context.lineTo(point.x, point.y) : context.moveTo(point.x, point.y),
        );
        context.stroke();
        context.restore();
      } else {
        drawSketchObject(context, {
          id: "draft",
          type: "stroke",
          tool: tool === "highlighter" ? "highlighter" : "pen",
          color,
          width: strokeWidth,
          points: draftPoints,
        });
      }
    }
    const inputAt = pendingInputAtRef.current;
    if (inputAt !== null) {
      pendingInputAtRef.current = null;
      const latency = performance.now() - inputAt;
      const samples = [...latencySamplesRef.current.slice(-119), latency];
      latencySamplesRef.current = samples;
      if (performance.now() - latencyUiAtRef.current >= 400) {
        const sorted = [...samples].sort((a, b) => a - b);
        setLatencyMetrics({
          latest: latency,
          p95: sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * 0.95))] || latency,
          samples: samples.length,
        });
        latencyUiAtRef.current = performance.now();
      }
    }
  }, [color, mode, shapeKind, strokeWidth, tool]);

  const scheduleRender = useCallback(() => {
    if (renderFrameRef.current !== null) return;
    renderFrameRef.current = window.requestAnimationFrame(() => {
      renderFrameRef.current = null;
      renderLive();
    });
  }, [renderLive]);

  useLayoutEffect(() => renderBase(), [renderBase]);
  useEffect(() => {
    viewportRef.current = normalizeSketchViewport(viewport, zoom);
    renderBase();
    renderLive();
  }, [renderBase, renderLive, viewport, zoom]);
  useEffect(() => {
    if (mode !== "infinite" || !stageRef.current) return;
    const stage = stageRef.current;
    const resize = () => {
      const rect = stage.getBoundingClientRect();
      const width = Math.max(1, Math.round(rect.width));
      const height = Math.max(1, Math.round(rect.height));
      const dpr = Math.max(1, window.devicePixelRatio || 1);
      canvasSizeRef.current = { width, height, dpr };
      for (const canvas of [baseCanvasRef.current, canvasRef.current]) {
        if (!canvas) continue;
        canvas.width = Math.round(width * dpr);
        canvas.height = Math.round(height * dpr);
      }
      renderBase();
      renderLive();
    };
    const observer = new ResizeObserver(resize);
    observer.observe(stage);
    resize();
    return () => observer.disconnect();
  }, [mode, renderBase, renderLive]);
  useEffect(
    () => () => {
      if (renderFrameRef.current !== null) window.cancelAnimationFrame(renderFrameRef.current);
    },
    [],
  );
  useEffect(
    () =>
      setSelectedIds((current) =>
        current.filter((id) => page.objects.some((object) => object.id === id)),
      ),
    [page.objects],
  );
  useLayoutEffect(() => {
    const scroll = scrollRef.current;
    const anchor = zoomAnchorRef.current;
    if (!scroll || !anchor) return;
    scroll.scrollLeft = anchor.left;
    scroll.scrollTop = anchor.top;
    zoomAnchorRef.current = null;
  }, [zoom]);

  const deleteSelection = useCallback(() => {
    onChange({
      ...page,
      objects: page.objects.filter((object) => !selectedIds.includes(object.id)),
    });
    setSelectedIds([]);
    canvasRef.current?.focus();
  }, [onChange, page, selectedIds]);

  const duplicateSelection = useCallback(() => {
    const copies = page.objects
      .filter((object) => selectedIds.includes(object.id))
      .map((object) => ({
        ...translateObject(structuredClone(object), 24, 24),
        id: crypto.randomUUID(),
      }));
    onChange({ ...page, objects: [...page.objects, ...copies] });
    setSelectedIds(copies.map((object) => object.id));
  }, [onChange, page, selectedIds]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target?.closest("input, textarea, select, [contenteditable='true']")) return;
      if (
        event.key === "Escape" &&
        (document.activeElement === canvasRef.current ||
          target?.closest(".sketch-selection-actions"))
      ) {
        setSelectedIds([]);
        setHoverIntent(null);
        canvasRef.current?.focus();
        return;
      }
      if (
        event.code === "Space" &&
        (pointerOverCanvasRef.current || document.activeElement === canvasRef.current)
      ) {
        event.preventDefault();
        if (!spacePressedRef.current) {
          spacePressedRef.current = true;
          setTemporaryPanReady(true);
        }
        return;
      }
      if ((event.key === "Delete" || event.key === "Backspace") && selectedIds.length) {
        event.preventDefault();
        deleteSelection();
      }
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "a") {
        event.preventDefault();
        setSelectedIds(page.objects.map((object) => object.id));
      }
      if (
        (event.ctrlKey || event.metaKey) &&
        event.key.toLowerCase() === "c" &&
        selectedIds.length
      ) {
        event.preventDefault();
        copiedObjectsRef.current = structuredClone(
          page.objects.filter((object) => selectedIds.includes(object.id)),
        );
        pasteGenerationRef.current = 0;
      }
      if (
        (event.ctrlKey || event.metaKey) &&
        event.key.toLowerCase() === "v" &&
        copiedObjectsRef.current.length
      ) {
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
      if (
        (event.ctrlKey || event.metaKey) &&
        event.key.toLowerCase() === "d" &&
        selectedIds.length
      ) {
        event.preventDefault();
        duplicateSelection();
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
  }, [deleteSelection, duplicateSelection, onChange, onRedo, onUndo, page, selectedIds]);

  function commitObjects(objects: SketchObject[]) {
    onChange({ ...page, objects });
  }

  function paintCommittedObject(object: SketchObject) {
    const context = baseCanvasRef.current?.getContext("2d");
    if (!context) return;
    if (mode === "infinite") configureInfiniteContext(context);
    else context.setTransform(1, 0, 0, 1, 0, 0);
    drawSketchObject(context, object);
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
    if (event.button !== 0 && event.button !== 1 && event.button !== 2) return;
    const point = pointerPoint(event, page, mode, viewportRef.current);
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
        viewport: viewportRef.current,
      };
      setPanning(true);
      return;
    }

    if (event.button === 2) {
      event.preventDefault();
      event.currentTarget.focus();
      event.currentTarget.setPointerCapture(event.pointerId);
      pointerModeRef.current = {
        kind: "erase",
        points: [point],
        originObjects: structuredClone(page.objects),
        width: temporaryEraserWidth,
      };
      setTemporaryErasing(true);
      setEraserPoint(point);
      setPreviewObjects(
        eraseSketchObjects(page.objects, [point], temporaryEraserWidth, eraserMode),
      );
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
      pointerModeRef.current = {
        kind: "erase",
        points: [point],
        originObjects: structuredClone(page.objects),
        width: strokeWidth,
      };
      setPreviewObjects(eraseSketchObjects(page.objects, [point], strokeWidth, eraserMode));
      return;
    }
    if (["select", "shape", "arrow"].includes(tool)) {
      const selectedBounds = selectionBounds(page, selectedIds);
      if (selectedIds.length === 1 && selectedBounds) {
        const handle = {
          x: selectedBounds.x + selectedBounds.w + 6,
          y: selectedBounds.y + selectedBounds.h + 6,
        };
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
      const hit = tool === "select" ? hitTest(page.objects, point) : selectedDrawingAt(point);
      if (!hit) {
        setSelectedIds([]);
        if (tool === "select") return;
      } else {
        const ids = event.shiftKey
          ? selectedIds.includes(hit.id)
            ? selectedIds.filter((id) => id !== hit.id)
            : [...selectedIds, hit.id]
          : selectedIds.includes(hit.id)
            ? selectedIds
            : [hit.id];
        setSelectedIds(ids);
        pointerModeRef.current = {
          kind: "move",
          start: point,
          ids,
          originObjects: structuredClone(page.objects),
        };
        return;
      }
    }
    if (["pen", "highlighter", "shape", "arrow", "lasso"].includes(tool)) {
      setSelectedIds([]);
      pointerModeRef.current = { kind: "draw", points: [point] };
      draftPointsRef.current = [point];
      scheduleRender();
    }
  }

  // Keep the active drawing adjustable; Escape releases it when drawing inside it.
  function selectedDrawingAt(point: SketchPoint) {
    return page.objects.find((object) => {
      if (!selectedIds.includes(object.id)) return false;
      const bounds = objectBounds(object);
      return (
        point.x >= bounds.x &&
        point.x <= bounds.x + bounds.w &&
        point.y >= bounds.y &&
        point.y <= bounds.y + bounds.h
      );
    });
  }

  function moveObjects(
    mode: Extract<NonNullable<PointerMode>, { kind: "move" }>,
    point: SketchPoint,
  ) {
    const snapped = snapObjectTranslation(
      mode.originObjects,
      mode.ids,
      point.x - mode.start.x,
      point.y - mode.start.y,
    );
    return {
      objects: mode.originObjects.map((object) =>
        mode.ids.includes(object.id) ? translateObject(object, snapped.dx, snapped.dy) : object,
      ),
      guides: snapped.guides,
      distance: Math.hypot(snapped.dx, snapped.dy),
    };
  }

  function resizeObjects(
    mode: Extract<NonNullable<PointerMode>, { kind: "resize" }>,
    point: SketchPoint,
  ) {
    const object = mode.originObjects.find((entry) => entry.id === mode.id);
    if (!object) return null;
    const nextBounds = {
      ...mode.bounds,
      w: Math.max(16, mode.bounds.w + point.x - mode.start.x),
      h: Math.max(16, mode.bounds.h + point.y - mode.start.y),
    };
    const snapped = snapObjectResize(nextBounds, mode.originObjects, mode.id);
    return {
      objects: mode.originObjects.map((entry) =>
        entry.id === object.id ? resizeObject(entry, snapped.bounds) : entry,
      ),
      guides: snapped.guides,
    };
  }

  function onPointerMove(event: ReactPointerEvent<HTMLCanvasElement>) {
    const point = pointerPoint(event, page, mode, viewportRef.current);
    lastPointerRef.current = point;
    const pointerMode = pointerModeRef.current;
    if (tool === "eraser" || pointerMode?.kind === "erase") setEraserPoint(point);
    if (pointerMode?.kind === "pan") {
      const scroll = scrollRef.current;
      if (!scroll) return;
      if (mode === "infinite") {
        viewportRef.current = panSketchViewport(
          pointerMode.viewport,
          event.clientX - pointerMode.clientX,
          event.clientY - pointerMode.clientY,
        );
        renderBase();
        renderLive();
      } else {
        scroll.scrollLeft = pointerMode.scrollLeft - (event.clientX - pointerMode.clientX);
        scroll.scrollTop = pointerMode.scrollTop - (event.clientY - pointerMode.clientY);
      }
      return;
    }
    if (pointerMode?.kind === "erase") {
      const points = [
        ...pointerMode.points,
        ...coalescedPointerPoints(event, page, mode, viewportRef.current),
      ];
      pointerModeRef.current = { ...pointerMode, points };
      setPreviewObjects(
        eraseSketchObjects(pointerMode.originObjects, points, pointerMode.width, eraserMode),
      );
      return;
    }
    if (pointerMode?.kind === "draw") {
      pointerMode.points.push(...coalescedPointerPoints(event, page, mode, viewportRef.current));
      draftPointsRef.current = pointerMode.points;
      pendingInputAtRef.current = performance.now();
      scheduleRender();
      return;
    }
    if (pointerMode?.kind === "move") {
      const preview = moveObjects(pointerMode, point);
      setPreviewObjects(preview.objects);
      setAlignmentGuides(preview.guides);
      return;
    }
    if (pointerMode?.kind === "resize") {
      const preview = resizeObjects(pointerMode, point);
      if (!preview) return;
      setPreviewObjects(preview.objects);
      setAlignmentGuides(preview.guides);
      return;
    }
    if (!pointerMode && ["select", "shape", "arrow"].includes(tool)) {
      const selectedBounds = selectionBounds(page, selectedIds);
      if (selectedIds.length === 1 && selectedBounds) {
        const handle = {
          x: selectedBounds.x + selectedBounds.w + 6,
          y: selectedBounds.y + selectedBounds.h + 6,
        };
        if (Math.hypot(point.x - handle.x, point.y - handle.y) <= 18) {
          setHoverIntent("resize");
          return;
        }
      }
      setHoverIntent(
        (tool === "select" ? hitTest(page.objects, point) : selectedDrawingAt(point))
          ? "move"
          : null,
      );
    }
  }

  function onPointerUp(event: ReactPointerEvent<HTMLCanvasElement>) {
    const point = pointerPoint(event, page, mode, viewportRef.current);
    const pointerMode = pointerModeRef.current;
    pointerModeRef.current = null;
    setPanning(false);
    draftPointsRef.current = [];
    setPreviewObjects(null);
    setAlignmentGuides({ vertical: [], horizontal: [] });
    setTemporaryErasing(false);
    scheduleRender();
    if (!pointerMode) return;
    if (pointerMode.kind === "pan") {
      if (mode === "infinite") onViewportChange(viewportRef.current);
      return;
    }
    if (pointerMode.kind === "erase") {
      const points = [
        ...pointerMode.points,
        ...coalescedPointerPoints(event, page, mode, viewportRef.current),
      ];
      const objects = eraseSketchObjects(
        pointerMode.originObjects,
        points,
        pointerMode.width,
        eraserMode,
      );
      const changed =
        objects.length !== pointerMode.originObjects.length ||
        objects.some((object, index) => object !== pointerMode.originObjects[index]);
      if (changed) commitObjects(objects);
      return;
    }

    if (pointerMode.kind === "text") {
      textCommitRef.current = false;
      setTextEditor({
        x: pointerMode.point.x,
        y: pointerMode.point.y + strokeWidth,
        value: "",
        color,
        fontSize: strokeWidth,
      });
      return;
    }
    if (pointerMode.kind === "move") {
      const result = moveObjects(pointerMode, point);
      if (result.distance > 1) commitObjects(result.objects);
      return;
    }
    if (pointerMode.kind === "resize") {
      if (Math.hypot(point.x - pointerMode.start.x, point.y - pointerMode.start.y) <= 1) return;
      const result = resizeObjects(pointerMode, point);
      if (result) commitObjects(result.objects);
      return;
    }

    const releasePoints = coalescedPointerPoints(event, page, mode, viewportRef.current);
    const points =
      pointerMode.points.length > 1
        ? [...pointerMode.points, ...releasePoints]
        : [...pointerMode.points, point];
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
      paintCommittedObject(object);
      commitObjects([...page.objects, object]);
      return;
    }
    if (tool === "shape") {
      const object = shapeFromPoints(points, shapeKind, color, strokeWidth, crypto.randomUUID());
      paintCommittedObject(object);
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
      paintCommittedObject(object);
      commitObjects([...page.objects, object]);
      setSelectedIds([object.id]);
    }
  }

  function onPointerCancel() {
    pointerModeRef.current = null;
    draftPointsRef.current = [];
    setPreviewObjects(null);
    setAlignmentGuides({ vertical: [], horizontal: [] });
    setPanning(false);
    setTemporaryErasing(false);
    scheduleRender();
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
      commitObjects(
        editor.id
          ? page.objects.map((entry) => (entry.id === editor.id ? object : entry))
          : [...page.objects, object],
      );
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
      if (mode === "infinite") {
        const nextViewport = anchoredSketchViewportZoom(
          viewportRef.current,
          nextZoom,
          pointerX,
          pointerY,
        );
        viewportRef.current = nextViewport;
        renderBase();
        renderLive();
        onViewportChange(nextViewport);
        return;
      }
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
    const hit = hitTest(page.objects, pointerPoint(event, page, mode, viewportRef.current));
    if (hit?.type !== "text") return;
    setSelectedIds([hit.id]);
    startTextEditing(hit);
  }

  const selectedBounds = selectionBounds(page, selectedIds);
  const selectedText =
    selectedIds.length === 1
      ? page.objects.find(
          (object): object is Extract<SketchObject, { type: "text" }> =>
            object.id === selectedIds[0] && object.type === "text",
        )
      : undefined;
  const screenPoint = (x: number, y: number) =>
    mode === "infinite"
      ? sketchWorldToScreen(viewportRef.current, x, y)
      : { x: x * zoom, y: y * zoom };
  const eraserScreen = eraserPoint ? screenPoint(eraserPoint.x, eraserPoint.y) : null;
  const selectionScreen = selectedBounds ? screenPoint(selectedBounds.x, selectedBounds.y) : null;
  const textScreen = textEditor
    ? screenPoint(textEditor.x, textEditor.y - textEditor.fontSize)
    : null;

  return (
    <div className={`sketch-canvas-scroll is-${mode}`} ref={scrollRef} onWheel={onWheel}>
      <div
        ref={stageRef}
        className="sketch-canvas-stage"
        style={
          mode === "infinite"
            ? { width: "100%", height: "100%" }
            : { width: `${page.width * zoom}px`, height: `${page.height * zoom}px` }
        }
      >
        <canvas
          ref={baseCanvasRef}
          className="sketch-canvas-base"
          width={mode === "page" ? page.width : 1}
          height={mode === "page" ? page.height : 1}
          aria-hidden="true"
        />
        <canvas
          ref={canvasRef}
          className={`sketch-canvas sketch-canvas-interaction is-${tool}${temporaryPanReady ? " is-temporary-pan" : ""}${panning ? " is-panning" : ""}${temporaryErasing ? " is-temporary-erasing" : ""}${hoverIntent ? ` has-${hoverIntent}-target` : ""}`}
          width={mode === "page" ? page.width : 1}
          height={mode === "page" ? page.height : 1}
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
          onContextMenu={(event) => event.preventDefault()}
          onPaste={onPaste}
          aria-label="Sketchキャンバス"
        />
        {(tool === "eraser" || temporaryErasing) && eraserPoint && eraserScreen && (
          <span
            className="sketch-eraser-preview"
            style={{
              left: `${eraserScreen.x}px`,
              top: `${eraserScreen.y}px`,
              width: `${(temporaryErasing ? temporaryEraserWidth : strokeWidth) * zoom}px`,
              height: `${(temporaryErasing ? temporaryEraserWidth : strokeWidth) * zoom}px`,
            }}
            aria-hidden="true"
          />
        )}
        {["select", "shape", "arrow"].includes(tool) &&
          selectedBounds &&
          selectionScreen &&
          selectedIds.length > 0 &&
          !textEditor && (
            <div
              className="sketch-selection-actions"
              style={{
                left: `${Math.max(4, selectionScreen.x)}px`,
                top: `${Math.max(4, selectionScreen.y - 42)}px`,
              }}
              role="toolbar"
              aria-label="選択オブジェクトの操作"
            >
              <button onClick={duplicateSelection} title="複製（Ctrl+D）" aria-label="複製">
                <IconCopy size={16} />
              </button>
              {selectedText && (
                <button
                  onClick={() => startTextEditing(selectedText)}
                  title="テキストを編集"
                  aria-label="テキストを編集"
                >
                  <IconEdit size={16} />
                </button>
              )}
              <button
                onClick={() =>
                  commitObjects(moveSketchObjectsToLayer(page.objects, selectedIds, "front"))
                }
                title="最前面へ"
                aria-label="最前面へ"
              >
                <IconStackFront size={16} />
              </button>
              <button
                onClick={() =>
                  commitObjects(moveSketchObjectsToLayer(page.objects, selectedIds, "back"))
                }
                title="最背面へ"
                aria-label="最背面へ"
              >
                <IconStackBack size={16} />
              </button>
              <button
                className="is-danger"
                onClick={deleteSelection}
                title="削除（Delete）"
                aria-label="削除"
              >
                <IconTrash size={16} />
              </button>
            </div>
          )}
        {textEditor && textScreen && (
          <textarea
            className="sketch-inline-text"
            style={{
              left: `${textScreen.x}px`,
              top: `${textScreen.y}px`,
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
        {tool === "shape" || tool === "arrow" ? (
          <div className="sketch-input-latency">
            {selectedIds.length
              ? "ドラッグで移動 · 右下でサイズ変更 · Escで選択解除"
              : "ドラッグで図形を描く"}
          </div>
        ) : (
          <output className="sketch-input-latency" aria-label="描画入力遅延">
            Input {latencyMetrics.latest.toFixed(1)}ms · P95 {latencyMetrics.p95.toFixed(1)}ms
          </output>
        )}
      </div>
    </div>
  );
}
