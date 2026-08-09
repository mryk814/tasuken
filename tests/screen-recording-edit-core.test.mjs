import assert from "node:assert/strict";
import test from "node:test";

import {
  ScreenRecordingEditError,
  assertTrimPlanCurrent,
  createDisplayCaptureArea,
  createGrantedSourceRevisionBinding,
  createMainOwnedCurrentVideoSource,
  createRegionCaptureArea,
  createScreenRecordingStartPlan,
  createTrimExportPlan,
  createTrimPlan,
  createWindowCaptureArea,
  parseScreenRecordingStartRequest,
  parseTrimExportRequest,
  resetTrimPlan,
} from "../src/shared/screenRecordingEdit.mjs";

const TOPOLOGY = `sha256:${"a".repeat(64)}`;
const SOURCE_REVISION = `sha256:${"b".repeat(64)}`;
const CONTENT_HASH = `sha256:${"c".repeat(64)}`;
const SOURCE_ID = "00000000-0000-4000-8000-000000000001";
const DESTINATION_ID = "00000000-0000-4000-8000-000000000002";
const OPERATION_ID = "00000000-0000-4000-8000-000000000003";
const SOURCE_TOKEN = "00000000-0000-4000-8000-000000000004";
const LIST_SNAPSHOT = `sha256:${"f".repeat(64)}`;

function display(overrides = {}) {
  return {
    displayId: "display-primary",
    topologyRevision: TOPOLOGY,
    boundsDip: { x: 0, y: 0, width: 1536, height: 864 },
    scaleFactor: 1.25,
    frameSizePx: { width: 1920, height: 1080 },
    rotationDeg: 0,
    ...overrides,
  };
}

function source(overrides = {}) {
  return {
    artifactId: SOURCE_ID,
    artifactVersion: 4,
    contentHash: CONTENT_HASH,
    durationMs: 120_000,
    widthPx: 1920,
    heightPx: 1080,
    ...overrides,
  };
}

function grantedSource(overrides = {}) {
  return {
    sourceToken: SOURCE_TOKEN,
    sourceKind: "window",
    sourceRevision: SOURCE_REVISION,
    listSnapshotRevision: LIST_SNAPSHOT,
    topologyRevision: null,
    ...overrides,
  };
}

function startPreflight(area, overrides = {}) {
  const screen = area.kind !== "window";
  return {
    sourceBinding: grantedSource({
      sourceKind: screen ? "screen" : "window",
      topologyRevision: screen ? TOPOLOGY : null,
    }),
    area,
    capabilities: {
      microphone: true,
      systemAudio: true,
      regionCrop: true,
      ownWindowExclusion: true,
      pointerCapture: true,
    },
    exclusionProof: {
      selectionOverlay: "hidden",
      controlDock: "excluded",
      sourceRevision: SOURCE_REVISION,
      topologyRevision: screen ? TOPOLOGY : null,
    },
    ...overrides,
  };
}

function expectCode(code, callback) {
  assert.throws(callback, (error) => error instanceof ScreenRecordingEditError
    && error.code === code
    && !error.message.includes("display-primary")
    && !error.message.includes(SOURCE_ID));
}

test("full display, window, and region remain distinct capture meanings", () => {
  const full = createDisplayCaptureArea({ display: display(), sourceRevision: SOURCE_REVISION });
  const window = createWindowCaptureArea({ sourceRevision: SOURCE_REVISION });
  const region = createRegionCaptureArea({
    topologyRevision: TOPOLOGY,
    sourceRevision: SOURCE_REVISION,
    displays: [display()],
    dragStartDip: { x: 100, y: 80 },
    dragEndDip: { x: 500, y: 280 },
  });
  assert.equal(full.kind, "full_display");
  assert.equal(window.kind, "window");
  assert.equal(region.kind, "region");
  assert.equal("display" in window, false);
  assert.deepEqual(region.rectDip, { x: 100, y: 80, width: 400, height: 200 });
});

