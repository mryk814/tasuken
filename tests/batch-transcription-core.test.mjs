import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  buildTranscriptBatchPreview,
  MAX_RAW_TRANSCRIPT_CHARS,
  normalizeTranscriptionError,
  normalizeTranscriptionRevision,
  planTranscriptionRevision,
  parseTranscriptBatchRunRequest,
  projectTranscriptionDiagnostic,
  resolveTranscriptBatchAvailability,
  resolveTranscriptBatchFeatureBinding,
  transitionTranscriptionRevision,
} from "../src/shared/batchTranscription.mjs";
import {
  createInMemoryBatchTranscriptionClaimStore,
  createVerifiedTranscriptionSource,
  invokeConfirmedBatchTranscription,
  issueTranscriptBatchConfirmation,
  verifyTranscriptBatchConfirmation,
} from "../src/main/services/batchTranscriptionConfirmation.mjs";

const HASH = `sha256:${"a".repeat(64)}`;
const SECRET = "main-owned-confirmation-secret-32-bytes-minimum";
const NOW = "2026-08-09T08:00:00.000Z";
const OPERATION_ID = "operation-1";

function source(overrides = {}) {
  return { artifact_id: "artifact-audio-1", content_hash: HASH, mime_type: "audio/wav", file_size: 1024, availability: "available", ...overrides };
}

function binding(overrides = {}) {
  return {
    provider_profile_id: "provider-openai",
    provider_label: "OpenAI",
    model_profile_id: "model-transcribe",
    model_id: "gpt-4o-transcribe",
    processing_mode: "cloud",
    enabled: true,
    credential_configured: true,
    model_lifecycle: "available",
    capabilities: ["batch_transcription", "language_detection"],
    max_file_size: 25 * 1024 * 1024,
    supported_mime_types: [
      "audio/flac",
      "audio/mpeg",
      "audio/mp4",
      "audio/mpga",
      "audio/m4a",
      "audio/ogg",
      "audio/wav",
      "audio/webm",
    ],
    ...overrides,
  };
}

function preview(sourceOverrides = {}, bindingOverrides = {}, visibility = ["external_ai"]) {
  return buildTranscriptBatchPreview(source(sourceOverrides), binding(bindingOverrides), visibility);
}

function issueConfirmation(target, overrides = {}) {
  return issueTranscriptBatchConfirmation(target, {
    secret: SECRET,
    now: NOW,
    ttl_ms: 60_000,
    nonce: "nonce-0123456789",
    operation_id: OPERATION_ID,
    ...overrides,
  });
}

function verifyConfirmation(token, target, overrides = {}) {
  return verifyTranscriptBatchConfirmation(token, target, {
    secret: SECRET,
    now: NOW,
    operation_id: OPERATION_ID,
    ...overrides,
  });
}

function revision(overrides = {}) {
  return normalizeTranscriptionRevision({
    id: "revision-1",
    operation_id: "operation-1",
    source_artifact_id: "artifact-audio-1",
    source_content_hash: HASH,
    provider_profile_id: "provider-openai",
    model_profile_id: "model-transcribe",
    model_id: "gpt-4o-transcribe",
    language: "ja",
    processing_mode: "cloud",
    status: "queued",
    raw_text: "",
    started_at: null,
    completed_at: null,
    error_code: null,
    ...overrides,
  });
}

test("feature binding rejects unavailable source, missing capability, MIME, size, credential, visibility and local mismatch before provider call", () => {
  const cases = [
    [source({ availability: "missing" }), binding(), ["external_ai"], "source_missing"],
    [source(), binding({ capabilities: [] }), ["external_ai"], "capability_missing"],
    [source(), binding({ supported_mime_types: ["audio/mpeg"] }), ["external_ai"], "unsupported_mime"],
    [source({ file_size: 2048 }), binding({ max_file_size: 1024 }), ["external_ai"], "file_too_large"],
    [source(), binding({ credential_configured: false }), ["external_ai"], "missing_credential"],
    [source(), binding(), [], "visibility_blocked"],
    [source(), binding({ processing_mode: "local" }), [], "local_capability_missing"],
  ];
  for (const [audio, profile, visibility, reason] of cases) {
    assert.deepEqual(resolveTranscriptBatchAvailability(audio, profile, visibility).reason, reason);
  }
  assert.equal(resolveTranscriptBatchAvailability(source(), binding(), ["external_ai"]).available, true);
  assert.throws(() => resolveTranscriptBatchAvailability(source(), binding({ processing_mode: "external" }), ["external_ai"]), /provider processing mode/);
  assert.throws(() => resolveTranscriptBatchAvailability(source({ content_hash: "a".repeat(64) }), binding(), ["external_ai"]), /content hash/);
  assert.throws(() => resolveTranscriptBatchAvailability(source({ content_hash: `SHA256:${"A".repeat(64)}` }), binding(), ["external_ai"]), /content hash/);
});

