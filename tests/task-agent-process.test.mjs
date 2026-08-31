import assert from "node:assert/strict";
import test from "node:test";
import { build } from "esbuild";

const bundled = await build({
  entryPoints: ["src/main/services/taskAgentProcess.ts"],
  bundle: true,
  platform: "node",
  format: "esm",
  write: false,
});
const { quoteWindowsArgument, buildTaskAgentArguments, buildWindowsConsoleScript } = await import(
  `data:text/javascript;base64,${Buffer.from(bundled.outputFiles[0].text).toString("base64")}`
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
    assert.match(args.at(-1), /人間の承認や完了を代行しない/);
    assert.ok(
      !args.some((arg) => /bypass|skip-permissions|allow-all|yolo|strict-mcp-config/.test(arg)),
    );
    assert.equal(args[0], id === "claude_code" ? "--mcp-config" : "--additional-mcp-config");
    if (id === "github_copilot") assert.ok(args.includes("-i"));
  }
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
