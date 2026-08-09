import type {
  BatchTranscriptionArtifactRequest,
  BatchTranscriptionCancelRequest,
  BatchTranscriptionHistoryResult,
  BatchTranscriptionPreviewResult,
  BatchTranscriptionRunRequest,
  BatchTranscriptionRunResult,
} from "../../shared/batchTranscriptionIpc";

export class BatchTranscriptionService {
  constructor(options: Record<string, unknown>);
  preview(request: BatchTranscriptionArtifactRequest): BatchTranscriptionPreviewResult;
  history(request: BatchTranscriptionArtifactRequest): BatchTranscriptionHistoryResult;
  run(request: BatchTranscriptionRunRequest): Promise<BatchTranscriptionRunResult>;
  cancel(request: BatchTranscriptionCancelRequest): BatchTranscriptionRunResult;
  diagnostic(artifactId: string): Record<string, unknown>;
}
