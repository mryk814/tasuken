import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { WorkspaceDatabase } from "../src/main/repositories/workspaceRepository.mjs";
import { BatchTranscriptionRepository } from "../src/main/repositories/batchTranscriptionRepository.mjs";
import { BatchTranscriptionService } from "../src/main/services/batchTranscriptionService.mjs";
import { transcriptBatchPreviewFingerprint } from "../src/main/services/batchTranscriptionConfirmation.mjs";

const NOW = "2026-08-09T10:00:00.000Z";
const CAPTURE_ID = "11111111-1111-4111-8111-111111111111";
const ARTIFACT_ID = "22222222-2222-4222-8222-222222222222";

function binding() {
  return {
    feature: "transcript_batch",
    provider_profile_id: "provider-fake",
    provider_label: "Fake local test provider",
    model_profile_id: "model-fake",
    model_id: "fake-transcriber-1",
    processing_mode: "cloud",
    enabled: true,
    credential_configured: true,
    model_lifecycle: "available",
    capabilities: ["batch_transcription", "language_detection"],
    max_file_size: 1024 * 1024,
    supported_mime_types: ["audio/wav"],
  };
}

function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "tasken-transcription-"));
  const filePath = path.join(root, "voice.wav");
  const bytes = Buffer.from("RIFFfake-WAVE-audio-for-batch-transcription");
  fs.writeFileSync(filePath, bytes);
  const hash = `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
  const database = new WorkspaceDatabase(path.join(root, "workspace.sqlite"));
  database.save("capture_entry", {
    id: CAPTURE_ID,
    title: "Voice memo",
    text: "voice.wav",
    kind: "voice_memo",
    content_type: "audio",
    capture_method: "audio_import",
    media_status: "ready",
    transcription_status: "not_requested",
    captured_at: NOW,
    state: "untriaged",
    project_id: null,
    ai_visibility: ["external_ai"],
  });
  database.save("artifact", {
    id: ARTIFACT_ID,
    title: "Voice memo",
    filename: "voice.wav",
    file_type: "wav",
    mime_type: "audio/wav",
    file_size: bytes.byteLength,
    stored_path: filePath,
    original_path: null,
    storage_mode: "managed",
    copied_at: NOW,
    source_type: "capture_entry",
    source_id: CAPTURE_ID,
    theme_id: null,
    media_kind: "audio",
    duration_ms: 1000,
    container: "wav",
    content_hash: hash,
    media_availability: "available",
    ai_visibility: ["external_ai"],
  });
  const mediaCapture = {
    resolveArtifactMedia(artifactId) {
      const artifact = database.get("artifact", artifactId);
      if (!artifact || !fs.existsSync(filePath)) return { availability: "missing" };
      const current = fs.readFileSync(filePath);
      const currentHash = `sha256:${createHash("sha256").update(current).digest("hex")}`;
      if (currentHash !== artifact.content_hash || current.byteLength !== artifact.file_size) return { availability: "changed" };
      return { availability: "available", fileDescriptor: fs.openSync(filePath, "r"), mimeType: artifact.mime_type, fileSize: artifact.file_size };
    },
  };
  return { root, filePath, bytes, hash, database, mediaCapture };
}

function createService(state, transcribe, now = () => NOW) {
  const repository = new BatchTranscriptionRepository(state.database);
  return new BatchTranscriptionService({
    repository,
    entityRepository: state.database,
    mediaCapture: state.mediaCapture,
    providerRegistry: {
      resolve: () => ({
        binding: binding(),
        provider: { providerProfileId: "provider-fake", transcribe },
      }),
    },
    confirmationSecret: "test-confirmation-secret-at-least-32-bytes",
    resolveVisibility: (artifact) => artifact.ai_visibility,
    now,
    idFactory: randomUUID,
  });
}

test("fake provider SQLite E2E confirms, sends one verified descriptor, and appends raw provenance", async (t) => {
  const state = fixture();
  t.after(() => { state.database.db.close(); fs.rmSync(state.root, { recursive: true, force: true }); });
  let calls = 0;
  const service = createService(state, async ({ source, artifactId, contentHash, fileSize }) => {
    calls += 1;
    assert.equal(artifactId, ARTIFACT_ID);
    assert.equal(contentHash, state.hash);
    const received = Buffer.alloc(fileSize);
    assert.equal(fs.readSync(source.fileDescriptor, received, 0, fileSize, 0), fileSize);
    assert.deepEqual(received, state.bytes);
    return { rawText: "これは fake provider の raw transcript です。", language: "ja" };
  });

  const preview = service.preview({ artifactId: ARTIFACT_ID });
  assert.equal(preview.available, true);
  assert.equal(preview.provider.sends_audio_to_provider, true);
  assert.equal("path" in preview.artifact, false);
  assert.equal("bytes" in preview.artifact, false);
  const result = await service.run({
    artifactId: ARTIFACT_ID,
    operationId: preview.operationId,
    confirmationToken: preview.confirmationToken,
  });
  assert.equal(calls, 1);
  assert.equal(result.revision.status, "completed");
  assert.equal(result.revision.raw_text, "これは fake provider の raw transcript です。");
  assert.equal(result.revision.source_content_hash, state.hash);
  assert.equal(result.revision.provider_profile_id, "provider-fake");
  assert.equal(result.revisions.length, 1);
  assert.deepEqual(state.database.get("capture_entry", CAPTURE_ID).transcription_revisions, result.revisions);
  assert.deepEqual(state.database.get("artifact", ARTIFACT_ID).transcription_revisions, result.revisions);
  assert.equal(state.database.getMeta().schemaVersion, 4);
});

test("retry reuses one durable revision and a new run appends without overwriting history", async (t) => {
  const state = fixture();
  t.after(() => { state.database.db.close(); fs.rmSync(state.root, { recursive: true, force: true }); });
  let calls = 0;
  const service = createService(state, async () => {
    calls += 1;
    if (calls === 1) throw { code: "timeout", detail: "must not escape" };
    return { rawText: calls === 2 ? "retry transcript" : "rerun transcript", language: "ja" };
  });

  const firstPreview = service.preview({ artifactId: ARTIFACT_ID });
  await assert.rejects(service.run({
    artifactId: ARTIFACT_ID,
    operationId: firstPreview.operationId,
    confirmationToken: firstPreview.confirmationToken,
  }), /時間/);
  const failed = service.history({ artifactId: ARTIFACT_ID });
  assert.equal(failed.revisions.length, 1);
  assert.equal(failed.revisions[0].status, "failed");
  assert.equal(failed.revisions[0].error_code, "timeout");

  const retryPreview = service.preview({ artifactId: ARTIFACT_ID });
  assert.equal(retryPreview.operationId, firstPreview.operationId);
  const retried = await service.run({
    artifactId: ARTIFACT_ID,
    operationId: retryPreview.operationId,
    confirmationToken: retryPreview.confirmationToken,
  });
  assert.equal(retried.revisions.length, 1);
  assert.equal(retried.revision.id, failed.revisions[0].id);
  assert.equal(retried.revision.raw_text, "retry transcript");

  const rerunPreview = service.preview({ artifactId: ARTIFACT_ID });
  assert.notEqual(rerunPreview.operationId, retryPreview.operationId);
  const rerun = await service.run({
    artifactId: ARTIFACT_ID,
    operationId: rerunPreview.operationId,
    confirmationToken: rerunPreview.confirmationToken,
  });
  assert.equal(rerun.revisions.length, 2);
  assert.equal(rerun.revisions[0].raw_text, "retry transcript");
  assert.equal(rerun.revisions[1].raw_text, "rerun transcript");
});

test("source change after Preview rejects before provider and keeps owner input", async (t) => {
  const state = fixture();
  t.after(() => { state.database.db.close(); fs.rmSync(state.root, { recursive: true, force: true }); });
  let calls = 0;
  const service = createService(state, async () => { calls += 1; return { rawText: "not reached" }; });
  const preview = service.preview({ artifactId: ARTIFACT_ID });
  fs.appendFileSync(state.filePath, "changed");
  await assert.rejects(service.run({
    artifactId: ARTIFACT_ID,
    operationId: preview.operationId,
    confirmationToken: preview.confirmationToken,
  }), /原音/);
  assert.equal(calls, 0);
  assert.equal(state.database.get("capture_entry", CAPTURE_ID).text, "voice.wav");
  assert.equal(service.history({ artifactId: ARTIFACT_ID }).revisions.length, 0);
});

test("preview closes the verified descriptor when visibility resolution fails", (t) => {
  const state = fixture();
  t.after(() => { state.database.db.close(); fs.rmSync(state.root, { recursive: true, force: true }); });
  const repository = new BatchTranscriptionRepository(state.database);
  let openedDescriptor = null;
  const mediaCapture = {
    resolveArtifactMedia(artifactId) {
      const resolution = state.mediaCapture.resolveArtifactMedia(artifactId);
      if (resolution.availability === "available") openedDescriptor = resolution.fileDescriptor;
      return resolution;
    },
  };
  const service = new BatchTranscriptionService({
    repository,
    entityRepository: state.database,
    mediaCapture,
    providerRegistry: { resolve: () => ({ binding: binding(), provider: { transcribe: async () => ({ rawText: "unused" }) } }) },
    confirmationSecret: "test-confirmation-secret-at-least-32-bytes",
    resolveVisibility: () => { throw new Error("visibility resolution failed"); },
    now: () => NOW,
    idFactory: randomUUID,
  });

  assert.throws(() => service.preview({ artifactId: ARTIFACT_ID }), /visibility resolution failed/);
  assert.equal(typeof openedDescriptor, "number");
  assert.throws(() => fs.fstatSync(openedDescriptor), { code: "EBADF" });
});

test("cloud send stays blocked without visibility or confirmation and never calls provider", async (t) => {
  const state = fixture();
  t.after(() => { state.database.db.close(); fs.rmSync(state.root, { recursive: true, force: true }); });
  let calls = 0;
  const service = createService(state, async () => { calls += 1; return { rawText: "not reached", language: "ja" }; });
  const artifact = state.database.get("artifact", ARTIFACT_ID);
  state.database.save("artifact", { ...artifact, ai_visibility: [] });
  const blocked = service.preview({ artifactId: ARTIFACT_ID });
  assert.equal(blocked.available, false);
  assert.equal(blocked.reason, "visibility_blocked");
  assert.equal("confirmationToken" in blocked, false);
  state.database.save("artifact", { ...state.database.get("artifact", ARTIFACT_ID), ai_visibility: ["external_ai"] });
  const preview = service.preview({ artifactId: ARTIFACT_ID });
  await assert.rejects(service.run({
    artifactId: ARTIFACT_ID,
    operationId: preview.operationId,
    confirmationToken: "not-confirmed",
  }), /確認token/);
  assert.equal(calls, 0);
  assert.equal(service.history({ artifactId: ARTIFACT_ID }).revisions.length, 0);
});

test("durable claim admits one provider call for concurrent duplicate run", async (t) => {
  const state = fixture();
  t.after(() => { state.database.db.close(); fs.rmSync(state.root, { recursive: true, force: true }); });
  let calls = 0;
  let release;
  const providerGate = new Promise((resolve) => { release = resolve; });
  const service = createService(state, async () => {
    calls += 1;
    await providerGate;
    return { rawText: "single invocation", language: "ja" };
  });
  const preview = service.preview({ artifactId: ARTIFACT_ID });
  const request = { artifactId: ARTIFACT_ID, operationId: preview.operationId, confirmationToken: preview.confirmationToken };
  const first = service.run(request);
  while (calls === 0) await new Promise((resolve) => setImmediate(resolve));
  assert.equal(service.preview({ artifactId: ARTIFACT_ID }).operationId, preview.operationId);
  await assert.rejects(service.run(request), /すでに処理中/);
  release();
  const result = await first;
  assert.equal(calls, 1);
  assert.equal(result.revisions.length, 1);
  assert.equal(result.revision.status, "completed");
});

test("cancel aborts the in-flight provider and durably retains a cancelled revision", async (t) => {
  const state = fixture();
  t.after(() => { state.database.db.close(); fs.rmSync(state.root, { recursive: true, force: true }); });
  let started = false;
  const service = createService(state, ({ signal }) => new Promise((resolve, reject) => {
    started = true;
    signal.addEventListener("abort", () => reject({ code: "cancelled" }), { once: true });
  }));
  const preview = service.preview({ artifactId: ARTIFACT_ID });
  const running = service.run({ artifactId: ARTIFACT_ID, operationId: preview.operationId, confirmationToken: preview.confirmationToken });
  while (!started) await new Promise((resolve) => setImmediate(resolve));
  const cancelled = service.cancel({ artifactId: ARTIFACT_ID, operationId: preview.operationId });
  assert.equal(cancelled.revision.status, "cancelled");
  const settled = await running;
  assert.equal(settled.revision.status, "cancelled");
  assert.equal(settled.revisions.length, 1);
  assert.equal(state.database.get("artifact", ARTIFACT_ID).transcription_revisions[0].status, "cancelled");
  assert.equal(state.database.get("capture_entry", CAPTURE_ID).transcription_status, "failed");
});

test("a restarted service reclaims an expired durable lease with the same revision", async (t) => {
  const state = fixture();
  t.after(() => { state.database.db.close(); fs.rmSync(state.root, { recursive: true, force: true }); });
  const repository = new BatchTranscriptionRepository(state.database);
  const previewService = createService(state, async () => ({ rawText: "not reached", language: "ja" }), () => "2026-08-09T08:00:00.000Z");
  const preview = previewService.preview({ artifactId: ARTIFACT_ID });
  const revisionId = randomUUID();
  const claim = repository.claim({
    operationId: preview.operationId,
    artifactId: ARTIFACT_ID,
    previewFingerprint: transcriptBatchPreviewFingerprint(preview),
    revisionId,
    revisionRequest: {
      operation_id: preview.operationId,
      source_artifact_id: ARTIFACT_ID,
      source_content_hash: state.hash,
      provider_profile_id: "provider-fake",
      model_profile_id: "model-fake",
      model_id: "fake-transcriber-1",
      language: "ja",
      processing_mode: "cloud",
    },
    leaseToken: randomUUID(),
    leaseExpiresAt: "2026-08-09T09:00:00.000Z",
    now: "2026-08-09T08:00:00.000Z",
  });
  assert.equal(claim.revision.status, "processing");

  const restarted = createService(state, async () => ({ rawText: "recovered after restart", language: "ja" }), () => "2026-08-09T10:00:00.000Z");
  const retryPreview = restarted.preview({ artifactId: ARTIFACT_ID });
  assert.equal(retryPreview.operationId, preview.operationId);
  const result = await restarted.run({
    artifactId: ARTIFACT_ID,
    operationId: retryPreview.operationId,
    confirmationToken: retryPreview.confirmationToken,
  });
  assert.equal(result.revisions.length, 1);
  assert.equal(result.revision.id, revisionId);
  assert.equal(result.revision.status, "completed");
  assert.equal(result.revision.raw_text, "recovered after restart");
});

test("a restarted service can cancel the processing operation restored from history", (t) => {
  const state = fixture();
  t.after(() => { state.database.db.close(); fs.rmSync(state.root, { recursive: true, force: true }); });
  const repository = new BatchTranscriptionRepository(state.database);
  const original = createService(state, async () => ({ rawText: "not reached", language: "ja" }));
  const preview = original.preview({ artifactId: ARTIFACT_ID });
  const claim = repository.claim({
    operationId: preview.operationId,
    artifactId: ARTIFACT_ID,
    previewFingerprint: transcriptBatchPreviewFingerprint(preview),
    revisionId: randomUUID(),
    revisionRequest: {
      operation_id: preview.operationId,
      source_artifact_id: ARTIFACT_ID,
      source_content_hash: state.hash,
      provider_profile_id: "provider-fake",
      model_profile_id: "model-fake",
      model_id: "fake-transcriber-1",
      language: "ja",
      processing_mode: "cloud",
    },
    leaseToken: randomUUID(),
    leaseExpiresAt: "2026-08-09T10:12:00.000Z",
    now: NOW,
  });
  assert.equal(claim.revision.status, "processing");

  const restarted = createService(state, async () => ({ rawText: "not reached", language: "ja" }));
  const restored = restarted.history({ artifactId: ARTIFACT_ID });
  assert.equal(restored.revisions.at(-1).operation_id, preview.operationId);
  assert.equal(restored.revisions.at(-1).status, "processing");
  const cancelled = restarted.cancel({ artifactId: ARTIFACT_ID, operationId: restored.revisions.at(-1).operation_id });
  assert.equal(cancelled.revision.status, "cancelled");
  assert.equal(restarted.history({ artifactId: ARTIFACT_ID }).revisions.at(-1).status, "cancelled");
});
