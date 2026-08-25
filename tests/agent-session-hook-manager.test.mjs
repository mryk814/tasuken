import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  inspectCodexAgentSessionHooks,
  installCodexAgentSessionHooks,
  uninstallCodexAgentSessionHooks,
} from "../scripts/manage-agent-session-hooks.mjs";

async function fixture(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "tasken-hook-manager-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const codexHome = path.join(root, "codex-home");
  const sourcePath = path.join(root, "agent-session-hook.mjs");
  await fs.mkdir(codexHome, { recursive: true });
  await fs.writeFile(sourcePath, "process.stdout.write('{}\\n');\n");
  return { codexHome, sourcePath };
}

test("install preserves unrelated hooks and is idempotent", async (t) => {
  const options = await fixture(t);
  const unrelated = {
    hooks: {
      SessionStart: [{ matcher: "startup", hooks: [{ type: "command", command: "node keep-me.mjs" }] }],
      PreToolUse: [{ matcher: "*", hooks: [{ type: "command", command: "node existing.mjs" }] }],
    },
  };
  await fs.writeFile(path.join(options.codexHome, "hooks.json"), `${JSON.stringify(unrelated, null, 2)}\n`);

  const first = await installCodexAgentSessionHooks(options);
  assert.equal(first.changed, true);
  assert.ok(first.backupPath);
  const installed = await inspectCodexAgentSessionHooks(options);
  assert.equal(installed.status, "installed");
  assert.deepEqual(installed.handlerCounts, { SessionStart: 2, UserPromptSubmit: 1, Stop: 1, SessionEnd: 1 });
  const config = JSON.parse(await fs.readFile(path.join(options.codexHome, "hooks.json"), "utf8"));
  assert.equal(config.hooks.PreToolUse[0].hooks[0].command, "node existing.mjs");
  assert.equal(config.hooks.SessionStart[0].hooks[0].command, "node keep-me.mjs");
  assert.equal(config.hooks.SessionStart[1].matcher, "startup|resume|clear|compact");

  const second = await installCodexAgentSessionHooks(options);
  assert.equal(second.changed, false);
  assert.equal(second.backupPath, null);
  assert.deepEqual((await inspectCodexAgentSessionHooks(options)).handlerCounts, installed.handlerCounts);
});

test("uninstall removes only Tasken handlers and the managed bundle", async (t) => {
  const options = await fixture(t);
  await fs.writeFile(path.join(options.codexHome, "hooks.json"), JSON.stringify({
    hooks: { Stop: [{ hooks: [{ type: "command", command: "node keep-me.mjs" }] }] },
  }));
  await installCodexAgentSessionHooks(options);
  await uninstallCodexAgentSessionHooks(options);

  const inspected = await inspectCodexAgentSessionHooks(options);
  assert.equal(inspected.status, "incomplete");
  assert.equal(inspected.hookInstalled, false);
  const config = JSON.parse(await fs.readFile(path.join(options.codexHome, "hooks.json"), "utf8"));
  assert.equal(config.hooks.Stop[0].hooks[0].command, "node keep-me.mjs");
  assert.equal(config.hooks.SessionStart, undefined);
});

test("malformed config fails without replacing it", async (t) => {
  const options = await fixture(t);
  const configPath = path.join(options.codexHome, "hooks.json");
  await fs.writeFile(configPath, "{not-json");
  await assert.rejects(installCodexAgentSessionHooks(options), SyntaxError);
  assert.equal(await fs.readFile(configPath, "utf8"), "{not-json");
});
