const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SHA256_PATTERN = /^sha256:[0-9a-f]{64}$/;
const MAIN_OWNED_CURRENT_VIDEO_SOURCE = Symbol("main-owned-current-video-source");

export const SCREEN_RECORDING_EDIT_SCHEMA_VERSION = 1;
export const SCREEN_RECORDING_MIN_REGION_DIP = 64;
export const SCREEN_RECORDING_MAX_DURATION_MS = 7 * 24 * 60 * 60 * 1000;
export const SCREEN_RECORDING_MAX_ARTIFACT_VERSION = 1_000_000;

export const SCREEN_RECORDING_EDIT_ERROR_CODES = Object.freeze([
  "INVALID_REQUEST",
  "DISPLAY_TOPOLOGY_MISMATCH",
  "DISPLAY_TOPOLOGY_AMBIGUOUS",
  "CROSS_DISPLAY_REGION",
  "REGION_TOO_SMALL",
  "DISPLAY_ROTATION_UNSUPPORTED",
  "PIXEL_MAPPING_OUT_OF_BOUNDS",
  "CAPABILITY_UNAVAILABLE",
  "CAPTURE_SURFACE_NOT_EXCLUDED",
  "SOURCE_BINDING_MISMATCH",
  "SOURCE_REVISION_MISMATCH",
  "INVALID_TRIM_RANGE",
  "SOURCE_OVERWRITE_FORBIDDEN",
  "NO_TRIM_APPLIED",
]);

const SAFE_MESSAGES = Object.freeze({
  INVALID_REQUEST: "録画設定を確認して、もう一度操作してください。",
  DISPLAY_TOPOLOGY_MISMATCH: "画面構成が変わりました。範囲を選び直してください。",
  DISPLAY_TOPOLOGY_AMBIGUOUS: "画面の重なりを解消して、範囲を選び直してください。",
  CROSS_DISPLAY_REGION: "録画範囲を1つの画面内に収めてください。",
  REGION_TOO_SMALL: "録画範囲を64×64以上にしてください。",
  DISPLAY_ROTATION_UNSUPPORTED: "回転した画面では矩形録画を利用できません。画面全体を選んでください。",
  PIXEL_MAPPING_OUT_OF_BOUNDS: "画面の拡大率が変わりました。範囲を選び直してください。",
  CAPABILITY_UNAVAILABLE: "この録画設定は現在の環境で利用できません。設定を変更してください。",
  CAPTURE_SURFACE_NOT_EXCLUDED: "録画操作面を映像から除外できません。録画を開始し直してください。",
  SOURCE_BINDING_MISMATCH: "録画対象が更新されました。対象を選び直してください。",
  SOURCE_REVISION_MISMATCH: "元動画が更新されました。trim範囲を確認し直してください。",
  INVALID_TRIM_RANGE: "trimの開始と終了を動画の長さ内で指定してください。",
  SOURCE_OVERWRITE_FORBIDDEN: "元動画は上書きできません。別のArtifactとして書き出してください。",
  NO_TRIM_APPLIED: "trim範囲を変更してから書き出してください。",
});

export class ScreenRecordingEditError extends Error {
  constructor(code) {
    super(SAFE_MESSAGES[code] ?? SAFE_MESSAGES.INVALID_REQUEST);
    this.name = "ScreenRecordingEditError";
    this.code = SCREEN_RECORDING_EDIT_ERROR_CODES.includes(code) ? code : "INVALID_REQUEST";
  }
}

function fail(code) {
  throw new ScreenRecordingEditError(code);
}

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function exactRecord(value, keys, code = "INVALID_REQUEST") {
  if (!isRecord(value)) fail(code);
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) fail(code);
  return value;
}

function boundedText(value, maxLength) {
  if (typeof value !== "string" || value.length < 1 || value.length > maxLength || value.trim() !== value) {
    fail("INVALID_REQUEST");
  }
  return value;
}

