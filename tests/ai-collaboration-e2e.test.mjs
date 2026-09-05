import assert from "node:assert/strict";
import { Buffer } from "node:buffer";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { build } from "esbuild";

import { WorkspaceDatabase } from "../src/main/repositories/workspaceRepository.mjs";
import { formatTaskLocator } from "../src/shared/contracts/mobile/public.mjs";

async function importBundled(relativePath) {
  const result = await build({
    entryPoints: [path.resolve(relativePath)],
    bundle: true,
    platform: "node",
    format: "esm",
    plugins: [
      {
        name: "electron-mock",
        setup(buildApi) {
          buildApi.onResolve({ filter: /^electron$/ }, () => ({
            path: "electron-mock",
            namespace: "electron-mock",
          }));
          buildApi.onLoad({ filter: /.*/, namespace: "electron-mock" }, () => ({
            contents:
              "export const nativeImage={createFromBuffer:()=>({isEmpty:()=>true,getSize:()=>({width:0,height:0})})};",
            loader: "js",
          }));
        },
      },
    ],
    write: false,
    logLevel: "silent",
  });
  return import(
    `data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString("base64")}`
  );
}

const { ApplicationCommandService } = await importBundled(
  "src/main/services/applicationCommandService.ts",
);
const { TaskenCoreHost } = await importBundled("src/main/infrastructure/http/taskenCoreHost.ts");
const { createTaskenCore } = await importBundled("src/main/infrastructure/sqlite/public.ts");
const { TaskCapabilityService } = await importBundled("src/main/modules/task/public.ts");
const { TaskenDesktopComposition } = await importBundled(
  "src/main/composition/taskenDesktopComposition.ts",
);

const FIXED_AT = "2026-08-09T04:00:00.000Z";
const TASK_ID = "task /?#%+@ 日本語🚀";
const THEME_ID = "theme-ai-collaboration-e2e";
const NOTE_ID = "note-ai-collaboration-e2e";
const REPOSITORY_CONTEXT_ID = "repository-ai-collaboration-e2e";
const REPOSITORY_CONTEXT = {
  repository_context_id: REPOSITORY_CONTEXT_ID,
  provider: "github",
  repository_slug: "mryk814/tasuken",
  branch: "codex/issue-364-ai-collaboration-e2e",
};

const FAKE_PROVIDERS = [
  { provider: "fixture-provider-a", model: "fixture-model-a" },
  { provider: "fixture-provider-b", model: "fixture-model-b" },
];

function assertDiscoveryOwnerOnly(root) {
  if (typeof process.getuid !== "function") return;
  assert.equal(fs.statSync(path.join(root, "tasken-core.json")).mode & 0o077, 0);
}

function command(name, payload, commandId, expectedVersions = [], options = {}) {
  return {
    commandId,
    name,
    payload,
    actor: options.actor || { kind: "user", id: "fixture-user" },
    source: options.source || "main_ui",
    expectedVersions,
    issuedAt: FIXED_AT,
  };
}

function sorted(records) {
  return [...records].sort((left, right) => String(left.id).localeCompare(String(right.id)));
}

function durableSnapshot(database) {
  return JSON.stringify({
    task: database.get("task", TASK_ID),
    receipts: sorted(database.list("work_receipt")),
    proposals: sorted(database.list("ai_proposal", true)),
    events: sorted(database.list("change_event", true)),
  });
}

