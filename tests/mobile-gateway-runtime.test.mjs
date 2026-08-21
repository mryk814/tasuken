import assert from "node:assert/strict";
import { Buffer } from "node:buffer";
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { build } from "esbuild";

import { WorkspaceDatabase } from "../src/main/repositories/workspaceRepository.mjs";

const bundled = await build({
  stdin: {
    contents: `
      export { MobileDeviceRegistry } from "./src/main/gateway/mobile/mobileDeviceRegistry.ts";
      export { MobileGatewayHost } from "./src/main/gateway/mobile/mobileGatewayHost.ts";
    `,
    resolveDir: process.cwd(),
  },
  bundle: true,
  platform: "node",
  format: "esm",
  write: false,
  logLevel: "silent",
});

const { MobileDeviceRegistry, MobileGatewayHost } = await import(
  `data:text/javascript;base64,${Buffer.from(bundled.outputFiles[0].text).toString("base64")}`
);

const fixedNow = "2026-08-21T04:00:00.000Z";
const fixedToken = "a".repeat(43);

function state() {
  return {
    current: () => ({
      serverId: "workspace-mobile-test",
      serverRevision: 7,
      generatedAt: fixedNow,
    }),
  };
}

test("mobile pairing persists only a token hash and revocation survives restart", () => {
  const root = mkdtempSync(path.join(os.tmpdir(), "tasken-mobile-device-"));
  const databasePath = path.join(root, "workspace.sqlite");
  let database = new WorkspaceDatabase(databasePath);
  try {
    const registry = new MobileDeviceRegistry({
      persistence: database,
      now: () => new Date(fixedNow),
      createPairingCode: () => "12345678",
      createAccessToken: () => fixedToken,
    });
    const ticket = registry.issuePairing();
    assert.equal(ticket.code, "12345678");

    const paired = registry.pair({
      code: ticket.code,
      deviceId: "device-s23",
      deviceLabel: "Galaxy S23",
    });
    assert.equal(paired.accessToken, fixedToken);
    assert.deepEqual(paired.device.scopes, ["mobile:read", "mobile:task-write"]);
    assert.throws(
      () => registry.pair({
        code: ticket.code,
        deviceId: "device-second",
        deviceLabel: "Second",
      }),
      (error) => error?.code === "pairing_code_invalid",
    );

    const stored = database.db.prepare(
      "SELECT token_hash, scopes_json, revoked_at FROM mobile_devices WHERE id = ?",
    ).get("device-s23");
    assert.equal(stored.token_hash.length, 64);
    assert.equal(JSON.stringify(stored).includes(fixedToken), false);
    assert.deepEqual(JSON.parse(stored.scopes_json), ["mobile:read", "mobile:task-write"]);
    assert.equal(registry.authenticate(fixedToken)?.deviceId, "device-s23");

    database.db.close();
    database = new WorkspaceDatabase(databasePath);
    const restarted = new MobileDeviceRegistry({
      persistence: database,
      now: () => new Date(fixedNow),
    });
    assert.equal(restarted.authenticate(fixedToken)?.deviceId, "device-s23");
    assert.equal(restarted.revoke("device-s23")?.revokedAt, fixedNow);
    assert.equal(restarted.authenticate(fixedToken), null);
  } finally {
    database.db.close();
    rmSync(root, { recursive: true, force: true });
  }
});

test("mobile gateway binds loopback, pairs once, authenticates, and rejects browser or unsupported methods", async () => {
  const root = mkdtempSync(path.join(os.tmpdir(), "tasken-mobile-host-"));
  const database = new WorkspaceDatabase(path.join(root, "workspace.sqlite"));
  const registry = new MobileDeviceRegistry({
    persistence: database,
    now: () => new Date(fixedNow),
    createPairingCode: () => "87654321",
    createAccessToken: () => fixedToken,
  });
  const adapter = {
    async handle(request) {
      if (!request.principal) {
        return {
          status: 401,
          headers: { "content-type": "application/json; charset=utf-8" },
          body: { ok: false, error: { code: "unauthorized" } },
        };
      }
      return {
        status: 200,
        headers: { "content-type": "application/json; charset=utf-8" },
        body: { ok: true, deviceId: request.principal.deviceId },
      };
    },
  };
  const host = new MobileGatewayHost({
    adapter,
    devices: registry,
    state: state(),
    port: 0,
    now: () => new Date(fixedNow),
  });

  try {
    const ticket = registry.issuePairing();
    await host.start();
    const diagnostics = host.diagnostics();
    assert.equal(diagnostics.status, "ready");
    assert.match(diagnostics.localOrigin, /^http:\/\/127\.0\.0\.1:\d+$/);
    const origin = diagnostics.localOrigin;

    const pairResponse = await fetch(origin + "/v1/pair", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        apiVersion: 1,
        schemaVersion: 1,
        requestId: "11111111-1111-4111-8111-111111111111",
        pairingCode: ticket.code,
        clientDeviceId: "33333333-3333-4333-8333-333333333333",
        deviceLabel: "Galaxy S23 HTTP",
      }),
    });
    assert.equal(pairResponse.status, 200);
    const paired = await pairResponse.json();
    assert.equal(paired.data.accessToken, fixedToken);

    const health = await fetch(origin + "/v1/health", {
      headers: { authorization: "Bearer " + paired.data.accessToken },
    });
    assert.equal(health.status, 200);
    assert.deepEqual(await health.json(), { ok: true, deviceId: "33333333-3333-4333-8333-333333333333" });

    const withoutToken = await fetch(origin + "/v1/health");
    assert.equal(withoutToken.status, 401);

    const browser = await fetch(origin + "/v1/health", {
      headers: {
        authorization: "Bearer " + paired.data.accessToken,
        origin: "https://example.test",
      },
    });
    assert.equal(browser.status, 403);

    const unsupported = await fetch(origin + "/v1/health", {
      method: "PUT",
      headers: { authorization: "Bearer " + paired.data.accessToken },
    });
    assert.equal(unsupported.status, 405);

    const secondPair = await fetch(origin + "/v1/pair", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        apiVersion: 1,
        schemaVersion: 1,
        requestId: "22222222-2222-4222-8222-222222222222",
        pairingCode: ticket.code,
        clientDeviceId: "44444444-4444-4444-8444-444444444444",
        deviceLabel: "Replay",
      }),
    });
    assert.equal(secondPair.status, 401);
    assert.equal((await secondPair.json()).error.code, "pairing_code_invalid");

    assert.equal(JSON.stringify(host.diagnostics()).includes(fixedToken), false);
  } finally {
    await host.stop();
    database.db.close();
    rmSync(root, { recursive: true, force: true });
  }
});

