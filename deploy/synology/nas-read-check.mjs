import { Client } from "/app/node_modules/@modelcontextprotocol/sdk/dist/esm/client/index.js";
import { StdioClientTransport } from "/app/node_modules/@modelcontextprotocol/sdk/dist/esm/client/stdio.js";

// NAS上の稼働中Coreへ、MCP(stdio)で接続して現在のtool一覧と読み取りを確認する。
//
// read-only（既定）:
//   sudo docker run --rm --network container:tasken-headless --user 1026:100 \
//     -v /volume1/docker/tasken/deploy/synology/nas-read-check.mjs:/check/nas-read-check.mjs:ro \
//     -v /volume1/docker/tasken/deploy/synology/state:/data:ro \
//     --entrypoint node tasken-headless:local /check/nas-read-check.mjs
//
// 書き込みtoolを含む一覧（toolを呼ぶだけで、書き込みはしない）:
//   上と同じコマンドへ `-e TASKEN_MCP_READ_ONLY=0` を足す。tunnelと同じ見え方を確認できる。
const READ_ONLY = (process.env.TASKEN_MCP_READ_ONLY ?? "1") !== "0";
const WRITE_TOOL_NAMES = new Set([
  "tasken.start_task_work",
  "tasken.append_work_receipt",
  "tasken.report_task_done",
  "tasken.report_task_blocked",
  "tasken.propose_note",
  "tasken.propose_note_edit",
  "tasken.propose_feed_post",
  "tasken.answer_feed_question",
]);
const transport = new StdioClientTransport({
  command: process.execPath,
  args: ["/app/mcp-dist/server.mjs"],
  env: {
    ...process.env,
    TASKEN_USER_DATA_DIR: "/data",
    TASKEN_MCP_READ_ONLY: READ_ONLY ? "1" : "0",
  },
  stderr: "pipe",
});
const client = new Client({ name: "tasken-nas-read-check", version: "1.0.0" });
try {
  await client.connect(transport);
  const tools = await client.listTools();
  const names = tools.tools.map((tool) => tool.name).sort();
  const writeTools = names.filter((name) => WRITE_TOOL_NAMES.has(name));
  console.log(`TOOL_COUNT ${tools.tools.length}`);
  console.log(`MCP_READ_ONLY ${READ_ONLY}`);
  console.log(`HAS_WRITE ${writeTools.length > 0}`);
  console.log(`WRITE_TOOLS ${writeTools.join(",") || "-"}`);
  console.log(`READ_TOOLS ${names.filter((name) => !WRITE_TOOL_NAMES.has(name)).join(",")}`);
  const result = await client.callTool({
    name: "tasken.search_items",
    arguments: { limit: 5 },
  });
  console.log(`IS_ERROR ${result.isError === true}`);
  console.log(`ITEMS ${(result.structuredContent?.items || []).map((item) => item.id).join(",")}`);
} finally {
  await client.close().catch(() => {});
}
