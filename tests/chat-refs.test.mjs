import assert from "node:assert/strict";
import { Buffer } from "node:buffer";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { build } from "esbuild";

async function importBundled(relativePath) {
  const result = await build({
    entryPoints: [path.resolve(relativePath)],
    bundle: true,
    platform: "browser",
    format: "esm",
    write: false,
    logLevel: "silent",
  });
  const code = result.outputFiles[0].text;
  return import(`data:text/javascript;base64,${Buffer.from(code).toString("base64")}`);
}

const chatRefs = await importBundled("src/renderer/src/features/workspace/lib/chatRefs.ts");

function resource(id, title, extra = {}) {
  return {
    id,
    title,
    url: `https://example.test/${id}`,
    captured_at: "2026-06-30",
    chat_group: "検討",
    ...extra,
  };
}

test("chat reference detection separates chat links from ordinary resources", () => {
  assert.equal(chatRefs.isChatReference(resource("chatgpt", "ChatGPT", { link_type: "chatgpt" })), true);
  assert.equal(chatRefs.isChatReference(resource("claude", "Claude", { url: "https://claude.ai/chat/abc" })), true);
  assert.equal(chatRefs.isChatReference(resource("adopted", "採用", { reference_status: "adopted" })), true);
  assert.equal(chatRefs.isChatReference(resource("paper", "論文", { link_type: "paper", url: "https://example.test/paper" })), false);
});

test("manual resource scope overrides chat reference inference", () => {
  assert.equal(chatRefs.isChatReference(resource("chat-note", "Chat note", {
    url: "https://claude.ai/chat/abc",
    resource_scope: "note",
  })), false);
  assert.equal(chatRefs.isChatReference(resource("ordinary-chat-ref", "Ordinary", {
    url: "https://example.test/paper",
    resource_scope: "chat_ref",
  })), true);
});

test("chat references keep manual order before date fallback", () => {
  const grouped = chatRefs.groupChatResources([
    resource("b", "B", { sort_order: 20, captured_at: "2026-06-29" }),
    resource("a", "A", { sort_order: 10, captured_at: "2026-06-30" }),
    resource("c", "C", { chat_group: "" }),
  ], "manual");

  assert.deepEqual(grouped.map((group) => group.label), ["検討", "未分類"]);
  assert.deepEqual(grouped[0].resources.map((r) => r.id), ["a", "b"]);
  assert.equal(grouped[1].key, chatRefs.UNGROUPED_CHAT_GROUP);
});

test("chat references use timestamp fallbacks when sorting same-day links by newest", () => {
  const grouped = chatRefs.groupChatResources([
    resource("alpha", "A", {
      captured_at: "2026-07-02",
      created_at: "2026-07-02T09:30:00.000",
    }),
    resource("bravo", "B", {
      captured_at: "2026-07-02",
      created_at: "2026-07-02T10:15:00.000",
    }),
    resource("charlie", "C", {
      captured_at: "2026-07-01T23:00:00.000",
      created_at: "2026-07-02T12:00:00.000",
    }),
  ], "newest");

  assert.deepEqual(grouped[0].resources.map((r) => r.id), ["bravo", "alpha", "charlie"]);
});

test("chat reference date labels include minutes when a usable timestamp is present", () => {
  assert.equal(chatRefs.formatChatResourceDate(resource("date", "日付のみ", { captured_at: "2026-07-02" })), "2026/07/02");
  assert.equal(
    chatRefs.formatChatResourceDate(resource("created", "作成時刻", {
      captured_at: "2026-07-02",
      created_at: "2026-07-02T10:15:00.000",
    })),
    "2026/07/02 10:15",
  );
  assert.equal(
    chatRefs.formatChatResourceDate(resource("captured", "保存時刻", { captured_at: "2026-07-02T11:05:00.000" })),
    "2026/07/02 11:05",
  );
});

test("chat reference date labels convert stored UTC timestamps to local time", () => {
  assert.equal(
    chatRefs.formatChatResourceDate(resource("utc", "UTC", { captured_at: "2026-07-02T01:15:00.000Z" })),
    "2026/07/02 10:15",
  );
  assert.equal(
    chatRefs.formatChatResourceDate(resource("utc-created", "UTC created", {
      captured_at: "2026-07-03",
      created_at: "2026-07-02T15:15:00.000Z",
    })),
    "2026/07/03 00:15",
  );
});