function safeInteger(value, minimum, maximum) {
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) fail("INVALID_REQUEST");
  return value;
}

function finiteNumber(value, minimum, maximum) {
  if (!Number.isFinite(value) || value < minimum || value > maximum) fail("INVALID_REQUEST");
  return Object.is(value, -0) ? 0 : value;
}

function uuid(value) {
  if (typeof value !== "string" || !UUID_PATTERN.test(value)) fail("INVALID_REQUEST");
  return value.toLowerCase();
}

function sha256(value) {
  if (typeof value !== "string" || !SHA256_PATTERN.test(value)) fail("INVALID_REQUEST");
  return value;
}

function frozen(value) {
  if (!isRecord(value) && !Array.isArray(value)) return value;
  for (const child of Object.values(value)) frozen(child);
  return Object.freeze(value);
}

function pointDip(value) {
  exactRecord(value, ["x", "y"]);
  return {
    x: finiteNumber(value.x, -1_000_000, 1_000_000),
    y: finiteNumber(value.y, -1_000_000, 1_000_000),
  };
}

function rectDip(value) {
  exactRecord(value, ["x", "y", "width", "height"]);
  return {
    x: safeInteger(value.x, -1_000_000, 1_000_000),
    y: safeInteger(value.y, -1_000_000, 1_000_000),
    width: safeInteger(value.width, 1, 65_536),
    height: safeInteger(value.height, 1, 65_536),
  };
}

function sizePx(value) {
  exactRecord(value, ["width", "height"]);
  return {
    width: safeInteger(value.width, 1, 131_072),
    height: safeInteger(value.height, 1, 131_072),
  };
}

function normalizeDisplayBinding(value, expectedTopologyRevision) {
  exactRecord(value, ["displayId", "topologyRevision", "boundsDip", "scaleFactor", "frameSizePx", "rotationDeg"]);
  const binding = {
    displayId: boundedText(value.displayId, 128),
    topologyRevision: sha256(value.topologyRevision),
    boundsDip: rectDip(value.boundsDip),
    scaleFactor: finiteNumber(value.scaleFactor, 0.5, 8),
    frameSizePx: sizePx(value.frameSizePx),
    rotationDeg: value.rotationDeg,
  };
  if (![0, 90, 180, 270].includes(binding.rotationDeg)) fail("INVALID_REQUEST");
  if (expectedTopologyRevision !== undefined && binding.topologyRevision !== expectedTopologyRevision) {
    fail("DISPLAY_TOPOLOGY_MISMATCH");
  }
  const expectedWidth = Math.round(binding.boundsDip.width * binding.scaleFactor);
  const expectedHeight = Math.round(binding.boundsDip.height * binding.scaleFactor);
  if (Math.abs(binding.frameSizePx.width - expectedWidth) > 1
      || Math.abs(binding.frameSizePx.height - expectedHeight) > 1) {
    fail("DISPLAY_TOPOLOGY_MISMATCH");
  }
  return binding;
}

function sourceRevision(value) {
  return sha256(value);
}

export function createGrantedSourceRevisionBinding(input) {
  exactRecord(input, [
    "sourceToken",
    "sourceKind",
    "sourceRevision",
    "listSnapshotRevision",
    "topologyRevision",
  ]);
  if (!["screen", "window"].includes(input.sourceKind)) fail("INVALID_REQUEST");
  const topologyRevision = input.topologyRevision === null ? null : sha256(input.topologyRevision);
  if ((input.sourceKind === "screen") !== (topologyRevision !== null)) fail("INVALID_REQUEST");
  return frozen({
    sourceToken: uuid(input.sourceToken),
    sourceKind: input.sourceKind,
    sourceRevision: sourceRevision(input.sourceRevision),
    listSnapshotRevision: sha256(input.listSnapshotRevision),
    topologyRevision,
  });
}

