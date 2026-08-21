import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

test("plain Node MCP entrypoint has no Electron or native SQLite runtime dependency", () => {
  const entry = fs.readFileSync("scripts/mcp-server.mjs", "utf8");
  const server = fs.readFileSync("src/main/mcp/server.mjs", "utf8");
  assert.doesNotMatch(`${entry}\n${server}`, /electron|better-sqlite3|ELECTRON_RUN_AS_NODE|\.node["']/i);
  assert.match(entry, /startTaskenMcpServer/);
});

test("MCP doctor fails closed through Core discovery without exposing credentials or paths", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "tasken-mcp-doctor-"));
  try {
    const result = spawnSync(process.env.TASKEN_NODE_EXEC_PATH || "node", ["scripts/mcp-doctor.mjs", "--json"], {
      encoding: "utf8",
      env: { ...process.env, TASKEN_USER_DATA_DIR: root },
    });
    assert.equal(result.status, 1);
    const report = JSON.parse(result.stdout);
    assert.equal(report.schema_version, 2);
    assert.equal(report.status, "blocked");
    assert.equal(report.checks[0].code, "CORE_UNAVAILABLE");
    assert.doesNotMatch(result.stdout, /token|authorization|tasken-core\.json|[A-Za-z]:\\|\/tmp\//i);
    assert.doesNotMatch(result.stderr, /NODE_MODULE_VERSION|better_sqlite3\.node|Require stack/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
