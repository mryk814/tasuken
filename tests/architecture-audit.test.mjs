import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";

import {
  analyzeArchitecture,
  collectExports,
  collectImports,
  normalizePath,
  scanTextRules,
} from "../scripts/architecture-audit/core.mjs";

const AUDIT_SPAWN_MAX_BUFFER = 8 * 1024 * 1024;
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
    {
      id: "main.core.fixture",
      root: "src/main/core",
      kind: "main-core",
      publicEntrypoints: [],
      allowedDependencies: [],
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
  const imports = collectImports(
    "fixture.ts",
    [
      'import { a } from "./a";',
      'export * from "./b";',
      'export { c } from "./c";',
      'const d = import("./d");',
    ].join("\n"),
  );
  assert.deepEqual(
    imports.map(({ specifier, kind }) => ({ specifier, kind })),
    [
      { specifier: "./a", kind: "import" },
      { specifier: "./b", kind: "export-all" },
      { specifier: "./c", kind: "re-export" },
      { specifier: "./d", kind: "dynamic-import" },
    ],
  );
});

test("architecture parser inventories named and default exports", () => {
  const exports = collectExports(
    "fixture.ts",
    [
      "export const taskSchema = {};",
      "export type Task = {};",
      'export { parseTask } from "./parse";',
      "export default function createTask() {}",
    ].join("\n"),
  );
  assert.deepEqual(exports, ["Task", "createTask", "default", "parseTask", "taskSchema"]);
});

test("valid public feature import stays clear while deep and runtime imports are reported", () => {
  const report = analyze();
  assert.equal(
    report.findings.some((entry) => entry.source === "src/renderer/features/tasks/valid.ts"),
    false,
  );
  assert.equal(
    report.findings.some(
      (entry) =>
        entry.source.endsWith("invalid.ts") &&
        entry.ruleId === "renderer.cross_feature_deep_import",
    ),
    true,
  );
  assert.equal(
    report.findings.some(
      (entry) =>
        entry.source.endsWith("invalid.ts") && entry.ruleId === "runtime.renderer_isolation",
    ),
    true,
  );
});

test("path aliases resolve before public API and deep-import rules run", () => {
  const report = analyze();
  const aliasFinding = report.findings.find(
    (entry) =>
      entry.source.endsWith("alias-invalid.ts") &&
      entry.ruleId === "renderer.cross_feature_deep_import",
  );
  assert.equal(aliasFinding?.target, "src/renderer/features/notes/internal.ts");
});

test("tests use public APIs unless exact same-module ownership is declared", () => {
  const source = "tests/cross-module.test.ts";
  const report = analyze();
  assert.equal(
    report.findings.some(
      (entry) => entry.source === source && entry.ruleId === "test.cross_module_internal_import",
    ),
    true,
  );
  const sameModule = analyze({
    policy: { ...policy, testOwnership: [{ source, module: "renderer.notes" }] },
  });
  assert.equal(
    sameModule.findings.some(
      (entry) => entry.source === source && entry.ruleId === "test.cross_module_internal_import",
    ),
    false,
  );
});

test("Windows separators normalize to stable repository paths", () => {
  assert.equal(
    normalizePath("src\\renderer\\features\\tasks\\valid.ts"),
    "src/renderer/features/tasks/valid.ts",
  );
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
  assert.equal(
    active.findings.find((finding) => finding.ruleId === entry.rule && finding.source === source)
      ?.suppressed,
    true,
  );
  const expired = analyze({ suppressions: { entries: [{ ...entry, expiresAt: "2026-08-16" }] } });
  const expiredFinding = expired.findings.find(
    (finding) => finding.ruleId === entry.rule && finding.source === source,
  );
  assert.equal(expiredFinding?.suppressed, false);
  assert.equal(expiredFinding?.suppression?.expired, true);
});

