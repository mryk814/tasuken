import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import test from "node:test";

import {
  monitorPackagedProcess,
  sanitizePackageSmokeDiagnostic,
  waitForPackagedReadiness,
} from "../scripts/mcp-package-smoke-readiness.mjs";

function fakeChild() {
  const child = new EventEmitter();
  child.exitCode = null;
  child.signalCode = null;
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  return child;
}

test("waitForPackagedReadiness accepts a delayed discovery probe before the explicit deadline", async () => {
  const child = fakeChild();
  const monitor = monitorPackagedProcess(child);
  let clock = 0;
  let attempts = 0;
  const result = await waitForPackagedReadiness({
    monitor,
    probe: async () => {
      attempts += 1;
      if (attempts < 5) throw new Error("discovery not created yet");
      return { ready: true };
    },
    timeoutMs: 100,
    pollMs: 10,
    now: () => clock,
    sleep: async (duration) => { clock += duration; },
  });

  assert.deepEqual(result, { ready: true });
  assert.equal(attempts, 5);
});

test("waitForPackagedReadiness fails immediately with bounded process diagnostics on early exit", async () => {
  const child = fakeChild();
  const monitor = monitorPackagedProcess(child, { redactions: ["C:\\private\\smoke-root", "secret-marker"] });
  child.stderr.emit("data", "failed under C:\\private\\smoke-root token=secret-marker\n");
  setImmediate(() => {
    child.exitCode = 9;
    child.emit("exit", 9, null);
  });

  await assert.rejects(
    waitForPackagedReadiness({
      monitor,
      probe: async () => { throw new Error("not ready"); },
      timeoutMs: 10_000,
      pollMs: 100,
    }),
    (error) => {
      assert.match(error.message, /exit code 9/);
      assert.match(error.message, /Packaged process diagnostic/);
      assert.match(error.message, /<redacted>/);
      assert.doesNotMatch(error.message, /secret-marker|private\\smoke-root/);
      return true;
    },
  );
});

test("waitForPackagedReadiness reports an explicit sanitized timeout", async () => {
  const child = fakeChild();
  const monitor = monitorPackagedProcess(child, { redactions: ["private-path"] });
  let clock = 0;

  await assert.rejects(
    waitForPackagedReadiness({
      monitor,
      probe: async () => { throw new Error("missing private-path/tasken-core.json"); },
      timeoutMs: 30,
      pollMs: 10,
      now: () => clock,
      sleep: async (duration) => { clock += duration; },
    }),
    (error) => {
      assert.match(error.message, /did not become ready within 30ms/);
      assert.match(error.message, /missing <redacted>\/tasken-core.json/);
      return true;
    },
  );
});

test("sanitizePackageSmokeDiagnostic removes bearer and base64url credentials", () => {
  const credential = "A".repeat(43);
  const output = sanitizePackageSmokeDiagnostic(`Authorization: Bearer ${credential}\ncore=${credential}`);
  assert.doesNotMatch(output, new RegExp(credential));
  assert.match(output, /Bearer <credential>/);
});

test("monitorPackagedProcess keeps only a bounded diagnostic tail", () => {
  const child = fakeChild();
  const monitor = monitorPackagedProcess(child, { maxDiagnosticChars: 64 });
  child.stdout.emit("data", "x".repeat(2_000));
  child.stderr.emit("data", "final-diagnostic");

  assert.ok(monitor.diagnostic().length <= 64);
  assert.match(monitor.diagnostic(), /final-diagnostic/);
});
