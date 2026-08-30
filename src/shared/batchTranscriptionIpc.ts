import type { TranscriptionRevision } from "./batchTranscription.mjs";

const ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export interface BatchTranscriptionArtifactRequest {
  artifactId: string;
}

export interface BatchTranscriptionHistoryResult {
  artifactId: string;
  captureId: string | null;
  revisions: TranscriptionRevision[];
}

function exactRecord(value: unknown, keys: string[], label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error(`${label}が不正です。`);
  const input = value as Record<string, unknown>;
  const actual = Object.keys(input);
  if (actual.length !== keys.length || actual.some((key) => !keys.includes(key)))
    throw new Error(`${label}が不正です。`);
  return input;
}

function artifactId(value: unknown): string {
  if (typeof value !== "string" || !ID_PATTERN.test(value))
    throw new Error("Audio Artifact IDが不正です。");
  return value;
}

export function parseBatchTranscriptionArtifactRequest(
  value: unknown,
): BatchTranscriptionArtifactRequest {
  const input = exactRecord(value, ["artifactId"], "文字起こし対象");
  return { artifactId: artifactId(input.artifactId) };
}
