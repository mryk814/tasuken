import { useEffect, useRef, useState, type CSSProperties, type PointerEvent, type SyntheticEvent } from "react";

import { createTrimPlan } from "../../../../../shared/screenRecordingEdit.mjs";
import { workspaceApi } from "../../../services/workspaceApi";
import type { Artifact } from "../types";
import { Button } from "./common";

const DEFAULT_STEP_MS = 100;
const MIN_TRIM_GAP_MS = 100;
const TRIM_SELECTION_STORAGE_PREFIX = "tasken:video-trim:";

interface TrimSelection {
  startMs: number;
  endMs: number;
}

function trimSelectionStorageKey(artifactId: string): string {
  return `${TRIM_SELECTION_STORAGE_PREFIX}${artifactId}`;
}

function readTrimSelection(artifactId: string): TrimSelection | null {
  if (!artifactId) return null;
  try {
    const raw = localStorage.getItem(trimSelectionStorageKey(artifactId));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const startMs = Number(parsed.startMs);
    const endMs = Number(parsed.endMs);
    if (!Number.isSafeInteger(startMs) || !Number.isSafeInteger(endMs)) return null;
    return { startMs, endMs };
  } catch {
    // 壊れた一時UI設定は無視して、動画全体を初期範囲にする。
    return null;
  }
}

function resolveTrimSelection(artifactId: string, durationMs: number): TrimSelection {
  const duration = Math.max(0, durationMs);
  const saved = readTrimSelection(artifactId);
  if (!saved || duration <= 0) return { startMs: 0, endMs: duration };
  const gap = Math.min(MIN_TRIM_GAP_MS, Math.max(1, duration));
  const startMs = Math.min(Math.max(0, saved.startMs), Math.max(0, duration - gap));
  const endMs = Math.max(startMs + gap, Math.min(duration, saved.endMs));
  return { startMs, endMs };
}

function formatTrimTime(valueMs: number): string {
  const totalSeconds = Math.max(0, valueMs) / 1000;
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor(totalSeconds / 60) % 60;
  const seconds = (totalSeconds % 60).toFixed(1).padStart(4, "0");
  return hours > 0
    ? `${hours}:${String(minutes).padStart(2, "0")}:${seconds.padStart(4, "0")}`
    : `${minutes}:${seconds}`;
}

function initialDurationMs(artifact: Artifact): number {
  return typeof artifact.duration_ms === "number" && Number.isSafeInteger(artifact.duration_ms)
    ? Math.max(0, artifact.duration_ms)
    : 0;
}

