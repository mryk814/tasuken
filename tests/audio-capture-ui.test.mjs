import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const inbox = readFileSync("src/renderer/src/features/workspace/pages/InboxPage.tsx", "utf8");
const viewer = readFileSync("src/renderer/src/features/workspace/components/ContentViewer.tsx", "utf8");
const drawer = readFileSync("src/renderer/src/features/workspace/components/drawer.tsx", "utf8");
const uiStore = readFileSync("src/renderer/src/stores/uiStore.ts", "utf8");
const workspaceApp = readFileSync("src/renderer/src/features/workspace/WorkspaceApp.tsx", "utf8");
const mediaFlushRegistry = readFileSync("src/renderer/src/features/workspace/lib/mediaRecordingFlushRegistry.ts", "utf8");
const mediaRecorderFlush = readFileSync("src/renderer/src/features/workspace/lib/mediaRecorderFlush.ts", "utf8");
const screenRecorder = readFileSync("src/renderer/src/features/workspace/components/ScreenRecorderPanel.tsx", "utf8");
const voiceRecorder = readFileSync("src/renderer/src/features/workspace/components/VoiceRecorderPanel.tsx", "utf8");
const studio = readFileSync("src/renderer/src/features/workspace/pages/StudioPage.tsx", "utf8");
const registerIpc = readFileSync("src/main/ipc/registerIpc.ts", "utf8");
const mainIndex = readFileSync("src/main/index.ts", "utf8");

test("InboxはMemoだけを主操作にし、音声の入口はStudioへ移す（#383）", () => {
  assert.match(inbox, /<Button variant="primary" onClick=\{addMemo\}><IconPlus size=\{16\} \/>Memo<\/Button>/);
  // 録音・画面録画はInboxに要らない機能なので、入口ごと持たない。
  assert.doesNotMatch(inbox, /音声を取り込む|マイクで録音|ScreenRecorderPanel/);
  assert.match(voiceRecorder, /<IconVolume size=\{15\} \/>音声を取り込む/);
  assert.match(voiceRecorder, /captureAudioFile\(\)/);
  // Studioは音声と画面録画を同じ面に並べ、同時録画させない。
  assert.match(studio, /<VoiceRecorderPanel[\s\S]*?disabled=\{screenRecordingActive\}/);
  assert.match(studio, /<ScreenRecorderPanel[\s\S]*?disabled=\{voiceActive\}/);
});

