import { spawnSync } from "node:child_process";

const isWindows = process.platform === "win32";
const npmCommand = isWindows ? "npm.cmd" : "npm";
const npmCli = process.env.npm_execpath || "";
const steps = [
  // testもsmokeもElectronのABIで動くので、rebuildは最初の一回だけでよい。
  ["Electron ABI rebuild", "rebuild:electron", []],
  ["ESLint", "lint", []],
  ["TypeScript typecheck", "typecheck", []],
  ["Unit and contract tests", "test:unit-contract", []],
  ["Behavior and data-safety tests", "test:behavior", []],
  ["Full test suite", "test:full", []],
  ["Strict consistency audit", "audit:consistency", ["--strict", "--format=json"]],
  ["Architecture inventory (report-only)", "audit:architecture", []],
  ["Task architecture enforcement", "audit:architecture", ["--enforce", "task"]],
  ["Core and MCP architecture enforcement", "audit:architecture", ["--enforce", "core-mcp"]],
  ["Script inventory audit", "audit:scripts", []],
  ["Renderer and main build", "build", []],
  ["Focused Electron smoke", "smoke:desktop:focused", []],
];

for (const [label, script, scriptArgs] of steps) {
  console.log("\n=== " + label + " :: npm run " + script + " ===");
  const command = npmCli
    ? process.execPath
    : isWindows
      ? process.env.ComSpec || "cmd.exe"
      : npmCommand;
  const args = npmCli
    ? [npmCli, "run", script, "--", ...scriptArgs]
    : isWindows
      ? ["/d", "/s", "/c", npmCommand, "run", script, "--", ...scriptArgs]
      : ["run", script, "--", ...scriptArgs];
  const result = spawnSync(command, args, { stdio: "inherit", shell: false });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}

console.log("\nCI quality gates passed.");
