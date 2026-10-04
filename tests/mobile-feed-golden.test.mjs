import assert from "node:assert/strict";
import { Buffer } from "node:buffer";
import { readFileSync, writeFileSync } from "node:fs";
import os from "node:os";
import test from "node:test";

import { build } from "esbuild";

import {
  mobileFeedActionRequestSchema,
  mobileFeedActionResponseSchema,
  mobileFeedResponseSchema,
} from "../src/shared/contracts/mobile/public.ts";
import { TASKEN_MOBILE_ENDPOINTS } from "../src/shared/contracts/mobile/public.mjs";

const bundled = await build({
  stdin: {
    contents: `
      export { TaskenCoreRuntime } from "./src/main/composition/taskenCoreRuntime.ts";
      export { projectFeedPosts } from "./src/main/gateway/mobile/public.ts";
    `,
    resolveDir: process.cwd(),
  },
  bundle: true,
  platform: "node",
  format: "esm",
  write: false,
  logLevel: "silent",
});
const { TaskenCoreRuntime, projectFeedPosts } = await import(
  `data:text/javascript;base64,${Buffer.from(bundled.outputFiles[0].text).toString("base64")}`
);

const GOLDEN = "contracts/mobile/v1/feed-response.golden.json";
const now = "2026-10-04T09:00:00.000Z";

const THEMES = [{ id: "theme-materials", name: "高分子材料評価" }];
const TASKS = [{ id: "task-viscosity", title: "粘度測定の条件を決める", version: 3 }];

function proposal(id, receivedAt, source_app, post, overrides = {}) {
  return {
    id,
    source_app,
    payload_type: "feed_posts",
    status: "pending",
    received_at: receivedAt,
    created_at: receivedAt,
    payload: { feed_posts: [{ action: "publish", topic: "insight", ...post }] },
    ...overrides,
  };
}

/** DesktopのFeedに載る投稿と、載らない投稿（削除済み・空・別種のProposal）を混ぜる。 */
function workspace() {
  const proposals = [
    proposal("p-codex", "2026-10-04T08:30:00.000Z", "codex", {
      topic: "insight",
      body: ["温度を25℃に揃えると、粘度の再現性が上がりました。", "40℃は次回に回します。"],
      task_id: "task-viscosity",
      theme: "theme-materials",
      article: { title: "粘度測定は温度を先に揃える", body: "本文は流さない。", note_type: "memo" },
      evidence: ["内部の根拠は流さない"],
    }),
    proposal("p-claude", "2026-10-04T07:00:00.000Z", "claude-code", {
      topic: "reference",
      body: ["関連しそうな公式資料を見つけました。"],
      theme: "theme-materials",
      media: { kind: "external_link", url: "https://example.com/viscosity", label: "測定ガイド" },
    }),
    proposal("p-note", "2026-10-03T12:00:00.000Z", "tasken-mcp", {
      topic: "learning",
      body: ["既存のNoteを参照します。"],
      note_id: "note-1",
      attachment_label: "粘度の基礎",
    }),
    proposal(
      "p-deleted",
      "2026-10-04T08:45:00.000Z",
      "codex",
      { body: ["削除済み"] },
      {
        deleted_at: "2026-10-04T08:50:00.000Z",
      },
    ),
    proposal("p-empty", "2026-10-04T08:40:00.000Z", "codex", { body: [" "] }),
    {
      id: "p-other",
      source_app: "codex",
      payload_type: "task_work",
      status: "pending",
      received_at: "2026-10-04T08:41:00.000Z",
      payload: { task_work: [] },
    },
  ];
  const feedPosts = [
    {
      id: "own-1",
      body_markdown: "今日は粘度の実験を進める。\n\n温度条件は明日決める。",
      project_id: "theme-materials",
      published_at: "2026-10-04T08:00:00.000Z",
    },
    { id: "own-deleted", body_markdown: "消した", published_at: now, deleted_at: now },
    { id: "own-draft", body_markdown: "未公開", published_at: "" },
  ];
  proposals.push({
    id: "a-claude",
    source_app: "claude-code",
    payload_type: "feed_replies",
    status: "pending",
    received_at: "2026-10-04T08:50:00.000Z",
    payload: {
      feed_replies: [
        {
          action: "answer",
          post_id: "feed-post:p-codex",
          reply_to: "reply-self-1",
          body: "25℃は標準条件なので、そのまま進めて問題ありません。",
        },
      ],
    },
  });
  const reactions = [
    { id: "r1", post_id: "feed-post:p-codex", kind: "interesting" },
    { id: "r2", post_id: "feed-post:p-codex", kind: "bookmark" },
    { id: "r3", post_id: "own-1", kind: "hidden" },
    { id: "r4", post_id: "own-1", kind: "bookmark", deleted_at: now },
  ];
  const replies = [
    {
      id: "reply-self-1",
      post_id: "feed-post:p-codex",
      body: "25℃で進めたい。",
      created_at: "2026-10-04T08:40:00.000Z",
      author_kind: "self",
    },
    {
      id: "reply-ai-1",
      post_id: "feed-post:p-codex",
      body: "別の観点でも確認しました。",
      created_at: "2026-10-04T08:55:00.000Z",
      author_kind: "ai",
      author_label: "Codex",
    },
    {
      id: "reply-deleted",
      post_id: "own-1",
      body: "消した返信",
      created_at: now,
      author_kind: "self",
      deleted_at: now,
    },
  ];
  return { proposals, feedPosts, tasks: TASKS, themes: THEMES, reactions, replies };
}