function containsRect(bounds, rect) {
  return rect.x >= bounds.x
    && rect.y >= bounds.y
    && rect.x + rect.width <= bounds.x + bounds.width
    && rect.y + rect.height <= bounds.y + bounds.height;
}

function normalizedDragRect(start, end) {
  const left = Math.min(start.x, end.x);
  const top = Math.min(start.y, end.y);
  const right = Math.max(start.x, end.x);
  const bottom = Math.max(start.y, end.y);
  if (![left, top, right, bottom].every(Number.isSafeInteger)) fail("INVALID_REQUEST");
  const result = { x: left, y: top, width: right - left, height: bottom - top };
  if (result.width < SCREEN_RECORDING_MIN_REGION_DIP || result.height < SCREEN_RECORDING_MIN_REGION_DIP) {
    fail("REGION_TOO_SMALL");
  }
  return result;
}

function cropFor(binding, region) {
  if (binding.rotationDeg !== 0) fail("DISPLAY_ROTATION_UNSUPPORTED");
  const localLeft = (region.x - binding.boundsDip.x) * binding.scaleFactor;
  const localTop = (region.y - binding.boundsDip.y) * binding.scaleFactor;
  const localRight = (region.x + region.width - binding.boundsDip.x) * binding.scaleFactor;
  const localBottom = (region.y + region.height - binding.boundsDip.y) * binding.scaleFactor;
  const left = Math.floor(localLeft);
  const top = Math.floor(localTop);
  const right = Math.ceil(localRight);
  const bottom = Math.ceil(localBottom);
  if (left < 0 || top < 0 || right > binding.frameSizePx.width || bottom > binding.frameSizePx.height
      || right <= left || bottom <= top) {
    fail("PIXEL_MAPPING_OUT_OF_BOUNDS");
  }
  return { x: left, y: top, width: right - left, height: bottom - top };
}

export function createDisplayCaptureArea(input) {
  exactRecord(input, ["display", "sourceRevision"]);
  return frozen({
    schemaVersion: SCREEN_RECORDING_EDIT_SCHEMA_VERSION,
    kind: "full_display",
    sourceRevision: sourceRevision(input.sourceRevision),
    display: normalizeDisplayBinding(input.display),
  });
}

export function createWindowCaptureArea(input) {
  exactRecord(input, ["sourceRevision"]);
  return frozen({
    schemaVersion: SCREEN_RECORDING_EDIT_SCHEMA_VERSION,
    kind: "window",
    sourceRevision: sourceRevision(input.sourceRevision),
  });
}

export function createRegionCaptureArea(input) {
  exactRecord(input, ["topologyRevision", "sourceRevision", "displays", "dragStartDip", "dragEndDip"]);
  const topologyRevision = sha256(input.topologyRevision);
  if (!Array.isArray(input.displays) || input.displays.length < 1 || input.displays.length > 32) fail("INVALID_REQUEST");
  const displays = input.displays.map((display) => normalizeDisplayBinding(display, topologyRevision));
  if (new Set(displays.map((display) => display.displayId)).size !== displays.length) {
    fail("DISPLAY_TOPOLOGY_AMBIGUOUS");
  }
  const region = normalizedDragRect(pointDip(input.dragStartDip), pointDip(input.dragEndDip));
  const containingDisplays = displays.filter((display) => containsRect(display.boundsDip, region));
  if (containingDisplays.length === 0) fail("CROSS_DISPLAY_REGION");
  if (containingDisplays.length !== 1) fail("DISPLAY_TOPOLOGY_AMBIGUOUS");
  const display = containingDisplays[0];
  return frozen({
    schemaVersion: SCREEN_RECORDING_EDIT_SCHEMA_VERSION,
    kind: "region",
    sourceRevision: sourceRevision(input.sourceRevision),
    display,
    rectDip: region,
    cropPx: cropFor(display, region),
  });
}

