import fs from "node:fs";
import { randomBytes, randomUUID } from "node:crypto";

import {
  buildTranscriptBatchPreview,
  normalizeTranscriptionError,
  parseTranscriptBatchRunRequest,
  projectTranscriptionDiagnostic,
} from "../../shared/batchTranscription.mjs";
import {
  createVerifiedTranscriptionSource,
  invokeConfirmedBatchTranscription,
  issueTranscriptBatchConfirmation,
  transcriptBatchPreviewFingerprint,
  verifyTranscriptBatchConfirmation,
} from "./batchTranscriptionConfirmation.mjs";

const CONFIRMATION_TTL_MS = 10 * 60 * 1000;
const OPERATION_LEASE_MS = 12 * 60 * 1000;

function unavailable(reason, message, artifact, provider) {
  return {
    available: false,
    reason,
    message,
    ...(artifact ? { artifact } : {}),
    ...(provider ? { provider } : {}),
  };
}

function publicProvider(binding) {
  if (!binding) return undefined;
  return {
    provider_profile_id: binding.provider_profile_id,
    provider_label: binding.provider_label,
    model_profile_id: binding.model_profile_id,
    model_id: binding.model_id,
    processing_mode: binding.processing_mode,
    sends_audio_to_provider: binding.processing_mode === "cloud",
  };
}

function sourceAvailability(value) {
  if (["missing", "changed", "unsafe_source", "unsupported_codec"].includes(value)) return value;
  return "missing";
}

export class BatchTranscriptionService {
  constructor(options) {
    this.options = options;
    this.now = options.now || (() => new Date().toISOString());
    this.idFactory = options.idFactory || randomUUID;
    this.secret = options.confirmationSecret || randomBytes(32);
    this.active = new Map();
  }

  preview(request) {
    const artifactId = request.artifactId;
    const resolved = this.resolveCurrent(artifactId);
    try {
      if (!resolved.artifact || resolved.artifact.media_kind !== "audio") {
        return unavailable("source_missing", "Audio Artifactが見つかりません。再読み込みしてください。");
      }
      const providerContext = this.options.providerRegistry.resolve();
      if (!providerContext?.binding || !providerContext?.provider) {
        return unavailable(
          providerContext?.reason || "binding_unavailable",
          providerContext?.message || "文字起こしProviderとmodelをSettingsで選択してください。別Providerへ自動切替しません。",
          { artifact_id: artifactId, mime_type: resolved.source.mime_type, file_size: resolved.source.file_size },
          publicProvider(providerContext?.binding),
        );
      }
      const preview = buildTranscriptBatchPreview(resolved.source, providerContext.binding, resolved.visibility);
      if (!preview.available) {
        return unavailable(preview.reason, preview.message, {
          artifact_id: artifactId,
          mime_type: resolved.source.mime_type,
          file_size: resolved.source.file_size,
        }, publicProvider(providerContext.binding));
      }
      const retryOperation = this.options.repository.findRetryableOperation(artifactId, {
        source_content_hash: preview.artifact.content_hash,
        provider_profile_id: preview.provider.provider_profile_id,
        model_profile_id: preview.provider.model_profile_id,
        model_id: preview.provider.model_id,
        processing_mode: preview.provider.processing_mode,
      });
      const operationId = retryOperation || this.idFactory();
      const issuedAt = this.now();
      const confirmationToken = issueTranscriptBatchConfirmation(preview, {
        secret: this.secret,
        now: issuedAt,
        ttl_ms: CONFIRMATION_TTL_MS,
        nonce: this.idFactory(),
        operation_id: operationId,
      });
      return { ...preview, confirmationToken, operationId };
    } finally {
      resolved.close();
    }
  }

  history(request) {
    const { capture, revisions } = this.options.repository.getHistory(request.artifactId);
    return {
      artifactId: request.artifactId,
      captureId: capture?.id || null,
      revisions,
    };
  }

