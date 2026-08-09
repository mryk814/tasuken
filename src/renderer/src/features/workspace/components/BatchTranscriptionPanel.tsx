import { IconCloudUpload, IconCopy, IconFileText, IconPlayerStop, IconRefresh } from "@tabler/icons-react";
import { useEffect, useRef, useState } from "react";

import type { TranscriptionRevision } from "../../../../../shared/batchTranscription.mjs";
import type { BatchTranscriptionHistoryResult, BatchTranscriptionPreviewResult } from "../../../../../shared/batchTranscriptionIpc";
import { workspaceApi } from "../../../services/workspaceApi";
import { formatArtifactFileSize } from "./artifacts";

type PanelState =
  | { status: "loading" }
  | { status: "ready"; history: BatchTranscriptionHistoryResult }
  | { status: "error"; message: string; history?: BatchTranscriptionHistoryResult };

function statusLabel(status: TranscriptionRevision["status"]): string {
  if (status === "queued") return "待機中";
  if (status === "processing") return "処理中";
  if (status === "completed") return "完了";
  if (status === "cancelled") return "キャンセル";
  return "失敗";
}

function finishedAt(revision: TranscriptionRevision): string {
  const value = revision.completed_at || revision.started_at;
  if (!value) return "";
  return new Intl.DateTimeFormat("ja-JP", { dateStyle: "short", timeStyle: "short" }).format(new Date(value));
}

