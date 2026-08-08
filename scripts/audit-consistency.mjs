import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import { scanSource, scanTokenUsage } from "./audit-rules.mjs";

const root = process.cwd();
const schemaVersion = 1;
const strict = process.argv.includes("--strict");
const sourceRoots = ["src", "scripts", "tests"];
const sourceExtensions = new Set([".css", ".html", ".js", ".mjs", ".ts", ".tsx"]);
const allowlist = {
  "raw-auxiliary-ipc": {
    "src/preload/capture.ts": "Capture satellite uses its stable legacy channel until Application Command (#336) lands.",
    "src/preload/memoSticky.ts": "Memo sticky window channel is an existing satellite boundary; migration is tracked with #336.",
    "src/preload/todayMini.ts": "Today mini window channel is an existing satellite boundary; migration is tracked with #336.",
  },
  "legacy-theme-field": {
    "src/main/repositories/workspaceRepository.mjs": "Repository is the explicit legacy-read and canonical-write boundary.",
    "src/shared/entityRegistry.mjs": "Registry declares legacy fields for migration and raw-record validation.",
    "src/shared/themeRef.mjs": "ThemeRef resolves legacy theme_id only at the declared boundary.",
  },
  "entity-registry-external-mapping": {
    "src/renderer/src/features/workspace/lib/slideTimeline.ts": "Specialized Timeline projection still uses a validated collection projection; migrate only when its canonical data contract changes.",
  },
  "application-command-write": {
    "src/main/ipc/registerIpc.ts": "Current IPC write boundary predates #336 Application Command; keep report-only until #336 is merged.",
    "src/main/repositories/workspaceRepository.mjs": "Repository is the single persistence boundary; command parity is pending #336.",
  },
  "raw-danger-or-ai-icon": {
    "src/renderer/src/pages/semanticActions.ts": "Semantic ActionDefinition is the canonical icon/role registry.",
    "src/renderer/src/pages/routes.ts": "RouteDefinition owns the AI Inbox route icon.",
  },
};

function filesUnder(relativeRoot) {
  const absoluteRoot = path.join(root, relativeRoot);
  const result = [];
  function visit(directory) {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      if (["node_modules", "out", "release", ".git"].includes(entry.name)) continue;
      const absolute = path.join(directory, entry.name);
      if (entry.isDirectory()) visit(absolute);
      else if (sourceExtensions.has(path.extname(entry.name))) result.push(path.relative(root, absolute).replaceAll("\\", "/"));
    }
  }
  if (statSync(absoluteRoot, { throwIfNoEntry: false })) visit(absoluteRoot);
  return result;
}

const files = sourceRoots.flatMap(filesUnder);
const sourceFiles = files.filter((file) => file.startsWith("src/"));
const contents = new Map(files.map((file) => [file, readFileSync(path.join(root, file), "utf8")]));
const findings = [];
function add(ruleId, severity, file, message, match = "") {
  const reason = allowlist[ruleId]?.[file] || null;
  findings.push({ schemaVersion, ruleId, severity, category: severity === "error" ? "error" : "report", file, match, message, allowlisted: Boolean(reason), reason });
}

for (const file of sourceFiles) {
  const source = contents.get(file);
  if (file === "src/shared/ipc/contracts.ts") continue;
  for (const finding of scanSource({ file, source, allowlist, strict })) {
    findings.push({ schemaVersion, ...finding });
  }
}

const registry = contents.get("src/shared/entityRegistry.mjs") || "";
if (!/export const entityDefinitions/.test(registry) || !/collectionKeyForEntityType/.test(registry)) {
  add("entity-registry-coverage", "error", "src/shared/entityRegistry.mjs", "Entity Registry must export definitions and the canonical type-to-collection resolver.");
}
const routes = contents.get("src/renderer/src/pages/routes.ts") || "";
const actions = contents.get("src/renderer/src/pages/semanticActions.ts") || "";
const icons = contents.get("src/renderer/src/pages/semanticIcons.ts") || "";
if (!/export const ROUTE_DEFINITIONS/.test(routes) || !/routeIcon\(/.test(routes)) {
  add("route-icon-coverage", "error", "src/renderer/src/pages/routes.ts", "RouteDefinition must be the route icon/label/navigation coverage source.");
}
if (files.includes("src/renderer/src/pages/routeIcons.ts")) {
  add("route-icon-coverage", "error", "src/renderer/src/pages/routeIcons.ts", "Independent route icon registry must not be present.");
}
if (!/export interface ActionDefinition/.test(actions) || !/ACTION_DEFINITIONS/.test(actions) || !/AI_ICON/.test(icons)) {
  add("action-semantic-coverage", "error", "src/renderer/src/pages/semanticActions.ts", "ActionDefinition, practical actions, and AI icon contract must be present.");
}

const cssFiles = [...contents.keys()].filter((file) => file.endsWith(".css") || file.endsWith(".html"));
const declaredTokens = new Set();
const designTokens = readFileSync(path.join(root, "design-standard/tokens.css"), "utf8");
for (const match of designTokens.matchAll(/--([a-z0-9-]+)\s*:/gi)) declaredTokens.add(match[1]);
for (const file of cssFiles) {
  for (const match of contents.get(file).matchAll(/--([a-z0-9-]+)\s*:/gi)) declaredTokens.add(match[1]);
}
for (const file of cssFiles) {
  const source = contents.get(file);
  for (const finding of scanTokenUsage({ file, source, declaredTokens, strict })) findings.push({ schemaVersion, ...finding });
}

const uniqueFindings = [...new Map(findings.map((finding) => [
  [finding.ruleId, finding.file, finding.match].join("|"),
  finding,
])).values()];
const errors = uniqueFindings.filter((finding) => finding.severity === "error" && !finding.allowlisted);
const report = { schemaVersion, ok: errors.length === 0, findings: uniqueFindings, summary: { total: uniqueFindings.length, errors: errors.length, reportOnly: uniqueFindings.filter((finding) => finding.severity === "report-only").length } };
if (process.argv.includes("--format=json")) console.log(JSON.stringify(report, null, 2));
else {
  console.log("Consistency audit schema v" + schemaVersion + ": " + (report.ok ? "PASS" : "FAIL"));
  for (const finding of uniqueFindings) console.log("[" + finding.severity + "] " + finding.ruleId + " " + finding.file + ": " + finding.message + (finding.allowlisted ? " (allowlisted: " + finding.reason + ")" : ""));
  console.log("Findings: " + report.summary.total + "; errors: " + report.summary.errors + "; report-only: " + report.summary.reportOnly);
}
if (!report.ok) process.exitCode = 1;