test("reverse drags normalize and DIP crops round outward at 125% and 150%", () => {
  const cases = [
    {
      name: "125 percent",
      display: display(),
      start: { x: 201, y: 101 },
      end: { x: 100, y: 20 },
      rect: { x: 100, y: 20, width: 101, height: 81 },
      crop: { x: 125, y: 25, width: 127, height: 102 },
    },
    {
      name: "150 percent on negative monitor",
      display: display({
        displayId: "display-left",
        boundsDip: { x: -1280, y: -100, width: 1280, height: 720 },
        scaleFactor: 1.5,
        frameSizePx: { width: 1920, height: 1080 },
      }),
      start: { x: -1000, y: 10 },
      end: { x: -901, y: 111 },
      rect: { x: -1000, y: 10, width: 99, height: 101 },
      crop: { x: 420, y: 165, width: 149, height: 152 },
    },
  ];
  for (const entry of cases) {
    const area = createRegionCaptureArea({
      topologyRevision: TOPOLOGY,
      sourceRevision: SOURCE_REVISION,
      displays: [entry.display],
      dragStartDip: entry.start,
      dragEndDip: entry.end,
    });
    assert.deepEqual(area.rectDip, entry.rect, entry.name);
    assert.deepEqual(area.cropPx, entry.crop, entry.name);
  }
});

test("64x64 DIP is accepted and either shorter edge fails", () => {
  assert.deepEqual(createRegionCaptureArea({
    topologyRevision: TOPOLOGY,
    sourceRevision: SOURCE_REVISION,
    displays: [display()],
    dragStartDip: { x: 0, y: 0 },
    dragEndDip: { x: 64, y: 64 },
  }).rectDip, { x: 0, y: 0, width: 64, height: 64 });
  for (const end of [{ x: 63, y: 64 }, { x: 64, y: 63 }]) {
    expectCode("REGION_TOO_SMALL", () => createRegionCaptureArea({
      topologyRevision: TOPOLOGY,
      sourceRevision: SOURCE_REVISION,
      displays: [display()],
      dragStartDip: { x: 0, y: 0 },
      dragEndDip: end,
    }));
  }
});

test("cross-display, overlapping display, stale topology, rotation, and bad pixel mapping fail closed", () => {
  const left = display({ displayId: "left", boundsDip: { x: -1536, y: 0, width: 1536, height: 864 } });
  const right = display({ displayId: "right" });
  const base = {
    topologyRevision: TOPOLOGY,
    sourceRevision: SOURCE_REVISION,
    dragStartDip: { x: -100, y: 100 },
    dragEndDip: { x: 100, y: 300 },
  };
  expectCode("CROSS_DISPLAY_REGION", () => createRegionCaptureArea({ ...base, displays: [left, right] }));
  expectCode("DISPLAY_TOPOLOGY_AMBIGUOUS", () => createRegionCaptureArea({
    ...base,
    dragStartDip: { x: 100, y: 100 },
    dragEndDip: { x: 300, y: 300 },
    displays: [right, display({ displayId: "overlap", boundsDip: { x: 50, y: 50, width: 1536, height: 864 } })],
  }));
  expectCode("DISPLAY_TOPOLOGY_MISMATCH", () => createRegionCaptureArea({
    ...base,
    displays: [display({ topologyRevision: `sha256:${"d".repeat(64)}` })],
  }));
  expectCode("DISPLAY_ROTATION_UNSUPPORTED", () => createRegionCaptureArea({
    ...base,
    dragStartDip: { x: 100, y: 100 },
    dragEndDip: { x: 300, y: 300 },
    displays: [display({ rotationDeg: 90 })],
  }));
  expectCode("DISPLAY_TOPOLOGY_MISMATCH", () => createRegionCaptureArea({
    ...base,
    displays: [display({ frameSizePx: { width: 1600, height: 900 } })],
  }));
});

test("region at the exact display edge never rounds beyond the source frame", () => {
  const area = createRegionCaptureArea({
    topologyRevision: TOPOLOGY,
    sourceRevision: SOURCE_REVISION,
    displays: [display()],
    dragStartDip: { x: 1472, y: 800 },
    dragEndDip: { x: 1536, y: 864 },
  });
  assert.deepEqual(area.cropPx, { x: 1840, y: 1000, width: 80, height: 80 });
});

test("Main adapter binds the current one-shot source token to its list and topology revisions", () => {
  const windowBinding = createGrantedSourceRevisionBinding(grantedSource());
  const screenBinding = createGrantedSourceRevisionBinding(grantedSource({
    sourceKind: "screen",
    topologyRevision: TOPOLOGY,
  }));
  assert.deepEqual(windowBinding, grantedSource());
  assert.equal(screenBinding.sourceToken, SOURCE_TOKEN);
  assert.equal(screenBinding.listSnapshotRevision, LIST_SNAPSHOT);
  assert.equal(screenBinding.topologyRevision, TOPOLOGY);
  expectCode("INVALID_REQUEST", () => createGrantedSourceRevisionBinding(grantedSource({
    sourceKind: "screen",
    topologyRevision: null,
  })));
  expectCode("INVALID_REQUEST", () => createGrantedSourceRevisionBinding({
    ...grantedSource(),
    internalSourceId: "screen:0:0",
  }));
});

