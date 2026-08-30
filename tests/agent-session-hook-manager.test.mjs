import assert from "node:assert/strict";
import { exec as execCallback } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { promisify } from "node:util";

import {
  inspectCodexAgentSessionHooks,
  inspectGitHubCopilotAgentSessionHooks,
  installCodexAgentSessionHooks,
  installGitHubCopilotAgentSessionHooks,
  uninstallCodexAgentSessionHooks,
  uninstallGitHubCopilotAgentSessionHooks,
} from "../scripts/manage-agent-session-hooks.mjs";

const CODEX_EVENTS = ["SessionStart", "UserPromptSubmit", "Stop", "SessionEnd"];
const COPILOT_EVENTS = ["sessionStart", "userPromptSubmitted", "agentStop", "sessionEnd"];
const exec = promisify(execCallback);

async function fixture(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "tasken-hook-manager-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const specialDirectory = "hook home O'Brien $HOME $(whoami)";
  const codexHome = path.join(root, "codex", specialDirectory);
  const copilotHome = path.join(root, "copilot", specialDirectory);
  const sourcePath = path.join(root, "agent-session-hook.mjs");
  await fs.mkdir(codexHome, { recursive: true });
  await fs.mkdir(path.join(copilotHome, "hooks"), { recursive: true });
  await fs.writeFile(
    sourcePath,
    "process.stdout.write(`${JSON.stringify(process.argv.slice(2))}\\n`);\n",
  );
  return { codexHome, copilotHome, sourcePath };
}

function codexHandlers(config, eventName) {
  return (config.hooks[eventName] || [])
    .flatMap((entry) => entry.hooks || [])
    .filter((handler) => handler.command?.includes("tasken-agent-session-hook.mjs"));
}

function copilotHandlers(config, eventName) {
  return (config.hooks[eventName] || []).filter((handler) =>
    handler.bash?.includes("tasken-agent-session-hook.mjs"),
  );
}

function expectedBashPath(filePath) {
  const normalized = filePath.replaceAll("\\", "/");
  return `'${normalized.replaceAll("'", `'"'"'`)}'`;
}

function expectedPowerShellPath(filePath) {
  const normalized = filePath.replaceAll("\\", "/");
  return `'${normalized.replaceAll("'", "''")}'`;
}

test("Codex install preserves unrelated hooks, declares every event, and is idempotent", async (t) => {
  const options = await fixture(t);
  const unrelated = {
    hooks: {
      SessionStart: [
        { matcher: "startup", hooks: [{ type: "command", command: "node keep-me.mjs" }] },
      ],
      PreToolUse: [{ matcher: "*", hooks: [{ type: "command", command: "node existing.mjs" }] }],
    },
  };
  await fs.writeFile(
    path.join(options.codexHome, "hooks.json"),
    `${JSON.stringify(unrelated, null, 2)}\n`,
  );

  const first = await installCodexAgentSessionHooks(options);
  assert.equal(first.changed, true);
  assert.equal(first.hookChanged, true);
  assert.ok(first.backupPath);
  const installed = await inspectCodexAgentSessionHooks(options);
  assert.equal(installed.status, "installed");
  assert.deepEqual(installed.handlerCounts, {
    SessionStart: 2,
    UserPromptSubmit: 1,
    Stop: 1,
    SessionEnd: 1,
  });
  const config = JSON.parse(await fs.readFile(path.join(options.codexHome, "hooks.json"), "utf8"));
  assert.equal(config.hooks.PreToolUse[0].hooks[0].command, "node existing.mjs");
  assert.equal(config.hooks.SessionStart[0].hooks[0].command, "node keep-me.mjs");
  assert.equal(config.hooks.SessionStart[1].matcher, "startup|resume|clear|compact");
  for (const eventName of CODEX_EVENTS) {
    const handlers = codexHandlers(config, eventName);
    assert.equal(handlers.length, eventName === "SessionStart" ? 2 : 1);
    for (const handler of handlers) {
      assert.match(handler.command, /--client codex(?:\s|$)/);
      assert.ok(handler.command.includes(`--event ${eventName}`));
      assert.equal(handler.timeout, 15);
    }
  }
  const codexTaskenHandlers = CODEX_EVENTS.flatMap((eventName) => codexHandlers(config, eventName));
  const codexFlushHandlers = codexTaskenHandlers.filter((handler) =>
    handler.command.includes(" --flush"),
  );
  assert.equal(codexFlushHandlers.length, 1);
  assert.ok(codexFlushHandlers[0].command.includes("--event SessionStart --flush"));
  const expectedCodexPath = `"${first.installedHookPath.replaceAll("\\", "/")}"`;
  assert.ok(
    codexTaskenHandlers.every((handler) =>
      handler.command.startsWith(`node ${expectedCodexPath} `),
    ),
  );

  const second = await installCodexAgentSessionHooks(options);
  assert.equal(second.changed, false);
  assert.equal(second.hookChanged, false);
  assert.equal(second.backupPath, null);
  assert.deepEqual(
    (await inspectCodexAgentSessionHooks(options)).handlerCounts,
    installed.handlerCounts,
  );
});

