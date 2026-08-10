import { useEffect, useMemo, useRef, useState } from "react";
import {
  IconDeviceDesktop,
  IconPlayerPause,
  IconPlayerPlay,
  IconPlayerStop,
  IconRefresh,
  IconTrash,
  IconVideo,
} from "@tabler/icons-react";

import { workspaceApi } from "../../../services/workspaceApi";
import type { MediaRecordingStarted, VideoArtifactSourceType, VideoImportPrepared } from "../../../../../shared/mediaCapture";
import type { ScreenRecordingAudioMode, ScreenRecordingEnvironment, ScreenRecordingSourceProjection } from "../../../../../shared/screenRecording.mjs";
import { SCREEN_RECORDING_BITRATES, screenRecordingContainerOf } from "../../../../../shared/screenRecording.mjs";
import { formatArtifactFileSize } from "./artifacts";
import { Button } from "./common";
import { trackPendingMediaRecordingFlush } from "../lib/mediaRecordingFlushRegistry";

const MAX_PENDING_RECORDING_CHUNKS = 8;

type ScreenRecorderState = "idle" | "loading" | "ready" | "starting" | "recording" | "paused" | "stopping" | "error";

export interface ScreenRecordingOwnerOption {
  key: string;
  label: string;
  sourceType: VideoArtifactSourceType;
  sourceId: string;
}

interface ScreenRecorderPanelProps {
  owners: ScreenRecordingOwnerOption[];
  disabled?: boolean;
  onActiveChange?: (active: boolean) => void;
  setToast: (message: string, tone: "success" | "warning" | "danger" | "info") => void;
}

function screenRecordingErrorMessage(error: unknown): string {
  const name = error instanceof DOMException ? error.name : "";
  if (name === "NotAllowedError" || name === "SecurityError") {
    return "画面録画が許可されませんでした。録画対象を選び直し、Windowsの画面録画とマイク設定を確認してください。";
  }
  if (name === "NotFoundError" || name === "DevicesNotFoundError") {
    return "録画対象またはマイクが見つかりません。対象を開くかマイクを接続して再試行してください。";
  }
  if (name === "NotReadableError" || name === "AbortError") {
    return "録画対象を読み取れません。他の録画アプリを停止して再試行してください。";
  }
  return `画面録画を開始できませんでした。${error instanceof Error ? error.message : String(error)} 録画対象を選び直してください。`;
}

function formatElapsed(milliseconds: number): string {
  const seconds = Math.max(0, Math.floor(milliseconds / 1000));
  return `${String(Math.floor(seconds / 60)).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`;
}

function readVideoMetadata(mediaUrl: string): Promise<{ durationMs: number; widthPx: number; heightPx: number }> {
  return new Promise((resolve, reject) => {
    const video = document.createElement("video");
    const cleanup = () => {
      window.clearTimeout(timer);
      video.onloadedmetadata = null;
      video.onseeked = null;
      video.onerror = null;
      video.removeAttribute("src");
      video.load();
    };
    const timer = window.setTimeout(() => {
      cleanup();
      reject(new Error("動画metadataの読み込みが時間内に完了しませんでした。"));
    }, 10_000);
    const resolveMetadata = () => {
      const durationMs = Math.round(video.duration * 1000);
      const widthPx = video.videoWidth;
      const heightPx = video.videoHeight;
      if (!Number.isSafeInteger(durationMs) || durationMs < 0 || !widthPx || !heightPx) return false;
      cleanup();
      resolve({ durationMs, widthPx, heightPx });
      return true;
    };
    video.preload = "metadata";
    video.onloadedmetadata = () => {
      if (resolveMetadata()) return;
      // MediaRecorder WebMはduration cueを持たず最初にInfinityを返す場合がある。
      // seekでdemux済みの終端時刻を確定させ、同じprepared bytesからだけmetadataを得る。
      video.onseeked = () => {
        if (!resolveMetadata()) {
          cleanup();
          reject(new Error("動画metadataを確認できませんでした。"));
        }
      };
      video.currentTime = 7 * 24 * 60 * 60;
    };
    video.onerror = () => {
      cleanup();
      reject(new Error("録画動画を再生できません。内容を確認して破棄してください。"));
    };
    video.src = mediaUrl;
  });
}

