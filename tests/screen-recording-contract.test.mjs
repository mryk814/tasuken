import assert from "node:assert/strict";
import test from "node:test";

import {
  authorizeScreenRecordingGrant,
  buildScreenRecordingCapabilities,
  normalizeScreenRecordingSecurityOrigin,
  parseScreenRecordingArmRequest,
  sanitizeScreenRecordingSourceLabel,
  validateScreenRecordingSourceProjection,
} from "../src/shared/screenRecording.mjs";

const TOKEN = "00000000-0000-4000-8000-000000000001";
const THUMBNAIL = `data:image/png;base64,${Buffer.from("thumbnail").toString("base64")}`;

test("screen source projection exposes only bounded token, display label, type, thumbnail and expiry", () => {
  const projection = validateScreenRecordingSourceProjection({
    sourceToken: TOKEN,
    kind: "window",
    label: "Visual Studio Code",
    thumbnailDataUrl: THUMBNAIL,
    expiresAt: "2026-08-09T00:00:30.000Z",
  });
  assert.deepEqual(projection, {
    sourceToken: TOKEN,
    kind: "window",
    label: "Visual Studio Code",
    thumbnailDataUrl: THUMBNAIL,
    expiresAt: "2026-08-09T00:00:30.000Z",
  });
  assert.equal(JSON.stringify(projection).includes("display_id"), false);
  assert.equal(JSON.stringify(projection).includes("window:"), false);
  assert.throws(() => validateScreenRecordingSourceProjection({ ...projection, id: "window:1:0" }));
  assert.throws(() => validateScreenRecordingSourceProjection({ ...projection, thumbnailDataUrl: "file:///secret.png" }));
  assert.equal(sanitizeScreenRecordingSourceLabel("secret\nwindow", "window"), "secret window");
});

test("arm request is exact and rejects Electron source identifiers", () => {
  assert.deepEqual(parseScreenRecordingArmRequest({
    sourceToken: TOKEN,
    audioMode: "system",
    includePointer: true,
  }), {
    sourceToken: TOKEN,
    audioMode: "system",
    includePointer: true,
  });
  assert.throws(() => parseScreenRecordingArmRequest({
    sourceToken: TOKEN,
    audioMode: "system",
    includePointer: true,
    sourceId: "screen:0:0",
  }));
  assert.throws(() => parseScreenRecordingArmRequest({ sourceToken: TOKEN, audioMode: "both", includePointer: true }));
});

test("region arm keeps only bounded DIP and pixel crop metadata", () => {
  const region = {
    rectDip: { x: -1200, y: 80, width: 640, height: 360 },
    cropPx: { x: 100, y: 125, width: 800, height: 450 },
    frameSizePx: { width: 2400, height: 1350 },
  };
  assert.deepEqual(parseScreenRecordingArmRequest({
    sourceToken: TOKEN,
    audioMode: "off",
    includePointer: false,
    region,
  }).region, region);
  assert.throws(() => parseScreenRecordingArmRequest({
    sourceToken: TOKEN,
    audioMode: "off",
    includePointer: false,
    region: { ...region, rectDip: { ...region.rectDip, width: 63 } },
  }), /64/);
  assert.throws(() => parseScreenRecordingArmRequest({
    sourceToken: TOKEN,
    audioMode: "off",
    includePointer: false,
    region: { ...region, rawDisplayId: "screen:0:0" },
  }));
});