test("Renderer start request stays exact and Main-owned current preflight supplies authority", () => {
  const area = createWindowCaptureArea({ sourceRevision: SOURCE_REVISION });
  const request = {
    area: { kind: "window", sourceToken: SOURCE_TOKEN, sourceRevision: SOURCE_REVISION },
    audioMode: "system",
    includePointer: true,
  };
  const current = startPreflight(area);
  const plan = createScreenRecordingStartPlan(request, current);
  assert.equal(plan.settings.audioMode, "system");
  assert.equal(plan.sourceBinding.listSnapshotRevision, LIST_SNAPSHOT);
  for (const authority of [
    { capabilities: current.capabilities },
    { exclusionProof: current.exclusionProof },
    { currentSource: current.sourceBinding },
  ]) {
    expectCode("INVALID_REQUEST", () => parseScreenRecordingStartRequest({ ...request, ...authority }));
  }
  expectCode("INVALID_REQUEST", () => parseScreenRecordingStartRequest({
    ...request,
    area: { ...request.area, internalSourceId: "window:1:0" },
  }));
  expectCode("SOURCE_BINDING_MISMATCH", () => createScreenRecordingStartPlan({
    ...request,
    area: { ...request.area, sourceRevision: `sha256:${"d".repeat(64)}` },
  }, current));
  expectCode("SOURCE_BINDING_MISMATCH", () => createScreenRecordingStartPlan({
    ...request,
    area: { ...request.area, sourceToken: DESTINATION_ID },
  }, current));
});

test("current capabilities and exclusion proof gate audio, pointer, crop, and Tasken surfaces", () => {
  const area = createWindowCaptureArea({ sourceRevision: SOURCE_REVISION });
  const request = {
    area: { kind: "window", sourceToken: SOURCE_TOKEN, sourceRevision: SOURCE_REVISION },
    audioMode: "system",
    includePointer: true,
  };
  const current = startPreflight(area);
  for (const capability of ["systemAudio", "pointerCapture"]) {
    expectCode("CAPABILITY_UNAVAILABLE", () => createScreenRecordingStartPlan(request, {
      ...current,
      capabilities: { ...current.capabilities, [capability]: false },
    }));
  }
  expectCode("CAPTURE_SURFACE_NOT_EXCLUDED", () => createScreenRecordingStartPlan(request, {
    ...current,
    exclusionProof: { ...current.exclusionProof, selectionOverlay: "visible" },
  }));
  expectCode("CAPTURE_SURFACE_NOT_EXCLUDED", () => createScreenRecordingStartPlan(request, {
    ...current,
    exclusionProof: { ...current.exclusionProof, sourceRevision: `sha256:${"d".repeat(64)}` },
  }));
  expectCode("INVALID_REQUEST", () => createScreenRecordingStartPlan({ ...request, audioMode: "both" }, current));
});

test("region start binds Renderer DIP and topology claims to the current Main crop", () => {
  const area = createRegionCaptureArea({
    topologyRevision: TOPOLOGY,
    sourceRevision: SOURCE_REVISION,
    displays: [display()],
    dragStartDip: { x: 100, y: 100 },
    dragEndDip: { x: 300, y: 300 },
  });
  const request = {
    area: {
      kind: "region",
      sourceToken: SOURCE_TOKEN,
      sourceRevision: SOURCE_REVISION,
      topologyRevision: TOPOLOGY,
      rectDip: area.rectDip,
    },
    audioMode: "off",
    includePointer: false,
  };
  assert.deepEqual(createScreenRecordingStartPlan(request, startPreflight(area)).area.cropPx, area.cropPx);
  expectCode("DISPLAY_TOPOLOGY_MISMATCH", () => createScreenRecordingStartPlan({
    ...request,
    area: { ...request.area, topologyRevision: `sha256:${"d".repeat(64)}` },
  }, startPreflight(area)));
  expectCode("SOURCE_BINDING_MISMATCH", () => createScreenRecordingStartPlan({
    ...request,
    area: { ...request.area, rectDip: { ...request.area.rectDip, x: 101 } },
  }, startPreflight(area)));
});

