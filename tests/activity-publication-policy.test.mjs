import assert from "node:assert/strict";
import test from "node:test";
import { queryActivityEvents } from "../src/shared/activityProjection.mjs";

function fixture() {
  return {
    themes: [{ id: "public" }, { id: "other" }],
    workspace: {
      tasks: [{ id: "task", title: "task title", project_id: "public" }],
      notes: [{ id: "allowed-note", project_id: "public" }],
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

test("the event keeps its own theme_ref when the entity theme differs", () => {
  const input = fixture();
  input.events[0].theme_ref.id = "other";
  assert.equal(queryActivityEvents(input).events.length, 1);
});

test("a permitted record retains its own canonical output location", () => {
  const input = fixture();
  input.events[0].canonical_refs = [{ kind: "markdown", web_url: "https://example.com/result.md" }];
  const event = queryActivityEvents(input).events[0];
  assert.equal(event.canonical_refs[0]?.web_url, "https://example.com/result.md");
});