export function VideoTrimEditor({
  artifact,
  src,
  editable,
  setToast,
  onError,
}: {
  artifact: Artifact;
  src: string;
  editable: boolean;
  setToast: (message: string, tone?: "info" | "success" | "warning" | "danger") => void;
  onError: () => void;
}) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const initialSelection = resolveTrimSelection(artifact.id, initialDurationMs(artifact));
  const artifactSelectionKey = `${artifact.id}:${initialDurationMs(artifact)}`;
  const [durationMs, setDurationMs] = useState(() => initialDurationMs(artifact));
  const [currentMs, setCurrentMs] = useState(0);
  const [startMs, setStartMs] = useState(() => initialSelection.startMs);
  const [endMs, setEndMs] = useState(() => initialSelection.endMs);
  const [selectionReadyKey, setSelectionReadyKey] = useState(artifactSelectionKey);
  const [saveState, setSaveState] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const playbackSelectionRef = useRef({
    durationMs: initialDurationMs(artifact),
    startMs: 0,
    endMs: initialDurationMs(artifact),
  });

  useEffect(() => {
    const nextDuration = initialDurationMs(artifact);
    const nextSelection = resolveTrimSelection(artifact.id, nextDuration);
    setDurationMs(nextDuration);
    setCurrentMs(0);
    setStartMs(nextSelection.startMs);
    setEndMs(nextSelection.endMs);
    setSaveState("idle");
    setSelectionReadyKey(artifactSelectionKey);
  }, [artifact.id, artifact.duration_ms, artifactSelectionKey]);

  useEffect(() => {
    if (selectionReadyKey !== artifactSelectionKey || !artifact.id || durationMs <= 0) return;
    try {
      localStorage.setItem(trimSelectionStorageKey(artifact.id), JSON.stringify({ startMs, endMs }));
    } catch {
      // トリム位置の記憶に失敗しても、動画の再生・書き出し自体は継続する。
    }
  }, [artifact.id, artifactSelectionKey, durationMs, endMs, selectionReadyKey, startMs]);

  const trimGapMs = Math.min(MIN_TRIM_GAP_MS, Math.max(1, durationMs));
  const stepMs = durationMs > 0 && durationMs < DEFAULT_STEP_MS ? 1 : DEFAULT_STEP_MS;
  const maxStartMs = Math.max(0, durationMs - trimGapMs);
  const selectedDurationMs = Math.max(0, endMs - startMs);
  const isTrimmed = durationMs > 0 && (startMs > 0 || endMs < durationMs);
  const canSave = editable && isTrimmed && saveState !== "saving" && durationMs > 0;
  const startPercent = durationMs > 0 ? (startMs / durationMs) * 100 : 0;
  const endPercent = durationMs > 0 ? (endMs / durationMs) * 100 : 100;
  const playheadPercent = durationMs > 0 ? Math.min(100, Math.max(0, (currentMs / durationMs) * 100)) : 0;
  const timelineStyle = {
    "--trim-start": `${startPercent}%`,
    "--trim-end": `${endPercent}%`,
    "--trim-playhead": `${playheadPercent}%`,
  } as CSSProperties;
  playbackSelectionRef.current = { durationMs, startMs, endMs };

  function seekTo(valueMs: number) {
    const next = Math.min(durationMs, Math.max(0, valueMs));
    if (videoRef.current) videoRef.current.currentTime = next / 1000;
    setCurrentMs(next);
  }

  function keepPlaybackInSelection(video: HTMLVideoElement, loopAtEnd: boolean): number {
    const selection = playbackSelectionRef.current;
    const rawCurrent = Math.round(video.currentTime * 1000);
    const current = Number.isSafeInteger(rawCurrent) ? rawCurrent : selection.startMs;
    const selectionIsTrimmed = selection.durationMs > 0 && (selection.startMs > 0 || selection.endMs < selection.durationMs);
    if (!selectionIsTrimmed) return current;
    const next = current < selection.startMs
      ? selection.startMs
      : current >= selection.endMs
        ? loopAtEnd ? selection.startMs : selection.endMs
        : current;
    if (next !== current) video.currentTime = next / 1000;
    return next;
  }

  function updateStart(value: number) {
    const next = Math.min(maxStartMs, Math.max(0, value));
    setStartMs(next);
    setSaveState("idle");
    seekTo(next);
  }

  function updateEnd(value: number) {
    const next = Math.max(startMs + trimGapMs, Math.min(durationMs, value));
    setEndMs(next);
    setSaveState("idle");
    seekTo(next);
  }

  function seekFromTrack(event: PointerEvent<HTMLDivElement>) {
    if ((event.target as HTMLElement | null)?.closest("input")) return;
    const rect = event.currentTarget.getBoundingClientRect();
    if (!rect.width || !durationMs) return;
    const ratio = Math.min(1, Math.max(0, (event.clientX - rect.left) / rect.width));
    const raw = Math.round((ratio * durationMs) / stepMs) * stepMs;
    seekTo(isTrimmed ? Math.min(endMs, Math.max(startMs, raw)) : raw);
  }

  function handlePlay(event: SyntheticEvent<HTMLVideoElement>) {
    keepPlaybackInSelection(event.currentTarget, true);
  }

  function handleSeeking(event: SyntheticEvent<HTMLVideoElement>) {
    const next = keepPlaybackInSelection(event.currentTarget, false);
    setCurrentMs(next);
  }

  function handleTimeUpdate(event: SyntheticEvent<HTMLVideoElement>) {
    const next = keepPlaybackInSelection(event.currentTarget, !event.currentTarget.paused);
    setCurrentMs(next);
  }

  function handleEnded(event: SyntheticEvent<HTMLVideoElement>) {
    const selection = playbackSelectionRef.current;
    const selectionIsTrimmed = selection.durationMs > 0 && (selection.startMs > 0 || selection.endMs < selection.durationMs);
    if (!selectionIsTrimmed) return;
    event.currentTarget.currentTime = selection.startMs / 1000;
    void event.currentTarget.play().catch(() => {
      // 再生終了後の自動再開がOS側で拒否された場合も、native controlsから再生できる。
    });
  }

  function handleLoadedMetadata(event: SyntheticEvent<HTMLVideoElement>) {
    const nextDuration = Math.round(event.currentTarget.duration * 1000);
    if (!Number.isSafeInteger(nextDuration) || nextDuration <= 0) return;
    const nextSelection = resolveTrimSelection(artifact.id, nextDuration);
    setDurationMs(nextDuration);
    setStartMs(nextSelection.startMs);
    setEndMs(nextSelection.endMs);
  }

  function resetTrim() {
    setStartMs(0);
    setEndMs(durationMs);
    setSaveState("idle");
    seekTo(0);
  }

  async function saveTrim() {
    if (!canSave) return;
    setSaveState("saving");
    try {
      const source = await workspaceApi.getVideoTrimSource(artifact.id);
      const trimPlan = createTrimPlan({ source, startMs, endMs });
      await workspaceApi.exportVideoTrim({
        operationId: crypto.randomUUID(),
        destinationArtifactId: crypto.randomUUID(),
        trimPlan,
      });
      setSaveState("saved");
      setToast("トリム版を保存しました。元動画は変更していません。", "success");
    } catch (error) {
      setSaveState("error");
      setToast(`トリム版を保存できませんでした。${error instanceof Error ? error.message : String(error)}`, "danger");
    }
  }

  return (
    <div className="video-trim-editor">
      <video
        ref={videoRef}
        controls
        preload="metadata"
        src={src}
        aria-label={`${artifact.filename}の動画プレーヤー`}
        onLoadedMetadata={handleLoadedMetadata}
        onPlay={handlePlay}
        onSeeking={handleSeeking}
        onTimeUpdate={handleTimeUpdate}
        onEnded={handleEnded}
        onError={onError}
      />
      {editable && (
        <div className="video-trim-controls" aria-label="動画のトリム範囲">
          <div
            className="video-trim-track"
            style={timelineStyle}
            role="group"
            aria-label={`トリム範囲 ${formatTrimTime(startMs)} から ${formatTrimTime(endMs)}`}
            onPointerDown={seekFromTrack}
          >
            <div className="video-trim-selection" aria-hidden="true" />
            <div className="video-trim-playhead" aria-hidden="true" />
            <input
              className="video-trim-input video-trim-input-start"
              type="range"
              min={0}
              max={maxStartMs}
              step={stepMs}
              value={Math.min(startMs, maxStartMs)}
              aria-label="トリム開始"
              aria-valuetext={formatTrimTime(startMs)}
              onChange={(event) => updateStart(Number(event.target.value))}
            />
            <input
              className="video-trim-input video-trim-input-end"
              type="range"
              min={trimGapMs}
              max={Math.max(trimGapMs, durationMs)}
              step={stepMs}
              value={Math.max(trimGapMs, endMs)}
              aria-label="トリム終了"
              aria-valuetext={formatTrimTime(endMs)}
              onChange={(event) => updateEnd(Number(event.target.value))}
            />
          </div>
          <div className="video-trim-axis" aria-hidden="true">
            <span>0:00.0</span>
            <span>{formatTrimTime(durationMs)}</span>
          </div>
          <div className="video-trim-summary">
            <div className="video-trim-times" aria-live="polite">
              <span>開始 <strong>{formatTrimTime(startMs)}</strong></span>
              <span>終了 <strong>{formatTrimTime(endMs)}</strong></span>
              <span>選択 <strong>{formatTrimTime(selectedDurationMs)}</strong></span>
              {isTrimmed && <span className="video-trim-loop-status">範囲内をループ再生</span>}
            </div>
            <div className="inline-actions">
              <Button variant="secondary" compact disabled={!isTrimmed || saveState === "saving"} onClick={resetTrim}>全体に戻す</Button>
              <Button variant="primary" compact disabled={!canSave} onClick={() => { void saveTrim(); }}>
                {saveState === "saving" ? "保存中…" : "トリム版を保存"}
              </Button>
            </div>
          </div>
          {saveState !== "idle" && (
            <small className="video-trim-hint">
              {saveState === "saved"
                ? "保存済み。元動画は変更されていません。"
                : saveState === "error"
                  ? "保存に失敗しました。範囲を確認して再試行してください。"
                  : "保存しています…"}
            </small>
          )}
        </div>
      )}
    </div>
  );
}
