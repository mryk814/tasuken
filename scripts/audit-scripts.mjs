import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const root = process.cwd();
const schemaVersion = 1;
const packageJson = JSON.parse(readFileSync(path.join(root, "package.json"), "utf8"));
const packageScripts = packageJson.scripts || {};
const manualAllowlist = {
  "audit-rules.mjs": "Internal scanner module imported by audit-consistency; not a CLI entry point.",
  "generate-katex-document-css.mjs": "Manual generated CSS refresh after upgrading KaTeX; generated output is committed.",
  "model-smoke.mjs": "Manual model/MCP integration check; it requires a real local database fixture.",
  "notes-performance.mjs": "Manual long-Notes performance benchmark; not a merge gate.",
  "mcp-server.mjs": "Manual MCP stdio entry point; launched by the mcp package script.",
};

function scriptFiles(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) return scriptFiles(absolute);
    return entry.name.endsWith(".mjs") ? [path.relative(root, absolute).replaceAll("\\", "/")] : [];
  });
}

const files = scriptFiles(path.join(root, "scripts"));
const workflowDirectory = path.join(root, ".github/workflows");
const workflows = statSync(workflowDirectory, { throwIfNoEntry: false })
  ? readdirSync(workflowDirectory, { withFileTypes: true }).filter((entry) => entry.isFile()).map((entry) => readFileSync(path.join(workflowDirectory, entry.name), "utf8")).join("\n")
  : "";
const workspaceRepository = readFileSync(path.join(root, "src/main/repositories/workspaceRepository.mjs"), "utf8");
const workspaceSchemaVersion = Number(workspaceRepository.match(/const SCHEMA_VERSION = (\d+)/)?.[1] || 0);
const findings = [];

export function inventoryEntry({ file, packageScripts: scripts, workflowText, manualAllowlist: allowed = manualAllowlist }) {
  const base = path.basename(file);
  const packageOwners = Object.entries(scripts).filter(([, command]) => command.includes(base)).map(([name]) => name);
  const workflowReachable = workflowText.includes(base);
  const allowlistedManual = allowed[base] || null;
  const reachable = packageOwners.length > 0 || workflowReachable || Boolean(allowlistedManual);
  const contexts = packageOwners.flatMap((name) => name.startsWith("release") || name === "package" ? ["release"] : name === "ci" || name.startsWith("test") || name.startsWith("audit") || name === "build" ? ["ci"] : ["manual"]);
  if (workflowReachable && !contexts.includes("ci") && !contexts.includes("release")) contexts.push("ci");
  if (allowlistedManual && !contexts.includes("manual")) contexts.push("manual");
  return {
    schemaVersion,
    workspaceSchemaVersion,
    file,
    reachable,
    packageOwners,
    workflowReachable,
    contexts: [...new Set(contexts.length ? contexts : ["manual"])],
    purpose: allowlistedManual || (base.replace(/\.mjs$/, "") + " script; review package/workflow ownership before changing it."),
    lastRun: null,
    stale: !reachable,
  };
}

for (const [name, command] of Object.entries(packageScripts)) {
  for (const reference of command.matchAll(/(?:node\s+)?scripts[\\/]+([\w.-]+\.mjs)/g)) {
    const file = "scripts/" + reference[1];
    if (!files.includes(file)) findings.push({ severity: "error", kind: "missing-package-target", script: name, file, message: "package script references a missing script file" });
  }
}

const entries = files.map((file) => inventoryEntry({ file, packageScripts, workflowText: workflows }));

export const report = {
  schemaVersion,
  workspaceSchemaVersion,
  packageScriptCount: Object.keys(packageScripts).length,
  scripts: entries,
  findings,
  ok: findings.every((finding) => finding.severity !== "error") && entries.every((entry) => !entry.stale || Boolean(manualAllowlist[path.basename(entry.file)])),
};
const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  if (process.argv.includes("--format=json")) console.log(JSON.stringify(report, null, 2));
  else {
    console.log("Script inventory schema v" + schemaVersion + "; workspace schema v" + workspaceSchemaVersion + ": " + (report.ok ? "PASS" : "FAIL"));
    for (const entry of entries) console.log((entry.stale ? "[STALE] " : "[OK] ") + entry.file + " :: " + entry.contexts.join(",") + " :: " + entry.purpose);
    for (const finding of findings) console.log("[" + finding.severity + "] " + finding.message + ": " + finding.file);
  }
  if (!report.ok) process.exitCode = 1;
}