function readModel(limit = 50) {
  const projected = projectFeedPosts({ ...workspace(), limit });
  return {
    ok: true,
    meta: {
      apiVersion: 1,
      schemaVersion: 7,
      serverId: "server-1",
      serverRevision: 1,
      generatedAt: now,
      truncated: projected.truncated,
    },
    data: projected,
  };
}

test("Androidへ渡すFeed read modelがgoldenと一致する", () => {
  const projected = readModel();
  // goldenの更新は意図したときだけ。差分が出たら契約変更としてレビューする。
  if (process.env.TASKEN_UPDATE_GOLDEN === "1") {
    writeFileSync(GOLDEN, `${JSON.stringify(projected, null, 2)}\n`);
  }
  const golden = JSON.parse(readFileSync(GOLDEN, "utf8"));
  assert.deepEqual(JSON.parse(JSON.stringify(projected)), golden);
  assert.equal(mobileFeedResponseSchema.safeParse(golden).success, true);
});

test("Desktopと同じ範囲の投稿だけを新しい順に並べる", () => {
  const { posts, truncated } = readModel().data;
  assert.equal(truncated, false);
  assert.deepEqual(
    posts.map((post) => post.postId),
    ["feed-post:p-codex", "own-1", "feed-post:p-claude", "feed-post:p-note"],
  );
  const [codex, own, claude, note] = posts;
  assert.equal(codex.authorLabel, "Codex");
  assert.equal(codex.authorKind, "ai");
  assert.equal(codex.taskTitle, "粘度測定の条件を決める");
  assert.equal(codex.themeName, "高分子材料評価");
  // 記事は題名だけを流し、本文と根拠は流さない。
  assert.deepEqual(codex.attachment, { kind: "note_draft", title: "粘度測定は温度を先に揃える" });
  assert.equal(JSON.stringify(codex).includes("内部の根拠"), false);
  assert.equal(JSON.stringify(codex).includes("本文は流さない"), false);
  assert.equal(own.authorKind, "human");
  assert.equal(own.authorLabel, "自分");
  assert.deepEqual(own.body, ["今日は粘度の実験を進める。", "温度条件は明日決める。"]);
  assert.equal(claude.authorLabel, "Claude Code");
  assert.deepEqual(claude.link, {
    url: "https://example.com/viscosity",
    label: "測定ガイド",
    comment: null,
  });
  assert.deepEqual(note.attachment, { kind: "note", title: "粘度の基礎" });
});

test("自分の反応と、返信（自分のメモ・AIの返答）を投稿に添える", () => {
  const posts = readModel().data.posts;
  const codex = posts.find((post) => post.postId === "feed-post:p-codex");
  // Androidが扱う反応だけを返す（hiddenやknownは流さない）。
  assert.deepEqual(codex.reactions.sort(), ["bookmark", "interesting"]);
  assert.deepEqual(posts.find((post) => post.postId === "own-1").reactions, []);
  // 返信は古い順。自分のメモ → AIの返答（Entity）→ AIの返答（Proposal）。削除済みは載らない。
  assert.deepEqual(
    codex.replies.map((reply) => [reply.replyId, reply.authorKind, reply.authorLabel]),
    [
      ["reply-self-1", "human", "自分"],
      ["feed-answer:a-claude", "ai", "Claude Code"],
      ["reply-ai-1", "ai", "Codex"],
    ],
  );
  assert.deepEqual(posts.find((post) => post.postId === "own-1").replies, []);
});

test("上限を超えたら切り、切ったことを伝える", () => {
  const { posts, truncated } = readModel(2).data;
  assert.equal(posts.length, 2);
  assert.equal(truncated, true);
});

