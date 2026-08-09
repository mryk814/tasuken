import assert from "node:assert/strict";
import test from "node:test";

import {
  buildStableLinkContext,
  formatStableLink,
  parseStableLinks,
  reconcileStableLinkAssertions,
  resolveStableLinks,
  stableLinkAssertion,
} from "../src/shared/stableLinks.mjs";

test("stable link parser keeps typed identity, raw alias and source span", () => {
  const markdown = "前 [[task:task%3A1|調査タスク]] 後";
  const [link] = parseStableLinks(markdown);
  assert.deepEqual(link, {
    kind: "canonical",
    raw: "[[task:task%3A1|調査タスク]]",
    ref: { type: "task", id: "task:1" },
    alias: "調査タスク",
    occurrence: 0,
    source_span: { start: 2, end: 25 },
  });
  assert.equal(formatStableLink(link.ref, link.alias), link.raw);
});

test("stable link parser ignores fenced code, inline code and escaped links", () => {
  const markdown = [
    "[[task:visible]]",
    "`[[task:inline]]`",
    "\\[[task:escaped]]",
    "```md",
    "[[task:fenced]]",
    "```",
    "~~~",
    "[[task:tilde]]",
    "~~~",
  ].join("\n");
  assert.deepEqual(parseStableLinks(markdown).map((link) => link.ref?.id || link.target), ["visible"]);
});

test("canonical links survive title rename and keep same-id entity types distinct", () => {
  const markdown = "[[task:same|旧名]] [[note:same|メモ]]";
  const before = resolveStableLinks(markdown, {
    tasks: [{ id: "same", title: "旧名" }],
    notes: [{ id: "same", title: "メモ" }],
  });
  const after = resolveStableLinks(markdown, {
    tasks: [{ id: "same", title: "新名" }],
    notes: [{ id: "same", title: "別名" }],
  });
  assert.deepEqual(before.map((item) => item.resolution), ["resolved", "resolved"]);
  assert.deepEqual(after.map((item) => [item.ref.type, item.ref.id, item.title]), [
    ["task", "same", "新名"],
    ["note", "same", "別名"],
  ]);
});

test("legacy title resolution is candidate only when exact match is unique", () => {
  const workspace = {
    tasks: [{ id: "task-a", title: "同名" }, { id: "task-b", title: "唯一" }],
    notes: [{ id: "note-a", title: "同名" }],
  };
  const resolved = resolveStableLinks("[[唯一]] [[同名]] [[なし]]", workspace);
  assert.deepEqual(resolved.map((item) => item.resolution), ["migration_candidate", "ambiguous", "unresolved"]);
  assert.deepEqual(resolved[0].candidates, [{ type: "task", id: "task-b" }]);
});

test("stable link assertion is canonical operational Relation with source evidence", () => {
  const [link] = parseStableLinks("[[task:t-1|Task]]");
  const assertion = stableLinkAssertion({ type: "note", id: "n-1" }, link, { recordedAt: "2026-08-09T00:00:00.000Z" });
  assert.equal(assertion.predicate, "links_to");
  assert.equal(assertion.layer, "operational");
  assert.equal(assertion.status, "asserted");
  assert.deepEqual(assertion.subject, { type: "note", id: "n-1" });
  assert.deepEqual(assertion.object, { type: "task", id: "t-1" });
  assert.deepEqual(assertion.evidence_refs, [{ type: "note", id: "n-1" }]);
  assert.deepEqual(assertion.metadata, {
    syntax: "typed-stable-link/v1",
    raw: "[[task:t-1|Task]]",
    raw_alias: "Task",
    source_span: { start: 0, end: 17 },
  });
});

test("stable assertion identity ignores source span and reconcile removes replaced links", () => {
  const source = { type: "note", id: "n-1" };
  const [beforeLink] = parseStableLinks("[[task:t-1|Task]]");
  const [afterLink] = parseStableLinks("前文が増えた\n[[task:t-1|Renamed alias]]");
  const before = stableLinkAssertion(source, beforeLink);
  const after = stableLinkAssertion(source, afterLink);
  assert.equal(after.assertion_id, before.assertion_id);
  assert.notDeepEqual(after.metadata.source_span, before.metadata.source_span);

  const manual = {
    id: "manual-link",
    source_type: "note",
    source_id: "n-1",
    target_type: "task",
    target_id: "manual-task",
    relation_type: "links_to",
  };
  const replaced = reconcileStableLinkAssertions(source, "[[task:t-2|Next]]", [before, manual]);
  assert.deepEqual(replaced.delete_assertion_ids, [before.assertion_id]);
  assert.equal(replaced.upsert_assertions.length, 1);
  assert.equal(replaced.upsert_assertions[0].object.id, "t-2");
  assert.equal(reconcileStableLinkAssertions(source, "[[task:t-1|Task]]", [before]).delete_assertion_ids.length, 0);
});

