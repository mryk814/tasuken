import type { TranscriptionRevision } from "../../shared/batchTranscription.mjs";

export class BatchTranscriptionRepository {
  constructor(database: unknown);
  getHistory(artifactId: string): { artifact: Record<string, unknown>; capture: Record<string, unknown> | null; revisions: TranscriptionRevision[] };
  findRetryableOperation(artifactId: string, identity: Record<string, unknown>): string | null;
  claim(input: Record<string, unknown>): { action: "invoke" | "reuse" | "busy"; artifact: Record<string, unknown>; capture: Record<string, unknown> | null; revision: TranscriptionRevision };
  finish(input: Record<string, unknown>): { updated: boolean; artifact: Record<string, unknown>; capture: Record<string, unknown> | null; revision: TranscriptionRevision };
  cancel(artifactId: string, operationId: string, at: string): TranscriptionRevision | null;
}
