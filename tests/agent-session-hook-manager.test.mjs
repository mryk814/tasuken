import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  inspectCodexAgentSessionHooks,
  inspectGitHubCopilotAgentSessionHooks,
  uninstallCodexAgentSessionHooks,
  uninstallGitHubCopilotAgentSessionHooks,
} from "../scripts/manage-agent-session-hooks.mjs";

const CODEX_EVENTS = ["SessionStart", "UserPromptSubmit", "Stop", "SessionEnd"];
const COPILOT_EVENTS = ["sessionStart", "userPromptSubmitted", "agentStop", "sessionEnd"];

async function fixture(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "tasken-hook-manager-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const specialDirectory = "hook home O'Brien $HOME $(whoami)";
  const codexHome = path.join(root, "codex", specialDirectory);
  const copilotHome = path.join(root, "copilot", specialDirectory);
  await fs.mkdir(codexHome, { recursive: true });
  await fs.mkdir(path.join(copilotHome, "hooks"), { recursive: true });
  return { codexHome, copilotHome };
}

const HOOK_BUNDLE = "tasken-agent-session-hook.mjs";

/**
 * 前の版の `hooks:codex:install` が各 PC に残した形を、手で置く（入れる手順はもう無い）。
 * 設定に元からあった hook は残し、Tasken の呼び出しを足す。SessionStart には再送（--flush）も入る。
 */
async function seedCodexHooks(options) {
  const configPath = path.join(options.codexHome, "hooks.json");
  const config = JSON.parse(await fs.readFile(configPath, "utf8").catch(() => '{"hooks":{}}'));
  const bundle = path.join(options.codexHome, "hooks", HOOK_BUNDLE);
  const command = (eventName, flush = "") =>
    `node "${bundle.replaceAll("\\", "/")}" --client codex --event ${eventName}${flush}`;
  const handler = (eventName, flush) => ({
    type: "command",
    command: command(eventName, flush),
    timeout: 15,
  });
  config.hooks.SessionStart = [
    ...(config.hooks.SessionStart || []),
    {
      matcher: "startup|resume|clear|compact",
      hooks: [handler("SessionStart"), handler("SessionStart", " --flush")],
    },
  ];
  for (const eventName of CODEX_EVENTS.slice(1))
    config.hooks[eventName] = [...(config.hooks[eventName] || []), { hooks: [handler(eventName)] }];
  await fs.writeFile(configPath, `${JSON.stringify(config, null, 2)}\n`);
  await fs.mkdir(path.dirname(bundle), { recursive: true });
  await fs.writeFile(bundle, "// old bundle\n");
  return { configPath, installedHookPath: bundle };
}

async function seedCopilotHooks(options) {
  const configPath = path.join(options.copilotHome, "hooks", "tasken-agent-session.json");
  const config = JSON.parse(
    await fs.readFile(configPath, "utf8").catch(() => '{"version":1,"hooks":{}}'),
  );
  const bundle = path.join(options.copilotHome, "hooks", HOOK_BUNDLE);
  const handler = (eventName, flush = "") => {
    const line = `node '${bundle.replaceAll("\\", "/")}' --client github_copilot --event ${eventName}${flush}`;
    return { type: "command", bash: line, powershell: line, timeoutSec: 15 };
  };
  config.hooks.sessionStart = [
    ...(config.hooks.sessionStart || []),
    handler("sessionStart"),
    handler("sessionStart", " --flush"),
  ];
  for (const eventName of COPILOT_EVENTS.slice(1))
    config.hooks[eventName] = [...(config.hooks[eventName] || []), handler(eventName)];
  await fs.writeFile(configPath, `${JSON.stringify(config, null, 2)}\n`);
  await fs.writeFile(bundle, "// old bundle\n");
  return { configPath, installedHookPath: bundle };
}

test("Codex uninstall removes only Tasken handlers and the managed bundle", async (t) => {
  const options = await fixture(t);
  await fs.writeFile(
    path.join(options.codexHome, "hooks.json"),
    JSON.stringify({
      hooks: { Stop: [{ hooks: [{ type: "command", command: "node keep-me.mjs" }] }] },
    }),
  );
  await seedCodexHooks(options);
  const before = await inspectCodexAgentSessionHooks(options);
  assert.equal(before.status, "present");
  assert.deepEqual(before.handlerCounts, {
    SessionStart: 2,
    UserPromptSubmit: 1,
    Stop: 1,
    SessionEnd: 1,
  });
  const uninstalled = await uninstallCodexAgentSessionHooks(options);
  assert.equal(uninstalled.changed, true);
  assert.ok(uninstalled.backupPath, "変える前の設定を控えに取る");

  const inspected = await inspectCodexAgentSessionHooks(options);
  assert.equal(inspected.status, "absent");
  assert.deepEqual(Object.values(inspected.handlerCounts), [0, 0, 0, 0]);
  assert.equal(inspected.hookInstalled, false);
  const config = JSON.parse(await fs.readFile(path.join(options.codexHome, "hooks.json"), "utf8"));
  assert.equal(config.hooks.Stop[0].hooks[0].command, "node keep-me.mjs");
  assert.equal(config.hooks.SessionStart, undefined);
  // 2 回目は何も変えない。
  const again = await uninstallCodexAgentSessionHooks(options);
  assert.deepEqual([again.changed, again.backupPath], [false, null]);
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
  await seedCopilotHooks(options);
  assert.equal((await inspectGitHubCopilotAgentSessionHooks(options)).status, "present");
  await uninstallGitHubCopilotAgentSessionHooks(options);

  const inspected = await inspectGitHubCopilotAgentSessionHooks(options);
  assert.equal(inspected.status, "absent");
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
  const installed = await seedCopilotHooks(options);
  const uninstalled = await uninstallGitHubCopilotAgentSessionHooks(options);
  assert.equal(uninstalled.configRemoved, true);
  assert.ok(uninstalled.backupPath);
  await assert.rejects(fs.stat(installed.configPath), { code: "ENOENT" });
  await assert.rejects(fs.stat(installed.installedHookPath), { code: "ENOENT" });
});

test("malformed configs fail without replacing them or removing the bundle", async (t) => {
  const options = await fixture(t);
  const codexConfigPath = path.join(options.codexHome, "hooks.json");
  await fs.writeFile(codexConfigPath, "{not-json");
  const codexBundle = path.join(options.codexHome, "hooks", HOOK_BUNDLE);
  await fs.mkdir(path.dirname(codexBundle), { recursive: true });
  await fs.writeFile(codexBundle, "// old bundle\n");
  await assert.rejects(uninstallCodexAgentSessionHooks(options), SyntaxError);
  assert.equal(await fs.readFile(codexBundle, "utf8"), "// old bundle\n");
  assert.equal(await fs.readFile(codexConfigPath, "utf8"), "{not-json");

  const copilotConfigPath = path.join(options.copilotHome, "hooks", "tasken-agent-session.json");
  await fs.writeFile(
    copilotConfigPath,
    JSON.stringify({ version: 1, hooks: { sessionStart: {} } }),
  );
  await assert.rejects(
    uninstallGitHubCopilotAgentSessionHooks(options),
    /event sessionStart must be an array/,
  );
  assert.deepEqual(JSON.parse(await fs.readFile(copilotConfigPath, "utf8")), {
    version: 1,
    hooks: { sessionStart: {} },
  });
});