test("submitted chat captured dates preserve the initial timestamp when the day is unchanged", () => {
  assert.equal(
    chatRefs.resolveSubmittedChatCapturedAt("2026-07-02", "2026-07-02T10:15:30.000"),
    "2026-07-02T10:15:30.000",
  );
  assert.equal(
    chatRefs.resolveSubmittedChatCapturedAt("2026-07-02", "2026-07-02T01:15:30.000Z"),
    "2026-07-02T01:15:30.000Z",
  );
  assert.equal(
    chatRefs.resolveSubmittedChatCapturedAt("2026-07-03", "2026-07-02T10:15:30.000"),
    "2026-07-03",
  );
  assert.equal(chatRefs.resolveSubmittedChatCapturedAt("", "2026-07-02T10:15:30.000"), "2026-07-02T10:15:30.000");
});

test("chat thread labels describe parent links as original chat", () => {
  assert.deepEqual(chatRefs.chatThreadMetaLabels({ parentTitle: "初回相談", childCount: 2 }), ["元チャット：初回相談", "続き2件"]);
  assert.deepEqual(chatRefs.chatThreadMetaLabels({ parentTitle: "初回相談", childCount: 0 }), ["元チャット：初回相談"]);
  assert.deepEqual(chatRefs.chatThreadMetaLabels({ parentTitle: "", childCount: 1 }), ["続き1件"]);
});

test("drag reordering a chat group rewrites stable sort_order values", () => {
  const current = [
    resource("a", "A", { sort_order: 10 }),
    resource("b", "B", { sort_order: 20 }),
    resource("c", "C", { sort_order: 30 }),
  ];
  const reordered = chatRefs.reorderChatGroupResources(current, "c", "b", "before");

  assert.deepEqual(reordered.map((r) => r.id), ["a", "c", "b"]);
  assert.deepEqual(reordered.map((r) => r.sort_order), [10, 20, 30]);

  const movedToEnd = chatRefs.reorderChatGroupResources(current, "a", "c", "after");
  assert.deepEqual(movedToEnd.map((r) => r.id), ["b", "c", "a"]);
});

test("renaming and clearing a chat group keeps every link record", () => {
  const current = [
    resource("a", "A", { chat_group: "旧グループ" }),
    resource("b", "B", { chat_group: "旧グループ" }),
  ];

  const renamed = chatRefs.renameChatGroupResources(current, "新グループ");
  assert.deepEqual(renamed.map((r) => r.id), ["a", "b"]);
  assert.deepEqual(renamed.map((r) => r.chat_group), ["新グループ", "新グループ"]);

  const cleared = chatRefs.clearChatGroupResources(renamed);
  assert.deepEqual(cleared.map((r) => r.id), ["a", "b"]);
  assert.deepEqual(cleared.map((r) => r.chat_group), [null, null]);
});

test("knowledge prompt includes group context and all chat links", () => {
  const prompt = chatRefs.buildChatGroupKnowledgePrompt({
    groupLabel: "CAE相談",
    themeName: "AI活用検討",
    resources: [
      resource("claude", "Claude相談", { url: "https://claude.ai/chat/1", description: "形状最適化の論点" }),
      resource("gpt", "ChatGPT相談", { url: "https://chatgpt.com/c/2" }),
    ],
    basePrompt: "既存プロンプト",
  });

  assert.match(prompt, /既存プロンプト/);
  assert.match(prompt, /Theme: AI活用検討/);
  assert.match(prompt, /チャットグループ: CAE相談/);
  assert.match(prompt, /Claude相談/);
  assert.match(prompt, /https:\/\/claude\.ai\/chat\/1/);
  assert.match(prompt, /ChatGPT相談/);
  assert.match(prompt, /https:\/\/chatgpt\.com\/c\/2/);
});

test("chat reference page no longer offers moving chat links to Notes", () => {
  const source = readFileSync("src/renderer/src/features/workspace/pages/ChatRefsPage.tsx", "utf8");

  assert.doesNotMatch(source, /Notesへ移す/);
  assert.doesNotMatch(source, /moveResourceToNotes/);
});
