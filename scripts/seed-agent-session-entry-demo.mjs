import { Buffer } from "node:buffer";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { build } from "esbuild";

import { collectAgentHookEvent } from "../src/main/mcp/agentSessionHookCollector.mjs";
import { resolveTaskenDatabasePath } from "../src/shared/taskenPaths.mjs";
import {
  seed as seedMaterialsWorkspace,
  withMaterialsWorkspaceDatabase,
} from "./seed-materials-informatics-workspace.mjs";

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const repositoryRoot = path.dirname(scriptDirectory);
const defaultUserDataPath = path.join(
  repositoryRoot,
  "output",
  "agent-session-entry-demo",
  "userData",
);
const demoMarkerName = ".tasken-agent-session-entry-demo";

let runtimePromise;

function localDateString(date = new Date()) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function parseArguments(argv) {
  const result = {
    userDataPath: defaultUserDataPath,
    date: localDateString(),
  };
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    if (value === "--user-data-dir") {
      const requested = argv[++index];
      if (!requested) throw new Error("--user-data-dirには専用ディレクトリが必要です。");
      result.userDataPath = path.resolve(requested);
    } else if (value === "--date") {
      result.date = String(argv[++index] || "");
    } else {
      throw new Error(`未知の引数です: ${value}`);
    }
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(result.date)) {
    throw new Error("--dateはYYYY-MM-DDで指定してください。");
  }
  return result;
}

function prepareDemoUserData(userDataPath) {
  const resolved = path.resolve(userDataPath);
  if (fs.existsSync(resolved) && fs.lstatSync(resolved).isSymbolicLink()) {
    throw new Error("Agent Session実演用userDataにsymbolic linkは指定できません。");
  }
  fs.mkdirSync(resolved, { recursive: true });
  const markerPath = path.join(resolved, demoMarkerName);
  const entries = fs.readdirSync(resolved);
  const isDefaultDemoRoot = resolved === path.resolve(defaultUserDataPath);
  if (entries.length > 0 && !fs.existsSync(markerPath) && !isDefaultDemoRoot) {
    throw new Error(
      "既存データのあるディレクトリは実演用userDataに指定できません。空の専用ディレクトリを指定してください。",
    );
  }
  fs.writeFileSync(markerPath, `${JSON.stringify({ schema_version: 1 })}\n`, "utf8");
  return resolved;
}

async function loadRuntime() {
  runtimePromise ||= build({
    stdin: {
      contents: `
        export { createTaskenCore } from "./src/main/infrastructure/sqlite/public.ts";
        export { ApplicationCommandService } from "./src/main/services/applicationCommandService.ts";
        export { buildPreview, buildCandidateOperations } from "./src/renderer/src/features/workspace/components/AiProposalPanel.tsx";
      `,
      resolveDir: repositoryRoot,
    },
    bundle: true,
    platform: "node",
    format: "esm",
    write: false,
    logLevel: "silent",
  }).then(
    (result) =>
      import(
        `data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString("base64")}`
      ),
  );
  return runtimePromise;
}

function iso(date, time) {
  return `${date}T${time}+09:00`;
}

function selectDemoRelations(workspace) {
  const themes = Array.isArray(workspace.themes) ? workspace.themes : [];
  const tasks = Array.isArray(workspace.tasks) ? workspace.tasks : [];
  const llzo = themes.find((theme) => theme.code === "MI-LLZO-26") || themes[0];
  const aluminum = themes.find((theme) => theme.code === "CIRC-AL-07") || themes[1] || llzo;
  const taskFor = (theme, offset = 0) =>
    tasks.filter((task) => task.project_id === theme?.id)[offset] || null;
  return {
    codex: { theme: llzo, task: taskFor(llzo, 0) },
    claude_code: { theme: aluminum, task: taskFor(aluminum, 0) },
    github_copilot: { theme: llzo, task: taskFor(llzo, 1) },
  };
}

