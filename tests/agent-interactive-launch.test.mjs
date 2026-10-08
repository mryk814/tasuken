import assert from "node:assert/strict";
import test from "node:test";
import {
  buildTaskAgentArguments,
  buildWindowsConsoleScript,
} from "../src/main/services/taskAgentProcess.ts";
import { validateAgentLaunchTask } from "../src/shared/agentLaunch.ts";
import { launchAgent } from "../src/main/services/agentLaunchService.ts";
import { mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { tmpdir } from "node:os";
import path from "node:path";
const execFileAsync = promisify(execFile);
const workAttemptId = "e95a7cef-f43d-4b5a-a43f-e3c4c74aaf23";

test(
  "Windows実プロセスへ日本語・引用符・改行を含むargvをそのまま渡す",
  { skip: process.platform !== "win32" },
  async () => {
    const cwd = await mkdtemp(path.join(tmpdir(), "Tasken 日本語 & 空白-"));
    const executable = path.join(cwd, "argv fixture.exe");
    const source = path.join(cwd, "Fixture.cs");
    const output = path.join(cwd, "received.txt");
    const args = [
      "日本語 空白",
      'quote"and\\"slashes',
      "trailing\\",
      "$(Write-Output INJECTED); & echo bad",
      "line one\nline two",
      "",
    ];
    try {
      await writeFile(
        source,
        "using System; using System.IO; using System.Text; using System.Threading; class Fixture { static void Main(string[] args) { string[] lines = new string[args.Length]; lines[0] = Convert.ToBase64String(Encoding.UTF8.GetBytes(Environment.CurrentDirectory)); for (int i = 1; i < args.Length; i++) lines[i] = Convert.ToBase64String(Encoding.UTF8.GetBytes(args[i])); File.WriteAllLines(args[0], lines, new UTF8Encoding(false)); Thread.Sleep(1000); } }",
        "utf8",
      );
      const windows = process.env.SystemRoot || "C:\\Windows";
      await execFileAsync(
        path.join(windows, "Microsoft.NET/Framework64/v4.0.30319/csc.exe"),
        ["/nologo", `/out:${executable}`, source],
        { windowsHide: true, timeout: 15_000 },
      );
      const script = buildWindowsConsoleScript(executable, [output, ...args], cwd);
      await execFileAsync(
        path.join(windows, "System32/WindowsPowerShell/v1.0/powershell.exe"),
        [
          "-NoProfile",
          "-NonInteractive",
          "-EncodedCommand",
          Buffer.from(script, "utf16le").toString("base64"),
        ],
        { shell: false, windowsHide: true, timeout: 10_000 },
      );
      const actual = (await readFile(output, "utf8"))
        .replace(/\r\n/g, "\n")
        .split("\n")
        .slice(0, -1)
        .map((value) => Buffer.from(value, "base64").toString("utf8"));
      // Windows expands a TEMP path such as RUNNER~1 to its long directory name.
      assert.deepEqual(actual, [await realpath(cwd), ...args]);
    } finally {
      // The benign fixture is the only child created here; let it finish before cleanup.
      await new Promise((resolve) => setTimeout(resolve, 1100));
      await rm(cwd, { recursive: true, force: true });
    }
  },
);

test("対話CLIへ対象IDとMCPを渡し、承認を迂回せず着手はAIに任せる", () => {
  const config = JSON.stringify({
    mcpServers: { tasken: { command: "node", args: ["C:/tasken/server.mjs"], env: {} } },
  });
  for (const provider of ["claude_code", "codex"]) {
    const args = buildTaskAgentArguments(provider, "test-task", config, workAttemptId);
    assert.ok(args.at(-1).includes(`work_attempt_id: ${workAttemptId}`));
    assert.match(args.at(-1), /start_task_work/);
    assert.match(args.at(-1), /質問.*CLI/);
    assert.doesNotMatch(
      args.join(" "),
      /skip-permissions|dangerously|--full-auto|--yolo|開始は記録済み/,
    );
    assert.ok(!args.includes("-p") && !args.includes("exec"));
  }
});
test("パスと引数に含まれるPowerShell構文をコードへ展開しない", () => {
  const hostile = 'C:/work/$(Write-Output secret); & "test"';
  const script = buildWindowsConsoleScript("C:/cli.exe", [hostile], hostile);
  assert.ok(!script.includes(hostile));
  assert.match(script, /FromBase64String/);
});
test("委任前・作業中・完了済み・古いversionは起動しない", () => {
  const task = {
    id: "t",
    version: 3,
    state: "todo",
    intended_executor: "ai_agent",
    work_state: "ready_for_agent",
    work_attempt_id: workAttemptId,
  };
  assert.doesNotThrow(() => validateAgentLaunchTask(task, 3));
  for (const changed of [
    { version: 4 },
    { state: "done" },
    { work_state: "in_progress" },
    { intended_executor: "self" },
    { deleted_at: "now" },
    { work_attempt_id: undefined },
    { work_attempt_id: "invalid" },
  ]) {
    assert.throws(() => validateAgentLaunchTask({ ...task, ...changed }, 3));
  }
});

test("起動成功・失敗のどちらでもTaskの着手状態を書き換えない", async () => {
  const cwd = await mkdtemp(path.join(tmpdir(), "tasken-agent-launch-"));
  const task = {
    id: "t",
    version: 3,
    state: "todo",
    intended_executor: "ai_agent",
    work_state: "ready_for_agent",
    ai_visibility: ["coding_agent"],
    work_attempt_id: workAttemptId,
  };
  const repository = { get: () => task, getPreference: () => ["coding_agent"] };
  const request = { taskId: "t", expectedVersion: 3, clientId: "codex", cwd };
  const before = JSON.stringify(task);
  try {
    let called = 0;
    await launchAgent(request, repository, "{}", cwd, async (input) => {
      called++;
      assert.equal(input.taskId, "t");
      assert.equal(input.userDataPath, cwd);
      assert.equal(input.workAttemptId, workAttemptId);
    });
    assert.equal(called, 1);
    assert.equal(JSON.stringify(task), before);
    await assert.rejects(
      launchAgent(request, repository, "{}", cwd, async () => {
        throw new Error("stub launch failed");
      }),
      /stub launch failed/,
    );
    assert.equal(JSON.stringify(task), before);
    await assert.rejects(
      launchAgent({ ...request, expectedVersion: 2 }, repository, "{}", cwd, async () => {
        called++;
      }),
      /更新/,
    );
    assert.equal(called, 1);
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});

test("別ウィンドウから同じTaskへ重なる起動を拒否し、失敗後は再試行できる", async () => {
  const cwd = await mkdtemp(path.join(tmpdir(), "tasken-agent-concurrent-"));
  const task = {
    id: "concurrent",
    version: 1,
    state: "todo",
    intended_executor: "ai_agent",
    work_state: "ready_for_agent",
    ai_visibility: ["coding_agent"],
    work_attempt_id: workAttemptId,
  };
  const repository = { get: () => task, getPreference: () => ["coding_agent"] };
  const request = { taskId: task.id, expectedVersion: 1, clientId: "codex", cwd };
  let release;
  let observed;
  const started = new Promise((resolve) => {
    observed = resolve;
  });
  const hold = new Promise((resolve) => {
    release = resolve;
  });
  const first = launchAgent(request, repository, "{}", cwd, async () => {
    observed();
    await hold;
  });
  try {
    await started;
    await assert.rejects(
      launchAgent(request, repository, "{}", cwd, async () => {}),
      /起動中/,
    );
    release();
    await first;
    await assert.rejects(
      launchAgent(request, repository, "{}", cwd, async () => {
        throw new Error("failure");
      }),
      /failure/,
    );
    await launchAgent(request, repository, "{}", cwd, async () => {});
  } finally {
    release();
    await first;
    await rm(cwd, { recursive: true, force: true });
  }
});
