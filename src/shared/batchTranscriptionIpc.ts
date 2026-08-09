import { parseTranscriptBatchRunRequest } from "./batchTranscription.mjs";
import type { TranscriptBatchPreview, TranscriptionRevision } from "./batchTranscription.mjs";

const ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export interface BatchTranscriptionArtifactRequest {
  artifactId: string;
}

export interface BatchTranscriptionRunRequest extends BatchTranscriptionArtifactRequest {
  confirmationToken: string;
  operationId: string;
}

export interface BatchTranscriptionCancelRequest extends BatchTranscriptionArtifactRequest {
  operationId: string;
}

export type BatchTranscriptionPreviewResult =
  | ({ available: true; confirmationToken: string; operationId: string } & TranscriptBatchPreview)
  | {
      available: false;
      reason: string;
      message: string;
      artifact?: { artifact_id: string; mime_type?: string; file_size?: number };
      provider?: {
        provider_profile_id: string;
        provider_label: string;
        model_profile_id: string;
        model_id: string;
        processing_mode: "cloud" | "local";
        sends_audio_to_provider: boolean;
      };
    };

export interface BatchTranscriptionHistoryResult {
  artifactId: string;
  captureId: string | null;
  revisions: TranscriptionRevision[];
}

export interface BatchTranscriptionRunResult extends BatchTranscriptionHistoryResult {
  revision: TranscriptionRevision;
  reused: boolean;
}

function exactRecord(value: unknown, keys: string[], label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${label}が不正です。`);
  const input = value as Record<string, unknown>;
  const actual = Object.keys(input);
  if (actual.length !== keys.length || actual.some((key) => !keys.includes(key))) throw new Error(`${label}が不正です。`);
  return input;
}

function artifactId(value: unknown): string {
  if (typeof value !== "string" || !ID_PATTERN.test(value)) throw new Error("Audio Artifact IDが不正です。");
  return value;
}

function operationId(value: unknown): string {
  if (typeof value !== "string" || !ID_PATTERN.test(value)) throw new Error("文字起こしoperation IDが不正です。");
  return value;
}

export function parseBatchTranscriptionArtifactRequest(value: unknown): BatchTranscriptionArtifactRequest {
  const input = exactRecord(value, ["artifactId"], "文字起こし対象");
  return { artifactId: artifactId(input.artifactId) };
}

export function parseBatchTranscriptionCancelRequest(value: unknown): BatchTranscriptionCancelRequest {
  const input = exactRecord(value, ["artifactId", "operationId"], "文字起こしcancel要求");
  return { artifactId: artifactId(input.artifactId), operationId: operationId(input.operationId) };
}

export function parseBatchTranscriptionRunRequest(value: unknown): BatchTranscriptionRunRequest {
  const input = parseTranscriptBatchRunRequest(value);
  return {
    artifactId: artifactId(input.artifactId),
    confirmationToken: input.confirmationToken,
    operationId: operationId(input.operationId),
  };
}