test("shared transcription contract is Renderer-bundleable and does not import Node built-ins", () => {
  const shared = readFileSync("src/shared/batchTranscription.mjs", "utf8");
  assert.doesNotMatch(shared, /node:crypto|\bBuffer\b|createHash|createHmac|timingSafeEqual/);
  assert.match(readFileSync("src/main/services/batchTranscriptionConfirmation.mjs", "utf8"), /node:crypto/);
});

test("transcript_batch feature binding resolves only the explicitly selected provider/model without fallback", () => {
  const selected = {
    feature: "transcript_batch",
    provider_profile_id: "provider-selected",
    model_profile_id: "model-selected",
    processing_mode: "cloud",
  };
  const alternate = binding({ provider_profile_id: "provider-alternate", model_profile_id: "model-alternate" });
  const unavailable = resolveTranscriptBatchFeatureBinding(selected, [alternate]);
  assert.equal(unavailable.available, false);
  assert.equal(unavailable.binding, null);
  assert.equal(unavailable.reason, "binding_unavailable");
  const exact = binding({ provider_profile_id: "provider-selected", model_profile_id: "model-selected" });
  const resolved = resolveTranscriptBatchFeatureBinding(selected, [alternate, exact]);
  assert.equal(resolved.available, true);
  assert.equal(resolved.binding.provider_profile_id, "provider-selected");
  assert.equal(resolved.binding.model_profile_id, "model-selected");
});

test("Preview is path/bytes/credential free and declares target, provider, model, mode, visibility and cloud transfer", () => {
  const result = buildTranscriptBatchPreview(
    { ...source(), absolute_path: "C:\\Users\\secret\\voice.wav", bytes: "private-audio" },
    { ...binding(), credential: "sk-private", endpoint: "https://secret.example" },
    ["external_ai"],
  );
  assert.deepEqual(result.artifact, source());
  assert.equal(result.provider.provider_profile_id, "provider-openai");
  assert.equal(result.provider.model_id, "gpt-4o-transcribe");
  assert.equal(result.provider.model_lifecycle, "available");
  assert.equal(result.provider.sends_audio_to_provider, true);
  assert.deepEqual(result.visibility, ["external_ai"]);
  const serialized = JSON.stringify(result);
  for (const secret of ["C:\\Users\\secret", "private-audio", "sk-private", "secret.example"]) assert.equal(serialized.includes(secret), false);
});

test("Renderer run request accepts only Artifact ID, confirmation token and operation ID", () => {
  assert.deepEqual(parseTranscriptBatchRunRequest({
    artifactId: "artifact-audio-1",
    confirmationToken: "signed-token",
    operationId: OPERATION_ID,
  }), {
    artifactId: "artifact-audio-1",
    confirmationToken: "signed-token",
    operationId: OPERATION_ID,
  });
  for (const extra of [
    { path: "C:\\private\\voice.wav" },
    { bytes: "raw-audio" },
    { providerId: "provider-other" },
  ]) {
    assert.throws(() => parseTranscriptBatchRunRequest({
      artifactId: "artifact-audio-1",
      confirmationToken: "signed-token",
      operationId: OPERATION_ID,
      ...extra,
    }), /未定義field/);
  }
});

