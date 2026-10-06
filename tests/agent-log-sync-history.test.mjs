import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { pathToFileURL } from "node:url";
import { build } from "esbuild";
import { TaskenCoreClient } from "../src/main/mcp/taskenCoreClient.mjs";
import { WorkspaceDatabase } from "../src/main/repositories/workspaceRepository.mjs";

// #629: ログ同期で読み込んだ自分のSessionは採用待ちにせず履歴へ入れ、依頼の前置きを外して読めるようにする。
const bundle = await build({
  stdin: {
    contents: `
 export { createTaskenCore } from './src/main/infrastructure/sqlite/public.ts';
 export { TaskenCoreHost } from './src/main/infrastructure/http/taskenCoreHost.ts';
 export { ApplicationCommandService } from './src/main/services/applicationCommandService.ts';
 export { agentSessionProposalAcceptanceCommand, isAgentLogSyncProposal } from './src/shared/agentSessionProposalAcceptance.ts';
 export { userRequestText, createNativeAgentLogAccumulator, NATIVE_AGENT_LOG_PARSER_VERSION } from './src/shared/agentWorkLogImport.ts';
 export { buildAttentionQueue, isPassiveAgentSessionProposal } from './src/shared/contracts/task/attentionQueue.ts';
`,
    resolveDir: process.cwd(),
  },
  bundle: true,
  platform: "node",
  format: "esm",
  write: false,
  logLevel: "silent",
});
const bundleRoot = fs.mkdtempSync(path.join(os.tmpdir(), "tasken-log-history-bundle-"));
const bundlePath = path.join(bundleRoot, "core.mjs");
fs.writeFileSync(bundlePath, bundle.outputFiles[0].text);
test.after(() => fs.rmSync(bundleRoot, { recursive: true, force: true }));
const {
  createTaskenCore,
  TaskenCoreHost,
  ApplicationCommandService,
  agentSessionProposalAcceptanceCommand,
  isAgentLogSyncProposal,
  userRequestText,
  createNativeAgentLogAccumulator,
  NATIVE_AGENT_LOG_PARSER_VERSION,
  buildAttentionQueue,
  isPassiveAgentSessionProposal,
} = await import(pathToFileURL(bundlePath).href);

const codexIdeRequest = `# Context from my IDE setup:

## Active file: AGENTS.md

## Open tabs:
- main.py: main.py
- AGENTS.md: AGENTS.md

## My request for Codex:
marimoのテストをしたいんですよね！ なにかしら適当なデータを持ってきて分析してください`;

test("client preambles are removed and only the user's request remains", () => {
  assert.equal(
    userRequestText(codexIdeRequest),
    "marimoのテストをしたいんですよね！ なにかしら適当なデータを持ってきて分析してください",
  );
  // 依頼のない文脈だけのメッセージは依頼として扱わない。
  assert.equal(userRequestText("# Context from my IDE setup:\n\n## Open tabs:\n- a.py"), "");
  assert.equal(userRequestText("# AGENTS.md instructions for C:/repo\n..."), "");
  assert.equal(
    userRequestText("<environment_context>\n<cwd>C:/repo</cwd>\n</environment_context>"),
    "",
  );
  assert.equal(
    userRequestText(
      "<ide_opened_file>The user opened the file C:/repo/src/a.ts in the IDE.</ide_opened_file>\nこの関数を直して",
    ),
    "この関数を直して",
  );
  assert.equal(
    userRequestText(
      "<ide_selection>The user selected lines 1-3</ide_selection><system-reminder>noise</system-reminder>",
    ),
    "",
  );
  assert.equal(
    userRequestText(
      "<command-message>review is running…</command-message>\n<command-name>/review</command-name>\n<command-args>123</command-args>",
    ),
    "/review 123",
  );
  assert.equal(userRequestText("  普通の依頼です  "), "普通の依頼です");
});

test("native Codex logs use the request body as the session summary", () => {
  assert.ok(NATIVE_AGENT_LOG_PARSER_VERSION >= 2);
  const accumulator = createNativeAgentLogAccumulator("codex");
  const at = (minute) => `2026-10-04T13:${String(minute).padStart(2, "0")}:00Z`;
  for (const line of [
    {
      type: "session_meta",
      timestamp: at(0),
      payload: { id: "codex-ide", timestamp: at(0), cli_version: "1.0" },
    },
    {
      type: "response_item",
      timestamp: at(1),
      payload: {
        type: "message",
        role: "user",
        content: [{ type: "input_text", text: "# AGENTS.md instructions\n..." }],
      },
    },
    {
      type: "response_item",
      timestamp: at(2),
      payload: {
        type: "message",
        role: "user",
        content: [{ type: "input_text", text: codexIdeRequest }],
      },
    },
    {
      type: "response_item",
      timestamp: at(3),
      payload: {
        type: "message",
        role: "assistant",
        content: [{ type: "output_text", text: "分析しました。" }],
      },
    },
  ])
    accumulator.add(line);
  const log = accumulator.finish();
  assert.match(log.intent.summary, /^marimoのテストをしたい/);
  assert.equal(log.intent.summary.includes("Context from my IDE setup"), false);
  assert.equal(log.outcome.summary, "分析しました。");
});

