export type TranscriptionProcessingMode = "cloud" | "local" | "external";
export type TranscriptionRevisionStatus =
  "queued" | "processing" | "completed" | "failed" | "cancelled";

export interface TranscriptionRevision {
  id: string;
  operation_id: string;
  attempt_key: string;
  source_artifact_id: string;
  source_content_hash: string;
  provider_profile_id: string;
  model_profile_id: string;
  model_id: string;
  language: string;
  processing_mode: TranscriptionProcessingMode;
  status: TranscriptionRevisionStatus;
  raw_text: string;
  started_at: string | null;
  completed_at: string | null;
  error_code: string | null;
}

export const TRANSCRIPTION_PROCESSING_MODES: TranscriptionProcessingMode[];
export const TRANSCRIPTION_REVISION_STATUSES: TranscriptionRevisionStatus[];
export const MAX_RAW_TRANSCRIPT_CHARS: number;
export function normalizeRawTranscript(value: unknown): string;
export function normalizeTranscriptionError(value: unknown): string;
export function transcriptionAttemptKey(value: unknown): string;
export function normalizeTranscriptionRevision(value: unknown): TranscriptionRevision;