class MemoryRepository {
  constructor(records) {
    this.records = records;
  }
  list(type, includeDeleted = false) {
    return this.records.filter(
      (entity) => entity.type === type && (includeDeleted || !entity.deleted_at),
    );
  }
  get(type, id, includeDeleted = false) {
    const found = this.records.find((entity) => entity.type === type && entity.id === id) || null;
    return found && (includeDeleted || !found.deleted_at) ? found : null;
  }
  save(type, entity) {
    const saved = { ...entity, type, deleted_at: null };
    this.records = [...this.records.filter((e) => !(e.type === type && e.id === entity.id)), saved];
    return saved;
  }
  remove(type, id) {
    const current = this.get(type, id);
    if (!current) return null;
    const removed = { ...current, deleted_at: now };
    this.records = this.records.map((e) => (e === current ? removed : e));
    return removed;
  }
  saveMany() {
    throw new Error("read only");
  }
  runTransaction(callback) {
    return callback(this);
  }
}

function gateway({ writable = false } = {}) {
  const { proposals, feedPosts, tasks, themes, reactions, replies } = workspace();
  const tag = (type) => (entity) => ({ ...entity, type });
  const repository = new MemoryRepository([
    ...proposals.map(tag("ai_proposal")),
    ...feedPosts.map(tag("feed_post")),
    ...tasks.map(tag("task")),
    ...themes.map(tag("theme")),
    ...reactions.map(tag("feed_reaction")),
    ...replies.map(tag("feed_reply")),
  ]);
  const saved = [];
  const feedWriter = writable
    ? {
        save: (type, entity) => {
          saved.push(["save", type, entity.id]);
          return repository.save(type, entity);
        },
        remove: (type, id) => {
          saved.push(["remove", type, id]);
          return repository.remove(type, id);
        },
      }
    : undefined;
  const runtime = new TaskenCoreRuntime(
    os.tmpdir(),
    repository,
    () => {
      throw new Error("read only");
    },
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    { feedWriter },
  );
  const adapter = runtime.createMobileGateway({
    current: () => ({ serverId: "desktop-home", serverRevision: 7, generatedAt: now }),
  });
  return { adapter, repository, saved };
}

const principal = { kind: "mobile_device", deviceId: "device-fold-7", scopes: ["mobile:read"] };
const query = { apiVersion: "1", schemaVersion: "7", requestId: "request-feed" };

test("gatewayは読み取り権限でFeedを返し、権限がなければ拒否する", async () => {
  const { adapter } = gateway();
  const ok = await adapter.handle({
    method: "GET",
    path: TASKEN_MOBILE_ENDPOINTS.feed,
    principal,
    query,
  });
  assert.equal(ok.status, 200);
  assert.equal(mobileFeedResponseSchema.safeParse(ok.body).success, true);
  assert.equal(ok.body.data.posts.length, 4);

  const forbidden = await adapter.handle({
    method: "GET",
    path: TASKEN_MOBILE_ENDPOINTS.feed,
    principal: { ...principal, scopes: [] },
    query,
  });
  assert.equal(forbidden.status, 403);

  const unknownQuery = await adapter.handle({
    method: "GET",
    path: TASKEN_MOBILE_ENDPOINTS.feed,
    principal,
    query: { ...query, cursor: "x" },
  });
  assert.equal(unknownQuery.status, 400);
});

const writer = {
  kind: "mobile_device",
  deviceId: "device-fold-7",
  scopes: ["mobile:read", "mobile:capture-write"],
};

function actionRequest(action, overrides = {}) {
  const commandId = overrides.commandId || "command-1";
  return {
    apiVersion: 1,
    schemaVersion: 7,
    requestId: `request-${commandId}`,
    commandId,
    idempotencyKey: commandId,
    clientDeviceId: "device-fold-7",
    issuedAt: "2026-10-04T10:00:00.000Z",
    action,
    ...overrides,
  };
}

function post(adapter, body, principalOverride = writer) {
  return adapter.handle({
    method: "POST",
    path: TASKEN_MOBILE_ENDPOINTS.feedActions,
    principal: principalOverride,
    body,
  });
}