  async run(requestValue) {
    const request = parseTranscriptBatchRunRequest(requestValue);
    const resolved = this.resolveCurrent(request.artifactId);
    let providerContext;
    try {
      if (!resolved.artifact || resolved.artifact.media_kind !== "audio" || resolved.source.availability !== "available") {
        throw new Error("原音を安全に読み取れません。Artifactの状態を確認してください。");
      }
      providerContext = this.options.providerRegistry.resolve();
      if (!providerContext?.binding || !providerContext?.provider) {
        throw new Error(providerContext?.message || "選択中の文字起こしProviderまたはmodelを利用できません。");
      }
      const preview = buildTranscriptBatchPreview(resolved.source, providerContext.binding, resolved.visibility);
      if (!preview.available) throw new Error(preview.message);
      const verifiedAt = this.now();
      const authorization = verifyTranscriptBatchConfirmation(request.confirmationToken, preview, {
        secret: this.secret,
        now: verifiedAt,
        operation_id: request.operationId,
      });
      const leaseToken = this.idFactory();
      const claim = this.options.repository.claim({
        operationId: request.operationId,
        artifactId: request.artifactId,
        previewFingerprint: transcriptBatchPreviewFingerprint(preview),
        revisionId: this.idFactory(),
        revisionRequest: {
          operation_id: request.operationId,
          source_artifact_id: request.artifactId,
          source_content_hash: preview.artifact.content_hash,
          provider_profile_id: preview.provider.provider_profile_id,
          model_profile_id: preview.provider.model_profile_id,
          model_id: preview.provider.model_id,
          language: "ja",
          processing_mode: preview.provider.processing_mode,
        },
        leaseToken,
        leaseExpiresAt: new Date(Date.parse(verifiedAt) + OPERATION_LEASE_MS).toISOString(),
        now: verifiedAt,
      });
      if (claim.action === "reuse") return this.result(request.artifactId, claim.revision, true);
      if (claim.action === "busy") throw new Error("この文字起こしはすでに処理中です。完了を待って履歴を更新してください。");

      const controller = new AbortController();
      this.active.set(request.operationId, controller);
      const verifiedSource = createVerifiedTranscriptionSource(resolved.source, {
        fileDescriptor: resolved.fileDescriptor,
      });
      try {
        const output = await invokeConfirmedBatchTranscription({
          authorization,
          preview,
          binding: providerContext.binding,
          provider: providerContext.provider,
          verifiedSource,
          claimStore: {
            async runOnce(_claim, invoke) {
              return { reused: false, value: await invoke() };
            },
          },
          language: "ja",
          now: this.now(),
          signal: controller.signal,
        });
        const completed = this.options.repository.finish({
          operationId: request.operationId,
          leaseToken,
          transition: {
            status: "completed",
            at: this.now(),
            raw_text: output.raw_text,
            language: output.language,
          },
        });
        this.options.notifyChanged?.();
        return this.result(request.artifactId, completed.revision, output.reused);
      } catch (error) {
        const projection = controller.signal.aborted
          ? normalizeTranscriptionError({ code: "cancelled" })
          : normalizeTranscriptionError(error?.projection || error);
        const failed = this.options.repository.finish({
          operationId: request.operationId,
          leaseToken,
          transition: {
            status: projection.code === "cancelled" ? "cancelled" : "failed",
            at: this.now(),
            error: projection,
          },
        });
        this.options.notifyChanged?.();
        if (!failed.updated && failed.revision.status === "cancelled") return this.result(request.artifactId, failed.revision, false);
        throw Object.assign(new Error(projection.message), { code: projection.code, retryable: projection.retryable });
      } finally {
        this.active.delete(request.operationId);
      }
    } finally {
      resolved.close();
    }
  }

  cancel(request) {
    this.active.get(request.operationId)?.abort();
    const revision = this.options.repository.cancel(request.artifactId, request.operationId, this.now());
    if (!revision) throw new Error("処理中の文字起こしが見つかりません。履歴を更新してください。");
    this.options.notifyChanged?.();
    return this.result(request.artifactId, revision, false);
  }

  result(artifactId, revision, reused) {
    const history = this.history({ artifactId });
    return { ...history, revision, reused };
  }

  resolveCurrent(artifactId) {
    const artifact = this.options.entityRepository.get("artifact", artifactId);
    const resolution = this.options.mediaCapture.resolveArtifactMedia(artifactId);
    let closed = false;
    const close = () => {
      if (closed || resolution.availability !== "available") return;
      closed = true;
      fs.closeSync(resolution.fileDescriptor);
    };
    try {
      const source = {
        artifact_id: artifactId,
        content_hash: typeof artifact?.content_hash === "string" ? artifact.content_hash : "sha256:".padEnd(71, "0"),
        mime_type: resolution.availability === "available" ? resolution.mimeType : String(artifact?.mime_type || "application/octet-stream"),
        file_size: resolution.availability === "available" ? resolution.fileSize : Math.max(1, Number(artifact?.file_size) || 1),
        availability: sourceAvailability(resolution.availability),
      };
      if (resolution.availability === "available") source.availability = "available";
      const visibility = this.options.resolveVisibility(artifact);
      return {
        artifact,
        source,
        visibility,
        fileDescriptor: resolution.availability === "available" ? resolution.fileDescriptor : null,
        close,
      };
    } catch (error) {
      close();
      throw error;
    }
  }

  diagnostic(artifactId) {
    const history = this.history({ artifactId });
    return { ...history, revisions: history.revisions.map(projectTranscriptionDiagnostic) };
  }
}
