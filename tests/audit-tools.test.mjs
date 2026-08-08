import assert from "node:assert/strict";
import test from "node:test";
import { inventoryEntry } from "../scripts/audit-scripts.mjs";
import { scanSource, scanTokenUsage } from "../scripts/audit-rules.mjs";

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
