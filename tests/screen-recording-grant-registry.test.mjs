import assert from "node:assert/strict";
import test from "node:test";

import { ScreenRecordingGrantRegistry } from "../src/main/services/screenRecordingGrantRegistry.mjs";

const TOKENS = [
  "00000000-0000-4000-8000-000000000001",
  "00000000-0000-4000-8000-000000000002",
  "00000000-0000-4000-8000-000000000003",
];
const THUMBNAIL = `data:image/png;base64,${Buffer.from("thumbnail").toString("base64")}`;

function fixture({ platform = "win32", capabilities = { microphone: true, systemAudio: true } } = {}) {
  let now = 1_000;
  let tokenIndex = 0;
  return {
    setNow(value) { now = value; },
    registry: new ScreenRecordingGrantRegistry({
      idFactory: () => TOKENS[tokenIndex++],
      getCapabilities: () => capabilities,
      nowMs: () => now,
      platform,
    }),
  };
}

function sources() {
  return [{
    internalSourceId: "screen:123:0",
    kind: "screen",
    label: "Main screen",
    thumbnailDataUrl: THUMBNAIL,
  }, {
    internalSourceId: "window:456:0",
    kind: "window",
    label: "Tasken",
    thumbnailDataUrl: THUMBNAIL,
  }];
}

function context(overrides = {}) {
  return { senderWebContentsId: 7, frameTreeNodeId: 17, securityOrigin: "file://", isMainFrame: true, detached: false, ...overrides };
}

function displayRequest(overrides = {}) {
  return {
    senderWebContentsId: 7,
    frameTreeNodeId: 17,
    frameIsMain: true,
    frameDetached: false,
    securityOrigin: "file://",
    userGesture: true,
    videoRequested: true,
    audioRequested: false,
    ...overrides,
  };
}

test("source listing projects bounded tokens without Electron or OS source identifiers", () => {
  const { registry } = fixture();
  const projected = registry.issueSources(sources(), context());
  assert.deepEqual(projected.map(({ kind, label }) => ({ kind, label })), [
    { kind: "screen", label: "Main screen" },
    { kind: "window", label: "Tasken" },
  ]);
  const serialized = JSON.stringify(projected);
  assert.equal(serialized.includes("screen:123"), false);
  assert.equal(serialized.includes("window:456"), false);
  assert.equal(serialized.includes("internalSourceId"), false);
});

test("arm is sender, origin and expiry bound, and a source token is one-shot", () => {
  const { registry, setNow } = fixture();
  const [source] = registry.issueSources(sources(), context());
  assert.throws(() => registry.arm({ sourceToken: source.sourceToken, audioMode: "off", includePointer: true }, context({ senderWebContentsId: 8 })), /要求元/);
  assert.throws(() => registry.arm({ sourceToken: source.sourceToken, audioMode: "off", includePointer: true }, context({ frameTreeNodeId: 18 })), /要求元/);
  assert.throws(() => registry.arm({ sourceToken: source.sourceToken, audioMode: "off", includePointer: true }, context({ isMainFrame: false })), /Main frame/);
  assert.throws(() => registry.arm({ sourceToken: source.sourceToken, audioMode: "off", includePointer: true }, context({ securityOrigin: "http://localhost:5173" })), /要求元/);
  assert.equal(registry.arm({ sourceToken: source.sourceToken, audioMode: "off", includePointer: true }, context()).armed, true);
  assert.throws(() => registry.arm({ sourceToken: source.sourceToken, audioMode: "off", includePointer: true }, context()), /期限/);

  const [expiring] = registry.issueSources(sources().slice(0, 1), context());
  setNow(31_001);
  assert.throws(() => registry.arm({ sourceToken: expiring.sourceToken, audioMode: "off", includePointer: true }, context()), /期限/);
});

test("permission grant requires transient user gesture and is consumed even when validation fails", () => {
  const { registry } = fixture();
  const [source] = registry.issueSources(sources().slice(0, 1), context());
  registry.arm({ sourceToken: source.sourceToken, audioMode: "off", includePointer: false }, context());
  assert.throws(() => registry.consumeDisplayRequest(displayRequest({ userGesture: false })), /明示操作/);
  assert.throws(() => registry.consumeDisplayRequest(displayRequest()), /選択/);

  const [retry] = registry.issueSources(sources().slice(0, 1), context());
  registry.arm({ sourceToken: retry.sourceToken, audioMode: "off", includePointer: false }, context());
  assert.deepEqual(registry.consumeDisplayRequest(displayRequest()), {
    internalSourceId: "screen:123:0",
    kind: "screen",
    label: "Main screen",
    includePointer: false,
    displayAudio: null,
    microphoneRequired: false,
  });
  assert.throws(() => registry.consumeDisplayRequest(displayRequest()), /選択/);
});

