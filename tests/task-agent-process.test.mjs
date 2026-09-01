import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { build } from "esbuild";

const bundled = await build({
  entryPoints: ["src/main/services/taskAgentProcess.ts"],
  bundle: true,
  platform: "node",
  format: "esm",
  write: false,
});
const {
  quoteWindowsArgument,
  buildTaskAgentArguments,
  buildWindowsConsoleScript,
  getTaskAgentClients,
} = await import(
  `data:text/javascript;base64,${Buffer.from(bundled.outputFiles[0].text).toString("base64")}`
);

test(
  "installed CLI discovery makes only usable PATH clients available",
  {
    skip: process.platform !== "win32",
  },
  async () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), "tasken-agent-clients-"));
    const pathKey = Object.keys(process.env).find((key) => key.toLowerCase() === "path") || "Path";
    const previousPath = process.env[pathKey];
    try {
      fs.writeFileSync(path.join(directory, "node.exe"), "");
      fs.writeFileSync(path.join(directory, "codex.exe"), "");
      process.env[pathKey] = directory;
      const clients = await getTaskAgentClients();
      assert.deepEqual(
        clients.map(({ id, available }) => ({ id, available })),
        [
          { id: "claude_code", available: false },
          { id: "github_copilot", available: false },
          { id: "codex", available: true },
        ],
      );
    } finally {
      if (previousPath === undefined) delete process.env[pathKey];
      else process.env[pathKey] = previousPath;
      fs.rmSync(directory, { recursive: true, force: true });
    }
  },
);

test("Windows argv quotes preserve spaces, quotes and trailing backslashes", () => {
  assert.equal(quoteWindowsArgument(""), '""');
  assert.equal(quoteWindowsArgument("a b; 日本語 & $x"), '"a b; 日本語 & $x"');
  assert.equal(quoteWindowsArgument('a"b'), '"a\\"b"');
  assert.equal(quoteWindowsArgument("C:\\a b\\"), '"C:\\a b\\\\"');
  assert.equal(quoteWindowsArgument('a\\"b'), '"a\\\\\\"b"');
});

test("interactive CLI arguments keep Task and MCP identity without permission bypass", () => {
  const config = JSON.stringify({
    mcpServers: { tasken: { command: "node", args: ["C:\\日本語 path\\server.mjs"] } },
  });
  for (const id of ["claude_code", "github_copilot"]) {
    const args = buildTaskAgentArguments(id, "task-42", config);
    assert.ok(args.includes(config));
    assert.match(args.at(-1), /Task ID: task-42/);
    assert.match(args.at(-1), /取得できなければ推測で作業せず/);
    assert.match(args.at(-1), /Tasken側で.*作業開始は記録済み/);
    assert.match(args.at(-1), /start_task_workは呼ばず/);
    assert.match(args.at(-1), /途中経過・完了・ブロック.*Proposal \/ Work Receipt/);
    assert.match(args.at(-1), /人間の確認やTask完了を代行しない/);
    assert.ok(
      !args.some((arg) => /bypass|skip-permissions|allow-all|yolo|strict-mcp-config/.test(arg)),
    );
    assert.equal(args[0], id === "claude_code" ? "--mcp-config" : "--additional-mcp-config");
    if (id === "github_copilot") assert.ok(args.includes("-i"));
  }
});

test("Codex receives an ephemeral Tasken MCP server configuration without permission bypass", () => {
  const config = JSON.stringify({
    mcpServers: {
      tasken: {
        command: "C:\\Program Files\\nodejs\\node.exe",
        args: ["C:\\path with spaces\\server.mjs", "--stdio"],
        env: { TASKEN_USER_DATA_DIR: "C:\\Tasken Data" },
      },
    },
  });

  const args = buildTaskAgentArguments("codex", "task-42", config);
  const configIndex = args.indexOf("-c");

  assert.ok(configIndex >= 0, "Codex must receive an ephemeral -c configuration");
  assert.match(args[configIndex + 1], /^mcp_servers\.tasken=/);
  assert.match(args[configIndex + 1], /command/);
  assert.match(args[configIndex + 1], /args/);
  assert.match(args[configIndex + 1], /env/);
  assert.match(args.at(-1), /Task ID: task-42/);
  assert.match(args.at(-1), /start_task_workは呼ばず/);
  assert.match(args.at(-1), /Tasken側.*作業開始は記録済み/);
  assert.ok(
    !args.some((arg) => /bypass|skip-permissions|allow-all|yolo|strict-mcp-config/.test(arg)),
  );
});

test("PowerShell only evaluates a fixed script; task data is encoded JSON", () => {
  const malicious = "'; Write-Host HACK; $() & \"\n日本語";
  const args = ["--mcp-config", '{"x":"y"}', malicious, "C:\\trailing\\"];
  const script = buildWindowsConsoleScript("C:\\cli & test\\agent.exe", args, "C:\\repo; name");
  assert.ok(!script.includes(malicious));
  assert.ok(!script.includes("Invoke-Expression"));
  assert.match(script, /-WindowStyle Normal -PassThru/);
  const encoded = script.match(/FromBase64String\('([^']+)'\)/)[1];
  const payload = JSON.parse(Buffer.from(encoded, "base64").toString("utf8"));
  assert.deepEqual(payload, {
    executable: "C:\\cli & test\\agent.exe",
    commandLine: args.map(quoteWindowsArgument).join(" "),
    cwd: "C:\\repo; name",
  });
});