function captureArea(value) {
  if (!isRecord(value) || value.schemaVersion !== SCREEN_RECORDING_EDIT_SCHEMA_VERSION) fail("INVALID_REQUEST");
  if (value.kind === "window") {
    exactRecord(value, ["schemaVersion", "kind", "sourceRevision"]);
    return createWindowCaptureArea({ sourceRevision: value.sourceRevision });
  }
  if (value.kind === "full_display") {
    exactRecord(value, ["schemaVersion", "kind", "sourceRevision", "display"]);
    return createDisplayCaptureArea({ sourceRevision: value.sourceRevision, display: value.display });
  }
  if (value.kind === "region") {
    exactRecord(value, ["schemaVersion", "kind", "sourceRevision", "display", "rectDip", "cropPx"]);
    const display = normalizeDisplayBinding(value.display);
    const region = rectDip(value.rectDip);
    const crop = sizePx({ width: value.cropPx?.width, height: value.cropPx?.height });
    exactRecord(value.cropPx, ["x", "y", "width", "height"]);
    const normalizedCrop = {
      x: safeInteger(value.cropPx.x, 0, 131_071),
      y: safeInteger(value.cropPx.y, 0, 131_071),
      ...crop,
    };
    const expectedCrop = cropFor(display, region);
    if (!containsRect(display.boundsDip, region)
      || Object.keys(expectedCrop).some((key) => expectedCrop[key] !== normalizedCrop[key])) {
      fail("PIXEL_MAPPING_OUT_OF_BOUNDS");
    }
    return frozen({
      schemaVersion: SCREEN_RECORDING_EDIT_SCHEMA_VERSION,
      kind: "region",
      sourceRevision: sourceRevision(value.sourceRevision),
      display,
      rectDip: region,
      cropPx: normalizedCrop,
    });
  }
  fail("INVALID_REQUEST");
}

function areaRequest(value) {
  if (!isRecord(value)) fail("INVALID_REQUEST");
  if (value.kind === "window") {
    exactRecord(value, ["kind", "sourceToken", "sourceRevision"]);
    return frozen({
      kind: "window",
      sourceToken: uuid(value.sourceToken),
      sourceRevision: sourceRevision(value.sourceRevision),
    });
  }
  if (value.kind === "full_display") {
    exactRecord(value, ["kind", "sourceToken", "sourceRevision", "topologyRevision"]);
    return frozen({
      kind: "full_display",
      sourceToken: uuid(value.sourceToken),
      sourceRevision: sourceRevision(value.sourceRevision),
      topologyRevision: sha256(value.topologyRevision),
    });
  }
  if (value.kind === "region") {
    exactRecord(value, ["kind", "sourceToken", "sourceRevision", "topologyRevision", "rectDip"]);
    const region = rectDip(value.rectDip);
    if (region.width < SCREEN_RECORDING_MIN_REGION_DIP || region.height < SCREEN_RECORDING_MIN_REGION_DIP) {
      fail("REGION_TOO_SMALL");
    }
    return frozen({
      kind: "region",
      sourceToken: uuid(value.sourceToken),
      sourceRevision: sourceRevision(value.sourceRevision),
      topologyRevision: sha256(value.topologyRevision),
      rectDip: region,
    });
  }
  fail("INVALID_REQUEST");
}

export function parseScreenRecordingStartRequest(value) {
  exactRecord(value, ["area", "audioMode", "includePointer"]);
  if (!["off", "microphone", "system"].includes(value.audioMode) || typeof value.includePointer !== "boolean") {
    fail("INVALID_REQUEST");
  }
  return frozen({
    area: areaRequest(value.area),
    audioMode: value.audioMode,
    includePointer: value.includePointer,
  });
}

function sameRect(left, right) {
  return left.x === right.x && left.y === right.y
    && left.width === right.width && left.height === right.height;
}