test("Codex uninstall removes only Tasken handlers and the managed bundle", async (t) => {
  const options = await fixture(t);
  await fs.writeFile(
    path.join(options.codexHome, "hooks.json"),
    JSON.stringify({
      hooks: { Stop: [{ hooks: [{ type: "command", command: "node keep-me.mjs" }] }] },
    }),
  );
  await installCodexAgentSessionHooks(options);
  await uninstallCodexAgentSessionHooks(options);

  const inspected = await inspectCodexAgentSessionHooks(options);
  assert.equal(inspected.status, "incomplete");
  assert.equal(inspected.hookInstalled, false);
  const config = JSON.parse(await fs.readFile(path.join(options.codexHome, "hooks.json"), "utf8"));
  assert.equal(config.hooks.Stop[0].hooks[0].command, "node keep-me.mjs");
  assert.equal(config.hooks.SessionStart, undefined);
});

test("GitHub Copilot install owns one official user hook file and preserves unrelated entries", async (t) => {
  const options = await fixture(t);
  const configPath = path.join(options.copilotHome, "hooks", "tasken-agent-session.json");
  const unrelated = {
    version: 1,
    disableAllHooks: false,
    hooks: {
      agentStop: [{ type: "command", bash: "echo keep", powershell: "Write-Output keep" }],
      preToolUse: [{ type: "command", bash: "./policy.sh", powershell: ".\\policy.ps1" }],
    },
  };
  await fs.writeFile(configPath, `${JSON.stringify(unrelated, null, 2)}\n`);

  const first = await installGitHubCopilotAgentSessionHooks(options);
  assert.equal(first.configPath, configPath);
  assert.equal(first.changed, true);
  assert.equal(first.hookChanged, true);
  assert.ok(first.backupPath);
  const installed = await inspectGitHubCopilotAgentSessionHooks(options);
  assert.equal(installed.status, "installed");
  assert.deepEqual(installed.handlerCounts, {
    sessionStart: 2,
    userPromptSubmitted: 1,
    agentStop: 1,
    sessionEnd: 1,
  });

  const config = JSON.parse(await fs.readFile(configPath, "utf8"));
  assert.equal(config.version, 1);
  assert.equal(config.disableAllHooks, false);
  assert.equal(config.hooks.preToolUse[0].bash, "./policy.sh");
  assert.equal(config.hooks.agentStop[0].bash, "echo keep");
  for (const eventName of COPILOT_EVENTS) {
    const handlers = copilotHandlers(config, eventName);
    assert.equal(handlers.length, eventName === "sessionStart" ? 2 : 1);
    for (const handler of handlers) {
      assert.equal(handler.type, "command");
      assert.ok(handler.bash.startsWith(`node ${expectedBashPath(first.installedHookPath)} `));
      assert.ok(
        handler.powershell.startsWith(`node ${expectedPowerShellPath(first.installedHookPath)} `),
      );
      assert.match(handler.bash, /--client github_copilot(?:\s|$)/);
      assert.match(handler.powershell, /--client github_copilot(?:\s|$)/);
      assert.ok(handler.bash.includes(`--event ${eventName}`));
      assert.ok(handler.powershell.includes(`--event ${eventName}`));
      assert.equal(handler.timeoutSec, 15);
    }
  }
  const copilotTaskenHandlers = COPILOT_EVENTS.flatMap((eventName) =>
    copilotHandlers(config, eventName),
  );
  const copilotFlushHandlers = copilotTaskenHandlers.filter((handler) =>
    handler.bash.includes(" --flush"),
  );
  assert.equal(copilotFlushHandlers.length, 1);
  assert.ok(copilotFlushHandlers[0].bash.includes("--event sessionStart --flush"));

  const second = await installGitHubCopilotAgentSessionHooks(options);
  assert.equal(second.changed, false);
  assert.equal(second.hookChanged, false);
  assert.equal(second.backupPath, null);
  assert.deepEqual(
    (await inspectGitHubCopilotAgentSessionHooks(options)).handlerCounts,
    installed.handlerCounts,
  );
  assert.equal(
    (await fs.readdir(path.dirname(configPath))).some((name) => name.endsWith(".tmp")),
    false,
  );
});

