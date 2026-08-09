import type { SketchPageSize } from "../lib/sketch";
import { SKETCH_PAGE_PRESETS, SKETCH_PAGE_SIZE_LIMITS } from "../lib/sketch";

export type SketchPageSizePreset = "landscape" | "portrait" | "square" | "custom";

export interface SketchPageSizeValue {
  preset: SketchPageSizePreset;
  width: string;
  height: string;
}

const PRESET_OPTIONS: Array<{ id: Exclude<SketchPageSizePreset, "custom">; label: string }> = [
  { id: "landscape", label: "横" },
  { id: "portrait", label: "縦" },
  { id: "square", label: "正方形" },
];

export function sketchPageSizeValue(size: SketchPageSize = SKETCH_PAGE_PRESETS.landscape): SketchPageSizeValue {
  const preset = PRESET_OPTIONS.find((option) => {
    const candidate = SKETCH_PAGE_PRESETS[option.id];
    return candidate.width === size.width && candidate.height === size.height;
  })?.id || "custom";
  return { preset, width: String(size.width), height: String(size.height) };
}

export function resolveSketchPageSize(value: SketchPageSizeValue): SketchPageSize | null {
  const width = Number(value.width);
  const height = Number(value.height);
  if (!Number.isInteger(width) || !Number.isInteger(height)) return null;
  if (
    width < SKETCH_PAGE_SIZE_LIMITS.min
    || width > SKETCH_PAGE_SIZE_LIMITS.max
    || height < SKETCH_PAGE_SIZE_LIMITS.min
    || height > SKETCH_PAGE_SIZE_LIMITS.max
  ) return null;
  return { width, height };
}

export function sketchPageSizeLabel(size: SketchPageSize): string {
  const value = sketchPageSizeValue(size);
  return value.preset === "landscape"
    ? "横"
    : value.preset === "portrait"
      ? "縦"
      : value.preset === "square"
        ? "正方形"
        : "カスタム";
}

interface SketchPageSizePickerProps {
  value: SketchPageSizeValue;
  onChange(value: SketchPageSizeValue): void;
}

export function SketchPageSizePicker({ value, onChange }: SketchPageSizePickerProps) {
  const valid = resolveSketchPageSize(value) !== null;

  return (
    <div className="sketch-page-size-picker">
      <div className="sketch-page-size-presets" role="radiogroup" aria-label="用紙の向き">
        {PRESET_OPTIONS.map((option) => {
          const size = SKETCH_PAGE_PRESETS[option.id];
          return (
            <button
              key={option.id}
              type="button"
              role="radio"
              aria-checked={value.preset === option.id}
              className={value.preset === option.id ? "is-active" : ""}
              onClick={() => onChange({
                preset: option.id,
                width: String(size.width),
                height: String(size.height),
              })}
            >
              <span className={`sketch-paper-sample is-${option.id}`} aria-hidden="true" />
              <span>{option.label}</span>
            </button>
          );
        })}
        <button
          type="button"
          role="radio"
          aria-checked={value.preset === "custom"}
          className={value.preset === "custom" ? "is-active" : ""}
          onClick={() => onChange({ ...value, preset: "custom" })}
        >
          <span className="sketch-paper-sample is-custom" aria-hidden="true">↔</span>
          <span>指定</span>
        </button>
      </div>

      {value.preset === "custom" && (
        <div className="sketch-page-size-fields">
          <label>
            <span>幅</span>
            <input
              type="number"
              min={SKETCH_PAGE_SIZE_LIMITS.min}
              max={SKETCH_PAGE_SIZE_LIMITS.max}
              step="10"
              value={value.width}
              aria-invalid={!valid}
              onChange={(event) => onChange({ ...value, width: event.target.value })}
            />
          </label>
          <span aria-hidden="true">×</span>
          <label>
            <span>高さ</span>
            <input
              type="number"
              min={SKETCH_PAGE_SIZE_LIMITS.min}
              max={SKETCH_PAGE_SIZE_LIMITS.max}
              step="10"
              value={value.height}
              aria-invalid={!valid}
              onChange={(event) => onChange({ ...value, height: event.target.value })}
            />
          </label>
          <span className="sketch-page-size-unit">px</span>
        </div>
      )}

      {!valid && (
        <p className="field-error" role="alert">
          幅と高さは{SKETCH_PAGE_SIZE_LIMITS.min}〜{SKETCH_PAGE_SIZE_LIMITS.max}pxで指定してください。
        </p>
      )}
    </div>
  );
}