export function BatchTranscriptionPanel({ artifactId }: { artifactId: string }) {
  const [state, setState] = useState<PanelState>({ status: "loading" });
  const [preview, setPreview] = useState<BatchTranscriptionPreviewResult | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [runningOperationId, setRunningOperationId] = useState<string | null>(null);
  const runPendingRef = useRef(false);
  const cancelPendingRef = useRef(false);

  async function loadHistory() {
    try {
      const history = await workspaceApi.getBatchTranscriptionHistory(artifactId);
      setState({ status: "ready", history });
    } catch {
      setState({ status: "error", message: "文字起こし履歴を読み込めませんでした。Artifactを開き直してください。" });
    }
  }

  useEffect(() => {
    let disposed = false;
    void workspaceApi.getBatchTranscriptionHistory(artifactId).then((history) => {
      if (!disposed) setState({ status: "ready", history });
    }).catch(() => {
      if (!disposed) setState({ status: "error", message: "文字起こし履歴を読み込めませんでした。Artifactを開き直してください。" });
    });
    return () => { disposed = true; };
  }, [artifactId]);

  async function openPreview() {
    setPreviewLoading(true);
    try {
      setPreview(await workspaceApi.previewBatchTranscription(artifactId));
      if (state.status === "error") await loadHistory();
    } catch {
      setPreview({ available: false, reason: "preview_failed", message: "Previewを作れませんでした。ArtifactとAI設定を確認してください。" });
    } finally {
      setPreviewLoading(false);
    }
  }

  async function run() {
    if (!preview?.available || runPendingRef.current || runningOperationId) return;
    runPendingRef.current = true;
    setRunningOperationId(preview.operationId);
    setState((current) => current.status === "ready" ? current : { status: "loading" });
    try {
      const result = await workspaceApi.runBatchTranscription({
        artifactId,
        operationId: preview.operationId,
        confirmationToken: preview.confirmationToken,
      });
      setState({ status: "ready", history: result });
      setPreview(null);
    } catch (error) {
      const message = error instanceof Error && error.message
        ? error.message.replace(/^Error invoking remote method '[^']+':\s*/, "")
        : "文字起こしに失敗しました。原音を保持したまま再試行できます。";
      setState((current) => ({
        status: "error",
        message,
        ...(current.status === "ready" ? { history: current.history } : {}),
      }));
    } finally {
      runPendingRef.current = false;
      setRunningOperationId(null);
    }
  }

  async function cancel(operationId: string) {
    if (cancelPendingRef.current) return;
    cancelPendingRef.current = true;
    try {
      const result = await workspaceApi.cancelBatchTranscription(artifactId, operationId);
      setState({ status: "ready", history: result });
      setPreview(null);
    } catch {
      setState((current) => ({
        status: "error",
        message: "キャンセル状態を保存できませんでした。履歴を更新してください。",
        ...(current.status === "ready" ? { history: current.history } : {}),
      }));
    } finally {
      cancelPendingRef.current = false;
    }
  }

  const history = state.status === "ready" ? state.history : state.status === "error" ? state.history : undefined;
  const revisions = history?.revisions || [];
  const latest = revisions.at(-1);
  const durableProcessingOperationId = latest?.status === "processing" ? latest.operation_id : null;
  const activeOperationId = runningOperationId || durableProcessingOperationId;

  return (
    <section className="batch-transcription" aria-labelledby="batch-transcription-title">
      <div className="batch-transcription-heading">
        <div>
          <strong id="batch-transcription-title">文字起こし</strong>
          {latest && <span className={`batch-transcription-status is-${latest.status}`}>{statusLabel(latest.status)}</span>}
        </div>
        {activeOperationId ? (
          <button type="button" className="secondary-button compact" onClick={() => { void cancel(activeOperationId); }}>
            <IconPlayerStop size={14} />キャンセル
          </button>
        ) : (
          <button type="button" className="secondary-button compact" disabled={previewLoading} onClick={() => { void openPreview(); }}>
            <IconFileText size={15} />{previewLoading ? "確認中…" : latest?.status === "failed" || latest?.status === "cancelled" ? "再試行" : "文字起こし"}
          </button>
        )}
      </div>

      {state.status === "loading" && <div className="batch-transcription-state" role="status">履歴を読み込み中…</div>}
      {state.status === "error" && (
        <div className="batch-transcription-state is-error" role="alert">
          <span>{state.message}</span>
          <button type="button" className="text-button compact" onClick={() => { void loadHistory(); }}><IconRefresh size={14} />履歴を更新</button>
        </div>
      )}
      {state.status === "ready" && revisions.length === 0 && !preview && (
        <div className="batch-transcription-state">まだ文字起こしはありません。</div>
      )}

      {preview && (
        <div className={`batch-transcription-preview ${preview.available ? "" : "is-unavailable"}`}>
          {preview.available ? (
            <>
              <dl>
                <div><dt>対象</dt><dd>{preview.artifact.mime_type} · {formatArtifactFileSize(preview.artifact.file_size)}</dd></div>
                <div><dt>Provider</dt><dd>{preview.provider.provider_label}</dd></div>
                <div><dt>Model</dt><dd>{preview.provider.model_id}</dd></div>
                <div><dt>処理</dt><dd>{preview.provider.processing_mode === "cloud" ? "Cloudへ原音を送信" : "Local"}</dd></div>
                <div><dt>言語</dt><dd>日本語</dd></div>
              </dl>
              {preview.provider.sends_audio_to_provider && (
                <p className="batch-transcription-cloud"><IconCloudUpload size={15} />この操作は確認後に原音を外部Providerへ送信します。</p>
              )}
              <div className="batch-transcription-preview-actions">
                <button type="button" className="primary-button compact" disabled={Boolean(runningOperationId)} onClick={() => { void run(); }}>
                  {runningOperationId ? "送信中…" : "確認して実行"}
                </button>
                {!runningOperationId && (
                  <button type="button" className="text-button compact" onClick={() => setPreview(null)}>閉じる</button>
                )}
              </div>
            </>
          ) : (
            <div className="batch-transcription-state is-error" role="alert">
              <span>{preview.message}</span>
              <button type="button" className="text-button compact" onClick={() => setPreview(null)}>閉じる</button>
            </div>
          )}
        </div>
      )}

      {revisions.length > 0 && (
        <div className="batch-transcription-history">
          {[...revisions].reverse().map((revision) => (
            <article key={revision.id} className="batch-transcription-revision">
              <header>
                <span className={`batch-transcription-status is-${revision.status}`}>{statusLabel(revision.status)}</span>
                <span>{revision.provider_profile_id} / {revision.model_id}</span>
                <time>{finishedAt(revision)}</time>
              </header>
              {revision.status === "completed" ? (
                <>
                  <textarea readOnly value={revision.raw_text} aria-label="raw transcript" />
                  <button type="button" className="text-button compact" onClick={() => { void workspaceApi.copyText(revision.raw_text); }}>
                    <IconCopy size={14} />コピー
                  </button>
                </>
              ) : revision.status === "failed" ? (
                <p>処理できませんでした。原音を保持したまま再試行できます。</p>
              ) : revision.status === "cancelled" ? (
                <p>キャンセルしました。原音は保持されています。</p>
              ) : (
                <p>Providerの処理を待っています。</p>
              )}
            </article>
          ))}
        </div>
      )}
    </section>
  );
}
