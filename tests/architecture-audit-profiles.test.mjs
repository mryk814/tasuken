import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  analyzeArchitecture,
  applyArchitectureEnforcement,
  loadArchitectureConfig,
} from "../scripts/architecture-audit/core.mjs";

const script = path.resolve("scripts/audit-architecture.mjs");
const rule = "capability.ipc_registration_outside_manifest";
const sourcePath = "src/main/core/fixture.ts";

function writeJson(root, file, value) {
  writeFileSync(path.join(root, "architecture", file), JSON.stringify(value));
}

function createFixture() {
  const root = mkdtempSync(path.join(os.tmpdir(), "tasken-architecture-profiles-"));
  mkdirSync(path.join(root, "architecture"));
  mkdirSync(path.join(root, "src/main/core"), { recursive: true });
  writeFileSync(path.join(root, sourcePath), 'ipcMain.handle("fixture", () => {});\n');
  writeJson(root, "modules.json", {
    sourceRoots: ["src"],
    modules: [{ id: "main.core", root: "src/main/core", kind: "main-application" }],
    enforcement: {
      profiles: {
        task: { modules: ["main.core"], blockingRules: [], globalRules: [] },
        "core-mcp": { modules: ["main.core"], blockingRules: [rule], globalRules: [] },
      },
    },
  });
  for (const [file, value] of Object.entries({
    "compatibility-baseline.json": { categories: {} },
    "violations-baseline.json": { findings: [] },
    "composition-baseline.json": { roots: [] },
    "capability-baseline.json": { surfaces: [] },
    "generated-sources.json": { entries: [] },
    "shared-ownership.json": { rules: [] },
    "suppressions.json": { entries: [] },
  }))
    writeJson(root, file, value);
  return root;
}

function runAudit(root, args = ["--enforce", "task", "--enforce", "core-mcp"]) {
  const result = spawnSync(process.execPath, [script, ...args, "--format=json"], {
    cwd: root,
    encoding: "utf8",
    timeout: 15_000,
  });
  assert.equal(result.error, undefined, result.error?.message);
  return result;
}

function readProfiles(root) {
  const result = runAudit(root);
  return { ...result, reports: JSON.parse(result.stdout).reports };
}

