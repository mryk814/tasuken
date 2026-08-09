import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const settings = readFileSync("src/renderer/src/features/workspace/pages/SettingsPage.tsx", "utf8");
const routes = readFileSync("src/renderer/src/pages/routes.ts", "utf8");
const workspaceApp = readFileSync("src/renderer/src/features/workspace/WorkspaceApp.tsx", "utf8");
const common = readFileSync("src/renderer/src/features/workspace/components/common.tsx", "utf8");
const styles = readFileSync("src/renderer/src/styles/app.css", "utf8");

test("Settings uses purpose-based categories and a current-state summary", () => {
  for (const id of ["general", "appearance", "storage", "integrations", "ai-mcp", "advanced"]) {
    assert.match(settings, new RegExp(`id: "${id}"`));
  }
  assert.match(settings, /現在の状態/);
  assert.match(settings, /Storage/);
  assert.match(settings, /Calendar/);
  assert.match(settings, /AI Provider/);
  assert.match(settings, /MCP Bridge/);
  assert.match(settings, /IntegrationStatus/);
  assert.match(common, /export function IntegrationStatus/);
  assert.match(common, /IntegrationStatusTone = "normal" \| "neutral"/);
  assert.match(common, /tone === "neutral"[\s\S]*?IconCircle/);
  assert.match(settings, /label: "未接続", tone: "neutral"/);
  assert.match(settings, /label: "未設定", tone: "neutral"/);
});

test("Settings deep links normalize to Settings and preserve category history", () => {
  assert.match(routes, /\/\^settings/);
  assert.match(workspaceApp, /normalizeRoute/);
  assert.match(settings, /window\.location\.hash = nextHash/);
  assert.match(settings, /window\.addEventListener\("hashchange"/);
  assert.match(settings, /aria-current=\{activeSection === section\.id \? "page" : undefined\}/);
  assert.doesNotMatch(settings, /<PageHeader route="settings" subtitle=/);
});

test("Settings keeps integrations together and hides details until requested", () => {
  assert.match(settings, /hidden=\{activeSection !== "storage"\}/);
  assert.match(settings, /hidden=\{activeSection !== "integrations"\}/);
  assert.match(settings, /hidden=\{activeSection !== "ai-mcp"\}/);
  assert.match(settings, /<details className="settings-detail"/);
  assert.match(settings, /Danger Zone/);
  assert.match(settings, /APIキーを削除/);
  assert.match(settings, /接続を解除/);
  assert.match(settings, /<Button variant="secondary" disabled=\{!mcpInfo\} onClick=\{copyMcpConfig\}>接続設定をコピー<\/Button>/);
  assert.match(settings, /<Button variant="primary" disabled=\{aiBusy \|\| !aiModel\.trim\(\)\} onClick=\{\(\) => saveAiSettings\(false\)\}>/);
});

test("Settings does not render stored secrets and remains compact at narrow widths", () => {
  assert.match(settings, /type="password"/);
  assert.match(settings, /保存時だけ入力。再表示しません/);
  assert.doesNotMatch(settings, /aiConfig\.apiKey/);
  assert.match(styles, /\.settings-layout \{[\s\S]*grid-template-columns/);
  assert.match(styles, /\.settings-category-nav \{ position: static; display: flex/);
  assert.match(styles, /\.settings-summary-list \{ grid-template-columns: 1fr; \}/);
});
