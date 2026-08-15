import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { defaultTaskenDbPath } from "../src/main/mcp/readOnlyContext.mjs";
import { resolveTaskenDatabasePath, resolveTaskenUserDataPath } from "../src/shared/taskenPaths.mjs";

test("WSL/Linuxは引き継がれたAPPDATAではなくElectronのXDG userDataを使う", () => {
  const env = {
    APPDATA: "/mnt/c/Users/ootan/AppData/Roaming",
    XDG_CONFIG_HOME: "/home/tester/.config",
  };

  assert.equal(
    resolveTaskenUserDataPath({ env, platform: "linux", home: "/home/tester" }),
    "/home/tester/.config/tasken",
  );
  assert.equal(
    resolveTaskenDatabasePath({ env, platform: "linux", home: "/home/tester" }),
    "/home/tester/.config/tasken/research-desk.sqlite",
  );
});

test("開発用DBの明示指定はuserData解決より優先する", () => {
  const env = {
    TASKEN_DB_PATH: "/tmp/tasken-check.sqlite",
    TASKEN_USER_DATA_DIR: "/tmp/tasken-user-data",
  };

  assert.equal(resolveTaskenDatabasePath({ env, platform: "linux", home: "/home/tester" }), "/tmp/tasken-check.sqlite");
  assert.equal(resolveTaskenUserDataPath({ env, platform: "linux", home: "/home/tester" }), "/tmp/tasken-user-data");
});

test("userDataの明示指定はDBファイルの親として使う", () => {
  const env = { TASKEN_USER_DATA_DIR: "/tmp/tasken-user-data" };
  assert.equal(
    resolveTaskenDatabasePath({ env, platform: "linux", home: "/home/tester" }),
    "/tmp/tasken-user-data/research-desk.sqlite",
  );
});

test("read-only MCPの旧Research Desk fallbackはWindowsだけで使う", async (context) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "tasken-paths-"));
  context.after(() => rm(root, { recursive: true, force: true }));
  const appData = path.join(root, "Roaming");
  const legacy = path.join(appData, "Research Desk", "research-desk.sqlite");
  const xdg = path.join(root, "xdg");
  await mkdir(path.dirname(legacy), { recursive: true });
  await writeFile(legacy, "legacy");

  const env = { APPDATA: appData, XDG_CONFIG_HOME: xdg };
  assert.equal(
    defaultTaskenDbPath(
      { ...env, XDG_CONFIG_HOME: "/home/tester/.config" },
      { platform: "linux", home: "/home/tester" },
    ),
    "/home/tester/.config/tasken/research-desk.sqlite",
  );
  assert.equal(
    defaultTaskenDbPath(env, { platform: "win32", home: path.join(root, "home") }),
    legacy,
  );
});
