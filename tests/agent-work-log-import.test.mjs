import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import { parseAgentWorkLog } from "../src/shared/agentWorkLogImport.ts";
import { normalizeAgentSession } from "../src/shared/agentSession.mjs";

const fixture = (name) =>
  JSON.parse(
    fs.readFileSync(new URL(`../fixtures/agent-work-logs/${name}.json`, import.meta.url), "utf8"),
  );
const parse = (value) => parseAgentWorkLog(JSON.stringify(value));

test("five versioned adapters emit the existing Session contract without raw or hidden fields", () => {
  const expected = {
    codex: ["codex", "completed", 1, 1],
    claude: ["claude_code", "completed", 1, 1],
    copilot: ["github_copilot", "unknown", 1, 0],
    opencode: ["opencode", "unknown", 1, 1],
    deepseek: ["deepseek_harness", "interrupted", 1, 1],
  };
  for (const [name, [client, status, requests, responses]] of Object.entries(expected)) {
    const imported = parse(fixture(name));
    assert.equal(imported.client_kind, client, name);
    assert.equal(imported.status, status, name);
    assert.equal(imported.request_events.length, requests, name);
    assert.equal(imported.response_checkpoints.length, responses, name);
    assert.equal(imported.observation.mode, "history");
    const { source_session, ...record } = imported;
    const normalized = normalizeAgentSession({
      ...record,
      id: "canonical-test",
      source_session_id: source_session,
    });
    assert.equal(normalized.observation.adapter, imported.observation.adapter);
    assert.doesNotMatch(
      JSON.stringify(normalized),
      /DO-NOT-IMPORT|DO-NOT-READ|transcriptPath|reasoning|payload/,
    );
  }
});

test("native event identities deduplicate reordered exports and reject content conflicts", () => {
  const data = fixture("codex");
  const expected = parse(data);
  data.payload = [...data.payload].reverse().concat(data.payload[1]);
  assert.deepEqual(parse(data), expected);
  const prompt = data.payload.find((event) => event.prompt);
  prompt.prompt_id = "p1";
  data.payload.push({ ...prompt, prompt: "conflicting request" });
  assert.throws(() => parse(data), /event ID/);
  const native = fixture("deepseek");
  native.payload.events.push({
    ...native.payload.events[0],
    data: { source: { kind: "user" }, content: "conflict" },
  });
  assert.throws(() => parse(native), /seq/);
});

test("text-only allowlist redacts known credentials and paths, and ignores tool/system/injected input", () => {
  const data = fixture("deepseek");
  data.payload.events[0].data.content =
    "api_key=sk-example01234567890123456789 file C:\\Users\\someone\\secret.txt https://example.com/path?token=private#fragment";
  data.payload.events.push({
    seq: 9,
    time: data.payload.events[0].time,
    type: "user/message",
    data: { source: { kind: "injected" }, content: "DO-NOT-IMPORT" },
  });
  data.payload.events.push({
    seq: 10,
    time: data.payload.events[0].time,
    type: "system/message",
    data: { content: "DO-NOT-IMPORT" },
  });
  data.payload.events[1].data.message.content.push(
    { type: "reasoning", text: "DO-NOT-IMPORT" },
    { type: "tool-call", arguments: "DO-NOT-IMPORT" },
  );
  const text = JSON.stringify(parse(data));
  assert.doesNotMatch(text, /sk-example|someone|secret\.txt|token=private|fragment|DO-NOT-IMPORT/);
  assert.match(text, /https:\/\/example.com\/path/);
});

test("partial histories and later resumed turns never claim completion or current live activity", () => {
  const data = fixture("codex");
  data.coverage = "partial";
  assert.equal(parse(data).status, "unknown");
  const native = fixture("deepseek");
  native.payload.events.push({
    seq: 3,
    time: native.payload.events[2].time,
    type: "assistant/message",
    data: { message: { content: "continued answer" } },
  });
  const imported = parse(native);
  assert.equal(imported.status, "unknown");
  assert.equal(imported.outcome.summary, "continued answer");
  assert.equal(imported.ended_at, new Date(native.observed_until).toISOString());
  const ambiguous = fixture("codex");
  ambiguous.payload.push({
    ...ambiguous.payload[0],
    hook_event_name: "SessionStart",
    timestamp: ambiguous.observed_until,
  });
  assert.throws(() => parse(ambiguous), /SessionStart/);
  const unknownReason = fixture("codex");
  unknownReason.payload.find((event) => event.hook_event_name === "SessionEnd").reason = "abnormal";
  assert.equal(parse(unknownReason).status, "unknown");
});

test("unsupported contract/native versions, identity errors and oversized files fail before persistence", () => {
  for (const change of [
    { schema: "tasken-ai-work-log/2" },
    { adapter: "opencode-export/2" },
    { source_session: "another-session" },
    { source_session: "C:/private/session.json" },
    { observed_until: "2020-01-01T00:00:00Z" },
  ]) {
    assert.throws(() => parse({ ...fixture("codex"), ...change }));
  }
  const native = fixture("deepseek");
  native.payload.header.version = 999;
  assert.throws(() => parse(native), /version 4/);
  assert.throws(() => parseAgentWorkLog(" ".repeat(2 * 1024 * 1024 + 1)), /2MB/);
});
