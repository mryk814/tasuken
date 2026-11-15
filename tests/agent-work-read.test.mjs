// AI の作業（#751 PR 2）の読む側。古い会話（agent_session）と新しい記録（agent_work_record）を
// 1 つの読み替え（→ 同じカードの形）で読むこと、そのカードから日誌の出力・近況の気づき・
// MCP の読む道具・Mobile Gateway の今日が作られること。古い APK に返す形は変えない。
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test, { after } from "node:test";
import { pathToFileURL } from "node:url";

import { build } from "esbuild";

import { TaskenCoreClient } from "../src/main/mcp/taskenCoreClient.mjs";
import { WorkspaceDatabase } from "../src/main/repositories/workspaceRepository.mjs";
import {
  agentWorkCardFromRecord,
  agentWorkCardFromSession,
  agentWorkCardHeadline,
  agentWorkCardInDateRange,
  agentWorkCardInterval,
  agentWorkCardUnresolved,
  buildAgentSessionLinks,
  listAgentWorkCards,
} from "../src/shared/agentWorkCard.ts";
import {
  agentWorkCardSchema,
  getAgentSessionContextClientResponseSchema,
  getAgentSessionContextResponseSchema,
} from "../src/shared/contracts/task/public.ts";

const bundles = fs.mkdtempSync(path.join(process.cwd(), ".agent-work-read-test-"));
after(() => fs.rmSync(bundles, { recursive: true, force: true }));
await build({
  stdin: {
    contents: `
    export { TaskenDesktopComposition } from "./src/main/composition/taskenDesktopComposition.ts";
    export { WorkspaceService } from "./src/main/services/workspaceService.ts";
    export { TASKEN_MOBILE_ENDPOINTS, mobileTodayResponseSchema } from "./src/shared/contracts/mobile/public.ts";
    export { appendActivitySessionsToLog } from "./src/renderer/src/features/workspace/lib/activityLog.ts";
    export {
      buildDailyAgentSessionContexts,
      projectActivitySessionLogEntries,
    } from "./src/renderer/src/features/workspace/lib/activityTimeline.ts";
    export {
      buildPostsFromAgentWork,
      feedPostIdForAgentWork,
    } from "./src/renderer/src/features/workspace/lib/feedPosts.ts";
    export { mobileAgentSessionFromWorkCard } from "./src/main/composition/mobileAgentSessions.ts";
  `,
    resolveDir: process.cwd(),
  },
  bundle: true,
  platform: "node",
  format: "esm",
  packages: "external",
  alias: { electron: path.resolve("src/main/headless/electronUnavailable.ts") },
  outfile: path.join(bundles, "core.mjs"),
  logLevel: "silent",
});
const {
  TaskenDesktopComposition,
  WorkspaceService,
  TASKEN_MOBILE_ENDPOINTS,
  mobileTodayResponseSchema,
  appendActivitySessionsToLog,
  buildDailyAgentSessionContexts,
  projectActivitySessionLogEntries,
  buildPostsFromAgentWork,
  feedPostIdForAgentWork,
  mobileAgentSessionFromWorkCard,
} = await import(pathToFileURL(path.join(bundles, "core.mjs")));

const record = (patch = {}) => ({
  id: "record-1",
  created_at: "2026-11-10T04:00:01.000Z",
  deleted_at: null,
  started_at: "2026-11-10T03:00:00.000Z",
  ended_at: "2026-11-10T04:00:00.000Z",
  client_kind: "claude_code",
  client_label: null,
  model_label: "test-model",
  source_session_id: "conversation-1",
  theme_ids: ["theme-a"],
  task_ids: ["task-a"],
  repository_context_ids: ["repo-a"],
  intent: "読む側を作る",
  summary: "カードの読み替えを作った。試験も足した。",
  changed: ["src/shared/agentWorkCard.ts"],
  changed_more: 0,
  verified: ["単体の試験"],
  remaining: [],
  status: "done",
  notice: null,
  basis: "ai_report",
  written_by: "claude-code",
  request_fingerprint: null,
  ...patch,
});

const session = (patch = {}) => ({
  id: "session-1",
  started_at: "2026-11-10T01:00:00.000Z",
  ended_at: "2026-11-10T02:00:00.000Z",
  status: "completed",
  client_kind: "codex",
  source_session_id: "old-conversation-1",
  request_events: [{ observed_at: "2026-11-10T01:00:00.000Z", text: "古い依頼" }],
  response_checkpoints: [{ observed_at: "2026-11-10T01:50:00.000Z", text: "最後の回答。続き。" }],
  intent: { summary: "古い依頼" },
  outcome: {
    summary: "古い会話の結果",
    decisions: ["決めた事"],
    changed_items: Array.from({ length: 12 }, (_, index) => `file-${index}.ts`),
    verification: ["確かめた"],
    remaining_work: ["古い残り"],
  },
  ...patch,
});

test("新しい記録はそのままカードになり、終わりの時刻が読めない物は並べない", () => {
  const card = agentWorkCardFromRecord(record({ notice: "気づき" }));
  assert.equal(card.origin, "record");
  assert.equal(card.basis, "ai_report");
  assert.equal(card.summary, "カードの読み替えを作った。試験も足した。");
  assert.deepEqual(card.changed, ["src/shared/agentWorkCard.ts"]);
  assert.equal(card.notice, "気づき");
  assert.equal(card.running, false);
  assert.equal("request_fingerprint" in card, false, "再送の判定の値は読む側に出さない");
  assert.equal(agentWorkCardSchema.safeParse(card).success, true);
  assert.equal(agentWorkCardFromRecord(record({ ended_at: "いつか" })), null);
  assert.equal(agentWorkCardHeadline(card), "カードの読み替えを作った。");
});