function collectorOptions({
  userDataPath,
  stateDirectory,
  coreClient,
  relation,
  allowedTranscriptRoots,
}) {
  const themeIds = relation.theme?.id ? relation.theme.id : "";
  const taskIds = relation.task?.id ? relation.task.id : "";
  return {
    stateDirectory,
    coreClient,
    settleDelayMs: 0,
    allowedTranscriptRoots,
    env: {
      TASKEN_USER_DATA_DIR: userDataPath,
      TASKEN_AGENT_SESSION_THEME_IDS: themeIds,
      TASKEN_AGENT_SESSION_TASK_IDS: taskIds,
    },
  };
}

async function sendLifecycle(clientKind, events, options) {
  const results = [];
  for (const event of events) {
    results.push(
      await collectAgentHookEvent(clientKind, event.payload, {
        ...options,
        eventName: event.name,
      }),
    );
  }
  const terminal = results.at(-1);
  if (terminal?.status !== "submitted" && terminal?.status !== "duplicate") {
    throw new Error(
      `${clientKind}のSessionをCoreへ送信できませんでした: ${JSON.stringify(terminal)}`,
    );
  }
  return terminal;
}

function acceptProposal(database, runtime, proposalId) {
  const proposal = database.get("ai_proposal", proposalId);
  if (!proposal) throw new Error(`Agent Session Proposalが見つかりません: ${proposalId}`);
  const workspace = database.loadWorkspace();
  const preview = runtime.buildPreview(proposal, {
    data: workspace,
    themes: workspace.themes || [],
    items: [],
  });
  const candidates = runtime
    .buildCandidateOperations(preview.candidates)
    .map((operation) => ({ type: operation.type, entity: operation.entity }));
  new runtime.ApplicationCommandService(database).execute({
    commandId: `${proposal.id}:accept:v${proposal.version}`,
    name: "ApplyAiProposal",
    payload: {
      proposal: { ...proposal, status: "accepted" },
      candidates,
    },
    actor: { kind: "user", id: "agent-session-entry-demo" },
    source: "main_ui",
    expectedVersions: [{ type: "ai_proposal", id: proposal.id, version: proposal.version }],
    issuedAt: proposal.received_at,
  });
  return database.get("ai_proposal", proposal.id);
}

function transcriptLines(date) {
  return [
    {
      id: "demo-user",
      timestamp: iso(date, "13:16:00"),
      parentId: null,
      type: "user.message",
      data: { content: "raw-demo-user-prompt-must-not-be-persisted" },
    },
    {
      id: "demo-assistant-progress",
      timestamp: iso(date, "13:35:00"),
      parentId: "demo-user",
      type: "assistant.message",
      data: { messageId: "progress", content: "途中結果" },
    },
    {
      id: "demo-tool",
      timestamp: iso(date, "13:45:00"),
      parentId: "demo-assistant-progress",
      type: "tool.execution_complete",
      data: { result: "raw-demo-tool-result-must-not-be-persisted" },
    },
    {
      id: "demo-subagent",
      timestamp: iso(date, "13:49:00"),
      parentId: "demo-tool",
      agentId: "demo-subagent",
      type: "assistant.message",
      data: { messageId: "subagent", content: "raw-demo-subagent-must-not-be-persisted" },
    },
    {
      id: "demo-assistant-final",
      timestamp: iso(date, "13:51:00"),
      parentId: "demo-subagent",
      type: "assistant.message",
      data: {
        messageId: "final",
        content: "EIS特徴量抽出を整理し、境界条件のテスト観点を3件にまとめました。",
        reasoningText: "raw-demo-reasoning-must-not-be-persisted",
      },
    },
  ].map((entry) => JSON.stringify(entry));
}

