import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  buildElectronSmokeArgs,
  createSmokePaths,
  restartArtifactIdFromResult,
  restartArtifactIdsFromResult,
} from "../scripts/run-electron-smoke.mjs";
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
    assert.ok(args.includes("--disable-gpu"));
  }
  assert.notEqual(first.userDataDir, second.userDataDir);
  assert.notEqual(first.resultPath, second.resultPath);
});

test("Electron smoke restart reuses userData/result and requires restart-ready with an Artifact UUID", () => {
  const paths = createSmokePaths("C:/temp", "restart");
  const artifactId = "123e4567-e89b-42d3-a456-426614174000";
  const microphoneArtifactId = "423e4567-e89b-42d3-a456-426614174000";
  const importedVideoArtifactId = "223e4567-e89b-42d3-a456-426614174000";
  const screenRecordingArtifactId = "523e4567-e89b-42d3-a456-426614174000";
  const videoOwnerId = "323e4567-e89b-42d3-a456-426614174000";
  const args = buildElectronSmokeArgs(paths, {
    restartArtifactId: artifactId,
    restartMicrophoneArtifactId: microphoneArtifactId,
    restartImportedVideoArtifactId: importedVideoArtifactId,
    restartScreenRecordingArtifactId: screenRecordingArtifactId,
    restartVideoOwnerId: videoOwnerId,
  });
  assert.ok(args.includes("--smoke-restart-check"));
  assert.ok(args.includes(`--smoke-media-artifact-id=${artifactId}`));
  assert.ok(args.includes(`--smoke-microphone-artifact-id=${microphoneArtifactId}`));
  assert.ok(args.includes(`--smoke-imported-video-artifact-id=${importedVideoArtifactId}`));
  assert.ok(args.includes(`--smoke-screen-recording-artifact-id=${screenRecordingArtifactId}`));
  assert.ok(args.includes(`--smoke-video-owner-id=${videoOwnerId}`));
  assert.ok(args.includes("--smoke-screen-recording-paused-resumed"));
  assert.ok(args.includes(`--user-data-dir=${paths.userDataDir}`));
  assert.ok(args.includes(`--smoke-result-path=${paths.resultPath}`));
  assert.equal(
    restartArtifactIdFromResult({ stage: "restart-ready", audioArtifactId: artifactId }),
    artifactId,
  );
  assert.equal(restartArtifactIdFromResult({ stage: "passed", audioArtifactId: artifactId }), null);
  assert.equal(
    restartArtifactIdFromResult({ stage: "restart-ready", audioArtifactId: "not-an-id" }),
    null,
  );
  assert.deepEqual(
    restartArtifactIdsFromResult({
      stage: "restart-ready",
      audioArtifactId: artifactId,
      microphoneArtifactId,
      importedVideoArtifactId,
      screenRecordingArtifactId,
      screenRecordingPausedResumed: true,
      stickyQuitOpened: true,
      stickyQuitClosed: true,
      smokeTaskId: videoOwnerId,
    }),
    {
      audioArtifactId: artifactId,
      microphoneArtifactId,
      importedVideoArtifactId,
      screenRecordingArtifactId,
      videoOwnerId,
    },
  );
  assert.equal(
    restartArtifactIdsFromResult({
      stage: "restart-ready",
      audioArtifactId: artifactId,
      microphoneArtifactId,
      importedVideoArtifactId,
      screenRecordingArtifactId: "bad",
    }),
    null,
  );
  assert.equal(
    restartArtifactIdsFromResult({
      stage: "restart-ready",
      audioArtifactId: artifactId,
      microphoneArtifactId,
      importedVideoArtifactId,
      screenRecordingArtifactId,
      screenRecordingPausedResumed: false,
      smokeTaskId: videoOwnerId,
    }),
    null,
  );
  // 付箋の窓を開いたまま終了し、will-quit までに閉じたことを、両方そろって求める（#755）。
  for (const [stickyQuitOpened, stickyQuitClosed] of [
    [true, false],
    [false, true],
  ]) {
    assert.equal(
      restartArtifactIdsFromResult({
        stage: "restart-ready",
        audioArtifactId: artifactId,
        microphoneArtifactId,
        importedVideoArtifactId,
        screenRecordingArtifactId,
        screenRecordingPausedResumed: true,
        stickyQuitOpened,
        stickyQuitClosed,
        smokeTaskId: videoOwnerId,
      }),
      null,
    );
  }
  const packagedArgs = buildElectronSmokeArgs(paths, { packaged: true });
  assert.ok(packagedArgs.includes("--smoke-require-packaged"));
  assert.equal(packagedArgs.includes("."), false);
  assert.equal(packagedArgs.includes("--disable-gpu"), false);
  assert.equal(packagedArgs.includes("--disable-gpu-compositing"), false);
});

