import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import process from "node:process";

import {
  analyzeArchitecture,
  baselineDocuments,
  loadArchitectureConfig,
  markdownReport,
  normalizePath,
} from "./architecture-audit/core.mjs";

const root = process.cwd();
const valueAfter = (flag) => {
  const index = process.argv.indexOf(flag);
  return index >= 0 ? process.argv[index + 1] : null;
};
const outputDirectory = valueAfter("--output-dir") || "artifacts/architecture";
const outputRoot = path.isAbsolute(outputDirectory) ? outputDirectory : path.join(root, outputDirectory);
const selectedRule = valueAfter("--rule");
const enforcementName = valueAfter("--enforce");
const changedOnly = process.argv.includes("--changed");
const config = loadArchitectureConfig(root);
const enforcementPolicy = enforcementName ? config.policy.enforcement?.profiles?.[enforcementName] : null;
const enforcement = enforcementPolicy ? { ...enforcementPolicy, id: enforcementName } : null;
if (enforcementName && !enforcementPolicy) {
  console.error(`Unknown architecture enforcement profile: ${enforcementName}`);
  process.exitCode = 2;
}
let report = analyzeArchitecture({ root, ...config, enforcement });

const refreshSummary = (current) => ({
  ...current,
  findings: report.findings.length,
  baselineFindings: report.findings.filter((entry) => entry.baseline).length,
  newFindings: report.findings.filter((entry) => !entry.baseline).length,
  suppressedFindings: report.findings.filter((entry) => entry.suppressed).length,
  blockingFindings: report.findings.filter((entry) => entry.severity === "blocking" && !entry.suppressed).length,
});

if (selectedRule) {
  report = { ...report, findings: report.findings.filter((entry) => entry.ruleId === selectedRule) };
  report.summary = refreshSummary(report.summary);
}

if (changedOnly) {
  const base = process.env.ARCHITECTURE_BASE_REF || "origin/main";
  const changed = new Set();
  for (const args of [
    ["diff", "--name-only", `${base}...HEAD`],
    ["diff", "--name-only", "HEAD"],
    ["diff", "--name-only", "--cached", "HEAD"],
  ]) {
    try {
      for (const file of execFileSync("git", args, { cwd: root, encoding: "utf8" }).split(/\r?\n/).filter(Boolean)) {
        changed.add(normalizePath(file));
      }
    } catch {
      // A missing remote base must not hide local staged or unstaged changes.
    }
  }
  report = { ...report, findings: report.findings.filter((entry) => changed.has(entry.source)) };
  report.summary = refreshSummary(report.summary);
}

if (process.argv.includes("--write-baselines")) {
  const documents = baselineDocuments(report);
  writeFileSync(path.join(root, "architecture/compatibility-baseline.json"), JSON.stringify(documents.compatibility, null, 2) + "\n");
  writeFileSync(path.join(root, "architecture/composition-baseline.json"), JSON.stringify(documents.composition, null, 2) + "\n");
  writeFileSync(path.join(root, "architecture/capability-baseline.json"), JSON.stringify(documents.capabilities, null, 2) + "\n");
  report = analyzeArchitecture({ root, ...loadArchitectureConfig(root) });
  const stabilized = baselineDocuments(report);
  writeFileSync(path.join(root, "architecture/violations-baseline.json"), JSON.stringify(stabilized.violations, null, 2) + "\n");
  report = analyzeArchitecture({ root, ...loadArchitectureConfig(root) });
}

mkdirSync(outputRoot, { recursive: true });
writeFileSync(path.join(outputRoot, "module-map.json"), JSON.stringify({ schemaVersion: report.schemaVersion, modules: report.modules }, null, 2) + "\n");
writeFileSync(path.join(outputRoot, "dependencies.json"), JSON.stringify({ schemaVersion: report.schemaVersion, dependencies: report.dependencies }, null, 2) + "\n");
writeFileSync(path.join(outputRoot, "compatibility-debt.json"), JSON.stringify({ schemaVersion: report.schemaVersion, compatibility: report.compatibility }, null, 2) + "\n");
writeFileSync(path.join(outputRoot, "capability-surfaces.json"), JSON.stringify({ schemaVersion: report.schemaVersion, capabilitySurfaces: report.capabilitySurfaces }, null, 2) + "\n");
writeFileSync(path.join(outputRoot, "shared-ownership.json"), JSON.stringify({ schemaVersion: report.schemaVersion, sharedOwnership: report.sharedOwnership }, null, 2) + "\n");
writeFileSync(path.join(outputRoot, "report.json"), JSON.stringify(report, null, 2) + "\n");
writeFileSync(path.join(outputRoot, "report.md"), markdownReport(report));

if (process.argv.includes("--format=json")) console.log(JSON.stringify(report, null, 2));
else {
  console.log(`Architecture audit: ${report.mode.toUpperCase()} (${report.summary.findings} findings; ${report.summary.newFindings} new candidates; ${report.summary.blockingFindings} blocking)`);
  console.log(`Compatibility consumers: ${report.summary.compatibilityConsumers}; new candidates: ${report.summary.newCompatibilityConsumers}`);
  console.log(`Preload capabilities: ${report.capabilitySurfaces.reduce((total, entry) => total + entry.propertyCount, 0)}; new candidates: ${report.summary.newCapabilities}`);
  console.log(`Shared ownership: ${report.summary.sharedFiles} files; ${report.summary.unclassifiedSharedFiles} unclassified`);
  console.log(`Report: ${normalizePath(path.join(outputDirectory, "report.md"))}`);
}

if (report.summary.blockingFindings > 0) process.exitCode = 1;
