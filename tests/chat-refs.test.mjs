import assert from "node:assert/strict";
import { Buffer } from "node:buffer";
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

test("reordering a chat group rewrites stable sort_order values", () => {
  const reordered = chatRefs.reorderChatGroupResources([
    resource("a", "A", { sort_order: 10 }),
    resource("b", "B", { sort_order: 20 }),
    resource("c", "C", { sort_order: 30 }),
  ], "c", "up");

  assert.deepEqual(reordered.map((r) => r.id), ["a", "c", "b"]);
  assert.deepEqual(reordered.map((r) => r.sort_order), [10, 20, 30]);
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
