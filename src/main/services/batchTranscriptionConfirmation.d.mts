import type { TranscriptBatchBinding, TranscriptBatchPreview } from "../../shared/batchTranscription.mjs";

export const TRANSCRIPTION_CONFIRMATION_VERSION: "transcription-confirmation/v1";
export const TRANSCRIPTION_CONFIRMATION_TTL_MAX_MS: number;

export function transcriptBatchPreviewFingerprint(preview: unknown): string;
export function issueTranscriptBatchConfirmation(preview: unknown, options: { secret: string | Buffer; now: string; ttl_ms?: number; ttlMs?: number; nonce: string; operation_id?: string; operationId?: string }): string;
export function verifyTranscriptBatchConfirmation(token: unknown, preview: unknown, options: { secret: string | Buffer; now: string; operation_id?: string; operationId?: string }): object;
export function createVerifiedTranscriptionSource(source: unknown, descriptor: object): object;
export function createInMemoryBatchTranscriptionClaimStore(): { runOnce(claim: unknown, invoke: () => Promise<unknown>): Promise<{ reused: boolean; value: unknown }> };
export function invokeConfirmedBatchTranscription(args: {
  authorization: object;
  preview: TranscriptBatchPreview;
  binding: TranscriptBatchBinding;
  provider: { providerProfileId: string; transcribe(input: unknown): Promise<unknown> };
  verifiedSource: unknown;
  claimStore: { runOnce(claim: unknown, invoke: () => Promise<unknown>): Promise<{ reused: boolean; value: unknown }> };
  language?: string;
  now: string;
  signal?: AbortSignal;
}): Promise<{ raw_text: string; language: string; reused: boolean }>;
