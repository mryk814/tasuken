export const TRANSCRIPTION_PROCESSING_MODES = ["cloud", "local", "external"];
export const TRANSCRIPTION_REVISION_STATUSES = [
  "queued",
  "processing",
  "completed",
  "failed",
  "cancelled",
];
export const MAX_RAW_TRANSCRIPT_CHARS = 2_000_000;

const PROCESSING_MODES = new Set(TRANSCRIPTION_PROCESSING_MODES);
const REVISION_STATUSES = new Set(TRANSCRIPTION_REVISION_STATUSES);
const SHA256_PATTERN = /^sha256:[a-f0-9]{64}$/;
const ISO_LANGUAGE_PATTERN = /^[a-z]{2,3}(?:-[A-Za-z0-9]{2,8})*$/;
const MAX_MODEL_LENGTH = 240;
const MAX_ERROR_CODE_LENGTH = 64;
const SAFE_ERRORS = new Set([
  "invalid_request",
  "missing_credential",
  "authentication",
  "quota",
  "rate_limit",
  "timeout",
  "cancelled",
  "unsupported",
  "model_unavailable",
  "provider_failure",
]);

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

function isoTimestamp(value, field) {
  const result = requiredText(value, field, 40);
  const date = new Date(result);
  if (Number.isNaN(date.getTime()) || date.toISOString() !== result)
    throw new Error(`${field}が不正です。`);
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

function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`)
      .join(",")}}`;
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

export function normalizeTranscriptionError(value) {
  const input = record(value);
  const rawCode = typeof input.code === "string" ? input.code.slice(0, MAX_ERROR_CODE_LENGTH) : "";
  return SAFE_ERRORS.has(rawCode) ? rawCode : "provider_failure";
}

function revisionIdentity(value) {
  const input = record(value);
  const sourceHash = requiredText(
    input.source_content_hash ?? input.sourceContentHash,
    "source content hash",
    71,
  );
  if (!SHA256_PATTERN.test(sourceHash)) throw new Error("source content hashが不正です。");
  const processingMode = requiredText(
    input.processing_mode ?? input.processingMode,
    "processing mode",
    20,
  );
  if (!PROCESSING_MODES.has(processingMode)) throw new Error("processing modeが不正です。");
  return {
    source_artifact_id: requiredText(
      input.source_artifact_id ?? input.sourceArtifactId,
      "source Artifact ID",
      160,
    ),
    source_content_hash: sourceHash,
    provider_profile_id: requiredText(
      input.provider_profile_id ?? input.providerProfileId,
      "provider profile ID",
      160,
    ),
    model_profile_id: requiredText(
      input.model_profile_id ?? input.modelProfileId,
      "model profile ID",
      160,
    ),
    model_id: requiredText(
      input.model_id ?? input.modelId ?? input.model,
      "model ID",
      MAX_MODEL_LENGTH,
    ),
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
  if (input.attempt_key != null && input.attempt_key !== attemptKey)
    throw new Error("revision attempt keyが不正です。");
  const startedAt = input.started_at == null ? null : isoTimestamp(input.started_at, "started_at");
  const completedAt =
    input.completed_at == null ? null : isoTimestamp(input.completed_at, "completed_at");
  if (completedAt && !startedAt && status !== "cancelled")
    throw new Error("completed_atにはstarted_atが必要です。");
  if (completedAt && startedAt && new Date(completedAt).getTime() < new Date(startedAt).getTime())
    throw new Error("completed_atがstarted_atより前です。");
  if (["completed", "failed", "cancelled"].includes(status) && !completedAt)
    throw new Error("終了状態にはcompleted_atが必要です。");
  if (["queued", "processing"].includes(status) && completedAt)
    throw new Error("未完了状態にcompleted_atは保存できません。");
  if (status === "queued" && startedAt)
    throw new Error("queued revisionにstarted_atは保存できません。");
  if (["processing", "completed", "failed"].includes(status) && !startedAt)
    throw new Error(`${status} revisionにはstarted_atが必要です。`);
  const error =
    input.error_code == null || input.error_code === ""
      ? null
      : normalizeTranscriptionError({ code: input.error_code });
  if (status === "failed" && !error) throw new Error("failed revisionにはerror_codeが必要です。");
  if (status === "cancelled" && error !== "cancelled")
    throw new Error("cancelled revisionのerror_codeが不正です。");
  if (!["failed", "cancelled"].includes(status) && error)
    throw new Error("このrevision状態にerror_codeは保存できません。");
  const rawText = normalizeRawTranscript(input.raw_text ?? "");
  if (status !== "completed" && rawText)
    throw new Error("未完了revisionにraw transcriptは保存できません。");
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
