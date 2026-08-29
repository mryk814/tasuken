import assert from "node:assert/strict";
import { Buffer } from "node:buffer";
import test from "node:test";

import { build } from "esbuild";

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
const replacementToken = "b".repeat(43);

class MemoryMobileDevicePersistence {
  records = new Map();

  copy(record) {
    return record ? { ...record, scopes: [...record.scopes] } : null;
  }

  pairMobileDevice(input) {
    const current = this.records.get(input.id);
    if (current && !current.revokedAt) throw new Error("duplicate mobile device");
    const record = current
      ? {
          ...current,
          label: input.label,
          tokenHash: input.tokenHash,
          scopes: [...input.scopes],
          updatedAt: input.pairedAt,
          lastSeenAt: "",
          revokedAt: "",
          version: current.version + 1,
        }
      : {
          id: input.id,
          label: input.label,
          tokenHash: input.tokenHash,
          scopes: [...input.scopes],
          createdAt: input.pairedAt,
          updatedAt: input.pairedAt,
          lastSeenAt: "",
          revokedAt: "",
          version: 1,
        };
    this.records.set(record.id, record);
    return this.copy(record);
  }

  findMobileDeviceByTokenHash(tokenHash) {
    return this.copy([...this.records.values()].find((record) => record.tokenHash === tokenHash));
  }

  listMobileDevices() {
    return [...this.records.values()].map((record) => this.copy(record));
  }

  revokeMobileDevice(id, revokedAt) {
    const current = this.records.get(id);
    if (!current) return null;
    const record = { ...current, revokedAt, updatedAt: revokedAt, version: current.version + 1 };
    this.records.set(id, record);
    return this.copy(record);
  }

  touchMobileDevice(id, lastSeenAt) {
    const current = this.records.get(id);
    if (!current) return;
    this.records.set(id, {
      ...current,
      lastSeenAt,
      updatedAt: lastSeenAt,
      version: current.version + 1,
    });
  }
}

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
  const persistence = new MemoryMobileDevicePersistence();
  try {
    const registry = new MobileDeviceRegistry({
      persistence,
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
    assert.deepEqual(paired.device.scopes, [
      "mobile:read",
      "mobile:task-write",
      "mobile:capture-write",
      "mobile:proposal-review",
      "mobile:human-review",
    ]);
    assert.throws(
      () =>
        registry.pair({
          code: ticket.code,
          deviceId: "device-second",
          deviceLabel: "Second",
        }),
      (error) => error?.code === "pairing_code_invalid",
    );

    const stored = persistence.records.get("device-s23");
    assert.equal(stored.tokenHash.length, 64);
    assert.equal(JSON.stringify(stored).includes(fixedToken), false);
    assert.deepEqual(stored.scopes, [
      "mobile:read",
      "mobile:task-write",
      "mobile:capture-write",
      "mobile:proposal-review",
      "mobile:human-review",
    ]);
    assert.equal(registry.authenticate(fixedToken)?.deviceId, "device-s23");

    stored.scopes = ["mobile:read", "mobile:task-write"];

    const restarted = new MobileDeviceRegistry({
      persistence,
      now: () => new Date(fixedNow),
    });
    assert.deepEqual(restarted.authenticate(fixedToken), {
      kind: "mobile_device",
      deviceId: "device-s23",
      scopes: [
        "mobile:read",
        "mobile:task-write",
        "mobile:capture-write",
        "mobile:proposal-review",
        "mobile:human-review",
      ],
    });
    assert.equal(restarted.revoke("device-s23")?.revokedAt, fixedNow);
    assert.equal(restarted.authenticate(fixedToken), null);
  } finally {
    persistence.records.clear();
  }
});