test("古い会話の読み替えは、移行の畳み方と同じ対応にする", () => {
  const links = { theme_ids: ["theme-a"], task_ids: [], repository_context_ids: ["repo-a"] };
  const card = agentWorkCardFromSession(session(), links);
  assert.equal(card.origin, "session");
  assert.equal(card.basis, "folded");
  assert.equal(card.status, "done");
  assert.equal(card.intent, "古い依頼");
  assert.equal(card.summary, "古い会話の結果");
  assert.equal(card.changed.length, 10);
  assert.equal(card.changed_more, 2);
  assert.deepEqual(card.verified, ["確かめた"]);
  assert.deepEqual(card.remaining, ["古い残り"]);
  assert.deepEqual(card.repository_context_ids, ["repo-a"]);
  assert.equal(agentWorkCardSchema.safeParse(card).success, true);
  assert.equal(agentWorkCardUnresolved(card), true);

  // 状態: 止まり → blocked、ほか（中止・不明・中断・動いている）→ partial。
  assert.equal(agentWorkCardFromSession(session({ status: "blocked" })).status, "blocked");
  for (const status of ["abandoned", "unknown", "interrupted"]) {
    assert.equal(agentWorkCardFromSession(session({ status })).status, "partial");
  }
  // 結果の要約が無ければ、最後の回答の先頭。
  const noOutcome = agentWorkCardFromSession(session({ outcome: null }));
  assert.equal(noOutcome.summary, "最後の回答。続き。");
  assert.equal(agentWorkCardHeadline(noOutcome), "最後の回答。");
  // 回答も無ければ、1 行は依頼から作る。
  const intentOnly = agentWorkCardFromSession(session({ outcome: null, response_checkpoints: [] }));
  assert.equal(intentOnly.summary, null);
  assert.equal(agentWorkCardHeadline(intentOnly), "古い依頼");
});

test("古い会話の終わり: 最後に見た時刻で止め、動いている物だけを今まで伸ばす", () => {
  const start = "2026-11-10T01:00:00.000Z";
  const now = "2026-11-11T00:00:00.000Z";
  const open = { ended_at: null, status: "unknown", response_checkpoints: [] };
  // 終わりの記録が無く、ログも見ていない: 始まりの点（今まで伸ばさない）。
  const unknown = agentWorkCardFromSession(session(open));
  assert.equal(unknown.ended_at, start);
  assert.deepEqual(agentWorkCardInterval(unknown, now), { start_at: start, end_at: start });
  // ログを最後に見た時刻が、記録された終わりより早ければ、そちらで止める。
  const capped = agentWorkCardFromSession(
    session({
      ended_at: "2026-11-10T05:00:00.000Z",
      observation: { observed_until: "2026-11-10T01:30:00.000Z" },
    }),
  );
  assert.equal(capped.ended_at, "2026-11-10T01:30:00.000Z");
  // 動いている会話（ログの観測なし）だけ、今まで。
  const running = agentWorkCardFromSession(session({ ...open, status: "active" }));
  assert.equal(running.running, true);
  assert.equal(agentWorkCardInterval(running, now).end_at, now);
  const observedActive = agentWorkCardFromSession(
    session({ ...open, status: "active", observation: { observed_until: start } }),
  );
  assert.equal(observedActive.running, false);
  // 壊れた終わり・始まりより前の終わりは、区間を広げない。
  assert.equal(agentWorkCardFromSession(session({ ...open, ended_at: "invalid" })).ended_at, start);
  assert.equal(
    agentWorkCardFromSession(session({ ...open, ended_at: "2026-11-09T00:00:00.000Z" })).ended_at,
    start,
  );
});

test("古い会話の結び付け（Reference）を、ID の並びに直す。作業場所はリポジトリに直す", () => {
  const links = buildAgentSessionLinks({
    working_copies: [{ id: "copy-a", repository_context_id: "repo-a" }],
    references: [
      {
        id: "r1",
        source_type: "agent_session",
        source_id: "session-1",
        target_type: "project",
        target_id: "theme-a",
        relation_type: "worked_on",
      },
      {
        id: "r2",
        source_type: "agent_session",
        source_id: "session-1",
        target_type: "working_copy",
        target_id: "copy-a",
        relation_type: "executed_in",
      },
      {
        id: "r3",
        source_type: "task",
        source_id: "task-a",
        target_type: "agent_session",
        target_id: "session-1",
        relation_type: "worked_on",
      },
      {
        id: "r4",
        deleted_at: "2026-11-10T00:00:00.000Z",
        source_type: "agent_session",
        source_id: "session-1",
        target_type: "project",
        target_id: "theme-deleted-link",
        relation_type: "worked_on",
      },
    ],
  });
  assert.deepEqual(links.get("session-1"), {
    theme_ids: ["theme-a"],
    task_ids: ["task-a"],
    repository_context_ids: ["repo-a"],
    work_receipt_ids: [],
  });
});