function demoLifecycles(date, transcriptPath) {
  return [
    {
      clientKind: "codex",
      sourceSession: `demo-codex-${date}`,
      events: [
        {
          name: "SessionStart",
          payload: {
            session_id: `demo-codex-${date}`,
            timestamp: iso(date, "09:10:00"),
            initial_prompt: "XRDピーク自動抽出の境界条件をテストする",
            model: "codex-local-demo",
          },
        },
        {
          name: "UserPromptSubmit",
          payload: {
            session_id: `demo-codex-${date}`,
            timestamp: iso(date, "09:12:00"),
            prompt: "既存fixtureを使って回帰テストを追加してください。",
          },
        },
        {
          name: "Stop",
          payload: {
            session_id: `demo-codex-${date}`,
            timestamp: iso(date, "09:40:00"),
            last_assistant_message: "XRDピーク検出の境界条件を固定し、回帰ケースを追加しました。",
            stop_reason: "end_turn",
          },
        },
        {
          name: "SessionEnd",
          payload: {
            session_id: `demo-codex-${date}`,
            timestamp: iso(date, "09:42:00"),
            reason: "complete",
          },
        },
      ],
    },
    {
      clientKind: "claude_code",
      sourceSession: `demo-claude-${date}`,
      events: [
        {
          name: "SessionStart",
          payload: {
            session_id: `demo-claude-${date}`,
            timestamp: iso(date, "10:05:00"),
            initial_prompt: "再生Alデータ取り込みの単位系と欠損処理をレビューする",
            model: "claude-code-local-demo",
          },
        },
        {
          name: "UserPromptSubmit",
          payload: {
            session_id: `demo-claude-${date}`,
            timestamp: iso(date, "10:08:00"),
            prompt: "取り込み前後で保持すべき不変条件を列挙してください。",
          },
        },
        {
          name: "Stop",
          payload: {
            session_id: `demo-claude-${date}`,
            timestamp: iso(date, "10:36:00"),
            last_assistant_message: "単位換算と欠損補完の責務を分離し、確認事項を2件残しました。",
            stop_reason: "end_turn",
          },
        },
        {
          name: "SessionEnd",
          payload: {
            session_id: `demo-claude-${date}`,
            timestamp: iso(date, "10:38:00"),
            reason: "complete",
          },
        },
      ],
    },
    {
      clientKind: "github_copilot",
      sourceSession: `demo-copilot-${date}`,
      events: [
        {
          name: "sessionStart",
          payload: {
            sessionId: `demo-copilot-${date}`,
            timestamp: Date.parse(iso(date, "13:15:00")),
            initialPrompt: "EISスペクトルの特徴量抽出をリファクタリングする",
            source: "new",
          },
        },
        {
          name: "userPromptSubmitted",
          payload: {
            sessionId: `demo-copilot-${date}`,
            timestamp: Date.parse(iso(date, "13:18:00")),
            prompt: "境界条件をテストで説明できる形にしてください。",
          },
        },
        {
          name: "agentStop",
          payload: {
            sessionId: `demo-copilot-${date}`,
            timestamp: Date.parse(iso(date, "13:51:00")),
            transcriptPath,
            stopReason: "end_turn",
            stop_hook_active: false,
          },
        },
        {
          name: "sessionEnd",
          payload: {
            sessionId: `demo-copilot-${date}`,
            timestamp: Date.parse(iso(date, "13:52:00")),
            reason: "complete",
          },
        },
      ],
    },
  ];
}