test("system audio is Windows-only while microphone is captured separately from display audio", () => {
  const windows = fixture({ platform: "win32" }).registry;
  const [systemSource] = windows.issueSources(sources().slice(0, 1), context());
  windows.arm({ sourceToken: systemSource.sourceToken, audioMode: "system", includePointer: true }, context());
  assert.deepEqual(windows.consumeDisplayRequest(displayRequest({ audioRequested: true })), {
    internalSourceId: "screen:123:0",
    kind: "screen",
    label: "Main screen",
    includePointer: true,
    displayAudio: "loopback",
    microphoneRequired: false,
  });

  const linux = fixture({ platform: "linux" }).registry;
  const [unsupported] = linux.issueSources(sources().slice(0, 1), context());
  assert.throws(() => linux.arm({ sourceToken: unsupported.sourceToken, audioMode: "system", includePointer: true }, context()), /利用できません/);
  const [microphone] = linux.issueSources(sources().slice(0, 1), context());
  linux.arm({ sourceToken: microphone.sourceToken, audioMode: "microphone", includePointer: true }, context());
  assert.equal(linux.consumeDisplayRequest(displayRequest()).microphoneRequired, true);

  const unavailable = fixture({ platform: "win32", capabilities: { microphone: false, systemAudio: false } }).registry;
  const [noSystem] = unavailable.issueSources(sources().slice(0, 1), context());
  assert.throws(() => unavailable.arm({ sourceToken: noSystem.sourceToken, audioMode: "system", includePointer: true }, context()), /利用できません/);
  const [noMicrophone] = unavailable.issueSources(sources().slice(0, 1), context());
  assert.throws(() => unavailable.arm({ sourceToken: noMicrophone.sourceToken, audioMode: "microphone", includePointer: true }, context()), /マイク/);
});

test("destroying a sender clears both listed and armed grants", () => {
  const { registry } = fixture();
  const projected = registry.issueSources(sources(), context());
  registry.arm({ sourceToken: projected[0].sourceToken, audioMode: "off", includePointer: false }, context());
  registry.clearSender(7);
  assert.throws(() => registry.consumeDisplayRequest(displayRequest()), /選択/);
  assert.throws(() => registry.arm({ sourceToken: projected[1].sourceToken, audioMode: "off", includePointer: false }, context()), /期限/);
});

test("refreshing a sender invalidates its older tokens and duplicate token generation fails closed", () => {
  const { registry } = fixture();
  const [older] = registry.issueSources(sources().slice(0, 1), context());
  registry.issueSources(sources().slice(0, 1), context());
  assert.throws(() => registry.arm({ sourceToken: older.sourceToken, audioMode: "off", includePointer: false }, context()), /期限/);

  const duplicate = new ScreenRecordingGrantRegistry({
    idFactory: () => TOKENS[0],
    getCapabilities: () => ({ microphone: true, systemAudio: true }),
    nowMs: () => 1_000,
    platform: "win32",
  });
  assert.throws(() => duplicate.issueSources(sources(), context()), /重複/);
});

test("token ledger rejects a collision with another sender's armed grant", () => {
  const registry = new ScreenRecordingGrantRegistry({
    idFactory: () => TOKENS[0],
    getCapabilities: () => ({ microphone: true, systemAudio: true }),
    nowMs: () => 1_000,
    platform: "win32",
  });
  const firstContext = context();
  const [first] = registry.issueSources(sources().slice(0, 1), firstContext);
  registry.arm({ sourceToken: first.sourceToken, audioMode: "off", includePointer: false }, firstContext);
  assert.throws(() => registry.issueSources(sources().slice(0, 1), context({ senderWebContentsId: 8, frameTreeNodeId: 18 })), /重複/);
});

test("capability and frame drift after arm consume the grant without allowing capture", () => {
  const capabilities = { microphone: true, systemAudio: true };
  const { registry } = fixture({ capabilities });
  const [system] = registry.issueSources(sources().slice(0, 1), context());
  registry.arm({ sourceToken: system.sourceToken, audioMode: "system", includePointer: true }, context());
  capabilities.systemAudio = false;
  assert.throws(() => registry.consumeDisplayRequest(displayRequest({ audioRequested: true })), /利用できなくなりました/);
  assert.throws(() => registry.consumeDisplayRequest(displayRequest({ audioRequested: true })), /選択/);

  capabilities.systemAudio = true;
  const [frameBound] = registry.issueSources(sources().slice(0, 1), context());
  registry.arm({ sourceToken: frameBound.sourceToken, audioMode: "off", includePointer: true }, context());
  assert.throws(() => registry.consumeDisplayRequest(displayRequest({ frameDetached: true })), /Main frame/);
  assert.throws(() => registry.consumeDisplayRequest(displayRequest()), /選択/);
});

test("re-arming a sender releases the superseded token from the active ledger", () => {
  let index = 0;
  const generated = [TOKENS[0], TOKENS[1], TOKENS[0]];
  const registry = new ScreenRecordingGrantRegistry({
    idFactory: () => generated[index++],
    getCapabilities: () => ({ microphone: true, systemAudio: true }),
    nowMs: () => 1_000,
    platform: "win32",
  });
  const listed = registry.issueSources(sources(), context());
  registry.arm({ sourceToken: listed[0].sourceToken, audioMode: "off", includePointer: false }, context());
  registry.arm({ sourceToken: listed[1].sourceToken, audioMode: "off", includePointer: false }, context());
  registry.consumeDisplayRequest(displayRequest());
  assert.equal(registry.issueSources(sources().slice(0, 1), context({ senderWebContentsId: 8, frameTreeNodeId: 18 })).length, 1);
});
