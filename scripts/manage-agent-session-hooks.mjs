#!/usr/bin/env node
import crypto from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const TASKEN_HOOK_FILE = "tasken-agent-session-hook.mjs";
const COPILOT_CONFIG_FILE = "tasken-agent-session.json";
const SOURCE_HOOK_FILE = "agent-session-hook.mjs";
const CODEX_EVENTS = ["SessionStart", "UserPromptSubmit", "Stop", "SessionEnd"];
const COPILOT_EVENTS = ["sessionStart", "userPromptSubmitted", "agentStop", "sessionEnd"];
const HOOK_TIMEOUT_SECONDS = 15;

function quoteForBash(value) {
  return `'${value.replaceAll("'", `'"'"'`)}'`;
}

function quoteForPowerShell(value) {
  return `'${value.replaceAll("'", "''")}'`;
}

function commandFor(hookPath, client, eventName, options = {}) {
  const normalized = hookPath.replaceAll("\\", "/");
  const quotedPath =
    options.shell === "powershell"
      ? quoteForPowerShell(normalized)
      : options.shell === "bash"
        ? quoteForBash(normalized)
        : `"${normalized}"`;
  return `node ${quotedPath} --client ${client} --event ${eventName}${options.flush ? " --flush" : ""}`;
}

function handlerCommands(handler) {
  return [handler?.command, handler?.bash, handler?.powershell].filter(
    (command) => typeof command === "string",
  );
}

function isTaskenHandler(handler, client) {
  return (
    handler?.type === "command" &&
    handlerCommands(handler).some(
      (command) => command.includes(TASKEN_HOOK_FILE) && command.includes(`--client ${client}`),
    )
  );
}

function isTaskenHandlerForEvent(handler, client, eventName) {
  return (
    isTaskenHandler(handler, client) &&
    handlerCommands(handler).some((command) => command.includes(`--event ${eventName}`))
  );
}

function withoutCodexTaskenHandlers(config) {
  const next = structuredClone(config);
  next.hooks ||= {};
  for (const eventName of CODEX_EVENTS) {
    const entries = Array.isArray(next.hooks[eventName]) ? next.hooks[eventName] : [];
    const filtered = entries
      .map((entry) => ({
        ...entry,
        hooks: Array.isArray(entry?.hooks)
          ? entry.hooks.filter((handler) => !isTaskenHandler(handler, "codex"))
          : [],
      }))
      .filter((entry) => entry.hooks.length > 0);
    if (filtered.length > 0) next.hooks[eventName] = filtered;
    else delete next.hooks[eventName];
  }
  return next;
}

function withCodexTaskenHandlers(config, installedHookPath) {
  const next = withoutCodexTaskenHandlers(config);
  next.hooks.SessionStart = [
    ...(next.hooks.SessionStart || []),
    {
      matcher: "startup|resume|clear|compact",
      hooks: [
        {
          type: "command",
          command: commandFor(installedHookPath, "codex", "SessionStart"),
          timeout: HOOK_TIMEOUT_SECONDS,
        },
        {
          type: "command",
          command: commandFor(installedHookPath, "codex", "SessionStart", { flush: true }),
          timeout: HOOK_TIMEOUT_SECONDS,
        },
      ],
    },
  ];
  for (const eventName of CODEX_EVENTS.slice(1)) {
    next.hooks[eventName] = [
      ...(next.hooks[eventName] || []),
      {
        hooks: [
          {
            type: "command",
            command: commandFor(installedHookPath, "codex", eventName),
            timeout: HOOK_TIMEOUT_SECONDS,
          },
        ],
      },
    ];
  }
  return next;
}

function withoutCopilotTaskenHandlers(config) {
  const next = structuredClone(config);
  next.hooks ||= {};
  for (const eventName of COPILOT_EVENTS) {
    const entries = next.hooks[eventName] || [];
    const filtered = entries.filter((handler) => !isTaskenHandler(handler, "github_copilot"));
    if (filtered.length > 0) next.hooks[eventName] = filtered;
    else delete next.hooks[eventName];
  }
  return next;
}

