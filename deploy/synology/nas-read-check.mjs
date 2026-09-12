import { Client } from "/app/node_modules/@modelcontextprotocol/sdk/dist/esm/client/index.js";
import { StdioClientTransport } from "/app/node_modules/@modelcontextprotocol/sdk/dist/esm/client/stdio.js";

// NAS上の稼働中Coreへ、read-only MCP(stdio)で接続して読み取りを確認する。
// 実行例（NAS）:
//   sudo docker run --rm --network container:tasken-headless --user 1026:100 \
//     -v /volume1/docker/tasken/deploy/synology/nas-read-check.mjs:/check/nas-read-check.mjs:ro \
//     -v /volume1/docker/tasken/deploy/synology/state:/data:ro \
//     --entrypoint node tasken-headless:local /check/nas-read-check.mjs
const transport = new StdioClientTransport({
  command: process.execPath,
  args: ["/app/mcp-dist/server.mjs"],
  env: { ...process.env, TASKEN_USER_DATA_DIR: "/data", TASKEN_MCP_READ_ONLY: "1" },
  stderr: "pipe",
});
const client = new Client({ name: "tasken-nas-read-check", version: "1.0.0" });
try {
  await client.connect(transport);
  const tools = await client.listTools();
  console.log(`TOOL_COUNT ${tools.tools.length}`);
  console.log(
    `HAS_WRITE ${tools.tools.some((tool) =>
      ["tasken.start_task_work", "tasken.report_task_done", "tasken.propose_note"].includes(
        tool.name,
      ),
    )}`,
  );
  const result = await client.callTool({
    name: "tasken.search_items",
    arguments: { limit: 5 },
  });
  console.log(`IS_ERROR ${result.isError === true}`);
  console.log(`ITEMS ${(result.structuredContent?.items || []).map((item) => item.id).join(",")}`);
} finally {
  await client.close().catch(() => {});
}