test("revoked mobile devices can pair again with the same stable Android id", () => {
  const persistence = new MemoryMobileDevicePersistence();
  try {
    const registry = new MobileDeviceRegistry({
      persistence,
      now: () => new Date(fixedNow),
      createPairingCode: () => "12345678",
      createAccessToken: () => fixedToken,
    });
    registry.pair({
      code: registry.issuePairing().code,
      deviceId: "device-s23",
      deviceLabel: "Galaxy S23",
    });
    registry.revoke("device-s23");

    const repairedAt = "2026-08-22T04:00:00.000Z";
    const repairedRegistry = new MobileDeviceRegistry({
      persistence,
      now: () => new Date(repairedAt),
      createPairingCode: () => "87654321",
      createAccessToken: () => replacementToken,
    });
    const repaired = repairedRegistry.pair({
      code: repairedRegistry.issuePairing().code,
      deviceId: "device-s23",
      deviceLabel: "Galaxy S23 re-paired",
    });

    assert.equal(repaired.accessToken, replacementToken);
    assert.equal(repaired.device.createdAt, fixedNow);
    assert.equal(repaired.device.updatedAt, repairedAt);
    assert.equal(repaired.device.revokedAt, "");
    assert.equal(repaired.device.label, "Galaxy S23 re-paired");
    assert.equal(repaired.device.version, 3);
    assert.equal(repairedRegistry.authenticate(fixedToken), null);
    assert.equal(repairedRegistry.authenticate(replacementToken)?.deviceId, "device-s23");
  } finally {
    persistence.records.clear();
  }
});

test("mobile gateway binds loopback, pairs once, authenticates, and rejects browser or unsupported methods", async () => {
  const persistence = new MemoryMobileDevicePersistence();
  let currentNow = fixedNow;
  const accessTokens = [fixedToken, replacementToken];
  const registry = new MobileDeviceRegistry({
    persistence,
    now: () => new Date(currentNow),
    createPairingCode: () => "87654321",
    createAccessToken: () => accessTokens.shift(),
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
    now: () => new Date(currentNow),
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
        schemaVersion: 5,
        requestId: "11111111-1111-4111-8111-111111111111",
        pairingCode: ticket.code,
        clientDeviceId: "33333333-3333-4333-8333-333333333333",
        deviceLabel: "Galaxy S23 HTTP",
      }),
    });
    assert.equal(pairResponse.status, 200);
    const paired = await pairResponse.json();
    assert.equal(paired.data.accessToken, fixedToken);
    assert.equal(paired.data.pairedAt, fixedNow);

    const health = await fetch(origin + "/v1/health", {
      headers: { authorization: "Bearer " + paired.data.accessToken },
    });
    assert.equal(health.status, 200);
    assert.deepEqual(await health.json(), {
      ok: true,
      deviceId: "33333333-3333-4333-8333-333333333333",
    });

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
        schemaVersion: 5,
        requestId: "22222222-2222-4222-8222-222222222222",
        pairingCode: ticket.code,
        clientDeviceId: "44444444-4444-4444-8444-444444444444",
        deviceLabel: "Replay",
      }),
    });
    assert.equal(secondPair.status, 401);
    assert.equal((await secondPair.json()).error.code, "pairing_code_invalid");

    registry.revoke("33333333-3333-4333-8333-333333333333");
    currentNow = "2026-08-22T04:00:00.000Z";
    const repairTicket = registry.issuePairing();
    const repairResponse = await fetch(origin + "/v1/pair", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        apiVersion: 1,
        schemaVersion: 5,
        requestId: "55555555-5555-4555-8555-555555555555",
        pairingCode: repairTicket.code,
        clientDeviceId: "33333333-3333-4333-8333-333333333333",
        deviceLabel: "Galaxy S23 HTTP re-paired",
      }),
    });
    assert.equal(repairResponse.status, 200);
    const repaired = await repairResponse.json();
    assert.equal(repaired.data.accessToken, replacementToken);
    assert.equal(repaired.data.pairedAt, currentNow);
    assert.equal(
      (
        await fetch(origin + "/v1/health", {
          headers: { authorization: "Bearer " + fixedToken },
        })
      ).status,
      401,
    );
    assert.equal(
      (
        await fetch(origin + "/v1/health", {
          headers: { authorization: "Bearer " + replacementToken },
        })
      ).status,
      200,
    );

    assert.equal(JSON.stringify(host.diagnostics()).includes(fixedToken), false);
    assert.equal(JSON.stringify(host.diagnostics()).includes(replacementToken), false);
  } finally {
    await host.stop();
    persistence.records.clear();
  }
});
