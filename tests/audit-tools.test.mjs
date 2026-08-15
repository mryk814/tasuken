import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { inventoryEntry } from "../scripts/audit-scripts.mjs";
import { declaredTokensFromSource, scanSource, scanTokenUsage } from "../scripts/audit-rules.mjs";

test("consistency scanner promotes raw IPC and direct writes to blocking errors in strict mode", () => {
  const findings = scanSource({
    file: "src/main/todayMiniController.ts",
    source: 'window.webContents.send("today-mini:update"); repository.save(task); const rows = collections[type];',
    strict: true,
  });
  assert.equal(findings.find((finding) => finding.ruleId === "raw-auxiliary-ipc")?.severity, "error");
  assert.equal(findings.find((finding) => finding.ruleId === "application-command-write")?.severity, "error");
  assert.equal(findings.find((finding) => finding.ruleId === "entity-registry-external-mapping")?.severity, "error");
});

test("consistency scanner only inspects saveEntities task literals inside the call", () => {
  const builderSource = [
    "saveEntities(buildSaveTaskOperations(task));",
    'const row = { type: "task", task };',
  ].join("\n");
  assert.equal(scanSource({ file: "src/renderer/src/features/workspace/pages/TodayPage.tsx", source: builderSource, strict: true }).length, 0);

  const directWrite = scanSource({
    file: "src/renderer/src/features/workspace/pages/TodayPage.tsx",
    source: 'saveEntities([{ type: "task", entity: task }]);',
    strict: true,
  });
  assert.equal(directWrite.find((finding) => finding.ruleId === "application-command-write")?.severity, "error");
});

test("consistency scanner keeps a justified legacy satellite boundary report-only", () => {
  const findings = scanSource({
    file: "src/preload/todayMini.ts",
    source: 'ipcRenderer.invoke("today-mini:show");',
    allowlist: {
      "raw-auxiliary-ipc": {
        "src/preload/todayMini.ts": "Existing satellite boundary until #336.",
      },
    },
    strict: true,
  });
  const finding = findings.find((entry) => entry.ruleId === "raw-auxiliary-ipc");
  assert.equal(finding?.severity, "report-only");
  assert.equal(finding?.allowlisted, true);
});

test("script inventory marks an unreferenced fixture stale and a package target reachable", () => {
  const stale = inventoryEntry({
    file: "scripts/forgotten.mjs",
    packageScripts: { test: "node tests/*.test.mjs" },
    workflowText: "",
    manualAllowlist: {},
  });
  const reachable = inventoryEntry({
    file: "scripts/audit-consistency.mjs",
    packageScripts: { "audit:consistency": "node scripts/audit-consistency.mjs" },
    workflowText: "",
    manualAllowlist: {},
  });
  assert.equal(stale.stale, true);
  assert.equal(stale.reachable, false);
  assert.deepEqual(reachable.packageOwners, ["audit:consistency"]);
  assert.equal(reachable.stale, false);
});

test("strict consistency treats an undeclared CSS token as a blocking error", () => {
  const findings = scanTokenUsage({
    file: "fixture.css",
    source: ".card { color: var(--missing-fixture-token); }",
    declaredTokens: new Set(["known-token"]),
    strict: true,
  });
  assert.equal(findings.length, 1);
  assert.equal(findings[0].ruleId, "standalone-token");
  assert.equal(findings[0].severity, "error");
  assert.equal(findings[0].category, "error");
});

test("token contract resolves CSS template declarations and runtime style assignments", () => {
  const template = `const css = \`.markdown-preview { --template-scoped: #fff; color: var(--template-scoped); }\`;`;
  const runtime = `const style = { "--gantt-grid-image": grid, '--lane-index': lane }; el.style.setProperty("--ink-color", color);`;
  const declared = new Set([...declaredTokensFromSource(template), ...declaredTokensFromSource(runtime)]);
  assert.deepEqual([...scanTokenUsage({
    file: "fixture.css",
    source: ".markdown-preview { color: var(--template-scoped); } .gantt { background: var(--gantt-grid-image); color: var(--ink-color); }",
    declaredTokens: declared,
    strict: true,
  })], []);
  assert.equal(scanTokenUsage({ file: "fixture.css", source: ".card { color: var(--truly-undefined); }", declaredTokens: declared, strict: true }).length, 1);
});

test("dead mini-timeline CSS selectors are removed only when no renderer markup references them", () => {
  const css = readFileSync("src/renderer/src/styles/app.css", "utf8");
  const selectors = [".mini-track", ".grid-lines", ".bar", ".phase-bar", ".baseline-bar", ".milestones", ".waiting-track", ".today-line", ".mini-gantt-grid"];
  const sourceFiles = [];
  const visit = (directory) => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const file = path.join(directory, entry.name);
      if (entry.isDirectory()) visit(file);
      else if (!file.endsWith(".css") && /\.(tsx?|jsx?|html)$/.test(file)) sourceFiles.push(file);
    }
  };
  visit("src/renderer/src");
  const source = sourceFiles.map((file) => readFileSync(file, "utf8")).join("\n");
  for (const selector of selectors) {
    const escaped = selector.replace(".", "\\.");
    assert.doesNotMatch(css, new RegExp(escaped));
    // Timeline data may legitimately use names such as `milestones`; only
    // renderer class assignments prove that the removed CSS surface remains.
    const className = selector.slice(1);
    assert.doesNotMatch(source, new RegExp(`(?:className|class)\\s*=\\s*[^\\n]*(?<![\\w-])${className}(?![\\w-])`));
  }
});

test("production strict consistency audit has no errors or report-only findings", () => {
  const result = spawnSync(process.execPath, ["scripts/audit-consistency.mjs", "--strict", "--format=json"], { encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr);
  const report = JSON.parse(result.stdout);
  assert.deepEqual(report.summary, { total: 0, errors: 0, reportOnly: 0 });
});