test("capabilities expose Windows loopback only and select an explicit supported recorder MIME", () => {
  assert.deepEqual(buildScreenRecordingCapabilities({
    platform: "win32",
    microphoneAvailable: true,
    systemAudioAvailable: true,
    supportedMimeTypes: ["video/webm;codecs=vp8,opus", "video/webm"],
  }), {
    screen: true,
    window: true,
    microphone: true,
    systemAudio: true,
    recorderMimeType: "video/webm;codecs=vp8,opus",
  });
  assert.equal(buildScreenRecordingCapabilities({
    platform: "darwin",
    microphoneAvailable: true,
    systemAudioAvailable: true,
    supportedMimeTypes: [],
  }).systemAudio, false);
  // MP4(H.264/AAC)を既定にした（#388）。持ち出しやすさを優先し、WebMはfallbackへ下げる。
  assert.equal(buildScreenRecordingCapabilities({
    platform: "win32",
    microphoneAvailable: true,
    systemAudioAvailable: true,
    supportedMimeTypes: ["video/mp4", "video/webm;codecs=vp9,opus"],
  }).recorderMimeType, "video/mp4");
  // 候補外の形式は選ばない。
  assert.equal(buildScreenRecordingCapabilities({
    platform: "linux",
    microphoneAvailable: false,
    systemAudioAvailable: false,
    supportedMimeTypes: ["video/x-matroska;codecs=avc1"],
  }).recorderMimeType, null);
});

function grantContext(overrides = {}) {
  return {
    sourceToken: TOKEN,
    senderWebContentsId: 7,
    frameTreeNodeId: 17,
    securityOrigin: "file://",
    expiresAtMs: 30_000,
    consumed: false,
    audioMode: "system",
    ...overrides,
  };
}

function grantRequest(overrides = {}) {
  return {
    senderWebContentsId: 7,
    frameTreeNodeId: 17,
    frameIsMain: true,
    frameDetached: false,
    securityOrigin: "file://",
    userGesture: true,
    videoRequested: true,
    audioRequested: true,
    ...overrides,
  };
}

test("display grant is one-shot, origin/sender/user-gesture bound and system audio maps to Windows loopback", () => {
  assert.deepEqual(authorizeScreenRecordingGrant(grantContext(), grantRequest(), 20_000), {
    sourceToken: TOKEN,
    displayAudio: "loopback",
    microphoneRequired: false,
  });
  assert.throws(() => authorizeScreenRecordingGrant(grantContext({ consumed: true }), grantRequest(), 20_000));
  assert.throws(() => authorizeScreenRecordingGrant(grantContext(), grantRequest(), 30_001));
  assert.throws(() => authorizeScreenRecordingGrant(grantContext(), grantRequest({ senderWebContentsId: 8 }), 20_000));
  assert.throws(() => authorizeScreenRecordingGrant(grantContext(), grantRequest({ frameTreeNodeId: 18 }), 20_000), /frame/);
  assert.throws(() => authorizeScreenRecordingGrant(grantContext(), grantRequest({ frameIsMain: false }), 20_000), /Main frame/);
  assert.throws(() => authorizeScreenRecordingGrant(grantContext(), grantRequest({ frameDetached: true }), 20_000), /Main frame/);
  assert.throws(() => authorizeScreenRecordingGrant(grantContext(), grantRequest({ securityOrigin: "https://evil.example" }), 20_000));
  assert.throws(() => authorizeScreenRecordingGrant(grantContext({ securityOrigin: "file://evil.example" }), grantRequest(), 20_000));
  assert.throws(() => authorizeScreenRecordingGrant(grantContext(), grantRequest({ userGesture: false }), 20_000));
  assert.throws(() => authorizeScreenRecordingGrant(grantContext(), grantRequest({ audioRequested: false }), 20_000));

  assert.deepEqual(authorizeScreenRecordingGrant(
    grantContext({ audioMode: "microphone" }),
    grantRequest({ audioRequested: false }),
    20_000,
  ), {
    sourceToken: TOKEN,
    displayAudio: null,
    microphoneRequired: true,
  });
});

test("security origin accepts packaged file and exact local development origins only", () => {
  assert.equal(normalizeScreenRecordingSecurityOrigin("file://"), "file://");
  assert.equal(normalizeScreenRecordingSecurityOrigin("http://localhost:5173"), "http://localhost:5173");
  assert.equal(normalizeScreenRecordingSecurityOrigin("https://127.0.0.1:5173"), "https://127.0.0.1:5173");
  for (const value of ["file://evil.example", "https://example.com", "http://localhost:5173/path", "http://user:pass@localhost:5173"]) {
    assert.throws(() => normalizeScreenRecordingSecurityOrigin(value), /origin/);
  }
});
