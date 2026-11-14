import { spawnSync } from "node:child_process";
import { createTempRoot } from "./test-temp-root.mjs";

const isWindows = process.platform === "win32";
const npmCommand = isWindows ? "npm.cmd" : "npm";
const npmCli = process.env.npm_execpath || "";
const steps = [
  // testもsmokeもElectronのABIで動くので、rebuildは最初の一回だけでよい。
  ["Electron ABI rebuild", "rebuild:electron", []],
  ["ESLint", "lint", []],
  ["TypeScript typecheck", "typecheck", []],
  ["Full test suite", "test:full", []],
  ["Strict consistency audit", "audit:consistency", ["--strict", "--format=json"]],
  [
    "Architecture inventory and Task/Core-MCP enforcement",
    "audit:architecture",
    ["--enforce", "task", "--enforce", "core-mcp"],
  ],
  ["Script inventory audit", "audit:scripts", []],
  ["Renderer and main build", "build", []],
  ["Focused Electron smoke", "smoke:desktop:focused", []],
  ["Live MCP Proposal Electron smoke", "smoke:proposal-live:focused", []],
];

function runSteps() {
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
    if (result.status !== 0) return result.status ?? 1;
  }
  return 0;
}

// smoke（Playwright の playwright-artifacts-* や tasken-smoke-run-*）も含め、どの段の一時
// フォルダーも一つの根へ集め、通っても落ちても最後に消す（scripts/test-temp-root.mjs）。
// spawnSync の options を変えずに子へ渡すため、自分の環境を書き換える。
const tempRoot = createTempRoot();
Object.assign(process.env, { TEMP: tempRoot.root, TMP: tempRoot.root, TMPDIR: tempRoot.root });
// Ctrl+C は段の子にも届く。子が終わるのを待って根を消せるよう、ここでは終わらない。
process.on("SIGINT", () => {});

let exitCode;
try {
  exitCode = runSteps();
} finally {
  tempRoot.remove();
}
if (exitCode !== 0) process.exit(exitCode);

console.log("\nCI quality gates passed.");
