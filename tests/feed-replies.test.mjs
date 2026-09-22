import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { WorkspaceDatabase } from "../src/main/repositories/workspaceRepository.mjs";
import { buildAttentionQueue, countAttention } from "../src/shared/contracts/task/public.ts";
import {
  buildExternalAiCopyText,
  buildPostsFromProposals,
  buildRepliesFromEntities,
  feedManualPasteEntity,
  feedReplyEntity,
  hasLiveFeedData,
  manualPasteLabel,
  manualPasteNoteCandidate,
  postsForHome,
  postsForLearning,
  replyPostId,
  withReplies,
} from "../src/renderer/src/features/workspace/lib/feedPosts.ts";

/**
 * SNS型Feed 第3段階: 投稿への返信。
 *
 * 返信は投稿のIDに紐づく独立したEntity（`feed_reply`）で、人とAIの返答を同じスレッドへ並べる。
 * 返信してもTaskと未解決件数は変わらない。投稿（読み物Proposal）を削除したときは
 * 返信と読んだ印も一緒に外れ、復元で一緒に戻る。
 */

const POST_PROPOSAL = "proposal-feed-reply";
const POST_ID = `feed-post:${POST_PROPOSAL}`;
const AT = "2026-09-21T10:00:00.000Z";

function feedProposal() {
  return {
    id: POST_PROPOSAL,
    source: "mcp",
    source_app: "claude",
    payload_type: "feed_posts",
    status: "pending",
    received_at: AT,
    created_at: AT,
    version: 1,
    payload: {
      feed_posts: [
        {
          action: "publish",
          topic: "insight",
          body: ["平均が近くても、ばらつきまで同じとは限りません。"],
          evidence: [],
        },
      ],
    },
  };
}

function reply(id, overrides = {}) {
  return {
    id,
    post_id: POST_ID,
    body: "サンプル数が少ないときも同じ見方でよい？",
    created_at: AT,
    author_kind: "self",
    ...overrides,
  };
}

function feedPosts(database) {
  return buildPostsFromProposals({ proposals: database.list("ai_proposal", true) });
}

test("返信は親投稿の直後へ並び、AIの返答も同じスレッドで読める", () => {
  const posts = [
    ...feedPostsOf([feedProposal()]),
    ...buildRepliesFromEntities({
      replies: [
        reply("reply-self-1"),
        reply("reply-ai-1", {
          body: "3回以下のときは幅だけを見てください。",
          author_kind: "ai",
          author_label: "Codex",
          created_at: "2026-09-21T10:05:00.000Z",
        }),
      ],
    }),
  ];
  // 画面と同じ順序: 新着順のタイムラインへ、スレッドの中だけ古い順で差し込む。
  const ordered = withReplies(postsForHome(posts));
  assert.deepEqual(
    ordered.map((post) => post.id),
    [POST_ID, replyPostId("reply-self-1"), replyPostId("reply-ai-1")],
    "親の直後へ書かれた順に並ぶ",
  );
  const [parent, own, answer] = ordered;
  assert.equal(own.replyTo, POST_ID);
  assert.equal(own.author, "self");
  assert.equal(own.paragraphs[0], "サンプル数が少ないときも同じ見方でよい？");
  assert.equal(answer.author, "codex", "AIの返答は投稿元の表示名を使う");
  assert.equal(answer.replyTo, POST_ID);
  assert.equal(answer.kind, "own_note");

  // 学びタブは返信で水増ししない。
  assert.deepEqual(
    postsForLearning(posts).map((post) => post.id),
    [POST_ID],
  );
});

function feedPostsOf(proposals) {
  return buildPostsFromProposals({ proposals });
}

function answerProposal() {
  return {
    id: "proposal-feed-answer",
    source: "mcp",
    source_app: "codex",
    payload_type: "feed_replies",
    status: "pending",
    received_at: "2026-09-21T10:10:00.000Z",
    created_at: "2026-09-21T10:10:00.000Z",
    payload: {
      feed_replies: [
        {
          action: "answer",
          post_id: POST_ID,
          reply_to: "question-1",
          body: "3回以下のときは幅だけを見てください。",
          author_label: "Codex",
        },
      ],
    },
    request: { idempotency_key: "feed-answer", source: "mcp", caller: "Codex" },
  };
}