function copilotHandler(installedHookPath, eventName, options = {}) {
  return {
    type: "command",
    bash: commandFor(installedHookPath, "github_copilot", eventName, { ...options, shell: "bash" }),
    powershell: commandFor(installedHookPath, "github_copilot", eventName, {
      ...options,
      shell: "powershell",
    }),
    timeoutSec: HOOK_TIMEOUT_SECONDS,
  };
}

function withCopilotTaskenHandlers(config, installedHookPath) {
  const next = withoutCopilotTaskenHandlers(config);
  next.version = 1;
  next.hooks.sessionStart = [
    ...(next.hooks.sessionStart || []),
    copilotHandler(installedHookPath, "sessionStart"),
    copilotHandler(installedHookPath, "sessionStart", { flush: true }),
  ];
  for (const eventName of COPILOT_EVENTS.slice(1)) {
    next.hooks[eventName] = [
      ...(next.hooks[eventName] || []),
      copilotHandler(installedHookPath, eventName),
    ];
  }
  return next;
}

async function assertRegularOrMissing(filePath) {
  try {
    const stat = await fs.lstat(filePath);
    if (stat.isSymbolicLink() || !stat.isFile()) {
      throw new Error(`Refusing to replace non-regular file: ${filePath}`);
    }
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }
}

function assertConfigObject(parsed, label) {
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error(`${label} hooks config must be a JSON object.`);
  }
  if (parsed.hooks != null && (typeof parsed.hooks !== "object" || Array.isArray(parsed.hooks))) {
    throw new Error(`${label} hooks config hooks field must be an object.`);
  }
}

async function readCodexConfig(configPath) {
  try {
    const parsed = JSON.parse(await fs.readFile(configPath, "utf8"));
    assertConfigObject(parsed, "Codex");
    return parsed;
  } catch (error) {
    if (error?.code === "ENOENT") return { hooks: {} };
    throw error;
  }
}

async function readCopilotConfig(configPath) {
  try {
    const parsed = JSON.parse(await fs.readFile(configPath, "utf8"));
    assertConfigObject(parsed, "GitHub Copilot");
    if (parsed.version !== 1) {
      throw new Error("GitHub Copilot hooks config version must be 1.");
    }
    for (const [eventName, entries] of Object.entries(parsed.hooks || {})) {
      if (!Array.isArray(entries)) {
        throw new Error(`GitHub Copilot hooks config event ${eventName} must be an array.`);
      }
    }
    return parsed;
  } catch (error) {
    if (error?.code === "ENOENT") return { version: 1, hooks: {} };
    throw error;
  }
}

async function writeConfig(configPath, currentText, config) {
  const nextText = `${JSON.stringify(config, null, 2)}\n`;
  if (currentText === nextText) return { changed: false, backupPath: null };
  await fs.mkdir(path.dirname(configPath), { recursive: true });
  await assertRegularOrMissing(configPath);
  let backupPath = null;
  if (currentText != null) {
    backupPath = `${configPath}.tasken-backup-${new Date().toISOString().replaceAll(":", "-")}`;
    await fs.copyFile(configPath, backupPath);
  }
  const temporaryPath = `${configPath}.tasken-${process.pid}.tmp`;
  await fs.writeFile(temporaryPath, nextText, { encoding: "utf8", mode: 0o600 });
  await fs.rename(temporaryPath, configPath);
  return { changed: true, backupPath };
}

async function removeOwnedConfig(configPath, currentText) {
  if (currentText == null) return { changed: false, backupPath: null, configRemoved: false };
  await assertRegularOrMissing(configPath);
  const backupPath = `${configPath}.tasken-backup-${new Date().toISOString().replaceAll(":", "-")}`;
  await fs.copyFile(configPath, backupPath);
  await fs.unlink(configPath);
  return { changed: true, backupPath, configRemoved: true };
}