test("古い会話と新しい記録を 1 つの並びで読み、同じ作業を 2 回並べない", () => {
  const cards = listAgentWorkCards({
    records: [
      record({ id: "reported", source_session_id: "both", client_kind: "Claude-Code" }),
      // 移行で畳んだ記録は、元の会話と同じ ID。
      record({ id: "folded-session", basis: "folded", source_session_id: "folded-conversation" }),
      // 本人が消した記録は読まない。同じ会話の古い会話は、もう一度並ぶ（隠れたままにしない）。
      record({
        id: "removed",
        source_session_id: "removed-conversation",
        deleted_at: "2026-11-10T06:00:00.000Z",
      }),
      record({
        id: "early-report",
        source_session_id: "long",
        ended_at: "2026-11-10T01:10:00.000Z",
        started_at: null,
      }),
      record({ id: "pickup", basis: "log_pickup", source_session_id: null, task_ids: ["task-b"] }),
    ],
    sessions: [
      // AI が書いた記録の終わり（04:00）が、会話の最後の動き（04:05）の 10 分前より後: 並べない。
      session({
        id: "same-work",
        client_kind: "claude_code",
        source_session_id: "both",
        started_at: "2026-11-10T03:00:00.000Z",
        ended_at: "2026-11-10T04:05:00.000Z",
      }),
      session({ id: "folded-session", source_session_id: "folded-conversation" }),
      session({
        id: "removed-session",
        client_kind: "claude_code",
        source_session_id: "removed-conversation",
        started_at: "2026-11-10T03:00:00.000Z",
        ended_at: "2026-11-10T04:00:00.000Z",
      }),
      // AI が早くに書いた後、長く続いた会話: 続きを落とさない（両方を並べる）。
      session({
        id: "long-session",
        client_kind: "claude_code",
        source_session_id: "long",
        ended_at: "2026-11-10T05:00:00.000Z",
      }),
      // 会話の ID が同じでも、AI の種類が違えば別の作業。
      session({ id: "other-client", client_kind: "codex", source_session_id: "both" }),
      session({ id: "deleted-session", deleted_at: "2026-11-10T00:00:00.000Z" }),
    ],
    tasks: [{ id: "task-b", project_id: "theme-b" }],
  });
  assert.deepEqual(
    cards.map((card) => card.id),
    // 終わりの新しい順。同じ時刻は ID の順。
    [
      "long-session",
      "folded-session",
      "pickup",
      "removed-session",
      "reported",
      "other-client",
      "early-report",
    ],
  );
  assert.equal(cards.find((card) => card.id === "folded-session").origin, "record");
  // 関わる Task のテーマも、カードのテーマに数える。
  assert.deepEqual(cards.find((card) => card.id === "pickup").theme_ids, ["theme-a", "theme-b"]);
});

test("日付の範囲: 始まりの無い記録は終わりの日、日付が変わるちょうどに終わった作業は前の日", () => {
  const point = agentWorkCardFromRecord(
    record({ started_at: null, ended_at: "2026-11-10T03:00:00.000Z" }),
  );
  const tokyo = { timezone: "Asia/Tokyo" };
  assert.equal(
    agentWorkCardInDateRange(point, { ...tokyo, from: "2026-11-10", to: "2026-11-10" }),
    true,
  );
  assert.equal(
    agentWorkCardInDateRange(point, { ...tokyo, from: "2026-11-11", to: "2026-11-11" }),
    false,
  );
  const untilMidnight = agentWorkCardFromRecord(
    record({ started_at: "2026-11-10T13:00:00.000Z", ended_at: "2026-11-10T15:00:00.000Z" }),
  );
  assert.equal(
    agentWorkCardInDateRange(untilMidnight, { ...tokyo, from: "2026-11-11", to: "2026-11-11" }),
    false,
  );
  assert.equal(
    agentWorkCardInDateRange(untilMidnight, { ...tokyo, from: "2026-11-01", to: "2026-11-30" }),
    true,
  );
});

test("近況: 気づき（notice）のある物と止まった物だけを、読む時に「気づき」として並べる", () => {
  const cards = listAgentWorkCards({
    records: [
      record({ id: "plain" }),
      record({ id: "noticed", notice: "設定の既定値が古い", ended_at: "2026-11-10T05:00:00.000Z" }),
      record({
        id: "stopped",
        status: "blocked",
        remaining: ["鍵を待つ"],
        ended_at: "2026-11-10T06:00:00.000Z",
      }),
    ],
    sessions: [session({ id: "old-blocked", status: "blocked" })],
  });
  const posts = buildPostsFromAgentWork({
    cards,
    tasks: [{ id: "task-a", title: "読む側" }],
  });
  assert.deepEqual(
    posts.map((post) => post.id),
    // 新しい記録だけ。止まった古い会話（old-blocked）は近況に流さない。
    ["stopped", "noticed"].map(feedPostIdForAgentWork),
  );
  for (const post of posts) {
    assert.equal(post.kind, "insight");
    assert.equal(post.replyTo, null);
    assert.notEqual(post.author, "self", "AI の印で並ぶ");
  }
  const noticed = posts.find((post) => post.id === feedPostIdForAgentWork("noticed"));
  assert.equal(noticed.author, "claude");
  assert.equal(noticed.paragraphs[0], "設定の既定値が古い");
  assert.equal(noticed.taskTitle, "読む側");
  assert.equal(noticed.themeId, "theme-a");
  assert.equal(noticed.learnable, true);
  const stopped = posts.find((post) => post.id === feedPostIdForAgentWork("stopped"));
  assert.match(stopped.paragraphs.join("\n"), /作業が止まっています/);
  assert.match(stopped.paragraphs.join("\n"), /残り: 鍵を待つ/);
  assert.equal(stopped.learnable, false);
});

