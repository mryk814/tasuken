import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

test("Phase 0: MCP inventory documents every registered read and Proposal tool", () => {
  const serverSource = readFileSync(new URL("../src/main/mcp/server.mjs", import.meta.url), "utf8");
  const migrationDocument = readFileSync(
    new URL("../docs/tasken-core-migration.md", import.meta.url),
    "utf8",
  );
  const readOnlyBoundary = serverSource.indexOf("if (readOnly) return filterAvailableTools();");
  const registrations = [...serverSource.matchAll(/server\.registerTool\(\s*"([^"]+)"/g)].map(
    (match) => ({ name: match[1], offset: match.index }),
  );
  const readTools = registrations.filter((entry) => entry.offset < readOnlyBoundary);
  const proposalTools = registrations.filter((entry) => entry.offset > readOnlyBoundary);

  // AI Readyの一覧と割り当て（読み取り）、開始（直接の書き込み）は #755 束10a で外した。
  assert.equal(readTools.length, 14);
  // 旧名 3 道具（append_work_receipt・report_task_done・report_task_blocked）は #755 束1 で外した。
  assert.equal(proposalTools.length, 9);
  assert.deepEqual(
    readTools.filter((entry) => entry.name.endsWith("_image")).map((entry) => entry.name),
    [],
  );
  assert.equal(new Set(registrations.map((entry) => entry.name)).size, registrations.length);
  for (const { name } of registrations) {
    assert.equal(
      migrationDocument.includes(`\`${name.replace(/^tasken\./, "")}\``),
      true,
      `${name} is missing from the inventory`,
    );
  }
});
