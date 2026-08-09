export const TRANSCRIPTION_FEATURE = "transcript_batch";
export const TRANSCRIPTION_CAPABILITIES = [
  "batch_transcription",
  "timestamps",
  "speaker_diarization",
  "language_detection",
  "local_processing",
];
export const TRANSCRIPTION_PROCESSING_MODES = ["cloud", "local", "external"];
export const TRANSCRIPTION_PROVIDER_PROCESSING_MODES = ["cloud", "local"];
export const TRANSCRIPTION_REVISION_STATUSES = ["queued", "processing", "completed", "failed", "cancelled"];
export const MAX_RAW_TRANSCRIPT_CHARS = 2_000_000;

const SOURCE_AVAILABILITIES = new Set(["available", "missing", "changed", "unsafe_source", "unsupported_codec"]);
const CAPABILITIES = new Set(TRANSCRIPTION_CAPABILITIES);
const PROCESSING_MODES = new Set(TRANSCRIPTION_PROCESSING_MODES);
const PROVIDER_PROCESSING_MODES = new Set(TRANSCRIPTION_PROVIDER_PROCESSING_MODES);
const REVISION_STATUSES = new Set(TRANSCRIPTION_REVISION_STATUSES);
const MODEL_LIFECYCLES = new Set(["available", "experimental", "unavailable", "deprecated"]);
const VISIBILITIES = new Set(["m365", "coding_agent", "external_ai"]);
const SHA256_PATTERN = /^sha256:[a-f0-9]{64}$/;
const ISO_LANGUAGE_PATTERN = /^[a-z]{2,3}(?:-[A-Za-z0-9]{2,8})*$/;
const MAX_LABEL_LENGTH = 160;
const MAX_MODEL_LENGTH = 240;
const MAX_ERROR_CODE_LENGTH = 64;

function exactRecord(value, allowedKeys, label) {
  const input = record(value);
  if (Object.keys(input).some((key) => !allowedKeys.includes(key))) {
    throw new Error(`${label}に未定義fieldがあります。`);
  }
  return input;
}

const SAFE_PROVIDER_ERRORS = {
  invalid_request: "文字起こし要求を確認してください。",
  missing_credential: "Providerの資格情報を設定してください。",
  authentication: "Providerの認証設定を確認してください。",
  quota: "Providerの利用上限を確認してください。",
  rate_limit: "Providerが混雑しています。時間を置いて再試行してください。",
  timeout: "文字起こしが時間内に完了しませんでした。再試行してください。",
  cancelled: "文字起こしをキャンセルしました。原音は保持されています。",
  unsupported: "このProviderでは文字起こしできません。設定を確認してください。",
  model_unavailable: "指定した文字起こしモデルを利用できません。設定を確認してください。",
  provider_failure: "Providerで文字起こしに失敗しました。原音を保持したまま再試行できます。",
};

