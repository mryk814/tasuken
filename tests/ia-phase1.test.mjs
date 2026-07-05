import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";

const workspaceAppSource = readFileSync("src/renderer/src/features/workspace/WorkspaceApp.tsx", "utf8");
const drawerSource = readFileSync("src/renderer/src/features/workspace/components/drawer.tsx", "utf8");
const typesSource = readFileSync("src/renderer/src/features/workspace/types.ts", "utf8");

const drawerEntityType = typesSource.match(/export type DrawerEntityType =([\s\S]*?);/)?.[1] || "";
const retiredDrawerTypes = ["source_record", "field_definition", "reference", "task_dependency"];

test("Phase 1 removes unreachable milestone and retired drawer form entrypoints", () => {
  assert.equal(existsSync("src/renderer/src/features/workspace/pages/MilestonePage.tsx"), false);
  for (const type of retiredDrawerTypes) {
    assert.doesNotMatch(drawerEntityType, new RegExp(`"${type}"`));
    assert.doesNotMatch(drawerSource, new RegExp(`data-entity-type="${type}"`));
    assert.doesNotMatch(workspaceAppSource, new RegExp(`type === "${type}"`));
  }
});

test("Phase 1 keeps refresh as an app notification path, not a page action prop", () => {
  assert.match(workspaceAppSource, /onWorkspaceChanged/);
  assert.doesNotMatch(typesSource, /refreshWorkspace\(\): Promise<void>/);
  assert.doesNotMatch(workspaceAppSource, /refreshWorkspace: async \(\) =>/);
});
