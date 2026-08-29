import assert from "node:assert/strict";
import { Buffer } from "node:buffer";
import path from "node:path";
import test from "node:test";

import { build } from "esbuild";

async function importBundled(relativePath) {
  const result = await build({
    entryPoints: [path.resolve(relativePath)],
    bundle: true,
    platform: "node",
    format: "esm",
    write: false,
    logLevel: "silent",
  });
  return import(
    `data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString("base64")}`
  );
}

const { buildCandidateOperations, buildPreview } = await importBundled(
  "src/renderer/src/features/workspace/components/AiProposalPanel.tsx",
);

test("Task Proposal keeps generated change_event outside ApplyAiProposal candidates", () => {
  const proposal = {
    id: "proposal-task-with-audit",
    source: "mcp",
    source_app: "fixture",
    payload_type: "items",
    payload: {
      items: [
        {
          kind: "task",
          title: "MCP live Proposalを確認する",
          description: "起動中AI Inboxから採用する",
          status: "todo",
        },
      ],
    },
    request: { tool: "tasken.propose_task" },
    status: "pending",
    received_at: "2026-08-29T00:00:00.000Z",
    version: 1,
  };
  const preview = buildPreview(proposal, {
    data: {},
    themes: [{ id: "theme-personal-default", name: "個人業務" }],
    items: [],
  });
  const operations = buildCandidateOperations(preview.candidates);

  assert.deepEqual(
    operations.map((operation) => operation.type),
    ["task"],
  );
  assert.equal(
    operations.some((operation) => operation.type === "change_event"),
    false,
  );
});
