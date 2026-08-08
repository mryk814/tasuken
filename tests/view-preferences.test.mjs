import assert from "node:assert/strict";
import test from "node:test";

import {
  defaultViewPreference,
  getViewPreferenceDefinition,
  normalizeViewPreference,
  normalizeViewPreferenceEnvelope,
  viewPreferenceSlotKey,
  VIEW_PREFERENCE_REGISTRY,
} from "../src/shared/viewPreferenceRegistry.mjs";
import { WorkspaceDatabase } from "../src/main/repositories/workspaceRepository.mjs";

test("typed registry exposes schema, scope, sort contract, and defaults", () => {
  const notes = getViewPreferenceDefinition("notes.preferences");
  assert.equal(notes.surfaceId, "notes");
  assert.equal(notes.scope, "workspace");
  assert.equal(notes.sortKey, "sortOrder");
  assert.equal(notes.schemaVersion, 2);
  assert.equal(defaultViewPreference("notes.preferences").scope, "note");
  assert.ok(VIEW_PREFERENCE_REGISTRY.every((entry) => entry.id && entry.schemaVersion && entry.defaultValue !== undefined));
});

test("legacy values migrate into the current schema without losing known fields", () => {
  const migrated = normalizeViewPreference("notes.preferences", {
    scope: "resource",
    sortOrder: "created_asc",
    themeId: "theme-a",
    listWidth: 960,
    listCollapsed: true,
  }, 1);
  assert.deepEqual(migrated, {
    scope: "resource",
    sortOrder: "created_asc",
    themeId: "theme-a",
    listWidth: 800,
    listCollapsed: true,
    documentFocus: false,
  });
  const timeline = normalizeViewPreference("timeline.preferences", { dayWidth: 3, themeFilter: "theme-a" }, 1);
  assert.deepEqual(timeline.collapsedThemes, []);
});

test("theme scope slots are isolated and reload from one canonical envelope", () => {
  const a = viewPreferenceSlotKey("theme.preferences", "theme-a");
  const b = viewPreferenceSlotKey("theme.preferences", "theme-b");
  const envelope = normalizeViewPreferenceEnvelope({
    schemaVersion: 1,
    revision: 7,
    values: {
      [a]: { schemaVersion: 1, value: { collapsedSections: ["s1"] } },
      [b]: { schemaVersion: 1, value: { collapsedSections: ["s2"] } },
    },
  });
  assert.equal(envelope.revision, 7);
  assert.deepEqual(envelope.values[a].value.collapsedSections, ["s1"]);
  assert.deepEqual(envelope.values[b].value.collapsedSections, ["s2"]);
});

test("database preference revision increments atomically and keeps both scopes", () => {
  const meta = new Map();
  const repo = Object.create(WorkspaceDatabase.prototype);
  repo.ensureMeta = (key, fallback) => {
    if (!meta.has(key)) meta.set(key, fallback);
    return meta.get(key);
  };
  repo.db = { prepare: () => ({ run: (value) => meta.set("view_preferences", value) }) };
  const first = repo.setViewPreference("theme.preferences", "theme-a", { collapsedSections: ["s1"] }, 1);
  const second = repo.setViewPreference("theme.preferences", "theme-b", { collapsedSections: ["s2"] }, 1);
  assert.equal(first.revision, 1);
  assert.equal(second.revision, 2);
  const reloaded = repo.getViewPreferences();
  assert.deepEqual(reloaded.values["theme.preferences::theme-a"].value.collapsedSections, ["s1"]);
  assert.deepEqual(reloaded.values["theme.preferences::theme-b"].value.collapsedSections, ["s2"]);
});
