import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { build } from "esbuild";

const compiled = await build({
  stdin: {
    contents: 'export { TaskenCoreHost } from "./src/main/infrastructure/http/taskenCoreHost.ts";',
    resolveDir: process.cwd(),
  },
  bundle: true,
  platform: "node",
  format: "esm",
  write: false,
  logLevel: "silent",
});
const { TaskenCoreHost } = await import(
  `data:text/javascript;base64,${Buffer.from(compiled.outputFiles[0].text).toString("base64")}`,
);

async function withHost(t, run) {
  const temporaryBase = await fs.realpath(os.tmpdir());
  const userDataPath = await fs.mkdtemp(path.join(temporaryBase, "tasuken-core-discovery-test-"));
  const discoveryPath = path.join(userDataPath, "tasken-core.json");
  const host = new TaskenCoreHost({
    userDataPath,
    listAgentReadyTasks: { execute: () => ({ tasks: [] }) },
  });
  try {
    await run({ host, userDataPath, discoveryPath });
  } finally {
    t.mock.restoreAll();
    await host.stop();
    assert.equal(path.dirname(path.resolve(userDataPath)), temporaryBase);
    assert.ok(path.basename(userDataPath).startsWith("tasuken-core-discovery-test-"));
    await fs.rm(userDataPath, { recursive: true, force: true });
  }
}

async function assertNoDiscoveryTemporary(userDataPath) {
  const entries = await fs.readdir(userDataPath);
  assert.deepEqual(
    entries.filter((entry) => entry.startsWith("tasken-core.json.") && entry.endsWith(".tmp")),
    [],
  );
}

test("Tasken Core discovery retries only transient Windows EPERM renames", async (t) => {
  await t.test("starts and publishes discovery without a rename failure", async (t) => {
    await withHost(t, async ({ host, discoveryPath, userDataPath }) => {
      const result = await host.start();

      assert.equal(result.discoveryPath, discoveryPath);
      assert.equal(JSON.parse(await fs.readFile(discoveryPath, "utf8")).pid, process.pid);
      await assertNoDiscoveryTemporary(userDataPath);
    });
  });

  await t.test("recovers after one Windows EPERM and publishes discovery", async (t) => {
    await withHost(t, async ({ host, discoveryPath, userDataPath }) => {
      t.mock.property(process, "platform", "win32");
      let attempts = 0;
      const rename = fs.rename;
      t.mock.method(fs, "rename", async (...args) => {
        if (args[1] === discoveryPath) {
          attempts += 1;
          if (attempts === 1) {
            throw Object.assign(new Error("temporary discovery rename lock"), { code: "EPERM" });
          }
        }
        return rename(...args);
      });

      const result = await host.start();

      assert.equal(attempts, 2);
      assert.equal(result.discoveryPath, discoveryPath);
      assert.equal(JSON.parse(await fs.readFile(discoveryPath, "utf8")).pid, process.pid);
      await assertNoDiscoveryTemporary(userDataPath);
    });
  });

  await t.test("keeps the previous discovery, cleans the temporary file, and closes HTTP after persistent Windows EPERM", async (t) => {
    await withHost(t, async ({ host, discoveryPath, userDataPath }) => {
      t.mock.property(process, "platform", "win32");
      const previous = JSON.stringify({ origin: "http://127.0.0.1:1", pid: "previous" });
      await fs.writeFile(discoveryPath, previous, "utf8");
      const error = Object.assign(new Error("persistent discovery rename lock"), { code: "EPERM" });
      let attempts = 0;
      let stagedOrigin = "";
      const rename = fs.rename;
      t.mock.method(fs, "rename", async (...args) => {
        if (args[1] === discoveryPath) {
          attempts += 1;
          assert.equal(await fs.readFile(discoveryPath, "utf8"), previous);
          stagedOrigin = JSON.parse(await fs.readFile(args[0], "utf8")).origin;
          throw error;
        }
        return rename(...args);
      });

      await assert.rejects(host.start(), (actual) => actual === error);

      assert.equal(attempts, 3);
      assert.equal(await fs.readFile(discoveryPath, "utf8"), previous);
      await assertNoDiscoveryTemporary(userDataPath);
      await assert.rejects(fetch(`${stagedOrigin}/health`));
    });
  });

  await t.test("fails immediately for a non-EPERM rename error", async (t) => {
    await withHost(t, async ({ host, discoveryPath }) => {
      const error = Object.assign(new Error("non-retryable discovery rename failure"), { code: "EACCES" });
      let attempts = 0;
      const rename = fs.rename;
      t.mock.method(fs, "rename", async (...args) => {
        if (args[1] === discoveryPath) {
          attempts += 1;
          throw error;
        }
        return rename(...args);
      });

      await assert.rejects(host.start(), (actual) => actual === error);

      assert.equal(attempts, 1);
    });
  });

  await t.test("fails immediately for EPERM outside Windows", async (t) => {
    await withHost(t, async ({ host, discoveryPath }) => {
      t.mock.property(process, "platform", "linux");
      const error = Object.assign(new Error("non-Windows discovery rename failure"), { code: "EPERM" });
      let attempts = 0;
      const rename = fs.rename;
      t.mock.method(fs, "rename", async (...args) => {
        if (args[1] === discoveryPath) {
          attempts += 1;
          throw error;
        }
        return rename(...args);
      });

      await assert.rejects(host.start(), (actual) => actual === error);

      assert.equal(attempts, 1);
    });
  });
});
