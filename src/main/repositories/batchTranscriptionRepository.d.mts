import type { TranscriptionRevision } from "../../shared/batchTranscription.mjs";

export class BatchTranscriptionRepository {
  constructor(database: unknown);
  getHistory(artifactId: string): {
    artifact: Record<string, unknown>;
    capture: Record<string, unknown> | null;
    revisions: TranscriptionRevision[];
  };
}