test("confirmation token is short-lived and bound to Artifact hash, provider, model, mode and visibility", () => {
  const target = preview();
  const token = issueConfirmation(target);
  assert.ok(verifyConfirmation(token, target, { now: "2026-08-09T08:00:30.000Z" }));
  for (const changed of [
    preview({ content_hash: `sha256:${"b".repeat(64)}` }),
    preview({}, { provider_profile_id: "provider-other" }),
    preview({}, { model_id: "model-other" }),
    preview({}, { processing_mode: "local", capabilities: ["batch_transcription", "local_processing"], credential_configured: false }, []),
    preview({}, {}, ["m365", "external_ai"]),
  ]) {
    assert.throws(() => verifyConfirmation(token, changed, { now: "2026-08-09T08:00:30.000Z" }), /変わりました/);
  }
  assert.throws(() => verifyConfirmation(`${token.slice(0, -1)}x`, target), /一致しません/);
  assert.throws(() => verifyConfirmation(token, target, { now: "2026-08-09T08:01:00.001Z" }), /期限/);
  assert.throws(() => verifyConfirmation(token, target, { operation_id: "operation-other" }), /operation/);
  assert.equal(token.includes(HASH), false);
  assert.equal(token.includes(SECRET), false);
});

test("fake provider is called only with verified authorization and canonical source metadata", async () => {
  const target = preview();
  const token = issueConfirmation(target);
  const authorization = verifyConfirmation(token, target, { now: "2026-08-09T08:00:30.000Z" });
  const descriptor = { kind: "main-owned-descriptor", opaque: true };
  const verifiedSource = createVerifiedTranscriptionSource(source(), descriptor);
  const claimStore = createInMemoryBatchTranscriptionClaimStore();
  let calls = 0;
  const provider = {
    providerProfileId: "provider-openai",
    async transcribe(request) {
      calls += 1;
      assert.equal(request.source, descriptor);
      assert.equal(request.artifactId, "artifact-audio-1");
      assert.equal(request.contentHash, HASH);
      assert.equal(Object.hasOwn(request, "path"), false);
      assert.equal(Object.hasOwn(request, "credential"), false);
      return { rawText: "一行目\r\n二行目", language: "ja" };
    },
  };
  await assert.rejects(() => invokeConfirmedBatchTranscription({ preview: target, binding: binding(), provider, verifiedSource, claimStore, now: "2026-08-09T08:00:30.000Z" }), /明示確認/);
  assert.equal(calls, 0);
  const result = await invokeConfirmedBatchTranscription({ authorization, preview: target, binding: binding(), provider, verifiedSource, claimStore, language: "ja", now: "2026-08-09T08:00:30.000Z" });
  assert.deepEqual(result, { raw_text: "一行目\n二行目", language: "ja", reused: false });
  assert.equal(calls, 1);
  assert.equal((await invokeConfirmedBatchTranscription({ authorization, preview: target, binding: binding(), provider, verifiedSource, claimStore, now: "2026-08-09T08:00:30.000Z" })).reused, true);
  assert.equal(calls, 1);
  await assert.rejects(
    () => invokeConfirmedBatchTranscription({ authorization, preview: target, binding: binding(), provider, verifiedSource, claimStore, now: "2026-08-09T08:01:00.001Z" }),
    /期限/,
  );
  assert.equal(calls, 1);
  await assert.rejects(
    () => invokeConfirmedBatchTranscription({ authorization, preview: target, binding: binding({ processing_mode: "external" }), provider, verifiedSource, claimStore, now: "2026-08-09T08:00:30.000Z" }),
    /provider processing mode/,
  );
  assert.equal(calls, 1);
});

test("confirmed invocation rechecks current source and provider capability before provider call", async () => {
  const target = preview();
  const authorization = verifyConfirmation(issueConfirmation(target), target);
  let calls = 0;
  const provider = { providerProfileId: "provider-openai", async transcribe() { calls += 1; return { rawText: "text", language: "ja" }; } };
  const claimStore = createInMemoryBatchTranscriptionClaimStore();
  for (const changedBinding of [
    binding({ enabled: false }),
    binding({ credential_configured: false }),
    binding({ model_lifecycle: "unavailable" }),
    binding({ capabilities: [] }),
    binding({ supported_mime_types: ["audio/mpeg"] }),
    binding({ max_file_size: 1 }),
  ]) {
    await assert.rejects(() => invokeConfirmedBatchTranscription({
      authorization,
      preview: target,
      binding: changedBinding,
      provider,
      verifiedSource: createVerifiedTranscriptionSource(source(), {}),
      claimStore,
      now: NOW,
    }));
  }
  await assert.rejects(() => invokeConfirmedBatchTranscription({
    authorization,
    preview: target,
    binding: binding(),
    provider,
    verifiedSource: createVerifiedTranscriptionSource(source({ content_hash: `sha256:${"b".repeat(64)}` }), {}),
    claimStore,
    now: NOW,
  }), /原音がPreview後に変わりました/);
  await assert.rejects(() => invokeConfirmedBatchTranscription({
    authorization,
    preview: target,
    binding: binding(),
    provider,
    verifiedSource: {},
    claimStore,
    now: NOW,
  }), /Mainで再検証/);
  assert.equal(calls, 0);
});

