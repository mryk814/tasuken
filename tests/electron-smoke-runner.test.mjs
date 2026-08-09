import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { buildElectronSmokeArgs, createSmokePaths, restartArtifactIdFromResult, restartArtifactIdsFromResult } from "../scripts/run-electron-smoke.mjs";
import { acquireSmokeClipboardLock } from "../src/main/smokeClipboardLock.mjs";

test("Electron smoke runner creates unique explicit userData and result paths", () => {
  const first = createSmokePaths("C:/temp", "ci");
  const second = createSmokePaths("C:/temp", "ci");
  assert.notEqual(first.runId, second.runId);
  for (const paths of [first, second]) {
    const args = buildElectronSmokeArgs(paths);
    assert.ok(args.includes("--smoke-test"));
    assert.ok(args.includes(`--smoke-run-id=${paths.runId}`));
    assert.ok(args.includes(`--user-data-dir=${paths.userDataDir}`));
    assert.ok(args.includes(`--smoke-result-path=${paths.resultPath}`));
  }
  assert.notEqual(first.userDataDir, second.userDataDir);
  assert.notEqual(first.resultPath, second.resultPath);
});

test("Electron smoke restart reuses userData/result and requires restart-ready with an Artifact UUID", () => {
  const paths = createSmokePaths("C:/temp", "restart");
  const artifactId = "123e4567-e89b-42d3-a456-426614174000";
  const microphoneArtifactId = "423e4567-e89b-42d3-a456-426614174000";
  const videoArtifactId = "223e4567-e89b-42d3-a456-426614174000";
  const videoOwnerId = "323e4567-e89b-42d3-a456-426614174000";
  const args = buildElectronSmokeArgs(paths, { restartArtifactId: artifactId, restartMicrophoneArtifactId: microphoneArtifactId, restartVideoArtifactId: videoArtifactId, restartVideoOwnerId: videoOwnerId });
  assert.ok(args.includes("--smoke-restart-check"));
  assert.ok(args.includes(`--smoke-media-artifact-id=${artifactId}`));
  assert.ok(args.includes(`--smoke-microphone-artifact-id=${microphoneArtifactId}`));
  assert.ok(args.includes(`--smoke-video-artifact-id=${videoArtifactId}`));
  assert.ok(args.includes(`--smoke-video-owner-id=${videoOwnerId}`));
  assert.ok(args.includes(`--user-data-dir=${paths.userDataDir}`));
  assert.ok(args.includes(`--smoke-result-path=${paths.resultPath}`));
  assert.equal(restartArtifactIdFromResult({ stage: "restart-ready", audioArtifactId: artifactId }), artifactId);
  assert.equal(restartArtifactIdFromResult({ stage: "passed", audioArtifactId: artifactId }), null);
  assert.equal(restartArtifactIdFromResult({ stage: "restart-ready", audioArtifactId: "not-an-id" }), null);
  assert.deepEqual(restartArtifactIdsFromResult({ stage: "restart-ready", audioArtifactId: artifactId, microphoneArtifactId, videoArtifactId, smokeTaskId: videoOwnerId }), { audioArtifactId: artifactId, microphoneArtifactId, videoArtifactId, videoOwnerId });
  assert.equal(restartArtifactIdsFromResult({ stage: "restart-ready", audioArtifactId: artifactId, microphoneArtifactId, videoArtifactId: "bad" }), null);
  const packagedArgs = buildElectronSmokeArgs(paths, { packaged: true });
  assert.ok(packagedArgs.includes("--smoke-require-packaged"));
  assert.equal(packagedArgs.includes("."), false);
});

test("packaged smoke records, commits, plays and restart-checks a synthetic microphone capture", async () => {
  const source = await readFile("src/main/index.ts", "utf8");
  assert.match(source, /use-fake-device-for-media-stream/);
  assert.match(source, /navigator\.mediaDevices\.getUserMedia\(\{ audio: true \}\)/);
  assert.match(source, /new MediaRecorder\(stream, \{ mimeType \}\)/);
  assert.match(source, /window\.api\.mediaCapture\.appendRecording/);
  assert.match(source, /window\.api\.mediaCapture\.commitAudio/);
  assert.match(source, /created\.audioArtifactId = audioSmoke\.artifactId/);
  assert.match(source, /created\.microphoneArtifactId = microphoneSmoke\.artifactId/);
  assert.match(source, /created\.microphoneRangeVerified = await verifySmokeVideoRange\(microphoneSmoke\.artifactId\)/);
  assert.doesNotMatch(source, /created\.audioArtifactId = microphoneSmoke\.artifactId/);
  assert.match(source, /result\.microphonePlayback/);
});

test("packaged smoke confirms fake batch transcription and verifies the raw revision after restart", async () => {
  const source = await readFile("src/main/index.ts", "utf8");
  assert.match(source, /Tasken packaged fake provider/);
  assert.match(source, /window\.api\.batchTranscription\.preview/);
  assert.match(source, /window\.api\.batchTranscription\.run/);
  assert.match(source, /batchTranscriptionCompleted/);
  assert.match(source, /window\.api\.batchTranscription\.history/);
  assert.match(source, /batchTranscriptionRestarted/);
});

test("native clipboard smoke lock serializes only the shared interval and records ownership", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "tasken-smoke-lock-test-"));
  const lockPath = path.join(root, "clipboard.lock");
  const releaseFirst = await acquireSmokeClipboardLock({ lockPath, runId: "first", retryMs: 5, waitMs: 500 });
  const owner = JSON.parse(await readFile(path.join(lockPath, "owner.json"), "utf8"));
  assert.equal(owner.pid, process.pid);
  assert.equal(owner.runId, "first");
  assert.equal(typeof owner.startedAt, "number");

  let secondAcquired = false;
  const second = acquireSmokeClipboardLock({ lockPath, runId: "second", retryMs: 5, waitMs: 500 }).then((release) => {
    secondAcquired = true;
    return release;
  });
  await new Promise((resolve) => setTimeout(resolve, 30));
  assert.equal(secondAcquired, false);
  releaseFirst();
  const releaseSecond = await second;
  assert.equal(secondAcquired, true);
  releaseSecond();
  await rm(root, { recursive: true, force: true });
});

test("native clipboard smoke lock recovers an expired dead owner and has a bounded wait", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "tasken-smoke-lock-expired-"));
  const lockPath = path.join(root, "clipboard.lock");
  await mkdir(lockPath);
  await writeFile(path.join(lockPath, "owner.json"), JSON.stringify({ pid: 999999, startedAt: Date.now() - 1000, runId: "dead" }));
  const release = await acquireSmokeClipboardLock({ lockPath, runId: "recovered", leaseMs: 10, waitMs: 500, retryMs: 5 });
  const owner = JSON.parse(await readFile(path.join(lockPath, "owner.json"), "utf8"));
  assert.equal(owner.runId, "recovered");
  release();
  await rm(root, { recursive: true, force: true });
});

test("native clipboard smoke lock fails clearly when the shared interval exceeds its wait bound", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "tasken-smoke-lock-timeout-"));
  const lockPath = path.join(root, "clipboard.lock");
  const release = await acquireSmokeClipboardLock({ lockPath, runId: "holder", retryMs: 5, waitMs: 500 });
  await assert.rejects(
    acquireSmokeClipboardLock({ lockPath, runId: "blocked", retryMs: 5, waitMs: 25 }),
    /native clipboard lockの待機がタイムアウトしました/,
  );
  release();
  await rm(root, { recursive: true, force: true });
});