test("trim plan is immutable, bounded to the source, and reset restores the full duration", () => {
  const trim = createTrimPlan({ source: source(), startMs: 1_001, endMs: 119_999 });
  assert.deepEqual({ startMs: trim.startMs, endMs: trim.endMs }, { startMs: 1_001, endMs: 119_999 });
  assert.equal(Object.isFrozen(trim), true);
  assert.equal(Object.isFrozen(trim.source), true);
  assert.deepEqual(resetTrimPlan(source()), createTrimPlan({ source: source(), startMs: 0, endMs: 120_000 }));
  for (const [startMs, endMs] of [[-1, 5], [0, 120_001], [5, 5], [6, 5], [0.5, 5]]) {
    expectCode(startMs < 0 || endMs > 120_000 || !Number.isSafeInteger(startMs)
      ? "INVALID_REQUEST"
      : "INVALID_TRIM_RANGE", () => createTrimPlan({ source: source(), startMs, endMs }));
  }
});

test("trim revision binding rejects every stale source field", () => {
  const trim = createTrimPlan({ source: source(), startMs: 1_000, endMs: 100_000 });
  const changes = [
    { artifactId: DESTINATION_ID },
    { artifactVersion: 5 },
    { contentHash: `sha256:${"e".repeat(64)}` },
    { durationMs: 120_001 },
    { widthPx: 1280 },
    { heightPx: 720 },
  ];
  const current = createMainOwnedCurrentVideoSource(source());
  assert.deepEqual(assertTrimPlanCurrent(trim, current), trim);
  expectCode("INVALID_REQUEST", () => assertTrimPlanCurrent(trim, source()));
  for (const change of changes) {
    expectCode("SOURCE_REVISION_MISMATCH", () => assertTrimPlanCurrent(
      trim,
      createMainOwnedCurrentVideoSource(source(change)),
    ));
  }
});

test("trim export request excludes current source and Main supplies a branded current revision", () => {
  const trimPlan = createTrimPlan({ source: source(), startMs: 1_000, endMs: 100_000 });
  const request = {
    operationId: OPERATION_ID,
    destinationArtifactId: DESTINATION_ID,
    trimPlan,
  };
  const current = createMainOwnedCurrentVideoSource(source());
  const plan = createTrimExportPlan(request, current);
  assert.deepEqual(plan.destination, {
    artifactId: DESTINATION_ID,
    storageMode: "managed",
    mediaKind: "video",
    relation: "derived_from",
  });
  assert.equal("path" in plan, false);
  assert.equal(Object.isFrozen(plan.destination), true);
  assert.deepEqual(Object.keys(current).sort(), Object.keys(source()).sort());
  expectCode("INVALID_REQUEST", () => parseTrimExportRequest({ ...request, currentSource: source() }));
  expectCode("INVALID_REQUEST", () => createTrimExportPlan(request, source()));
  expectCode("SOURCE_OVERWRITE_FORBIDDEN", () => createTrimExportPlan({
    operationId: OPERATION_ID,
    destinationArtifactId: SOURCE_ID,
    trimPlan,
  }, current));
  expectCode("NO_TRIM_APPLIED", () => createTrimExportPlan({
    operationId: OPERATION_ID,
    destinationArtifactId: DESTINATION_ID,
    trimPlan: resetTrimPlan(source()),
  }, current));
});

test("bounded metadata and exact envelopes reject hostile expansion", () => {
  expectCode("INVALID_REQUEST", () => createDisplayCaptureArea({
    display: display({ displayId: "x".repeat(129) }),
    sourceRevision: SOURCE_REVISION,
  }));
  expectCode("INVALID_REQUEST", () => createTrimPlan({
    source: source({ durationMs: 8 * 24 * 60 * 60 * 1000 }),
    startMs: 0,
    endMs: 1,
  }));
  assert.equal(createTrimPlan({
    source: source({ artifactVersion: 1_000_000 }),
    startMs: 0,
    endMs: 1,
  }).source.artifactVersion, 1_000_000);
  expectCode("INVALID_REQUEST", () => createTrimPlan({
    source: source({ artifactVersion: 1_000_001 }),
    startMs: 0,
    endMs: 1,
  }));
  expectCode("INVALID_REQUEST", () => createTrimPlan({
    source: { ...source(), absolutePath: "C:\\private.webm" },
    startMs: 0,
    endMs: 1,
  }));
  expectCode("INVALID_REQUEST", () => createWindowCaptureArea({
    sourceRevision: SOURCE_REVISION,
    sourceId: "raw-os-source",
  }));
});
