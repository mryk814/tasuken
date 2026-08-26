import { normalizeTranscriptionRevision } from "../../shared/batchTranscription.mjs";

function historyOf(entity) {
  if (!Array.isArray(entity?.transcription_revisions)) return [];
  return entity.transcription_revisions.map(normalizeTranscriptionRevision);
}

function captureOwner(database, artifact) {
  if (artifact.source_type !== "capture_entry" || typeof artifact.source_id !== "string")
    return null;
  return database.get("capture_entry", artifact.source_id);
}

export class BatchTranscriptionRepository {
  constructor(database) {
    this.database = database;
  }

  getHistory(artifactId) {
    const artifact = this.database.get("artifact", artifactId);
    if (!artifact) throw new Error("Audio Artifactが見つかりません。");
    const capture = captureOwner(this.database, artifact);
    return { artifact, capture, revisions: historyOf(artifact) };
  }
}
