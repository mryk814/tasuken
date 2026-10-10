import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { pathToFileURL } from "node:url";

const expectedSteps = [
  ["rebuild:electron", []],
  ["lint", []],
  ["typecheck", []],
  ["test:full", []],
  ["audit:consistency", ["--strict", "--format=json"]],
  ["audit:architecture", ["--enforce", "task", "--enforce", "core-mcp"]],
  ["audit:scripts", []],
  ["build", []],
  ["smoke:desktop:focused", []],
  ["smoke:proposal-live:focused", []],
];

// Execute the real runner in a child process, replacing only its subprocess port.
// No npm, Electron, database, or network command runs through this fixture.
function runCi({ platform = process.platform, npmCli = "", failAt = -1, failure = "status" } = {}) {
  const root = mkdtempSync(path.join(os.tmpdir(), "tasken-ci-runner-test-"));
  try {
    const tracePath = path.join(root, "trace.jsonl");
    const preloadPath = path.join(root, "stub-spawn.mjs");
    writeFileSync(tracePath, "");
    writeFileSync(
      preloadPath,
      `
      import { createRequire, syncBuiltinESMExports } from "node:module";
      import { appendFileSync } from "node:fs";
      Object.defineProperty(process, "platform", { value: ${JSON.stringify(platform)} });
      const childProcess = createRequire(import.meta.url)("node:child_process");
      let index = 0;
      childProcess.spawnSync = (command, args, options) => {
        appendFileSync(${JSON.stringify(tracePath)}, JSON.stringify({ command, args, options }) + "\\n");
        if (index++ !== ${failAt}) return { status: 0 };
        if (${JSON.stringify(failure)} === "error") return { error: new Error("fixture spawn failure") };
        return { status: ${failure === "signal" ? "null" : "17"} };
      };
      syncBuiltinESMExports();
    `,
    );
    const result = spawnSync(
      process.execPath,
      ["--import", pathToFileURL(preloadPath).href, "scripts/run-ci.mjs"],
      {
        encoding: "utf8",
        env: { ...process.env, npm_execpath: npmCli, ComSpec: "fixture-cmd.exe" },
        timeout: 15_000,
      },
    );
    assert.equal(result.error, undefined, result.error?.message);
    const trace = readFileSync(tracePath, "utf8").trim();
    return { ...result, calls: trace ? trace.split("\n").map((line) => JSON.parse(line)) : [] };
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

function expectedCalls(platform, npmCli, steps = expectedSteps) {
  return steps.map(([script, scriptArgs]) => ({
    command: npmCli ? process.execPath : platform === "win32" ? "fixture-cmd.exe" : "npm",
    args: npmCli
      ? [npmCli, "run", script, "--", ...scriptArgs]
      : platform === "win32"
        ? ["/d", "/s", "/c", "npm.cmd", "run", script, "--", ...scriptArgs]
        : ["run", script, "--", ...scriptArgs],
    options: { stdio: "inherit", shell: false },
  }));
}

for (const platform of ["linux", "win32"]) {
  for (const npmCli of ["", "fixture-npm-cli.cjs"]) {
    const label = `${platform}/${npmCli ? "npm CLI" : "PATH npm"}`;
    test(`CI runs the full suite once and preserves all remaining gates (${label})`, () => {
      const result = runCi({ platform, npmCli });
      assert.equal(result.status, 0, result.stderr);
      assert.deepEqual(result.calls, expectedCalls(platform, npmCli));
      assert.match(result.stdout, /CI quality gates passed\./);
    });

    test(`CI propagates each gate failure and stops before later gates (${label})`, () => {
      for (let failAt = 0; failAt < expectedSteps.length; failAt++) {
        const result = runCi({ platform, npmCli, failAt });
        assert.equal(result.status, 17, `${expectedSteps[failAt][0]}: ${result.stderr}`);
        assert.deepEqual(
          result.calls,
          expectedCalls(platform, npmCli, expectedSteps.slice(0, failAt + 1)),
        );
        assert.doesNotMatch(result.stdout, /CI quality gates passed\./);
      }
    });
  }
}

test("CI rejects a signalled subprocess and propagates spawn errors", () => {
  for (const failure of ["signal", "error"]) {
    const result = runCi({ failAt: 3, failure });
    assert.equal(result.status, 1, result.stderr);
    assert.equal(result.calls.length, 4);
    assert.doesNotMatch(result.stdout, /CI quality gates passed\./);
    if (failure === "error") assert.match(result.stderr, /fixture spawn failure/);
  }
});

test("full suite automatically covers both focused subsets with concurrency one", () => {
  const { scripts } = JSON.parse(readFileSync("package.json", "utf8"));
  assert.equal(
    scripts["test:full"],
    "node scripts/run-electron-node.mjs --test --test-concurrency=1 tests/*.test.mjs",
  );
  const fullFiles = new Set(
    readdirSync("tests")
      .filter((file) => file.endsWith(".test.mjs"))
      .map((file) => `tests/${file}`),
  );
  assert.ok(fullFiles.has("tests/ci-runner.test.mjs"), "the new test is automatically included");
  assert.ok(
    fullFiles.has("tests/audit-tools.test.mjs"),
    "retain the stronger production strict audit test",
  );
  for (const script of ["test:unit-contract", "test:behavior"]) {
    assert.match(scripts[script], /^node scripts\/run-electron-node\.mjs --test /);
    const focusedFiles = scripts[script].split(/\s+/).filter((arg) => arg.startsWith("tests/"));
    assert.ok(focusedFiles.length > 0, `${script} remains available`);
    for (const file of focusedFiles)
      assert.ok(fullFiles.has(file), `${script}: ${file} must be covered by full-test`);
  }
});