function createLegacyFixture() {
  // Keep discovery on a POSIX filesystem so its owner-only mode is meaningful under WSL.
  const root = fs.mkdtempSync(path.join(process.cwd(), ".tasken-ai-collaboration-e2e-"));
  const dbPath = path.join(root, "workspace.sqlite");
  const database = new WorkspaceDatabase(dbPath);
  database.bootstrap({
    themes: [
      {
        id: THEME_ID,
        name: "Legacy AI collaboration Theme",
        code: "AIE2E",
        default_ai_visibility: ["coding_agent"],
      },
    ],
    tasks: [
      {
        id: TASK_ID,
        title: "Legacy Task for AI collaboration",
        description: "The Task body must survive every AI proposal unchanged.",
        state: "todo",
        theme_id: THEME_ID,
      },
    ],
    notes: [
      {
        id: NOTE_ID,
        title: "Implementation context",
        body_markdown: "Use the typed proposal and human review boundaries.",
        theme_id: THEME_ID,
        ai_visibility: ["coding_agent"],
        ai_summary: "Typed proposal implementation context",
      },
    ],
  });

  const legacyTask = database.get("task", TASK_ID);
  assert.equal(legacyTask.requester, undefined);
  assert.equal(legacyTask.intended_executor, undefined);
  assert.equal(legacyTask.project_id, undefined);

  database.save("repository_context", {
    id: REPOSITORY_CONTEXT_ID,
    label: "Tasuken",
    provider: "github",
    canonical_url: "https://github.com/mryk814/tasuken",
    repository_slug: "mryk814/tasuken",
    default_branch: "main",
    active: true,
  });
  database.save("theme", {
    ...database.get("theme", THEME_ID),
    repository_context_ids: [REPOSITORY_CONTEXT_ID],
    primary_repository_context_id: REPOSITORY_CONTEXT_ID,
  });

  const service = new ApplicationCommandService(database);
  service.execute(
    command(
      "UpdateTask",
      {
        task: {
          ...legacyTask,
          priority: "normal",
          project_id: THEME_ID,
          requester: "human",
          intended_executor: "ai_agent",
          executor_identity: "fixture-agent",
          work_state: "ready_for_agent",
          repository_context_ids: [REPOSITORY_CONTEXT_ID],
          primary_repository_context_id: REPOSITORY_CONTEXT_ID,
        },
      },
      "migrate-and-assign-task",
      [{ type: "task", id: TASK_ID, version: legacyTask.version }],
    ),
  );
  database.save("reference", {
    id: "reference-note-task-e2e",
    source_type: "note",
    source_id: NOTE_ID,
    target_type: "task",
    target_id: TASK_ID,
    relation_type: "supports",
  });

  return { root, dbPath, database, service: new ApplicationCommandService(database) };
}

async function connectMcp(dbPath, inboxPath, userDataPath = path.dirname(dbPath)) {
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: ["scripts/mcp-server.mjs"],
    env: {
      ...process.env,
      TASKEN_DB_PATH: dbPath,
      TASKEN_MCP_INBOX_PATH: inboxPath,
      TASKEN_USER_DATA_DIR: userDataPath,
    },
    stderr: "pipe",
  });
  const client = new Client({ name: "tasken-ai-collaboration-e2e", version: "1.0.0" });
  await client.connect(transport);
  return client;
}

async function callTaskWork(client, toolName, args) {
  const result = await client.callTool({ name: toolName, arguments: args });
  assert.equal(result.isError, undefined, JSON.stringify(result));
  return result.structuredContent;
}

function canonicalProposal(database, proposalId, root) {
  assert.equal(fs.existsSync(path.join(root, "mcp-inbox")), false);
  const proposal = database.get("ai_proposal", proposalId);
  assert.ok(proposal);
  return proposal;
}

function proposalDecisionCommand(
  database,
  proposal,
  decision,
  commandId = `${proposal.id}:${decision}`,
) {
  const task = database.get("task", TASK_ID);
  return command(
    "ApplyTaskWorkProposal",
    {
      proposalId: proposal.id,
      decision,
    },
    commandId,
    [
      { type: "task", id: TASK_ID, version: task.version },
      { type: "ai_proposal", id: proposal.id, version: proposal.version },
    ],
  );
}

function decideProposal(
  service,
  database,
  proposal,
  decision,
  commandId = `${proposal.id}:${decision}`,
) {
  return service.execute(proposalDecisionCommand(database, proposal, decision, commandId));
}