export function createScreenRecordingStartPlan(requestValue, currentPreflightValue) {
  const request = parseScreenRecordingStartRequest(requestValue);
  const currentPreflight = exactRecord(currentPreflightValue, [
    "sourceBinding",
    "area",
    "capabilities",
    "exclusionProof",
  ]);
  const sourceBinding = createGrantedSourceRevisionBinding(currentPreflight.sourceBinding);
  const area = captureArea(currentPreflight.area);
  const expectedSourceKind = request.area.kind === "window" ? "window" : "screen";
  if (sourceBinding.sourceToken !== request.area.sourceToken
    || sourceBinding.sourceKind !== expectedSourceKind
    || sourceBinding.sourceRevision !== request.area.sourceRevision
    || area.kind !== request.area.kind
    || area.sourceRevision !== sourceBinding.sourceRevision) {
    fail("SOURCE_BINDING_MISMATCH");
  }
  if (request.area.kind === "window") {
    if (sourceBinding.topologyRevision !== null) fail("SOURCE_BINDING_MISMATCH");
  } else {
    if (sourceBinding.topologyRevision !== request.area.topologyRevision
      || area.display.topologyRevision !== request.area.topologyRevision) {
      fail("DISPLAY_TOPOLOGY_MISMATCH");
    }
    if (request.area.kind === "region" && !sameRect(area.rectDip, request.area.rectDip)) {
      fail("SOURCE_BINDING_MISMATCH");
    }
  }
  const capabilities = exactRecord(currentPreflight.capabilities, [
    "microphone",
    "systemAudio",
    "regionCrop",
    "ownWindowExclusion",
    "pointerCapture",
  ]);
  if (Object.values(capabilities).some((value) => typeof value !== "boolean")) fail("INVALID_REQUEST");
  if ((request.audioMode === "microphone" && !capabilities.microphone)
    || (request.audioMode === "system" && !capabilities.systemAudio)
    || (request.includePointer && !capabilities.pointerCapture)
    || (request.area.kind === "region" && !capabilities.regionCrop)) {
    fail("CAPABILITY_UNAVAILABLE");
  }
  const exclusionProof = exactRecord(currentPreflight.exclusionProof, [
    "selectionOverlay",
    "controlDock",
    "sourceRevision",
    "topologyRevision",
  ]);
  const proofTopologyRevision = exclusionProof.topologyRevision === null
    ? null
    : sha256(exclusionProof.topologyRevision);
  if (exclusionProof.selectionOverlay !== "hidden"
    || exclusionProof.controlDock !== "excluded"
    || exclusionProof.sourceRevision !== sourceBinding.sourceRevision
    || proofTopologyRevision !== sourceBinding.topologyRevision
    || !capabilities.ownWindowExclusion) {
    fail("CAPTURE_SURFACE_NOT_EXCLUDED");
  }
  return frozen({
    schemaVersion: SCREEN_RECORDING_EDIT_SCHEMA_VERSION,
    kind: "screen_recording_start",
    area,
    sourceBinding,
    settings: { audioMode: request.audioMode, includePointer: request.includePointer },
    exclusionProof: {
      selectionOverlay: "hidden",
      controlDock: "excluded",
      sourceRevision: sourceBinding.sourceRevision,
      topologyRevision: sourceBinding.topologyRevision,
    },
  });
}

function videoSource(value) {
  exactRecord(value, ["artifactId", "artifactVersion", "contentHash", "durationMs", "widthPx", "heightPx"]);
  return {
    artifactId: uuid(value.artifactId),
    artifactVersion: safeInteger(value.artifactVersion, 1, SCREEN_RECORDING_MAX_ARTIFACT_VERSION),
    contentHash: sha256(value.contentHash),
    durationMs: safeInteger(value.durationMs, 1, SCREEN_RECORDING_MAX_DURATION_MS),
    widthPx: safeInteger(value.widthPx, 1, 16_384),
    heightPx: safeInteger(value.heightPx, 1, 16_384),
  };
}

function sameVideoSource(left, right) {
  return left.artifactId === right.artifactId
    && left.artifactVersion === right.artifactVersion
    && left.contentHash === right.contentHash
    && left.durationMs === right.durationMs
    && left.widthPx === right.widthPx
    && left.heightPx === right.heightPx;
}