test("GitHub Copilot uninstall preserves unrelated config and removes only Tasken files", async (t) => {
  const options = await fixture(t);
  const configPath = path.join(options.copilotHome, "hooks", "tasken-agent-session.json");
  await fs.writeFile(
    configPath,
    JSON.stringify({
      version: 1,
      hooks: {
        agentStop: [{ type: "command", bash: "echo keep", powershell: "Write-Output keep" }],
      },
    }),
  );
  await installGitHubCopilotAgentSessionHooks(options);
  await uninstallGitHubCopilotAgentSessionHooks(options);

  const inspected = await inspectGitHubCopilotAgentSessionHooks(options);
  assert.equal(inspected.status, "incomplete");
  assert.equal(inspected.hookInstalled, false);
  const config = JSON.parse(await fs.readFile(configPath, "utf8"));
  assert.deepEqual(config, {
    version: 1,
    hooks: {
      agentStop: [{ type: "command", bash: "echo keep", powershell: "Write-Output keep" }],
    },
  });
});

test("GitHub Copilot uninstall deletes an otherwise empty owned config", async (t) => {
  const options = await fixture(t);
  const installed = await installGitHubCopilotAgentSessionHooks(options);
  const uninstalled = await uninstallGitHubCopilotAgentSessionHooks(options);
  assert.equal(uninstalled.configRemoved, true);
  assert.ok(uninstalled.backupPath);
  await assert.rejects(fs.stat(installed.configPath), { code: "ENOENT" });
  await assert.rejects(fs.stat(installed.installedHookPath), { code: "ENOENT" });
});

test("generated platform command passes a path with shell metacharacters literally", async (t) => {
  const options = await fixture(t);
  const installed = await installGitHubCopilotAgentSessionHooks(options);
  const config = JSON.parse(await fs.readFile(installed.configPath, "utf8"));
  const handler = copilotHandlers(config, "sessionEnd")[0];
  const command = process.platform === "win32" ? handler.powershell : handler.bash;
  const shell = process.platform === "win32" ? "powershell.exe" : "/bin/bash";

  const result = await exec(command, { shell });
  assert.deepEqual(JSON.parse(result.stdout.trim()), [
    "--client",
    "github_copilot",
    "--event",
    "sessionEnd",
  ]);
});

test("malformed configs fail without replacing them or installing the bundle", async (t) => {
  const options = await fixture(t);
  const codexConfigPath = path.join(options.codexHome, "hooks.json");
  await fs.writeFile(codexConfigPath, "{not-json");
  await assert.rejects(installCodexAgentSessionHooks(options), SyntaxError);
  assert.equal(await fs.readFile(codexConfigPath, "utf8"), "{not-json");

  const copilotConfigPath = path.join(options.copilotHome, "hooks", "tasken-agent-session.json");
  await fs.writeFile(
    copilotConfigPath,
    JSON.stringify({ version: 1, hooks: { sessionStart: {} } }),
  );
  await assert.rejects(
    installGitHubCopilotAgentSessionHooks(options),
    /event sessionStart must be an array/,
  );
  assert.deepEqual(JSON.parse(await fs.readFile(copilotConfigPath, "utf8")), {
    version: 1,
    hooks: { sessionStart: {} },
  });
  await assert.rejects(
    fs.stat(path.join(options.copilotHome, "hooks", "tasken-agent-session-hook.mjs")),
    { code: "ENOENT" },
  );
});
