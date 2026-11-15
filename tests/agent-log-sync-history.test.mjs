import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { pathToFileURL } from "node:url";
import { build } from "esbuild";

// ログからの拾い上げの読み取り（#629・#751）: 依頼の前置きを外し、最初の依頼と最後の回答だけを残す。
const bundle = await build({
  stdin: {
    contents: `
 export { userRequestText, createNativeAgentLogAccumulator } from './src/shared/agentLogPickup.ts';
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
  userRequestText,
  createNativeAgentLogAccumulator,
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
  assert.match(log.intent, /^marimoのテストをしたい/);
  assert.equal(log.intent.includes("Context from my IDE setup"), false);
  assert.equal(log.summary, "分析しました。");
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
  assert.equal(isPassiveAgentSessionProposal(proposal), true);
  assert.deepEqual(buildAttentionQueue({ proposals: [proposal] }), []);
  // 外部AIからの通常のProposalは引き続き判断待ち。
  const other = { ...proposal, id: "p2", source_app: "codex-mcp", payload_type: "notes" };
  assert.equal(buildAttentionQueue({ proposals: [other] }).length, 1);
});

const at = (minute) => `2026-10-04T13:${String(minute).padStart(2, "0")}:00Z`;
const codexMeta = (payload = {}) => ({
  type: "session_meta",
  timestamp: at(0),
  payload: { id: "codex-main", timestamp: at(0), cli_version: "1.0", ...payload },
});
const codexUser = (minute, text) => ({
  type: "response_item",
  timestamp: at(minute),
  payload: { type: "message", role: "user", content: [{ type: "input_text", text }] },
});
const codexAnswer = (minute, text) => ({
  type: "response_item",
  timestamp: at(minute),
  payload: { type: "message", role: "assistant", content: [{ type: "output_text", text }] },
});

test("subagent and review threads are not separate sessions", () => {
  for (const meta of [
    { thread_source: "subagent", parent_thread_id: "codex-main" },
    { thread_source: "guardian_review" },
    { parent_thread_id: "codex-main" },
  ]) {
    const accumulator = createNativeAgentLogAccumulator("codex");
    accumulator.add(codexMeta({ id: "child", ...meta }));
    accumulator.add(codexUser(1, "親から委任された作業"));
    assert.equal(accumulator.skipReason(), "delegated_thread");
    assert.equal(accumulator.sourceSession(), "child");
  }
  const user = createNativeAgentLogAccumulator("codex");
  user.add(codexMeta({ thread_source: "user" }));
  user.add(codexUser(1, "依頼"));
  assert.equal(user.skipReason(), null);

  // Claude Codeのsubagentファイルは発言がすべてsidechain。
  const claudeSub = createNativeAgentLogAccumulator("claude_code");
  claudeSub.add({
    type: "user",
    sessionId: "claude-1",
    isSidechain: true,
    timestamp: at(1),
    message: { role: "user", content: "subagentへの指示" },
  });
  assert.equal(claudeSub.skipReason(), "delegated_thread");
});

test("拾う物は、最初の依頼の先頭と最後の回答の先頭、時刻、作業場所だけ", () => {
  const accumulator = createNativeAgentLogAccumulator("codex");
  accumulator.add(codexMeta({ cwd: "C:/synthetic/repo" }));
  for (let index = 1; index <= 7; index++)
    accumulator.add(codexUser(index, `依頼${index} ${"x".repeat(900)}`));
  accumulator.add(codexAnswer(8, "途中の回答"));
  accumulator.add(codexAnswer(9, `最後の回答 ${"y".repeat(900)}`));
  accumulator.add({ type: "event_msg", timestamp: at(12), payload: { type: "task_complete" } });
  const pickup = accumulator.finish();
  assert.deepEqual(Object.keys(pickup).sort(), [
    "client_kind",
    "cwd",
    "ended_at",
    "intent",
    "source_session",
    "started_at",
    "summary",
  ]);
  assert.equal(pickup.client_kind, "codex");
  assert.equal(pickup.source_session, "codex-main");
  assert.equal(pickup.started_at, "2026-10-04T13:00:00.000Z");
  // 終わりは、依頼や回答でない行も含めた、ログの最後の動き。
  assert.equal(pickup.ended_at, "2026-10-04T13:12:00.000Z");
  assert.equal(pickup.intent.slice(0, 3), "依頼1");
  assert.equal(pickup.summary.slice(0, 5), "最後の回答");
  assert.ok(pickup.intent.length <= 500 && pickup.summary.length <= 500);
  assert.equal(pickup.cwd, "C:/synthetic/repo");

  // 回答が 1 つも無い会話は、要約を作らない（null）。依頼も回答も無いログは拾わない。
  const requestOnly = createNativeAgentLogAccumulator("codex");
  requestOnly.add(codexMeta());
  requestOnly.add(codexUser(1, "依頼だけ"));
  assert.deepEqual(
    [requestOnly.finish().intent, requestOnly.finish().summary, requestOnly.finish().cwd],
    ["依頼だけ", null, null],
  );
  const empty = createNativeAgentLogAccumulator("codex");
  empty.add(codexMeta());
  assert.throws(() => empty.finish(), /本文がありません/);

  // Claude Code は、行の sessionId と cwd から読む。
  const claude = createNativeAgentLogAccumulator("claude_code");
  claude.add({
    type: "user",
    sessionId: "claude-1",
    cwd: "C:/synthetic/other",
    timestamp: at(1),
    message: { role: "user", content: "依頼" },
  });
  claude.add({
    type: "assistant",
    sessionId: "claude-1",
    timestamp: at(2),
    message: { role: "assistant", content: [{ type: "text", text: "回答" }] },
  });
  assert.deepEqual(claude.finish(), {
    client_kind: "claude_code",
    source_session: "claude-1",
    started_at: "2026-10-04T13:01:00.000Z",
    ended_at: "2026-10-04T13:02:00.000Z",
    intent: "依頼",
    summary: "回答",
    cwd: "C:/synthetic/other",
  });
});