export function createTrimPlan(input) {
  exactRecord(input, ["source", "startMs", "endMs"]);
  const source = videoSource(input.source);
  const startMs = safeInteger(input.startMs, 0, source.durationMs);
  const endMs = safeInteger(input.endMs, 0, source.durationMs);
  if (endMs <= startMs) fail("INVALID_TRIM_RANGE");
  return frozen({
    schemaVersion: SCREEN_RECORDING_EDIT_SCHEMA_VERSION,
    kind: "non_destructive_trim",
    source,
    startMs,
    endMs,
  });
}

export function resetTrimPlan(source) {
  const normalizedSource = videoSource(source);
  return createTrimPlan({ source: normalizedSource, startMs: 0, endMs: normalizedSource.durationMs });
}

export function createMainOwnedCurrentVideoSource(value) {
  const normalized = videoSource(value);
  Object.defineProperty(normalized, MAIN_OWNED_CURRENT_VIDEO_SOURCE, {
    value: true,
    enumerable: false,
    writable: false,
    configurable: false,
  });
  return frozen(normalized);
}

export function assertTrimPlanCurrent(plan, currentSource) {
  exactRecord(plan, ["schemaVersion", "kind", "source", "startMs", "endMs"]);
  if (plan.schemaVersion !== SCREEN_RECORDING_EDIT_SCHEMA_VERSION || plan.kind !== "non_destructive_trim") {
    fail("INVALID_REQUEST");
  }
  if (!isRecord(currentSource) || currentSource[MAIN_OWNED_CURRENT_VIDEO_SOURCE] !== true) {
    fail("INVALID_REQUEST");
  }
  const normalizedPlan = createTrimPlan({ source: plan.source, startMs: plan.startMs, endMs: plan.endMs });
  const normalizedCurrent = videoSource(currentSource);
  if (!sameVideoSource(normalizedPlan.source, normalizedCurrent)) fail("SOURCE_REVISION_MISMATCH");
  return normalizedPlan;
}

export function parseTrimExportRequest(value) {
  exactRecord(value, ["operationId", "destinationArtifactId", "trimPlan"]);
  exactRecord(value.trimPlan, ["schemaVersion", "kind", "source", "startMs", "endMs"]);
  if (value.trimPlan.schemaVersion !== SCREEN_RECORDING_EDIT_SCHEMA_VERSION
    || value.trimPlan.kind !== "non_destructive_trim") {
    fail("INVALID_REQUEST");
  }
  return frozen({
    operationId: uuid(value.operationId),
    destinationArtifactId: uuid(value.destinationArtifactId),
    trimPlan: createTrimPlan({
      source: value.trimPlan.source,
      startMs: value.trimPlan.startMs,
      endMs: value.trimPlan.endMs,
    }),
  });
}

export function createTrimExportPlan(requestValue, currentSource) {
  const input = parseTrimExportRequest(requestValue);
  const operationId = uuid(input.operationId);
  const destinationArtifactId = uuid(input.destinationArtifactId);
  const trimPlan = assertTrimPlanCurrent(input.trimPlan, currentSource);
  if (destinationArtifactId === trimPlan.source.artifactId) fail("SOURCE_OVERWRITE_FORBIDDEN");
  if (trimPlan.startMs === 0 && trimPlan.endMs === trimPlan.source.durationMs) fail("NO_TRIM_APPLIED");
  return frozen({
    schemaVersion: SCREEN_RECORDING_EDIT_SCHEMA_VERSION,
    kind: "trim_export",
    operationId,
    source: trimPlan.source,
    trim: { startMs: trimPlan.startMs, endMs: trimPlan.endMs },
    destination: {
      artifactId: destinationArtifactId,
      storageMode: "managed",
      mediaKind: "video",
      relation: "derived_from",
    },
  });
}