async function copyHook(sourcePath, installedHookPath) {
  await assertRegularOrMissing(sourcePath);
  await assertRegularOrMissing(installedHookPath);
  const bytes = await fs.readFile(sourcePath);
  const sha256 = crypto.createHash("sha256").update(bytes).digest("hex");
  const currentBytes = await fs.readFile(installedHookPath).catch((error) => {
    if (error?.code === "ENOENT") return null;
    throw error;
  });
  if (currentBytes?.equals(bytes)) return { sha256, hookChanged: false };
  await fs.mkdir(path.dirname(installedHookPath), { recursive: true });
  const temporaryPath = `${installedHookPath}.tasken-${process.pid}.tmp`;
  await fs.writeFile(temporaryPath, bytes, { mode: 0o700 });
  await fs.rename(temporaryPath, installedHookPath);
  return { sha256, hookChanged: true };
}

function sourcePathFor(options = {}) {
  const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
  return path.resolve(
    options.sourcePath || path.join(scriptDirectory, "..", "mcp-dist", SOURCE_HOOK_FILE),
  );
}

function codexPathsFor(options = {}) {
  const codexHome = path.resolve(
    options.codexHome || process.env.CODEX_HOME || path.join(os.homedir(), ".codex"),
  );
  return {
    codexHome,
    configPath: path.join(codexHome, "hooks.json"),
    installedHookPath: path.join(codexHome, "hooks", TASKEN_HOOK_FILE),
    sourcePath: sourcePathFor(options),
  };
}

function copilotPathsFor(options = {}) {
  const copilotHome = path.resolve(
    options.copilotHome || process.env.COPILOT_HOME || path.join(os.homedir(), ".copilot"),
  );
  const hooksDirectory = path.join(copilotHome, "hooks");
  return {
    copilotHome,
    configPath: path.join(hooksDirectory, COPILOT_CONFIG_FILE),
    installedHookPath: path.join(hooksDirectory, TASKEN_HOOK_FILE),
    sourcePath: sourcePathFor(options),
  };
}

export async function installCodexAgentSessionHooks(options = {}) {
  const paths = codexPathsFor(options);
  const currentText = await fs.readFile(paths.configPath, "utf8").catch((error) => {
    if (error?.code === "ENOENT") return null;
    throw error;
  });
  const config = await readCodexConfig(paths.configPath);
  const hook = await copyHook(paths.sourcePath, paths.installedHookPath);
  const write = await writeConfig(
    paths.configPath,
    currentText,
    withCodexTaskenHandlers(config, paths.installedHookPath),
  );
  return { status: "installed", client: "codex", ...paths, ...hook, ...write };
}

export async function uninstallCodexAgentSessionHooks(options = {}) {
  const paths = codexPathsFor(options);
  const currentText = await fs.readFile(paths.configPath, "utf8").catch((error) => {
    if (error?.code === "ENOENT") return null;
    throw error;
  });
  const config = await readCodexConfig(paths.configPath);
  const write = await writeConfig(
    paths.configPath,
    currentText,
    withoutCodexTaskenHandlers(config),
  );
  await assertRegularOrMissing(paths.installedHookPath);
  await fs.unlink(paths.installedHookPath).catch((error) => {
    if (error?.code !== "ENOENT") throw error;
  });
  return { status: "uninstalled", client: "codex", ...paths, ...write };
}

export async function inspectCodexAgentSessionHooks(options = {}) {
  const paths = codexPathsFor(options);
  const config = await readCodexConfig(paths.configPath);
  const handlerCounts = Object.fromEntries(
    CODEX_EVENTS.map((eventName) => [
      eventName,
      (config.hooks?.[eventName] || [])
        .flatMap((entry) => entry.hooks || [])
        .filter((handler) => isTaskenHandlerForEvent(handler, "codex", eventName)).length,
    ]),
  );
  const hookInstalled = await fs
    .stat(paths.installedHookPath)
    .then((stat) => stat.isFile())
    .catch((error) => {
      if (error?.code === "ENOENT") return false;
      throw error;
    });
  return {
    status:
      hookInstalled &&
      handlerCounts.SessionStart === 2 &&
      CODEX_EVENTS.slice(1).every((eventName) => handlerCounts[eventName] === 1)
        ? "installed"
        : "incomplete",
    client: "codex",
    ...paths,
    hookInstalled,
    handlerCounts,
  };
}

