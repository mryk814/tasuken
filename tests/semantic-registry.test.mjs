import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";

const routes = readFileSync("src/renderer/src/pages/routes.ts", "utf8");
const actions = readFileSync("src/renderer/src/pages/semanticActions.ts", "utf8");
const common = readFileSync("src/renderer/src/features/workspace/components/common.tsx", "utf8");
const workspaceApp = readFileSync("src/renderer/src/features/workspace/WorkspaceApp.tsx", "utf8");

test("RouteDefinition is the only route label/icon/navigation registry", () => {
  const routeIds = [
    "today", "todo", "waiting", "inbox", "timeline", "knowledge", "notes", "sketch",
    "chat-refs", "artifacts", "theme", "themes", "ai-io", "settings",
  ];
  assert.match(routes, /export const ROUTE_DEFINITIONS/);
  for (const id of routeIds) assert.match(routes, new RegExp(`id: "${id}"`));
  assert.match(routes, /semanticRole: "hub"/);
  assert.match(routes, /availability: "requires-active-theme"/);
  assert.match(routes, /navigation: \{ group: "tools", order: 1 \}/);
  assert.match(routes, /shortcut\?: string/);
  assert.match(routes, /export const routeAliases: Record<string, string> = Object\.fromEntries/);
  assert.match(routes, /export const routeParent: Record<string, string> = Object\.fromEntries/);
  assert.match(routes, /export function routeIcon\(id: string\)/);
  assert.match(routes, /export function routeAvailability\(id: string\)/);
  assert.equal(existsSync("src/renderer/src/pages/routeIcons.ts"), false);
  assert.doesNotMatch(common, /ROUTE_ICONS/);
  assert.doesNotMatch(workspaceApp, /ROUTE_ICONS/);
});

test("ActionDefinition covers practical action and toast semantics", () => {
  for (const id of [
    "todayAddTask", "todoAddTask", "inboxAddMemo", "timelineAddPlan",
    "notesCreate", "chatRefsAdd", "aiAnswer", "aiContext", "actionCancel",
    "actionReject", "actionDelete", "aiProposalPreview", "notesSave", "toastInfo", "toastSuccess", "toastWarning", "toastDanger",
  ]) {
    assert.match(actions, new RegExp(`${id}: \\{`));
  }
  assert.match(actions, /role: "(?:primary|secondary|danger|ai|status)"/);
  assert.match(actions, /availability: "(?:always|when-selection|when-editing|when-ai-enabled|when-theme-selected)"/);
  assert.match(actions, /TOAST_ACTIONS/);
  assert.match(common, /export function ActionButton/);
  assert.match(workspaceApp, /TOAST_ACTIONS/);
  assert.match(workspaceApp, /actionDefinition\(TOAST_ACTIONS\[tone\]\)/);
});