test("AIの返答は同じスレッドへ並び、質問が「回答あり」になる", () => {
  const answeredThread = buildRepliesFromEntities({
    replies: [reply("question-1", { ai_requested_at: "2026-09-21T10:05:00.000Z" })],
    proposals: [answerProposal()],
  });
  const ordered = withReplies(postsForHome([...feedPostsOf([feedProposal()]), ...answeredThread]));
  assert.deepEqual(
    ordered.map((post) => post.id),
    [POST_ID, replyPostId("question-1"), "feed-answer:proposal-feed-answer"],
  );
  assert.equal(ordered[1].aiState, "answered", "返答が届いたら回答あり");
  assert.equal(ordered[2].author, "codex", "返答の表示名から投稿者を決める");
  assert.equal(ordered[2].replyTo, POST_ID, "返答は元の投稿のスレッドへ入る");
  assert.equal(ordered[2].paragraphs[0], "3回以下のときは幅だけを見てください。");

  // 返答が届いていない質問は依頼済みのままにする。
  const pending = buildRepliesFromEntities({
    replies: [reply("question-2", { ai_requested_at: "2026-09-21T10:06:00.000Z" })],
  });
  assert.equal(pending[0].aiState, "requested");

  // 削除された返答Proposalは読まない。
  assert.equal(
    buildRepliesFromEntities({
      proposals: [{ ...answerProposal(), deleted_at: "2026-09-22T00:00:00.000Z" }],
    }).length,
    0,
  );
});

test("返答Proposalも要対応の判断としては数えない", () => {
  const proposals = [feedProposal(), answerProposal()];
  assert.equal(countAttention(buildAttentionQueue({ proposals })), 0);
});

test("返信を保存しても要対応は増えない", () => {
  const proposals = [feedProposal()];
  const before = countAttention(buildAttentionQueue({ proposals }));
  const after = countAttention(buildAttentionQueue({ proposals }));
  assert.equal(before, 0, "読み物の投稿は判断ではない");
  assert.equal(after, 0);
});

test("返信は再起動後も残り、削除と復元ができる", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "tasken-feed-reply-"));
  const dbPath = path.join(directory, "workspace.sqlite");
  let database = new WorkspaceDatabase(dbPath);
  try {
    database.loadWorkspace();
    database.save("ai_proposal", feedProposal());
    database.save(
      "feed_reply",
      feedReplyEntity({ id: "reply-1", postId: POST_ID, body: "質問です。", createdAt: AT }),
    );
    assert.equal(database.list("feed_reply").length, 1);
    assert.equal(database.list("feed_reply")[0].author_kind, "self");

    database.db.close();
    database = new WorkspaceDatabase(dbPath);
    database.loadWorkspace();
    const replies = buildRepliesFromEntities({ replies: database.list("feed_reply", true) });
    assert.equal(replies.length, 1, "再起動後も返信を読める");
    assert.equal(replies[0].replyTo, POST_ID);

    database.remove("feed_reply", "reply-1");
    assert.equal(
      buildRepliesFromEntities({ replies: database.list("feed_reply", true) }).length,
      0,
    );
    database.restore("feed_reply", "reply-1");
    assert.equal(
      buildRepliesFromEntities({ replies: database.list("feed_reply", true) }).length,
      1,
    );
  } finally {
    database.db.close();
    await rm(directory, { recursive: true, force: true });
  }
});

