import assert from "node:assert/strict";
import test from "node:test";
import { createMobileOfflineGateway } from "./helpers/mobile-offline-gateway.mjs";

function client(fixture) {
  const { origin, accessToken, deviceId } = fixture.config;
  const headers = { authorization: `Bearer ${accessToken}`, "content-type": "application/json" };
  const envelope = (command, id) => ({
    apiVersion: 1,
    schemaVersion: 7,
    requestId: id,
    commandId: id,
    idempotencyKey: id,
    clientDeviceId: deviceId,
    issuedAt: "2026-09-06T15:10:00+09:00",
    command,
  });
  return {
    envelope,
    async send(value) {
      const response = await fetch(`${origin}/v1/commands`, {
        method: "POST",
        headers,
        body: JSON.stringify(value),
      });
      return { status: response.status, body: await response.json() };
    },
    async get(id) {
      const response = await fetch(`${origin}/v1/work-logs?id=${encodeURIComponent(id)}`, {
        headers,
      });
      return { status: response.status, body: await response.json() };
    },
    async health() {
      return await (await fetch(`${origin}/v1/health`, { headers })).json();
    },
  };
}

test("Mobile RecordWorkLog keeps full text and day precision across lost response, restart, Desktop edit and duplicate", async () => {
  const fixture = await createMobileOfflineGateway();
  try {
    const api = client(fixture);
    const body = " 原文🧪\n途中まで実施。解釈は未確認。 ".repeat(250);
    const envelope = api.envelope(
      { name: "RecordWorkLog", body, performedDate: "2026-09-01", themeId: null, taskId: null },
      "mobile-work-log",
    );
    const health = await api.health();
    assert.ok(health.data.capabilities.includes("mobile.work-log.write"));
    assert.ok(health.data.capabilities.includes("mobile.work-log.read"));
    await fixture.control({ dropNextReceipt: true });
    await assert.rejects(api.send(envelope), { name: "TypeError" });
    assert.equal(fixture.snapshot().workLogs.length, 1);
    assert.equal(fixture.snapshot().workLogs[0].body_markdown, body);
    assert.equal(
      fixture.snapshot().workLogs[0].properties_json.work_log.actor.id,
      fixture.config.deviceId,
    );
    await fixture.control({ restartDesktop: true });
    const retried = await api.send(envelope);
    assert.equal(retried.status, 200, JSON.stringify(retried.body));
    assert.equal(retried.body.data.status, "no_change");
    assert.equal(retried.body.data.workLog.body, body);
    assert.equal(retried.body.data.workLog.performedDate, "2026-09-01");
    assert.equal(retried.body.data.workLog.enteredAt, envelope.issuedAt);
    assert.equal((await api.get("mobile-work-log")).body.data.workLog.body, body);
    await fixture.control({
      editWorkLog: { id: "mobile-work-log", body: "Desktopで追記した原文" },
    });
    const afterEdit = await api.send(envelope);
    assert.equal(afterEdit.status, 200);
    assert.equal(afterEdit.body.data.workLog.body, "Desktopで追記した原文");
    assert.equal(
      fixture.snapshot().events.filter((entry) => entry.command_id === envelope.commandId).length,
      1,
    );
    const changed = await api.send({
      ...envelope,
      command: { ...envelope.command, body: "ID再利用" },
    });
    assert.equal(changed.status, 409);
    assert.equal(changed.body.error.code, "idempotency_conflict");
  } finally {
    await fixture.close();
  }
});

