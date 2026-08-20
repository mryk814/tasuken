import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import test from "node:test";

import {
  MCP_DIAGNOSTIC_CODES,
  electronRuntimeRequiredDiagnostic,
  inspectMcpEnvironment,
  runtimeKind,
} from "../scripts/mcp-runtime.mjs";

test("MCP runtime diagnostics distinguish Node from Electron-as-Node", () => {
  assert.equal(runtimeKind({ env: {}, versions: { modules: "137" } }), "node");
  assert.equal(runtimeKind({ env: { ELECTRON_RUN_AS_NODE: "1" }, versions: { electron: "37.0.0", modules: "136" } }), "electron-as-node");
  const diagnostic = electronRuntimeRequiredDiagnostic({ kind: "node", node_abi: "137" });
  assert.equal(diagnostic.code, MCP_DIAGNOSTIC_CODES.ELECTRON_RUNTIME_REQUIRED);
  assert.ok(diagnostic.next_actions.some((action) => action.includes("npm run mcp")));
});

test("plain Node MCP entrypoint rejects before loading the native binding", () => {
  const result = spawnSync(process.env.TASKEN_NODE_EXEC_PATH || "node", ["scripts/mcp-server.mjs"], {
    encoding: "utf8",
    env: { ...process.env, ELECTRON_RUN_AS_NODE: "" },
  });
  assert.equal(result.status, 78);
  assert.equal(result.stdout, "");
  const diagnosticLine = result.stderr
    .split(/\r?\n/)
    .find((line) => line.startsWith("TASKEN_MCP_DIAGNOSTIC "));
  assert.ok(diagnosticLine, result.stderr);
  const diagnostic = JSON.parse(diagnosticLine.slice("TASKEN_MCP_DIAGNOSTIC ".length));
  assert.equal(diagnostic.code, MCP_DIAGNOSTIC_CODES.ELECTRON_RUNTIME_REQUIRED);
  assert.doesNotMatch(result.stderr, /NODE_MODULE_VERSION|better_sqlite3\.node|Require stack/);
});

test("doctor snapshot exposes runtime, binding, Electron, and database paths", () => {
  const snapshot = inspectMcpEnvironment({ env: { TASKEN_DB_PATH: "/tmp/tasken-mcp-413-fixture.sqlite" } });
  assert.equal(snapshot.schema_version, 1);
  assert.equal(snapshot.binding.package, "better-sqlite3");
  assert.ok("path" in snapshot.electron);
  assert.equal(snapshot.database.configured_by, "TASKEN_DB_PATH");
});
