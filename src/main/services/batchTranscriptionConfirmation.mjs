import { createHash, createHmac, timingSafeEqual } from "node:crypto";

import {
  normalizeRawTranscript,
  normalizeTranscriptBatchBinding,
  normalizeTranscriptBatchPreview,
  normalizeTranscriptionError,
  normalizeTranscriptionLanguage,
  normalizeTranscriptionSource,
  resolveTranscriptBatchAvailability,
} from "../../shared/batchTranscription.mjs";

export const TRANSCRIPTION_CONFIRMATION_VERSION = "transcription-confirmation/v1";
export const TRANSCRIPTION_CONFIRMATION_TTL_MAX_MS = 15 * 60 * 1000;

const AUTHORIZATION_BRAND = Symbol("batch-transcription-authorization");
const VERIFIED_SOURCE_BRAND = Symbol("batch-transcription-verified-source");

function record(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function requiredText(value, field, maximum = 240) {
  const result = typeof value === "string" ? value.trim() : "";
  if (!result || result.length > maximum || /[\u0000-\u001f\u007f]/.test(result)) throw new Error(`${field}が不正です。`);
  return result;
}

function positiveSafeInteger(value, field) {
  if (!Number.isSafeInteger(value) || value <= 0) throw new Error(`${field}が不正です。`);
  return value;
}

function isoTimestamp(value, field) {
  const result = requiredText(value, field, 40);
  const date = new Date(result);
  if (Number.isNaN(date.getTime()) || date.toISOString() !== result) throw new Error(`${field}が不正です。`);
  return result;
}

function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function exactClaim(value) {
  const input = record(value);
  const allowed = ["version", "preview_fingerprint", "operation_id", "nonce", "issued_at", "expires_at"];
  if (Object.keys(input).length !== allowed.length || Object.keys(input).some((key) => !allowed.includes(key))) {
    throw new Error("文字起こし確認tokenが不正です。Previewを開き直してください。");
  }
  return input;
}

function confirmationSecret(value) {
  const secret = Buffer.isBuffer(value) ? value : typeof value === "string" ? Buffer.from(value, "utf8") : Buffer.alloc(0);
  if (secret.byteLength < 32) throw new Error("confirmation secretが不正です。");
  return secret;
}

function tokenSignature(secret, encodedClaim) {
  return createHmac("sha256", secret).update(`${TRANSCRIPTION_CONFIRMATION_VERSION}.${encodedClaim}`).digest("base64url");
}

function sameText(left, right) {
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  return a.byteLength === b.byteLength && timingSafeEqual(a, b);
}

export function transcriptBatchPreviewFingerprint(previewValue) {
  const preview = normalizeTranscriptBatchPreview(previewValue);
  const claimTarget = {
    feature: preview.feature,
    artifact_id: preview.artifact.artifact_id,
    content_hash: preview.artifact.content_hash,
    mime_type: preview.artifact.mime_type,
    file_size: preview.artifact.file_size,
    provider_profile_id: preview.provider.provider_profile_id,
    model_profile_id: preview.provider.model_profile_id,
    model_id: preview.provider.model_id,
    model_lifecycle: preview.provider.model_lifecycle,
    processing_mode: preview.provider.processing_mode,
    visibility: preview.visibility,
    sends_audio_to_provider: preview.provider.sends_audio_to_provider,
  };
  return createHash("sha256").update(canonicalJson(claimTarget)).digest("hex");
}

export function issueTranscriptBatchConfirmation(preview, options = {}) {
  const now = isoTimestamp(options.now, "confirmation issued_at");
  const ttlMs = positiveSafeInteger(options.ttl_ms ?? options.ttlMs, "confirmation TTL");
  if (ttlMs > TRANSCRIPTION_CONFIRMATION_TTL_MAX_MS) throw new Error("confirmation TTLが長すぎます。");
  const nonce = requiredText(options.nonce, "confirmation nonce", 160);
  const operationId = requiredText(options.operation_id ?? options.operationId, "operation ID", 160);
  const claim = {
    version: TRANSCRIPTION_CONFIRMATION_VERSION,
    preview_fingerprint: transcriptBatchPreviewFingerprint(preview),
    operation_id: operationId,
    nonce,
    issued_at: now,
    expires_at: new Date(new Date(now).getTime() + ttlMs).toISOString(),
  };
  const encodedClaim = Buffer.from(canonicalJson(claim), "utf8").toString("base64url");
  return `${TRANSCRIPTION_CONFIRMATION_VERSION}.${encodedClaim}.${tokenSignature(confirmationSecret(options.secret), encodedClaim)}`;
}

export function verifyTranscriptBatchConfirmation(tokenValue, preview, options = {}) {
  const token = requiredText(tokenValue, "文字起こし確認token", 4096);
  const prefix = `${TRANSCRIPTION_CONFIRMATION_VERSION}.`;
  if (!token.startsWith(prefix)) throw new Error("文字起こし確認tokenが不正です。Previewを開き直してください。");
  const remainder = token.slice(prefix.length);
  const separator = remainder.indexOf(".");
  if (separator <= 0 || separator !== remainder.lastIndexOf(".")) throw new Error("文字起こし確認tokenが不正です。Previewを開き直してください。");
  const encodedClaim = remainder.slice(0, separator);
  const signature = remainder.slice(separator + 1);
  const expectedSignature = tokenSignature(confirmationSecret(options.secret), encodedClaim);
  if (!sameText(signature, expectedSignature)) throw new Error("文字起こし確認tokenが一致しません。Previewを開き直してください。");
  let claim;
  try {
    if (!/^[A-Za-z0-9_-]+$/.test(encodedClaim)) throw new Error("invalid encoding");
    claim = exactClaim(JSON.parse(Buffer.from(encodedClaim, "base64url").toString("utf8")));
  } catch {
    throw new Error("文字起こし確認tokenが不正です。Previewを開き直してください。");
  }
  if (claim.version !== TRANSCRIPTION_CONFIRMATION_VERSION || claim.preview_fingerprint !== transcriptBatchPreviewFingerprint(preview)) {
    throw new Error("文字起こし対象またはProviderが変わりました。Previewを確認し直してください。");
  }
  const operationId = requiredText(options.operation_id ?? options.operationId, "operation ID", 160);
  if (claim.operation_id !== operationId) throw new Error("文字起こしoperationが変わりました。Previewを確認し直してください。");
  const now = new Date(isoTimestamp(options.now, "confirmation verified_at")).getTime();
  const issuedAt = new Date(isoTimestamp(claim.issued_at, "confirmation issued_at")).getTime();
  const expiresAt = new Date(isoTimestamp(claim.expires_at, "confirmation expires_at")).getTime();
  if (expiresAt <= issuedAt || expiresAt - issuedAt > TRANSCRIPTION_CONFIRMATION_TTL_MAX_MS || now < issuedAt || now > expiresAt) {
    throw new Error("文字起こし確認tokenの期限が切れました。Previewを開き直してください。");
  }
  return Object.freeze({
    [AUTHORIZATION_BRAND]: true,
    preview_fingerprint: claim.preview_fingerprint,
    operation_id: operationId,
    nonce: requiredText(claim.nonce, "confirmation nonce", 160),
    issued_at: claim.issued_at,
    expires_at: claim.expires_at,
  });
}

export function createVerifiedTranscriptionSource(sourceValue, descriptor) {
  const source = normalizeTranscriptionSource(sourceValue);
  if (!descriptor || typeof descriptor !== "object") throw new Error("文字起こし原音descriptorが不正です。");
  return Object.freeze({ [VERIFIED_SOURCE_BRAND]: true, source, descriptor });
}

export function createInMemoryBatchTranscriptionClaimStore() {
  const attempts = new Map();
  return Object.freeze({
    runOnce(claim, invoke) {
      const operationId = requiredText(claim?.operation_id, "operation ID", 160);
      const nonce = requiredText(claim?.nonce, "confirmation nonce", 160);
      const fingerprint = requiredText(claim?.preview_fingerprint, "Preview fingerprint", 64);
      const key = canonicalJson({ operation_id: operationId, nonce });
      const existing = attempts.get(key);
      if (existing) {
        if (existing.preview_fingerprint !== fingerprint) throw new Error("文字起こし確認tokenが別のPreviewで再利用されました。");
        return existing.promise.then((value) => ({ reused: true, value }));
      }
      const promise = Promise.resolve().then(invoke);
      attempts.set(key, { preview_fingerprint: fingerprint, promise });
      return promise.then((value) => ({ reused: false, value }));
    },
  });
}

export async function invokeConfirmedBatchTranscription({ authorization, preview: previewValue, binding, provider, verifiedSource, claimStore, language = "und", now, signal } = {}) {
  if (!authorization || authorization[AUTHORIZATION_BRAND] !== true) throw new Error("文字起こしの明示確認がありません。");
  const invokedAt = new Date(isoTimestamp(now, "provider invocation at")).getTime();
  if (invokedAt < new Date(authorization.issued_at).getTime() || invokedAt > new Date(authorization.expires_at).getTime()) {
    throw new Error("文字起こし確認tokenの期限が切れました。Previewを開き直してください。");
  }
  const preview = normalizeTranscriptBatchPreview(previewValue);
  if (authorization.preview_fingerprint !== transcriptBatchPreviewFingerprint(preview)) {
    throw new Error("文字起こし対象またはProviderが変わりました。Previewを確認し直してください。");
  }
  const normalizedBinding = normalizeTranscriptBatchBinding(binding);
  if (normalizedBinding.provider_profile_id !== preview.provider.provider_profile_id
    || normalizedBinding.model_profile_id !== preview.provider.model_profile_id
    || normalizedBinding.model_id !== preview.provider.model_id
    || normalizedBinding.model_lifecycle !== preview.provider.model_lifecycle
    || normalizedBinding.processing_mode !== preview.provider.processing_mode) {
    throw new Error("文字起こしProviderまたはmodelが変わりました。Previewを確認し直してください。");
  }
  if (!verifiedSource || verifiedSource[VERIFIED_SOURCE_BRAND] !== true) {
    throw new Error("文字起こし原音をMainで再検証できませんでした。");
  }
  const currentSource = normalizeTranscriptionSource(verifiedSource.source);
  if (canonicalJson(currentSource) !== canonicalJson(preview.artifact)) {
    throw new Error("文字起こし原音がPreview後に変わりました。Previewを確認し直してください。");
  }
  const currentAvailability = resolveTranscriptBatchAvailability(currentSource, normalizedBinding, preview.visibility);
  if (!currentAvailability.available) throw new Error(currentAvailability.message);
  if (!provider || provider.providerProfileId !== normalizedBinding.provider_profile_id || typeof provider.transcribe !== "function") {
    throw new Error("文字起こしProvider adapterが一致しません。");
  }
  if (!claimStore || typeof claimStore.runOnce !== "function") throw new Error("文字起こしのidempotency storeがありません。");
  const outcome = await claimStore.runOnce({
    operation_id: authorization.operation_id,
    nonce: authorization.nonce,
    preview_fingerprint: authorization.preview_fingerprint,
  }, async () => {
    try {
      const result = record(await provider.transcribe({
        source: verifiedSource.descriptor,
        artifactId: preview.artifact.artifact_id,
        contentHash: preview.artifact.content_hash,
        mimeType: preview.artifact.mime_type,
        fileSize: preview.artifact.file_size,
        model: normalizedBinding.model_id,
        language: normalizeTranscriptionLanguage(language),
        signal,
      }));
      if (typeof result.rawText !== "string") throw { code: "provider_failure" };
      let rawText;
      try {
        rawText = normalizeRawTranscript(result.rawText);
      } catch {
        throw { code: "provider_failure" };
      }
      return { raw_text: rawText, language: normalizeTranscriptionLanguage(result.language ?? language) };
    } catch (error) {
      const projection = normalizeTranscriptionError(error);
      throw Object.assign(new Error(projection.message), { projection });
    }
  });
  return { ...outcome.value, reused: outcome.reused };
}
