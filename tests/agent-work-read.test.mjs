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
import { agentWorkCardSchema } from "../src/shared/contracts/task/public.ts";

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
    ["stopped", "noticed", "old-blocked"].map(feedPostIdForAgentWork),
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
  assert.equal(bare.intent, "");
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
  assert.deepEqual(sessions.get(blocked.id).remainingWork, ["鍵を待つ"]);
  assert.equal(sessions.get("pickup-1").status, "interrupted");
  assert.equal(sessions.get("old-finished").status, "completed");
  assert.deepEqual(sessions.get("old-finished").remainingWork, ["古い残り"]);
});