test("one inventory preserves each standalone profile and its separate artifacts", () => {
  const root = createFixture();
  try {
    const config = loadArchitectureConfig(root);
    const inventory = analyzeArchitecture({ root, ...config });
    const original = structuredClone(inventory);
    const result = readProfiles(root);
    assert.equal(result.status, 1, "a later blocking profile must fail the whole command");
    assert.deepEqual(
      result.reports.map((report) => report.mode),
      ["report-only", "enforced:task", "enforced:core-mcp"],
    );
    assert.deepEqual(
      result.reports.map((report) => report.summary.blockingFindings),
      [0, 0, 1],
    );
    for (const [index, [id, profile]] of Object.entries(
      config.policy.enforcement.profiles,
    ).entries()) {
      const enforcement = { ...profile, id };
      const reused = applyArchitectureEnforcement(inventory, enforcement, config.policy);
      assert.deepEqual(reused, analyzeArchitecture({ root, ...config, enforcement }));
      assert.deepEqual(result.reports[index + 1], reused);
      const standalone = runAudit(root, ["--enforce", id, "--output-dir", `standalone-${id}`]);
      assert.equal(standalone.status, reused.summary.blockingFindings > 0 ? 1 : 0);
      assert.deepEqual(JSON.parse(standalone.stdout), reused);
      assert.deepEqual(
        JSON.parse(
          readFileSync(path.join(root, "artifacts/architecture", id, "report.json"), "utf8"),
        ),
        reused,
      );
    }
    assert.deepEqual(inventory, original, "classifying profiles must not mutate the inventory");
    assert.deepEqual(applyArchitectureEnforcement(result.reports[2]), inventory);
    assert.deepEqual(
      JSON.parse(readFileSync(path.join(root, "artifacts/architecture/report.json"), "utf8")),
      inventory,
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("profile scope preserves policy declaration order for equal normalized roots", () => {
  const root = createFixture();
  try {
    const config = loadArchitectureConfig(root);
    config.policy.modules = [
      { id: "z-first", root: "src\\main\\core", kind: "main-application" },
      { id: "a-second", root: "src/main/core", kind: "main-application" },
    ];
    config.policy.enforcement.profiles["core-mcp"].modules = ["z-first"];
    writeJson(root, "modules.json", config.policy);
    const inventory = analyzeArchitecture({ root, ...config });
    const enforcement = { ...config.policy.enforcement.profiles["core-mcp"], id: "core-mcp" };
    const reused = applyArchitectureEnforcement(inventory, enforcement, config.policy);
    assert.deepEqual(reused, analyzeArchitecture({ root, ...config, enforcement }));
    assert.equal(reused.summary.blockingFindings, 1);
    assert.deepEqual(readProfiles(root).reports[2], reused);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("later invocations reread source, baselines, policy, and suppression expiry", () => {
  const root = createFixture();
  try {
    let result = readProfiles(root);
    const fingerprint = result.reports[0].findings.find(
      (entry) => entry.ruleId === rule,
    ).fingerprint;
    writeJson(root, "violations-baseline.json", { findings: [fingerprint] });
    result = readProfiles(root);
    assert.equal(result.reports[0].findings.find((entry) => entry.ruleId === rule).baseline, true);
    assert.equal(result.status, 1, "baseline findings still block when enforced");

    const suppression = {
      rule,
      source: sourcePath,
      target: "",
      reason: "Fixture debt",
      owner: "fixture",
      issue: 1,
      expiresAt: "2999-01-01",
    };
    writeJson(root, "suppressions.json", { entries: [suppression] });
    assert.equal(readProfiles(root).status, 0);
    writeJson(root, "suppressions.json", {
      entries: [{ ...suppression, expiresAt: "2000-01-01" }],
    });
    result = readProfiles(root);
    assert.equal(result.status, 1);
    assert.equal(
      result.reports[2].findings.find((entry) => entry.ruleId === rule).suppression.expired,
      true,
    );

    writeJson(root, "suppressions.json", { entries: [] });
    const policy = loadArchitectureConfig(root).policy;
    policy.enforcement.profiles.task.blockingRules = [rule];
    policy.enforcement.profiles["core-mcp"].blockingRules = [];
    writeJson(root, "modules.json", policy);
    assert.equal(readProfiles(root).status, 1);
    assert.deepEqual(
      readProfiles(root).reports.map((report) => report.summary.blockingFindings),
      [0, 1, 0],
    );

    writeFileSync(path.join(root, sourcePath), "export const fixture = true;\n");
    result = readProfiles(root);
    assert.equal(result.status, 0);
    assert.equal(
      result.reports.some((report) => report.findings.some((entry) => entry.ruleId === rule)),
      false,
    );
    writeFileSync(path.join(root, "src/main/core/added.ts"), 'ipcMain.on("fixture", () => {});\n');
    assert.equal(readProfiles(root).status, 1, "new source files must not reuse an old inventory");
    rmSync(path.join(root, "src/main/core/added.ts"));
    assert.equal(
      readProfiles(root).status,
      0,
      "removed source files must not survive in inventory",
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("multi-profile mode rejects ambiguous writes and missing profiles", () => {
  const root = createFixture();
  try {
    for (const args of [
      ["--enforce", "task", "--enforce", "core-mcp", "--write-baselines"],
      ["--enforce", "task", "--enforce", "missing"],
      ["--enforce", "missing"],
    ]) {
      const result = runAudit(root, args);
      assert.equal(result.status, 2);
      assert.equal(result.stdout, "");
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("development Proposal smoke builds the app and launches source MCP without bundling it", () => {
  const { scripts } = JSON.parse(readFileSync("package.json", "utf8"));
  assert.equal(
    scripts["smoke:proposal-live"],
    "npm run build && node scripts/live-proposal-electron-smoke.mjs",
  );
  const source = readFileSync("scripts/live-proposal-electron-smoke.mjs", "utf8");
  assert.match(source, /: path.resolve\("scripts", "mcp-server.mjs"\)/);
  assert.match(
    source,
    /path.join\(path.dirname\(executablePath\), "resources", "mcp", "server.mjs"\)/,
  );
  assert.match(scripts.package, /npm run build:mcp/);
  assert.match(scripts["release:check"], /npm run smoke:proposal-live:packaged/);
});
