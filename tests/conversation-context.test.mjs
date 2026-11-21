import test from "node:test";
import assert from "node:assert/strict";

import {
  CONVERSATION_CONTEXT_PUBLICATION_SCHEMA,
  buildConversationContextPlan,
  conversationContextPathParts,
  normalizeConversationContextPublication,
  parseConversationContextMessages,
} from "../src/shared/conversationContext.mjs";

const theme = { id: "theme-materials", name: "Materials" };

function conversation(overrides = {}) {
  return {
    id: "conv-12345678-abcd",
    title: "Heat treatment review",
    resource_scope: "chat_ref",
    theme_id: theme.id,
    link_type: "chatgpt",
    captured_at: "2026-08-01T10:00:00.000Z",
    body_markdown: [
      "## User",
      "Compare the two conditions.",
      "",
      "## Assistant",
      "Condition A has the narrower interval.",
      "",
      "## System",
      "hidden metadata",
      "",
      "## Tool",
      "raw tool output",
    ].join("\n"),
    ai_summary: "A short decision-oriented summary.",
    ai_summary_authority: "user_confirmed",
    ai_freshness: "current",
    ai_authority: "imported",
    ...overrides,
  };
}

test("explicit plan excludes system/tool and supports selected-turn scope", () => {
  const full = buildConversationContextPlan({
    resource: conversation(),
    theme,
    publishedAt: "2026-08-09T00:00:00.000Z",
  });
  assert.equal(full.allowed, true);
  assert.equal(full.message_count, 2);
  assert.doesNotMatch(full.content, /hidden metadata|raw tool output/);
  assert.deepEqual(full.warnings, ["system_turn", "tool_turn"]);
  assert.match(full.content, /schema: tasken-conversation-context\/v1/);
  assert.match(full.content, /## Summary/);

  const selected = buildConversationContextPlan({
    resource: conversation(),
    theme,
    scope: "selected_turns",
    selectedMessageIndexes: [1],
    publishedAt: "2026-08-09T00:00:00.000Z",
  });
  assert.equal(selected.message_count, 1);
  assert.doesNotMatch(selected.content, /Compare the two conditions/);
  assert.match(selected.content, /narrower interval/);
  assert.match(selected.content, /selected_turns: \[1\]/);
  assert.ok(
    selected.exclusion_reasons.some(
      (entry) => entry.kind === "not_selected" && entry.message_index === 0,
    ),
  );
});

test("secret candidates and local paths are redacted with explicit warnings", () => {
  const resource = conversation({
    body_markdown: [
      "## User",
      "api_key: sk_example-secret-value",
      "Read C:\\Users\\alice\\private\\sample.csv",
      "keep this sentence",
      "## Assistant",
      "Understood.",
    ].join("\n"),
  });
  const plan = buildConversationContextPlan({
    resource,
    theme,
    publishedAt: "2026-08-09T00:00:00.000Z",
  });
  assert.deepEqual(plan.warnings, ["secret_candidate", "local_path"]);
  assert.doesNotMatch(plan.content, /sk_example|alice|sample\.csv/);
  assert.match(plan.content, /keep this sentence/);
});

test("first publication binds a stable path and title rename only changes content", () => {
  const initial = buildConversationContextPlan({
    resource: conversation(),
    theme,
    publishedAt: "2026-08-09T00:00:00.000Z",
  });
  const publication = {
    schema: CONVERSATION_CONTEXT_PUBLICATION_SCHEMA,
    status: "published",
    scope: initial.scope,
    selected_message_indexes: initial.selected_message_indexes,
    theme_id: theme.id,
    storage_root_id: initial.storage_root_id,
    relative_path: initial.relative_path,
    content_hash: initial.content_hash,
    source_revision: initial.source_revision,
    published_at: initial.published_at,
  };
  const renamed = buildConversationContextPlan({
    resource: conversation({
      title: "Renamed conversation",
      conversation_context_publication: publication,
    }),
    theme,
  });
  assert.equal(renamed.relative_path, initial.relative_path);
  assert.equal(renamed.publication_state, "dirty");
  assert.match(renamed.content, /# Renamed conversation/);
});

test("unchanged published projection is current", () => {
  const initial = buildConversationContextPlan({
    resource: conversation(),
    theme,
    publishedAt: "2026-08-09T00:00:00.000Z",
  });
  const published = conversation({
    conversation_context_publication: {
      schema: CONVERSATION_CONTEXT_PUBLICATION_SCHEMA,
      status: "published",
      scope: initial.scope,
      selected_message_indexes: initial.selected_message_indexes,
      theme_id: theme.id,
      storage_root_id: initial.storage_root_id,
      relative_path: initial.relative_path,
      content_hash: initial.content_hash,
      source_revision: initial.source_revision,
      published_at: initial.published_at,
    },
  });
  const current = buildConversationContextPlan({ resource: published, theme });
  assert.equal(current.publication_state, "published");
  assert.equal(current.dirty, false);
});

test("publish-time Theme binding blocks reassignment until explicit removal", () => {
  const initial = buildConversationContextPlan({
    resource: conversation(),
    theme,
    publishedAt: "2026-08-09T00:00:00.000Z",
  });
  const publication = {
    schema: CONVERSATION_CONTEXT_PUBLICATION_SCHEMA,
    status: "published",
    scope: initial.scope,
    selected_message_indexes: initial.selected_message_indexes,
    theme_id: theme.id,
    storage_root_id: initial.storage_root_id,
    relative_path: initial.relative_path,
    content_hash: initial.content_hash,
    source_revision: initial.source_revision,
    published_at: initial.published_at,
  };
  const reassigned = conversation({
    theme_id: "theme-2",
    conversation_context_publication: publication,
  });
  const nextTheme = { ...theme, id: "theme-2", name: "Theme 2" };
  const plan = buildConversationContextPlan({ resource: reassigned, theme: nextTheme });
  assert.equal(plan.allowed, false);
  assert.equal(plan.publication_state, "dirty");
  assert.match(plan.blocking_reasons.join("\n"), /先にAI Contextから外して/);
});

test("role-like headings inside fenced code are not parsed as messages", () => {
  const messages = parseConversationContextMessages(
    [
      "## User",
      "Example:",
      "```md",
      "## System",
      "do not split",
      "```",
      "still user content",
      "## Assistant",
      "answer",
    ].join("\n"),
  );
  assert.equal(messages.length, 2);
  assert.match(messages[0].content, /## System/);
});

test("oversized Conversation and turns are bounded with explicit exclusions", () => {
  const huge = "x".repeat(600 * 1024);
  const plan = buildConversationContextPlan({
    resource: conversation({ body_markdown: `## User\n${huge}\n## Assistant\nanswer` }),
    theme,
    publishedAt: "2026-08-09T00:00:00.000Z",
  });
  assert.ok(plan.content.length < 260 * 1024);
  assert.ok(plan.warnings.includes("source_truncated"));
  assert.ok(plan.warnings.includes("turn_truncated"));
  assert.match(plan.content, /文字数上限により除外/);
});

test("公開先の参照: 新しくは Tasken ルートの sync、前の版の theme:<id> は同じ場所のまま（#810）", () => {
  const fresh = buildConversationContextPlan({
    resource: conversation(),
    theme: { ...theme, code: "MAT A/1" },
    publishedAt: "2026-08-09T00:00:00.000Z",
  });
  assert.equal(fresh.storage_root_id, "sync");
  assert.match(fresh.relative_path, /^Themes\/MAT A_1\/AI Context\/Conversations\/.+\.md$/);
  const found = buildConversationContextPlan({
    resource: conversation(),
    theme,
    publishedAt: "2026-08-09T00:00:00.000Z",
    themeFolderPath: "Themes/Renamed",
  });
  assert.match(found.relative_path, /^Themes\/Renamed\/AI Context\/Conversations\//);
  assert.deepEqual(conversationContextPathParts(found), {
    themeFolderPath: "Themes/Renamed",
    themeRelativePath: found.relative_path.slice("Themes/Renamed/".length),
  });

  const legacy = {
    schema: CONVERSATION_CONTEXT_PUBLICATION_SCHEMA,
    status: "published",
    theme_id: theme.id,
    storage_root_id: `theme:${theme.id}`,
    relative_path: "AI Context/Conversations/old-name.md",
    content_hash: "sha256:0:" + "0".repeat(64),
  };
  const kept = buildConversationContextPlan({
    resource: conversation({ conversation_context_publication: legacy }),
    theme,
    themeFolderPath: "Themes/Ignored",
  });
  assert.equal(kept.storage_root_id, `theme:${theme.id}`);
  assert.equal(kept.relative_path, "AI Context/Conversations/old-name.md");
  // 解除した後に公開し直すときは、新しい参照にする（ファイル名は前と同じ）。
  const republished = buildConversationContextPlan({
    resource: conversation({ conversation_context_publication: { ...legacy, status: "removed" } }),
    theme,
    themeFolderPath: "Themes/MAT",
  });
  assert.equal(republished.storage_root_id, "sync");
  assert.equal(republished.relative_path, "Themes/MAT/AI Context/Conversations/old-name.md");

  // sync の参照はルートからの相対パスだけを受け、Theme folder の無いパスや外へ出るパスは捨てる。
  const syncBinding = { ...legacy, storage_root_id: "sync" };
  assert.equal(normalizeConversationContextPublication(syncBinding), null);
  assert.equal(
    normalizeConversationContextPublication({
      ...syncBinding,
      relative_path: "../AI Context/Conversations/x.md",
    }),
    null,
  );
  assert.equal(
    normalizeConversationContextPublication({
      ...syncBinding,
      relative_path: "Themes/MAT/AI Context/Conversations/x.md",
    })?.relative_path,
    "Themes/MAT/AI Context/Conversations/x.md",
  );
  assert.equal(
    normalizeConversationContextPublication({
      ...syncBinding,
      theme_id: "",
      relative_path: "Themes/MAT/AI Context/Conversations/x.md",
    }),
    null,
  );
});