test("experimental model lifecycle survives Preview normalization, confirmation and invocation", async () => {
  const target = preview({}, { model_lifecycle: "experimental" });
  assert.equal(target.provider.model_lifecycle, "experimental");
  const token = issueConfirmation(target, { nonce: "experimental-nonce" });
  const authorization = verifyConfirmation(token, target);
  let calls = 0;
  const result = await invokeConfirmedBatchTranscription({
    authorization,
    preview: target,
    binding: binding({ model_lifecycle: "experimental" }),
    provider: { providerProfileId: "provider-openai", async transcribe() { calls += 1; return { rawText: "experimental", language: "ja" }; } },
    verifiedSource: createVerifiedTranscriptionSource(source(), {}),
    claimStore: createInMemoryBatchTranscriptionClaimStore(),
    now: NOW,
  });
  assert.equal(result.raw_text, "experimental");
  assert.equal(calls, 1);
});

test("provider result and completed revision reject raw transcript above the explicit persistence limit", async () => {
  const target = preview();
  const token = issueConfirmation(target);
  const authorization = verifyConfirmation(token, target);
  let calls = 0;
  const provider = {
    providerProfileId: "provider-openai",
    async transcribe() {
      calls += 1;
      return { rawText: "x".repeat(MAX_RAW_TRANSCRIPT_CHARS + 1), language: "ja" };
    },
  };
  await assert.rejects(
    () => invokeConfirmedBatchTranscription({ authorization, preview: target, binding: binding(), provider, verifiedSource: createVerifiedTranscriptionSource(source(), {}), claimStore: createInMemoryBatchTranscriptionClaimStore(), now: NOW }),
    (error) => error.projection?.code === "provider_failure",
  );
  assert.equal(calls, 1);
  const processing = transitionTranscriptionRevision(revision(), { status: "processing", at: "2026-08-09T08:01:00.000Z" });
  assert.throws(
    () => transitionTranscriptionRevision(processing, { status: "completed", at: "2026-08-09T08:02:00.000Z", raw_text: "x".repeat(MAX_RAW_TRANSCRIPT_CHARS + 1) }),
    new RegExp(String(MAX_RAW_TRANSCRIPT_CHARS)),
  );
  const accepted = transitionTranscriptionRevision(processing, { status: "completed", at: "2026-08-09T08:02:00.000Z", raw_text: "x".repeat(MAX_RAW_TRANSCRIPT_CHARS) });
  assert.equal(accepted.raw_text.length, MAX_RAW_TRANSCRIPT_CHARS);
});

test("provider errors are allowlisted and never expose raw path, credential or provider message", async () => {
  const target = preview();
  const token = issueConfirmation(target);
  const authorization = verifyConfirmation(token, target);
  const provider = {
    providerProfileId: "provider-openai",
    async transcribe() {
      throw { code: "../../C:/private/sk-secret", message: "C:\\private\\voice.wav sk-secret" };
    },
  };
  await assert.rejects(
    () => invokeConfirmedBatchTranscription({ authorization, preview: target, binding: binding(), provider, verifiedSource: createVerifiedTranscriptionSource(source(), {}), claimStore: createInMemoryBatchTranscriptionClaimStore(), now: NOW }),
    (error) => {
      assert.deepEqual(error.projection, normalizeTranscriptionError({ code: "unknown", message: "sk-secret" }));
      assert.equal(error.message.includes("private"), false);
      assert.equal(error.message.includes("secret"), false);
      return true;
    },
  );
});