test("日ごとの日誌の出力: 「AI作業」の節を、新しい記録からも作る", () => {
  const cards = listAgentWorkCards({
    records: [
      record({
        changed: ["a.ts", "b.ts"],
        changed_more: 3,
        remaining: ["絵を撮る"],
        notice: "既定値が古い",
      }),
      record({
        id: "pickup",
        basis: "log_pickup",
        intent: null,
        started_at: null,
        ended_at: "2026-11-10T06:30:00.000Z",
        summary: "拾い上げた会話の最後の回答。",
        changed: [],
        verified: [],
        status: "blocked",
      }),
    ],
    sessions: [session()],
  });
  const rows = cards.map((card) => ({
    card,
    themes: card.theme_ids.map((id) => ({ id })),
    repositories: [],
  }));
  const entries = projectActivitySessionLogEntries(
    buildDailyAgentSessionContexts(rows, "2026-11-10", [], undefined, "2026-11-10T09:00:00.000Z"),
    [{ id: "theme-a", name: "読む側" }],
  );
  assert.equal(entries.length, 3);
  const markdown = appendActivitySessionsToLog("# 日誌\n", entries);
  assert.match(markdown, /## AI作業/);
  assert.match(markdown, /- 12:00–13:00 \[Claude Code\] 読む側を作る/);
  assert.match(markdown, /結果: カードの読み替えを作った。試験も足した。/);
  assert.match(markdown, /変えた物: a\.ts \/ b\.ts ほか3件/);
  assert.match(markdown, /確かめたこと: 単体の試験/);
  assert.match(markdown, /残作業: 絵を撮る/);
  assert.match(markdown, /気づき: 既定値が古い/);
  // 始まりの無い記録は終わりの時刻だけ。依頼が無ければ、見出しは要約の最初の一文。
  assert.match(markdown, /- 15:30 \[Claude Code\] 拾い上げた会話の最後の回答。（停止）/);
  // 古い会話も同じ形。
  assert.match(markdown, /- 10:00–11:00 \[Codex\] 古い依頼/);
  assert.match(markdown, /結果: 古い会話の結果/);
});

test("Mobile Gateway の形: 新しい記録からも、古い APK が読む欄だけを同じ語彙で作る", () => {
  const golden = JSON.parse(
    fs.readFileSync(
      new URL("../contracts/mobile/v1/today-agent-sessions.golden.json", import.meta.url),
      "utf8",
    ),
  ).data.agentSessions[0];
  const fromRecord = mobileAgentSessionFromWorkCard(
    agentWorkCardFromRecord(record({ remaining: ["残り 1"], status: "partial" })),
  );
  assert.deepEqual(Object.keys(fromRecord).sort(), Object.keys(golden).sort());
  assert.equal(fromRecord.intent, "読む側を作る");
  assert.equal(fromRecord.outcome, "カードの読み替えを作った。試験も足した。");
  assert.deepEqual(fromRecord.remainingWork, ["残り 1"]);
  assert.equal(fromRecord.status, "interrupted");
  assert.equal(fromRecord.endedAt, "2026-11-10T04:00:00.000Z");
  // 始まりと依頼の無い記録でも、APK が必ず読む欄は埋まる。
  const bare = mobileAgentSessionFromWorkCard(
    agentWorkCardFromRecord(record({ started_at: null, intent: null, status: "blocked" })),
  );
  assert.equal(bare.startedAt, bare.endedAt);
  assert.equal(bare.intent, "カードの読み替えを作った。", "依頼が無ければ要約の最初の一文");
  assert.equal(bare.status, "blocked");
  const old = mobileAgentSessionFromWorkCard(agentWorkCardFromSession(session()));
  assert.equal(old.status, "completed");
  assert.equal(old.intent, "古い依頼");
  const running = mobileAgentSessionFromWorkCard(
    agentWorkCardFromSession(session({ status: "active", ended_at: null })),
  );
  assert.equal(running.status, "active");
  assert.equal(running.endedAt, null);
});

// ---- ここから、Core の境界（SQLite・受け口・MCP の読む道具・Gateway）。 ----

const PERSONAL_THEME = "theme-personal-default";
const DAY = "2026-11-10";

async function startDesktop(t) {
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), "tasken-agent-work-read-"));
  const db = new WorkspaceDatabase(path.join(userData, "research-desk.sqlite"));
  db.loadWorkspace();
  const workspace = new WorkspaceService(db, userData, undefined, undefined, () => {
    throw new Error("no images");
  });
  const composition = new TaskenDesktopComposition({ userDataPath: userData, persistence: db });
  composition.enableAiWrites({ workspace });
  await composition.coreRuntime.start();
  // 後片付けは、Core を止める → DB を閉じる → 一時の場所を消す、の順。
  t.after(async () => {
    await composition.coreRuntime.stop();
    db.db.close();
    fs.rmSync(userData, { recursive: true, force: true });
  });
  return { db, composition, client: new TaskenCoreClient({ userDataPath: userData }) };
}

const report = (patch = {}) => ({
  idempotency_key: `key-${patch.source_session || "x"}`,
  caller: "claude-code",
  source_app: "test-mcp",
  client_kind: "claude_code",
  status: "done",
  summary: "新しい記録の要約。",
  ...patch,
});

/** 古い会話・AI が書いた記録・拾い上げ・気づき・止まった物・消した物を混ぜた 1 日を作る。 */
async function seedMixedDay({ db, client }) {
  db.setPreference("aiDirectWriteEnabled", true);
  db.save("repository_context", {
    id: "repo-demo",
    label: "demo-repo",
    provider: "github",
    repository_slug: "owner/demo-repo",
    remote_url: "https://github.com/owner/demo-repo.git",
  });
  // 古い会話の結び付け（Reference）が指すテーマは project の種類。
  db.save("project", { id: "project-read", name: "読む側", state: "active" });
  const task = (
    await client.createAiItem({
      kind: "task",
      title: "読む側を確かめる",
      idempotency_key: "task-read",
      caller: "claude-code",
      source_app: "test-mcp",
    })
  ).entity;

  const oldSession = (id, patch) => {
    db.save("agent_session", session({ id, ...patch }));
    for (const [suffix, type, target] of [
      ["repo", "repository_context", "repo-demo"],
      ["theme", "project", "project-read"],
    ]) {
      db.save("reference", {
        id: `${id}-${suffix}`,
        source_type: "agent_session",
        source_id: id,
        target_type: type,
        target_id: target,
        relation_type: "worked_on",
        layer: "provenance",
        status: "asserted",
        origin: "system_action",
      });
    }
  };
  oldSession("old-finished", {});
  // AI が記録を書いた会話と同じ会話の、古い会話。並べない。
  oldSession("old-reported", {
    client_kind: "claude_code",
    source_session_id: "conv-both",
    started_at: `${DAY}T03:00:00.000Z`,
    ended_at: `${DAY}T04:02:00.000Z`,
  });

  const noticed = await client.recordAgentWork(
    report({
      source_session: "conv-both",
      started_at: `${DAY}T03:00:00.000Z`,
      ended_at: `${DAY}T04:00:00.000Z`,
      intent: "読む側を作る",
      summary: "読む側を作った。",
      changed: ["src/shared/agentWorkCard.ts"],
      verified: ["試験"],
      notice: "既定値が古い",
      theme_ids: [PERSONAL_THEME],
      task_ids: [task.id],
      repository_context_ids: ["repo-demo"],
    }),
  );
  const blocked = await client.recordAgentWork(
    report({
      source_session: "conv-blocked",
      ended_at: `${DAY}T05:00:00.000Z`,
      status: "blocked",
      summary: "鍵が無くて止まった。",
      remaining: ["鍵を待つ"],
      repository_context_ids: ["repo-demo"],
    }),
  );
  const removed = await client.recordAgentWork(
    report({
      source_session: "conv-removed",
      ended_at: `${DAY}T05:40:00.000Z`,
      summary: "本人が消す記録。",
      repository_context_ids: ["repo-demo"],
    }),
  );
  db.remove("agent_work_record", removed.id);
  // 拾い上げ（PR 3 が書く形）。変えた物・確かめたこと・残りは空。
  db.save(
    "agent_work_record",
    record({
      id: "pickup-1",
      basis: "log_pickup",
      written_by: "tasken-log-pickup",
      client_kind: "codex",
      source_session_id: "conv-pickup",
      started_at: `${DAY}T06:00:00.000Z`,
      ended_at: `${DAY}T06:30:00.000Z`,
      intent: "拾い上げた依頼",
      summary: "拾い上げた会話の最後の回答。",
      theme_ids: [],
      task_ids: [],
      repository_context_ids: ["repo-demo"],
      changed: [],
      verified: [],
      status: "partial",
    }),
    { source: "mcp" },
  );
  return { task, noticed, blocked, removed };
}

