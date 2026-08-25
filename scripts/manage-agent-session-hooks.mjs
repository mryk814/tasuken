#!/usr/bin/env node
import crypto from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const TASKEN_HOOK_FILE = "tasken-agent-session-hook.mjs";
const SOURCE_HOOK_FILE = "agent-session-hook.mjs";
const EVENTS = ["SessionStart", "UserPromptSubmit", "Stop", "SessionEnd"];

function commandFor(hookPath, extra = "") {
  const normalized = hookPath.replaceAll("\\", "/");
  return `node "${normalized}" --client codex${extra}`;
}

function isTaskenHandler(handler) {
  return handler?.type === "command" && typeof handler.command === "string"
    && handler.command.includes(TASKEN_HOOK_FILE)
    && handler.command.includes("--client codex");
}

function withoutTaskenHandlers(config) {
  const next = structuredClone(config);
  next.hooks ||= {};
  for (const eventName of EVENTS) {
    const entries = Array.isArray(next.hooks[eventName]) ? next.hooks[eventName] : [];
    const filtered = entries
      .map((entry) => ({
        ...entry,
        hooks: Array.isArray(entry?.hooks) ? entry.hooks.filter((handler) => !isTaskenHandler(handler)) : [],
      }))
      .filter((entry) => entry.hooks.length > 0);
    if (filtered.length > 0) next.hooks[eventName] = filtered;
    else delete next.hooks[eventName];
  }
  return next;
}

function withTaskenHandlers(config, installedHookPath) {
  const next = withoutTaskenHandlers(config);
  const observe = commandFor(installedHookPath);
  const flush = commandFor(installedHookPath, " --flush");
  next.hooks.SessionStart = [
    ...(next.hooks.SessionStart || []),
    {
      matcher: "startup|resume|clear|compact",
      hooks: [
        { type: "command", command: observe, timeout: 5 },
        { type: "command", command: flush, timeout: 5 },
      ],
    },
  ];
  for (const eventName of ["UserPromptSubmit", "Stop", "SessionEnd"]) {
    next.hooks[eventName] = [
      ...(next.hooks[eventName] || []),
      {
        hooks: [{
          type: "command",
          command: observe,
          timeout: eventName === "SessionEnd" ? 3 : 5,
        }],
      },
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

async function readConfig(configPath) {
  try {
    const parsed = JSON.parse(await fs.readFile(configPath, "utf8"));
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new Error("Codex hooks config must be a JSON object.");
    }
    if (parsed.hooks != null && (typeof parsed.hooks !== "object" || Array.isArray(parsed.hooks))) {
      throw new Error("Codex hooks config hooks field must be an object.");
    }
    return parsed;
  } catch (error) {
    if (error?.code === "ENOENT") return { hooks: {} };
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

async function copyHook(sourcePath, installedHookPath) {
  await assertRegularOrMissing(sourcePath);
  await assertRegularOrMissing(installedHookPath);
  const bytes = await fs.readFile(sourcePath);
  await fs.mkdir(path.dirname(installedHookPath), { recursive: true });
  const temporaryPath = `${installedHookPath}.tasken-${process.pid}.tmp`;
  await fs.writeFile(temporaryPath, bytes, { mode: 0o700 });
  await fs.rename(temporaryPath, installedHookPath);
  return crypto.createHash("sha256").update(bytes).digest("hex");
}

function pathsFor(options = {}) {
  const codexHome = path.resolve(options.codexHome || process.env.CODEX_HOME || path.join(os.homedir(), ".codex"));
  const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
  return {
    codexHome,
    configPath: path.join(codexHome, "hooks.json"),
    installedHookPath: path.join(codexHome, "hooks", TASKEN_HOOK_FILE),
    sourcePath: path.resolve(options.sourcePath || path.join(scriptDirectory, "..", "mcp-dist", SOURCE_HOOK_FILE)),
  };
}

export async function installCodexAgentSessionHooks(options = {}) {
  const paths = pathsFor(options);
  const currentText = await fs.readFile(paths.configPath, "utf8").catch((error) => {
    if (error?.code === "ENOENT") return null;
    throw error;
  });
  const config = await readConfig(paths.configPath);
  const sha256 = await copyHook(paths.sourcePath, paths.installedHookPath);
  const write = await writeConfig(paths.configPath, currentText, withTaskenHandlers(config, paths.installedHookPath));
  return { status: "installed", client: "codex", ...paths, sha256, ...write };
}

export async function uninstallCodexAgentSessionHooks(options = {}) {
  const paths = pathsFor(options);
  const currentText = await fs.readFile(paths.configPath, "utf8").catch((error) => {
    if (error?.code === "ENOENT") return null;
    throw error;
  });
  const config = await readConfig(paths.configPath);
  const write = await writeConfig(paths.configPath, currentText, withoutTaskenHandlers(config));
  await assertRegularOrMissing(paths.installedHookPath);
  await fs.unlink(paths.installedHookPath).catch((error) => {
    if (error?.code !== "ENOENT") throw error;
  });
  return { status: "uninstalled", client: "codex", ...paths, ...write };
}

export async function inspectCodexAgentSessionHooks(options = {}) {
  const paths = pathsFor(options);
  const config = await readConfig(paths.configPath);
  const handlerCounts = Object.fromEntries(EVENTS.map((eventName) => [
    eventName,
    (config.hooks?.[eventName] || []).flatMap((entry) => entry.hooks || []).filter(isTaskenHandler).length,
  ]));
  const hookInstalled = await fs.stat(paths.installedHookPath).then((stat) => stat.isFile()).catch((error) => {
    if (error?.code === "ENOENT") return false;
    throw error;
  });
  return {
    status: hookInstalled && handlerCounts.SessionStart === 2
      && EVENTS.slice(1).every((eventName) => handlerCounts[eventName] === 1)
      ? "installed"
      : "incomplete",
    client: "codex",
    ...paths,
    hookInstalled,
    handlerCounts,
  };
}

async function main() {
  const action = process.argv[2];
  const clientIndex = process.argv.indexOf("--client");
  const client = clientIndex >= 0 ? process.argv[clientIndex + 1] : "codex";
  if (client !== "codex") throw new Error(`Unsupported client for managed installation: ${client}`);
  const codexHomeIndex = process.argv.indexOf("--codex-home");
  const options = codexHomeIndex >= 0 ? { codexHome: process.argv[codexHomeIndex + 1] } : {};
  const operation = action === "install"
    ? installCodexAgentSessionHooks
    : action === "uninstall"
      ? uninstallCodexAgentSessionHooks
      : action === "status"
        ? inspectCodexAgentSessionHooks
        : null;
  if (!operation) throw new Error("Usage: manage-agent-session-hooks.mjs <install|status|uninstall> [--client codex] [--codex-home PATH]");
  process.stdout.write(`${JSON.stringify(await operation(options), null, 2)}\n`);
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  main().catch((error) => {
    process.stderr.write(`TASKEN_HOOK_MANAGER ${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}