test("投稿を削除すると返信と読んだ印も外れ、復元で一緒に戻る", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "tasken-feed-reply-cascade-"));
  const database = new WorkspaceDatabase(path.join(directory, "workspace.sqlite"));
  try {
    database.loadWorkspace();
    database.save("ai_proposal", feedProposal());
    database.save(
      "feed_reply",
      feedReplyEntity({ id: "reply-1", postId: POST_ID, body: "質問です。", createdAt: AT }),
    );
    database.save("feed_reaction", {
      id: "feed-reaction-1",
      post_id: POST_ID,
      kind: "bookmark",
      created_at: AT,
    });
    // 別の投稿への返信は巻き込まない。
    database.save(
      "feed_reply",
      feedReplyEntity({
        id: "reply-other",
        postId: "feed-post:other",
        body: "別の投稿への返信。",
        createdAt: AT,
      }),
    );

    database.remove("ai_proposal", POST_PROPOSAL);
    assert.equal(database.list("feed_reply").length, 1, "投稿を消したら返信も外れる");
    assert.equal(database.list("feed_reply")[0].id, "reply-other");
    assert.equal(database.list("feed_reaction").length, 0);

    database.restore("ai_proposal", POST_PROPOSAL);
    assert.equal(database.list("feed_reply").length, 2, "復元で返信も戻る");
    assert.equal(database.list("feed_reaction").length, 1);
  } finally {
    database.db.close();
    await rm(directory, { recursive: true, force: true });
  }
});

test("不正な返信は保存しない", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "tasken-feed-reply-bad-"));
  const database = new WorkspaceDatabase(path.join(directory, "workspace.sqlite"));
  try {
    database.loadWorkspace();
    assert.throws(
      () => feedReplyEntity({ id: "r", postId: POST_ID, body: "   ", createdAt: AT }),
      /本文/u,
    );
    assert.throws(
      () => database.save("feed_reply", reply("bad-1", { body: "" })),
      /feed_reply\.body/u,
    );
    assert.throws(
      () => database.save("feed_reply", reply("bad-2", { post_id: "" })),
      /feed_reply\.post_id/u,
    );
    assert.throws(
      () => database.save("feed_reply", reply("bad-3", { created_at: "2026-09-21" })),
      /feed_reply\.created_at/u,
    );
    assert.throws(
      () => database.save("feed_reply", reply("bad-4", { author_kind: "robot" })),
      /feed_reply\.author_kind/u,
    );
  } finally {
    database.db.close();
    await rm(directory, { recursive: true, force: true });
  }
});

/* -------------------------------------------------------------------------
 * 外部AIクリップボード往復（`docs/feed-external-ai-handoff-plan.md`）。
 * 自動送信・自動起動なし。人が確認して元投稿へ回答を残す一周だけを対象にする。
 * ---------------------------------------------------------------------- */

