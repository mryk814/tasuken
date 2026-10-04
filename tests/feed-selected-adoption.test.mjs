import assert from "node:assert/strict";
import test from "node:test";
import { build } from "esbuild";

const result = await build({
  entryPoints: ["src/renderer/src/features/workspace/lib/selectedProposalAdoption.ts"],
  bundle: true,
  platform: "node",
  format: "esm",
  write: false,
});
const { adoptSelectedProposals } = await import(
  `data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString("base64")}`
);

test("only selected, visible pending records run once; failures remain retryable", async () => {
  const rows = [{ id: "a" }, { id: "b" }, { id: "new" }];
  const calls = [];
  const outcome = await adoptSelectedProposals(["a", "b", "a", "hidden"], rows, async (row) => {
    calls.push(row.id);
    if (row.id === "b") throw new Error("stale version");
  });
  assert.deepEqual(calls, ["a", "b"]);
  assert.deepEqual(outcome.accepted, ["a"]);
  assert.deepEqual(outcome.failed, [{ id: "b", message: "stale version" }]);
  const retry = [];
  await adoptSelectedProposals(
    outcome.failed.map((entry) => entry.id),
    rows,
    async (row) => retry.push(row.id),
  );
  assert.deepEqual(retry, ["b"]);
});

test("batch selection is a snapshot and execution stays sequential", async () => {
  const selected = ["a", "b"];
  const rows = [{ id: "a" }, { id: "b" }];
  const calls = [];
  await adoptSelectedProposals(selected, rows, async (row) => {
    calls.push(row.id);
    selected.push("new");
    rows.push({ id: "new" });
    await Promise.resolve();
  });
  assert.deepEqual(calls, ["a", "b"]);
});

const component = await build({
  entryPoints: ["src/renderer/src/features/workspace/components/AiProposalPanel.tsx"],
  bundle: true,
  platform: "node",
  format: "esm",
  write: false,
});
const { agentSessionAdoptionCommand, buildPreview } = await import(
  `data:text/javascript;base64,${Buffer.from(component.outputFiles[0].text).toString("base64")}`
);
const proposal = {
  id: "session-proposal",
  version: 3,
  status: "pending",
  payload_type: "agent_sessions",
  received_at: "2026-10-04T00:00:00Z",
  payload: {
    agent_sessions: [
      {
        action: "capture",
        session: {
          id: "session-a",
          started_at: "2026-10-03T00:00:00Z",
          ended_at: "2026-10-03T00:10:00Z",
          status: "unknown",
          client_kind: "codex",
          intent: { summary: "合成の記録" },
          observation: {
            schema_version: 1,
            coverage: "partial",
            observed_until: "2026-10-03T00:10:00Z",
            adapter: "synthetic",
            mode: "history",
          },
          outcome: { summary: "終了不明" },
          source: "ai_proposal",
        },
        references: [],
      },
    ],
  },
};
const context = { data: { agent_sessions: [] }, themes: [], items: [] };
test("session command retains provenance, unknown end and version/idempotency guards", () => {
  const command = agentSessionAdoptionCommand(proposal, context);
  assert.equal(command.commandId, "session-proposal:accept:v3");
  assert.equal(command.name, "ApplyAiProposal");
  assert.deepEqual(command.expectedVersions, [
    { type: "ai_proposal", id: proposal.id, version: 3 },
  ]);
  assert.equal(command.payload.candidates[0].entity.id, "session-a");
  assert.equal(command.payload.candidates[0].entity.ended_at, "2026-10-03T00:10:00Z");
  assert.equal(command.payload.candidates[0].entity.observation.coverage, "partial");
  assert.equal(command.payload.candidates[0].entity.status, "unknown");
  assert.throws(
    () => agentSessionAdoptionCommand({ ...proposal, status: "accepted" }, context),
    /採用待ち/,
  );
});
test("stale refresh and missing finish target fail before executing; detail edits remain honored", () => {
  assert.throws(
    () =>
      agentSessionAdoptionCommand(
        { ...proposal, request: { history_refresh_version: 2 } },
        context,
      ),
    /再同期/,
  );
  const finish = structuredClone(proposal);
  finish.payload.agent_sessions[0].action = "finish";
  assert.throws(() => agentSessionAdoptionCommand(finish, context), /終了対象/);
  const preview = buildPreview(proposal, context);
  preview.candidates[0].action = "ignore";
  const command = agentSessionAdoptionCommand(proposal, context, preview);
  assert.equal(command.payload.proposal.status, "rejected");
  assert.deepEqual(command.payload.candidates, []);
});
