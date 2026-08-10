import { useEffect, useRef, useState } from "react";
import { IconMicrophone, IconPlayerPause, IconPlayerPlay, IconPlayerStop, IconVolume } from "@tabler/icons-react";

import { workspaceApi } from "../../../services/workspaceApi";
import { useUiStore, type ToastTone } from "../../../stores/uiStore";
import { trackPendingMediaRecordingFlush } from "../lib/mediaRecordingFlushRegistry";
import { waitForMediaRecorderDataFlush } from "../lib/mediaRecorderFlush";
import { Button } from "./common";
import { formatArtifactFileSize } from "./artifacts";
import type { AudioCapturePrepared, MediaRecordingStarted } from "../../../../../shared/mediaCapture";

type RecorderState = "idle" | "permission" | "ready" | "recording" | "paused" | "stopping" | "error";

const MAX_PENDING_RECORDING_CHUNKS = 8;
/** 音声メモは48kbps monoで内容が判る。既定任せだと数倍の容量になる（#388）。 */
const VOICE_RECORDING_BITS_PER_SECOND = 48_000;

interface VoiceRecorderPanelProps {
  /** 画面録画中は同時に録音させない。 */
  disabled?: boolean;
  onActiveChange?: (active: boolean) => void;
  /** 保存待ちの内容が変わったことを共有パネルへ知らせる（#383）。 */
  onPreparedChanged?: () => void;
  setToast: (message: string, tone?: ToastTone) => void;
}

function microphoneErrorMessage(error: unknown): string {
  const name = error instanceof DOMException ? error.name : "";
  if (name === "NotAllowedError" || name === "SecurityError") {
    return "マイクが許可されていません。Windowsのプライバシー設定でTaskenのマイクを許可してください。";
  }
  if (name === "NotFoundError" || name === "DevicesNotFoundError") {
    return "入力デバイスが見つかりません。マイクを接続してから再試行してください。";
  }
  if (name === "NotReadableError" || name === "TrackStartError" || name === "AbortError") {
    return "マイクを使用できません。他のアプリの録音を停止するか、入力デバイスを接続し直してください。";
  }
  return `録音を開始できませんでした。${error instanceof Error ? error.message : String(error)} マイクを確認して再試行してください。`;
}

function formatRecorderElapsed(milliseconds: number): string {
  const totalSeconds = Math.max(0, Math.floor(milliseconds / 1000));
  return `${String(Math.floor(totalSeconds / 60)).padStart(2, "0")}:${String(totalSeconds % 60).padStart(2, "0")}`;
}

function audioDurationMs(mediaUrl: string): Promise<number> {
  return new Promise((resolve, reject) => {
    const audio = new Audio();
    const cleanup = () => {
      window.clearTimeout(timer);
      audio.removeAttribute("src");
      audio.load();
    };
    const timer = window.setTimeout(() => {
      cleanup();
      reject(new Error("音声の長さを取得できませんでした。対応形式を確認してください。"));
    }, 15_000);
    audio.preload = "metadata";
    audio.onloadedmetadata = () => {
      const duration = Math.round(audio.duration * 1000);
      cleanup();
      if (!Number.isFinite(duration) || duration < 0) reject(new Error("音声の長さを取得できませんでした。対応形式を確認してください。"));
      else resolve(duration);
    };
    audio.onerror = () => {
      cleanup();
      reject(new Error("音声を読み込めませんでした。対応形式を確認してください。"));
    };
    audio.src = mediaUrl;
  });
}