test("Inbox microphone recorder keeps bounded chunks, device choice and compact control states", () => {
  assert.match(voiceRecorder, /"idle" \| "permission" \| "ready" \| "recording" \| "paused" \| "stopping" \| "error"/);
  assert.match(voiceRecorder, /<IconMicrophone size=\{15\} \/>\{recorderState === "permission" \? "確認中…" : "マイクで録音"\}/);
  assert.match(voiceRecorder, /navigator\.mediaDevices\.enumerateDevices\(\)/);
  assert.match(voiceRecorder, /deviceId: \{ exact: selectedAudioDeviceId \}/);
  assert.match(voiceRecorder, /blob\.slice\(offset, Math\.min\(blob\.size, offset \+ session\.maxChunkBytes\)\)/);
  assert.match(voiceRecorder, /sequence: recordingSequenceRef\.current/);
  assert.match(voiceRecorder, /録音中/);
  assert.match(voiceRecorder, /pauseMicrophoneRecording\(\)/);
  assert.match(voiceRecorder, /resumeMicrophoneRecording\(\)/);
  assert.match(voiceRecorder, /async function pauseMicrophoneRecordingNow[\s\S]*?try \{[\s\S]*?pauseMediaRecording[\s\S]*?catch \(error\)[\s\S]*?stopMicrophoneRecordingNow\(false, true\)/);
  assert.match(voiceRecorder, /recorder\.addEventListener\("pause"[\s\S]*?recorder\.pause\(\)[\s\S]*?await recorderPaused[\s\S]*?waitForMediaRecorderDataFlush\(recorder\)[\s\S]*?await recordingAppendRef\.current[\s\S]*?pauseMediaRecording/);
  assert.match(mediaRecorderFlush, /const quietMs = options\.quietMs \?\? 200/);
  assert.match(mediaRecorderFlush, /removeEventListener\("dataavailable"[\s\S]*?requestData\(\)/);
  assert.match(voiceRecorder, /async function resumeMicrophoneRecordingNow[\s\S]*?try \{[\s\S]*?resumeMediaRecording[\s\S]*?catch \(error\)[\s\S]*?stopMicrophoneRecordingNow\(false, true\)/);
  assert.match(voiceRecorder, /stopMicrophoneRecording\(\)/);
  assert.match(voiceRecorder, /discardActiveRecording\(\)/);
  assert.match(voiceRecorder, /tasken:app-flush-requested/);
  assert.match(voiceRecorder, /removeEventListener\("tasken:app-flush-requested", onFlush\)[\s\S]*?flushMicrophoneRecording\(\)/);
  assert.match(voiceRecorder, /progress\.fileSize >= session\.maxRecordingBytes[\s\S]*?stopMicrophoneRecording\(false, true\)/);
  assert.match(voiceRecorder, /elapsed >= maximum[\s\S]*?stopMicrophoneRecording\(\)/);
  assert.match(voiceRecorder, /recorder\.addEventListener\("error"[\s\S]*?stopMicrophoneRecording\(false, true\)/);
  assert.match(voiceRecorder, /track\.addEventListener\("ended"[\s\S]*?stopMicrophoneRecording\(false, true\)/);
  assert.match(voiceRecorder, /recorder\.addEventListener\("stop"[\s\S]*?recorder\.requestData\(\)[\s\S]*?await recordingAppendRef\.current/);
  assert.match(voiceRecorder, /recordingDiscardingRef = useRef\(false\)/);
  assert.match(voiceRecorder, /recordingTransitionRef = useRef<Promise<void>>\(Promise\.resolve\(\)\)[\s\S]*?recordingTransitionRef\.current\.then\(transition, transition\)/);
  assert.match(voiceRecorder, /recordingBeginRef = useRef<Promise<void> \| null>\(null\)[\s\S]*?if \(recordingBeginRef\.current\) return recordingBeginRef\.current[\s\S]*?disabled=\{recorderStarting\}/);
  assert.match(voiceRecorder, /startedSession = session[\s\S]*?new MediaRecorder\(stream, \{ mimeType, audioBitsPerSecond: VOICE_RECORDING_BITS_PER_SECOND \}\)[\s\S]*?recorder\.start\(1000\)[\s\S]*?await workspaceApi\.cancelAudioCapture\(startedSession\.sessionId\)/);
  // 既定任せにすると容量が数倍になる（#388）。
  assert.match(voiceRecorder, /const VOICE_RECORDING_BITS_PER_SECOND = 48_000;/);
  assert.match(voiceRecorder, /if \(!session \|\| recordingDiscardingRef\.current \|\| blob\.size <= 0\) return/);
  assert.match(voiceRecorder, /MAX_PENDING_RECORDING_CHUNKS = 8[\s\S]*?recordingQueuedBytesRef\.current \+ blob\.size > maxQueuedBytes[\s\S]*?stopMicrophoneRecording\(false, true\)/);
  assert.match(voiceRecorder, /recordingQueuedBytesRef\.current = Math\.max\(0, recordingQueuedBytesRef\.current - blob\.size\)/);
  assert.match(voiceRecorder, /recordingDiscardingRef\.current = true[\s\S]*?recorder\.stop\(\)[\s\S]*?await recordingAppendRef\.current[\s\S]*?cancelAudioCapture[\s\S]*?recordingDiscardingRef\.current = false/);
  assert.match(voiceRecorder, /function releaseMicrophoneStream\(\)[\s\S]*?track\.stop\(\)/);
  assert.match(voiceRecorder, /recorderState === "recording" && \(\s*\n\s*<Button[\s\S]*?pauseMicrophoneRecording\(\)/);
  assert.match(voiceRecorder, /recorderState === "paused" && \(\s*\n\s*<Button[\s\S]*?resumeMicrophoneRecording\(\)/);
  assert.match(voiceRecorder, /<button type="button" className="text-button compact"[\s\S]*?discardActiveRecording\(\)/);
  assert.doesNotMatch(voiceRecorder, /new Blob\(.*record/i);
});

test("画面録画のpause→即stop等は単一transition queueで直列化する", () => {
  assert.match(screenRecorder, /transitionRef = useRef<Promise<void>>\(Promise\.resolve\(\)\)/);
  assert.match(screenRecorder, /function queueRecordingTransition<T>[\s\S]*?transitionRef\.current\.then\(transition, transition\)[\s\S]*?transitionRef\.current = settled/);
  assert.match(screenRecorder, /function pauseRecording\(\): Promise<void> \{[\s\S]*?queueRecordingTransition\(pauseRecordingNow\)/);
  assert.match(screenRecorder, /function resumeRecording\(\): Promise<void> \{[\s\S]*?queueRecordingTransition\(resumeRecordingNow\)/);
  assert.match(screenRecorder, /function stopRecording\(showToast = true\)[\s\S]*?queueRecordingTransition\(\(\) => stopRecordingNow\(showToast\)\)/);
  assert.match(screenRecorder, /function discardActive\(\): Promise<void> \{[\s\S]*?queueRecordingTransition\(discardActiveNow\)/);
  assert.match(screenRecorder, /async function pauseRecordingNow[\s\S]*?catch \(caught\)[\s\S]*?await stopRecordingNow\(false\)/);
  assert.match(screenRecorder, /async function discardActiveNow[\s\S]*?recorder\.stop\(\)[\s\S]*?await appendRef\.current\.catch\(\(\) => undefined\)[\s\S]*?cancelVideoImport/);
  assert.match(screenRecorder, /disabled=\{transitioning \|\| state === "stopping"\}/);
  assert.match(screenRecorder, /catch \(caught\) \{[\s\S]*?releaseStreams\(\);[\s\S]*?同じ録画sessionの停止を再試行してください/);
  assert.doesNotMatch(screenRecorder, /catch \(caught\) \{\s*releaseStreams\(\);\s*sessionRef\.current = null;\s*setState\("error"\)/);
  assert.match(screenRecorder, /state === "error"[\s\S]*?sessionRef\.current[\s\S]*?stopRecording\(false\)/);
  assert.match(screenRecorder, /state === "error"[\s\S]*?sessionRef\.current[\s\S]*?stopRecording\(false\)[\s\S]*?discardActive\(\)/);
  assert.match(screenRecorder, /async function discardActiveNow[\s\S]*?await workspaceApi\.cancelVideoImport\(session\.sessionId\)[\s\S]*?sessionRef\.current = null[\s\S]*?catch \(caught\) \{[\s\S]*?releaseStreams\(\)[\s\S]*?setState\("error"\)/);
  assert.doesNotMatch(screenRecorder, /catch \(caught\) \{\s*releaseStreams\(\);\s*sessionRef\.current = null;\s*setState\("error"\)/);
  assert.match(screenRecorder, /catch \(cancelError\) \{[\s\S]*?cancelFailed = true;[\s\S]*?sessionRef\.current = startedSession[\s\S]*?if \(!cancelFailed\) sessionRef\.current = null/);
});

test("main-frame navigationは旧screen source token ledgerを即時clearする", () => {
  assert.match(registerIpc, /event\.sender\.on\("did-start-navigation"[\s\S]*?if \(isMainFrame\) screenRecording\.clearSender\(senderId\)/);
});

test("画面録画の失敗はabsolute path非露出errorへ丸め、原因はMainログだけに残す", () => {
  const screenRecordingError = readFileSync("src/main/screenRecordingIpcError.ts", "utf8");
  // 画面録画は音声Captureと原因も次の操作も違うので、専用の対応表を使う。
  assert.match(registerIpc, /IPC\.screenRecordingCapabilities[\s\S]*?try \{[\s\S]*?mediaCapture\.recordingCapacity\(\)[\s\S]*?catch \(error\)[\s\S]*?projectScreenRecordingIpcError\(error\)/);
  assert.match(registerIpc, /IPC\.screenRecordingArm[\s\S]*?catch \(error\)[\s\S]*?projectScreenRecordingIpcError\(error\)/);
  const screenRecordingHandlers = registerIpc.slice(
    registerIpc.indexOf("IPC.screenRecordingCapabilities"),
    registerIpc.indexOf("IPC.mediaRecordingStart"),
  );
  assert.ok(screenRecordingHandlers.length > 0);
  assert.doesNotMatch(screenRecordingHandlers, /projectMediaCaptureIpcError/);
  // Rendererへ返すのは固定文言だけ。生のmessageは渡さない。
  assert.match(screenRecordingError, /return new Error\(safeMessage\)/);
  assert.match(screenRecordingError, /return new Error\(FALLBACK\)/);
  assert.doesNotMatch(screenRecordingError, /new Error\([^)]*error[^)]*message/);
  // 拒否理由はMainのログにだけ残す。ここを消すと録画が始まらない理由へ到達できない。
  assert.match(mainIndex, /logMain\("warn", "screen-recording:display-request", "permission grantを拒否した", error\)/);
  assert.match(registerIpc, /logMain\("error", "screen-recording:arm"/);
  assert.match(readFileSync("src/main/mediaCaptureIpcError.ts", "utf8"), /logMain\("error", `media-capture:\$\{action\}`/);
});

test("Quick Captureからも同じInbox recorderへ到達し保存経路を分裂させない", () => {
  assert.match(drawer, /type === "capture_entry"[\s\S]*?!entityId[\s\S]*?requestInboxRecorder\(\)/);
  assert.match(drawer, /<IconMicrophone size=\{16\} \/>マイクで録音/);
  // 入口はStudioへ移したが、Quick Captureからの手数は増やさない（#383）。
  assert.match(drawer, /navigate\?\.\("studio"\);\s*\n\s*requestInboxRecorder\(\);/);
  assert.match(uiStore, /inboxRecorderRequested: false/);
  assert.match(uiStore, /requestInboxRecorder: \(\) => set\(\{ inboxRecorderRequested: true \}\)/);
  assert.match(uiStore, /consumeInboxRecorderRequest: \(\) => set\(\{ inboxRecorderRequested: false \}\)/);
  assert.match(voiceRecorder, /if \(!inboxRecorderRequested\) return;[\s\S]*?consumeInboxRecorderRequest\(\);[\s\S]*?prepareMicrophone\(\)/);
  assert.match(voiceRecorder, /async function prepareMicrophone\(\) \{[\s\S]*?if \(recordingSessionRef\.current\) return/);
  assert.doesNotMatch(voiceRecorder, /handledRecorderRequestRef|inboxRecorderRequestId/);
});

test("route unmountで開始した録音stopはglobal app flushが完了まで待つ", () => {
  assert.match(voiceRecorder, /const flushMicrophoneRecording = async \(\): Promise<boolean> => \{[\s\S]*?await recordingBeginRef\.current[\s\S]*?if \(!recordingSessionRef\.current\) return true[\s\S]*?stopMicrophoneRecordingRef\.current\(false\)/);
  assert.match(voiceRecorder, /if \(!recordingBeginRef\.current && !recordingSessionRef\.current\) return[\s\S]*?const previous = detail\.flush[\s\S]*?Promise\.all\(\[previous \|\| Promise\.resolve\(true\), flushMicrophoneRecording\(\)\]\)/);
  assert.match(voiceRecorder, /if \(recordingBeginRef\.current \|\| recordingSessionRef\.current\)[\s\S]*?const routeFlush = flushMicrophoneRecording\(\)[\s\S]*?trackPendingMediaRecordingFlush\(routeFlush\)/);
  assert.match(voiceRecorder, /trackPendingMediaRecordingFlush\(routeFlush\)/);
  assert.match(mediaFlushRegistry, /pendingMediaRecordingFlushes = new Set<Promise<boolean>>\(\)/);
  assert.match(mediaFlushRegistry, /while \(pendingMediaRecordingFlushes\.size\)/);
  assert.match(workspaceApp, /Promise\.all\(\[pageFlush, flushPendingNoteDraftSaves\(\), flushPendingMediaRecordingFlushes\(\)\]\)/);
});

test("permission denial, missing device and disconnect retain reason plus next action", () => {
  assert.match(voiceRecorder, /マイクが許可されていません。Windowsのプライバシー設定/);
  assert.match(voiceRecorder, /入力デバイスが見つかりません。マイクを接続してから再試行/);
  assert.match(voiceRecorder, /マイクが切断されました。録音済み部分を保存/);
  assert.match(voiceRecorder, /録音を復旧/);
});

test("Inbox prepared audio has explicit loading, error, preview, commit and discard states", () => {
  assert.match(voiceRecorder, /preparedAudioState === "loading"/);
  assert.match(voiceRecorder, /role="status">保存待ち音声を確認しています/);
  assert.match(voiceRecorder, /preparedAudioState === "error"/);
  assert.match(voiceRecorder, /role="alert"/);
  assert.match(voiceRecorder, /onClick=\{\(\) => \{ void refreshPreparedAudio\(\); \}\}>一覧を再試行/);
  assert.match(voiceRecorder, /preparedAudioState === "ready" && preparedAudio\.length === 0/);
  assert.match(voiceRecorder, /role="status">保存待ち音声はありません/);
  assert.match(voiceRecorder, /aria-label=\{`\$\{prepared\.filename\}の保存前プレビュー`\}/);
  assert.match(voiceRecorder, /commitPreparedAudio\(prepared\)/);
  assert.match(voiceRecorder, /discardPreparedAudio\(prepared\)/);
});

test("saved audio uses one metadata-rich button in untriaged and processed Inbox rows", () => {
  assert.equal((inbox.match(/<CapturedArtifactButton key=/g) || []).length, 2);
  assert.match(inbox, /IconVolume size=\{14\}/);
  assert.match(inbox, /formatMediaDuration\(artifact\.duration_ms\)/);
  assert.match(inbox, /formatArtifactFileSize\(artifact\.file_size\)/);
  assert.match(inbox, /TRANSCRIPTION_STATUS_LABELS\[transcription\]/);
  assert.match(inbox, /MEDIA_AVAILABILITY_LABELS\[availability\]/);
});

test("ContentViewer audio exposes loading, error and successful playback metadata accessibly", () => {
  assert.match(viewer, /load\.status === "loading"/);
  assert.match(viewer, /role="status">読み込み中/);
  assert.match(viewer, /load\.status === "error"/);
  assert.match(viewer, /role="alert"/);
  assert.match(viewer, /src: `tasken-media:\/\/artifact\/\$\{encodeURIComponent\(artifact\.id\)\}`/);
  assert.match(viewer, /<audio[\s\S]*?controls[\s\S]*?preload="metadata"[\s\S]*?aria-label=\{`\$\{load\.title\}の音声プレーヤー`\}/);
  assert.match(viewer, /formatMediaDuration\(load\.artifact\.duration_ms\)/);
  assert.match(viewer, /formatArtifactFileSize\(load\.artifact\.file_size\)/);
  assert.match(viewer, /元ファイルの変更・削除、または対応形式を確認してください/);
});
