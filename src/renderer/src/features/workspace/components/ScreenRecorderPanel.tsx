import { forwardRef, useEffect, useImperativeHandle, useMemo, useRef, useState } from "react";
import {
  IconPlayerPause,
  IconPlayerPlay,
  IconPlayerStop,
  IconRefresh,
  IconTrash,
  IconVideo,
} from "@tabler/icons-react";

import { workspaceApi } from "../../../services/workspaceApi";
import type { MediaRecordingStarted, VideoImportPrepared } from "../../../../../shared/mediaCapture";
import type { ScreenRecordingAudioMode, ScreenRecordingEnvironment, ScreenRecordingRegionSelection, ScreenRecordingSourceProjection } from "../../../../../shared/screenRecording.mjs";
import { SCREEN_RECORDING_BITRATES, screenRecordingContainerOf } from "../../../../../shared/screenRecording.mjs";
import { formatArtifactFileSize } from "./artifacts";
import { Button } from "./common";
import { trackPendingMediaRecordingFlush } from "../lib/mediaRecordingFlushRegistry";
import { readVideoMetadata } from "../lib/videoMetadata";

const MAX_PENDING_RECORDING_CHUNKS = 8;

type ScreenRecorderState = "idle" | "loading" | "ready" | "starting" | "recording" | "paused" | "stopping" | "error";

export interface ScreenRecorderPanelHandle {
  openRecorder: () => void;
}

interface ScreenRecorderPanelProps {
  disabled?: boolean;
  onActiveChange?: (active: boolean) => void;
  /** 保存待ちの内容が変わったことを共有パネルへ知らせる（#383）。 */
  onPreparedChanged?: () => void;
  setToast: (message: string, tone: "success" | "warning" | "danger" | "info") => void;
}

function screenRecordingErrorMessage(error: unknown): string {
  const name = error instanceof DOMException ? error.name : "";
  if (name === "NotAllowedError" || name === "SecurityError") {
    return "画面録画が許可されませんでした。録画対象を選び直し、Windowsの画面録画とマイク設定を確認してください。";
  }
  if (name === "NotFoundError" || name === "DevicesNotFoundError") {
    return "録画対象または選択した入力機器が見つかりません。対象と音声入力を選び直して再試行してください。";
  }
  if (name === "NotReadableError") {
    return "画面録画の対象を取得できませんでした。選択した画面またはウィンドウを開いたまま、対象を選び直して再試行してください。";
  }
  if (name === "AbortError") {
    return "画面録画の対象取得が中断されました。画面またはウィンドウを選び直して、もう一度お試しください。";
  }
  return `画面録画を開始できませんでした。${error instanceof Error ? error.message : String(error)} 録画対象を選び直してください。`;
}

function audioModeOf(selection: string): ScreenRecordingAudioMode {
  if (selection === "system") return "system";
  if (selection.startsWith("microphone:")) return "microphone";
  return "off";
}

function audioInputErrorMessage(error: unknown): string {
  const name = error instanceof DOMException ? error.name : "";
  if (name === "NotAllowedError" || name === "SecurityError") {
    return "マイクへのアクセスが許可されませんでした。Windowsのマイク設定を確認して、入力機器を更新してください。";
  }
  if (name === "NotFoundError" || name === "DevicesNotFoundError") {
    return "認識できる音声入力機器がありません。マイクを接続してから入力機器を更新してください。";
  }
  return `入力機器を確認できませんでした。${error instanceof Error ? error.message : String(error)}`;
}

function formatElapsed(milliseconds: number): string {
  const seconds = Math.max(0, Math.floor(milliseconds / 1000));
  return `${String(Math.floor(seconds / 60)).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`;
}

