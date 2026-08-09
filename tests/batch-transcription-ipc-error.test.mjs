import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import { build } from "esbuild";

async function loadProjection() {
  const result = await build({
    entryPoints: ["src/main/batchTranscriptionIpcError.ts"],
    bundle: true,
    format: "esm",
    platform: "node",
    write: false,
  });
  return import(`data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text, "utf8").toString("base64")}`);
}

test("all batch transcription IPC handlers use the same safe error projection", () => {
  const source = fs.readFileSync("src/main/ipc/registerIpc.ts", "utf8");
  for (const phase of ["preview", "history", "run", "cancel"]) {
    assert.match(source, new RegExp(`projectBatchTranscriptionIpcError\\("${phase}", error\\)`));
  }
  assert.doesNotMatch(source, /batchTranscription[\s\S]{0,200}error\.message/);
  assert.match(source, /batchTranscription\.run\(parseBatchTranscriptionRunRequest\(request\)\)/);
});

test("batch transcription run IPC requires exact UUID identifiers", async () => {
  const result = await build({
    entryPoints: ["src/shared/batchTranscriptionIpc.ts"],
    bundle: true,
    format: "esm",
    platform: "node",
    write: false,
  });
  const { parseBatchTranscriptionRunRequest } = await import(
    `data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text, "utf8").toString("base64")}`
  );
  const valid = {
    artifactId: "22222222-2222-4222-8222-222222222222",
    operationId: "33333333-3333-4333-8333-333333333333",
    confirmationToken: "confirmed",
  };
  assert.deepEqual(parseBatchTranscriptionRunRequest(valid), valid);
  assert.throws(() => parseBatchTranscriptionRunRequest({ ...valid, artifactId: "artifact-with-a-path" }), /Artifact ID/);
  assert.throws(() => parseBatchTranscriptionRunRequest({ ...valid, operationId: "not-a-uuid" }), /operation ID/);
  assert.throws(() => parseBatchTranscriptionRunRequest({ ...valid, extra: true }), /request/);
});

test("safe projection never returns filesystem paths, credentials, or provider raw messages", async () => {
  const { projectBatchTranscriptionIpcError } = await loadProjection();
  const raw = [
    Object.assign(new Error("ENOENT: no such file C:\\Users\\secret\\voice.wav"), { code: "ENOENT" }),
    Object.assign(new Error("Authorization: Bearer sk-secret provider exploded"), { code: "provider_failure" }),
    { projection: { code: "timeout", message: "raw provider timeout at /private/audio.wav" } },
  ];
  for (const phase of ["preview", "history", "run", "cancel"]) {
    for (const error of raw) {
      const projected = projectBatchTranscriptionIpcError(phase, error);
      assert.doesNotMatch(projected.message, /C:\\Users|\/private|sk-secret|Bearer|provider exploded|voice\.wav/i);
    }
  }
  assert.match(projectBatchTranscriptionIpcError("run", raw[2]).message, /時間/);
});
