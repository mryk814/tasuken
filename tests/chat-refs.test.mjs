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
  assert.ok(grouped[0].activityAt);
});

test("chat groups can be ordered by recent activity while keeping name order available", () => {
  const resources = [
    resource("old", "旧", { chat_group: "古い案", updated_at: "2026-05-01T10:00:00.000Z" }),
    resource("new", "新", { chat_group: "最新案", updated_at: "2026-07-01T10:00:00.000Z" }),
    resource("mid", "中", { chat_group: "中間案", updated_at: "2026-06-01T10:00:00.000Z" }),
    resource("free", "未分類", { chat_group: "", updated_at: "2026-07-08T10:00:00.000Z" }),
  ];

  const byName = chatRefs.groupChatResources(resources, {
    resourceOrder: "newest",
    groupOrder: "name",
  });
  const namedByLocale = ["古い案", "最新案", "中間案"].sort((a, b) => a.localeCompare(b, "ja-JP"));
  assert.deepEqual(byName.map((group) => group.label), [...namedByLocale, "未分類"]);

  const byRecent = chatRefs.groupChatResources(resources, {
    resourceOrder: "newest",
    groupOrder: "recent",
  });
  assert.deepEqual(byRecent.map((group) => group.label), ["最新案", "中間案", "古い案", "未分類"]);
  assert.equal(byRecent[0].activityAt, "2026-07-01T10:00:00.000Z");
});

test("recent group order follows saved updated_at only, not click-side overrides by default", () => {
  const resources = [
    resource("old", "旧", { chat_group: "A案", updated_at: "2026-05-01T10:00:00.000Z" }),
    resource("new", "新", { chat_group: "B案", updated_at: "2026-07-01T10:00:00.000Z" }),
  ];
  const grouped = chatRefs.groupChatResources(resources, {
    resourceOrder: "newest",
    groupOrder: "recent",
  });
  assert.deepEqual(grouped.map((group) => group.key), ["B案", "A案"]);
  assert.equal(grouped[0].activityAt, "2026-07-01T10:00:00.000Z");
});

test("pinned groups sort before recent/name order for future pin coexistence", () => {
  const a = { key: "A", label: "A", resources: [], activityAt: "2026-01-01", pinned: false };
  const b = { key: "B", label: "B", resources: [], activityAt: "2026-07-01", pinned: true };
  const c = { key: "C", label: "C", resources: [], activityAt: "2026-06-01", pinned: false };
  const ordered = [a, b, c].sort((left, right) => chatRefs.compareChatGroups(left, right, "recent"));
  assert.deepEqual(ordered.map((group) => group.key), ["B", "C", "A"]);
});

test("archive keeps theme and group while excluding from active list", () => {
  const active = resource("live", "通常", {
    chat_group: "検討",
    project_id: "theme-1",
    reference_status: "adopted",
    description: "メモ",
    url: "https://example.test/live",
  });
  const archived = chatRefs.archiveChatResource(active, "2026-07-08T12:00:00.000Z");

  assert.equal(archived.chat_group, "検討");
  assert.equal(archived.project_id, "theme-1");
  assert.equal(archived.reference_status, "adopted");
  assert.equal(archived.description, "メモ");
  assert.equal(archived.url, "https://example.test/live");
  assert.equal(archived.archived_at, "2026-07-08T12:00:00.000Z");
  assert.equal(chatRefs.isChatArchived(archived), true);
  assert.equal(chatRefs.isChatArchived(active), false);

  assert.deepEqual(
    chatRefs.filterChatResourcesByArchive([active, archived], "active").map((r) => r.id),
    ["live"],
  );
  assert.deepEqual(
    chatRefs.filterChatResourcesByArchive([active, archived], "archive").map((r) => r.id),
    ["live"],
  );

  const both = [
    resource("a", "A"),
    resource("b", "B", { archived_at: "2026-07-01T00:00:00.000Z" }),
  ];
  assert.deepEqual(chatRefs.filterChatResourcesByArchive(both, "active").map((r) => r.id), ["a"]);
  assert.deepEqual(chatRefs.filterChatResourcesByArchive(both, "archive").map((r) => r.id), ["b"]);
  assert.deepEqual(
    chatRefs.filterChatResourcesByArchive(both, "active", { includeArchivedInActive: true }).map((r) => r.id),
    ["a", "b"],
  );

  const restored = chatRefs.restoreChatResource(archived);
  assert.equal(restored.archived_at, null);
  assert.equal(restored.chat_group, "検討");
  assert.equal(restored.reference_status, "adopted");
});

test("archive is separate from group clear and does not wipe chat_group", () => {
  const current = [
    resource("a", "A", { chat_group: "旧グループ" }),
    resource("b", "B", { chat_group: "旧グループ" }),
  ];
  const archived = chatRefs.archiveChatResources(current, "2026-07-08T00:00:00.000Z");
  assert.deepEqual(archived.map((r) => r.chat_group), ["旧グループ", "旧グループ"]);
  assert.ok(archived.every((r) => chatRefs.isChatArchived(r)));

  const cleared = chatRefs.clearChatGroupResources(current);
  assert.deepEqual(cleared.map((r) => r.chat_group), [null, null]);
  assert.ok(cleared.every((r) => !chatRefs.isChatArchived(r)));
});

test("fully archived groups drop out of active group name suggestions", () => {
  const themeId = "theme-1";
  const resources = [
    resource("live", "残る", { chat_group: "現行", project_id: themeId }),
    resource("old-a", "旧A", { chat_group: "完了案", project_id: themeId, archived_at: "2026-07-01T00:00:00.000Z" }),
    resource("old-b", "旧B", { chat_group: "完了案", project_id: themeId, archived_at: "2026-07-02T00:00:00.000Z" }),
    resource("other", "他Theme", { chat_group: "現行", project_id: "theme-2" }),
  ];
  assert.deepEqual(chatRefs.listActiveChatGroupNames(resources, themeId), ["現行"]);
  assert.deepEqual(chatRefs.listActiveChatGroupNames(resources, "theme-2"), ["現行"]);
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
