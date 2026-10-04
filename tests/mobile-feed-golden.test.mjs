import assert from "node:assert/strict";
import { Buffer } from "node:buffer";
import { readFileSync, writeFileSync } from "node:fs";
import os from "node:os";
import test from "node:test";

import { build } from "esbuild";

import { mobileFeedResponseSchema } from "../src/shared/contracts/mobile/public.ts";
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
  return { proposals, feedPosts, tasks: TASKS, themes: THEMES };
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
  get(type, id) {
    return this.records.find((entity) => entity.type === type && entity.id === id) || null;
  }
  save() {
    throw new Error("read only");
  }
  saveMany() {
    throw new Error("read only");
  }
  runTransaction(callback) {
    return callback(this);
  }
}

function gateway() {
  const { proposals, feedPosts, tasks, themes } = workspace();
  const tag = (type) => (entity) => ({ ...entity, type });
  const repository = new MemoryRepository([
    ...proposals.map(tag("ai_proposal")),
    ...feedPosts.map(tag("feed_post")),
    ...tasks.map(tag("task")),
    ...themes.map(tag("theme")),
  ]);
  const runtime = new TaskenCoreRuntime(os.tmpdir(), repository, () => {
    throw new Error("read only");
  });
  return runtime.createMobileGateway({
    current: () => ({ serverId: "desktop-home", serverRevision: 7, generatedAt: now }),
  });
}

const principal = { kind: "mobile_device", deviceId: "device-fold-7", scopes: ["mobile:read"] };
const query = { apiVersion: "1", schemaVersion: "7", requestId: "request-feed" };

test("gatewayは読み取り権限でFeedを返し、権限がなければ拒否する", async () => {
  const adapter = gateway();
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