test("pending log-sync records are observations, not 対応待ち", () => {
  const proposal = {
    id: "p1",
    status: "pending",
    payload_type: "agent_sessions",
    source: "mcp",
    source_app: "tasken-log-sync:codex",
    payload: { agent_sessions: [] },
  };
  assert.equal(isAgentLogSyncProposal(proposal), true);
  assert.equal(isPassiveAgentSessionProposal(proposal), true);
  assert.deepEqual(buildAttentionQueue({ proposals: [proposal] }), []);
  // 外部AIからの通常のProposalは引き続き判断待ち。
  const other = { ...proposal, id: "p2", source_app: "codex-mcp", payload_type: "notes" };
  assert.equal(isAgentLogSyncProposal(other), false);
  assert.equal(buildAttentionQueue({ proposals: [other] }).length, 1);
});

test("log-sync capture is adopted through ApplyAiProposal and a re-read refresh replaces the raw summary", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "tasken-log-history-"));
  const db = new WorkspaceDatabase(path.join(root, "workspace.sqlite3"));
  const host = new TaskenCoreHost({ userDataPath: root, ...createTaskenCore(db) });
  try {
    await host.start();
    const client = new TaskenCoreClient({ userDataPath: root });
    const commands = new ApplicationCommandService(db);
    const adopt = (proposalId) =>
      commands.execute(
        agentSessionProposalAcceptanceCommand(
          db.get("ai_proposal", proposalId),
          (id) => db.get("agent_session", id),
          {
            actor: { kind: "system", id: "agent-log-sync" },
            source: "main_ui",
            issuedAt: new Date().toISOString(),
          },
        ),
      );
    const base = {
      action: "capture",
      caller: "Tasken local log sync",
      source: "mcp",
      source_app: "tasken-log-sync:codex",
      source_session: "codex-ide",
      actor: { kind: "ai_agent" },
      client_kind: "codex",
      started_at: "2026-10-04T13:00:00Z",
      ended_at: "2026-10-04T13:03:00Z",
      status: "unknown",
      intent: { summary: codexIdeRequest },
      outcome: { summary: "分析しました。" },
      observation: {
        schema_version: 1,
        adapter: "codex-rollout/1",
        client_version: "1.0",
        coverage: "partial",
        observed_until: "2026-10-04T13:03:00Z",
        mode: "history",
      },
    };
    const first = await client.proposeAgentSession({ ...base, idempotency_key: "raw" });
    adopt(first.proposal_id);
    assert.equal(db.get("ai_proposal", first.proposal_id).status, "accepted");
    const session = db.get("agent_session", first.agent_session_id);
    assert.equal(session.intent.summary, codexIdeRequest);
    assert.equal(
      buildAttentionQueue({ proposals: db.list("ai_proposal") }).length,
      0,
      "採用後は対応待ちに残らない",
    );

    // parserの版を上げて読み直した結果。依頼の要旨だけを正規化済みに置き換える。
    const refreshed = await client.proposeAgentSession({
      ...base,
      idempotency_key: "normalized",
      expected_version: session.version,
      intent: { summary: userRequestText(codexIdeRequest) },
    });
    adopt(refreshed.proposal_id);
    const updated = db.get("agent_session", first.agent_session_id);
    assert.equal(db.list("agent_session").length, 1);
    assert.match(updated.intent.summary, /^marimoのテストをしたい/);
    assert.equal(updated.outcome.summary, "分析しました。");

    // 履歴の読み直し以外では、これまでどおり依頼の要旨を書き換えられない。
    const hook = await client.proposeAgentSession({
      ...base,
      action: "start",
      source_app: "tasken-session-hook:codex",
      source_session: "hook-session",
      idempotency_key: "hook-start",
      ended_at: undefined,
      status: undefined,
      outcome: undefined,
      observation: undefined,
      intent: { summary: "最初の依頼" },
    });
    adopt(hook.proposal_id);
    const active = db.get("agent_session", hook.agent_session_id);
    const proposalId = "manual-finish";
    db.save("ai_proposal", {
      id: proposalId,
      source: "mcp",
      source_app: "tasken-session-hook:codex",
      payload_type: "agent_sessions",
      payload: {
        agent_sessions: [
          {
            action: "finish",
            session: {
              ...active,
              status: "completed",
              ended_at: "2026-10-04T13:05:00Z",
              outcome: { summary: "done" },
              intent: { summary: "書き換えた依頼" },
            },
            references: [],
          },
        ],
      },
      request: {},
      status: "pending",
      received_at: "2026-10-04T13:05:00Z",
    });
    assert.throws(() => adopt(proposalId), /intent は終了時に変更できません/);
  } finally {
    await host.stop();
    db.db.close();
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("acceptance builder refuses stale history refreshes and non-pending proposals", () => {
  const proposal = {
    id: "p",
    version: 1,
    status: "pending",
    payload_type: "agent_sessions",
    source_app: "tasken-log-sync:codex",
    request: { history_refresh_version: 2 },
    payload: { agent_sessions: [{ action: "capture", session: { id: "s" }, references: [] }] },
  };
  const options = {
    actor: { kind: "system" },
    source: "main_ui",
    issuedAt: "2026-10-06T00:00:00Z",
  };
  assert.throws(
    () => agentSessionProposalAcceptanceCommand(proposal, () => ({ id: "s", version: 3 }), options),
    /記録が変更されています/,
  );
  assert.throws(
    () =>
      agentSessionProposalAcceptanceCommand(
        { ...proposal, status: "accepted" },
        () => null,
        options,
      ),
    /採用待ち/,
  );
  const command = agentSessionProposalAcceptanceCommand(
    proposal,
    () => ({ id: "s", version: 2 }),
    options,
  );
  assert.equal(command.name, "ApplyAiProposal");
  assert.equal(command.payload.proposal.status, "accepted");
  assert.deepEqual(command.expectedVersions, [{ type: "ai_proposal", id: "p", version: 1 }]);
});
