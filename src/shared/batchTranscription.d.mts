export type TranscriptionProcessingMode = "cloud" | "local" | "external";
export type TranscriptionRevisionStatus = "queued" | "processing" | "completed" | "failed" | "cancelled";
export type TranscriptionCapability = "batch_transcription" | "timestamps" | "speaker_diarization" | "language_detection" | "local_processing";
export type TranscriptionSourceAvailability = "available" | "missing" | "changed" | "unsafe_source" | "unsupported_codec";

export interface TranscriptionSource {
  artifact_id: string;
  content_hash: string;
  mime_type: string;
  file_size: number;
  availability: TranscriptionSourceAvailability;
}

export interface TranscriptBatchBinding {
  feature: "transcript_batch";
  provider_profile_id: string;
  provider_label: string;
  model_profile_id: string;
  model_id: string;
  processing_mode: "cloud" | "local";
  enabled: boolean;
  credential_configured: boolean;
  model_lifecycle: "available" | "experimental" | "unavailable" | "deprecated";
  capabilities: TranscriptionCapability[];
  max_file_size: number;
  supported_mime_types: string[];
}

export interface TranscriptBatchFeatureBinding {
  feature: "transcript_batch";
  provider_profile_id: string;
  model_profile_id: string;
  processing_mode: "cloud" | "local";
}

export interface TranscriptBatchPreview {
  available: true;
  feature: "transcript_batch";
  artifact: TranscriptionSource;
  provider: {
    provider_profile_id: string;
    provider_label: string;
    model_profile_id: string;
    model_id: string;
    model_lifecycle: "available" | "experimental" | "unavailable" | "deprecated";
    processing_mode: "cloud" | "local";
    sends_audio_to_provider: boolean;
  };
  visibility: string[];
  message: string;
}

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

export const TRANSCRIPTION_FEATURE: "transcript_batch";
export const TRANSCRIPTION_CAPABILITIES: TranscriptionCapability[];
export const TRANSCRIPTION_PROCESSING_MODES: TranscriptionProcessingMode[];
export const TRANSCRIPTION_PROVIDER_PROCESSING_MODES: ("cloud" | "local")[];
export const TRANSCRIPTION_REVISION_STATUSES: TranscriptionRevisionStatus[];
export const MAX_RAW_TRANSCRIPT_CHARS: 2000000;

export function normalizeRawTranscript(value: unknown): string;
export function normalizeTranscriptionLanguage(value: unknown): string;
export function normalizeTranscriptionSource(value: unknown): TranscriptionSource;
export function normalizeTranscriptBatchBinding(value: unknown): TranscriptBatchBinding;
export function normalizeTranscriptBatchFeatureBinding(value: unknown): TranscriptBatchFeatureBinding;
export function resolveTranscriptBatchFeatureBinding(featureBinding: unknown, availableBindings: unknown): { available: boolean; feature_binding: TranscriptBatchFeatureBinding; binding: TranscriptBatchBinding | null; reason: string | null; message?: string };
export function resolveTranscriptBatchAvailability(source: unknown, binding: unknown, visibility: unknown): Record<string, unknown>;
export function buildTranscriptBatchPreview(source: unknown, binding: unknown, visibility: unknown): TranscriptBatchPreview | Record<string, unknown>;
export function normalizeTranscriptBatchPreview(preview: unknown): TranscriptBatchPreview;
export function parseTranscriptBatchRunRequest(value: unknown): Readonly<{ artifactId: string; confirmationToken: string; operationId: string }>;
export function normalizeTranscriptionError(value: unknown): { code: string; message: string; retryable: boolean };
export function transcriptionAttemptKey(value: unknown): string;
export function normalizeTranscriptionRevision(value: unknown): TranscriptionRevision;
export function planTranscriptionRevision(history: unknown, request: unknown, options: { revision_id?: string; revisionId?: string }): { action: "reuse" | "append"; revision: TranscriptionRevision; history: TranscriptionRevision[] };
export function transitionTranscriptionRevision(revision: unknown, transition: unknown): TranscriptionRevision;
export function projectTranscriptionDiagnostic(revision: unknown): Record<string, unknown>;
