import { normalizeTranscriptionError } from "../shared/batchTranscription.mjs";

type BatchTranscriptionIpcPhase = "preview" | "history" | "run" | "cancel";

const FALLBACK_MESSAGES: Record<BatchTranscriptionIpcPhase, string> = {
  preview: "文字起こしPreviewを作れませんでした。ArtifactとAI設定を確認してください。",
  history: "文字起こし履歴を読み込めませんでした。Artifactを再読み込みしてください。",
  run: "文字起こしを実行できませんでした。Previewを開き直して再試行してください。",
  cancel: "文字起こしをキャンセルできませんでした。履歴を更新してください。",
};

export function projectBatchTranscriptionIpcError(phase: BatchTranscriptionIpcPhase, error: unknown): Error {
  const value = error && typeof error === "object" ? error as Record<string, unknown> : {};
  const nested = value.projection && typeof value.projection === "object"
    ? value.projection as Record<string, unknown>
    : {};
  const rawCode = typeof nested.code === "string" ? nested.code : typeof value.code === "string" ? value.code : "";
  if (!rawCode) return Object.assign(new Error(FALLBACK_MESSAGES[phase]), { code: "provider_failure", retryable: phase === "run" });
  const projection = normalizeTranscriptionError({ code: rawCode });
  return Object.assign(new Error(projection.message), { code: projection.code, retryable: projection.retryable });
}
