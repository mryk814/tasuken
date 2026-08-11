import { useCallback, useEffect, useRef, useState } from "react";

import { workspaceApi } from "../../../services/workspaceApi";
import type { ToastTone } from "../../../stores/uiStore";
import { Button } from "./common";
import { formatArtifactFileSize } from "./artifacts";
import type { ScreenRecordingOwnerOption } from "./ScreenRecorderPanel";
import type { AudioCapturePrepared, VideoImportPrepared } from "../../../../../shared/mediaCapture";
import { createTrimPlan } from "../../../../../shared/screenRecordingEdit.mjs";

/**
 * 音声と画面録画の「保存待ち」を1つの表にまとめる（#383）。
 * 両者は録る→保存待ち→Artifact確定という同じ経路を通るので、
 * 別々の表に分けると復旧導線が二重になる。
 */
interface PendingRecordingsPanelProps {
  owners: ScreenRecordingOwnerOption[];
  /** 録音・録画側が状態を変えたときに増える。表の再読込に使う。 */
  refreshToken: number;
  setToast: (message: string, tone?: ToastTone) => void;
}

type PendingKind = "audio" | "video";

interface PendingRow {
  kind: PendingKind;
  entry: AudioCapturePrepared | VideoImportPrepared;
}

interface VideoEditState {
  durationMs: number;
  widthPx: number;
  heightPx: number;
  startMs: number;
  endMs: number;
}

const KIND_LABELS: Record<PendingKind, string> = {
  audio: "音声",
  video: "画面録画",
};

function audioDurationMs(mediaUrl: string): Promise<number> {
  return new Promise((resolve, reject) => {
    const audio = new Audio();
    const cleanup = () => {
      window.clearTimeout(timer);
      audio.removeAttribute("src");
      audio.load();
    };
    const timer = window.setTimeout(() => {
      cleanup();
      reject(new Error("音声の長さを取得できませんでした。対応形式を確認してください。"));
    }, 15_000);
    audio.preload = "metadata";
    audio.onloadedmetadata = () => {
      const duration = Math.round(audio.duration * 1000);
      cleanup();
      if (!Number.isFinite(duration) || duration < 0) reject(new Error("音声の長さを取得できませんでした。対応形式を確認してください。"));
      else resolve(duration);
    };
    audio.onerror = () => {
      cleanup();
      reject(new Error("音声を読み込めませんでした。対応形式を確認してください。"));
    };
    audio.src = mediaUrl;
  });
}

function readVideoMetadata(mediaUrl: string): Promise<{ durationMs: number; widthPx: number; heightPx: number }> {
  return new Promise((resolve, reject) => {
    const video = document.createElement("video");
    const cleanup = () => {
      window.clearTimeout(timer);
      video.onloadedmetadata = null;
      video.onseeked = null;
      video.onerror = null;
      video.removeAttribute("src");
      video.load();
    };
    const timer = window.setTimeout(() => {
      cleanup();
      reject(new Error("動画metadataの読み込みが時間内に完了しませんでした。"));
    }, 10_000);
    const resolveMetadata = () => {
      const durationMs = Math.round(video.duration * 1000);
      const widthPx = video.videoWidth;
      const heightPx = video.videoHeight;
      if (!Number.isSafeInteger(durationMs) || durationMs < 0 || !widthPx || !heightPx) return false;
      cleanup();
      resolve({ durationMs, widthPx, heightPx });
      return true;
    };
    video.preload = "metadata";
    video.onloadedmetadata = () => {
      if (resolveMetadata()) return;
      video.onseeked = () => {
        if (!resolveMetadata()) {
          cleanup();
          reject(new Error("動画metadataを確認できませんでした。"));
        }
      };
      video.currentTime = 7 * 24 * 60 * 60;
    };
    video.onerror = () => {
      cleanup();
      reject(new Error("録画動画を再生できません。内容を確認して破棄してください。"));
    };
    video.src = mediaUrl;
  });
}

function formatTrimTime(valueMs: number): string {
  const seconds = Math.max(0, valueMs) / 1000;
  const minutes = Math.floor(seconds / 60);
  return `${minutes}:${(seconds % 60).toFixed(1).padStart(4, "0")}`;
}

