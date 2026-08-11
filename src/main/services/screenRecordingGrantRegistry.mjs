import {
  SCREEN_RECORDING_AUDIO_MODES,
  SCREEN_RECORDING_LIMITS,
  SCREEN_RECORDING_SOURCE_KINDS,
  authorizeScreenRecordingGrant,
  normalizeScreenRecordingSecurityOrigin,
  parseScreenRecordingArmRequest,
  sanitizeScreenRecordingSourceLabel,
  validateScreenRecordingSourceProjection,
} from "../../shared/screenRecording.mjs";

const INTERNAL_SOURCE_ID_MAX_CHARS = 512;

function requireRecord(value, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label}が不正です。`);
  }
  return value;
}

function requireSafeInteger(value, label, minimum = 0) {
  if (!Number.isSafeInteger(value) || value < minimum) throw new Error(`${label}が不正です。`);
  return value;
}

function requireInternalSourceId(value) {
  if (
    typeof value !== "string"
    || !value
    || value.length > INTERNAL_SOURCE_ID_MAX_CHARS
    || /[\u0000-\u001f\u007f]/.test(value)
  ) {
    throw new Error("画面録画source IDが不正です。");
  }
  return value;
}

function requireSourceKind(value) {
  if (!SCREEN_RECORDING_SOURCE_KINDS.includes(value)) throw new Error("画面録画source kindが不正です。");
  return value;
}

function requireAudioMode(value) {
  if (!SCREEN_RECORDING_AUDIO_MODES.includes(value)) throw new Error("画面録画audio modeが不正です。");
  return value;
}

function normalizeInternalSource(value) {
  const source = requireRecord(value, "画面録画source");
  const kind = requireSourceKind(source.kind);
  const label = sanitizeScreenRecordingSourceLabel(source.label, kind);
  if (typeof source.thumbnailDataUrl !== "string") throw new Error("画面録画source thumbnailが不正です。");
  return {
    internalSourceId: requireInternalSourceId(source.internalSourceId),
    kind,
    label,
    thumbnailDataUrl: source.thumbnailDataUrl,
    displayId: kind === "screen" && source.displayId ? requireInternalSourceId(source.displayId) : null,
  };
}

export class ScreenRecordingGrantRegistry {
  constructor({ idFactory, getCapabilities, nowMs = () => Date.now(), platform = process.platform } = {}) {
    if (typeof idFactory !== "function") throw new Error("画面録画token factoryが必要です。");
    if (typeof getCapabilities !== "function") throw new Error("画面録画capability resolverが必要です。");
    if (typeof nowMs !== "function") throw new Error("画面録画clockが必要です。");
    if (!["win32", "darwin", "linux"].includes(platform)) throw new Error("画面録画platformが不正です。");
    this.idFactory = idFactory;
    this.getCapabilities = getCapabilities;
    this.nowMs = nowMs;
    this.platform = platform;
    this.sources = new Map();
    this.armedBySender = new Map();
    this.activeTokens = new Map();
  }

  issueSources(sourceValues, contextValue) {
    if (!Array.isArray(sourceValues)) throw new Error("画面録画source一覧が不正です。");
    const context = requireRecord(contextValue, "画面録画source context");
    const senderWebContentsId = requireSafeInteger(context.senderWebContentsId, "画面録画sender ID", 1);
    const frameTreeNodeId = requireSafeInteger(context.frameTreeNodeId, "画面録画frame ID", 1);
    if (context.isMainFrame !== true || context.detached !== false) throw new Error("画面録画は現在のMain frameから選択してください。");
    const securityOrigin = normalizeScreenRecordingSecurityOrigin(context.securityOrigin);
    const now = requireSafeInteger(this.nowMs(), "画面録画時刻");
    this.prune(now);
    this.clearSender(senderWebContentsId);
    const projections = [];
    for (const raw of sourceValues.slice(0, SCREEN_RECORDING_LIMITS.maxSources)) {
      const source = normalizeInternalSource(raw);
      const sourceToken = this.idFactory();
      if (this.activeTokens.has(sourceToken)) {
        throw new Error("画面録画source tokenが重複しています。画面を開き直してください。");
      }
      const expiresAtMs = now + SCREEN_RECORDING_LIMITS.sourceTokenTtlMs;
      const projection = validateScreenRecordingSourceProjection({
        sourceToken,
        kind: source.kind,
        label: source.label,
        thumbnailDataUrl: source.thumbnailDataUrl,
        expiresAt: new Date(expiresAtMs).toISOString(),
      });
      this.sources.set(sourceToken, {
        ...source,
        sourceToken,
        senderWebContentsId,
        frameTreeNodeId,
        securityOrigin,
        expiresAtMs,
      });
      this.activeTokens.set(sourceToken, { senderWebContentsId, expiresAtMs });
      projections.push(projection);
    }
    return Object.freeze(projections);
  }

  arm(requestValue, contextValue) {
    const request = parseScreenRecordingArmRequest(requestValue);
    const context = requireRecord(contextValue, "画面録画arm context");
    const senderWebContentsId = requireSafeInteger(context.senderWebContentsId, "画面録画sender ID", 1);
    const frameTreeNodeId = requireSafeInteger(context.frameTreeNodeId, "画面録画frame ID", 1);
    if (context.isMainFrame !== true || context.detached !== false) throw new Error("画面録画は現在のMain frameから選択してください。");
    const securityOrigin = normalizeScreenRecordingSecurityOrigin(context.securityOrigin);
    const now = requireSafeInteger(this.nowMs(), "画面録画時刻");
    this.prune(now);
    const source = this.sources.get(request.sourceToken);
    if (!source || source.expiresAtMs < now) throw new Error("画面録画の選択期限が切れました。もう一度選択してください。");
    if (source.senderWebContentsId !== senderWebContentsId || source.frameTreeNodeId !== frameTreeNodeId || source.securityOrigin !== securityOrigin) {
      throw new Error("画面録画の要求元が一致しません。");
    }
    if (request.region && JSON.stringify(request.region) !== JSON.stringify(source.selectedRegion)) {
      throw new Error("録画範囲がMainで選択した内容と一致しません。範囲を選び直してください。");
    }
    const audioMode = requireAudioMode(request.audioMode);
    const capabilities = requireRecord(this.getCapabilities(), "画面録画capability");
    if (typeof capabilities.microphone !== "boolean" || typeof capabilities.systemAudio !== "boolean") {
      throw new Error("画面録画capabilityが不正です。");
    }
    if (audioMode === "system" && (this.platform !== "win32" || !capabilities.systemAudio)) {
      throw new Error("この環境ではシステム音声付き画面録画を利用できません。");
    }
    if (audioMode === "microphone" && !capabilities.microphone) {
      throw new Error("利用できるマイクがありません。接続を確認してください。");
    }
    this.sources.delete(request.sourceToken);
    const previous = this.armedBySender.get(senderWebContentsId);
    if (previous) this.activeTokens.delete(previous.sourceToken);
    // source tokenの残り時間を引き継ぐと、選ぶのに時間をかけただけで
    // 直後のgetDisplayMediaが期限切れになる。armは自分の窓を持つ。
    const armExpiresAtMs = now + SCREEN_RECORDING_LIMITS.armTtlMs;
    this.armedBySender.set(senderWebContentsId, {
      ...source,
      expiresAtMs: armExpiresAtMs,
      consumed: false,
      audioMode,
      includePointer: request.includePointer,
      region: request.region || null,
    });
    this.activeTokens.set(source.sourceToken, { senderWebContentsId, expiresAtMs: armExpiresAtMs });
    return Object.freeze({
      armed: true,
      kind: source.kind,
      label: source.label,
      audioMode,
      includePointer: request.includePointer,
      expiresAt: new Date(armExpiresAtMs).toISOString(),
      ...(request.region ? { region: request.region } : {}),
    });
  }

  resolveRegionSource(sourceTokenValue, contextValue) {
    const sourceToken = requireInternalSourceId(sourceTokenValue);
    const context = requireRecord(contextValue, "画面録画region context");
    const senderWebContentsId = requireSafeInteger(context.senderWebContentsId, "画面録画sender ID", 1);
    const frameTreeNodeId = requireSafeInteger(context.frameTreeNodeId, "画面録画frame ID", 1);
    const securityOrigin = normalizeScreenRecordingSecurityOrigin(context.securityOrigin);
    const now = requireSafeInteger(this.nowMs(), "画面録画時刻");
    this.prune(now);
    const source = this.sources.get(sourceToken);
    if (!source || source.expiresAtMs < now) throw new Error("画面録画の選択期限が切れました。もう一度選択してください。");
    if (source.kind !== "screen" || !source.displayId) throw new Error("範囲録画は画面を選択したときだけ利用できます。");
    if (source.senderWebContentsId !== senderWebContentsId || source.frameTreeNodeId !== frameTreeNodeId || source.securityOrigin !== securityOrigin) {
      throw new Error("画面録画の要求元が一致しません。");
    }
    return Object.freeze({ displayId: source.displayId, sourceToken: source.sourceToken });
  }

  bindRegionSelection(sourceTokenValue, regionValue, contextValue) {
    const resolved = this.resolveRegionSource(sourceTokenValue, contextValue);
    const parsed = parseScreenRecordingArmRequest({
      sourceToken: resolved.sourceToken,
      audioMode: "off",
      includePointer: false,
      region: regionValue,
    });
    const source = this.sources.get(resolved.sourceToken);
    if (!source || !parsed.region) throw new Error("録画範囲を保存できませんでした。もう一度選択してください。");
    source.selectedRegion = parsed.region;
    return parsed.region;
  }

  consumeDisplayRequest(requestValue) {
    const request = requireRecord(requestValue, "画面録画permission request");
    const senderWebContentsId = requireSafeInteger(request.senderWebContentsId, "画面録画sender ID", 1);
    const armed = this.armedBySender.get(senderWebContentsId);
    if (!armed) throw new Error("画面録画sourceを選択してから録画を開始してください。");
    const now = requireSafeInteger(this.nowMs(), "画面録画時刻");
    // 検証後のcallback失敗でも同じgrantを再利用させないため、検証前に消費する。
    this.armedBySender.delete(senderWebContentsId);
    this.activeTokens.delete(armed.sourceToken);
    const capabilities = requireRecord(this.getCapabilities(), "画面録画capability");
    if (typeof capabilities.microphone !== "boolean" || typeof capabilities.systemAudio !== "boolean") {
      throw new Error("画面録画capabilityが不正です。");
    }
    if (armed.audioMode === "system" && (this.platform !== "win32" || !capabilities.systemAudio)) {
      throw new Error("システム音声を利用できなくなりました。音声設定を選び直してください。");
    }
    if (armed.audioMode === "microphone" && !capabilities.microphone) {
      throw new Error("マイクを利用できなくなりました。接続を確認してください。");
    }
    const authorization = authorizeScreenRecordingGrant({
      sourceToken: armed.sourceToken,
      senderWebContentsId: armed.senderWebContentsId,
      frameTreeNodeId: armed.frameTreeNodeId,
      securityOrigin: armed.securityOrigin,
      expiresAtMs: armed.expiresAtMs,
      consumed: armed.consumed,
      audioMode: armed.audioMode,
    }, request, now);
    return Object.freeze({
      internalSourceId: armed.internalSourceId,
      kind: armed.kind,
      label: armed.label,
      includePointer: armed.includePointer,
      ...(armed.region ? { region: armed.region } : {}),
      displayAudio: authorization.displayAudio,
      microphoneRequired: authorization.microphoneRequired,
    });
  }

  clearSender(senderWebContentsIdValue) {
    const senderWebContentsId = requireSafeInteger(senderWebContentsIdValue, "画面録画sender ID", 1);
    const armed = this.armedBySender.get(senderWebContentsId);
    if (armed) this.activeTokens.delete(armed.sourceToken);
    this.armedBySender.delete(senderWebContentsId);
    for (const [token, source] of this.sources) {
      if (source.senderWebContentsId === senderWebContentsId) {
        this.sources.delete(token);
        this.activeTokens.delete(token);
      }
    }
  }

  prune(nowValue = this.nowMs()) {
    const now = requireSafeInteger(nowValue, "画面録画時刻");
    for (const [token, source] of this.sources) {
      if (source.expiresAtMs < now) {
        this.sources.delete(token);
        this.activeTokens.delete(token);
      }
    }
    for (const [senderId, grant] of this.armedBySender) {
      if (grant.expiresAtMs < now) {
        this.armedBySender.delete(senderId);
        this.activeTokens.delete(grant.sourceToken);
      }
    }
  }
}
