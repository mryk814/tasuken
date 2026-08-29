import assert from "node:assert/strict";
import { Buffer } from "node:buffer";
import path from "node:path";
import test from "node:test";

import { build } from "esbuild";

const bundled = await build({
  entryPoints: [path.resolve("src/renderer/src/stores/workspaceStore.ts")],
  bundle: true,
  platform: "node",
  format: "esm",
  write: false,
  logLevel: "silent",
});
const { useWorkspaceStore } = await import(
  `data:text/javascript;base64,${Buffer.from(bundled.outputFiles[0].text).toString("base64")}`
);

function resetWorkspace() {
  useWorkspaceStore.setState({
    workspace: {
      ai_proposals: [],
      tasks: [],
      change_events: [],
    },
    loadState: "success",
    loadError: "",
  });
}

test("duplicate Proposal deltas stay idempotent in the live Workspace store", () => {
  resetWorkspace();
  const proposal = {
    id: "proposal-live-1",
    version: 1,
    source: "mcp",
    status: "pending",
  };
  const change = { type: "ai_proposal", entity: proposal };

  useWorkspaceStore.getState().applyExternalSaves([change]);
  useWorkspaceStore.getState().applyExternalSaves([change]);

  const workspace = useWorkspaceStore.getState().workspace;
  assert.equal(workspace.ai_proposals.length, 1);
  assert.equal(workspace.ai_proposals[0].status, "pending");
});

test("accept receipt converges pending Proposal, Task, and Activity exactly once", () => {
  resetWorkspace();
  useWorkspaceStore.getState().applyExternalSaves([
    {
      type: "ai_proposal",
      entity: { id: "proposal-live-2", version: 1, source: "mcp", status: "pending" },
    },
  ]);
  const receipt = {
    commandId: "accept-live-2",
    changes: [
      {
        type: "ai_proposal",
        entity: { id: "proposal-live-2", version: 2, source: "mcp", status: "accepted" },
      },
      {
        type: "task",
        entity: { id: "task-live-2", version: 1, source: "ai_proposal", title: "Accepted" },
      },
    ],
    eventChanges: [
      {
        type: "change_event",
        entity: { id: "event-live-2", version: 1, source: "command" },
      },
    ],
  };

  useWorkspaceStore.getState().applyCommandReceipt(receipt);
  useWorkspaceStore.getState().applyCommandReceipt(receipt);

  const workspace = useWorkspaceStore.getState().workspace;
  assert.equal(workspace.ai_proposals.filter((entry) => entry.status === "pending").length, 0);
  assert.equal(workspace.ai_proposals[0].status, "accepted");
  assert.equal(workspace.tasks.length, 1);
  assert.equal(workspace.change_events.length, 1);
});