export function ScreenRecorderPanel({ owners, disabled = false, onActiveChange, setToast }: ScreenRecorderPanelProps) {
  const [state, setState] = useState<ScreenRecorderState>("idle");
  const [error, setError] = useState("");
  const [sources, setSources] = useState<readonly Readonly<ScreenRecordingSourceProjection>[]>([]);
  const [environment, setEnvironment] = useState<ScreenRecordingEnvironment | null>(null);
  const [sourceToken, setSourceToken] = useState("");
  const [ownerKey, setOwnerKey] = useState(owners[0]?.key || "");
  const [audioMode, setAudioMode] = useState<ScreenRecordingAudioMode>("off");
  const [includePointer, setIncludePointer] = useState(true);
  const [elapsedMs, setElapsedMs] = useState(0);
  const [recordedBytes, setRecordedBytes] = useState(0);
  const [prepared, setPrepared] = useState<VideoImportPrepared[]>([]);
  const [preparedState, setPreparedState] = useState<"loading" | "ready" | "error">("loading");
  const [busySessionId, setBusySessionId] = useState<string | null>(null);
  const [transitioning, setTransitioning] = useState(false);

  const recorderRef = useRef<MediaRecorder | null>(null);
  const streamsRef = useRef<MediaStream[]>([]);
  const sessionRef = useRef<MediaRecordingStarted | null>(null);
  const sequenceRef = useRef(0);
  const queuedBytesRef = useRef(0);
  const appendRef = useRef<Promise<void>>(Promise.resolve());
  const startedAtRef = useRef(0);
  const accumulatedMsRef = useRef(0);
  const stopRef = useRef<Promise<VideoImportPrepared | null> | null>(null);
  const startRef = useRef<Promise<void> | null>(null);
  const discardingRef = useRef(false);
  const transitionRef = useRef<Promise<void>>(Promise.resolve());
  const stopNowRef = useRef<(showToast?: boolean) => Promise<VideoImportPrepared | null>>(async () => null);

  const selectedOwner = useMemo(() => owners.find((owner) => owner.key === ownerKey) || null, [ownerKey, owners]);
  const selectedSource = useMemo(() => sources.find((source) => source.sourceToken === sourceToken) || null, [sourceToken, sources]);
  const active = Boolean(startRef.current || sessionRef.current);

  useEffect(() => {
    if (!owners.some((owner) => owner.key === ownerKey)) setOwnerKey(owners[0]?.key || "");
  }, [ownerKey, owners]);

  useEffect(() => {
    onActiveChange?.(active);
  }, [active, onActiveChange, state]);

  async function refreshPrepared() {
    setPreparedState("loading");
    try {
      const entries = await workspaceApi.listPreparedVideoImports();
      setPrepared(entries.filter((entry) => entry.filename.startsWith("screen-recording-")));
      setPreparedState("ready");
    } catch (caught) {
      setPreparedState("error");
      setToast(`保存待ち画面録画を確認できませんでした。${caught instanceof Error ? caught.message : String(caught)}`, "warning");
    }
  }

  useEffect(() => {
    void refreshPrepared();
  }, []);

  function releaseStreams() {
    for (const stream of streamsRef.current) {
      for (const track of stream.getTracks()) track.stop();
    }
    streamsRef.current = [];
    recorderRef.current = null;
  }

  function queueBlob(blob: Blob) {
    const session = sessionRef.current;
    if (!session || discardingRef.current || blob.size <= 0) return;
    const maxQueuedBytes = session.maxChunkBytes * MAX_PENDING_RECORDING_CHUNKS;
    if (blob.size > maxQueuedBytes || queuedBytesRef.current + blob.size > maxQueuedBytes) {
      setError("録画データの保存が追いつきませんでした。録画済み部分を停止し、保存待ち画面録画を確認してください。");
      setState("error");
      window.setTimeout(() => { void stopNowRef.current(false); }, 0);
      return;
    }
    queuedBytesRef.current += blob.size;
    appendRef.current = appendRef.current.then(async () => {
      for (let offset = 0; offset < blob.size; offset += session.maxChunkBytes) {
        const chunk = await blob.slice(offset, Math.min(blob.size, offset + session.maxChunkBytes)).arrayBuffer();
        const progress = await workspaceApi.appendMediaRecording({
          sessionId: session.sessionId,
          sequence: sequenceRef.current,
          chunk,
        });
        sequenceRef.current = progress.nextSequence;
        setRecordedBytes(progress.fileSize);
        if (progress.fileSize >= session.maxRecordingBytes) {
          setError("録画サイズの上限に達しました。停止して内容を確認してください。");
          setState("error");
          window.setTimeout(() => { void stopNowRef.current(false); }, 0);
        }
      }
    }).catch((caught) => {
      if (discardingRef.current) return;
      setError(`録画データを保存できませんでした。${caught instanceof Error ? caught.message : String(caught)} 停止して保存待ち画面録画を確認してください。`);
      setState("error");
      window.setTimeout(() => { void stopNowRef.current(false); }, 0);
    }).finally(() => {
      queuedBytesRef.current = Math.max(0, queuedBytesRef.current - blob.size);
    });
  }

  async function openPicker() {
    if (disabled || active) return;
    setState("loading");
    setError("");
    try {
      if (!navigator.mediaDevices?.getDisplayMedia || typeof MediaRecorder === "undefined") {
        throw new Error("この環境では画面録画を利用できません。Windows版Taskenを再起動してください。");
      }
      const [nextEnvironment, nextSources] = await Promise.all([
        workspaceApi.getScreenRecordingCapabilities(),
        workspaceApi.listScreenRecordingSources(),
      ]);
      const supportedMime = nextEnvironment.mimeCandidates.find((candidate) => MediaRecorder.isTypeSupported(candidate));
      if (!supportedMime) throw new Error("この環境はTaskenのWebM画面録画形式に対応していません。");
      if (!nextSources.length) throw new Error("録画できる画面またはウィンドウがありません。対象を開いて再試行してください。");
      setEnvironment(nextEnvironment);
      setSources(nextSources);
      setSourceToken(nextSources[0].sourceToken);
      if (audioMode === "system" && !nextEnvironment.systemAudio) setAudioMode("off");
      setState("ready");
    } catch (caught) {
      setState("error");
      setError(screenRecordingErrorMessage(caught));
    }
  }

  function beginRecording(): Promise<void> {
    if (startRef.current) return startRef.current;
    const pending = beginRecordingNow().finally(() => {
      if (startRef.current === pending) startRef.current = null;
    });
    startRef.current = pending;
    return pending;
  }

  async function beginRecordingNow() {
    if (!selectedSource || !selectedOwner || !environment) {
      setError("録画対象と保存先を選択してください。");
      setState("error");
      return;
    }
    let startedSession: MediaRecordingStarted | null = null;
    const acquiredStreams: MediaStream[] = [];
    setState("starting");
    setError("");
    try {
      if (audioMode === "system" && !environment.systemAudio) {
        throw new Error(environment.systemAudioReason || "この環境ではシステム音声を録音できません。");
      }
      await workspaceApi.armScreenRecording({ sourceToken: selectedSource.sourceToken, audioMode, includePointer });
      const displayStream = await navigator.mediaDevices.getDisplayMedia({
        audio: audioMode === "system",
        video: { cursor: includePointer ? "always" : "never" } as MediaTrackConstraints,
      });
      acquiredStreams.push(displayStream);
      let audioTracks = displayStream.getAudioTracks();
      if (audioMode === "microphone") {
        const microphone = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
        acquiredStreams.push(microphone);
        audioTracks = microphone.getAudioTracks();
      }
      const combined = new MediaStream([...displayStream.getVideoTracks(), ...audioTracks]);
      acquiredStreams.push(combined);
      const mimeType = environment.mimeCandidates.find((candidate) => MediaRecorder.isTypeSupported(candidate));
      if (!mimeType) throw new Error("WebM画面録画形式を利用できなくなりました。アプリを再起動してください。");
      startedSession = await workspaceApi.startMediaRecording({
        mediaKind: "video",
        mimeType: screenRecordingContainerOf(mimeType),
        sourceType: selectedOwner.sourceType,
        sourceId: selectedOwner.sourceId,
      });
      const recorder = new MediaRecorder(combined, { mimeType, ...SCREEN_RECORDING_BITRATES });
      recorder.addEventListener("dataavailable", (event) => queueBlob(event.data));
      recorder.addEventListener("error", () => {
        setError("録画対象でエラーが発生しました。録画済み部分を停止して確認してください。");
        setState("error");
        void stopNowRef.current(false);
      });
      for (const track of displayStream.getVideoTracks()) {
        track.addEventListener("ended", () => {
          if (sessionRef.current) {
            setError("録画対象が閉じられました。録画済み部分を停止して確認してください。");
            void stopNowRef.current(false);
          }
        }, { once: true });
      }
      streamsRef.current = acquiredStreams;
      recorderRef.current = recorder;
      sessionRef.current = startedSession;
      sequenceRef.current = 0;
      queuedBytesRef.current = 0;
      appendRef.current = Promise.resolve();
      accumulatedMsRef.current = 0;
      startedAtRef.current = performance.now();
      setElapsedMs(0);
      setRecordedBytes(0);
      recorder.start(1000);
      setState("recording");
    } catch (caught) {
      for (const stream of acquiredStreams) stream.getTracks().forEach((track) => track.stop());
      let cancelFailed = false;
      if (startedSession) {
        try {
          await workspaceApi.cancelVideoImport(startedSession.sessionId);
        } catch (cancelError) {
          cancelFailed = true;
          sessionRef.current = startedSession;
          setToast(`開始できなかった録画sessionを破棄できませんでした。${cancelError instanceof Error ? cancelError.message : String(cancelError)} 保存待ち画面録画を確認してください。`, "danger");
        }
      }
      if (!cancelFailed) sessionRef.current = null;
      releaseStreams();
      setState("error");
      setError(`${screenRecordingErrorMessage(caught)}${cancelFailed ? " 作成済みの録画sessionを破棄してください。" : ""}`);
    }
  }

  function queueRecordingTransition<T>(transition: () => Promise<T>): Promise<T> {
    setTransitioning(true);
    const result = transitionRef.current.then(transition, transition);
    const settled = result.then(() => undefined, () => undefined);
    transitionRef.current = settled;
    void settled.then(() => {
      if (transitionRef.current === settled) setTransitioning(false);
    });
    return result;
  }

  function pauseRecording(): Promise<void> {
    return queueRecordingTransition(pauseRecordingNow);
  }

  async function pauseRecordingNow() {
    const recorder = recorderRef.current;
    const session = sessionRef.current;
    if (!recorder || !session || recorder.state !== "recording") return;
    try {
      const paused = new Promise<void>((resolve) => recorder.addEventListener("pause", () => resolve(), { once: true }));
      recorder.pause();
      await paused;
      const dataQueued = new Promise<void>((resolve) => recorder.addEventListener("dataavailable", () => resolve(), { once: true }));
      recorder.requestData();
      await dataQueued;
      await appendRef.current;
      await workspaceApi.pauseMediaRecording(session.sessionId);
      accumulatedMsRef.current += Math.max(0, performance.now() - startedAtRef.current);
      setState("paused");
    } catch (caught) {
      setError(`画面録画を一時停止できませんでした。${caught instanceof Error ? caught.message : String(caught)} 録画済み部分を停止してください。`);
      setState("error");
      await stopRecordingNow(false);
    }
  }

  function resumeRecording(): Promise<void> {
    return queueRecordingTransition(resumeRecordingNow);
  }

  async function resumeRecordingNow() {
    const recorder = recorderRef.current;
    const session = sessionRef.current;
    if (!recorder || !session || recorder.state !== "paused") return;
    try {
      await workspaceApi.resumeMediaRecording(session.sessionId);
      recorder.resume();
      startedAtRef.current = performance.now();
      setState("recording");
    } catch (caught) {
      setError(`画面録画を再開できませんでした。${caught instanceof Error ? caught.message : String(caught)} 録画済み部分を停止してください。`);
      setState("error");
      await stopRecordingNow(false);
    }
  }

  function stopRecording(showToast = true): Promise<VideoImportPrepared | null> {
    return queueRecordingTransition(() => stopRecordingNow(showToast));
  }

  function stopRecordingNow(showToast = true): Promise<VideoImportPrepared | null> {
    if (stopRef.current) return stopRef.current;
    const pending = performStopRecording(showToast).finally(() => {
      if (stopRef.current === pending) stopRef.current = null;
    });
    stopRef.current = pending;
    return pending;
  }

  async function performStopRecording(showToast: boolean): Promise<VideoImportPrepared | null> {
    await startRef.current;
    const recorder = recorderRef.current;
    const session = sessionRef.current;
    if (!session) return null;
    setState("stopping");
    try {
      if (recorder && recorder.state !== "inactive") {
        await new Promise<void>((resolve) => {
          recorder.addEventListener("stop", () => resolve(), { once: true });
          recorder.requestData();
          recorder.stop();
        });
      }
      await appendRef.current;
      const stopped = await workspaceApi.stopMediaRecording(session.sessionId);
      if (!("storageMode" in stopped)) throw new Error("画面録画sessionの種別が一致しません。");
      const preparedVideo = stopped as VideoImportPrepared;
      setPrepared((current) => [preparedVideo, ...current.filter((entry) => entry.sessionId !== preparedVideo.sessionId)]);
      sessionRef.current = null;
      releaseStreams();
      setState("idle");
      if (showToast) setToast("画面録画を停止しました。Preview後に明示保存してください。", "info");
      return preparedVideo;
    } catch (caught) {
      releaseStreams();
      setState("error");
      setError(`画面録画を停止できませんでした。${caught instanceof Error ? caught.message : String(caught)} 同じ録画sessionの停止を再試行してください。`);
      return null;
    }
  }
  stopNowRef.current = stopRecording;

  function discardActive(): Promise<void> {
    return queueRecordingTransition(discardActiveNow);
  }

  async function discardActiveNow() {
    const recorder = recorderRef.current;
    const session = sessionRef.current;
    if (!session || discardingRef.current) return;
    discardingRef.current = true;
    try {
      if (recorder && recorder.state !== "inactive") {
        await new Promise<void>((resolve) => {
          recorder.addEventListener("stop", () => resolve(), { once: true });
          recorder.stop();
        });
      }
      // 破棄は失敗済みchunkを保存し直さず、Mainのsession削除へ進む操作。
      await appendRef.current.catch(() => undefined);
      releaseStreams();
      await workspaceApi.cancelVideoImport(session.sessionId);
      sessionRef.current = null;
      setState("idle");
      setToast("画面録画を破棄しました。", "info");
    } catch (caught) {
      releaseStreams();
      setState("error");
      setError(`画面録画を破棄できませんでした。${caught instanceof Error ? caught.message : String(caught)} 保存待ち画面録画から再試行してください。`);
    } finally {
      discardingRef.current = false;
    }
  }

  async function commitPrepared(entry: VideoImportPrepared) {
    if (!entry.canCommit || entry.status !== "ready" || !entry.mediaUrl) return;
    setBusySessionId(entry.sessionId);
    try {
      const metadata = await readVideoMetadata(entry.mediaUrl);
      await workspaceApi.commitVideoImport({ sessionId: entry.sessionId, ...metadata });
      setPrepared((current) => current.filter((candidate) => candidate.sessionId !== entry.sessionId));
      setToast(`画面録画「${entry.filename}」をVideo Artifactへ保存しました。`, "success");
    } catch (caught) {
      setToast(`画面録画を保存できませんでした。${caught instanceof Error ? caught.message : String(caught)} 保存待ち画面録画から再試行できます。`, "danger");
    } finally {
      setBusySessionId(null);
    }
  }

  async function recoverInterrupted(entry: VideoImportPrepared) {
    if (!entry.canRecoverRecording) return;
    setBusySessionId(entry.sessionId);
    try {
      const stopped = await workspaceApi.stopMediaRecording(entry.sessionId);
      if (!("storageMode" in stopped)) throw new Error("画面録画sessionの種別が一致しません。");
      setPrepared((current) => [stopped as VideoImportPrepared, ...current.filter((candidate) => candidate.sessionId !== entry.sessionId)]);
      setToast("中断された画面録画を復旧しました。内容を確認して保存できます。", "success");
    } catch (caught) {
      setToast(`画面録画を復旧できませんでした。${caught instanceof Error ? caught.message : String(caught)} 録画データは保持されています。`, "danger");
    } finally {
      setBusySessionId(null);
    }
  }

  async function retryPrepared(entry: VideoImportPrepared) {
    if (!entry.canRetry || !entry.durationMs || !entry.widthPx || !entry.heightPx) {
      setToast("保存を再試行するmetadataが不足しています。動画をPreviewして確認してください。", "warning");
      return;
    }
    setBusySessionId(entry.sessionId);
    try {
      await workspaceApi.commitVideoImport({ sessionId: entry.sessionId, durationMs: entry.durationMs, widthPx: entry.widthPx, heightPx: entry.heightPx });
      setPrepared((current) => current.filter((candidate) => candidate.sessionId !== entry.sessionId));
      setToast("画面録画の保存を復旧しました。", "success");
    } catch (caught) {
      setToast(`画面録画の保存を復旧できませんでした。${caught instanceof Error ? caught.message : String(caught)}`, "danger");
    } finally {
      setBusySessionId(null);
    }
  }

  async function discardPrepared(entry: VideoImportPrepared) {
    setBusySessionId(entry.sessionId);
    try {
      await workspaceApi.cancelVideoImport(entry.sessionId);
      setPrepared((current) => current.filter((candidate) => candidate.sessionId !== entry.sessionId));
      setToast("保存待ち画面録画を破棄しました。", "info");
    } catch (caught) {
      setToast(`保存待ち画面録画を破棄できませんでした。${caught instanceof Error ? caught.message : String(caught)}`, "danger");
    } finally {
      setBusySessionId(null);
    }
  }

  useEffect(() => {
    const flush = async () => {
      await startRef.current;
      if (!sessionRef.current) return true;
      return (await stopNowRef.current(false)) !== null;
    };
    const onFlush = (event: Event) => {
      if (!startRef.current && !sessionRef.current) return;
      const detail = (event as CustomEvent<{ handled: boolean; flush: Promise<boolean> | null }>).detail;
      const previous = detail.flush;
      detail.handled = true;
      detail.flush = Promise.all([previous || Promise.resolve(true), flush()]).then(([left, right]) => left && right);
    };
    window.addEventListener("tasken:app-flush-requested", onFlush);
    return () => {
      window.removeEventListener("tasken:app-flush-requested", onFlush);
      if (startRef.current || sessionRef.current) trackPendingMediaRecordingFlush(flush());
    };
  }, []);

  useEffect(() => {
    if (state !== "recording") return undefined;
    const timer = window.setInterval(() => {
      const current = accumulatedMsRef.current + Math.max(0, performance.now() - startedAtRef.current);
      setElapsedMs(current);
      if (sessionRef.current && current >= sessionRef.current.maxDurationMs) void stopRecording();
    }, 250);
    return () => window.clearInterval(timer);
  }, [state]);

  return (
    <>
      <Button variant="secondary" onClick={() => { void openPicker(); }} disabled={disabled || active || transitioning || (state !== "idle" && state !== "error")}>
        <IconDeviceDesktop size={16} />{state === "loading" ? "確認中…" : "画面を録画"}
      </Button>
      {state !== "idle" && (
        <section className={`panel inbox-screen-recorder ${state === "error" ? "is-error" : ""}`} aria-label="画面録画" aria-live="polite">
          {(state === "loading" || state === "starting") && <span>{state === "loading" ? "録画対象を確認しています…" : "録画を開始しています…"}</span>}
          {state === "ready" && (
            <>
              <div className="screen-recorder-source-grid" role="radiogroup" aria-label="録画対象">
                {sources.map((source) => (
                  <button
                    type="button"
                    role="radio"
                    aria-checked={source.sourceToken === sourceToken}
                    className={source.sourceToken === sourceToken ? "is-selected" : ""}
                    key={source.sourceToken}
                    onClick={() => setSourceToken(source.sourceToken)}
                  >
                    <img src={source.thumbnailDataUrl} alt="" />
                    <span>{source.label}</span>
                    <small>{source.kind === "screen" ? "画面" : "ウィンドウ"}</small>
                  </button>
                ))}
              </div>
              <div className="screen-recorder-settings">
                <label><span>保存先</span><select value={ownerKey} onChange={(event) => setOwnerKey(event.target.value)}>
                  {owners.map((owner) => <option key={owner.key} value={owner.key}>{owner.label}</option>)}
                </select></label>
                <label><span>音声</span><select value={audioMode} onChange={(event) => setAudioMode(event.target.value as ScreenRecordingAudioMode)}>
                  <option value="off">Off</option>
                  <option value="microphone">Mic</option>
                  <option value="system" disabled={!environment?.systemAudio}>System</option>
                </select></label>
                <label className="screen-recorder-check"><input type="checkbox" checked={includePointer} onChange={(event) => setIncludePointer(event.target.checked)} />Pointer</label>
                <small>{environment ? `空き ${formatArtifactFileSize(environment.availableRecordingBytes)} · 上限 ${formatArtifactFileSize(environment.maxRecordingBytes)}` : ""}</small>
              </div>
              {!owners.length && <span role="alert">保存先にするTask、Capture、または実行中Focusを先に作成してください。</span>}
              {environment && !environment.systemAudio && <small>{environment.systemAudioReason}</small>}
              <div className="inline-actions">
                <Button variant="secondary" compact disabled={transitioning} onClick={() => { void openPicker(); }}><IconRefresh size={15} />更新</Button>
                <Button variant="secondary" compact disabled={transitioning} onClick={() => setState("idle")}>閉じる</Button>
                <Button variant="primary" compact disabled={transitioning || !selectedSource || !selectedOwner} onClick={() => { void beginRecording(); }}><IconVideo size={15} />録画を開始</Button>
              </div>
            </>
          )}
          {(state === "recording" || state === "paused" || state === "stopping") && (
            <>
              <span className={`inbox-recorder-indicator ${state === "recording" ? "is-recording" : ""}`}>{state === "recording" ? "画面録画中" : state === "paused" ? "一時停止" : "停止しています"}</span>
              <strong className="inbox-recorder-time">{formatElapsed(elapsedMs)}</strong>
              <small>{formatArtifactFileSize(recordedBytes)}</small>
              <div className="inline-actions">
                {state === "recording" && <Button variant="secondary" compact disabled={transitioning} onClick={() => { void pauseRecording(); }}><IconPlayerPause size={15} />一時停止</Button>}
                {state === "paused" && <Button variant="secondary" compact disabled={transitioning} onClick={() => { void resumeRecording(); }}><IconPlayerPlay size={15} />再開</Button>}
                <Button variant="primary" compact disabled={transitioning || state === "stopping"} onClick={() => { void stopRecording(); }}><IconPlayerStop size={15} />停止</Button>
                <button type="button" className="text-button compact" disabled={transitioning || state === "stopping"} onClick={() => { void discardActive(); }}><IconTrash size={14} />破棄</button>
              </div>
            </>
          )}
          {state === "error" && <><span role="alert">{error}</span><div className="inline-actions">
            {sessionRef.current && <>
              <Button variant="secondary" compact disabled={transitioning} onClick={() => { void stopRecording(false); }}><IconPlayerStop size={15} />停止して復旧</Button>
              <button type="button" className="text-button compact" disabled={transitioning} onClick={() => { void discardActive(); }}><IconTrash size={14} />破棄</button>
            </>}
            {!sessionRef.current && <Button variant="secondary" compact disabled={transitioning} onClick={() => { void openPicker(); }}>再試行</Button>}
          </div></>}
        </section>
      )}
      {preparedState === "loading" && <div className="inbox-audio-recovery-state">保存待ち画面録画を確認しています…</div>}
      {preparedState === "error" && <div className="inbox-audio-recovery-state is-error" role="alert">保存待ち画面録画を確認できませんでした。<button type="button" className="text-button compact" onClick={() => { void refreshPrepared(); }}>再試行</button></div>}
      {prepared.length > 0 && <section className="panel inbox-screen-recovery" aria-label="保存待ち画面録画">
        <div className="section-heading"><h2>保存待ち画面録画</h2><span>{prepared.length}件</span></div>
        {prepared.map((entry) => {
          const busy = busySessionId === entry.sessionId;
          return <div className="inbox-screen-recovery-row" key={entry.sessionId}>
            {entry.status === "ready" ? <video controls preload="metadata" src={entry.mediaUrl} aria-label={`${entry.filename}の保存前Preview`} /> : <div className="inbox-audio-recovery-warning">要確認</div>}
            <div><strong>{entry.filename}</strong><small>{entry.status === "ready" ? `${entry.mimeType} · ${formatArtifactFileSize(entry.fileSize)}` : "録画が中断されたか、保存を復旧する必要があります。"}</small></div>
            <div className="inline-actions">
              {entry.canCommit && <Button variant="primary" compact disabled={busy} onClick={() => { void commitPrepared(entry); }}>{busy ? "処理中…" : "Artifactへ保存"}</Button>}
              {entry.canRecoverRecording && <Button variant="secondary" compact disabled={busy} onClick={() => { void recoverInterrupted(entry); }}>録画を復旧</Button>}
              {entry.canRetry && <Button variant="secondary" compact disabled={busy} onClick={() => { void retryPrepared(entry); }}>保存を再試行</Button>}
              {entry.canDiscard && <button type="button" className="text-button compact" disabled={busy} onClick={() => { void discardPrepared(entry); }}>破棄</button>}
            </div>
          </div>;
        })}
      </section>}
    </>
  );
}
