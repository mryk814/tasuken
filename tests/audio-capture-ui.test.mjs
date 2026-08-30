import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const inbox = readFileSync("src/renderer/src/features/workspace/pages/InboxPage.tsx", "utf8");
const viewer = readFileSync(
  "src/renderer/src/features/workspace/components/ContentViewer.tsx",
  "utf8",
);
const drawer = readFileSync("src/renderer/src/features/workspace/components/drawer.tsx", "utf8");
const uiStore = readFileSync("src/renderer/src/stores/uiStore.ts", "utf8");
const workspaceApp = readFileSync("src/renderer/src/features/workspace/WorkspaceApp.tsx", "utf8");
const mediaFlushRegistry = readFileSync(
  "src/renderer/src/features/workspace/lib/mediaRecordingFlushRegistry.ts",
  "utf8",
);
const mediaRecorderFlush = readFileSync(
  "src/renderer/src/features/workspace/lib/mediaRecorderFlush.ts",
  "utf8",
);
const screenRecorder = readFileSync(
  "src/renderer/src/features/workspace/components/ScreenRecorderPanel.tsx",
  "utf8",
);
const voiceRecorder = readFileSync(
  "src/renderer/src/features/workspace/components/VoiceRecorderPanel.tsx",
  "utf8",
);
const studio = readFileSync("src/renderer/src/features/workspace/pages/StudioPage.tsx", "utf8");
const recordings = readFileSync(
  "src/renderer/src/features/workspace/components/RecordingsPanel.tsx",
  "utf8",
);
const drawerFormPlans = readFileSync(
  "src/renderer/src/features/workspace/lib/drawerFormPlans.ts",
  "utf8",
);
const pendingRecordings = readFileSync(
  "src/renderer/src/features/workspace/components/PendingRecordingsPanel.tsx",
  "utf8",
);
const regionSelector = readFileSync("src/renderer/region-selector.html", "utf8");
const recordingIndicator = readFileSync("src/renderer/recording-indicator.html", "utf8");
const recordingIndicatorController = readFileSync(
  "src/main/recordingIndicatorController.ts",
  "utf8",
);
const registerIpc = readFileSync("src/main/ipc/registerIpc.ts", "utf8");
const mainIndex = readFileSync("src/main/index.ts", "utf8");

test("InboxはMemoだけを主操作にし、音声の入口はStudioへ移す（#383）", () => {
  assert.match(
    inbox,
    /<Button\s+variant="primary"\s+onClick=\{addMemo\}\s*>\s*<IconPlus\s+size=\{16\}\s*\/>\s*Memo\s*<\/Button>/,
  );
  // 録音・画面録画はInboxに要らない機能なので、入口ごと持たない。
  assert.doesNotMatch(inbox, /音声を取り込む|マイクで録音|ScreenRecorderPanel/);
  assert.match(studio, /<IconVolume size=\{15\} \/>音声を取り込む/);
  assert.match(voiceRecorder, /importAudio: \(\) =>/);
  // Studioは音声と画面録画を同じ面に並べ、同時録画させない。
  assert.match(studio, /<VoiceRecorderPanel[\s\S]*?disabled=\{screenRecordingActive\}/);
  assert.match(studio, /<ScreenRecorderPanel[\s\S]*?disabled=\{voiceActive\}/);
});