test("production audit is deterministic and keeps temporary composition growth visible as tracked debt", () => {
  const output = mkdtempSync(path.join(os.tmpdir(), "tasken-architecture-audit-"));
  try {
    const args = ["scripts/audit-architecture.mjs", "--format=json", "--output-dir", output];
    const first = spawnSync(process.execPath, args, {
      encoding: "utf8",
      maxBuffer: AUDIT_SPAWN_MAX_BUFFER,
    });
    const second = spawnSync(process.execPath, args, {
      encoding: "utf8",
      maxBuffer: AUDIT_SPAWN_MAX_BUFFER,
    });
    assert.equal(first.status, 0, first.stderr);
    assert.equal(second.status, 0, second.stderr);
    assert.equal(first.stdout, second.stdout);
    const report = JSON.parse(first.stdout);
    assert.equal(report.mode, "report-only");
    assert.equal(report.summary.newFindings, 5);
    assert.equal(report.summary.suppressedFindings, 5);
    assert.equal(report.summary.blockingFindings, 0);
    const newFindings = report.findings.filter((entry) => !entry.baseline);
    assert.equal(newFindings.length, 5);
    assert.equal(
      newFindings.every((entry) => entry.suppressed && entry.suppression?.issue),
      true,
    );
    assert.deepEqual(
      report.findings
        .filter((entry) => entry.ruleId === "composition.baseline_increase")
        .map((entry) => [entry.source, entry.suppressed, entry.suppression?.issue]),
      [
        ["src/main/index.ts", true, 482],
        ["src/main/ipc/registerIpc.ts", true, 405],
        ["src/preload/index.ts", true, 405],
        ["src/renderer/src/features/workspace/WorkspaceApp.tsx", true, 481],
        ["src/shared/ipc/contracts.ts", true, 407],
      ],
    );
    assert.equal(report.summary.newCompatibilityConsumers, 0);
    assert.equal(report.summary.unclassifiedSharedFiles, 0);
    assert.equal(
      report.modules.find((entry) => entry.id === "main.task")?.publicEntrypoints[0],
      "src/main/modules/task/public.ts",
    );
    assert.equal(
      report.findings.some((entry) => entry.ruleId === "main.task_legacy_logic"),
      false,
    );
    const mainPreload = report.capabilitySurfaces.find(
      (entry) => entry.file === "src/preload/index.ts" && entry.global === "api",
    );
    assert.equal(mainPreload?.properties.includes("task"), true);
    assert.deepEqual(mainPreload?.added, []);
    const ownershipByFile = new Map(report.sharedOwnership.map((entry) => [entry.file, entry]));
    assert.equal(
      ownershipByFile.get("src/shared/applicationCommand.ts")?.classification,
      "compatibility",
    );
    assert.equal(
      ownershipByFile.get("src/shared/types/workspace.ts")?.classification,
      "compatibility",
    );
    assert.equal(ownershipByFile.get("src/shared/kernel/public.ts")?.classification, "kernel");
    assert.equal(
      ownershipByFile.get("src/shared/contracts/task/public.ts")?.classification,
      "feature-contract",
    );
    assert.equal(
      ownershipByFile.get("src/shared/compatibility/taskIpc.ts")?.classification,
      "compatibility",
    );
    assert.equal(
      report.findings.find(
        (entry) =>
          entry.ruleId === "composition.baseline_increase" &&
          entry.source === "src/shared/ipc/contracts.ts",
      )?.suppressed,
      true,
    );
    assert.equal(
      report.findings.some(
        (entry) =>
          entry.ruleId === "runtime.shared_neutrality" &&
          entry.source.startsWith("src/shared/kernel/"),
      ),
      false,
    );
    assert.equal(
      report.findings.some(
        (entry) =>
          entry.ruleId === "runtime.shared_neutrality" &&
          entry.source.startsWith("src/shared/contracts/task/"),
      ),
      false,
    );
    assert.doesNotThrow(() =>
      JSON.parse(readFileSync(path.join(output, "shared-ownership.json"), "utf8")),
    );
    assert.match(readFileSync(path.join(output, "report.md"), "utf8"), /Rollout: report-only/);
  } finally {
    rmSync(output, { recursive: true, force: true });
  }
});

test("Task enforcement profile is blocking and clean without changing global report-only mode", () => {
  const output = mkdtempSync(path.join(os.tmpdir(), "tasken-architecture-enforced-"));
  try {
    const result = spawnSync(
      process.execPath,
      [
        "scripts/audit-architecture.mjs",
        "--enforce",
        "task",
        "--format=json",
        "--output-dir",
        output,
      ],
      { encoding: "utf8", maxBuffer: AUDIT_SPAWN_MAX_BUFFER },
    );
    assert.equal(result.status, 0, result.stderr);
    const report = JSON.parse(result.stdout);
    assert.equal(report.mode, "enforced:task");
    assert.equal(report.summary.blockingFindings, 0);
    assert.deepEqual(
      report.modules
        .filter((entry) =>
          ["shared.kernel", "shared.contracts.task", "main.task"].includes(entry.id),
        )
        .map((entry) => entry.status)
        .sort(),
      ["enforced", "enforced", "enforced"],
    );
    assert.match(readFileSync(path.join(output, "report.md"), "utf8"), /Rollout: enforced:task/);
  } finally {
    rmSync(output, { recursive: true, force: true });
  }
});

