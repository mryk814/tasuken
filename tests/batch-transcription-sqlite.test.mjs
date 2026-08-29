import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { BatchTranscriptionRepository } from "../src/main/repositories/batchTranscriptionRepository.mjs";
import { WorkspaceDatabase } from "../src/main/repositories/workspaceRepository.mjs";

const NOW = "2026-08-09T10:00:00.000Z";
const CAPTURE_ID = "11111111-1111-4111-8111-111111111111";
const ARTIFACT_ID = "22222222-2222-4222-8222-222222222222";

function revision(id, status, overrides = {}) {
  return {
    id,
    operation_id: id,
    source_artifact_id: ARTIFACT_ID,
    source_content_hash: `sha256:${"a".repeat(64)}`,
    provider_profile_id: "legacy-provider",
    model_profile_id: "legacy-model-profile",
    model_id: "legacy-model",
    language: "ja",
    processing_mode: "cloud",
    status,
    raw_text: status === "completed" ? "保存済みの文字起こし" : "",
    started_at: status === "queued" ? null : NOW,
    completed_at: status === "completed" ? NOW : null,
    error_code: null,
    ...overrides,
  };
}

function fixture(revisions) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "tasken-transcription-history-"));
  const databasePath = path.join(root, "workspace.sqlite");
  const audioPath = path.join(root, "voice.wav");
  fs.writeFileSync(audioPath, Buffer.from("RIFF-history-fixture"));
  const database = new WorkspaceDatabase(databasePath);
  database.save("capture_entry", {
    id: CAPTURE_ID,
    title: "Voice memo",
    text: "voice.wav",
    kind: "voice_memo",
    content_type: "audio",
    capture_method: "audio_import",
    media_status: "ready",
    transcription_status: revisions.at(-1)?.status || "not_requested",
    transcription_revisions: revisions,
    captured_at: NOW,
    state: "untriaged",
    project_id: null,
  });
  database.save("artifact", {
    id: ARTIFACT_ID,
    title: "Voice memo",
    filename: "voice.wav",
    file_type: "wav",
    mime_type: "audio/wav",
    file_size: 42,
    stored_path: audioPath,
    original_path: null,
    storage_mode: "managed",
    copied_at: NOW,
    source_type: "capture_entry",
    source_id: CAPTURE_ID,
    theme_id: null,
    media_kind: "audio",
    duration_ms: 1000,
    content_hash: `sha256:${"a".repeat(64)}`,
    media_availability: "available",
    transcription_status: revisions.at(-1)?.status || "not_requested",
    transcription_revisions: revisions,
  });
  return { root, databasePath, database };
}

test("history reader preserves completed transcript provenance without an execution service", (t) => {
  const completed = revision("33333333-3333-4333-8333-333333333333", "completed");
  const state = fixture([completed]);
  t.after(() => {
    state.database.db.close();
    fs.rmSync(state.root, { recursive: true, force: true });
  });

  const history = new BatchTranscriptionRepository(state.database).getHistory(ARTIFACT_ID);
  assert.equal(history.capture.id, CAPTURE_ID);
  assert.equal(history.revisions.length, 1);
  assert.equal(history.revisions[0].raw_text, completed.raw_text);
  assert.equal(history.revisions[0].provider_profile_id, completed.provider_profile_id);
  assert.match(history.revisions[0].attempt_key, /^transcription-attempt\/v1:/);
});

test("schema v6 terminates unfinished embedded-provider work and drops its operation table", (t) => {
  const queued = revision("44444444-4444-4444-8444-444444444444", "queued");
  const processing = revision("55555555-5555-4555-8555-555555555555", "processing");
  const completed = revision("66666666-6666-4666-8666-666666666666", "completed");
  const state = fixture([queued, processing, completed]);
  state.database.db.exec(`
    CREATE TABLE transcription_operations(operation_id TEXT PRIMARY KEY);
    INSERT INTO transcription_operations(operation_id) VALUES ('legacy-operation');
  `);
  state.database.db
    .prepare("UPDATE workspace_meta SET value = '5' WHERE key = 'schema_version'")
    .run();
  state.database.db.close();

  const migrated = new WorkspaceDatabase(state.databasePath);
  t.after(() => {
    migrated.db.close();
    fs.rmSync(state.root, { recursive: true, force: true });
  });

  for (const type of ["artifact", "capture_entry"]) {
    const entity = migrated.get(type, type === "artifact" ? ARTIFACT_ID : CAPTURE_ID);
    assert.equal(entity.transcription_status, "failed");
    assert.equal(entity.transcription_revisions[0].status, "failed");
    assert.equal(entity.transcription_revisions[0].error_code, "provider_failure");
    assert.ok(entity.transcription_revisions[0].started_at);
    assert.ok(entity.transcription_revisions[0].completed_at);
    assert.equal(entity.transcription_revisions[1].status, "failed");
    assert.equal(entity.transcription_revisions[1].started_at, NOW);
    assert.equal(entity.transcription_revisions[1].error_code, "provider_failure");
    assert.deepEqual(entity.transcription_revisions[2], completed);
  }
  assert.equal(
    migrated.db.prepare("SELECT value FROM workspace_meta WHERE key = 'schema_version'").get()
      .value,
    "6",
  );
  assert.equal(
    migrated.db
      .prepare(
        "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'transcription_operations'",
      )
      .get(),
    undefined,
  );
});
