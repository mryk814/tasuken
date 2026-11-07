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
const projection = await import(
  `data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString("base64")}`
);

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
  changes: [
    { type: "capture_entry", entity: { id: "capture" } },
    { type: "artifact", entity: artifact },
  ],
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
  const projected = projection.projectWorkspaceForRenderer({
    artifacts: [artifact],
    change_events: [event],
  });
  assertNoPrivateMediaPath(projected);
  assert.equal(projected.artifacts[0].filename, "voice.wav");
  // receipt_jsonはMainだけが冪等性に使う。Rendererへは渡さない（IPCの量を半分にする）。
  assert.equal("receipt_json" in projected.change_events[0], false);
});

test("Activity EventのMain専用項目はRendererへ渡さず、Rendererからの保存では既存の値を戻す", () => {
  const stored = { ...event, command_fingerprint: '{"name":"capture.commit"}' };
  const projected = projection.projectEntityForRenderer("change_event", stored);
  assert.equal("receipt_json" in projected, false);
  assert.equal("command_fingerprint" in projected, false);
  assert.equal(stored.receipt_json, event.receipt_json);

  const restored = projection.restoreMainOnlyEventFields("change_event", projected, stored);
  assert.equal(restored.receipt_json, stored.receipt_json);
  assert.equal(restored.command_fingerprint, stored.command_fingerprint);
  // 新しいEvent、Event以外、Rendererが明示した値はそのまま。
  assert.equal(projection.restoreMainOnlyEventFields("change_event", projected, null), projected);
  assert.equal(
    projection.restoreMainOnlyEventFields("note", { id: "n" }, stored).receipt_json,
    undefined,
  );
  assert.equal(
    projection.restoreMainOnlyEventFields(
      "change_event",
      { ...projected, receipt_json: "x" },
      stored,
    ).receipt_json,
    "x",
  );
});

test("entity list/get and changed broadcast projection never serialize media paths", () => {
  assertNoPrivateMediaPath(projection.projectEntityForRenderer("artifact", artifact));
  assertNoPrivateMediaPath(projection.projectEntityForRenderer("change_event", event));
  assertNoPrivateMediaPath(
    projection.projectChangesForRenderer([
      { type: "artifact", entity: artifact },
      { type: "change_event", entity: event },
    ]),
  );
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
    [
      { type: "capture_entry", entity: capture },
      { type: "artifact", entity: artifact },
    ],
    [{ type: "change_event", entity: event }],
    true,
  );
  assert.equal(payloads.sender.entities.length, 3);
  assert.equal(
    payloads.sender.entities.some((change) => change.type === "capture_entry"),
    true,
  );
  assert.equal(
    payloads.sender.entities.some((change) => change.type === "artifact"),
    true,
  );
  assertNoPrivateMediaPath(payloads.sender);
});

test("single and batch command receipts retain safe deltas without media storage identity", () => {
  const projected = projection.projectCommandReceiptForRenderer({
    ...receipt,
    eventChanges: [{ type: "change_event", entity: event }],
  });
  assertNoPrivateMediaPath(projected);
  assert.equal(projected.changes[0].entity.id, "capture");
  assert.equal(projected.changes[1].entity.filename, "voice.wav");
  assert.equal("receipt_json" in projected.eventChanges[0].entity, false);
});

test("snapshot preview projects nested incoming/local media and apply workspace projection stays path-safe", () => {
  const preview = projection.projectSnapshotInspectForRenderer({
    status: "preview",
    changes: [
      {
        type: "artifact",
        classification: "updated",
        incoming: artifact,
        local: { ...artifact, stored_path: "C:/private/local.wav" },
      },
      { type: "change_event", classification: "updated", incoming: event, local: event },
    ],
  });
  assertNoPrivateMediaPath(preview);
  // 差分の画面は題名と状態だけを出す。本文やMain専用の項目は送らない（反映はMainの元データで行う）。
  assert.deepEqual(preview.changes[0].incoming, { id: "artifact-audio" });
  assert.deepEqual(preview.changes[0].local, { id: "artifact-audio" });
  assert.deepEqual(Object.keys(preview.changes[1].incoming), ["id"]);
  assert.equal(
    projection.projectSnapshotInspectForRenderer({
      changes: [{ type: "note", incoming: { id: "n", title: "題名", body_markdown: "本文" } }],
      unchangedCount: 3,
    }).unchangedCount,
    3,
  );
  assertNoPrivateMediaPath(
    projection.projectWorkspaceForRenderer({ artifacts: [artifact], change_events: [event] }),
  );
});

test("mediaを含まない前後の写しは解析せずにそのまま渡し、uエスケープで書いたキーも伏字にする", () => {
  const plain = '{ "id": "note", "title": "メモ" }';
  const projected = projection.projectEntityForRenderer("change_event", {
    ...event,
    before_json: plain,
    after_json: JSON.stringify(artifact).replace(
      '"media_kind"',
      `"media${String.fromCharCode(92)}u005fkind"`,
    ),
  });
  assert.equal(projected.before_json, plain);
  assertNoPrivateMediaPath(projected);
  assert.equal(JSON.parse(projected.after_json).filename, "voice.wav");
});