test("MCP の読む道具: 古い会話と新しい記録を同じカードで返し、同じ作業を 2 回返さない", async (t) => {
  const desktop = await startDesktop(t);
  const { task, noticed, blocked } = await seedMixedDay(desktop);
  const { client } = desktop;
  // 本人が消した記録（removed）は、どの読む道具にも出ない。
  const expected = [noticed.id, blocked.id, "old-finished", "pickup-1"].sort();

  // get_agent_session_context（その日の全部）。
  const daily = await client.getAgentSessionContext({ date: DAY, source_session: "reader" });
  assert.deepEqual(daily.agent_work.map((card) => card.id).sort(), expected);
  assert.equal("sessions" in daily, false, "古い会話の形の欄は返さない");
  const byId = new Map(daily.agent_work.map((card) => [card.id, card]));
  assert.deepEqual(
    [...byId.values()].map((card) => card.ended_at),
    [...byId.values()]
      .map((card) => card.ended_at)
      .sort()
      .reverse(),
    "終わりの新しい順",
  );
  const old = byId.get("old-finished");
  assert.equal(old.origin, "session");
  assert.equal(old.basis, "folded");
  assert.equal(old.summary, "古い会話の結果");
  assert.equal(old.changed.length, 10);
  assert.equal(old.changed_more, 2);
  assert.deepEqual(old.repository_context_ids, ["repo-demo"]);
  assert.deepEqual(old.theme_ids, ["project-read"]);
  assert.equal("request_events" in old, false, "途中の依頼と回答は返さない");
  assert.equal(byId.get("pickup-1").basis, "log_pickup");
  assert.equal(byId.get(noticed.id).notice, "既定値が古い");
  assert.equal(byId.get(noticed.id).written_by, "claude-code");
  assert.equal("request_fingerprint" in byId.get(noticed.id), false);

  // そのリポジトリの最近の記録と、残りのある直前の 1 件（自分の会話は引き継ぎにしない）。
  const inRepository = await client.getAgentSessionContext({
    repository_context_id: "repo-demo",
    client_kind: "claude_code",
    source_session: "conv-new",
  });
  assert.equal(inRepository.repository_context.id, "repo-demo");
  assert.deepEqual(
    inRepository.agent_work.map((card) => card.id).sort(),
    [noticed.id, blocked.id].sort(),
  );
  assert.equal(inRepository.previous_handoff.id, blocked.id);
  assert.deepEqual(inRepository.previous_handoff.remaining, ["鍵を待つ"]);
  const own = await client.getAgentSessionContext({
    repository_context_id: "repo-demo",
    client_kind: "claude_code",
    source_session: "conv-blocked",
  });
  assert.equal(own.previous_handoff, null);
  const codex = await client.getAgentSessionContext({
    repository_context_id: "repo-demo",
    client_kind: "codex",
    source_session: "conv-new",
  });
  assert.deepEqual(codex.agent_work.map((card) => card.id).sort(), ["old-finished", "pickup-1"]);
  assert.equal(codex.previous_handoff.id, "old-finished", "古い会話の残りも引き継ぎになる");

  // get_activity: 来歴を取らない記録も、その日の AI の作業として返る。絞った呼び出しでは空。
  const activity = await client.getActivity({ date: DAY });
  assert.deepEqual(activity.agent_work.map((card) => card.id).sort(), expected);
  assert.deepEqual((await client.getActivity({ date: "2026-11-09" })).agent_work, []);
  assert.deepEqual((await client.getActivity({ date: DAY, entity_type: "task" })).agent_work, []);
  const themed = await client.getActivity({
    date: DAY,
    theme_id: PERSONAL_THEME,
    format: "markdown",
  });
  assert.deepEqual(
    themed.agent_work.map((card) => card.id),
    [noticed.id],
  );

  // get_theme_context・get_task_context の AI の作業の欄。
  const theme = await client.getThemeContext({ theme_id: PERSONAL_THEME });
  assert.deepEqual(
    theme.agent_work.map((card) => card.id),
    [noticed.id],
  );
  // 古い会話は結び付け（Reference）のテーマで引ける。同じ会話の記録がある物は出ない。
  const oldTheme = await client.getThemeContext({ theme_id: "project-read" });
  assert.deepEqual(
    oldTheme.agent_work.map((card) => card.id),
    ["old-finished"],
  );
  const taskContext = await client.getTaskContext({ task_id: task.id });
  assert.deepEqual(
    taskContext.agent_work.map((card) => card.id),
    [noticed.id],
  );
  assert.deepEqual(
    (await client.getTaskContext({ task_id: task.id, include: ["theme"] })).agent_work,
    [],
  );
});

