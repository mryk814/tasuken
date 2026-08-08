import { spawnSync } from "node:child_process";

const isWindows = process.platform === "win32";
const npmCommand = isWindows ? "npm.cmd" : "npm";
const steps = [
  ["Node ABI rebuild", "rebuild:node"],
  ["TypeScript typecheck", "typecheck"],
  ["Unit and contract tests", "test:unit-contract"],
  ["Behavior and data-safety tests", "test:behavior"],
  ["Full test suite", "test:full"],
  ["Consistency audit", "audit:consistency"],
  ["Script inventory audit", "audit:scripts"],
  ["Renderer and main build", "build"],
  ["Electron ABI rebuild", "rebuild:electron"],
  ["Focused Electron smoke", "smoke:desktop:focused"],
];

for (const [label, script] of steps) {
  console.log("\n=== " + label + " :: npm run " + script + " ===");
  const command = isWindows ? (process.env.ComSpec || "cmd.exe") : npmCommand;
  const args = isWindows ? ["/d", "/s", "/c", npmCommand, "run", script] : ["run", script];
  const result = spawnSync(command, args, { stdio: "inherit", shell: false });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}

console.log("\nCI quality gates passed.");