// Today Mini の窓の検査は、窓ごと外した（#755）ので消した。
test("desktop smoke waits for the exact pasted nodes", async () => {
  const source = await readFile("src/main/index.ts", "utf8");
  assert.match(
    source,
    /querySelectorAll\("h2"\)[\s\S]*?Pasted Markdown Heading[\s\S]*?querySelectorAll\("strong"\)[\s\S]*?Pasted Bold Text/,
  );
});

// Tasken Root を開く段は Root ごと外した（#755）。終了の経路が will-quit に届くことだけを確かめる。
test("desktop smoke reaches will-quit through a bounded app.quit path", async () => {
  const source = await readFile("src/main/index.ts", "utf8");
  assert.match(
    source,
    /function completeInitialSmokeViaAppQuit[\s\S]*recordSmoke\("quit-started"[\s\S]*setTimeout\([\s\S]*30_000[\s\S]*app\.quit\(\)/,
  );
  assert.match(source, /app\.on\("will-quit"[\s\S]*pendingSmokeQuitResult[\s\S]*"restart-ready"/);
  // 付箋の窓を開いたまま終了し、will-quit で閉じ終えたかを見る（#755 で Tasken Root から移した）。
  assert.match(
    source,
    /function completeInitialSmokeViaAppQuit[\s\S]*memoStickyController\.open\(stickyMemoId\)[\s\S]*stickyQuitOpened: true[\s\S]*app\.quit\(\)/,
  );
  assert.match(
    source,
    /app\.on\("will-quit"[\s\S]*smokeQuitStickyWindow\?\.isDestroyed\(\)[\s\S]*stickyQuitClosed \? "restart-ready" : "quit-failed"/,
  );
});

// リマインダーの通知のクリックと同じ入口で、本体のドロワーにTaskが開くことを合否に含める（#755）。
test("desktop smoke opens the Task drawer through the reminder openTaskDetail path", async () => {
  const source = await readFile("src/main/index.ts", "utf8");
  assert.match(
    source,
    /openTaskDetail\(smokeTaskId\);[\s\S]*?created\.reminderTaskDetailOpened = [\s\S]*?\.drawer-form[\s\S]*?recordSmoke\("markdown-edit-complete"\)/,
  );
  assert.match(source, /result\.reminderTaskDetailOpened &&/);
});

test("packaged smoke records, commits, plays and restart-checks a synthetic microphone capture", async () => {
  const source = await readFile("src/main/index.ts", "utf8");
  assert.match(source, /use-fake-device-for-media-stream/);
  assert.match(source, /navigator\.mediaDevices\.getUserMedia\(\{ audio: true \}\)/);
  assert.match(source, /new MediaRecorder\(stream, \{ mimeType \}\)/);
  assert.match(source, /window\.api\.mediaCapture\.appendRecording/);
  assert.match(
    source,
    /flushPausedRecorder[\s\S]*?setTimeout\([\s\S]*?200\)[\s\S]*?await flushPausedRecorder\(\)[\s\S]*?await appendChain[\s\S]*?pauseRecording/,
  );
  assert.match(source, /appendFailure \|\|= error[\s\S]*?if \(appendFailure\) throw appendFailure/);
  assert.match(source, /window\.api\.mediaCapture\.commitAudio/);
  assert.match(source, /created\.audioArtifactId = audioSmoke\.artifactId/);
  assert.match(source, /created\.microphoneArtifactId = microphoneSmoke\.artifactId/);
  assert.match(
    source,
    /created\.microphoneRangeVerified = await verifySmokeVideoRange\(microphoneSmoke\.artifactId\)/,
  );
  assert.doesNotMatch(source, /created\.audioArtifactId = microphoneSmoke\.artifactId/);
  assert.match(source, /result\.microphonePlayback/);
});

test("packaged smoke does not execute embedded batch transcription", async () => {
  const source = await readFile("src/main/index.ts", "utf8");
  assert.doesNotMatch(source, /Tasken packaged fake provider/);
  assert.doesNotMatch(source, /window\.api\.batchTranscription\.(preview|run|cancel)/);
  assert.doesNotMatch(source, /batchTranscription(Completed|Restarted|Preview|Provenance)/);
});

test("packaged smoke records an actual display source through Main authority and restart-checks it", async () => {
  const source = await readFile("src/main/index.ts", "utf8");
  assert.match(source, /window\.api\.screenRecording\.listSources\(\)/);
  assert.match(source, /EditContext,AllowWgcScreenCapturer,AllowWgcWindowCapturer/);
  assert.match(
    source,
    /window\.api\.screenRecording\.arm\(\{ sourceToken: source\.sourceToken, audioMode: "off", includePointer: false \}\)/,
  );
  assert.match(source, /navigator\.mediaDevices\.getDisplayMedia/);
  assert.match(
    source,
    /window\.api\.mediaCapture\.startRecording\(\{[\s\S]*?mediaKind: "video"[\s\S]*?sourceId:/,
  );
  assert.match(
    source,
    /recorder\.addEventListener\("pause"[\s\S]*?recorder\.pause\(\)[\s\S]*?pauseChunksFlushed[\s\S]*?setTimeout\(resolve, 200\)[\s\S]*?await pauseChunksFlushed[\s\S]*?await appendChain[\s\S]*?mediaCapture\.pauseRecording[\s\S]*?mediaCapture\.resumeRecording[\s\S]*?recorder\.resume\(\)/,
  );
  assert.match(
    source,
    /window\.api\.mediaCapture\.commitVideo\(\{ sessionId: prepared\.sessionId, \.\.\.metadata \}\)/,
  );
  assert.match(
    source,
    /screenRecordingSmoke = \(await window\.webContents\.executeJavaScript\([\s\S]*?`,\s*true,\s*\)\)/,
  );
  assert.match(source, /created\.importedVideoArtifactId = videoSmoke\.artifactId/);
  assert.match(
    source,
    /created\.importedVideoRangeVerified = await verifySmokeVideoRange\(videoSmoke\.artifactId\)/,
  );
  assert.match(source, /created\.screenRecordingArtifactId = screenRecordingSmoke\.artifactId/);
  assert.match(
    source,
    /created\.screenRecordingPausedResumed = screenRecordingSmoke\.pausedResumed/,
  );
  assert.match(
    source,
    /created\.screenRecordingRangeVerified = await verifySmokeVideoRange\(\s*screenRecordingSmoke\.artifactId,\s*\)/,
  );
  // 画面録画はMP4既定、取り込み動画のfixtureはWebMのまま（#388）。
  assert.match(
    source,
    /importedVideo = await verifyVideo\([^\n]+null, \["video\/webm"\]\)[\s\S]*?screenRecording = await verifyVideo\([^\n]+"screen_recording", \["video\/mp4", "video\/webm"\]\)/,
  );
  assert.match(source, /importedVideoRangeVerified[\s\S]*?screenRecordingRangeVerified/);
  assert.doesNotMatch(source, /created\.videoArtifactId/);
});

test("native clipboard smoke lock serializes only the shared interval and records ownership", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "tasken-smoke-lock-test-"));
  const lockPath = path.join(root, "clipboard.lock");
  const releaseFirst = await acquireSmokeClipboardLock({
    lockPath,
    runId: "first",
    retryMs: 5,
    waitMs: 500,
  });
  const owner = JSON.parse(await readFile(path.join(lockPath, "owner.json"), "utf8"));
  assert.equal(owner.pid, process.pid);
  assert.equal(owner.runId, "first");
  assert.equal(typeof owner.startedAt, "number");

  let secondAcquired = false;
  const second = acquireSmokeClipboardLock({
    lockPath,
    runId: "second",
    retryMs: 5,
    waitMs: 500,
  }).then((release) => {
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
  await writeFile(
    path.join(lockPath, "owner.json"),
    JSON.stringify({ pid: 999999, startedAt: Date.now() - 1000, runId: "dead" }),
  );
  const release = await acquireSmokeClipboardLock({
    lockPath,
    runId: "recovered",
    leaseMs: 10,
    waitMs: 500,
    retryMs: 5,
  });
  const owner = JSON.parse(await readFile(path.join(lockPath, "owner.json"), "utf8"));
  assert.equal(owner.runId, "recovered");
  release();
  await rm(root, { recursive: true, force: true });
});

test("native clipboard smoke lock fails clearly when the shared interval exceeds its wait bound", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "tasken-smoke-lock-timeout-"));
  const lockPath = path.join(root, "clipboard.lock");
  const release = await acquireSmokeClipboardLock({
    lockPath,
    runId: "holder",
    retryMs: 5,
    waitMs: 500,
  });
  await assert.rejects(
    acquireSmokeClipboardLock({ lockPath, runId: "blocked", retryMs: 5, waitMs: 25 }),
    /native clipboard lockの待機がタイムアウトしました/,
  );
  release();
  await rm(root, { recursive: true, force: true });
});