test("relation-backed query is symmetric and reports deleted endpoint as broken", () => {
  const reference = {
    id: "link-a",
    assertion_id: "link-a",
    subject: { type: "note", id: "n-1" },
    predicate: "links_to",
    object: { type: "task", id: "t-1" },
    layer: "operational",
    status: "asserted",
    origin: "user",
    metadata: { raw_alias: "Task", source_span: { start: 0, end: 17 } },
    source_type: "note",
    source_id: "n-1",
    target_type: "task",
    target_id: "t-1",
    relation_type: "links_to",
  };
  const active = { notes: [{ id: "n-1", title: "Note" }], tasks: [{ id: "t-1", title: "Renamed task" }], references: [reference] };
  assert.equal(buildStableLinkContext(active, { type: "note", id: "n-1" }).outbound[0].ref.id, "t-1");
  assert.equal(buildStableLinkContext(active, { type: "task", id: "t-1" }).backlinks[0].ref.id, "n-1");

  const deleted = { ...active, tasks: [{ id: "t-1", title: "Renamed task", deleted_at: "2026-08-09T01:00:00.000Z" }] };
  const context = buildStableLinkContext(deleted, { type: "note", id: "n-1" });
  assert.equal(context.outbound.length, 0);
  assert.equal(context.broken.length, 1);
  assert.deepEqual(context.broken[0].missing_refs, [{ type: "task", id: "t-1" }]);
});

test("typed token with no persisted endpoint is a bounded non-navigable broken item", () => {
  const context = buildStableLinkContext({
    notes: [{ id: "n-1", title: "Note", body_markdown: "[[task:missing|Missing task]]" }],
  }, { type: "note", id: "n-1" }, { maxItems: 2 });
  assert.equal(context.broken.length, 1);
  assert.equal(context.broken[0].ref.type, "task");
  assert.equal(context.broken[0].ref.id, "missing");
  assert.match(context.broken[0].assertion_id, /^unpersisted:/);
});

test("unpersisted broken tokens have category-consistent totals and bounds", () => {
  const body = Array.from({ length: 9 }, (_, index) => `[[task:missing-${index}|Missing ${index}]]`).join(" ");
  const context = buildStableLinkContext({
    notes: [{ id: "n-1", title: "Note", body_markdown: body }],
  }, { type: "note", id: "n-1" }, { maxItems: 3 });
  assert.equal(context.broken.length, 3);
  assert.equal(context.categories.broken.total, 9);
  assert.equal(context.categories.broken.truncated, true);
  assert.equal(context.truncated, true);
});

test("relation-backed query is deterministic and globally bounded", () => {
  const references = Array.from({ length: 12 }, (_, index) => ({
    id: `link-${String(index).padStart(2, "0")}`,
    source_type: "note",
    source_id: "n-1",
    target_type: "task",
    target_id: `t-${String(index).padStart(2, "0")}`,
    relation_type: "links_to",
  }));
  const workspace = {
    notes: [{ id: "n-1", title: "Note" }],
    tasks: references.map((reference) => ({ id: reference.target_id, title: reference.target_id })),
    references: [...references].reverse(),
  };
  const first = buildStableLinkContext(workspace, { type: "note", id: "n-1" }, { maxItems: 5 });
  const second = buildStableLinkContext({ ...workspace, references }, { type: "note", id: "n-1" }, { maxItems: 5 });
  assert.equal(first.outbound.length, 5);
  assert.equal(first.truncated, true);
  assert.deepEqual(first, second);
});

test("category bounds keep backlinks visible beside many outbound links", () => {
  const outbound = Array.from({ length: 10 }, (_, index) => ({
    id: `out-${index}`,
    source_type: "note",
    source_id: "seed",
    target_type: "task",
    target_id: `task-${index}`,
    relation_type: "links_to",
  }));
  const inbound = {
    id: "in-1",
    source_type: "note",
    source_id: "other",
    target_type: "note",
    target_id: "seed",
    relation_type: "links_to",
  };
  const workspace = {
    notes: [{ id: "seed", title: "Seed" }, { id: "other", title: "Other" }],
    tasks: outbound.map((reference) => ({ id: reference.target_id, title: reference.target_id })),
    references: [...outbound, inbound],
  };
  const context = buildStableLinkContext(workspace, { type: "note", id: "seed" }, { maxItems: 3 });
  assert.equal(context.outbound.length, 3);
  assert.equal(context.backlinks.length, 1);
  assert.equal(context.backlinks[0].ref.id, "other");
  assert.equal(context.categories.outbound.truncated, true);
  assert.equal(context.categories.backlinks.truncated, false);
});
