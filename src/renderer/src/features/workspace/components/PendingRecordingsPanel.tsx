import { useCallback, useEffect, useState } from "react";

import { workspaceApi } from "../../../services/workspaceApi";
import type { ToastTone } from "../../../stores/uiStore";
import type { AudioCapturePrepared, VideoImportPrepared } from "../../../../../shared/mediaCapture";
import { formatArtifactFileSize } from "./artifacts";
import { Button } from "./common";
import { readVideoMetadata } from "../lib/videoMetadata";

/**
 * 音声と画面録画の「保存待ち」を1つの表にまとめる（#383）。
 * 通常の画面録画は停止時に収録物へ確定し、ここには中断・保存失敗だけが残る。
 */
interface PendingRecordingsPanelProps {
  /** 録音・録画側が状態を変えたときに増える。表の再読込に使う。 */
  refreshToken: number;
  setToast: (message: string, tone?: ToastTone) => void;
}

type PendingKind = "audio" | "video";

interface PendingRow {
  kind: PendingKind;
  entry: AudioCapturePrepared | VideoImportPrepared;
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

async function videoMetadata(entry: VideoImportPrepared) {
  if (entry.durationMs && entry.widthPx && entry.heightPx) {
    return {
      durationMs: entry.durationMs,
      widthPx: entry.widthPx,
      heightPx: entry.heightPx,
    };
  }
  return readVideoMetadata(entry.mediaUrl);
}

function videoOwner(entry: VideoImportPrepared) {
  return entry.sourceType && entry.sourceId
    ? { sourceType: entry.sourceType, sourceId: entry.sourceId }
    : { sourceType: null, sourceId: null };
}

export function PendingRecordingsPanel({ refreshToken, setToast }: PendingRecordingsPanelProps) {
  const [rows, setRows] = useState<PendingRow[]>([]);
  const [loadState, setLoadState] = useState<"loading" | "ready" | "error">("loading");
  const [busySessionId, setBusySessionId] = useState<string | null>(null);

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
    try {
      if (row.kind === "audio") {
        const durationMs = entry.durationMs ?? await audioDurationMs(entry.mediaUrl);
        await workspaceApi.commitAudioCapture({ sessionId: entry.sessionId, durationMs });
        setToast(`音声「${entry.filename}」を収録物へ保存しました。`, "success");
      } else {
        const video = entry as VideoImportPrepared;
        const metadata = await videoMetadata(video);
        await workspaceApi.commitVideoImport({
          sessionId: video.sessionId,
          durationMs: metadata.durationMs,
          widthPx: metadata.widthPx,
          heightPx: metadata.heightPx,
          ...videoOwner(video),
        });
        setToast(`画面録画「${video.filename}」を収録物へ保存しました。`, "success");
      }
      drop(entry.sessionId);
    } catch (error) {
      setToast(`保存できませんでした。${error instanceof Error ? error.message : String(error)} 保存待ちから再試行できます。`, "danger");
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
        const metadata = await videoMetadata(video);
        await workspaceApi.commitVideoImport({
          sessionId: video.sessionId,
          durationMs: metadata.durationMs,
          widthPx: metadata.widthPx,
          heightPx: metadata.heightPx,
          ...videoOwner(video),
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

  // 通常の収録物導線では保存待ちを見せず、復旧が必要なときだけ表示する。
  if (loadState === "ready" && rows.length === 0) return null;

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
      {rows.map((row) => {
        const entry = row.entry;
        const busy = busySessionId === entry.sessionId;
        return (
          <div className="inbox-audio-recovery-row" key={entry.sessionId}>
            {entry.status === "ready" && row.kind === "audio" && (
              <audio controls preload="metadata" src={entry.mediaUrl} aria-label={`${entry.filename}の保存前プレビュー`} />
            )}
            {entry.status === "ready" && row.kind === "video" && (
              <video controls preload="metadata" src={entry.mediaUrl} aria-label={`${entry.filename}の保存前プレビュー`} />
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
              {entry.canCommit && (
                <Button variant="primary" compact disabled={busy} onClick={() => { void commit(row); }}>
                  {busy ? "処理中…" : "保存"}
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
