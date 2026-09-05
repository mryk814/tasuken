import assert from "node:assert/strict";
import test from "node:test";
import { queryActivityEvents } from "../src/shared/activityProjection.mjs";

function fixture() {
  return {
    audience: "m365",
    themes: [
      { id: "public", default_ai_visibility: ["m365"] },
      { id: "private", default_ai_visibility: [] },
    ],
    workspace: {
      tasks: [{ id: "task", title: "task title", project_id: "public" }],
      notes: [
        { id: "allowed-note", project_id: "public" },
        { id: "private-note", project_id: "public", ai_visibility: [] },
      ],
    },
    events: [
      {
        id: "completed",
        entity_ref: { type: "task", id: "task" },
        event_kind: "task_completed",
        occurred_at: "2026-09-05T10:00:00+09:00",
        theme_ref: { kind: "theme", id: "public" },
        summary: "completed work",
      },
    ],
  };
}

test("publication follows current theme after moving an entity out of a public theme", () => {
  const input = fixture();
  input.workspace.tasks[0].project_id = "private";
  assert.equal(queryActivityEvents(input).events.length, 0);
  const local = queryActivityEvents({ ...input, audience: null });
  assert.equal(local.events.length, 1);
  assert.equal(local.events[0].theme_ref.id, "public");
});

test("publication follows current theme when moved to a public theme", () => {
  const input = fixture();
  input.events[0].theme_ref.id = "private";
  assert.equal(queryActivityEvents(input).events.length, 1);
});

test("secondary typed references exclude private and missing entities only for publication", () => {
  const input = fixture();
  const refs = ["allowed-note", "private-note", "missing-note"].map((id) => ({ type: "note", id }));
  input.events[0].source_refs = refs;
  input.events[0].relation_refs = refs;
  const published = queryActivityEvents(input).events[0];
  assert.deepEqual(
    published.source_refs.map((ref) => ref.id),
    ["allowed-note"],
  );
  assert.deepEqual(
    published.relation_refs.map((ref) => ref.id),
    ["allowed-note"],
  );
  const local = queryActivityEvents({ ...input, audience: null }).events[0];
  assert.equal(local.source_refs.length, 3);
  assert.equal(local.relation_refs.length, 3);
});

test("a permitted record retains its own canonical output location", () => {
  const input = fixture();
  input.events[0].canonical_refs = [{ kind: "markdown", web_url: "https://example.com/result.md" }];
  const event = queryActivityEvents(input).events[0];
  assert.equal(event.canonical_refs[0]?.web_url, "https://example.com/result.md");
});