test("Inbox microphone recorder keeps bounded chunks, device choice and compact control states", () => {
  assert.match(
    voiceRecorder,
    /"idle" \| "permission" \| "ready" \| "recording" \| "paused" \| "stopping" \| "error"/,
  );
  assert.match(studio, /<IconMicrophone size=\{15\} \/>マイクで録音/);
  assert.match(
    voiceRecorder,
    /<IconMicrophone size=\{15\} \/>\{recorderStarting \? "開始中…" : "録音を開始"\}/,
  );
  assert.match(voiceRecorder, /navigator\.mediaDevices\.enumerateDevices\(\)/);
  assert.match(voiceRecorder, /deviceId: \{ exact: selectedAudioDeviceId \}/);
  assert.match(
    voiceRecorder,
    /blob\.slice\(offset, Math\.min\(blob\.size, offset \+ session\.maxChunkBytes\)\)/,
  );
  assert.match(voiceRecorder, /sequence: recordingSequenceRef\.current/);
  assert.match(voiceRecorder, /録音中/);
  assert.match(voiceRecorder, /pauseMicrophoneRecording\(\)/);
  assert.match(voiceRecorder, /resumeMicrophoneRecording\(\)/);
  assert.match(
    voiceRecorder,
    /async function pauseMicrophoneRecordingNow[\s\S]*?try \{[\s\S]*?pauseMediaRecording[\s\S]*?catch \(error\)[\s\S]*?stopMicrophoneRecordingNow\(false, true\)/,
  );
  assert.match(
    voiceRecorder,
    /recorder\.addEventListener\("pause"[\s\S]*?recorder\.pause\(\)[\s\S]*?await recorderPaused[\s\S]*?waitForMediaRecorderDataFlush\(recorder\)[\s\S]*?await recordingAppendRef\.current[\s\S]*?pauseMediaRecording/,
  );
  assert.match(mediaRecorderFlush, /const quietMs = options\.quietMs \?\? 200/);
  assert.match(mediaRecorderFlush, /removeEventListener\("dataavailable"[\s\S]*?requestData\(\)/);
  assert.match(
    voiceRecorder,
    /async function resumeMicrophoneRecordingNow[\s\S]*?try \{[\s\S]*?resumeMediaRecording[\s\S]*?catch \(error\)[\s\S]*?stopMicrophoneRecordingNow\(false, true\)/,
  );
  assert.match(voiceRecorder, /stopMicrophoneRecording\(\)/);
  assert.match(voiceRecorder, /discardActiveRecording\(\)/);
  assert.match(voiceRecorder, /tasken:app-flush-requested/);
  assert.match(
    voiceRecorder,
    /removeEventListener\("tasken:app-flush-requested", onFlush\)[\s\S]*?flushMicrophoneRecording\(\)/,
  );
  assert.match(
    voiceRecorder,
    /progress\.fileSize >= session\.maxRecordingBytes[\s\S]*?stopMicrophoneRecording\(false, true\)/,
  );
  assert.match(voiceRecorder, /elapsed >= maximum[\s\S]*?stopMicrophoneRecording\(\)/);
  assert.match(
    voiceRecorder,
    /recorder\.addEventListener\("error"[\s\S]*?stopMicrophoneRecording\(false, true\)/,
  );
  assert.match(
    voiceRecorder,
    /track\.addEventListener\("ended"[\s\S]*?stopMicrophoneRecording\(false, true\)/,
  );
  assert.match(
    voiceRecorder,
    /recorder\.addEventListener\("stop"[\s\S]*?recorder\.requestData\(\)[\s\S]*?await recordingAppendRef\.current/,
  );
  assert.match(voiceRecorder, /recordingDiscardingRef = useRef\(false\)/);
  assert.match(
    voiceRecorder,
    /recordingTransitionRef = useRef<Promise<void>>\(Promise\.resolve\(\)\)[\s\S]*?recordingTransitionRef\.current\.then\(transition, transition\)/,
  );
  assert.match(
    voiceRecorder,
    /recordingBeginRef = useRef<Promise<void> \| null>\(null\)[\s\S]*?if \(recordingBeginRef\.current\) return recordingBeginRef\.current[\s\S]*?disabled=\{recorderStarting\}/,
  );
  assert.match(
    voiceRecorder,
    /startedSession = session[\s\S]*?new MediaRecorder\(stream, \{ mimeType, audioBitsPerSecond: VOICE_RECORDING_BITS_PER_SECOND \}\)[\s\S]*?recorder\.start\(1000\)[\s\S]*?await workspaceApi\.cancelAudioCapture\(startedSession\.sessionId\)/,
  );
  // 既定任せにすると容量が数倍になる（#388）。
  assert.match(voiceRecorder, /const VOICE_RECORDING_BITS_PER_SECOND = 48_000;/);
  assert.match(
    voiceRecorder,
    /if \(!session \|\| recordingDiscardingRef\.current \|\| blob\.size <= 0\) return/,
  );
  assert.match(
    voiceRecorder,
    /MAX_PENDING_RECORDING_CHUNKS = 8[\s\S]*?recordingQueuedBytesRef\.current \+ blob\.size > maxQueuedBytes[\s\S]*?stopMicrophoneRecording\(false, true\)/,
  );
  assert.match(
    voiceRecorder,
    /recordingQueuedBytesRef\.current = Math\.max\(0, recordingQueuedBytesRef\.current - blob\.size\)/,
  );
  assert.match(
    voiceRecorder,
    /recordingDiscardingRef\.current = true[\s\S]*?recorder\.stop\(\)[\s\S]*?await recordingAppendRef\.current[\s\S]*?cancelAudioCapture[\s\S]*?recordingDiscardingRef\.current = false/,
  );
  assert.match(voiceRecorder, /function releaseMicrophoneStream\(\)[\s\S]*?track\.stop\(\)/);
  assert.match(
    voiceRecorder,
    /recorderState === "recording" && \(\s*\n\s*<Button[\s\S]*?pauseMicrophoneRecording\(\)/,
  );
  assert.match(
    voiceRecorder,
    /recorderState === "paused" && \(\s*\n\s*<Button[\s\S]*?resumeMicrophoneRecording\(\)/,
  );
  assert.match(
    voiceRecorder,
    /<button type="button" className="text-button compact"[\s\S]*?discardActiveRecording\(\)/,
  );
  assert.doesNotMatch(voiceRecorder, /new Blob\(.*record/i);
});

test("範囲選択overlayは共通body背景に負けず、選択中の画面を透かして表示する（#374）", () => {
  assert.match(regionSelector, /body \{ background: transparent !important;/);
  assert.match(regionSelector, /#selection \{[^\n]*outline: 1px solid/);
  assert.match(regionSelector, /#selection \{[^\n]*box-shadow: 0 0 0 99999px/);
  assert.match(regionSelector, /setPointerCapture\(event\.pointerId\)/);
  assert.match(regionSelector, /releasePointerCapture\(event\.pointerId\)/);
});

test("画面録画は画面全体・範囲・ウィンドウを同じ階層に並べ、入力機器と範囲表示を持つ", () => {
  assert.match(
    studio,
    /<Button variant="primary" compact disabled=\{voiceActive \|\| screenRecordingActive\}[\s\S]*?<IconDeviceDesktop size=\{15\} \/>画面を録画/,
  );
  assert.match(screenRecorder, /screen-recorder-targets/);
  assert.match(screenRecorder, /<span>画面全体<\/span>/);
  assert.match(screenRecorder, /<strong>ウィンドウ<\/strong>/);
  assert.match(
    screenRecorder,
    /<option value="system" disabled=\{!environment\?\.systemAudio\}>システム音声（PCの音）<\/option>/,
  );
  assert.match(screenRecorder, /audioDevices\.map/);
  assert.match(screenRecorder, /deviceId: \{ exact: selectedAudioDeviceId \}/);
  assert.match(
    screenRecorder,
    /applyScreenRecordingRegionIndicator\(visible \? regionSelection : null\)/,
  );
  assert.match(regionSelector, /body\.is-indicator #selection \{ border: 3px dotted #ce3b3b/);
  assert.match(screenRecorder, /screen-recorder-control-row/);
  assert.doesNotMatch(screenRecorder, /他の録画アプリを停止/);
});

test("範囲録画は本体最小化後もcanvas frameを明示送信し、encoder向けに偶数寸法で保存する", () => {
  assert.match(mainIndex, /backgroundThrottling: false/);
  assert.match(screenRecorder, /canvas\.width = Math\.max\(2, sourceWidth - \(sourceWidth % 2\)\)/);
  assert.match(
    screenRecorder,
    /canvas\.height = Math\.max\(2, sourceHeight - \(sourceHeight % 2\)\)/,
  );
  assert.match(
    screenRecorder,
    /const stream = canvas\.captureStream\(0\)[\s\S]*?canvasTrack\.requestFrame\(\)[\s\S]*?window\.setInterval\(draw, 1000 \/ 30\)/,
  );
  assert.doesNotMatch(screenRecorder, /requestAnimationFrame\(draw\)/);
});

test("録画中は開始元を最小化し、上端の縮小バーはhoverで操作を再表示できる", () => {
  assert.match(recordingIndicatorController, /BrowserWindow\.fromWebContents\(event\.sender\)/);
  assert.match(recordingIndicatorController, /minimizeMainWindow\(state, recordingOwnerWindow\)/);
  assert.match(
    recordingIndicatorController,
    /let minimizedMainWindow: BrowserWindow \| null = null/,
  );
  assert.match(
    recordingIndicator,
    /body\.is-retracted \.indicator-surface \{[\s\S]*?-webkit-app-region: no-drag/,
  );
  assert.match(recordingIndicator, /addEventListener\("pointer(?:enter|move)", revealControls\)/);
  assert.match(
    recordingIndicator,
    /function revealControls\(\) \{\s*pointerInside = true;\s*window\.clearTimeout\(retractTimer\);\s*if \(!retracted\) return;/,
  );
  assert.match(
    recordingIndicator,
    /window\.setTimeout\(\(\) => \{\s*if \(!pointerInside\) setRetracted\(true\);/,
  );
  assert.match(recordingIndicator, /const PAUSE_ICON = '<svg/);
  assert.match(recordingIndicator, /const RESUME_ICON = '<svg/);
  assert.match(
    recordingIndicator,
    /id="stop" class="primary" aria-label="停止" title="停止">\s*<svg/,
  );
  assert.match(
    recordingIndicator,
    /id="discard" class="danger" aria-label="破棄" title="破棄">\s*<svg/,
  );
  assert.doesNotMatch(
    recordingIndicator,
    /<button[^>]*>一時停止<\/button>|<button[^>]*>停止<\/button>|<button[^>]*>破棄<\/button>/,
  );
});

test("画面録画のpause→即stop等は単一transition queueで直列化する", () => {
  assert.match(screenRecorder, /transitionRef = useRef<Promise<void>>\(Promise\.resolve\(\)\)/);
  assert.match(
    screenRecorder,
    /function queueRecordingTransition<T>[\s\S]*?transitionRef\.current\.then\(transition, transition\)[\s\S]*?transitionRef\.current = settled/,
  );
  assert.match(
    screenRecorder,
    /function pauseRecording\(\): Promise<void> \{[\s\S]*?queueRecordingTransition\(pauseRecordingNow\)/,
  );
  assert.match(
    screenRecorder,
    /function resumeRecording\(\): Promise<void> \{[\s\S]*?queueRecordingTransition\(resumeRecordingNow\)/,
  );
  assert.match(
    screenRecorder,
    /function stopRecording\(showToast = true\)[\s\S]*?queueRecordingTransition\(\(\) => stopRecordingNow\(showToast\)\)/,
  );
  assert.match(
    screenRecorder,
    /function discardActive\(\): Promise<void> \{[\s\S]*?queueRecordingTransition\(discardActiveNow\)/,
  );
  assert.match(
    screenRecorder,
    /async function pauseRecordingNow[\s\S]*?catch \(caught\)[\s\S]*?await stopRecordingNow\(false\)/,
  );
  assert.match(
    screenRecorder,
    /recorder\.pause\(\)[\s\S]*?await paused[\s\S]*?waitForMediaRecorderDataFlush\(recorder\)[\s\S]*?await appendRef\.current[\s\S]*?pauseMediaRecording/,
  );
  assert.match(
    screenRecorder,
    /async function discardActiveNow[\s\S]*?recorder\.stop\(\)[\s\S]*?await appendRef\.current\.catch\(\(\) => undefined\)[\s\S]*?cancelVideoImport/,
  );
  assert.match(screenRecorder, /disabled=\{transitioning \|\| state === "stopping"\}/);
  assert.match(
    screenRecorder,
    /catch \(caught\) \{[\s\S]*?releaseStreams\(\);[\s\S]*?同じ録画sessionの停止を再試行してください/,
  );
  assert.doesNotMatch(
    screenRecorder,
    /catch \(caught\) \{\s*releaseStreams\(\);\s*sessionRef\.current = null;\s*setState\("error"\)/,
  );
  assert.match(
    screenRecorder,
    /state === "error"[\s\S]*?sessionRef\.current[\s\S]*?stopRecording\(false\)/,
  );
  assert.match(
    screenRecorder,
    /state === "error"[\s\S]*?sessionRef\.current[\s\S]*?stopRecording\(false\)[\s\S]*?discardActive\(\)/,
  );
  assert.match(
    screenRecorder,
    /async function discardActiveNow[\s\S]*?await workspaceApi\.cancelVideoImport\(session\.sessionId\)[\s\S]*?sessionRef\.current = null[\s\S]*?catch \(caught\) \{[\s\S]*?releaseStreams\(\)[\s\S]*?setState\("error"\)/,
  );
  assert.doesNotMatch(
    screenRecorder,
    /catch \(caught\) \{\s*releaseStreams\(\);\s*sessionRef\.current = null;\s*setState\("error"\)/,
  );
  assert.match(
    screenRecorder,
    /catch \(cancelError\) \{[\s\S]*?cancelFailed = true;[\s\S]*?sessionRef\.current = startedSession[\s\S]*?if \(!cancelFailed\) sessionRef\.current = null/,
  );
});

test("main-frame navigationは旧screen source token ledgerを即時clearする", () => {
  assert.match(
    registerIpc,
    /event\.sender\.on\(\s*"did-start-navigation"[\s\S]*?if\s*\(\s*isMainFrame\s*\)\s*screenRecording\.clearSender\(\s*senderId\s*\)/,
  );
});

test("画面録画の失敗はabsolute path非露出errorへ丸め、原因はMainログだけに残す", () => {
  const screenRecordingError = readFileSync("src/main/screenRecordingIpcError.ts", "utf8");
  // 画面録画は音声Captureと原因も次の操作も違うので、専用の対応表を使う。
  assert.match(
    registerIpc,
    /IPC\.screenRecordingCapabilities[\s\S]*?try \{[\s\S]*?mediaCapture\.recordingCapacity\(\)[\s\S]*?catch \(error\)[\s\S]*?projectScreenRecordingIpcError\(error\)/,
  );
  assert.match(
    registerIpc,
    /IPC\.screenRecordingArm[\s\S]*?catch \(error\)[\s\S]*?projectScreenRecordingIpcError\(error\)/,
  );
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
  assert.match(
    mainIndex,
    /logMain\("warn", "screen-recording:display-request", "permission grantを拒否した", error\)/,
  );
  assert.match(registerIpc, /logMain\("error", "screen-recording:arm"/);
  assert.match(
    readFileSync("src/main/mediaCaptureIpcError.ts", "utf8"),
    /logMain\("error", `media-capture:\$\{action\}`/,
  );
});

test("Quick Captureからも同じInbox recorderへ到達し保存経路を分裂させない", () => {
  assert.match(drawer, /type === "capture_entry"[\s\S]*?!entityId[\s\S]*?requestInboxRecorder\(\)/);
  assert.match(drawer, /<IconMicrophone size=\{16\} \/>\s*マイクで録音/);
  // 入口はStudioへ移したが、Quick Captureからの手数は増やさない（#383）。
  assert.match(drawer, /navigate\?\.\("studio"\);\s*\n\s*requestInboxRecorder\(\);/);
  assert.match(uiStore, /inboxRecorderRequested: false/);
  assert.match(uiStore, /requestInboxRecorder: \(\) => set\(\{ inboxRecorderRequested: true \}\)/);
  assert.match(
    uiStore,
    /consumeInboxRecorderRequest: \(\) => set\(\{ inboxRecorderRequested: false \}\)/,
  );
  assert.match(
    voiceRecorder,
    /if \(!inboxRecorderRequested\) return;[\s\S]*?consumeInboxRecorderRequest\(\);[\s\S]*?prepareMicrophone\(\)/,
  );
  assert.match(
    voiceRecorder,
    /async function prepareMicrophone\(\) \{[\s\S]*?if \(recordingSessionRef\.current\) return/,
  );
  assert.doesNotMatch(voiceRecorder, /handledRecorderRequestRef|inboxRecorderRequestId/);
});

test("route unmountで開始した録音stopはglobal app flushが完了まで待つ", () => {
  assert.match(
    voiceRecorder,
    /const flushMicrophoneRecording = async \(\): Promise<boolean> => \{[\s\S]*?await recordingBeginRef\.current[\s\S]*?if \(!recordingSessionRef\.current\) return true[\s\S]*?stopMicrophoneRecordingRef\.current\(false\)/,
  );
  assert.match(
    voiceRecorder,
    /if \(!recordingBeginRef\.current && !recordingSessionRef\.current\) return[\s\S]*?const previous = detail\.flush[\s\S]*?Promise\.all\(\[previous \|\| Promise\.resolve\(true\), flushMicrophoneRecording\(\)\]\)/,
  );
  assert.match(
    voiceRecorder,
    /if \(recordingBeginRef\.current \|\| recordingSessionRef\.current\)[\s\S]*?const routeFlush = flushMicrophoneRecording\(\)[\s\S]*?trackPendingMediaRecordingFlush\(routeFlush\)/,
  );
  assert.match(voiceRecorder, /trackPendingMediaRecordingFlush\(routeFlush\)/);
  assert.match(mediaFlushRegistry, /pendingMediaRecordingFlushes = new Set<Promise<boolean>>\(\)/);
  assert.match(mediaFlushRegistry, /while \(pendingMediaRecordingFlushes\.size\)/);
  assert.match(
    workspaceApp,
    /Promise\.all\(\[\s*pageFlush,\s*flushPendingNoteDraftSaves\(\),\s*flushPendingMediaRecordingFlushes\(\),?\s*\]\)/,
  );
});

test("permission denial, missing device and disconnect retain reason plus next action", () => {
  assert.match(voiceRecorder, /マイクが許可されていません。Windowsのプライバシー設定/);
  assert.match(voiceRecorder, /入力デバイスが見つかりません。マイクを接続してから再試行/);
  assert.match(voiceRecorder, /マイクが切断されました。録音済み部分を保存/);
  assert.match(pendingRecordings, /収録を復旧/);
});

test("保存待ちは音声と画面録画を1つの復旧表に統合し、必要時だけ表示する（#383）", () => {
  assert.match(pendingRecordings, /loadState === "loading"/);
  assert.match(pendingRecordings, /role="status">保存待ちを確認しています/);
  assert.match(pendingRecordings, /loadState === "error"/);
  assert.match(pendingRecordings, /role="alert"/);
  assert.match(pendingRecordings, /if \(loadState === "ready" && rows\.length === 0\) return null/);
  assert.doesNotMatch(pendingRecordings, /保存待ちはありません/);
  assert.match(pendingRecordings, /aria-label=\{`\$\{entry\.filename\}の保存前プレビュー`\}/);
  // 種別を列として持ち、音声と動画で表を割らない。
  assert.match(
    pendingRecordings,
    /KIND_LABELS: Record<PendingKind, string> = \{[\s\S]*?audio: "音声",[\s\S]*?video: "画面録画",/,
  );
  assert.match(pendingRecordings, /row\.kind === "audio"[\s\S]*?commitAudioCapture/);
  assert.match(pendingRecordings, /row\.kind === "video"[\s\S]*?<video controls/);
  assert.match(pendingRecordings, /videoOwner\(video\)/);
  assert.doesNotMatch(
    pendingRecordings,
    /createTrimPlan|screen-recording-trim|紐づけ先|ownerKeys|videoEdits/,
  );
  // 録る面は保存待ちの一覧を持たない。導線を二重にしない。
  assert.doesNotMatch(voiceRecorder, /保存待ち音声はありません/);
  assert.doesNotMatch(screenRecorder, /保存待ち画面録画を確認しています/);
});

test("画面録画は通常停止で収録物へ自動保存し、失敗時だけ保存待ちへ残す（#374）", () => {
  assert.match(screenRecorder, /const preparedVideo = stopped as VideoImportPrepared/);
  assert.match(screenRecorder, /if \(showToast\) await commitStoppedVideo\(preparedVideo\)/);
  assert.match(
    screenRecorder,
    /async function commitStoppedVideo[\s\S]*?readVideoMetadata\(preparedVideo\.mediaUrl\)[\s\S]*?commitVideoImport\([\s\S]*?sourceType: null,[\s\S]*?sourceId: null/,
  );
  assert.match(screenRecorder, /自動保存できませんでした。[\s\S]*?保存待ちから再試行できます/);
  assert.doesNotMatch(screenRecorder, /Preview後に明示保存/);
  assert.doesNotMatch(studio, /screenRecordingOwners|ScreenRecordingOwnerOption/);
});

test("saved audio uses one metadata-rich button in untriaged and processed Inbox rows", () => {
  assert.equal((inbox.match(/<CapturedArtifactButton\s+key=/g) || []).length, 2);
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
  assert.match(
    viewer,
    /src: `tasken-media:\/\/artifact\/\$\{encodeURIComponent\(artifact\.id\)\}`/,
  );
  assert.match(
    viewer,
    /<audio[\s\S]*?controls[\s\S]*?preload="metadata"[\s\S]*?aria-label=\{`\$\{load\.title\}の音声プレーヤー`\}/,
  );
  assert.match(viewer, /formatMediaDuration\(load\.artifact\.duration_ms\)/);
  assert.match(viewer, /formatArtifactFileSize\(load\.artifact\.file_size\)/);
  assert.match(viewer, /元ファイルの変更・削除、または対応形式を確認してください/);
});

test("Studioの録音と画面録画は同じ形の面で、開始操作を見出しの右に揃える（#383）", () => {
  // 「画面を録画」が面の中央に落ちていたのを、マイク録音と同じ位置づけへ揃える。
  assert.match(screenRecorder, /<section className="panel studio-recorder" aria-label="画面録画">/);
  assert.match(studio, /<IconDeviceDesktop size=\{15\} \/>画面を録画/);
  assert.match(voiceRecorder, /<section className="panel studio-recorder" aria-label="音声">/);
  assert.match(studio, /<IconMicrophone size=\{15\} \/>マイクで録音/);
  assert.match(voiceRecorder, /if \(recorderState === "idle"\) return null/);
  assert.match(screenRecorder, /if \(state === "idle"\) return null/);
  assert.doesNotMatch(voiceRecorder, /<div className="section-heading">[\s\S]*?音声を取り込む/);
  assert.doesNotMatch(screenRecorder, /<div className="section-heading">[\s\S]*?画面を録画/);
  // 面の中に面を入れない。保存待ちは見出しレベルを下げた同一面の中に置く。
  assert.doesNotMatch(screenRecorder, /<section className="panel inbox-screen-recovery"/);
  assert.doesNotMatch(voiceRecorder, /<section className="panel inbox-audio-recovery"/);
});

test("Studioの収録物は小さな媒体サムネイルと行クリック編集を持つ", () => {
  assert.match(studio, /<RecordingsPanel[\s\S]*?onEdit=/);
  assert.match(recordings, /className=\{`studio-recording-thumbnail is-/);
  assert.match(recordings, /tasken-media:\/\/artifact\/\$\{encodeURIComponent\(artifact\.id\)\}/);
  assert.match(recordings, /<video[\s\S]*?src=\{artifactMediaSource\(artifact\)\}/);
  assert.match(recordings, /isVideo \? <IconVideo/);
  assert.match(recordings, /<svg className="studio-recording-waveform"/);
  assert.match(recordings, /<AudioWaveform seed=\{artifact\?\.id \|\| entry\.id\}/);
  assert.match(recordings, /role="button"[\s\S]*?onClick=\{\(\) => onEdit\(entry\)\}/);
  assert.match(recordings, /event\.stopPropagation\(\);[\s\S]*?onOpen\(artifact\)/);
});

test("収録物の編集保存は音声・動画の媒体属性を保持する", () => {
  assert.match(
    drawerFormPlans,
    /content_type: \(base\.content_type as CaptureEntry\["content_type"\]\)/,
  );
  assert.match(
    drawerFormPlans,
    /capture_method: \(base\.capture_method as CaptureEntry\["capture_method"\]\)/,
  );
  assert.match(
    drawerFormPlans,
    /media_status: \(base\.media_status as CaptureEntry\["media_status"\]\)/,
  );
  assert.match(
    drawerFormPlans,
    /transcription_status:\s*\(base\.transcription_status as CaptureEntry\["transcription_status"\]\)/,
  );
});

test("Content Viewerはウィンドウを変えずアプリ内で大きく見られる（#387）", () => {
  const contentViewer = readFileSync(
    "src/renderer/src/features/workspace/components/ContentViewer.tsx",
    "utf8",
  );
  const css = readFileSync("src/renderer/src/styles/app.css", "utf8");
  // 動画は開いた時点でTasken全体を使う。画像・文書だけ必要に応じて拡大する。
  assert.match(contentViewer, /const isVideo = load\.status === "ready" && load\.mode === "video"/);
  assert.match(contentViewer, /isVideo \? "is-video" : "is-markdown"/);
  assert.doesNotMatch(contentViewer, /const canExpand[^;]*load\.mode === "video"/);
  assert.match(contentViewer, /aria-pressed=\{expanded\}/);
  assert.match(contentViewer, /\{expanded \? "縮小" : "大きく見る"\}/);
  // Escapeは段階的に戻す。拡大中にいきなり閉じない。
  assert.match(
    contentViewer,
    /if \(expandedRef\.current\) setExpanded\(false\);\s*\n\s*else onClose\(\);/,
  );
  // 一時的な見方なので保存しない。
  assert.doesNotMatch(contentViewer, /usePreference\([^)]*expanded/);
  // ウィンドウサイズは変えず、面の中だけで広げる。
  assert.match(css, /\.content-viewer-overlay:is\(\.is-expanded, \.is-video\) \{\s*padding: 0;/);
  assert.match(
    css,
    /\.content-viewer-overlay:is\(\.is-expanded, \.is-video\) \.content-viewer-dialog \{[\s\S]*?height: 100vh;/,
  );
  assert.match(
    css,
    /\.content-viewer-overlay:is\(\.is-expanded, \.is-video\) \.video-trim-editor \{[\s\S]*?width: 100%;[\s\S]*?max-width: none;[\s\S]*?height: 100%;/,
  );
  assert.match(
    css,
    /\.content-viewer-overlay:is\(\.is-expanded, \.is-video\) \.content-viewer-video video \{[\s\S]*?object-fit: contain;/,
  );
});

test("紐づけ先を選ばない画面録画はThemeの保存先を要求しない（#383）", () => {
  // 録画開始時にactiveThemeを持たせると、Inbox行きの収録がThemeフォルダの解決に巻き込まれる。
  assert.match(
    screenRecorder,
    /startMediaRecording\(\{[\s\S]*?mediaKind: "video",[\s\S]*?themeId: null,/,
  );
  assert.doesNotMatch(screenRecorder, /themeId: activeThemeId/);
});