function receiptArguments(provider, expectedVersion, idempotencyKey, summary) {
  return {
    task_id: TASK_ID,
    expected_version: expectedVersion,
    idempotency_key: idempotencyKey,
    caller: "Fixture agent",
    source_session: "fixture-session",
    source_app: "fixture-provider-adapter",
    repository_context: REPOSITORY_CONTEXT,
    executor_kind: "ai_agent",
    executor_label: "Fixture agent",
    summary,
    completed_items: ["typed command boundary"],
    changed_or_created_items: ["tests/ai-collaboration-e2e.test.mjs"],
    verification: ["actual stdio MCP"],
    remaining_work: [],
    external_references: [
      {
        kind: "issue",
        provider: "github",
        display_label: "#364",
        url: "https://github.com/mryk814/tasuken/issues/364?utm_source=fixture#evidence",
        external_id: "364",
      },
    ],
    reported_at: FIXED_AT,
    provider: provider.provider,
    model: provider.model,
  };
}

function injectProposalDecisionFailure(database) {
  const normalRunTransaction = database.runTransaction.bind(database);
  database.runTransaction = (callback) =>
    normalRunTransaction((repository) =>
      callback({
        ...repository,
        saveMany(operations) {
          const result = repository.saveMany(operations);
          if (
            operations.some(
              (operation) =>
                operation.type === "ai_proposal" && operation.entity?.status === "accepted",
            )
          ) {
            throw new Error("injected proposal decision failure");
          }
          return result;
        },
      }),
    );
  return () => {
    database.runTransaction = normalRunTransaction;
  };
}

function semanticContract(database, finalContext) {
  const task = database.get("task", TASK_ID);
  const proposals = sorted(database.list("ai_proposal")).map((proposal) => ({
    payload_type: proposal.payload_type,
    action: proposal.payload.task_work[0].action,
    status: proposal.status,
    repository_context: proposal.payload.task_work[0].repository_context,
  }));
  const receipts = sorted(database.list("work_receipt")).map((receipt) => ({
    task_id: receipt.task_id,
    executor_kind: receipt.executor_kind,
    summary: receipt.summary,
    repository_context: receipt.repository_context,
    runtime_metadata: receipt.runtime_metadata,
    provenance: {
      reported_via: receipt.provenance?.reported_via,
      imported_by: receipt.provenance?.imported_by,
    },
    external_references: receipt.external_references,
  }));
  return {
    task: {
      id: task.id,
      state: task.state,
      work_state: task.work_state,
      requester: task.requester,
      intended_executor: task.intended_executor,
      description: task.description,
      repository_context_ids: task.repository_context_ids,
    },
    repository_locator: finalContext.repository_contexts.map((context) => ({
      id: context.id,
      provider: context.provider,
      repository_slug: context.repository_slug,
      default_branch: context.default_branch,
    })),
    proposals,
    receipts,
    context: {
      task_id: finalContext.task.id,
      assignment: finalContext.assignment,
      work_receipts: finalContext.related.work_receipts.map((receipt) => ({
        task_id: receipt.task_id,
        summary: receipt.summary,
        runtime_metadata: receipt.runtime_metadata,
      })),
      has_receipt_backlink: finalContext.context_graph.edges.some(
        (edge) =>
          edge.source.type === "work_receipt" &&
          edge.target.type === "task" &&
          edge.target.id === TASK_ID &&
          edge.predicate === "created_for",
      ),
    },
  };
}

function withoutRuntimeProvenance(contract) {
  return {
    ...contract,
    receipts: contract.receipts.map(
      ({ runtime_metadata: _runtimeMetadata, ...receipt }) => receipt,
    ),
    context: {
      ...contract.context,
      work_receipts: contract.context.work_receipts.map(
        ({ runtime_metadata: _runtimeMetadata, ...receipt }) => receipt,
      ),
    },
  };
}