export function VoiceRecorderPanel({ disabled = false, onActiveChange, onPreparedChanged, setToast }: VoiceRecorderPanelProps) {
  const activeThemeId = useUiStore((state) => state.activeThemeId);
  const inboxRecorderRequested = useUiStore((state) => state.inboxRecorderRequested);
  const consumeInboxRecorderRequest = useUiStore((state) => state.consumeInboxRecorderRequest);
  const [audioBusySessionId, setAudioBusySessionId] = useState<string | null>(null);
  const [recorderState, setRecorderState] = useState<RecorderState>("idle");
  const [recorderError, setRecorderError] = useState("");
  const [audioDevices, setAudioDevices] = useState<MediaDeviceInfo[]>([]);
  const [selectedAudioDeviceId, setSelectedAudioDeviceId] = useState("");
  const [recorderElapsedMs, setRecorderElapsedMs] = useState(0);
  const [recorderBytes, setRecorderBytes] = useState(0);
  const [recorderStarting, setRecorderStarting] = useState(false);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const microphoneStreamRef = useRef<MediaStream | null>(null);
  const recordingSessionRef = useRef<MediaRecordingStarted | null>(null);
  const recordingSequenceRef = useRef(0);
  const recordingAppendRef = useRef<Promise<void>>(Promise.resolve());
  const recordingQueuedBytesRef = useRef(0);
  const recordingStartedAtRef = useRef(0);
  const recordingAccumulatedMsRef = useRef(0);
  const recordingStopRef = useRef<Promise<AudioCapturePrepared | null> | null>(null);
  const recordingBeginRef = useRef<Promise<void> | null>(null);
  const recordingDiscardingRef = useRef(false);
  const recordingTransitionRef = useRef<Promise<void>>(Promise.resolve());

  useEffect(() => {
    onActiveChange?.(recorderState !== "idle" && recorderState !== "error");
  }, [onActiveChange, recorderState]);


  // Quick Captureからの「マイクで録音」は、この画面のrecorderをそのまま開く（#383）。
  useEffect(() => {
    if (!inboxRecorderRequested) return;
    consumeInboxRecorderRequest();
    void prepareMicrophone();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [consumeInboxRecorderRequest, inboxRecorderRequested]);

  function releaseMicrophoneStream() {
    for (const track of microphoneStreamRef.current?.getTracks() || []) track.stop();
    microphoneStreamRef.current = null;
    mediaRecorderRef.current = null;
  }

  function queueRecordingBlob(blob: Blob) {
    const session = recordingSessionRef.current;
    if (!session || recordingDiscardingRef.current || blob.size <= 0) return;
    const maxQueuedBytes = session.maxChunkBytes * MAX_PENDING_RECORDING_CHUNKS;
    if (blob.size > maxQueuedBytes || recordingQueuedBytesRef.current + blob.size > maxQueuedBytes) {
      setRecorderError("録音データの保存が追いつきませんでした。録音済み部分を停止し、保存待ち音声を確認してください。");
      setRecorderState("error");
      window.setTimeout(() => { void stopMicrophoneRecording(false, true); }, 0);
      return;
    }
    recordingQueuedBytesRef.current += blob.size;
    recordingAppendRef.current = recordingAppendRef.current.then(async () => {
      for (let offset = 0; offset < blob.size; offset += session.maxChunkBytes) {
        const chunk = await blob.slice(offset, Math.min(blob.size, offset + session.maxChunkBytes)).arrayBuffer();
        const progress = await workspaceApi.appendMediaRecording({
          sessionId: session.sessionId,
          sequence: recordingSequenceRef.current,
          chunk,
        });
        recordingSequenceRef.current = progress.nextSequence;
        setRecorderBytes(progress.fileSize);
        if (progress.fileSize >= session.maxRecordingBytes) {
          setRecorderError("録音サイズの上限に達しました。停止してInboxへ保存してください。");
          setRecorderState("error");
          window.setTimeout(() => { void stopMicrophoneRecording(false, true); }, 0);
        }
      }
    }).catch((error) => {
      if (recordingDiscardingRef.current) return;
      setRecorderError(`録音データを保存できませんでした。${error instanceof Error ? error.message : String(error)} 停止して保存待ち音声を確認してください。`);
      setRecorderState("error");
      window.setTimeout(() => { void stopMicrophoneRecording(false, true); }, 0);
    }).finally(() => {
      recordingQueuedBytesRef.current = Math.max(0, recordingQueuedBytesRef.current - blob.size);
    });
  }

  async function prepareMicrophone() {
    if (recordingSessionRef.current) return;
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === "undefined") {
      setRecorderState("error");
      setRecorderError("この環境ではマイク録音を利用できません。Windows版Taskenを再起動してください。");
      return;
    }
    setRecorderState("permission");
    setRecorderError("");
    try {
      const permissionStream = await navigator.mediaDevices.getUserMedia({ audio: true });
      permissionStream.getTracks().forEach((track) => track.stop());
      const devices = (await navigator.mediaDevices.enumerateDevices()).filter((device) => device.kind === "audioinput");
      if (!devices.length) throw new DOMException("No microphone", "NotFoundError");
      setAudioDevices(devices);
      setSelectedAudioDeviceId((current) => devices.some((device) => device.deviceId === current) ? current : devices[0].deviceId);
      setRecorderState("ready");
    } catch (error) {
      setRecorderState("error");
      setRecorderError(microphoneErrorMessage(error));
    }
  }

  function beginMicrophoneRecording(): Promise<void> {
    if (recordingBeginRef.current) return recordingBeginRef.current;
    setRecorderStarting(true);
    const pending = beginMicrophoneRecordingNow().finally(() => {
      if (recordingBeginRef.current === pending) recordingBeginRef.current = null;
      setRecorderStarting(false);
    });
    recordingBeginRef.current = pending;
    return pending;
  }

  async function beginMicrophoneRecordingNow() {
    let stream: MediaStream | null = null;
    let startedSession: MediaRecordingStarted | null = null;
    setRecorderError("");
    try {
      const constraints: MediaTrackConstraints = selectedAudioDeviceId ? { deviceId: { exact: selectedAudioDeviceId } } : {};
      stream = await navigator.mediaDevices.getUserMedia({ audio: constraints });
      const mimeType = MediaRecorder.isTypeSupported("audio/webm;codecs=opus") ? "audio/webm;codecs=opus" : "audio/webm";
      if (!MediaRecorder.isTypeSupported(mimeType)) {
        stream.getTracks().forEach((track) => track.stop());
        stream = null;
        throw new Error("WebM/Opus録音に対応していません。");
      }
      const session = await workspaceApi.startMediaRecording({ mediaKind: "audio", themeId: activeThemeId || null, mimeType: "audio/webm" });
      startedSession = session;
      const recorder = new MediaRecorder(stream, { mimeType, audioBitsPerSecond: VOICE_RECORDING_BITS_PER_SECOND });
      microphoneStreamRef.current = stream;
      recordingSessionRef.current = session;
      recordingSequenceRef.current = 0;
      recordingAppendRef.current = Promise.resolve();
      recordingQueuedBytesRef.current = 0;
      recordingAccumulatedMsRef.current = 0;
      recordingStartedAtRef.current = performance.now();
      setRecorderElapsedMs(0);
      setRecorderBytes(0);
      recorder.addEventListener("dataavailable", (event) => queueRecordingBlob(event.data));
      recorder.addEventListener("error", () => {
        setRecorderState("error");
        setRecorderError("録音デバイスでエラーが発生しました。停止してからマイクを接続し直してください。");
        window.setTimeout(() => { void stopMicrophoneRecording(false, true); }, 0);
      });
      for (const track of stream.getAudioTracks()) {
        track.addEventListener("ended", () => {
          if (mediaRecorderRef.current?.state !== "inactive") {
            setRecorderState("error");
            setRecorderError("マイクが切断されました。録音済み部分を保存し、マイクを接続し直してください。");
            void stopMicrophoneRecording(false, true);
          }
        }, { once: true });
      }
      mediaRecorderRef.current = recorder;
      recorder.start(1000);
      startedSession = null;
      stream = null;
      setRecorderState("recording");
    } catch (error) {
      for (const track of stream?.getTracks() || []) track.stop();
      releaseMicrophoneStream();
      if (startedSession) {
        try {
          await workspaceApi.cancelAudioCapture(startedSession.sessionId);
          recordingSessionRef.current = null;
        } catch (cancelError) {
          recordingSessionRef.current = startedSession;
          setRecorderState("error");
          setRecorderError(`録音を開始できず、一時sessionも破棄できませんでした。${cancelError instanceof Error ? cancelError.message : String(cancelError)} 保存待ち音声から破棄してください。`);
          return;
        }
      }
      setRecorderState("error");
      setRecorderError(microphoneErrorMessage(error));
    }
  }

  function queueRecordingTransition<T>(transition: () => Promise<T>): Promise<T> {
    const result = recordingTransitionRef.current.then(transition, transition);
    recordingTransitionRef.current = result.then(() => undefined, () => undefined);
    return result;
  }

  function pauseMicrophoneRecording(): Promise<void> {
    return queueRecordingTransition(pauseMicrophoneRecordingNow);
  }

  async function pauseMicrophoneRecordingNow() {
    const recorder = mediaRecorderRef.current;
    const session = recordingSessionRef.current;
    if (!recorder || !session || recorder.state !== "recording") return;
    try {
      const recorderPaused = new Promise<void>((resolve) => recorder.addEventListener("pause", () => resolve(), { once: true }));
      recorder.pause();
      recordingAccumulatedMsRef.current += performance.now() - recordingStartedAtRef.current;
      await recorderPaused;
      await waitForMediaRecorderDataFlush(recorder);
      await recordingAppendRef.current;
      await workspaceApi.pauseMediaRecording(session.sessionId);
      setRecorderElapsedMs(recordingAccumulatedMsRef.current);
      setRecorderState("paused");
    } catch (error) {
      setRecorderState("error");
      setRecorderError(`録音を一時停止できませんでした。${error instanceof Error ? error.message : String(error)} 録音済み部分を保存し、保存待ち音声を確認してください。`);
      await stopMicrophoneRecordingNow(false, true);
    }
  }

  function resumeMicrophoneRecording(): Promise<void> {
    return queueRecordingTransition(resumeMicrophoneRecordingNow);
  }

  async function resumeMicrophoneRecordingNow() {
    const recorder = mediaRecorderRef.current;
    const session = recordingSessionRef.current;
    if (!recorder || !session || recorder.state !== "paused") return;
    try {
      await workspaceApi.resumeMediaRecording(session.sessionId);
      recordingStartedAtRef.current = performance.now();
      recorder.resume();
      setRecorderState("recording");
    } catch (error) {
      setRecorderState("error");
      setRecorderError(`録音を再開できませんでした。${error instanceof Error ? error.message : String(error)} 録音済み部分を保存し、保存待ち音声を確認してください。`);
      await stopMicrophoneRecordingNow(false, true);
    }
  }

  function stopMicrophoneRecording(autoCommit = true, preserveError = false): Promise<AudioCapturePrepared | null> {
    return queueRecordingTransition(() => stopMicrophoneRecordingNow(autoCommit, preserveError));
  }

  async function stopMicrophoneRecordingNow(autoCommit = true, preserveError = false): Promise<AudioCapturePrepared | null> {
    if (recordingDiscardingRef.current) return null;
    if (recordingStopRef.current) return recordingStopRef.current;
    const recorder = mediaRecorderRef.current;
    const session = recordingSessionRef.current;
    if (!session) return null;
    recordingStopRef.current = (async () => {
      if (!preserveError) setRecorderState("stopping");
      if (recorder && recorder.state !== "inactive") {
        await new Promise<void>((resolve) => {
          recorder.addEventListener("stop", () => resolve(), { once: true });
          recorder.requestData();
          recorder.stop();
        });
      }
      if (recorder?.state === "inactive" && recordingStartedAtRef.current > 0 && recorderState === "recording") {
        recordingAccumulatedMsRef.current += performance.now() - recordingStartedAtRef.current;
      }
      await recordingAppendRef.current;
      const prepared = await workspaceApi.stopMediaRecording(session.sessionId);
      releaseMicrophoneStream();
      recordingSessionRef.current = null;
      onPreparedChanged?.();
      if (autoCommit) await commitPreparedAudio(prepared);
      if (!preserveError) {
        setRecorderState("idle");
        setRecorderError("");
      }
      return prepared;
    })().catch((error) => {
      releaseMicrophoneStream();
      setRecorderState("error");
      setRecorderError(`録音を停止できませんでした。${error instanceof Error ? error.message : String(error)} 保存待ち音声から復旧または破棄してください。`);
      return null;
    }).finally(() => {
      recordingStopRef.current = null;
    });
    return recordingStopRef.current;
  }

  function discardActiveRecording(): Promise<void> {
    return queueRecordingTransition(discardActiveRecordingNow);
  }

  async function discardActiveRecordingNow() {
    const session = recordingSessionRef.current;
    const recorder = mediaRecorderRef.current;
    if (!session) return;
    recordingDiscardingRef.current = true;
    try {
      if (recorder && recorder.state !== "inactive") {
        await new Promise<void>((resolve) => {
          recorder.addEventListener("stop", () => resolve(), { once: true });
          recorder.stop();
        });
      }
      await recordingAppendRef.current;
      releaseMicrophoneStream();
      await workspaceApi.cancelAudioCapture(session.sessionId);
      recordingSessionRef.current = null;
      setRecorderState("idle");
      setRecorderError("");
      setRecorderElapsedMs(0);
      setRecorderBytes(0);
      setToast("録音を破棄しました。", "info");
    } catch (error) {
      releaseMicrophoneStream();
      setRecorderState("error");
      setRecorderError(`録音を破棄できませんでした。${error instanceof Error ? error.message : String(error)} 保存待ち音声からもう一度破棄してください。`);
    } finally {
      recordingDiscardingRef.current = false;
    }
  }

  const stopMicrophoneRecordingRef = useRef(stopMicrophoneRecording);
  stopMicrophoneRecordingRef.current = stopMicrophoneRecording;

  useEffect(() => {
    const flushMicrophoneRecording = async (): Promise<boolean> => {
      await recordingBeginRef.current;
      if (!recordingSessionRef.current) return true;
      return (await stopMicrophoneRecordingRef.current(false)) !== null;
    };
    const onFlush = (event: Event) => {
      if (!recordingBeginRef.current && !recordingSessionRef.current) return;
      const detail = (event as CustomEvent<{ handled: boolean; flush: Promise<boolean> | null }>).detail;
      const previous = detail.flush;
      detail.handled = true;
      detail.flush = Promise.all([previous || Promise.resolve(true), flushMicrophoneRecording()]).then(([left, right]) => left && right);
    };
    window.addEventListener("tasken:app-flush-requested", onFlush);
    return () => {
      window.removeEventListener("tasken:app-flush-requested", onFlush);
      if (recordingBeginRef.current || recordingSessionRef.current) {
        const routeFlush = flushMicrophoneRecording();
        trackPendingMediaRecordingFlush(routeFlush);
      }
    };
  }, []);

  useEffect(() => {
    if (recorderState !== "recording") return undefined;
    const timer = window.setInterval(() => {
      const elapsed = recordingAccumulatedMsRef.current + Math.max(0, performance.now() - recordingStartedAtRef.current);
      setRecorderElapsedMs(elapsed);
      const maximum = recordingSessionRef.current?.maxDurationMs;
      if (maximum && elapsed >= maximum) void stopMicrophoneRecording();
    }, 250);
    return () => window.clearInterval(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [recorderState]);

  async function commitPreparedAudio(prepared: AudioCapturePrepared) {
    if (!prepared.canCommit || prepared.status !== "ready" || !prepared.mediaUrl) {
      setToast("この音声は安全に読み込めないため保存できません。内容を確認して破棄してください。", "warning");
      return;
    }
    setAudioBusySessionId(prepared.sessionId);
    try {
      const durationMs = prepared.durationMs ?? await audioDurationMs(prepared.mediaUrl);
      await workspaceApi.commitAudioCapture({ sessionId: prepared.sessionId, durationMs });
      onPreparedChanged?.();
      setToast(`音声「${prepared.filename}」をInboxへ保存しました。`, "success");
    } catch (error) {
      setToast(`音声を保存できませんでした。${error instanceof Error ? error.message : String(error)} 保存待ち音声から再試行できます。`, "danger");
    } finally {
      setAudioBusySessionId(null);
    }
  }

  async function captureAudioFile() {
    try {
      const result = await workspaceApi.prepareAudioCapture(activeThemeId || null);
      if (result.canceled) return;
      onPreparedChanged?.();
      await commitPreparedAudio(result);
    } catch (error) {
      setToast(`音声を取り込めませんでした。${error instanceof Error ? error.message : String(error)}`, "danger");
    }
  }

  return (
    <section className="panel studio-recorder" aria-label="音声">
      <div className="section-heading">
        <h2>音声</h2>
        <div className="inline-actions">
          <Button variant="secondary" compact onClick={() => { void captureAudioFile(); }} disabled={audioBusySessionId !== null}>
            <IconVolume size={15} />音声を取り込む
          </Button>
          <Button
            variant="primary"
            compact
            onClick={() => { void prepareMicrophone(); }}
            disabled={disabled || (recorderState !== "idle" && recorderState !== "error")}
          >
            <IconMicrophone size={15} />{recorderState === "permission" ? "確認中…" : "マイクで録音"}
          </Button>
        </div>
      </div>
      {recorderState !== "idle" && (
        <div className={`studio-recorder-body ${recorderState === "error" ? "is-error" : ""}`} aria-live="polite">
          {recorderState === "permission" && <span>マイクの利用可否を確認しています…</span>}
          {recorderState === "ready" && (
            <>
              <label>
                <span>入力</span>
                <select value={selectedAudioDeviceId} onChange={(event) => setSelectedAudioDeviceId(event.target.value)}>
                  {audioDevices.map((device, index) => (
                    <option value={device.deviceId} key={device.deviceId}>{device.label || `マイク ${index + 1}`}</option>
                  ))}
                </select>
              </label>
              <div className="inline-actions">
                <Button variant="secondary" compact onClick={() => { setRecorderState("idle"); setRecorderError(""); }}>閉じる</Button>
                <Button variant="primary" compact disabled={recorderStarting} onClick={() => { void beginMicrophoneRecording(); }}><IconMicrophone size={15} />{recorderStarting ? "開始中…" : "録音を開始"}</Button>
              </div>
            </>
          )}
          {(recorderState === "recording" || recorderState === "paused" || recorderState === "stopping") && (
            <>
              <span className={`inbox-recorder-indicator ${recorderState === "recording" ? "is-recording" : ""}`}>
                {recorderState === "recording" ? "録音中" : recorderState === "paused" ? "一時停止" : "停止しています"}
              </span>
              <strong className="inbox-recorder-time">{formatRecorderElapsed(recorderElapsedMs)}</strong>
              <small>{formatArtifactFileSize(recorderBytes)}</small>
              <div className="inline-actions">
                {recorderState === "recording" && (
                  <Button variant="secondary" compact onClick={() => { void pauseMicrophoneRecording(); }}><IconPlayerPause size={15} />一時停止</Button>
                )}
                {recorderState === "paused" && (
                  <Button variant="secondary" compact onClick={() => { void resumeMicrophoneRecording(); }}><IconPlayerPlay size={15} />再開</Button>
                )}
                <Button variant="primary" compact disabled={recorderState === "stopping"} onClick={() => { void stopMicrophoneRecording(); }}>
                  <IconPlayerStop size={15} />{recorderState === "stopping" ? "保存中…" : "停止して保存"}
                </Button>
                <button type="button" className="text-button compact" disabled={recorderState === "stopping"} onClick={() => { void discardActiveRecording(); }}>破棄</button>
              </div>
            </>
          )}
          {recorderState === "error" && (
            <>
              <span role="alert">{recorderError}</span>
              <div className="inline-actions">
                {recordingSessionRef.current && (
                  <Button variant="secondary" compact onClick={() => { void stopMicrophoneRecording(false, true); }}><IconPlayerStop size={15} />停止して復旧</Button>
                )}
                {recordingSessionRef.current && <button type="button" className="text-button compact" onClick={() => { void discardActiveRecording(); }}>破棄</button>}
                {!recordingSessionRef.current && <Button variant="secondary" compact onClick={() => { void prepareMicrophone(); }}>再試行</Button>}
              </div>
            </>
          )}
        </div>
      )}
    </section>
  );
}