export const ScreenRecorderPanel = forwardRef<ScreenRecorderPanelHandle, ScreenRecorderPanelProps>(function ScreenRecorderPanel({ disabled = false, onActiveChange, onPreparedChanged, setToast }, ref) {
  const [state, setState] = useState<ScreenRecorderState>("idle");
  const [error, setError] = useState("");
  const [sources, setSources] = useState<readonly Readonly<ScreenRecordingSourceProjection>[]>([]);
  const [environment, setEnvironment] = useState<ScreenRecordingEnvironment | null>(null);
  const [sourceToken, setSourceToken] = useState("");
  const [audioSelection, setAudioSelection] = useState("off");
  const [audioDevices, setAudioDevices] = useState<MediaDeviceInfo[]>([]);
  const [includePointer, setIncludePointer] = useState(true);
  const [elapsedMs, setElapsedMs] = useState(0);
  const [recordedBytes, setRecordedBytes] = useState(0);
  const [transitioning, setTransitioning] = useState(false);
  const [regionSelecting, setRegionSelecting] = useState(false);
  const [regionSelection, setRegionSelection] = useState<ScreenRecordingRegionSelection | null>(null);

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
  const cropCleanupRef = useRef<(() => void) | null>(null);

  const selectedSource = useMemo(() => sources.find((source) => source.sourceToken === sourceToken) || null, [sourceToken, sources]);
  const audioMode = audioModeOf(audioSelection);
  const selectedAudioDeviceId = audioSelection.startsWith("microphone:") ? audioSelection.slice("microphone:".length) : "";
  const active = Boolean(startRef.current || sessionRef.current);

  useEffect(() => {
    onActiveChange?.(active || (state !== "idle" && state !== "error"));
  }, [active, onActiveChange, state]);

  // 録画中は本体を開かなくても状態が分かるよう、録画に写り込まないインジケータへ流す（#383）。
  useEffect(() => {
    const visible = state === "recording" || state === "paused" || state === "stopping";
    void workspaceApi.applyRecordingIndicator(visible ? {
      state,
      targetLabel: selectedSource?.label || "",
      elapsedMs: Math.round(elapsedMs),
      keepMainWindowVisible: selectedSource?.kind === "window" && /tasken/i.test(selectedSource.label),
    } : null).catch(() => undefined);
  }, [elapsedMs, selectedSource, state]);

  // 範囲は録画前にも確認できるよう同じ画面上へ表示し、録画終了・閉じる時に確実に畳む。
  useEffect(() => {
    const visible = Boolean(regionSelection) && state !== "idle" && state !== "error";
    void workspaceApi.applyScreenRecordingRegionIndicator(visible ? regionSelection : null).catch(() => undefined);
  }, [regionSelection, state]);

  useEffect(() => () => {
    void workspaceApi.applyScreenRecordingRegionIndicator(null).catch(() => undefined);
  }, []);

  // インジケータの操作はMain経由で届く。録画本体はこの面が持っているため、ここで実行する。
  useEffect(() => workspaceApi.onRecordingIndicatorCommand((command) => {
    if (command === "pause") void pauseRecording();
    else if (command === "resume") void resumeRecording();
    else if (command === "stop") void stopRecording();
    else if (command === "discard") void discardActive();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }), []);

  function releaseStreams() {
    cropCleanupRef.current?.();
    cropCleanupRef.current = null;
    for (const stream of streamsRef.current) {
      for (const track of stream.getTracks()) track.stop();
    }
    streamsRef.current = [];
    recorderRef.current = null;
  }

  async function createCroppedVideoStream(displayStream: MediaStream, region: ScreenRecordingRegionSelection): Promise<MediaStream> {
    const sourceTrack = displayStream.getVideoTracks()[0];
    if (!sourceTrack) throw new Error("範囲録画の映像trackがありません。");
    const video = document.createElement("video");
    video.muted = true;
    video.playsInline = true;
    video.srcObject = new MediaStream([sourceTrack]);
    await new Promise<void>((resolve, reject) => {
      video.onloadedmetadata = () => resolve();
      video.onerror = () => reject(new Error("範囲録画の映像サイズを確認できません。"));
    });
    await video.play();
    const scaleX = video.videoWidth / region.frameSizePx.width;
    const scaleY = video.videoHeight / region.frameSizePx.height;
    if (!Number.isFinite(scaleX) || !Number.isFinite(scaleY) || scaleX <= 0 || scaleY <= 0) {
      throw new Error("画面の拡大率が変わりました。範囲を選び直してください。");
    }
    const sourceX = Math.floor(region.cropPx.x * scaleX);
    const sourceY = Math.floor(region.cropPx.y * scaleY);
    const sourceWidth = Math.ceil(region.cropPx.width * scaleX);
    const sourceHeight = Math.ceil(region.cropPx.height * scaleY);
    if (sourceX < 0 || sourceY < 0 || sourceX + sourceWidth > video.videoWidth || sourceY + sourceHeight > video.videoHeight) {
      throw new Error("画面の拡大率が変わりました。範囲を選び直してください。");
    }
    const canvas = document.createElement("canvas");
    // Windowsの映像encoderが扱えるよう、任意選択された奇数寸法を偶数へ揃える。
    canvas.width = Math.max(2, sourceWidth - (sourceWidth % 2));
    canvas.height = Math.max(2, sourceHeight - (sourceHeight % 2));
    const context = canvas.getContext("2d", { alpha: false });
    if (!context) throw new Error("範囲録画の描画面を作成できません。");
    // 自動captureは最小化直前の次frameを取り逃すと0秒のWebMになる。
    // streamを先に作り、各描画後に明示的にframeを送る。
    const stream = canvas.captureStream(0);
    const canvasTrack = stream.getVideoTracks()[0] as CanvasCaptureMediaStreamTrack | undefined;
    if (!canvasTrack) throw new Error("範囲録画の映像trackを作成できません。");
    const draw = () => {
      context.drawImage(video, sourceX, sourceY, sourceWidth, sourceHeight, 0, 0, canvas.width, canvas.height);
      canvasTrack.requestFrame();
    };
    draw();
    const frameTimer = window.setInterval(draw, 1000 / 30);
    cropCleanupRef.current = () => {
      window.clearInterval(frameTimer);
      video.pause();
      video.srcObject = null;
    };
    return stream;
  }

  async function selectRegion() {
    if (!selectedSource || selectedSource.kind !== "screen" || regionSelecting) return;
    setRegionSelecting(true);
    setError("");
    try {
      const selected = await workspaceApi.selectScreenRecordingRegion(selectedSource.sourceToken);
      if (selected) setRegionSelection(selected);
    } catch (caught) {
      setError(screenRecordingErrorMessage(caught));
    } finally {
      setRegionSelecting(false);
    }
  }

  async function refreshAudioDevices(requestPermission = false): Promise<MediaDeviceInfo[]> {
    if (!navigator.mediaDevices?.enumerateDevices) return [];
    if (requestPermission) {
      const permissionStream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
      permissionStream.getTracks().forEach((track) => track.stop());
    }
    const devices = (await navigator.mediaDevices.enumerateDevices()).filter((device) => device.kind === "audioinput");
    setAudioDevices(devices);
    if (audioSelection.startsWith("microphone:") && !devices.some((device) => device.deviceId === selectedAudioDeviceId)) {
      setAudioSelection("off");
    }
    return devices;
  }

  async function chooseAudioSelection(value: string) {
    setError("");
    if (!value.startsWith("microphone:")) {
      setAudioSelection(value);
      return;
    }
    try {
      // 権限付与前はdevice.labelが空になるため、選択時にだけマイク権限を確認する。
      const devices = await refreshAudioDevices(true);
      if (!devices.some((device) => device.deviceId === value.slice("microphone:".length))) {
        throw new DOMException("No microphone", "NotFoundError");
      }
      setAudioSelection(value);
    } catch (caught) {
      setError(audioInputErrorMessage(caught));
    }
  }

  async function refreshAudioDevicesFromButton() {
    setError("");
    try {
      const devices = await refreshAudioDevices(true);
      if (!devices.length) setError("認識できる音声入力機器がありません。マイクを接続してから再試行してください。");
    } catch (caught) {
      setError(audioInputErrorMessage(caught));
    }
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
    setRegionSelection(null);
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
      setSourceToken((nextSources.find((source) => source.kind === "screen") || nextSources[0]).sourceToken);
      if (audioSelection === "system" && !nextEnvironment.systemAudio) setAudioSelection("off");
      try {
        await refreshAudioDevices(false);
      } catch {
        // 音声なしの画面録画は、入力機器の列挙に失敗しても継続できる。
        setAudioDevices([]);
      }
      setState("ready");
    } catch (caught) {
      setState("error");
      setError(screenRecordingErrorMessage(caught));
    }
  }

  useImperativeHandle(ref, () => ({
    openRecorder: () => {
      if (!disabled && !active && !transitioning && (state === "idle" || state === "error")) void openPicker();
    },
  }));

  function beginRecording(): Promise<void> {
    if (startRef.current) return startRef.current;
    const pending = beginRecordingNow().finally(() => {
      if (startRef.current === pending) startRef.current = null;
    });
    startRef.current = pending;
    return pending;
  }

  async function beginRecordingNow() {
    if (!selectedSource || !environment) {
      setError("録画対象を選択してください。");
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
      await workspaceApi.armScreenRecording({ sourceToken: selectedSource.sourceToken, audioMode, includePointer, ...(regionSelection ? { region: regionSelection } : {}) });
      const displayStream = await navigator.mediaDevices.getDisplayMedia({
        audio: audioMode === "system",
        video: { cursor: includePointer ? "always" : "never" } as MediaTrackConstraints,
      });
      acquiredStreams.push(displayStream);
      let audioTracks = displayStream.getAudioTracks();
      if (audioMode === "microphone") {
        if (!selectedAudioDeviceId) throw new Error("録音する入力機器を選択してください。");
        const microphone = await navigator.mediaDevices.getUserMedia({
          audio: { deviceId: { exact: selectedAudioDeviceId } },
          video: false,
        });
        acquiredStreams.push(microphone);
        audioTracks = microphone.getAudioTracks();
      }
      const videoStream = regionSelection ? await createCroppedVideoStream(displayStream, regionSelection) : displayStream;
      if (videoStream !== displayStream) acquiredStreams.push(videoStream);
      const combined = new MediaStream([...videoStream.getVideoTracks(), ...audioTracks]);
      acquiredStreams.push(combined);
      const mimeType = environment.mimeCandidates.find((candidate) => MediaRecorder.isTypeSupported(candidate));
      if (!mimeType) throw new Error("WebM画面録画形式を利用できなくなりました。アプリを再起動してください。");
      // ownerは保存時に決める。録るために先に何かを作らせない（#383）。
      // Themeもownerに従うので、ここでは持たせない。紐づけ先を選ばない収録が、
      // 選んでもいないThemeの保存先を要求して保存できなくなるのを避ける。
      startedSession = await workspaceApi.startMediaRecording({
        mediaKind: "video",
        mimeType: screenRecordingContainerOf(mimeType),
        themeId: null,
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
      sessionRef.current = null;
      releaseStreams();
      setState("idle");
      setError("");
      if (showToast) await commitStoppedVideo(preparedVideo);
      onPreparedChanged?.();
      return preparedVideo;
    } catch (caught) {
      releaseStreams();
      setState("error");
      setError(`画面録画を停止できませんでした。${caught instanceof Error ? caught.message : String(caught)} 同じ録画sessionの停止を再試行してください。`);
      return null;
    }
  }

  async function commitStoppedVideo(preparedVideo: VideoImportPrepared): Promise<void> {
    if (!preparedVideo.canCommit || preparedVideo.status !== "ready" || !preparedVideo.mediaUrl) {
      setToast("画面録画を自動保存できませんでした。保存待ちから内容を確認してください。", "warning");
      return;
    }
    try {
      const metadata = await readVideoMetadata(preparedVideo.mediaUrl);
      await workspaceApi.commitVideoImport({
        sessionId: preparedVideo.sessionId,
        durationMs: metadata.durationMs,
        widthPx: metadata.widthPx,
        heightPx: metadata.heightPx,
        sourceType: null,
        sourceId: null,
      });
      setToast(`画面録画「${preparedVideo.filename}」を収録物へ保存しました。`, "success");
    } catch (caught) {
      setToast(`画面録画を自動保存できませんでした。${caught instanceof Error ? caught.message : String(caught)} 保存待ちから再試行できます。`, "warning");
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

  if (state === "idle") return null;

  return (
    <section className="panel studio-recorder" aria-label="画面録画">
      <div className="section-heading">
        <h2>画面録画</h2>
      </div>
      <div className={`studio-recorder-body inbox-screen-recorder ${state === "error" ? "is-error" : ""}`} aria-live="polite">
          {(state === "loading" || state === "starting") && <span>{state === "loading" ? "録画対象を確認しています…" : "録画を開始しています…"}</span>}
          {state === "ready" && (
            <>
              <div className="screen-recorder-targets">
                <div className="screen-recorder-target-group">
                  <strong>画面</strong>
                  <div className="screen-recorder-source-grid" role="radiogroup" aria-label="画面の録画対象">
                    {sources.filter((source) => source.kind === "screen").map((source) => (
                      <button
                        type="button"
                        role="radio"
                        aria-checked={source.sourceToken === sourceToken}
                        className={source.sourceToken === sourceToken ? "is-selected" : ""}
                        key={source.sourceToken}
                        onClick={() => { setSourceToken(source.sourceToken); setRegionSelection(null); }}
                      >
                        <img src={source.thumbnailDataUrl} alt="" />
                        <span>画面全体</span>
                        <small>{source.label}</small>
                      </button>
                    ))}
                    {selectedSource?.kind === "screen" && (
                      <div className={`screen-recorder-region-card ${regionSelection ? "is-selected" : ""}`}>
                        <Button variant="secondary" compact disabled={transitioning || regionSelecting} onClick={() => { void selectRegion(); }}>
                          {regionSelecting ? "範囲を選択中…" : regionSelection ? "範囲を選び直す" : "範囲を選択"}
                        </Button>
                        {regionSelection && <><small>{regionSelection.rectDip.width} × {regionSelection.rectDip.height} DIP</small><button type="button" className="text-button compact" onClick={() => setRegionSelection(null)}>画面全体へ戻す</button></>}
                      </div>
                    )}
                  </div>
                </div>
                {sources.some((source) => source.kind === "window") && (
                  <div className="screen-recorder-target-group">
                    <strong>ウィンドウ</strong>
                    <div className="screen-recorder-source-grid" role="radiogroup" aria-label="ウィンドウの録画対象">
                      {sources.filter((source) => source.kind === "window").map((source) => (
                        <button
                          type="button"
                          role="radio"
                          aria-checked={source.sourceToken === sourceToken}
                          className={source.sourceToken === sourceToken ? "is-selected" : ""}
                          key={source.sourceToken}
                          onClick={() => { setSourceToken(source.sourceToken); setRegionSelection(null); }}
                        >
                          <img src={source.thumbnailDataUrl} alt="" />
                          <span>{source.label}</span>
                          <small>ウィンドウ</small>
                        </button>
                      ))}
                    </div>
                  </div>
                )}
              </div>
              <div className="screen-recorder-control-row">
                <div className="screen-recorder-settings">
                  <label><span>音声入力</span><select value={audioSelection} onChange={(event) => { void chooseAudioSelection(event.target.value); }}>
                    <option value="off">音声なし</option>
                    <option value="system" disabled={!environment?.systemAudio}>システム音声（PCの音）</option>
                    {!audioDevices.length && <option value="no-microphone" disabled>入力機器なし</option>}
                    {audioDevices.map((device, index) => (
                      <option key={device.deviceId} value={`microphone:${device.deviceId}`}>
                        {device.label || `マイク ${index + 1}`}
                      </option>
                    ))}
                  </select></label>
                  <Button variant="secondary" compact disabled={transitioning} onClick={() => { void refreshAudioDevicesFromButton(); }}>入力機器を更新</Button>
                  <label className="screen-recorder-check"><input type="checkbox" checked={includePointer} onChange={(event) => setIncludePointer(event.target.checked)} />カーソルを録画</label>
                  <small>{environment ? `空き ${formatArtifactFileSize(environment.availableRecordingBytes)} · 上限 ${formatArtifactFileSize(environment.maxRecordingBytes)}` : ""}</small>
                </div>
                <div className="inline-actions">
                  <Button variant="secondary" compact disabled={transitioning} onClick={() => { void openPicker(); }}><IconRefresh size={15} />更新</Button>
                  <Button variant="secondary" compact disabled={transitioning} onClick={() => setState("idle")}>閉じる</Button>
                  <Button variant="primary" compact disabled={transitioning || !selectedSource} onClick={() => { void beginRecording(); }}><IconVideo size={15} />録画を開始</Button>
                </div>
              </div>
              {environment && !environment.systemAudio && <small>{environment.systemAudioReason}</small>}
              {error && <small className="screen-recorder-inline-error" role="alert">{error}</small>}
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
      </div>
    </section>
  );
});
