import { IconCopy, IconFileText, IconRefresh } from "@tabler/icons-react";
import { useEffect, useState } from "react";

import type { TranscriptionRevision } from "../../../../../shared/batchTranscription.mjs";
import type { BatchTranscriptionHistoryResult } from "../../../../../shared/batchTranscriptionIpc";
import { workspaceApi } from "../../../services/workspaceApi";

type PanelState =
  | { status: "loading" }
  | { status: "ready"; history: BatchTranscriptionHistoryResult }
  | { status: "error"; message: string };

function statusLabel(status: TranscriptionRevision["status"]): string {
  if (status === "completed") return "完了";
  if (status === "cancelled") return "キャンセル";
  if (status === "failed") return "失敗";
  return "終了済み";
}

function finishedAt(revision: TranscriptionRevision): string {
  const value = revision.completed_at || revision.started_at;
  if (!value) return "";
  return new Intl.DateTimeFormat("ja-JP", { dateStyle: "short", timeStyle: "short" }).format(
    new Date(value),
  );
}

export function BatchTranscriptionPanel({ artifactId }: { artifactId: string }) {
  const [state, setState] = useState<PanelState>({ status: "loading" });

  async function loadHistory() {
    setState({ status: "loading" });
    try {
      const history = await workspaceApi.getBatchTranscriptionHistory(artifactId);
      setState({ status: "ready", history });
    } catch {
      setState({
        status: "error",
        message: "文字起こし履歴を読み込めませんでした。Artifactを開き直してください。",
      });
    }
  }

  useEffect(() => {
    let disposed = false;
    void workspaceApi
      .getBatchTranscriptionHistory(artifactId)
      .then((history) => {
        if (!disposed) setState({ status: "ready", history });
      })
      .catch(() => {
        if (!disposed)
          setState({
            status: "error",
            message: "文字起こし履歴を読み込めませんでした。Artifactを開き直してください。",
          });
      });
    return () => {
      disposed = true;
    };
  }, [artifactId]);

  const revisions = state.status === "ready" ? state.history.revisions : [];
  const latest = revisions.at(-1);

  return (
    <section className="batch-transcription" aria-labelledby="batch-transcription-title">
      <div className="batch-transcription-heading">
        <h3 id="batch-transcription-title">
          <IconFileText size={16} />
          文字起こし履歴
        </h3>
        {latest && (
          <span className={`batch-transcription-status is-${latest.status}`}>
            {statusLabel(latest.status)}
          </span>
        )}
      </div>

      {state.status === "loading" && (
        <div className="batch-transcription-state" role="status">
          履歴を読み込み中…
        </div>
      )}
      {state.status === "error" && (
        <div className="batch-transcription-state is-error" role="alert">
          <span>{state.message}</span>
          <button
            type="button"
            className="text-button compact"
            onClick={() => {
              void loadHistory();
            }}
          >
            <IconRefresh size={14} />
            履歴を更新
          </button>
        </div>
      )}
      {state.status === "ready" && revisions.length === 0 && (
        <div className="batch-transcription-state">過去の文字起こし履歴はありません。</div>
      )}

      {revisions.length > 0 && (
        <div className="batch-transcription-history">
          {[...revisions].reverse().map((revision) => (
            <article key={revision.id} className="batch-transcription-revision">
              <header>
                <span className={`batch-transcription-status is-${revision.status}`}>
                  {statusLabel(revision.status)}
                </span>
                <span>
                  {revision.provider_profile_id} / {revision.model_id}
                </span>
                <time>{finishedAt(revision)}</time>
              </header>
              {revision.status === "completed" ? (
                <>
                  <textarea readOnly value={revision.raw_text} aria-label="文字起こし本文" />
                  <button
                    type="button"
                    className="text-button compact"
                    onClick={() => {
                      void workspaceApi.copyText(revision.raw_text);
                    }}
                  >
                    <IconCopy size={14} />
                    コピー
                  </button>
                </>
              ) : (
                <p>この処理は終了しています。原音と履歴は保持されています。</p>
              )}
            </article>
          ))}
        </div>
      )}
    </section>
  );
}