async function seedAgentSessionEntryDemo({
  userDataPath = defaultUserDataPath,
  date = localDateString(),
} = {}) {
  const resolvedUserDataPath = prepareDemoUserData(userDataPath);
  const databasePath = resolveTaskenDatabasePath({
    env: { TASKEN_USER_DATA_DIR: resolvedUserDataPath },
  });
  const transientDirectory = path.join(resolvedUserDataPath, ".agent-session-demo-transient");
  const stateDirectory = path.join(resolvedUserDataPath, "agent-session-observations");
  fs.rmSync(stateDirectory, { recursive: true, force: true });
  fs.rmSync(transientDirectory, { recursive: true, force: true });
  const base = seedMaterialsWorkspace(databasePath);
  const runtime = await loadRuntime();
  const transcriptPath = path.join(transientDirectory, "github-copilot-transcript.jsonl");
  fs.mkdirSync(transientDirectory, { recursive: true });
  fs.writeFileSync(transcriptPath, `${transcriptLines(date).join("\n")}\n`, "utf8");

  try {
    return await withMaterialsWorkspaceDatabase(databasePath, async (database) => {
      const core = runtime.createTaskenCore(database);
      const coreClient = {
        getAgentSessionContext: (request) => core.getAgentSessionContext.execute(request),
        proposeAgentSession: (request) => core.proposeAgentSession.execute(request),
      };
      const relations = selectDemoRelations(database.loadWorkspace());
      const submissions = [];
      for (const lifecycle of demoLifecycles(date, transcriptPath)) {
        const terminal = await sendLifecycle(
          lifecycle.clientKind,
          lifecycle.events,
          collectorOptions({
            userDataPath: resolvedUserDataPath,
            stateDirectory,
            coreClient,
            relation: relations[lifecycle.clientKind],
            allowedTranscriptRoots: [transientDirectory],
          }),
        );
        const proposal = acceptProposal(database, runtime, terminal.proposal_id);
        submissions.push({
          client_kind: lifecycle.clientKind,
          source_session_id: lifecycle.sourceSession,
          proposal_id: proposal.id,
          proposal_status: proposal.status,
          source_app: proposal.source_app,
        });
      }

      const workspace = database.loadWorkspace();
      const storedSessions = workspace.agent_sessions
        .filter((session) =>
          submissions.some((entry) => entry.source_session_id === session.source_session_id),
        )
        .sort((left, right) => left.started_at.localeCompare(right.started_at));
      const sessions = storedSessions.map((session) => ({
        id: session.id,
        client_kind: session.client_kind,
        source_session_id: session.source_session_id,
        started_at: session.started_at,
        ended_at: session.ended_at,
        intent: session.intent?.summary || "",
        outcome: session.outcome?.summary || "",
        status: session.status,
        request_event_count: session.request_events.length,
        response_checkpoint_count: session.response_checkpoints.length,
      }));
      const sessionIds = new Set(sessions.map((session) => session.id));
      const activityEventCount = workspace.change_events.filter(
        (event) => event.entity_type === "agent_session" && sessionIds.has(event.entity_id),
      ).length;
      const proposals = submissions.map((submission) =>
        database.get("ai_proposal", submission.proposal_id, true),
      );
      const serializedCanonical = JSON.stringify({ sessions: storedSessions, proposals });
      const forbiddenValuesFound = [
        "raw-demo-user-prompt-must-not-be-persisted",
        "raw-demo-tool-result-must-not-be-persisted",
        "raw-demo-subagent-must-not-be-persisted",
        "raw-demo-reasoning-must-not-be-persisted",
        "github-copilot-transcript.jsonl",
      ].filter((value) => serializedCanonical.includes(value));

      return {
        userDataPath: resolvedUserDataPath,
        databasePath,
        date,
        baseSnapshotPath: base.snapshotPath,
        sessions,
        submissions,
        activityEventCount,
        forbiddenValuesFound,
        launch: {
          environment: { TASKEN_DEV_USER_DATA_DIR: resolvedUserDataPath },
          command: "npm run dev",
        },
      };
    });
  } finally {
    fs.rmSync(transientDirectory, { recursive: true, force: true });
  }
}

export { defaultUserDataPath, localDateString, parseArguments, seedAgentSessionEntryDemo };

const isMain =
  process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url));
if (isMain) {
  const options = parseArguments(process.argv.slice(2));
  const result = await seedAgentSessionEntryDemo(options);
  console.log(JSON.stringify(result, null, 2));
}
