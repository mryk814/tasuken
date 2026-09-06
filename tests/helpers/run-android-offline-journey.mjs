import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import path from "node:path";
import { createMobileOfflineGateway } from "./mobile-offline-gateway.mjs";

// Usage: rtk node scripts/run-electron-node.mjs tests/helpers/run-android-offline-journey.mjs emulator-5556 TestClass[#method] ...
const [serial, ...requestedTests] = process.argv.slice(2);
const tests = requestedTests.filter((name) => !name.startsWith("--cleanup="));
const cleanupTest = requestedTests
  .find((name) => name.startsWith("--cleanup="))
  ?.slice("--cleanup=".length);
assert.match(
  serial || "",
  /^emulator-\d+$/,
  "Specify the emulator owned by this test run; physical devices are excluded.",
);
assert.ok(tests.length > 0, "Specify at least one instrumentation class or method.");
for (const name of [...tests, ...(cleanupTest ? [cleanupTest] : [])])
  assert.match(name, /^[A-Za-z][\w.]*(#[A-Za-z]\w*)?$/);

let activeChild;
const interrupted = new AbortController();
const onInterrupt = () => {
  interrupted.abort();
  activeChild?.kill();
};
process.once("SIGINT", onInterrupt);
process.once("SIGTERM", onInterrupt);

async function adb(args, { cleanup = false } = {}) {
  if (!cleanup) interrupted.signal.throwIfAborted();
  return await new Promise((resolve, reject) => {
    const child = spawn("rtk", ["adb", "-s", serial, ...args], {
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
    });
    activeChild = child;
    let output = "";
    child.stdout.on("data", (chunk) => {
      output += chunk;
    });
    child.stderr.on("data", (chunk) => {
      output += chunk;
    });
    child.on("error", reject);
    child.on("close", (code) => {
      if (activeChild === child) activeChild = null;
      if (code !== 0) reject(new Error(`adb failed (${code}): ${output}`));
      else resolve(output);
    });
  });
}

const fixture = await createMobileOfflineGateway();
let reverseAdded = false;
let apksInstalled = false;
const args = {
  gatewayOrigin: fixture.config.origin,
  gatewayToken: fixture.config.accessToken,
  gatewayServerId: fixture.config.serverId,
  gatewayDeviceId: fixture.config.deviceId,
  gatewayControlToken: fixture.config.controlToken,
};
async function instrument(name, cleanup = false) {
  const className = name.startsWith("jp.") ? name : `jp.personal.tasken.companion.${name}`;
  const result = await adb(
    [
      "shell",
      "am",
      "instrument",
      "-w",
      "-e",
      "class",
      className,
      ...Object.entries(args).flatMap(([key, value]) => ["-e", key, value]),
      "jp.personal.tasken.companion.debug.test/androidx.test.runner.AndroidJUnitRunner",
    ],
    { cleanup },
  );
  process.stdout.write(result);
  assert.match(result, /OK \(\d+ tests?\)/, "Instrumentation did not report success.");
  assert.doesNotMatch(result, /FAILURES!!!|INSTRUMENTATION_ABORTED|Process crashed/);
}
try {
  assert.equal((await adb(["shell", "getprop", "ro.kernel.qemu"])).trim(), "1");
  const port = String(fixture.config.port);
  const existing = await adb(["reverse", "--list"]);
  assert.ok(!existing.includes(`tcp:${port}`), "Refusing to replace an existing reverse mapping.");
  await adb(["reverse", `tcp:${port}`, `tcp:${port}`]);
  reverseAdded = true;
  for (const apk of ["debug/app-debug.apk", "androidTest/debug/app-debug-androidTest.apk"]) {
    const result = await adb([
      "install",
      "-r",
      path.resolve("android-app/app/build/outputs/apk", apk),
    ]);
    assert.match(result, /Success/);
  }
  apksInstalled = true;
  for (const name of tests) {
    await instrument(name);
  }
  const snapshot = fixture.snapshot();
  console.log(
    JSON.stringify({
      tasks: snapshot.tasks.length,
      captures: snapshot.captures.length,
      events: snapshot.events.length,
      lostReceipts: snapshot.lostReceipts,
    }),
  );
} finally {
  try {
    try {
      if (apksInstalled && cleanupTest) await instrument(cleanupTest, true);
    } finally {
      if (reverseAdded)
        await adb(["reverse", "--remove", `tcp:${fixture.config.port}`], { cleanup: true });
    }
  } finally {
    await fixture.close();
    process.removeListener("SIGINT", onInterrupt);
    process.removeListener("SIGTERM", onInterrupt);
  }
}
