import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

import {
  normalizeAgentSession,
  normalizeWorkingCopy,
  publicAgentSession,
  publicWorkingCopy,
} from "../src/shared/agentSession.mjs";
import { normalizeEntity, validateEntity } from "../src/main/repositories/domain.mjs";
import { normalizeReferenceAssertion } from "../src/shared/relationAssertion.mjs";
import { WorkspaceDatabase } from "../src/main/repositories/workspaceRepository.mjs";

const activeSession = (overrides = {}) => ({
  id: "session-1",
  started_at: "2026-08-25T08:00:00.000Z",
  status: "active",
  client_kind: "codex",
  source_session_id: "codex-thread-1",
  intent: {
    summary: "Issue #498のsession provenanceを接続する",
    requested_outcome: "canonical contractと保存境界を通す",
    boundary: "実描画signoffは別にする",
  },
  ...overrides,
});

test("WorkingCopy uses opaque identity and never accepts a local path", () => {
  const normalized = normalizeWorkingCopy({
    id: "wc-1",
    repository_context_id: "repo-1",
    device_id: "device-home",
    storage_root_id: "root-tasuken",
    worktree_identity: "codex/498-agent-session",
    local_path: "C:\\Users\\private\\tasuken",
  });

  assert.equal(normalized.repository_context_id, "repo-1");
  assert.equal("local_path" in normalized, false);
  assert.equal("local_path" in publicWorkingCopy(normalized), false);
  assert.throws(
    () =>
      normalizeWorkingCopy({
        repository_context_id: "repo-1",
        device_id: "device-home",
        storage_root_id: "C:\\private",
      }),
    /opaque ID/,
  );
});

test("AgentSession keeps start intent separate from structured outcome", () => {
  const completed = normalizeAgentSession(
    activeSession({
      status: "completed",
      ended_at: "2026-08-25T09:00:00.000Z",
      outcome: {
        summary: "canonical contractを追加した",
        decisions: ["WorkingCopyの名称を採用"],
        changed_items: ["agentSession.mjs"],
        verification: ["contract test pass"],
        remaining_work: ["MCP proposalを接続"],
        next_suggested_action: "Codex adapterを追加する",
      },
      raw_transcript: "must not persist",
    }),
  );

  assert.equal(completed.intent.summary, activeSession().intent.summary);
  assert.equal(completed.outcome.summary, "canonical contractを追加した");
  assert.equal("raw_transcript" in completed, false);
  assert.deepEqual(publicAgentSession(completed).outcome.remaining_work, ["MCP proposalを接続"]);
});

test("AgentSession validates lifecycle invariants", () => {
  assert.throws(
    () => normalizeAgentSession(activeSession({ ended_at: "2026-08-25T09:00:00.000Z" })),
    /active session/,
  );
  assert.throws(() => normalizeAgentSession(activeSession({ status: "completed" })), /ended_at/);
  assert.throws(
    () =>
      normalizeAgentSession(
        activeSession({ status: "completed", ended_at: "2026-08-25T09:00:00.000Z" }),
      ),
    /outcome/,
  );
  assert.throws(
    () => normalizeAgentSession(activeSession({ client_kind: "codex_raw_v3" })),
    /client_kind/,
  );
});

test("repository domain persists only canonical WorkingCopy and AgentSession fields", () => {
  const workingCopy = normalizeEntity("working_copy", {
    id: "wc-1",
    repository_context_id: "repo-1",
    device_id: "device-home",
    storage_root_id: "root-tasuken",
    absolute_path: "C:\\private\\tasuken",
  });
  const session = normalizeEntity("agent_session", {
    ...activeSession(),
    provider_raw_response: { secret: true },
  });

  assert.equal("absolute_path" in workingCopy, false);
  assert.equal("provider_raw_response" in session, false);
  assert.doesNotThrow(() => validateEntity("working_copy", workingCopy));
  assert.doesNotThrow(() => validateEntity("agent_session", session));
});

test("AgentSession can relate to multiple tasks, repositories, working copies, and receipts", () => {
  for (const [targetType, targetId, predicate] of [
    ["project", "theme-1", "worked_on"],
    ["task", "task-1", "worked_on"],
    ["task", "task-2", "worked_on"],
    ["repository_context", "repo-1", "worked_on"],
    ["working_copy", "wc-1", "executed_in"],
    ["work_receipt", "receipt-1", "produced"],
    ["change_event", "event-1", "produced"],
  ]) {
    const reference = normalizeReferenceAssertion(
      {
        id: `ref-${targetType}-${targetId}`,
        source_type: "agent_session",
        source_id: "session-1",
        target_type: targetType,
        target_id: targetId,
        relation_type: predicate,
        layer: "provenance",
        origin: "system_action",
      },
      { writeBoundary: true },
    );
    assert.equal(reference.subject.type, "agent_session");
    assert.equal(reference.object.type, targetType);
  }
});

test("WorkingCopy and AgentSession survive canonical SQLite save and reload", () => {
  const root = fs.mkdtempSync(path.join(process.cwd(), ".tasken-agent-session-"));
  const database = new WorkspaceDatabase(path.join(root, "workspace.sqlite"));
  try {
    database.save("repository_context", {
      id: "repo-1",
      label: "tasuken",
      provider: "github",
      canonical_url: "https://github.com/mryk814/tasuken",
    });
    const workingCopy = database.save("working_copy", {
      id: "wc-1",
      repository_context_id: "repo-1",
      device_id: "device-home",
      storage_root_id: "root-tasuken",
      absolute_path: "C:\\private\\tasuken",
    });
    const session = database.save("agent_session", activeSession());
    database.save("reference", {
      id: "ref-session-repo",
      source_type: "agent_session",
      source_id: session.id,
      target_type: "repository_context",
      target_id: "repo-1",
      relation_type: "worked_on",
      layer: "provenance",
      origin: "system_action",
    });
    database.save("reference", {
      id: "ref-session-working-copy",
      source_type: "agent_session",
      source_id: session.id,
      target_type: "working_copy",
      target_id: workingCopy.id,
      relation_type: "executed_in",
      layer: "provenance",
      origin: "system_action",
    });

    assert.equal(database.get("working_copy", "wc-1").storage_root_id, "root-tasuken");
    assert.equal("absolute_path" in database.get("working_copy", "wc-1"), false);
    assert.equal(
      database.get("agent_session", "session-1").intent.summary,
      activeSession().intent.summary,
    );
    assert.equal(
      database.list("reference").filter((entry) => entry.source_id === "session-1").length,
      2,
    );

    database.remove("repository_context", "repo-1");
    assert.equal(database.get("working_copy", "wc-1"), null);
    database.restore("repository_context", "repo-1");
    assert.equal(database.get("working_copy", "wc-1").repository_context_id, "repo-1");
  } finally {
    database.db.close();
    fs.rmSync(root, { recursive: true, force: true });
  }
});