test("Core and MCP enforcement profile is blocking and clean", () => {
  const output = mkdtempSync(path.join(os.tmpdir(), "tasken-architecture-core-mcp-enforced-"));
  try {
    const manifest = JSON.parse(readFileSync("architecture/modules.json", "utf8"));
    const profile = manifest.enforcement.profiles["core-mcp"];
    assert.deepEqual(profile.modules, [
      "shared.kernel",
      "shared.contracts.core",
      "shared.contracts.mobile",
      "main.core",
      "main.mcp",
      "main.mobile",
    ]);
    assert.equal(profile.blockingRules.includes("module.public_api_bypass"), true);
    assert.equal(profile.blockingRules.includes("contract.parallel_mjs_declaration"), true);
    assert.equal(profile.blockingRules.includes("main.transport_repository_import"), true);
    assert.equal(
      profile.blockingRules.includes("capability.ipc_registration_outside_manifest"),
      true,
    );
    assert.deepEqual(manifest.modules.find((entry) => entry.id === "main.mcp")?.publicEntrypoints, [
      "src/main/mcp/agentSessionHookCollector.mjs",
      "src/main/mcp/server.mjs",
      "src/main/mcp/taskenCoreClient.mjs",
    ]);
    const result = spawnSync(
      process.execPath,
      [
        "scripts/audit-architecture.mjs",
        "--enforce",
        "core-mcp",
        "--format=json",
        "--output-dir",
        output,
      ],
      { encoding: "utf8" },
    );
    assert.equal(result.status, 0, result.stderr);
    const report = JSON.parse(result.stdout);
    assert.equal(report.mode, "enforced:core-mcp");
    assert.equal(report.summary.blockingFindings, 0);
    assert.deepEqual(
      report.modules
        .filter((entry) =>
          [
            "shared.kernel",
            "shared.contracts.core",
            "shared.contracts.mobile",
            "main.core",
            "main.mcp",
            "main.mobile",
          ].includes(entry.id),
        )
        .map((entry) => [entry.id, entry.status]),
      [
        ["main.core", "enforced"],
        ["main.mcp", "enforced"],
        ["main.mobile", "enforced"],
        ["shared.contracts.core", "enforced"],
        ["shared.contracts.mobile", "enforced"],
        ["shared.kernel", "enforced"],
      ],
    );
    assert.match(
      readFileSync(path.join(output, "report.md"), "utf8"),
      /Rollout: enforced:core-mcp/,
    );
  } finally {
    rmSync(output, { recursive: true, force: true });
  }
});

test("Core and MCP enforcement blocks a public API bypass", () => {
  const report = analyze({
    enforcement: {
      id: "core-mcp",
      modules: ["renderer.tasks"],
      blockingRules: ["module.public_api_bypass"],
      globalRules: [],
    },
  });
  const finding = report.findings.find(
    (entry) => entry.source.endsWith("invalid.ts") && entry.ruleId === "module.public_api_bypass",
  );
  assert.equal(finding?.severity, "blocking");
  assert.match(finding?.alternative || "", /public\.ts/);
});

test("Core enforcement blocks Electron imports from application services", () => {
  const report = analyze({
    enforcement: {
      id: "core-mcp",
      modules: ["main.core.fixture"],
      blockingRules: ["main.application_platform_import"],
      globalRules: [],
    },
  });
  const finding = report.findings.find(
    (entry) =>
      entry.source === "src/main/core/platform-import.ts" &&
      entry.ruleId === "main.application_platform_import",
  );
  assert.equal(finding?.severity, "blocking");
  assert.match(finding?.alternative || "", /port/);
});

test("Task enforcement blocks malformed suppression debt records", () => {
  const report = analyze({
    enforcement: {
      id: "task",
      modules: ["renderer.tasks"],
      blockingRules: ["suppression.invalid_debt_record"],
      globalRules: ["suppression.invalid_debt_record"],
    },
    suppressions: {
      entries: [
        {
          rule: "renderer.cross_feature_deep_import",
          source: "src/renderer/features/tasks/invalid.ts",
          target: "src/renderer/features/notes/internal.ts",
          reason: "Missing owner and issue on purpose",
        },
      ],
    },
  });
  const finding = report.findings.find(
    (entry) => entry.ruleId === "suppression.invalid_debt_record",
  );
  assert.equal(finding?.severity, "blocking");
  assert.equal(report.summary.blockingFindings, 1);
});

test("Task enforcement blocks undeclared dependencies, shared runtime imports, and capability expansion", () => {
  const undeclared = analyze({
    policy: {
      ...policy,
      modules: policy.modules.map((module) =>
        module.id === "renderer.tasks" ? { ...module, allowedDependencies: [] } : module,
      ),
    },
    enforcement: {
      id: "task",
      modules: ["renderer.tasks"],
      blockingRules: ["module.undeclared_dependency"],
      globalRules: [],
    },
  });
  assert.equal(
    undeclared.findings.some(
      (entry) => entry.ruleId === "module.undeclared_dependency" && entry.severity === "blocking",
    ),
    true,
  );

  const sharedRuntime = analyze({
    policy: {
      ...policy,
      modules: policy.modules.map((module) =>
        module.id === "renderer.tasks"
          ? { ...module, id: "shared.contracts.task", kind: "shared-contract" }
          : module,
      ),
    },
    enforcement: {
      id: "task",
      modules: ["shared.contracts.task"],
      blockingRules: ["runtime.shared_neutrality"],
      globalRules: [],
    },
  });
  assert.equal(
    sharedRuntime.findings.some(
      (entry) => entry.ruleId === "runtime.shared_neutrality" && entry.severity === "blocking",
    ),
    true,
  );

  const capabilityExpansion = analyze({
    capabilityBaseline: {
      surfaces: [{ file: "src/preload/index.ts", global: "api", properties: ["task"] }],
    },
    enforcement: {
      id: "task",
      modules: [],
      blockingRules: ["capability.surface_expansion"],
      globalRules: ["capability.surface_expansion"],
    },
  });
  assert.equal(
    capabilityExpansion.findings.some(
      (entry) => entry.ruleId === "capability.surface_expansion" && entry.severity === "blocking",
    ),
    true,
  );
});
