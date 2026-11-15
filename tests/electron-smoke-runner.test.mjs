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
  const importedVideoArtifactId = "223e4567-e89b-42d3-a456-426614174000";
  const videoOwnerId = "323e4567-e89b-42d3-a456-426614174000";
  const args = buildElectronSmokeArgs(paths, {
    restartArtifactId: artifactId,
    restartImportedVideoArtifactId: importedVideoArtifactId,
    restartVideoOwnerId: videoOwnerId,
  });
  assert.ok(args.includes("--smoke-restart-check"));
  assert.ok(args.includes(`--smoke-media-artifact-id=${artifactId}`));
  // 録る側は外した（#755 束4）。録音・録画の Artifact を再起動後に確かめる引数は無い。
  assert.equal(
    args.some((arg) => /microphone|screen-recording/.test(arg)),
    false,
  );
  assert.ok(args.includes(`--smoke-imported-video-artifact-id=${importedVideoArtifactId}`));
  assert.ok(args.includes(`--smoke-video-owner-id=${videoOwnerId}`));
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
      importedVideoArtifactId,
      stickyQuitOpened: true,
      stickyQuitClosed: true,
      smokeTaskId: videoOwnerId,
    }),
    {
      audioArtifactId: artifactId,
      importedVideoArtifactId,
      videoOwnerId,
    },
  );
  assert.equal(
    restartArtifactIdsFromResult({
      stage: "restart-ready",
      audioArtifactId: artifactId,
      importedVideoArtifactId: "bad",
      stickyQuitOpened: true,
      stickyQuitClosed: true,
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
        importedVideoArtifactId,
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

test("desktop smoke imports audio and video, plays them and restart-checks both, without any recording path", async () => {
  const source = await readFile("src/main/index.ts", "utf8");
  // 取り込み → 再生 → 再起動後の再生は残す。
  assert.match(source, /window\.api\.mediaCapture\.commitAudio/);
  assert.match(source, /created\.audioArtifactId = audioSmoke\.artifactId/);
  assert.match(source, /created\.importedVideoArtifactId = videoSmoke\.artifactId/);
  assert.match(
    source,
    /created\.importedVideoRangeVerified = await verifySmokeVideoRange\(videoSmoke\.artifactId\)/,
  );
  assert.match(source, /importedVideo = await verifyVideo\([^\n]+null, \["video\/webm"\]\)/);
  assert.match(
    source,
    /result\.audioRangeVerified &&[\s\S]*?result\.importedVideoRangeVerified &&/,
  );
  // 録る側は外した（#755 束4）。smoke にも本体にも、録音・録画・画面の取得が残っていない。
  assert.doesNotMatch(
    source,
    /getUserMedia|getDisplayMedia|MediaRecorder|use-fake-device-for-media-stream|setDisplayMediaRequestHandler|AllowWgc/,
  );
  assert.doesNotMatch(source, /window\.api\.(screenRecording|batchTranscription)\b/);
  assert.doesNotMatch(source, /mediaCapture\.(start|append|pause|resume|stop)Recording/);
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