export async function installGitHubCopilotAgentSessionHooks(options = {}) {
  const paths = copilotPathsFor(options);
  const currentText = await fs.readFile(paths.configPath, "utf8").catch((error) => {
    if (error?.code === "ENOENT") return null;
    throw error;
  });
  const config = await readCopilotConfig(paths.configPath);
  const hook = await copyHook(paths.sourcePath, paths.installedHookPath);
  const write = await writeConfig(
    paths.configPath,
    currentText,
    withCopilotTaskenHandlers(config, paths.installedHookPath),
  );
  return { status: "installed", client: "github_copilot", ...paths, ...hook, ...write };
}

export async function uninstallGitHubCopilotAgentSessionHooks(options = {}) {
  const paths = copilotPathsFor(options);
  const currentText = await fs.readFile(paths.configPath, "utf8").catch((error) => {
    if (error?.code === "ENOENT") return null;
    throw error;
  });
  const config = await readCopilotConfig(paths.configPath);
  const withoutTasken = withoutCopilotTaskenHandlers(config);
  const hasUnrelatedConfig =
    Object.keys(withoutTasken).some((key) => key !== "version" && key !== "hooks") ||
    Object.keys(withoutTasken.hooks || {}).length > 0;
  const write = hasUnrelatedConfig
    ? await writeConfig(paths.configPath, currentText, withoutTasken)
    : await removeOwnedConfig(paths.configPath, currentText);
  await assertRegularOrMissing(paths.installedHookPath);
  await fs.unlink(paths.installedHookPath).catch((error) => {
    if (error?.code !== "ENOENT") throw error;
  });
  return { status: "uninstalled", client: "github_copilot", ...paths, ...write };
}

export async function inspectGitHubCopilotAgentSessionHooks(options = {}) {
  const paths = copilotPathsFor(options);
  const config = await readCopilotConfig(paths.configPath);
  const handlerCounts = Object.fromEntries(
    COPILOT_EVENTS.map((eventName) => [
      eventName,
      (config.hooks?.[eventName] || []).filter((handler) =>
        isTaskenHandlerForEvent(handler, "github_copilot", eventName),
      ).length,
    ]),
  );
  const hookInstalled = await fs
    .stat(paths.installedHookPath)
    .then((stat) => stat.isFile())
    .catch((error) => {
      if (error?.code === "ENOENT") return false;
      throw error;
    });
  return {
    status:
      hookInstalled &&
      handlerCounts.sessionStart === 2 &&
      COPILOT_EVENTS.slice(1).every((eventName) => handlerCounts[eventName] === 1)
        ? "installed"
        : "incomplete",
    client: "github_copilot",
    ...paths,
    hookInstalled,
    handlerCounts,
  };
}

function optionValue(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

async function main() {
  const action = process.argv[2];
  const client = optionValue("--client") || "codex";
  const clients = {
    codex: {
      options: optionValue("--codex-home") ? { codexHome: optionValue("--codex-home") } : {},
      install: installCodexAgentSessionHooks,
      uninstall: uninstallCodexAgentSessionHooks,
      status: inspectCodexAgentSessionHooks,
    },
    github_copilot: {
      options: optionValue("--copilot-home") ? { copilotHome: optionValue("--copilot-home") } : {},
      install: installGitHubCopilotAgentSessionHooks,
      uninstall: uninstallGitHubCopilotAgentSessionHooks,
      status: inspectGitHubCopilotAgentSessionHooks,
    },
  };
  const selected = clients[client];
  if (!selected) throw new Error(`Unsupported client for managed installation: ${client}`);
  const operation = selected[action];
  if (!operation) {
    throw new Error(
      "Usage: manage-agent-session-hooks.mjs <install|status|uninstall> " +
        "[--client codex|github_copilot] [--codex-home PATH|--copilot-home PATH]",
    );
  }
  process.stdout.write(`${JSON.stringify(await operation(selected.options), null, 2)}\n`);
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  main().catch((error) => {
    process.stderr.write(
      `TASKEN_HOOK_MANAGER ${error instanceof Error ? error.message : String(error)}\n`,
    );
    process.exitCode = 1;
  });
}