test("Mobile Gateway /v1/today: agentSessions の形は変えず、新しい記録からも作る", async (t) => {
  const desktop = await startDesktop(t);
  const { noticed, blocked } = await seedMixedDay(desktop);
  const adapter = desktop.composition.coreRuntime.createMobileGateway({
    current: () => ({
      serverId: "desktop-read",
      serverRevision: 1,
      generatedAt: `${DAY}T08:00:00.000Z`,
    }),
  });
  const request = (query = {}) =>
    adapter.handle({
      method: "GET",
      path: TASKEN_MOBILE_ENDPOINTS.today,
      principal: {
        kind: "mobile_device",
        deviceId: "device-old-apk",
        scopes: ["mobile:read", "mobile:context-read"],
      },
      query: {
        apiVersion: "1",
        schemaVersion: "7",
        requestId: "request-today",
        date: DAY,
        limit: "20",
        ...query,
      },
    });
  // 頼まない古い呼び出しには、今までどおり欄を付けない。
  const plain = await request();
  assert.equal(plain.status, 200);
  assert.equal(plain.body.data.agentSessions, undefined);

  const response = await request({ includeAgentSessions: "true" });
  assert.equal(response.status, 200, JSON.stringify(response.body));
  // 古い APK の契約（strict）でそのまま読める。
  const parsed = mobileTodayResponseSchema.parse(response.body);
  const golden = JSON.parse(
    fs.readFileSync(
      new URL("../contracts/mobile/v1/today-agent-sessions.golden.json", import.meta.url),
      "utf8",
    ),
  ).data.agentSessions[0];
  const sessions = new Map(parsed.data.agentSessions.map((entry) => [entry.id, entry]));
  assert.deepEqual(
    [...sessions.keys()].sort(),
    [noticed.id, blocked.id, "old-finished", "pickup-1"].sort(),
  );
  for (const entry of sessions.values()) {
    assert.deepEqual(Object.keys(entry).sort(), Object.keys(golden).sort());
  }
  assert.deepEqual(
    {
      intent: sessions.get(noticed.id).intent,
      outcome: sessions.get(noticed.id).outcome,
      status: sessions.get(noticed.id).status,
      sourceSessionId: sessions.get(noticed.id).sourceSessionId,
    },
    {
      intent: "読む側を作る",
      outcome: "読む側を作った。",
      status: "completed",
      sourceSessionId: "conv-both",
    },
  );
  assert.equal(sessions.get(blocked.id).status, "blocked");
  // 依頼の無い記録は、要約の最初の一文が見出しになる（APK の行の見出しが空にならない）。
  assert.equal(sessions.get(blocked.id).intent, "鍵が無くて止まった。");
  assert.equal(sessions.get(blocked.id).endedAt, DAY + "T05:00:00.000Z");
  assert.deepEqual(sessions.get(blocked.id).remainingWork, ["鍵を待つ"]);
  assert.equal(sessions.get("pickup-1").status, "interrupted");
  assert.equal(sessions.get("old-finished").status, "completed");
  assert.deepEqual(sessions.get("old-finished").remainingWork, ["古い残り"]);
});

test("古い会話のカードは、字数も新しい記録の上限に切る（移行の畳み方と同じ）", () => {
  const long = (length) => "あ".repeat(length);
  const card = agentWorkCardFromSession(
    session({
      client_label: long(200),
      model_label: long(200),
      intent: { summary: long(4000) },
      outcome: {
        summary: long(8000),
        decisions: [],
        changed_items: [long(1000), "short.ts"],
        verification: [long(1000)],
        remaining_work: [long(1000)],
      },
    }),
  );
  assert.equal(card.summary.length, 400);
  assert.ok(card.summary.endsWith("…"));
  assert.equal(card.intent.length, 160);
  assert.equal(card.client_label.length, 80);
  assert.equal(card.model_label.length, 80);
  assert.deepEqual(
    card.changed.map((item) => item.length),
    [100, "short.ts".length],
  );
  assert.equal(card.verified[0].length, 120);
  assert.equal(card.remaining[0].length, 120);
  // 最後の回答から作る要約も同じ上限。
  const fromResponse = agentWorkCardFromSession(
    session({
      outcome: null,
      response_checkpoints: [{ observed_at: "2026-11-10T01:50:00.000Z", text: long(8000) }],
    }),
  );
  assert.equal(fromResponse.summary.length, 400);
  // 会話の ID は同じ作業の判定の鍵なので切らない。
  const id = "c".repeat(450);
  assert.equal(agentWorkCardFromSession(session({ source_session_id: id })).source_session_id, id);
  assert.equal(agentWorkCardSchema.safeParse(card).success, true);
});

test("Mobile Gateway の形: 依頼の無い記録は見出しを入れ、終わりの無い古い会話は endedAt を null のまま返す", () => {
  const noIntent = mobileAgentSessionFromWorkCard(
    agentWorkCardFromRecord(record({ intent: null, summary: "鍵が無くて止まった。続きは明日。" })),
  );
  assert.equal(noIntent.intent, "鍵が無くて止まった。", "APK の行の見出しが空にならない");
  assert.equal(noIntent.outcome, "鍵が無くて止まった。続きは明日。");
  // 終わりの記録が無い古い会話（動いていない物も）: 並べるための代わりの時刻を、終わりとして渡さない。
  for (const status of ["unknown", "interrupted", "active"]) {
    const open = mobileAgentSessionFromWorkCard(
      agentWorkCardFromSession(session({ status, ended_at: null })),
    );
    assert.equal(open.endedAt, null, status);
    assert.equal(open.startedAt, "2026-11-10T01:00:00.000Z");
  }
  // ログを最後に見た時刻しか無い会話も、今までどおり終わりは null。
  const observedOnly = mobileAgentSessionFromWorkCard(
    agentWorkCardFromSession(
      session({
        status: "unknown",
        ended_at: null,
        observation: { observed_until: "2026-11-10T01:30:00.000Z" },
      }),
    ),
  );
  assert.equal(observedOnly.endedAt, null);
  const closed = mobileAgentSessionFromWorkCard(agentWorkCardFromSession(session()));
  assert.equal(closed.endedAt, "2026-11-10T02:00:00.000Z");
});

