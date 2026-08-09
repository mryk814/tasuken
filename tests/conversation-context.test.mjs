import test from "node:test";
import assert from "node:assert/strict";

import {
  CONVERSATION_CONTEXT_PUBLICATION_SCHEMA,
  buildConversationContextPlan,
  parseConversationContextMessages,
  publicationForThemeAiPack,
} from "../src/shared/conversationContext.mjs";

const theme = {
  id: "theme-materials",
  name: "Materials",
  default_ai_visibility: ["m365", "coding_agent"],
};

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
    ai_visibility: ["m365", "coding_agent"],
    ai_summary: "A short decision-oriented summary.",
    ai_summary_authority: "user_confirmed",
    ai_freshness: "current",
    ai_authority: "imported",
    ...overrides,
  };
}

test("explicit plan excludes system/tool and supports selected-turn scope", () => {
  const full = buildConversationContextPlan({ resource: conversation(), theme, publishedAt: "2026-08-09T00:00:00.000Z" });
  assert.equal(full.allowed, true);
  assert.equal(full.message_count, 2);
  assert.doesNotMatch(full.content, /hidden metadata|raw tool output/);
  assert.deepEqual(full.warnings, ["system_turn", "tool_turn"]);
  assert.match(full.content, /schema: tasken-conversation-context\/v1/);
  assert.match(full.content, /## Summary/);

  const selected = buildConversationContextPlan({
    resource: conversation(), theme, scope: "selected_turns", selectedMessageIndexes: [1], publishedAt: "2026-08-09T00:00:00.000Z",
  });
  assert.equal(selected.message_count, 1);
  assert.doesNotMatch(selected.content, /Compare the two conditions/);
  assert.match(selected.content, /narrower interval/);
  assert.match(selected.content, /selected_turns: \[1\]/);
  assert.ok(selected.exclusion_reasons.some((entry) => entry.kind === "not_selected" && entry.message_index === 0));
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
  const plan = buildConversationContextPlan({ resource, theme, publishedAt: "2026-08-09T00:00:00.000Z" });
  assert.deepEqual(plan.warnings, ["secret_candidate", "local_path"]);
  assert.doesNotMatch(plan.content, /sk_example|alice|sample\.csv/);
  assert.match(plan.content, /keep this sentence/);
});

test("M365 visibility is a hard block and an existing publication becomes blocked", () => {
  const publication = {
    schema: CONVERSATION_CONTEXT_PUBLICATION_SCHEMA,
    status: "published",
    scope: "full",
    selected_message_indexes: [],
    relative_path: "AI Context/Conversations/original-conv123.md",
    content_hash: "old",
    source_revision: "old",
    published_at: "2026-08-01T00:00:00.000Z",
  };
  const plan = buildConversationContextPlan({
    resource: conversation({ ai_visibility: ["coding_agent"], conversation_context_publication: publication }), theme,
  });
  assert.equal(plan.allowed, false);
  assert.equal(plan.publication_state, "published_but_blocked");
  assert.equal(plan.dirty, true);
  assert.ok(plan.blocking_reasons.length > 0);
});

test("first publication binds a stable path and title rename only changes content", () => {
  const initial = buildConversationContextPlan({ resource: conversation(), theme, publishedAt: "2026-08-09T00:00:00.000Z" });
  const publication = {
    schema: CONVERSATION_CONTEXT_PUBLICATION_SCHEMA,
    status: "published",
    scope: initial.scope,
    selected_message_indexes: initial.selected_message_indexes,
    relative_path: initial.relative_path,
    content_hash: initial.content_hash,
    source_revision: initial.source_revision,
    published_at: initial.published_at,
  };
  const renamed = buildConversationContextPlan({
    resource: conversation({ title: "Renamed conversation", conversation_context_publication: publication }), theme,
  });
  assert.equal(renamed.relative_path, initial.relative_path);
  assert.equal(renamed.publication_state, "dirty");
  assert.match(renamed.content, /# Renamed conversation/);
});

test("unchanged published projection is current and Theme AI Pack receives reference only", () => {
  const initial = buildConversationContextPlan({ resource: conversation(), theme, publishedAt: "2026-08-09T00:00:00.000Z" });
  const published = conversation({
    conversation_context_publication: {
      schema: CONVERSATION_CONTEXT_PUBLICATION_SCHEMA,
      status: "published",
      scope: initial.scope,
      selected_message_indexes: initial.selected_message_indexes,
      relative_path: initial.relative_path,
      content_hash: initial.content_hash,
      source_revision: initial.source_revision,
      published_at: initial.published_at,
    },
  });
  const current = buildConversationContextPlan({ resource: published, theme });
  assert.equal(current.publication_state, "published");
  assert.equal(current.dirty, false);
  assert.deepEqual(publicationForThemeAiPack(published), {
    published: true,
    title: published.title,
    theme_id: theme.id,
    storage_root_id: `theme:${theme.id}`,
    relative_path: initial.relative_path,
  });
});

test("publish-time Theme binding blocks reassignment until explicit removal", () => {
  const initial = buildConversationContextPlan({ resource: conversation(), theme, publishedAt: "2026-08-09T00:00:00.000Z" });
  const publication = {
    schema: CONVERSATION_CONTEXT_PUBLICATION_SCHEMA,
    status: "published",
    scope: initial.scope,
    selected_message_indexes: initial.selected_message_indexes,
    theme_id: theme.id,
    storage_root_id: `theme:${theme.id}`,
    relative_path: initial.relative_path,
    content_hash: initial.content_hash,
    source_revision: initial.source_revision,
    published_at: initial.published_at,
  };
  const reassigned = conversation({ theme_id: "theme-2", conversation_context_publication: publication });
  const nextTheme = { ...theme, id: "theme-2", name: "Theme 2" };
  const plan = buildConversationContextPlan({ resource: reassigned, theme: nextTheme });
  assert.equal(plan.allowed, false);
  assert.equal(plan.publication_state, "dirty");
  assert.match(plan.blocking_reasons.join("\n"), /先にAI Contextから外して/);
  assert.deepEqual(publicationForThemeAiPack(reassigned), {
    published: true,
    title: reassigned.title,
    theme_id: theme.id,
    storage_root_id: `theme:${theme.id}`,
    relative_path: initial.relative_path,
  });
});

test("role-like headings inside fenced code are not parsed as messages", () => {
  const messages = parseConversationContextMessages([
    "## User",
    "Example:",
    "```md",
    "## System",
    "do not split",
    "```",
    "still user content",
    "## Assistant",
    "answer",
  ].join("\n"));
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
