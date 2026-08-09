import {
  normalizeTranscriptionRevision,
  planTranscriptionRevision,
  transitionTranscriptionRevision,
} from "../../shared/batchTranscription.mjs";

function historyOf(entity) {
  if (!Array.isArray(entity?.transcription_revisions)) return [];
  return entity.transcription_revisions.map(normalizeTranscriptionRevision);
}

function replaceRevision(history, revision) {
  const normalized = normalizeTranscriptionRevision(revision);
  const index = history.findIndex((candidate) => candidate.id === normalized.id);
  if (index < 0) return [...history, normalized];
  return history.map((candidate, candidateIndex) => candidateIndex === index ? normalized : candidate);
}

function captureOwner(database, artifact) {
  if (artifact.source_type !== "capture_entry" || typeof artifact.source_id !== "string") return null;
  return database.get("capture_entry", artifact.source_id);
}

function assertOperationMatches(row, input, revision) {
  if (row.artifact_id !== input.artifactId
    || row.preview_fingerprint !== input.previewFingerprint
    || row.revision_id !== revision.id
    || row.attempt_key !== revision.attempt_key) {
    throw new Error("同じ文字起こしoperationを別の対象へ再利用できません。");
  }
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

  findRetryableOperation(artifactId, identity) {
    const { revisions } = this.getHistory(artifactId);
    for (let index = revisions.length - 1; index >= 0; index -= 1) {
      const revision = revisions[index];
      if ((revision.status === "failed" || revision.status === "cancelled" || revision.status === "processing")
        && revision.source_content_hash === identity.source_content_hash
        && revision.provider_profile_id === identity.provider_profile_id
        && revision.model_profile_id === identity.model_profile_id
        && revision.model_id === identity.model_id
        && revision.processing_mode === identity.processing_mode) {
        const operation = this.database.db.prepare(
          "SELECT operation_id FROM transcription_operations WHERE operation_id = ? AND artifact_id = ? AND revision_id = ?",
        ).get(revision.operation_id, artifactId, revision.id);
        if (operation) return revision.operation_id;
      }
    }
    return null;
  }

  claim(input) {
    const transaction = this.database.db.transaction(() => {
      const artifact = this.database.get("artifact", input.artifactId);
      if (!artifact) throw new Error("Audio Artifactが見つかりません。");
      const capture = captureOwner(this.database, artifact);
      const history = historyOf(artifact);
      const plan = planTranscriptionRevision(history, input.revisionRequest, { revision_id: input.revisionId });
      const row = this.database.db.prepare(
        "SELECT * FROM transcription_operations WHERE operation_id = ?",
      ).get(input.operationId);

      if (row) {
        assertOperationMatches(row, input, plan.revision);
        if (plan.revision.status === "completed") {
          return { action: "reuse", artifact, capture, revision: plan.revision };
        }
        const leaseActive = row.status === "processing"
          && typeof row.lease_expires_at === "string"
          && Date.parse(row.lease_expires_at) > Date.parse(input.now);
        if (leaseActive) return { action: "busy", artifact, capture, revision: plan.revision };
      } else {
        if (plan.action !== "append") throw new Error("文字起こしoperationの永続claimが見つかりません。");
        this.database.db.prepare(`
          INSERT INTO transcription_operations(
            operation_id, artifact_id, revision_id, attempt_key, preview_fingerprint,
            status, lease_token, lease_expires_at, created_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, 'queued', NULL, NULL, ?, ?)
        `).run(
          input.operationId,
          input.artifactId,
          plan.revision.id,
          plan.revision.attempt_key,
          input.previewFingerprint,
          input.now,
          input.now,
        );
      }

      let current = plan.revision;
      if (current.status === "processing") {
        current = transitionTranscriptionRevision(current, {
          status: "failed",
          at: input.now,
          error: { code: "provider_failure" },
        });
      }
      if (current.status !== "queued" && current.status !== "failed" && current.status !== "cancelled") {
        throw new Error("文字起こしrevisionを再開できません。");
      }
      const processing = transitionTranscriptionRevision(current, { status: "processing", at: input.now });
      this.persistOwners(artifact, capture, replaceRevision(history, processing), "processing", input.now);
      this.database.db.prepare(`
        UPDATE transcription_operations
        SET status = 'processing', lease_token = ?, lease_expires_at = ?, updated_at = ?
        WHERE operation_id = ?
      `).run(input.leaseToken, input.leaseExpiresAt, input.now, input.operationId);
      return { action: "invoke", artifact, capture, revision: processing };
    });
    return transaction.immediate();
  }

  finish(input) {
    const transaction = this.database.db.transaction(() => {
      const row = this.database.db.prepare(
        "SELECT * FROM transcription_operations WHERE operation_id = ?",
      ).get(input.operationId);
      if (!row) throw new Error("文字起こしoperationが見つかりません。");
      const artifact = this.database.get("artifact", row.artifact_id);
      if (!artifact) throw new Error("Audio Artifactが見つかりません。");
      const capture = captureOwner(this.database, artifact);
      const history = historyOf(artifact);
      const current = history.find((revision) => revision.id === row.revision_id);
      if (!current) throw new Error("文字起こしrevisionが見つかりません。");
      if (row.lease_token !== input.leaseToken || current.status !== "processing") {
        return { updated: false, artifact, capture, revision: current };
      }
      const revision = transitionTranscriptionRevision(current, input.transition);
      this.persistOwners(artifact, capture, replaceRevision(history, revision), revision.status, input.transition.at);
      this.database.db.prepare(`
        UPDATE transcription_operations
        SET status = ?, lease_token = NULL, lease_expires_at = NULL, updated_at = ?
        WHERE operation_id = ? AND lease_token = ?
      `).run(revision.status, input.transition.at, input.operationId, input.leaseToken);
      return { updated: true, artifact, capture, revision };
    });
    return transaction.immediate();
  }

  cancel(artifactId, operationId, at) {
    const transaction = this.database.db.transaction(() => {
      const row = this.database.db.prepare(
        "SELECT * FROM transcription_operations WHERE operation_id = ? AND artifact_id = ?",
      ).get(operationId, artifactId);
      if (!row) return null;
      const artifact = this.database.get("artifact", artifactId);
      if (!artifact) return null;
      const capture = captureOwner(this.database, artifact);
      const history = historyOf(artifact);
      const current = history.find((revision) => revision.id === row.revision_id);
      if (!current || (current.status !== "queued" && current.status !== "processing")) return current || null;
      const revision = transitionTranscriptionRevision(current, { status: "cancelled", at });
      this.persistOwners(artifact, capture, replaceRevision(history, revision), "cancelled", at);
      this.database.db.prepare(`
        UPDATE transcription_operations
        SET status = 'cancelled', lease_token = NULL, lease_expires_at = NULL, updated_at = ?
        WHERE operation_id = ?
      `).run(at, operationId);
      return revision;
    });
    return transaction.immediate();
  }

  persistOwners(artifact, capture, revisions, status, at) {
    this.database.saveWithinTransaction("artifact", {
      ...artifact,
      transcription_status: status,
      transcription_revisions: revisions,
    }, { source: "batch-transcription", __canonicalOperationAt: at });
    if (capture) {
      this.database.saveWithinTransaction("capture_entry", {
        ...capture,
        transcription_status: status === "cancelled" ? "failed" : status,
        transcription_revisions: revisions,
      }, { source: "batch-transcription", __canonicalOperationAt: at });
    }
  }
}