test("版のずれ: 呼ぶ側は、古い Core の応答（sessions）も新しい Core の応答（agent_work）も読める", () => {
  const base = {
    status: "matched",
    reason_code: "remote_url_match",
    reason: "一致しました。",
    selected: null,
    candidates: [],
    repository_context: {
      id: "repo-demo",
      label: "demo-repo",
      provider: "github",
      repository_slug: "owner/demo-repo",
      canonical_url: "https://github.com/owner/demo-repo",
      canonical_identity: "github.com/owner/demo-repo",
      web_url: "https://github.com/owner/demo-repo",
      owner: "owner",
      name: "demo-repo",
      remote_aliases: [],
      default_branch: "main",
      subdirectory: "",
      active: true,
      metadata: {},
    },
    themes: [],
    tasks: [],
    working_copies: [
      {
        id: "copy-1",
        repository_context_id: "repo-demo",
        device_id: "device-1",
        storage_root_id: "root-1",
        worktree_identity: null,
        branch_hint: null,
        active: true,
        last_seen_at: null,
      },
    ],
    read_only: true,
  };
  const repository = getAgentSessionContextClientResponseSchema.safeParse({
    ...base,
    agent_work: [],
    previous_handoff: null,
  });
  // 試験の土台の形が今の契約に合っていること（合わないと下の比較が空振りする）。
  assert.equal(repository.success, true, JSON.stringify(repository.error?.issues));
  assert.equal(
    getAgentSessionContextResponseSchema.safeParse({
      ...base,
      agent_work: [],
      previous_handoff: null,
    }).success,
    true,
  );

  // 古い Desktop の Core（#751 PR 2 より前）の応答: sessions を持ち、agent_work が無く、
  // previous_handoff は古い会話の形。hook が使う欄（リポジトリ・作業場所・テーマ）は読める。
  const oldSession = {
    id: "old-1",
    started_at: "2026-11-10T01:00:00.000Z",
    ended_at: "2026-11-10T02:00:00.000Z",
    status: "completed",
    client_kind: "codex",
    source_session_id: "old-conversation",
    intent: { summary: "古い依頼" },
    outcome: { summary: "古い結果" },
  };
  const fromOld = getAgentSessionContextClientResponseSchema.parse({
    ...base,
    sessions: [oldSession],
    task_work: [],
    previous_handoff: oldSession,
  });
  assert.equal(fromOld.repository_context.id, "repo-demo");
  assert.equal(fromOld.working_copies[0].id, "copy-1");
  assert.deepEqual(fromOld.agent_work, []);
  assert.equal(fromOld.previous_handoff, null);
  // Core が応答を作る側の契約は厳しいまま（古い形を黙って出さない）。
  assert.equal(
    getAgentSessionContextResponseSchema.safeParse({ ...base, sessions: [oldSession] }).success,
    false,
  );

  // 新しい Core の応答。
  const card = agentWorkCardFromRecord(record({ remaining: ["残り"] }));
  const fromNew = getAgentSessionContextClientResponseSchema.parse({
    ...base,
    agent_work: [card],
    task_work: [],
    previous_handoff: card,
  });
  assert.equal(fromNew.agent_work[0].id, "record-1");
  assert.deepEqual(fromNew.previous_handoff.remaining, ["残り"]);
});

test("本人が消した古い会話は、ログの読み取りや hooks が送り直しても戻らず、案も作らない", async (t) => {
  const { db, client } = await startDesktop(t);
  const capture = (key, patch = {}) =>
    client.proposeAgentSession({
      action: "capture",
      idempotency_key: key,
      caller: "codex lifecycle hook",
      source: "mcp",
      source_app: "tasken-session-hook:codex",
      source_session: "conversation-removed",
      actor: { kind: "ai_agent" },
      started_at: `${DAY}T01:00:00.000Z`,
      ended_at: `${DAY}T02:00:00.000Z`,
      status: "completed",
      client_kind: "codex",
      request_events: [],
      response_checkpoints: [{ observed_at: `${DAY}T02:00:00.000Z`, text: "終わりました。" }],
      intent: { summary: "消される会話" },
      outcome: { summary: "消される会話の結果" },
      ...patch,
    });
  const proposals = () =>
    db.list("ai_proposal").filter((proposal) => proposal.payload_type === "agent_sessions");

  // 1 回目は今までどおり案になる。その会話が保存され、本人が日誌から消した、という状態を作る。
  const first = await capture("first");
  assert.equal(first.status, "queued");
  const sessionId = first.agent_session_id;
  const pending = proposals();
  assert.equal(pending.length, 1);
  db.save("agent_session", pending[0].payload.agent_sessions[0].session);
  db.save("ai_proposal", { ...pending[0], status: "accepted" });
  db.remove("agent_session", sessionId);
  assert.ok(db.get("agent_session", sessionId, true).deleted_at);
  const before = proposals().length;

  // 同じ会話の送り直し（中身が伸びた、鍵が違う）: 受信済みと答え、案を作らず、会話も戻さない。
  const again = await capture("second", { ended_at: `${DAY}T03:00:00.000Z` });
  assert.equal(again.status, "duplicate");
  assert.equal(again.agent_session_id, sessionId);
  assert.equal(proposals().length, before);
  assert.equal(
    proposals().filter((proposal) => proposal.status === "pending").length,
    0,
    "採用待ちの案が残らない（日誌に「未確定の受信記録」として戻らない）",
  );
  assert.ok(db.get("agent_session", sessionId, true).deleted_at);
  assert.equal(db.get("agent_session", sessionId), null);

  // 読む道具にも戻らない。
  const daily = await client.getAgentSessionContext({ date: DAY, source_session: "reader" });
  assert.deepEqual(daily.agent_work, []);

  // 別の会話は、今までどおり案になる。
  const other = await capture("other", { source_session: "conversation-kept" });
  assert.equal(other.status, "queued");
});

