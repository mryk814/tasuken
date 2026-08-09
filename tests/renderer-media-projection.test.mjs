import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import { Buffer } from "node:buffer";

import { build } from "esbuild";

const result = await build({
  entryPoints: [path.resolve("src/main/rendererMediaProjection.ts")],
  bundle: true,
  platform: "node",
  format: "esm",
  write: false,
  logLevel: "silent",
});
const projection = await import(`data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString("base64")}`);

const privatePath = "C:/private/tasken/voice.wav";
const artifact = {
  id: "artifact-audio",
  media_kind: "audio",
  filename: "voice.wav",
  stored_path: privatePath,
  original_path: "C:/private/source.wav",
  target: "C:/private/linked.wav",
};
const receipt = {
  status: "applied",
  changes: [{ type: "capture_entry", entity: { id: "capture" } }, { type: "artifact", entity: artifact }],
};
const event = {
  id: "event",
  entity_type: "capture_entry",
  entity_id: "capture",
  before_json: null,
  after_json: JSON.stringify({ id: "capture", content_type: "audio" }),
  receipt_json: JSON.stringify(receipt),
};

function assertNoPrivateMediaPath(value) {
  const serialized = JSON.stringify(value);
  assert.doesNotMatch(serialized, /C:\/private/);
  assert.doesNotMatch(serialized, /stored_path|original_path|"target"/);
}

test("workspace projection removes media paths nested in capture-owned receipt JSON", () => {
  const projected = projection.projectWorkspaceForRenderer({ artifacts: [artifact], change_events: [event] });
  assertNoPrivateMediaPath(projected);
  assert.equal(projected.artifacts[0].filename, "voice.wav");
  assert.equal(JSON.parse(projected.change_events[0].receipt_json).changes[1].entity.filename, "voice.wav");
});

test("entity list/get and changed broadcast projection never serialize media paths", () => {
  assertNoPrivateMediaPath(projection.projectEntityForRenderer("artifact", artifact));
  assertNoPrivateMediaPath(projection.projectEntityForRenderer("change_event", event));
  assertNoPrivateMediaPath(projection.projectChangesForRenderer([
    { type: "artifact", entity: artifact },
    { type: "change_event", entity: event },
  ]));
});

test("command notification sender, other window, and satellite payloads are all path-safe", () => {
  const payloads = projection.commandNotificationPayloads(
    [{ type: "artifact", entity: artifact }],
    [{ type: "change_event", entity: event }],
  );
  assertNoPrivateMediaPath(payloads.sender);
  assertNoPrivateMediaPath(payloads.other);
  assertNoPrivateMediaPath(payloads.satellite);
  assert.equal(payloads.sender.entities.length, 1);
  assert.equal(payloads.other.entities.length, 2);
  assert.equal(payloads.satellite.entities.length, 2);
});

test("media commit can send safe Capture and Artifact changes back to the issuing Inbox", () => {
  const capture = { id: "capture", content_type: "audio", title: "voice" };
  const payloads = projection.commandNotificationPayloads(
    [{ type: "capture_entry", entity: capture }, { type: "artifact", entity: artifact }],
    [{ type: "change_event", entity: event }],
    true,
  );
  assert.equal(payloads.sender.entities.length, 3);
  assert.equal(payloads.sender.entities.some((change) => change.type === "capture_entry"), true);
  assert.equal(payloads.sender.entities.some((change) => change.type === "artifact"), true);
  assertNoPrivateMediaPath(payloads.sender);
});