test("コピーはプレビューした内容だけで作り、余計な情報を付けない", () => {
  const text = buildExternalAiCopyText({
    question: "ばらつきが大きいときの判断材料は？",
    postParagraphs: ["平均が近くても、ばらつきまで同じとは限りません。"],
    sourceLabel: "Claude",
    referenceUrl: "https://example.com/calibration",
  });
  assert.match(text, /ばらつきが大きいときの判断材料は？/u);
  assert.match(text, /平均が近くても/u);
  assert.match(text, /Claude/u);
  assert.match(text, /https:\/\/example\.com\/calibration/u);
  assert.match(text, /与えた文脈と推測を区別し/u);
  assert.doesNotMatch(text, /feed-post:/u, "内部IDをURLのように見せない");
  assert.doesNotMatch(text, /^\s*\{/u, "JSONを要求しない");
});

test("コピーは空・上限超過・不正URLを拒否し、省略を明示させる", () => {
  assert.throws(
    () =>
      buildExternalAiCopyText({ question: "  ", postParagraphs: ["本文"], sourceLabel: "Claude" }),
    /質問/u,
  );
  assert.throws(
    () =>
      buildExternalAiCopyText({ question: "質問", postParagraphs: ["  "], sourceLabel: "Claude" }),
    /本文/u,
  );
  assert.throws(
    () =>
      buildExternalAiCopyText({
        question: "質問",
        postParagraphs: ["本文"],
        sourceLabel: "Claude",
        referenceUrl: "javascript:alert(1)",
      }),
    /URL/u,
  );
  const long = "あ".repeat(2001);
  assert.throws(
    () =>
      buildExternalAiCopyText({ question: "質問", postParagraphs: [long], sourceLabel: "Claude" }),
    /抜粋/u,
  );
  const truncated = buildExternalAiCopyText({
    question: "質問",
    postParagraphs: ["本文"],
    sourceLabel: "Claude",
    excerptTruncated: true,
  });
  assert.match(truncated, /以下省略/u);
});

test("手動貼付は人間保存・外部AI出所を区別し、MCP待ちを付けない", () => {
  const entity = feedManualPasteEntity({
    id: "reply-manual-1",
    postId: POST_ID,
    body: "3回以下のときは幅だけを見てください。",
    createdAt: AT,
    question: "サンプル数が少ないときも同じ見方でよい？",
    externalSource: "M365 Copilot",
    externalUrl: "https://example.com/chat/1",
    comment: "次は湿度だけ振った場合も同じ表で見たい。",
  });
  assert.equal(entity.author_kind, "self");
  assert.equal(entity.origin, "manual_paste");
  assert.equal(entity.external_source, "M365 Copilot");
  assert.equal(entity.external_url, "https://example.com/chat/1");
  assert.ok(!("ai_requested_at" in entity), "コピー・貼付でMCP待ちを付けない");
});

test("手動貼付の入力制約を示し、無言で切り捨てない", () => {
  assert.throws(
    () =>
      feedManualPasteEntity({
        id: "r",
        postId: POST_ID,
        body: "  ",
        createdAt: AT,
        question: "質問",
      }),
    /回答/u,
  );
  assert.throws(
    () =>
      feedManualPasteEntity({
        id: "r",
        postId: POST_ID,
        body: "あ".repeat(4001),
        createdAt: AT,
        question: "質問",
      }),
    /4000/u,
  );
  assert.throws(
    () =>
      feedManualPasteEntity({
        id: "r",
        postId: POST_ID,
        body: "回答",
        createdAt: AT,
        question: "  ",
      }),
    /質問/u,
  );
  assert.throws(
    () =>
      feedManualPasteEntity({
        id: "r",
        postId: POST_ID,
        body: "回答",
        createdAt: AT,
        question: "質問",
        externalUrl: "file:///C:/secret.txt",
      }),
    /会話URL/u,
  );
  assert.throws(
    () =>
      feedManualPasteEntity({
        id: "r",
        postId: POST_ID,
        body: "回答",
        createdAt: AT,
        question: "質問",
        comment: "あ".repeat(1001),
      }),
    /一言/u,
  );
});

test("表示は手動貼付と自動受信を区別する", () => {
  assert.equal(
    manualPasteLabel({ external_source: "M365 Copilot" }),
    "自分が貼り付け · M365 Copilot",
  );
  assert.equal(manualPasteLabel({ external_source: "" }), "自分が貼り付け · 外部AI");
  assert.equal(manualPasteLabel({}), "自分が貼り付け · 外部AI");
});

test("自分の投稿だけでもfixtureから切り替わる", () => {
  assert.equal(hasLiveFeedData({ livePosts: [], replyPosts: [], ownPosts: [] }), false);
  assert.equal(hasLiveFeedData({ livePosts: [], replyPosts: [], ownPosts: [{ id: "a" }] }), true);
  assert.equal(hasLiveFeedData({ livePosts: [], replyPosts: [{ id: "r" }], ownPosts: [] }), true);
});

test("手動貼付はスレッドへ写り、通常返信の意味を変えない", () => {
  const posts = buildRepliesFromEntities({
    replies: [
      {
        id: "reply-manual-1",
        post_id: POST_ID,
        body: "3回以下のときは幅だけを見てください。",
        created_at: AT,
        author_kind: "self",
        origin: "manual_paste",
        question: "サンプル数が少ないときも同じ見方でよい？",
        external_source: "M365 Copilot",
        external_url: "https://example.com/chat/1",
        comment: "次も同じ表で見たい。",
      },
    ],
  });
  assert.equal(posts.length, 1);
  assert.equal(posts[0].replyTo, POST_ID);
  assert.equal(posts[0].manualOrigin, "manual_paste");
  assert.equal(posts[0].manualQuestion, "サンプル数が少ないときも同じ見方でよい？");
  assert.equal(posts[0].manualSource, "M365 Copilot");
  assert.equal(posts[0].manualUrl, "https://example.com/chat/1");
  assert.equal(posts[0].manualComment, "次も同じ表で見たい。");
  assert.equal(posts[0].aiState, null);
  assert.equal(posts[0].learnable, false);
});

test("Note候補は回答と補足だけを渡し、人が確認して保存する", () => {
  const candidate = manualPasteNoteCandidate({
    postId: POST_ID,
    question: "サンプル数が少ないときも同じ見方でよい？",
    answer: "3回以下のときは幅だけを見てください。",
    externalSource: "M365 Copilot",
    externalUrl: "https://example.com/chat/1",
    comment: "次も同じ表で見たい。",
  });
  assert.match(candidate.body_markdown, /3回以下/u);
  assert.match(candidate.body_markdown, /次も同じ表/u);
  assert.match(
    candidate.body_markdown,
    new RegExp(POST_ID.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "u"),
  );
  assert.match(candidate.body_markdown, /事実確認済みを意味しません/u);
});

test("手動貼付は再起動・削除/復元・JSON往復で保たれ、Task状態を変えない", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "tasken-feed-manual-"));
  const dbPath = path.join(directory, "workspace.sqlite");
  let database = new WorkspaceDatabase(dbPath);
  try {
    database.loadWorkspace();
    const manual = feedManualPasteEntity({
      id: "reply-manual-1",
      postId: POST_ID,
      body: "3回以下のときは幅だけを見てください。",
      createdAt: AT,
      question: "サンプル数が少ないときも同じ見方でよい？",
      externalSource: "M365 Copilot",
      comment: "次も同じ表で見たい。",
    });
    database.save("feed_reply", manual);
    database.save(
      "feed_reply",
      feedReplyEntity({ id: "reply-self-1", postId: POST_ID, body: "通常の返信。", createdAt: AT }),
    );
    assert.equal(database.list("feed_reply").length, 2);

    // Export/Importの直列化（Snapshotは収集をJSONで generic に回す）でも落ちない。
    const revived = JSON.parse(JSON.stringify(database.list("feed_reply", true)));
    const replies = buildRepliesFromEntities({ replies: revived });
    assert.equal(replies.length, 2);
    const draft = replies.find((entry) => entry.replyId === "reply-manual-1");
    assert.equal(draft?.manualOrigin, "manual_paste");
    assert.equal(draft?.manualSource, "M365 Copilot");

    database.db.close();
    database = new WorkspaceDatabase(dbPath);
    database.loadWorkspace();
    const afterRestart = buildRepliesFromEntities({ replies: database.list("feed_reply", true) });
    assert.equal(afterRestart.length, 2);

    database.remove("feed_reply", "reply-manual-1");
    assert.equal(database.list("feed_reply").length, 1);
    database.restore("feed_reply", "reply-manual-1");
    assert.equal(database.list("feed_reply").length, 2);

    // 通常返信や手動貼付で要対応は増えない。
    assert.equal(countAttention(buildAttentionQueue({ proposals: [] })), 0);

    // 古い返信（任意フィールドなし）も読める。
    database.save("feed_reply", {
      id: "reply-legacy-1",
      post_id: POST_ID,
      body: "以前の返信。",
      created_at: AT,
      author_kind: "self",
    });
    const withLegacy = buildRepliesFromEntities({ replies: database.list("feed_reply", true) });
    assert.equal(withLegacy.length, 3);

    // 通常返信に手動貼付の出所は付けられない。
    assert.throws(
      () =>
        database.save("feed_reply", {
          id: "bad-1",
          post_id: POST_ID,
          body: "本文。",
          created_at: AT,
          author_kind: "self",
          external_source: "M365 Copilot",
        }),
      /手動貼付/u,
    );
  } finally {
    database.db.close();
    await rm(directory, { recursive: true, force: true });
  }
});
