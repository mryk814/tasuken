import assert from "node:assert/strict";
import test from "node:test";
import { createMobileOfflineGateway } from "./helpers/mobile-offline-gateway.mjs";

test("isolated Gateway retains one canonical Capture after a lost receipt and Desktop restart", async () => {
  const fixture = await createMobileOfflineGateway();
  try {
    const { origin, accessToken, deviceId } = fixture.config;
    const text = " 原文🧪\nhttps://example.test/".repeat(30);
    const envelope = {
      apiVersion: 1,
      schemaVersion: 7,
      requestId: "fixture-request",
      commandId: "fixture-command",
      idempotencyKey: "fixture-command",
      clientDeviceId: deviceId,
      issuedAt: "2026-09-06T00:00:00Z",
      command: {
        name: "CreateCapture",
        capture: {
          id: "fixture-capture",
          text,
          projectId: null,
          capturedAt: "2026-09-06T00:00:00Z",
        },
        provenance: {
          reportedVia: "android_app",
          capturedAt: "2026-09-06T00:00:00Z",
          captureMethod: null,
          recognitionMode: null,
          language: null,
          confidence: null,
          sourceAudioAvailable: null,
          sharedMimeType: null,
        },
      },
    };
    const send = () =>
      fetch(`${origin}/v1/commands`, {
        method: "POST",
        headers: { authorization: `Bearer ${accessToken}`, "content-type": "application/json" },
        body: JSON.stringify(envelope),
      });
    await fixture.control({ offline: true });
    await assert.rejects(send());
    assert.equal(fixture.snapshot().captures.length, 0);
    await fixture.control({ offline: false, dropNextReceipt: true });
    await assert.rejects(
      send().then(async (response) => {
        assert.fail(`Receipt was not dropped: ${JSON.stringify(await response.json())}`);
      }),
      { name: "TypeError" },
    );
    assert.equal(fixture.snapshot().captures.length, 1);
    const eventCount = fixture.snapshot().events.length;
    await fixture.control({ restartDesktop: true });
    const response = await send();
    assert.equal(response.status, 200, JSON.stringify(await response.clone().json()));
    assert.equal(fixture.snapshot().events.length, eventCount);
    assert.equal(fixture.snapshot().captures[0].text, text);
    assert.equal(fixture.snapshot().lostReceipts, 1);
    assert.deepEqual(fixture.snapshot().seenCommands, [envelope, envelope]);
  } finally {
    await fixture.close();
  }
});

test("fixture Desktop edit produces a version conflict through the real command route", async () => {
  const fixture = await createMobileOfflineGateway();
  try {
    const { origin, accessToken, deviceId } = fixture.config;
    const send = async (command, id) => {
      const response = await fetch(`${origin}/v1/commands`, {
        method: "POST",
        headers: { authorization: `Bearer ${accessToken}`, "content-type": "application/json" },
        body: JSON.stringify({
          apiVersion: 1,
          schemaVersion: 7,
          requestId: id,
          commandId: id,
          idempotencyKey: id,
          clientDeviceId: deviceId,
          issuedAt: "2026-09-06T00:00:00Z",
          command,
        }),
      });
      return { status: response.status, body: await response.json() };
    };
    const created = await send(
      {
        name: "CreateTask",
        task: {
          id: "fixture-task",
          title: "original",
          projectId: "theme-personal-default",
          state: "todo",
          priority: "normal",
          requester: "self",
          intendedExecutor: "self",
          todayDate: "2026-09-06",
        },
      },
      "fixture-create",
    );
    assert.equal(created.status, 200, JSON.stringify(created.body));
    await fixture.control({ editTask: { id: "fixture-task", changes: { title: "Desktop edit" } } });
    const result = await send(
      {
        name: "UpdateTask",
        taskId: "fixture-task",
        expectedVersion: 1,
        expectedScheduleVersion: null,
        base: { title: "original" },
        changes: { title: "Android edit" },
      },
      "fixture-update",
    );
    assert.equal(result.status, 409, JSON.stringify(result.body));
    assert.equal(fixture.snapshot().tasks[0].title, "Desktop edit");
  } finally {
    await fixture.close();
  }
});
