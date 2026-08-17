import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";

import { analyzeArchitecture, collectExports, collectImports, normalizePath, scanTextRules } from "../scripts/architecture-audit/core.mjs";

const fixtureRoot = path.resolve("tests/fixtures/architecture-audit");
const policy = {
  sourceRoots: ["src", "tests"],
  tsconfigPaths: ["tsconfig.json"],
  modules: [
    {
      id: "renderer.notes",
      root: "src/renderer/features/notes",
      kind: "renderer-feature",
      publicEntrypoints: ["src/renderer/features/notes/public.ts"],
      allowedDependencies: [],
    },
    {
      id: "renderer.tasks",
      root: "src/renderer/features/tasks",
      kind: "renderer-feature",
      publicEntrypoints: ["src/renderer/features/tasks/public.ts"],
      allowedDependencies: ["renderer.notes"],
    },
  ],
  compositionRoots: [],
  capabilities: { rendererAdapterPaths: [], ipcRegistrarPaths: [] },
};

function analyze(overrides = {}) {
  return analyzeArchitecture({
    root: fixtureRoot,
    policy,
    compatibilityBaseline: { categories: {} },
    violationBaseline: { findings: [] },
    compositionBaseline: { roots: [] },
    capabilityBaseline: { surfaces: [] },
    generatedPolicy: { entries: [] },
    suppressions: { entries: [] },
    today: "2026-08-17",
    ...overrides,
  });
}

test("architecture parser covers imports, re-exports, and dynamic imports", () => {
  const imports = collectImports("fixture.ts", [
    'import { a } from "./a";',
    'export * from "./b";',
    'export { c } from "./c";',
    'const d = import("./d");',
  ].join("\n"));
  assert.deepEqual(imports.map(({ specifier, kind }) => ({ specifier, kind })), [
    { specifier: "./a", kind: "import" },
    { specifier: "./b", kind: "export-all" },
    { specifier: "./c", kind: "re-export" },
    { specifier: "./d", kind: "dynamic-import" },
  ]);
});

test("architecture parser inventories named and default exports", () => {
  const exports = collectExports("fixture.ts", [
    "export const taskSchema = {};",
    "export type Task = {};",
    'export { parseTask } from "./parse";',
    "export default function createTask() {}",
  ].join("\n"));
  assert.deepEqual(exports, ["Task", "createTask", "default", "parseTask", "taskSchema"]);
});

test("valid public feature import stays clear while deep and runtime imports are reported", () => {
  const report = analyze();
  assert.equal(report.findings.some((entry) => entry.source === "src/renderer/features/tasks/valid.ts"), false);
  assert.equal(report.findings.some((entry) => entry.source.endsWith("invalid.ts") && entry.ruleId === "renderer.cross_feature_deep_import"), true);
  assert.equal(report.findings.some((entry) => entry.source.endsWith("invalid.ts") && entry.ruleId === "runtime.renderer_isolation"), true);
});

test("path aliases resolve before public API and deep-import rules run", () => {
  const report = analyze();
  const aliasFinding = report.findings.find((entry) => entry.source.endsWith("alias-invalid.ts") && entry.ruleId === "renderer.cross_feature_deep_import");
  assert.equal(aliasFinding?.target, "src/renderer/features/notes/internal.ts");
});

test("tests use public APIs unless exact same-module ownership is declared", () => {
  const source = "tests/cross-module.test.ts";
  const report = analyze();
  assert.equal(report.findings.some((entry) => entry.source === source && entry.ruleId === "test.cross_module_internal_import"), true);
  const sameModule = analyze({ policy: { ...policy, testOwnership: [{ source, module: "renderer.notes" }] } });
  assert.equal(sameModule.findings.some((entry) => entry.source === source && entry.ruleId === "test.cross_module_internal_import"), false);
});

test("Windows separators normalize to stable repository paths", () => {
  assert.equal(normalizePath("src\\renderer\\features\\tasks\\valid.ts"), "src/renderer/features/tasks/valid.ts");
});

test("migrated Task commands cannot return to the legacy central service", () => {
  const findings = scanTextRules(
    "src/main/services/applicationCommandService.ts",
    'class Legacy {\nprivate saveTask() {}\nexecute(command) { return command.name === "CreateTask"; }\n}',
    {},
  );
  assert.equal(findings.filter((entry) => entry.ruleId === "main.task_legacy_logic").length, 2);
});

test("suppression requires tracked debt and expires deterministically", () => {
  const source = "src/renderer/features/tasks/invalid.ts";
  const target = "src/renderer/features/notes/internal.ts";
  const entry = {
    rule: "renderer.cross_feature_deep_import",
    source,
    target,
    reason: "Fixture migration",
    owner: "renderer-architecture",
    issue: 408,
    expiresAt: "2026-08-31",
  };
  const active = analyze({ suppressions: { entries: [entry] } });
  assert.equal(active.findings.find((finding) => finding.ruleId === entry.rule && finding.source === source)?.suppressed, true);
  const expired = analyze({ suppressions: { entries: [{ ...entry, expiresAt: "2026-08-16" }] } });
  const expiredFinding = expired.findings.find((finding) => finding.ruleId === entry.rule && finding.source === source);
  assert.equal(expiredFinding?.suppressed, false);
  assert.equal(expiredFinding?.suppression?.expired, true);
});

test("production audit is report-only, deterministic, and has no unbaselined candidates", () => {
  const output = mkdtempSync(path.join(os.tmpdir(), "tasken-architecture-audit-"));
  try {
    const args = ["scripts/audit-architecture.mjs", "--format=json", "--output-dir", output];
    const first = spawnSync(process.execPath, args, { encoding: "utf8" });
    const second = spawnSync(process.execPath, args, { encoding: "utf8" });
    assert.equal(first.status, 0, first.stderr);
    assert.equal(second.status, 0, second.stderr);
    assert.equal(first.stdout, second.stdout);
    const report = JSON.parse(first.stdout);
    assert.equal(report.mode, "report-only");
    assert.equal(report.summary.newFindings, 0);
    assert.equal(report.summary.newCompatibilityConsumers, 0);
    assert.equal(report.summary.unclassifiedSharedFiles, 0);
    assert.equal(report.modules.find((entry) => entry.id === "main.task")?.publicEntrypoints[0], "src/main/modules/task/public.ts");
    assert.equal(report.findings.some((entry) => entry.ruleId === "main.task_legacy_logic"), false);
    const ownershipByFile = new Map(report.sharedOwnership.map((entry) => [entry.file, entry]));
    assert.equal(ownershipByFile.get("src/shared/applicationCommand.ts")?.classification, "compatibility");
    assert.equal(ownershipByFile.get("src/shared/types/workspace.ts")?.classification, "compatibility");
    assert.equal(ownershipByFile.get("src/shared/kernel/public.ts")?.classification, "kernel");
    assert.equal(ownershipByFile.get("src/shared/contracts/task/public.ts")?.classification, "feature-contract");
    assert.equal(report.findings.some((entry) => entry.ruleId === "runtime.shared_neutrality" && entry.source.startsWith("src/shared/kernel/")), false);
    assert.equal(report.findings.some((entry) => entry.ruleId === "runtime.shared_neutrality" && entry.source.startsWith("src/shared/contracts/task/")), false);
    assert.doesNotThrow(() => JSON.parse(readFileSync(path.join(output, "shared-ownership.json"), "utf8")));
    assert.match(readFileSync(path.join(output, "report.md"), "utf8"), /Rollout: report-only/);
  } finally {
    rmSync(output, { recursive: true, force: true });
  }
});