test("get_activity の from・to: 時刻付きの境界は日本時間の日付で読む（UTC の日付にしない）", async (t) => {
  const desktop = await startDesktop(t);
  const { noticed } = await seedMixedDay(desktop);
  const { client } = desktop;
  // 日本時間の 11/11 00:00 から 11/11 の終わりまで。UTC では 11/10 15:00 から。
  // 先頭 10 字で切ると 11/10 になり、11/10 の作業が混ざる。
  const nextDay = await client.getActivity({
    from: "2026-11-10T15:00:00.000Z",
    to: "2026-11-11T14:59:59.000Z",
  });
  assert.deepEqual(nextDay.agent_work, []);
  // 日本時間の 11/10 の 1 日（UTC では 11/9 15:00 から）。
  const sameDay = await client.getActivity({
    from: "2026-11-09T15:00:00.000Z",
    to: "2026-11-10T14:59:59.000Z",
  });
  assert.ok(sameDay.agent_work.some((card) => card.id === noticed.id));
  assert.equal(sameDay.agent_work.length, 4);
  // 日付だけの境界は今までどおり。
  const dates = await client.getActivity({ from: DAY, to: DAY });
  assert.equal(dates.agent_work.length, 4);
});

test("画面（Renderer → IPC）から、AI の作業の記録を消して、元に戻せる", async (t) => {
  // registerIpc を、electron の ipcMain だけを差し替えて組み立てる。画面の removeEntity・
  // 「元に戻す」が呼ぶ entity:remove・entity:restore の受け口そのものを通す。
  const handlers = new Map();
  globalThis.__agentWorkReadIpcHandlers = handlers;
  t.after(() => delete globalThis.__agentWorkReadIpcHandlers);
  const fakeElectron = path.join(bundles, "fake-electron.mjs");
  fs.writeFileSync(
    fakeElectron,
    `const unavailable = () => { throw new Error("electron is not available in this test"); };
export const ipcMain = { handle: (name, handler) => globalThis.__agentWorkReadIpcHandlers.set(name, handler), on: () => {}, once: () => {}, removeHandler: () => {} };
export const BrowserWindow = { getAllWindows: () => [], fromWebContents: () => null };
export const dialog = new Proxy({}, { get: unavailable });
export const app = new Proxy({}, { get: unavailable });
export const clipboard = new Proxy({}, { get: unavailable });
export const nativeImage = new Proxy({}, { get: unavailable });
export const shell = new Proxy({}, { get: unavailable });
export const ClipboardItem = unavailable;
`,
  );
  await build({
    stdin: {
      contents: `
      export { registerIpc } from "./src/main/ipc/registerIpc.ts";
      export { IPC } from "./src/shared/ipc/contracts.ts";
      export { WorkspaceService } from "./src/main/services/workspaceService.ts";
    `,
      resolveDir: process.cwd(),
    },
    bundle: true,
    platform: "node",
    format: "esm",
    packages: "external",
    alias: { electron: fakeElectron },
    outfile: path.join(bundles, "ipc.mjs"),
    logLevel: "silent",
  });
  const ipc = await import(pathToFileURL(path.join(bundles, "ipc.mjs")));

  const { db, client } = await startDesktop(t);
  const userData = path.dirname(db.db.name);
  const service = new ipc.WorkspaceService(db, userData, undefined, undefined, () => {
    throw new Error("no images");
  });
  const notified = [];
  // 消す・戻すの受け口が使うのは repository と service だけ。ほかの相手は、この試験では呼ばれない。
  const unused = new Proxy(
    {},
    {
      get: (_target, key) => () => {
        throw new Error(`この試験では使わない相手が呼ばれた: ${String(key)}`);
      },
    },
  );
  ipc.registerIpc(
    db,
    service,
    unused,
    unused,
    unused,
    unused,
    unused,
    unused,
    unused,
    unused,
    unused,
    unused,
    (types) => notified.push(types),
  );
  const invoke = (name, ...args) => handlers.get(name)({ sender: { id: 1 } }, ...args);

  const written = await client.recordAgentWork(
    report({ source_session: "conv-ipc", ended_at: `${DAY}T04:00:00.000Z` }),
  );
  const listed = () => invoke(ipc.IPC.entityList, "agent_work_record").map((entry) => entry.id);
  assert.deepEqual(listed(), [written.id]);

  const outboxCount = () => db.db.prepare("SELECT COUNT(*) AS count FROM sync_outbox").get().count;
  let before = outboxCount();
  const removed = invoke(ipc.IPC.entityRemove, "agent_work_record", written.id);
  assert.ok(removed.deleted_at);
  assert.deepEqual(listed(), []);
  assert.ok(db.get("agent_work_record", written.id, true).deleted_at);
  assert.equal(outboxCount(), before + 1, "消した印は同期の差分 1 つ");
  assert.deepEqual(notified.at(-1), ["agent_work_record"]);

  before = outboxCount();
  const restored = invoke(ipc.IPC.entityRestore, "agent_work_record", written.id);
  assert.equal(restored.deleted_at, null);
  assert.deepEqual(listed(), [written.id]);
  assert.equal(outboxCount(), before + 1);
  // 画面からは書き換えられない（保存の受け口は既にある記録を断る）。
  assert.throws(
    () =>
      invoke(ipc.IPC.entitySave, "agent_work_record", {
        ...db.get("agent_work_record", written.id),
        summary: "画面から書き換え",
      }),
    /書き換え/,
  );
  assert.equal(db.get("agent_work_record", written.id).summary, "新しい記録の要約。");
});