function PendingVideoPreview({ entry, edit, onEdit }: {
  entry: VideoImportPrepared;
  edit?: VideoEditState;
  onEdit: (value: VideoEditState) => void;
}) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const updateBoundary = (field: "startMs" | "endMs", value: number) => {
    if (!edit) return;
    const next = field === "startMs"
      ? { ...edit, startMs: Math.min(Math.max(0, value), edit.endMs - 100) }
      : { ...edit, endMs: Math.max(edit.startMs + 100, Math.min(edit.durationMs, value)) };
    onEdit(next);
    if (videoRef.current) videoRef.current.currentTime = next[field] / 1000;
  };
  return (
    <div className="screen-recording-trim-preview">
      <video
        ref={videoRef}
        controls
        preload="metadata"
        src={entry.mediaUrl}
        aria-label={`${entry.filename}の保存前プレビュー`}
        onLoadedMetadata={(event) => {
          const video = event.currentTarget;
          const durationMs = Math.round(video.duration * 1000);
          if (!Number.isSafeInteger(durationMs) || durationMs <= 0 || !video.videoWidth || !video.videoHeight) return;
          onEdit({
            durationMs,
            widthPx: video.videoWidth,
            heightPx: video.videoHeight,
            startMs: edit ? Math.min(edit.startMs, durationMs - 100) : 0,
            endMs: edit ? Math.min(edit.endMs, durationMs) : durationMs,
          });
        }}
      />
      {edit && (
        <div className="screen-recording-trim" aria-label="trim範囲">
          <div className="screen-recording-trim-range">
            <label><span>開始 {formatTrimTime(edit.startMs)}</span><input type="range" min={0} max={Math.max(100, edit.durationMs - 100)} step={100} value={edit.startMs} onChange={(event) => updateBoundary("startMs", Number(event.target.value))} /></label>
            <label><span>終了 {formatTrimTime(edit.endMs)}</span><input type="range" min={100} max={edit.durationMs} step={100} value={edit.endMs} onChange={(event) => updateBoundary("endMs", Number(event.target.value))} /></label>
          </div>
          <div className="inline-actions">
            <button type="button" className="text-button compact" onClick={() => updateBoundary("startMs", edit.startMs - 100)}>開始 −0.1s</button>
            <button type="button" className="text-button compact" onClick={() => updateBoundary("startMs", edit.startMs + 100)}>開始 +0.1s</button>
            <button type="button" className="text-button compact" onClick={() => updateBoundary("endMs", edit.endMs - 100)}>終了 −0.1s</button>
            <button type="button" className="text-button compact" onClick={() => updateBoundary("endMs", edit.endMs + 100)}>終了 +0.1s</button>
            <button type="button" className="text-button compact" onClick={() => onEdit({ ...edit, startMs: 0, endMs: edit.durationMs })}>リセット</button>
          </div>
        </div>
      )}
    </div>
  );
}