function record(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function requiredText(value, field, maximum = 240) {
  const result = typeof value === "string" ? value.trim() : "";
  if (!result || result.length > maximum || /[\u0000-\u001f\u007f]/.test(result)) {
    throw new Error(`${field}が不正です。`);
  }
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

function normalizeMime(value, field = "MIME") {
  const result = requiredText(value, field, 120).toLowerCase();
  if (!/^audio\/[a-z0-9][a-z0-9!#$&^_.+-]*$/.test(result)) throw new Error(`${field}が不正です。`);
  return result;
}

function normalizeLanguage(value) {
  if (value == null || value === "") return "und";
  const result = requiredText(value, "language", 40);
  if (result === "und") return result;
  if (!ISO_LANGUAGE_PATTERN.test(result)) throw new Error("languageが不正です。");
  const [base, ...rest] = result.split("-");
  return [base.toLowerCase(), ...rest].join("-");
}

function normalizeVisibility(value) {
  if (!Array.isArray(value)) throw new Error("visibilityが不正です。");
  const unique = [];
  for (const audience of value) {
    if (!VISIBILITIES.has(audience)) throw new Error("visibilityが不正です。");
    if (!unique.includes(audience)) unique.push(audience);
  }
  return ["m365", "coding_agent", "external_ai"].filter((item) => unique.includes(item));
}

function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

export function normalizeRawTranscript(value) {
  if (typeof value !== "string") throw new Error("raw transcriptが不正です。");
  if (value.length > MAX_RAW_TRANSCRIPT_CHARS) {
    throw new Error(`raw transcriptは${MAX_RAW_TRANSCRIPT_CHARS}文字以内にしてください。`);
  }
  return value.replace(/\r\n?/g, "\n");
}

export function normalizeTranscriptionLanguage(value) {
  return normalizeLanguage(value);
}

export function normalizeTranscriptionSource(value) {
  const input = record(value);
  const availability = requiredText(input.availability, "availability", 40);
  if (!SOURCE_AVAILABILITIES.has(availability)) throw new Error("availabilityが不正です。");
  const contentHash = requiredText(input.content_hash ?? input.contentHash, "content hash", 71);
  if (!SHA256_PATTERN.test(contentHash)) throw new Error("content hashが不正です。");
  return {
    artifact_id: requiredText(input.artifact_id ?? input.artifactId, "Artifact ID", 160),
    content_hash: contentHash,
    mime_type: normalizeMime(input.mime_type ?? input.mimeType),
    file_size: positiveSafeInteger(input.file_size ?? input.fileSize, "file size"),
    availability,
  };
}

export function normalizeTranscriptBatchBinding(value) {
  const input = record(value);
  const processingMode = requiredText(input.processing_mode ?? input.processingMode, "processing mode", 20);
  if (!PROVIDER_PROCESSING_MODES.has(processingMode)) throw new Error("provider processing modeが不正です。");
  const lifecycle = requiredText(input.model_lifecycle ?? input.modelLifecycle ?? "available", "model lifecycle", 20);
  if (!MODEL_LIFECYCLES.has(lifecycle)) throw new Error("model lifecycleが不正です。");
  if (!Array.isArray(input.capabilities)) throw new Error("capabilitiesが不正です。");
  const capabilities = [];
  for (const capability of input.capabilities) {
    if (!CAPABILITIES.has(capability)) throw new Error("capabilitiesが不正です。");
    if (!capabilities.includes(capability)) capabilities.push(capability);
  }
  if (!Array.isArray(input.supported_mime_types ?? input.supportedMimeTypes)) {
    throw new Error("supported MIME typesが不正です。");
  }
  const supportedMimeTypes = [...new Set((input.supported_mime_types ?? input.supportedMimeTypes).map((mime) => normalizeMime(mime, "supported MIME type")))].sort();
  if (supportedMimeTypes.length === 0) throw new Error("supported MIME typesが不正です。");
  return {
    feature: TRANSCRIPTION_FEATURE,
    provider_profile_id: requiredText(input.provider_profile_id ?? input.providerProfileId, "provider profile ID", 160),
    provider_label: requiredText(input.provider_label ?? input.providerLabel, "provider label", MAX_LABEL_LENGTH),
    model_profile_id: requiredText(input.model_profile_id ?? input.modelProfileId, "model profile ID", 160),
    model_id: requiredText(input.model_id ?? input.modelId ?? input.model, "model ID", MAX_MODEL_LENGTH),
    processing_mode: processingMode,
    enabled: input.enabled !== false,
    credential_configured: (input.credential_configured ?? input.credentialConfigured) === true,
    model_lifecycle: lifecycle,
    capabilities: TRANSCRIPTION_CAPABILITIES.filter((item) => capabilities.includes(item)),
    max_file_size: positiveSafeInteger(input.max_file_size ?? input.maxFileSize, "max file size"),
    supported_mime_types: supportedMimeTypes,
  };
}

export function normalizeTranscriptBatchFeatureBinding(value) {
  const input = record(value);
  if (input.feature !== TRANSCRIPTION_FEATURE) throw new Error("transcript_batch feature bindingが不正です。");
  const processingMode = requiredText(input.processing_mode ?? input.processingMode, "processing mode", 20);
  if (!PROVIDER_PROCESSING_MODES.has(processingMode)) {
    throw new Error("transcript_batch processing modeが不正です。");
  }
  return {
    feature: TRANSCRIPTION_FEATURE,
    provider_profile_id: requiredText(input.provider_profile_id ?? input.providerProfileId, "provider profile ID", 160),
    model_profile_id: requiredText(input.model_profile_id ?? input.modelProfileId, "model profile ID", 160),
    processing_mode: processingMode,
  };
}

export function resolveTranscriptBatchFeatureBinding(featureBindingValue, availableBindingsValue) {
  const featureBinding = normalizeTranscriptBatchFeatureBinding(featureBindingValue);
  if (!Array.isArray(availableBindingsValue)) throw new Error("transcript provider bindingsが不正です。");
  const availableBindings = availableBindingsValue.map(normalizeTranscriptBatchBinding);
  const resolved = availableBindings.find((candidate) => (
    candidate.provider_profile_id === featureBinding.provider_profile_id
    && candidate.model_profile_id === featureBinding.model_profile_id
    && candidate.processing_mode === featureBinding.processing_mode
  ));
  return resolved
    ? { available: true, feature_binding: featureBinding, binding: resolved, reason: null }
    : {
      available: false,
      feature_binding: featureBinding,
      binding: null,
      reason: "binding_unavailable",
      message: "選択した文字起こしProviderまたはmodelを利用できません。別Providerへ自動切替しません。",
    };
}

export function resolveTranscriptBatchAvailability(sourceValue, bindingValue, visibilityValue) {
  const source = normalizeTranscriptionSource(sourceValue);
  const binding = normalizeTranscriptBatchBinding(bindingValue);
  const visibility = normalizeVisibility(visibilityValue);
  const unavailable = (reason, message) => ({ available: false, reason, message, source, binding, visibility });
  if (source.availability !== "available") {
    return unavailable(`source_${source.availability}`, "原音を安全に読み取れません。Artifactの状態を確認してください。");
  }
  if (!binding.enabled) return unavailable("provider_disabled", "Providerが無効です。設定を確認してください。");
  if (binding.model_lifecycle !== "available" && binding.model_lifecycle !== "experimental") {
    return unavailable("model_unavailable", "指定した文字起こしモデルを利用できません。設定を確認してください。");
  }
  if (!binding.capabilities.includes("batch_transcription")) {
    return unavailable("capability_missing", "Providerまたはmodelがbatch文字起こしに対応していません。");
  }
  if (binding.processing_mode === "local" && !binding.capabilities.includes("local_processing")) {
    return unavailable("local_capability_missing", "このProviderはlocal処理に対応していません。");
  }
  if (binding.processing_mode === "cloud" && binding.credential_configured !== true) {
    return unavailable("missing_credential", "Providerの資格情報を設定してください。");
  }
  if (!binding.supported_mime_types.includes(source.mime_type)) {
    return unavailable("unsupported_mime", "この音声形式は選択中のProviderで文字起こしできません。");
  }
  if (source.file_size > binding.max_file_size) {
    return unavailable("file_too_large", "音声がProviderの送信上限を超えています。");
  }
  if (binding.processing_mode === "cloud" && !visibility.includes("external_ai")) {
    return unavailable("visibility_blocked", "原音が外部AIへの公開範囲に含まれていません。");
  }
  return { available: true, reason: null, message: "文字起こしを実行できます。", source, binding, visibility };
}

export function buildTranscriptBatchPreview(sourceValue, bindingValue, visibilityValue) {
  const availability = resolveTranscriptBatchAvailability(sourceValue, bindingValue, visibilityValue);
  if (!availability.available) return availability;
  const { source, binding, visibility } = availability;
  return {
    available: true,
    feature: TRANSCRIPTION_FEATURE,
    artifact: source,
    provider: {
      provider_profile_id: binding.provider_profile_id,
      provider_label: binding.provider_label,
      model_profile_id: binding.model_profile_id,
      model_id: binding.model_id,
      model_lifecycle: binding.model_lifecycle,
      processing_mode: binding.processing_mode,
      sends_audio_to_provider: binding.processing_mode === "cloud",
    },
    visibility,
    message: availability.message,
  };
}

export function normalizeTranscriptBatchPreview(previewValue) {
  const preview = record(previewValue);
  if (preview.available !== true) throw new Error("実行できない文字起こしPreviewです。");
  const normalized = buildTranscriptBatchPreview(preview.artifact, {
    provider_profile_id: preview.provider?.provider_profile_id,
    provider_label: preview.provider?.provider_label,
    model_profile_id: preview.provider?.model_profile_id,
    model_id: preview.provider?.model_id,
    model_lifecycle: preview.provider?.model_lifecycle,
    processing_mode: preview.provider?.processing_mode,
    enabled: true,
    credential_configured: true,
    capabilities: preview.provider?.processing_mode === "local" ? ["batch_transcription", "local_processing"] : ["batch_transcription"],
    max_file_size: preview.artifact?.file_size,
    supported_mime_types: [preview.artifact?.mime_type],
  }, preview.visibility);
  if (!normalized.available) throw new Error("文字起こしPreviewが不正です。");
  return normalized;
}

export function parseTranscriptBatchRunRequest(value) {
  const input = exactRecord(value, ["artifactId", "confirmationToken", "operationId"], "文字起こし実行request");
  return Object.freeze({
    artifactId: requiredText(input.artifactId, "Artifact ID", 160),
    confirmationToken: requiredText(input.confirmationToken, "文字起こし確認token", 4096),
    operationId: requiredText(input.operationId, "operation ID", 160),
  });
}

export function normalizeTranscriptionError(value) {
  const input = record(value);
  const rawCode = typeof input.code === "string" && /^[a-z0-9_]{1,64}$/.test(input.code) ? input.code : "provider_failure";
  const code = Object.hasOwn(SAFE_PROVIDER_ERRORS, rawCode) ? rawCode : "provider_failure";
  return { code, message: SAFE_PROVIDER_ERRORS[code], retryable: !["invalid_request", "authentication", "unsupported", "model_unavailable", "cancelled"].includes(code) };
}

function revisionIdentity(value) {
  const input = record(value);
  const sourceHash = requiredText(input.source_content_hash ?? input.sourceContentHash, "source content hash", 71);
  if (!SHA256_PATTERN.test(sourceHash)) throw new Error("source content hashが不正です。");
  const processingMode = requiredText(input.processing_mode ?? input.processingMode, "processing mode", 20);
  if (!PROCESSING_MODES.has(processingMode)) throw new Error("processing modeが不正です。");
  return {
    source_artifact_id: requiredText(input.source_artifact_id ?? input.sourceArtifactId, "source Artifact ID", 160),
    source_content_hash: sourceHash,
    provider_profile_id: requiredText(input.provider_profile_id ?? input.providerProfileId, "provider profile ID", 160),
    model_profile_id: requiredText(input.model_profile_id ?? input.modelProfileId, "model profile ID", 160),
    model_id: requiredText(input.model_id ?? input.modelId ?? input.model, "model ID", MAX_MODEL_LENGTH),
    language: normalizeLanguage(input.language),
    processing_mode: processingMode,
  };
}

export function transcriptionAttemptKey(value) {
  const input = record(value);
  const operationId = requiredText(input.operation_id ?? input.operationId, "operation ID", 160);
  return `transcription-attempt/v1:${canonicalJson({ operation_id: operationId, ...revisionIdentity(input) })}`;
}

export function normalizeTranscriptionRevision(value) {
  const input = record(value);
  const identity = revisionIdentity(input);
  const status = requiredText(input.status, "revision status", 20);
  if (!REVISION_STATUSES.has(status)) throw new Error("revision statusが不正です。");
  const operationId = requiredText(input.operation_id ?? input.operationId, "operation ID", 160);
  const attemptKey = transcriptionAttemptKey({ operation_id: operationId, ...identity });
  if (input.attempt_key != null && input.attempt_key !== attemptKey) throw new Error("revision attempt keyが不正です。");
  const startedAt = input.started_at == null ? null : isoTimestamp(input.started_at, "started_at");
  const completedAt = input.completed_at == null ? null : isoTimestamp(input.completed_at, "completed_at");
  if (completedAt && !startedAt && status !== "cancelled") throw new Error("completed_atにはstarted_atが必要です。");
  if (completedAt && new Date(completedAt).getTime() < new Date(startedAt).getTime()) throw new Error("completed_atがstarted_atより前です。");
  if (["completed", "failed", "cancelled"].includes(status) && !completedAt) throw new Error("終了状態にはcompleted_atが必要です。");
  if (["queued", "processing"].includes(status) && completedAt) throw new Error("未完了状態にcompleted_atは保存できません。");
  if (status === "queued" && startedAt) throw new Error("queued revisionにstarted_atは保存できません。");
  if (["processing", "completed", "failed"].includes(status) && !startedAt) throw new Error(`${status} revisionにはstarted_atが必要です。`);
  const error = input.error_code == null || input.error_code === "" ? null : normalizeTranscriptionError({ code: String(input.error_code).slice(0, MAX_ERROR_CODE_LENGTH) }).code;
  if (status === "failed" && !error) throw new Error("failed revisionにはerror_codeが必要です。");
  if (status === "cancelled" && error !== "cancelled") throw new Error("cancelled revisionのerror_codeが不正です。");
  if (!["failed", "cancelled"].includes(status) && error) throw new Error("このrevision状態にerror_codeは保存できません。");
  const rawText = normalizeRawTranscript(input.raw_text ?? "");
  if (status !== "completed" && rawText) throw new Error("未完了revisionにraw transcriptは保存できません。");
  return {
    id: requiredText(input.id, "revision ID", 160),
    operation_id: operationId,
    attempt_key: attemptKey,
    ...identity,
    status,
    raw_text: status === "completed" ? rawText : "",
    started_at: startedAt,
    completed_at: completedAt,
    error_code: error,
  };
}

export function planTranscriptionRevision(historyValue, requestValue, options = {}) {
  const history = Array.isArray(historyValue) ? historyValue.map(normalizeTranscriptionRevision) : [];
  const request = record(requestValue);
  const identity = revisionIdentity(request);
  const operationId = requiredText(request.operation_id ?? request.operationId, "operation ID", 160);
  const attemptKey = transcriptionAttemptKey({ operation_id: operationId, ...identity });
  const existing = history.find((revision) => revision.attempt_key === attemptKey);
  if (existing) return { action: "reuse", revision: existing, history };
  if (history.some((revision) => revision.operation_id === operationId)) {
    throw new Error("同じoperation IDを別の原音・Provider・modelへ再利用できません。");
  }
  const revision = normalizeTranscriptionRevision({
    id: requiredText(options.revision_id ?? options.revisionId, "revision ID", 160),
    operation_id: operationId,
    ...identity,
    status: "queued",
    raw_text: "",
    started_at: null,
    completed_at: null,
    error_code: null,
  });
  return { action: "append", revision, history: [...history, revision] };
}

export function transitionTranscriptionRevision(revisionValue, transitionValue) {
  const current = normalizeTranscriptionRevision(revisionValue);
  const transition = record(transitionValue);
  const nextStatus = requiredText(transition.status, "revision status", 20);
  const allowed = {
    queued: ["processing", "cancelled"],
    processing: ["completed", "failed", "cancelled"],
    failed: ["processing"],
    cancelled: ["processing"],
    completed: [],
  };
  if (!allowed[current.status].includes(nextStatus)) throw new Error(`${current.status}から${nextStatus}へ変更できません。`);
  const at = isoTimestamp(transition.at, "transition at");
  const next = {
    ...current,
    status: nextStatus,
    raw_text: nextStatus === "completed" ? normalizeRawTranscript(transition.raw_text ?? "") : "",
    started_at: nextStatus === "processing" ? at : current.started_at,
    completed_at: ["completed", "failed", "cancelled"].includes(nextStatus) ? at : null,
    error_code: nextStatus === "failed"
      ? normalizeTranscriptionError(transition.error).code
      : nextStatus === "cancelled" ? "cancelled" : null,
    language: transition.language == null ? current.language : normalizeLanguage(transition.language),
  };
  return normalizeTranscriptionRevision(next);
}

export function projectTranscriptionDiagnostic(revisionValue) {
  const revision = normalizeTranscriptionRevision(revisionValue);
  return {
    revision_id: revision.id,
    source_artifact_id: revision.source_artifact_id,
    source_hash_prefix: revision.source_content_hash.slice(0, 12),
    provider_profile_id: revision.provider_profile_id,
    model_profile_id: revision.model_profile_id,
    processing_mode: revision.processing_mode,
    status: revision.status,
    error_code: revision.error_code,
    transcript_length: revision.raw_text.length,
  };
}