test("反応は付ける・外すを繰り返しても増えず、再送は変更なしになる", async () => {
  const { adapter, repository, saved } = gateway({ writable: true });
  const on = actionRequest({
    name: "SetFeedReaction",
    postId: "own-1",
    kind: "interesting",
    on: true,
  });
  const first = await post(adapter, on);
  assert.equal(first.status, 200);
  assert.equal(mobileFeedActionResponseSchema.safeParse(first.body).success, true);
  assert.equal(first.body.data.status, "applied");
  // Desktopの画面と同じID規則・形で保存する。
  assert.deepEqual(saved, [["save", "feed_reaction", "feed-reaction:own-1:interesting"]]);
  assert.equal(
    repository.get("feed_reaction", "feed-reaction:own-1:interesting").kind,
    "interesting",
  );

  const again = await post(adapter, { ...on, commandId: "command-2", idempotencyKey: "command-2" });
  assert.equal(again.body.data.status, "no_change");
  assert.equal(saved.length, 1);

  const off = await post(
    adapter,
    actionRequest(
      { name: "SetFeedReaction", postId: "own-1", kind: "interesting", on: false },
      { commandId: "command-3" },
    ),
  );
  assert.equal(off.body.data.status, "applied");
  assert.deepEqual(saved[1], ["remove", "feed_reaction", "feed-reaction:own-1:interesting"]);
  const offAgain = await post(
    adapter,
    actionRequest(
      { name: "SetFeedReaction", postId: "own-1", kind: "interesting", on: false },
      { commandId: "command-4" },
    ),
  );
  assert.equal(offAgain.body.data.status, "no_change");
});

test("返信は自分のメモとして保存し、同じIDの再送は増やさず、内容が違えば拒否する", async () => {
  const { adapter, repository } = gateway({ writable: true });
  const reply = actionRequest({
    name: "PostFeedReply",
    replyId: "reply-new-1",
    postId: "feed-post:p-claude",
    body: "  この資料、来週読む。  ",
  });
  const first = await post(adapter, reply);
  assert.equal(first.status, 200);
  assert.equal(first.body.data.status, "applied");
  const stored = repository.get("feed_reply", "reply-new-1");
  assert.equal(stored.body, "この資料、来週読む。");
  assert.equal(stored.author_kind, "self");
  assert.equal(stored.created_at, "2026-10-04T10:00:00.000Z");
  // AIへの回答依頼は持たない。
  assert.equal("ai_requested_at" in stored, false);

  const resend = await post(adapter, {
    ...reply,
    commandId: "command-2",
    idempotencyKey: "command-2",
  });
  assert.equal(resend.body.data.status, "no_change");

  const changed = await post(adapter, {
    ...actionRequest({ ...reply.action, body: "別の内容" }, { commandId: "command-3" }),
  });
  assert.equal(changed.status, 409);
  assert.equal(repository.get("feed_reply", "reply-new-1").body, "この資料、来週読む。");

  // 読み出しにも並ぶ（自分のメモとして）。
  const read = await adapter.handle({
    method: "GET",
    path: TASKEN_MOBILE_ENDPOINTS.feed,
    principal: writer,
    query,
  });
  const claude = read.body.data.posts.find((entry) => entry.postId === "feed-post:p-claude");
  assert.deepEqual(
    claude.replies.map((entry) => [entry.replyId, entry.authorKind, entry.body]),
    [["reply-new-1", "human", "この資料、来週読む。"]],
  );
});

test("存在しない投稿・権限なし・他端末の名義・書き込み口なしは拒否する", async () => {
  const { adapter } = gateway({ writable: true });
  const missing = await post(
    adapter,
    actionRequest({
      name: "SetFeedReaction",
      postId: "feed-post:nope",
      kind: "bookmark",
      on: true,
    }),
  );
  assert.equal(missing.status, 404);

  const valid = actionRequest({
    name: "SetFeedReaction",
    postId: "own-1",
    kind: "bookmark",
    on: true,
  });
  assert.equal((await post(adapter, valid, { ...writer, scopes: ["mobile:read"] })).status, 403);
  assert.equal((await post(adapter, { ...valid, clientDeviceId: "device-other" })).status, 400);
  assert.equal(mobileFeedActionRequestSchema.safeParse({ ...valid, extra: true }).success, false);
  assert.equal(
    mobileFeedActionRequestSchema.safeParse(
      actionRequest({ name: "SetFeedReaction", postId: "own-1", kind: "hidden", on: true }),
    ).success,
    false,
  );
  assert.equal(
    mobileFeedActionRequestSchema.safeParse(
      actionRequest({ name: "PostFeedReply", replyId: "r", postId: "own-1", body: "   " }),
    ).success,
    false,
  );

  // 書き込み口を持たないCore（常時稼働node）では、書き込めない（capability_unavailable）と返す。
  const readOnly = gateway({ writable: false }).adapter;
  assert.equal((await post(readOnly, valid)).status, 409);
});