export function PendingRecordingsPanel({ owners, refreshToken, setToast }: PendingRecordingsPanelProps) {
  const [rows, setRows] = useState<PendingRow[]>([]);
  const [loadState, setLoadState] = useState<"loading" | "ready" | "error">("loading");
  const [busySessionId, setBusySessionId] = useState<string | null>(null);
  /** 画面録画の紐づけ先。未選択はInbox（CaptureEntry）行き。 */
  const [ownerKeys, setOwnerKeys] = useState<Record<string, string>>({});
  const [videoEdits, setVideoEdits] = useState<Record<string, VideoEditState>>({});

  const refresh = useCallback(async () => {
    setLoadState("loading");
    try {
      const [audio, video] = await Promise.all([
        workspaceApi.listPreparedAudioCaptures(),
        workspaceApi.listPreparedVideoImports(),
      ]);
      setRows([
        ...audio.map((entry) => ({ kind: "audio" as const, entry })),
        ...video.filter((entry) => entry.filename.startsWith("screen-recording-")).map((entry) => ({ kind: "video" as const, entry })),
      ]);
      setLoadState("ready");
    } catch (error) {
      setLoadState("error");
      setToast(`保存待ちを確認できませんでした。${error instanceof Error ? error.message : String(error)}`, "warning");
    }
  }, [setToast]);

  useEffect(() => {
    void refresh();
  }, [refresh, refreshToken]);

  function drop(sessionId: string) {
    setRows((current) => current.filter((row) => row.entry.sessionId !== sessionId));
  }

  async function commit(row: PendingRow) {
    const entry = row.entry;
    if (!entry.canCommit || entry.status !== "ready" || !entry.mediaUrl) {
      setToast("この収録は安全に読み込めないため保存できません。内容を確認して破棄してください。", "warning");
      return;
    }
    setBusySessionId(entry.sessionId);
    let originalSaved = false;
    try {
      if (row.kind === "audio") {
        const durationMs = entry.durationMs ?? await audioDurationMs(entry.mediaUrl);
        await workspaceApi.commitAudioCapture({ sessionId: entry.sessionId, durationMs });
        setToast(`音声「${entry.filename}」をInboxへ保存しました。`, "success");
      } else {
        const existingEdit = videoEdits[entry.sessionId];
        let metadata: VideoEditState;
        if (existingEdit) {
          metadata = existingEdit;
        } else {
          const loaded = await readVideoMetadata(entry.mediaUrl);
          metadata = { ...loaded, startMs: 0, endMs: loaded.durationMs };
        }
        const owner = owners.find((candidate) => candidate.key === (ownerKeys[entry.sessionId] || "")) || null;
        const committed = await workspaceApi.commitVideoImport({
          sessionId: entry.sessionId,
          durationMs: metadata.durationMs,
          widthPx: metadata.widthPx,
          heightPx: metadata.heightPx,
          sourceType: owner ? owner.sourceType : null,
          sourceId: owner ? owner.sourceId : null,
        });
        originalSaved = true;
        const trimmed = metadata.startMs > 0 || metadata.endMs < metadata.durationMs;
        if (trimmed) {
          const source = await workspaceApi.getVideoTrimSource(committed.artifactId);
          await workspaceApi.exportVideoTrim({
            operationId: crypto.randomUUID(),
            destinationArtifactId: crypto.randomUUID(),
            trimPlan: createTrimPlan({ source, startMs: metadata.startMs, endMs: metadata.endMs }),
          });
        }
        setToast(trimmed
          ? `画面録画「${entry.filename}」の原本とtrim版を保存しました。`
          : owner
            ? `画面録画「${entry.filename}」を${owner.label}へ保存しました。`
            : `画面録画「${entry.filename}」をInboxへ保存しました。`, "success");
      }
      drop(entry.sessionId);
    } catch (error) {
      if (originalSaved) drop(entry.sessionId);
      setToast(originalSaved
        ? `原本は保存しましたが、trim版を書き出せませんでした。${error instanceof Error ? error.message : String(error)}`
        : `保存できませんでした。${error instanceof Error ? error.message : String(error)} 保存待ちから再試行できます。`, "danger");
    } finally {
      setBusySessionId(null);
    }
  }

  async function retry(row: PendingRow) {
    const entry = row.entry;
    if (!entry.canRetry) return;
    setBusySessionId(entry.sessionId);
    try {
      if (row.kind === "audio") {
        await workspaceApi.commitAudioCapture({ sessionId: entry.sessionId, durationMs: entry.durationMs || 0 });
      } else {
        const video = entry as VideoImportPrepared;
        await workspaceApi.commitVideoImport({
          sessionId: entry.sessionId,
          durationMs: video.durationMs || 0,
          widthPx: video.widthPx || 0,
          heightPx: video.heightPx || 0,
          sourceType: video.sourceType ?? null,
          sourceId: video.sourceId ?? null,
        });
      }
      drop(entry.sessionId);
      setToast(`「${entry.filename}」の保存を復旧しました。`, "success");
    } catch (error) {
      setToast(`保存を復旧できませんでした。${error instanceof Error ? error.message : String(error)} 手動確認が必要です。`, "danger");
    } finally {
      setBusySessionId(null);
    }
  }

  async function recoverRecording(row: PendingRow) {
    if (!row.entry.canRecoverRecording) return;
    setBusySessionId(row.entry.sessionId);
    try {
      await workspaceApi.stopMediaRecording(row.entry.sessionId);
      await refresh();
      setToast("中断された収録を復旧しました。内容を確認して保存できます。", "success");
    } catch (error) {
      setToast(`収録を復旧できませんでした。${error instanceof Error ? error.message : String(error)} 原音は保持されています。`, "danger");
    } finally {
      setBusySessionId(null);
    }
  }

  async function discard(row: PendingRow) {
    setBusySessionId(row.entry.sessionId);
    try {
      if (row.kind === "audio") await workspaceApi.cancelAudioCapture(row.entry.sessionId);
      else await workspaceApi.cancelVideoImport(row.entry.sessionId);
      drop(row.entry.sessionId);
      setToast("保存待ちを破棄しました。", "info");
    } catch (error) {
      setToast(`保存待ちを破棄できませんでした。${error instanceof Error ? error.message : String(error)}`, "danger");
    } finally {
      setBusySessionId(null);
    }
  }

  return (
    <section className="panel studio-recorder" aria-label="保存待ち">
      <div className="section-heading">
        <h2>保存待ち</h2>
        {loadState === "ready" && <span>{rows.length}件</span>}
      </div>
      {loadState === "loading" && <div className="inbox-audio-recovery-state" role="status">保存待ちを確認しています…</div>}
      {loadState === "error" && (
        <div className="inbox-audio-recovery-state is-error" role="alert">
          <span>保存待ちを確認できませんでした。</span>
          <button type="button" className="text-button compact" onClick={() => { void refresh(); }}>一覧を再試行</button>
        </div>
      )}
      {loadState === "ready" && rows.length === 0 && (
        <div className="inbox-audio-recovery-state" role="status">保存待ちはありません。</div>
      )}
      {rows.map((row) => {
        const entry = row.entry;
        const busy = busySessionId === entry.sessionId;
        return (
          <div className="inbox-audio-recovery-row" key={entry.sessionId}>
            {entry.status === "ready" && row.kind === "audio" && (
              <audio controls preload="metadata" src={entry.mediaUrl} aria-label={`${entry.filename}の保存前プレビュー`} />
            )}
            {entry.status === "ready" && row.kind === "video" && (
              <PendingVideoPreview
                entry={entry as VideoImportPrepared}
                edit={videoEdits[entry.sessionId]}
                onEdit={(value) => setVideoEdits((current) => ({ ...current, [entry.sessionId]: value }))}
              />
            )}
            {entry.status !== "ready" && <div className="inbox-audio-recovery-warning" role="status">要確認</div>}
            <div>
              <strong>{entry.filename}</strong>
              <small>
                {[
                  KIND_LABELS[row.kind],
                  entry.status === "ready"
                    ? `${entry.mimeType} · ${formatArtifactFileSize(entry.fileSize)}`
                    : entry.canRetry
                      ? "保存が完了していません。安全確認後に再試行できます。"
                      : entry.canDiscard
                        ? "安全に読み込めません。保存せず破棄できます。"
                        : "安全に自動復旧できません。手動確認が必要です。",
                ].join(" · ")}
              </small>
            </div>
            <div className="inline-actions">
              {row.kind === "video" && entry.canCommit && (
                <label className="screen-recorder-commit-owner">
                  <span>紐づけ先</span>
                  <select
                    value={ownerKeys[entry.sessionId] || ""}
                    onChange={(event) => setOwnerKeys((current) => ({ ...current, [entry.sessionId]: event.target.value }))}
                  >
                    <option value="">Inbox（あとで整理）</option>
                    {owners.map((owner) => <option key={owner.key} value={owner.key}>{owner.label}</option>)}
                  </select>
                </label>
              )}
              {entry.canCommit && (
                <Button variant="primary" compact disabled={busy} onClick={() => { void commit(row); }}>
                  {busy ? "処理中…" : row.kind === "video" && videoEdits[entry.sessionId] && (videoEdits[entry.sessionId].startMs > 0 || videoEdits[entry.sessionId].endMs < videoEdits[entry.sessionId].durationMs) ? "原本とtrimを保存" : "保存"}
                </Button>
              )}
              {entry.canRetry && (
                <Button variant="secondary" compact disabled={busy} onClick={() => { void retry(row); }}>
                  {busy ? "処理中…" : "保存を再試行"}
                </Button>
              )}
              {entry.canRecoverRecording && (
                <Button variant="secondary" compact disabled={busy} onClick={() => { void recoverRecording(row); }}>
                  {busy ? "処理中…" : "収録を復旧"}
                </Button>
              )}
              {entry.canDiscard ? (
                <button type="button" className="text-button compact" disabled={busy} onClick={() => { void discard(row); }}>破棄</button>
              ) : !entry.canRetry ? (
                <span className="status-text is-warning">手動確認が必要</span>
              ) : null}
            </div>
          </div>
        );
      })}
    </section>
  );
}