test("Mobile WorkLog delete and Undo are versioned and old retries cannot repeat a later lifecycle transition", async () => {
  const fixture = await createMobileOfflineGateway();
  try {
    const api = client(fixture);
    const created = await api.send(
      api.envelope(
        { name: "RecordWorkLog", body: "削除と復元の原文", performedDate: "2026-09-01" },
        "lifecycle-note",
      ),
    );
    assert.equal(created.status, 200, JSON.stringify(created.body));
    const wrongVersion = await api.send(
      api.envelope(
        { name: "DeleteWorkLog", noteId: "lifecycle-note", expectedVersion: 99 },
        "stale-delete",
      ),
    );
    assert.equal(wrongVersion.body.error.code, "entity_conflict");
    const deletion = api.envelope(
      { name: "DeleteWorkLog", noteId: "lifecycle-note", expectedVersion: 1 },
      "delete-note",
    );
    await fixture.control({ dropNextReceipt: true });
    await assert.rejects(
      api.send(deletion).then((result) => {
        throw new Error(JSON.stringify(result));
      }),
      { name: "TypeError" },
    );
    await fixture.control({ restartDesktop: true });
    const deleted = await api.send(deletion);
    assert.equal(deleted.status, 200, JSON.stringify(deleted.body));
    assert.equal(deleted.body.data.workLog.deleted, true);
    assert.equal(deleted.body.data.workLog.body, "削除と復元の原文");
    const restoration = api.envelope(
      {
        name: "RestoreWorkLog",
        noteId: "lifecycle-note",
        expectedVersion: deleted.body.data.workLog.version,
      },
      "restore-note",
    );
    const restored = await api.send(restoration);
    assert.equal(restored.status, 200, JSON.stringify(restored.body));
    assert.equal(restored.body.data.workLog.deleted, false);
    const delayedDelete = await api.send(deletion);
    assert.equal(delayedDelete.body.data.status, "no_change");
    assert.equal(delayedDelete.body.data.workLog.deleted, false);
    assert.equal(delayedDelete.body.data.workLog.version, restored.body.data.workLog.version);
    assert.equal(
      (await api.send(restoration)).body.data.workLog.version,
      restored.body.data.workLog.version,
    );
    assert.equal((await api.get("lifecycle-note")).body.data.workLog.deleted, false);
    assert.equal((await api.get("unknown")).body.data.workLog, null);
  } finally {
    await fixture.close();
  }
});

test("Mobile WorkLog uses a dedicated write scope, validates actor identity, and retains input when a Task disappears", async () => {
  const denied = await createMobileOfflineGateway({
    scopes: ["mobile:read", "mobile:task-write", "mobile:capture-write"],
  });
  const fixture = await createMobileOfflineGateway();
  try {
    const deniedApi = client(denied);
    const deniedResult = await deniedApi.send(
      deniedApi.envelope(
        { name: "RecordWorkLog", body: "権限なし", performedDate: "2026-09-01" },
        "denied-record",
      ),
    );
    assert.equal(deniedResult.status, 403);
    assert.equal(denied.snapshot().workLogs.length, 0);
    assert.ok(!(await deniedApi.health()).data.capabilities.includes("mobile.work-log.write"));
    const api = client(fixture);
    const base = api.envelope(
      {
        name: "RecordWorkLog",
        body: "Taskが消えても原文は端末に残る",
        performedDate: "2026-09-01",
        taskId: "missing-task",
      },
      "missing-target-note",
    );
    const missing = await api.send(base);
    assert.equal(missing.status, 404, JSON.stringify(missing.body));
    assert.equal(fixture.snapshot().workLogs.length, 0);
    const forged = await api.send({ ...base, clientDeviceId: "other-device" });
    assert.equal(forged.status, 400);
    const saved = await api.send({ ...base, command: { ...base.command, taskId: null } });
    assert.equal(saved.status, 200);
    assert.equal(saved.body.data.workLog.body, base.command.body);
    const malformed = await api.send({
      ...base,
      commandId: "invalid-date",
      idempotencyKey: "invalid-date",
      issuedAt: "2026-02-30T00:00:00Z",
      command: { ...base.command, taskId: null },
    });
    assert.equal(malformed.status, 400);
  } finally {
    await denied.close();
    await fixture.close();
  }
});
