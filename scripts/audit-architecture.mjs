import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import process from "node:process";

import {
  analyzeArchitecture,
  applyArchitectureEnforcement,
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
const outputRoot = path.isAbsolute(outputDirectory)
  ? outputDirectory
  : path.join(root, outputDirectory);
const selectedRule = valueAfter("--rule");
const enforcementNames = [
  ...new Set(
    process.argv.flatMap((argument, index) =>
      argument === "--enforce" ? [process.argv[index + 1]] : [],
    ),
  ),
];
const changedOnly = process.argv.includes("--changed");
const multipleProfiles = enforcementNames.length > 1;
if (multipleProfiles && process.argv.includes("--write-baselines")) {
  console.error("Multiple enforcement profiles cannot be combined with --write-baselines.");
  process.exit(2);
}
const config = loadArchitectureConfig(root);
const enforcements = enforcementNames.map((id) => {
  const profile = config.policy.enforcement?.profiles?.[id];
  if (!profile) {
    console.error(`Unknown architecture enforcement profile: ${id}`);
    process.exit(2);
  }
  return { ...profile, id };
});
let report = analyzeArchitecture({
  root,
  ...config,
  enforcement: multipleProfiles ? null : enforcements[0],
});

const refreshSummary = (current) => ({
  ...current,
  findings: report.findings.length,
  baselineFindings: report.findings.filter((entry) => entry.baseline).length,
  newFindings: report.findings.filter((entry) => !entry.baseline).length,
  suppressedFindings: report.findings.filter((entry) => entry.suppressed).length,
  blockingFindings: report.findings.filter(
    (entry) => entry.severity === "blocking" && !entry.suppressed,
  ).length,
});

if (selectedRule) {
  report = {
    ...report,
    findings: report.findings.filter((entry) => entry.ruleId === selectedRule),
  };
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
      for (const file of execFileSync("git", args, { cwd: root, encoding: "utf8" })
        .split(/\r?\n/)
        .filter(Boolean)) {
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
  writeFileSync(
    path.join(root, "architecture/compatibility-baseline.json"),
    JSON.stringify(documents.compatibility, null, 2) + "\n",
  );
  writeFileSync(
    path.join(root, "architecture/composition-baseline.json"),
    JSON.stringify(documents.composition, null, 2) + "\n",
  );
  writeFileSync(
    path.join(root, "architecture/capability-baseline.json"),
    JSON.stringify(documents.capabilities, null, 2) + "\n",
  );
  report = analyzeArchitecture({ root, ...loadArchitectureConfig(root) });
  const stabilized = baselineDocuments(report);
  writeFileSync(
    path.join(root, "architecture/violations-baseline.json"),
    JSON.stringify(stabilized.violations, null, 2) + "\n",
  );
  report = analyzeArchitecture({ root, ...loadArchitectureConfig(root) });
}

function writeReport(report, directory) {
  mkdirSync(directory, { recursive: true });
  writeFileSync(
    path.join(directory, "module-map.json"),
    JSON.stringify({ schemaVersion: report.schemaVersion, modules: report.modules }, null, 2) +
      "\n",
  );
  writeFileSync(
    path.join(directory, "dependencies.json"),
    JSON.stringify(
      { schemaVersion: report.schemaVersion, dependencies: report.dependencies },
      null,
      2,
    ) + "\n",
  );
  writeFileSync(
    path.join(directory, "compatibility-debt.json"),
    JSON.stringify(
      { schemaVersion: report.schemaVersion, compatibility: report.compatibility },
      null,
      2,
    ) + "\n",
  );
  writeFileSync(
    path.join(directory, "capability-surfaces.json"),
    JSON.stringify(
      { schemaVersion: report.schemaVersion, capabilitySurfaces: report.capabilitySurfaces },
      null,
      2,
    ) + "\n",
  );
  writeFileSync(
    path.join(directory, "shared-ownership.json"),
    JSON.stringify(
      { schemaVersion: report.schemaVersion, sharedOwnership: report.sharedOwnership },
      null,
      2,
    ) + "\n",
  );
  writeFileSync(path.join(directory, "report.json"), JSON.stringify(report, null, 2) + "\n");
  writeFileSync(path.join(directory, "report.md"), markdownReport(report));
}

const reports = multipleProfiles
  ? [
      report,
      ...enforcements.map((enforcement) =>
        applyArchitectureEnforcement(report, enforcement, config.policy),
      ),
    ]
  : [report];

for (const current of reports) {
  const directory =
    multipleProfiles && current.mode !== "report-only"
      ? path.join(outputRoot, current.mode.slice("enforced:".length))
      : outputRoot;
  writeReport(current, directory);
}

if (process.argv.includes("--format=json"))
  console.log(JSON.stringify(multipleProfiles ? { reports } : report, null, 2));
else
  for (const report of reports) {
    console.log(
      `Architecture audit: ${report.mode.toUpperCase()} (${report.summary.findings} findings; ${report.summary.newFindings} new candidates; ${report.summary.blockingFindings} blocking)`,
    );
    console.log(
      `Compatibility consumers: ${report.summary.compatibilityConsumers}; new candidates: ${report.summary.newCompatibilityConsumers}`,
    );
    console.log(
      `Preload capabilities: ${report.capabilitySurfaces.reduce((total, entry) => total + entry.propertyCount, 0)}; new candidates: ${report.summary.newCapabilities}`,
    );
    console.log(
      `Shared ownership: ${report.summary.sharedFiles} files; ${report.summary.unclassifiedSharedFiles} unclassified`,
    );
    const profileDirectory =
      multipleProfiles && report.mode !== "report-only"
        ? report.mode.slice("enforced:".length)
        : "";
    console.log(
      `Report: ${normalizePath(path.join(outputDirectory, profileDirectory, "report.md"))}`,
    );
  }

if (reports.some((current) => current.summary.blockingFindings > 0)) process.exitCode = 1;
