import type { SketchTool } from "./sketch";

export type SketchPresetTool = Extract<SketchTool, "pen" | "highlighter" | "eraser" | "shape" | "arrow" | "text">;

export interface SketchToolPreset {
  color: string;
  width: number;
}

export type SketchToolPresets = Record<SketchPresetTool, SketchToolPreset>;

export const DEFAULT_SKETCH_TOOL_PRESETS: SketchToolPresets = {
  pen: { color: "#211e1d", width: 2 },
  highlighter: { color: "#2f6fa6", width: 20 },
  eraser: { color: "#211e1d", width: 28 },
  shape: { color: "#211e1d", width: 2 },
  arrow: { color: "#8a2f3b", width: 2 },
  text: { color: "#211e1d", width: 24 },
};

export const SKETCH_TOOL_WIDTHS: Record<SketchPresetTool, number[]> = {
  pen: [1, 2, 4, 7],
  highlighter: [12, 20, 32, 48],
  eraser: [16, 28, 44, 64],
  shape: [1, 2, 4, 7],
  arrow: [1, 2, 4, 7],
  text: [18, 24, 32, 44],
};

export function isSketchPresetTool(tool: SketchTool): tool is SketchPresetTool {
  return tool in DEFAULT_SKETCH_TOOL_PRESETS;
}

export function normalizeSketchToolPresets(value: unknown): SketchToolPresets {
  const input = value && typeof value === "object" ? value as Partial<Record<SketchPresetTool, Partial<SketchToolPreset>>> : {};
  return Object.fromEntries(
    (Object.keys(DEFAULT_SKETCH_TOOL_PRESETS) as SketchPresetTool[]).map((tool) => {
      const fallback = DEFAULT_SKETCH_TOOL_PRESETS[tool];
      const candidate = input[tool];
      const color = typeof candidate?.color === "string" && /^#[0-9a-f]{6}$/i.test(candidate.color)
        ? candidate.color
        : fallback.color;
      const width = typeof candidate?.width === "number" && SKETCH_TOOL_WIDTHS[tool].includes(candidate.width)
        ? candidate.width
        : fallback.width;
      return [tool, { color, width }];
    }),
  ) as SketchToolPresets;
}