async function runProviderScenario(provider, explicitStart = false) {
  const fixture = createLegacyFixture();
  const notifiedTasks = new Map();
  const composition = explicitStart
    ? new TaskenDesktopComposition({
        userDataPath: fixture.root,
        persistence: fixture.database,
        onCoreCommandCommitted: (receipt) => {
          for (const change of receipt.changes) {
            if (change.type === "task") notifiedTasks.set(change.entity.id, change.entity);
          }
        },
      })
    : null;
  const taskCapability =
    composition?.taskCapability ||
    new TaskCapabilityService(fixture.database, (envelope) => fixture.service.execute(envelope));
  let host = new TaskenCoreHost({
    userDataPath: fixture.root,
    ...createTaskenCore(fixture.database),
    taskCommand: { execute: taskCapability.executeCommand.bind(taskCapability) },
  });
  await host.start();
  assertDiscoveryOwnerOnly(fixture.root);
  let client = await connectMcp(fixture.dbPath, path.join(fixture.root, "mcp-inbox"), fixture.root);
  try {
    const assigned = fixture.database.get("task", TASK_ID);
    const beforeRead = durableSnapshot(fixture.database);
    const ready = await callTaskWork(client, "tasken.list_agent_ready_tasks", {});
    assert.ok(ready.tasks.some((task) => task.id === TASK_ID));
    const context = await callTaskWork(client, "tasken.get_task_context", {
      task_id: TASK_ID,
      workspace: {
        remote_url: "https://github.com/mryk814/tasuken.git",
        branch: REPOSITORY_CONTEXT.branch,
      },
    });
    assert.equal(context.task.id, TASK_ID);
    assert.equal(context.assignment.requester, "human");
    assert.equal(context.assignment.intended_executor, "ai_agent");
    assert.equal(context.workspace_match.status, "matched");
    assert.equal(context.repository_contexts[0].id, REPOSITORY_CONTEXT_ID);
    assert.equal("local_path" in context.repository_contexts[0], false);
    assert.ok(context.related.notes.some((note) => note.id === NOTE_ID));
    assert.equal(
      durableSnapshot(fixture.database),
      beforeRead,
      "listing and context must not start work",
    );

    let progressVersion = context.task.version;
    if (explicitStart) {
      const startArguments = {
        task_id: TASK_ID,
        expected_version: progressVersion,
        idempotency_key: "fixture-explicit-start",
        caller: "Fixture agent",
        source_session: "fixture-session",
        started_at: FIXED_AT,
      };
      const started = await callTaskWork(client, "tasken.start_task_work", startArguments);
      assert.equal(started.ok, true, JSON.stringify(started));
      assert.equal(started.value.task.work_state, "in_progress");
      progressVersion = started.value.task.version;
      assert.ok(progressVersion > assigned.version);
      assert.equal(fixture.database.get("task", TASK_ID).version, progressVersion);
      assert.equal(
        notifiedTasks.get(TASK_ID)?.version,
        progressVersion,
        "Desktop must notify the same committed version before an AI proposal arrives",
      );
      assert.equal(notifiedTasks.get(TASK_ID)?.work_state, "in_progress");
      assert.equal(fixture.database.list("ai_proposal").length, 0);
      const afterStart = durableSnapshot(fixture.database);
      await callTaskWork(client, "tasken.start_task_work", startArguments);
      assert.equal(
        durableSnapshot(fixture.database),
        afterStart,
        "start retry must not duplicate writes",
      );
      const remaining = await callTaskWork(client, "tasken.list_agent_ready_tasks", {});
      assert.equal(
        remaining.tasks.some((task) => task.id === TASK_ID),
        false,
      );
    }

    const progressArguments = receiptArguments(
      provider,
      progressVersion,
      "fixture-progress-1",
      "Interim receipt remains in progress.",
    );
    const queuedProgress = await callTaskWork(
      client,
      "tasken.append_work_receipt",
      progressArguments,
    );
    let progressProposal = canonicalProposal(
      fixture.database,
      queuedProgress.proposal_id,
      fixture.root,
    );
    assert.equal(
      fixture.database.list("work_receipt").length,
      0,
      "proposal waits for human adoption",
    );
    assert.equal(fixture.database.get("task", TASK_ID).version, progressVersion);
    progressProposal = fixture.database.save("ai_proposal", {
      ...progressProposal,
      payload: {
        task_work: [
          {
            ...progressProposal.payload.task_work[0],
            runtime_metadata: {
              ...progressProposal.payload.task_work[0].runtime_metadata,
              secret: "must-not-persist",
              diagnostic_path: "C:/private/provider.log",
            },
          },
        ],
      },
    });
    decideProposal(fixture.service, fixture.database, progressProposal, "accept");
    assert.equal(fixture.database.get("task", TASK_ID).work_state, "in_progress");
    assert.equal(
      fixture.database.get("task", TASK_ID).description,
      "The Task body must survive every AI proposal unchanged.",
    );
    assert.equal(fixture.database.list("work_receipt").length, 1);
    assert.deepEqual(fixture.database.get("work_receipt", progressProposal.id).runtime_metadata, {
      ...provider,
      report_kind: "progress",
    });
    const implicitStartEvent = fixture.database
      .list("change_event")
      .find(
        (event) =>
          event.command_id === `${progressProposal.id}:accept:work:start` &&
          event.metadata?.work_action === "started",
      );
    if (explicitStart) {
      assert.equal(
        implicitStartEvent,
        undefined,
        "receipt adoption must not start an active Task again",
      );
    } else {
      assert.ok(
        implicitStartEvent,
        `implicit start event missing: ${JSON.stringify(
          fixture.database
            .list("change_event")
            .filter((event) => event.command_id.startsWith(`${progressProposal.id}:accept:work`)),
        )}`,
      );
      assert.deepEqual(implicitStartEvent.metadata.repository_context, REPOSITORY_CONTEXT);
    }
    assert.equal(
      fixture.database
        .list("ai_proposal")
        .some((entry) => entry.payload?.task_work?.[0]?.action === "start"),
      false,
    );

    const rejectedDoneArguments = receiptArguments(
      provider,
      fixture.database.get("task", TASK_ID).version,
      "fixture-done-rejected",
      "This report is rejected by the human reviewer.",
    );
    const queuedRejected = await callTaskWork(
      client,
      "tasken.report_task_done",
      rejectedDoneArguments,
    );
    const rejectedProposal = canonicalProposal(
      fixture.database,
      queuedRejected.proposal_id,
      fixture.root,
    );
    const beforeRejectTask = fixture.database.get("task", TASK_ID);
    decideProposal(fixture.service, fixture.database, rejectedProposal, "reject");
    assert.equal(fixture.database.get("ai_proposal", rejectedProposal.id).status, "rejected");
    assert.deepEqual(fixture.database.get("task", TASK_ID), beforeRejectTask);
    assert.equal(fixture.database.list("work_receipt").length, 1);

    const doneArguments = receiptArguments(
      provider,
      fixture.database.get("task", TASK_ID).version,
      "fixture-done-accepted",
      "Implementation is ready for human review.",
    );
    const queuedDone = await callTaskWork(client, "tasken.report_task_done", doneArguments);
    const doneProposal = canonicalProposal(fixture.database, queuedDone.proposal_id, fixture.root);

    const beforeRollback = durableSnapshot(fixture.database);
    const restoreTransactions = injectProposalDecisionFailure(fixture.database);
    assert.throws(
      () =>
        decideProposal(
          fixture.service,
          fixture.database,
          doneProposal,
          "accept",
          `${doneProposal.id}:rollback`,
        ),
      /injected proposal decision failure/,
    );
    restoreTransactions();
    assert.equal(durableSnapshot(fixture.database), beforeRollback);
    assert.equal(fixture.database.get("ai_proposal", doneProposal.id).status, "pending");

    const doneDecision = proposalDecisionCommand(fixture.database, doneProposal, "accept");
    const acceptedDone = fixture.service.execute(doneDecision);
    assert.equal(fixture.database.get("task", TASK_ID).work_state, "accepted");
    assert.equal(fixture.database.get("task", TASK_ID).state, "done");
    assert.equal(fixture.database.list("work_receipt").length, 2);
    const countsBeforeRetry = {
      receipts: fixture.database.list("work_receipt").length,
      proposals: fixture.database.list("ai_proposal").length,
      events: fixture.database.list("change_event").length,
    };
    const retryDone = fixture.service.execute(doneDecision);
    assert.deepEqual(retryDone, acceptedDone);
    assert.deepEqual(
      {
        receipts: fixture.database.list("work_receipt").length,
        proposals: fixture.database.list("ai_proposal").length,
        events: fixture.database.list("change_event").length,
      },
      countsBeforeRetry,
    );

    const reviewTask = fixture.database.get("task", TASK_ID);
    assert.throws(
      () =>
        fixture.service.execute(
          command(
            "CompleteTask",
            { taskId: TASK_ID },
            "ai-direct-complete",
            [{ type: "task", id: TASK_ID, version: reviewTask.version }],
            { actor: { kind: "ai_agent", id: "fixture-agent" }, source: "mcp" },
          ),
        ),
      /AI agentはTaskを直接変更・完了できません/,
    );
    assert.throws(
      () =>
        fixture.service.execute(
          command(
            "UpdateTask",
            { task: { ...reviewTask, description: "destructive overwrite" } },
            "ai-destructive-overwrite",
            [{ type: "task", id: TASK_ID, version: reviewTask.version }],
            { actor: { kind: "ai_agent", id: "fixture-agent" }, source: "mcp" },
          ),
        ),
      /AI agentはTaskを直接変更・完了できません/,
    );
    assert.throws(
      () =>
        fixture.database.save("task", {
          ...reviewTask,
          work_state: "needs_human_review",
        }),
      /work_state=accepted/,
    );

    await client.close();
    await host.stop();
    fixture.database.db.close();
    fixture.database = new WorkspaceDatabase(fixture.dbPath);
    fixture.service = new ApplicationCommandService(fixture.database);
    host = new TaskenCoreHost({
      userDataPath: fixture.root,
      ...createTaskenCore(fixture.database),
    });
    await host.start();
    assertDiscoveryOwnerOnly(fixture.root);
    client = await connectMcp(fixture.dbPath, path.join(fixture.root, "mcp-inbox"), fixture.root);
    const finalContext = await callTaskWork(client, "tasken.get_task_context", {
      task_locator: formatTaskLocator(TASK_ID),
    });
    assert.equal(finalContext.task.state, "done");
    assert.equal(finalContext.related.work_receipts.length, 2);
    assert.ok(finalContext.context_graph.edges.some((edge) => edge.predicate === "created_for"));
    assert.ok(
      fixture.database
        .list("change_event")
        .some(
          (event) =>
            event.event_kind === "task_completed" && event.metadata?.work_action === "accepted",
        ),
    );
    return semanticContract(fixture.database, finalContext);
  } finally {
    await client.close().catch(() => {});
    // A failed scenario may already have stopped or partially started the host; cleanup must not hide the original assertion.
    await host.stop().catch(() => {});
    fixture.database.db.close();
    fs.rmSync(fixture.root, { recursive: true, force: true });
  }
}

test("legacy SQLite + actual stdio MCPでAI協働をhuman completionまで原子的に再現する (#364)", async () => {
  const contracts = [];
  for (const provider of FAKE_PROVIDERS) contracts.push(await runProviderScenario(provider));

  assert.deepEqual(withoutRuntimeProvenance(contracts[0]), withoutRuntimeProvenance(contracts[1]));
  assert.deepEqual(
    contracts.map((contract) => contract.receipts.map((receipt) => receipt.runtime_metadata)),
    FAKE_PROVIDERS.map((provider) => [
      { ...provider, report_kind: "progress" },
      { ...provider, report_kind: "done" },
    ]),
  );
  assert.deepEqual(
    contracts.map((contract) =>
      contract.context.work_receipts.map((receipt) => receipt.runtime_metadata),
    ),
    FAKE_PROVIDERS.map((provider) => [
      { ...provider, report_kind: "done" },
      { ...provider, report_kind: "progress" },
    ]),
  );
});

test("AI Ready discovery + explicit MCP start uses the returned version through human adoption and restart", async () => {
  await runProviderScenario(FAKE_PROVIDERS[0], true);
});