test("retry reuses one revision while a new operation appends history without overwriting raw transcript", () => {
  const request = {
    operation_id: "operation-1",
    source_artifact_id: "artifact-audio-1",
    source_content_hash: HASH,
    provider_profile_id: "provider-openai",
    model_profile_id: "model-transcribe",
    model_id: "gpt-4o-transcribe",
    language: "ja",
    processing_mode: "cloud",
  };
  const first = planTranscriptionRevision([], request, { revision_id: "revision-1" });
  assert.equal(first.action, "append");
  const retry = planTranscriptionRevision(first.history, request, { revision_id: "must-not-be-used" });
  assert.equal(retry.action, "reuse");
  assert.equal(retry.history.length, 1);
  assert.equal(retry.revision.id, "revision-1");

  const processing = transitionTranscriptionRevision(first.revision, { status: "processing", at: "2026-08-09T08:01:00.000Z" });
  const completed = transitionTranscriptionRevision(processing, { status: "completed", at: "2026-08-09T08:02:00.000Z", raw_text: "raw transcript", language: "ja" });
  const rerun = planTranscriptionRevision([completed], { ...request, operation_id: "operation-2", model_id: "gpt-4o-mini-transcribe" }, { revision_id: "revision-2" });
  assert.equal(rerun.action, "append");
  assert.equal(rerun.history.length, 2);
  assert.equal(rerun.history[0].raw_text, "raw transcript");
  assert.equal(rerun.history[1].raw_text, "");
  assert.throws(() => planTranscriptionRevision([completed], { ...request, model_id: "other-model" }, { revision_id: "revision-x" }), /operation ID/);
});

test("failed/cancelled revisions retain source identity, retry in place, and diagnostics omit transcript", () => {
  const cancelledBeforeStart = transitionTranscriptionRevision(revision(), { status: "cancelled", at: "2026-08-09T08:00:30.000Z" });
  assert.equal(cancelledBeforeStart.started_at, null);
  assert.equal(cancelledBeforeStart.error_code, "cancelled");
  const processing = transitionTranscriptionRevision(revision(), { status: "processing", at: "2026-08-09T08:01:00.000Z" });
  const failed = transitionTranscriptionRevision(processing, { status: "failed", at: "2026-08-09T08:02:00.000Z", error: { code: "timeout", message: "C:\\private\\voice.wav" } });
  assert.equal(failed.error_code, "timeout");
  assert.equal(failed.source_content_hash, HASH);
  const retry = transitionTranscriptionRevision(failed, { status: "processing", at: "2026-08-09T08:03:00.000Z" });
  assert.equal(retry.id, failed.id);
  assert.equal(retry.attempt_key, failed.attempt_key);
  const cancelled = transitionTranscriptionRevision(retry, { status: "cancelled", at: "2026-08-09T08:04:00.000Z" });
  assert.equal(cancelled.error_code, "cancelled");
  const diagnostic = projectTranscriptionDiagnostic({ ...failed, raw_text: "" });
  assert.equal(Object.hasOwn(diagnostic, "raw_text"), false);
  assert.equal(JSON.stringify(diagnostic).includes("private"), false);
  assert.throws(() => transitionTranscriptionRevision(completedRevision(), { status: "processing", at: "2026-08-09T08:03:00.000Z" }), /変更できません/);
});

function completedRevision() {
  const processing = transitionTranscriptionRevision(revision(), { status: "processing", at: "2026-08-09T08:01:00.000Z" });
  return transitionTranscriptionRevision(processing, { status: "completed", at: "2026-08-09T08:02:00.000Z", raw_text: "original" });
}

test("revision normalization keeps cloud/local/external provenance and rejects inconsistent terminal state", () => {
  for (const processing_mode of ["cloud", "local", "external"]) {
    assert.equal(revision({ processing_mode }).processing_mode, processing_mode);
  }
  assert.throws(() => revision({ status: "completed", raw_text: "text", completed_at: NOW, started_at: null }), /started_at/);
  assert.throws(() => revision({ status: "failed", started_at: NOW, completed_at: NOW, error_code: null }), /error_code/);
  assert.throws(() => revision({ status: "processing", raw_text: "must not persist", started_at: NOW }), /raw transcript/);
  assert.throws(() => revision({ status: "processing", started_at: null }), /started_at/);
  assert.throws(() => revision({ status: "queued", started_at: NOW }), /queued revision/);
});
