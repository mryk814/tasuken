#!/usr/bin/env node
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";

import {
  startTaskenHeadlessCore,
  TaskenHeadlessCoreError,
  type TaskenHeadlessCoreHandle,
} from "./taskenHeadlessCore.ts";

export interface TaskenHeadlessCoreArgs {
  userDataPath?: string;
  databasePath?: string;
  syncDirectory?: string;
  help: boolean;
}

export class TaskenHeadlessCoreUsageError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TaskenHeadlessCoreUsageError";
  }
}

const HELP = `Tasken CoreをGUIなしで起動します。

Usage:
  node core-dist/headless.mjs [--user-data-dir=<path>] [--db-path=<path>] [--sync-directory=<path>]

Options:
  --user-data-dir    CoreのuserData（discovery fileの保存先）。省略時はTASKEN_USER_DATA_DIR、
                     またはOS標準のTasken保存先。
  --db-path          SQLite本体のパス。省略時はTASKEN_DB_PATH、または<userData>/research-desk.sqlite。
  --sync-directory   既存の共有フォルダ同期へreplicaとして参加する。省略時はTASKEN_SYNC_DIRECTORY。
                     参加できるのは空のnodeだけ。MCPはTASKEN_MCP_READ_ONLY=1で動かす。
  -h, --help         このhelpを表示する。

起動するとstdoutへTASKEN_HEADLESS_CORE_READY、SIGINT/SIGTERMの正常終了時に
TASKEN_HEADLESS_CORE_STOPPEDを1行ずつ出力します。tokenは出力しません。`;

export function parseTaskenHeadlessCoreArgs(
  argv: string[],
  env: NodeJS.ProcessEnv = process.env,
): TaskenHeadlessCoreArgs {
  const { values } = parseArgs({
    args: argv,
    options: {
      "user-data-dir": { type: "string" },
      "db-path": { type: "string" },
      "sync-directory": { type: "string" },
      help: { type: "boolean", short: "h" },
    },
    allowPositionals: false,
  });
  if (values.help) return { help: true };
  const userDataPath = values["user-data-dir"];
  const databasePath = values["db-path"];
  const syncDirectoryOption = values["sync-directory"];
  const syncDirectory =
    syncDirectoryOption === undefined ? env.TASKEN_SYNC_DIRECTORY : syncDirectoryOption;
  if (userDataPath !== undefined && !userDataPath.trim()) {
    throw new TaskenHeadlessCoreUsageError("--user-data-dirへ空のpathは指定できません。");
  }
  if (databasePath !== undefined && !databasePath.trim()) {
    throw new TaskenHeadlessCoreUsageError("--db-pathへ空のpathは指定できません。");
  }
  if (syncDirectory !== undefined && !syncDirectory.trim()) {
    throw new TaskenHeadlessCoreUsageError("--sync-directoryへ空のpathは指定できません。");
  }
  return {
    help: false,
    ...(userDataPath ? { userDataPath: path.resolve(userDataPath) } : {}),
    ...(databasePath ? { databasePath: path.resolve(databasePath) } : {}),
    ...(syncDirectory ? { syncDirectory: path.resolve(syncDirectory) } : {}),
  };
}

function diagnostic(code: string, message: string): string {
  return `TASKEN_HEADLESS_CORE_DIAGNOSTIC ${JSON.stringify({
    schema_version: 1,
    status: "blocked",
    code,
    message,
  })}`;
}

async function run(): Promise<void> {
  let args: TaskenHeadlessCoreArgs;
  try {
    args = parseTaskenHeadlessCoreArgs(process.argv.slice(2));
  } catch (error) {
    process.stderr.write(
      `${diagnostic(
        "INVALID_ARGUMENT",
        error instanceof Error ? error.message : "起動引数が不正です。",
      )}\n`,
    );
    process.exitCode = 78;
    return;
  }
  if (args.help) {
    process.stdout.write(`${HELP}\n`);
    return;
  }
  let handle: TaskenHeadlessCoreHandle;
  try {
    handle = await startTaskenHeadlessCore({
      ...(args.userDataPath ? { userDataPath: args.userDataPath } : {}),
      ...(args.databasePath ? { databasePath: args.databasePath } : {}),
      ...(args.syncDirectory ? { syncDirectory: args.syncDirectory } : {}),
    });
  } catch (error) {
    const code = error instanceof TaskenHeadlessCoreError ? error.code : "CORE_START_FAILED";
    process.stderr.write(
      `${diagnostic(
        code,
        error instanceof Error ? error.message : "Tasken Coreを起動できませんでした。",
      )}\n`,
    );
    process.exitCode = 78;
    return;
  }
  process.stdout.write(
    `TASKEN_HEADLESS_CORE_READY ${JSON.stringify({
      schema_version: 1,
      origin: handle.origin,
      discovery_path: handle.discoveryPath,
      database_path: handle.databasePath,
      api_version: handle.apiVersion,
      capability_count: handle.capabilityCount,
      sync_directory: handle.syncDirectory,
      pid: handle.pid,
    })}\n`,
  );
  const shutdown = (signal: NodeJS.Signals) => {
    void (async () => {
      try {
        await handle.stop();
        process.stdout.write(
          `TASKEN_HEADLESS_CORE_STOPPED ${JSON.stringify({
            schema_version: 1,
            reason: signal,
          })}\n`,
        );
        process.exitCode = 0;
      } catch (error) {
        process.stderr.write(
          `${diagnostic(
            "CORE_STOP_FAILED",
            error instanceof Error ? error.message : "Tasken Coreを停止できませんでした。",
          )}\n`,
        );
        process.exitCode = 78;
      } finally {
        process.exit();
      }
    })();
  };
  for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"] as const) {
    process.on(signal, shutdown);
  }
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) void run();
