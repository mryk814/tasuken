import assert from "node:assert/strict";
import { Buffer } from "node:buffer";
import path from "node:path";
import { readFileSync } from "node:fs";
import test from "node:test";

import { build } from "esbuild";

async function mcpBridgeContract() {
  const result = await build({
    entryPoints: [path.resolve("src/shared/ipc/contracts.ts")],
    bundle: true,
    platform: "node",
    format: "esm",
    write: false,
    logLevel: "silent",
  });
  return import(
    `data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString("base64")}`
  );
}

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
  assert.match(settings, /AI & Context/);
  assert.doesNotMatch(settings, /AI Provider|API key|openai-native/);
  assert.match(settings, /MCP Bridge/);
  assert.match(settings, /Backups/);
  assert.match(settings, /IntegrationStatus/);
  assert.match(common, /export function IntegrationStatus/);
  assert.match(common, /IntegrationStatusTone = "normal" \| "neutral"/);
  assert.match(common, /tone === "neutral"[\s\S]*?IconCircle/);
  assert.match(settings, /label: "未接続", tone: "neutral"/);
  assert.match(settings, /label: "未設定", tone: "neutral"/);
});

test("Settings exposes automatic generational backups and keeps manual recovery available", () => {
  assert.match(settings, /自動バックアップ/);
  assert.match(settings, /automaticSnapshotStatus/);
  assert.match(settings, /configureAutomaticSnapshot/);
  assert.match(settings, /runAutomaticSnapshot/);
  assert.match(settings, /min="1"\s*max="20"/);
  assert.match(settings, /今すぐ作成/);
  assert.match(settings, /手動の移行・復元/);
  assert.match(settings, /バックアップを書き出す/);
  assert.match(settings, /バックアップを読み込む/);
  assert.match(
    styles,
    /@container page \(max-width: 960px\)[\s\S]*?\.settings-grid \{\s*grid-template-columns: minmax\(0, 1fr\);/,
  );
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
  assert.match(settings, /接続を解除/);
  assert.match(
    settings,
    /<Button variant="secondary" disabled=\{!mcpInfo\} onClick=\{copyMcpConfig\}>\s*接続設定をコピー\s*<\/Button>/,
  );
  assert.doesNotMatch(settings, /AI Provider|APIキーを削除|saveAiSettings/);
});

test("Settings includes shared input organization and remains compact at narrow widths", () => {
  assert.match(settings, /<CaptureOrganizerSettings/);
  assert.match(styles, /\.settings-layout \{[\s\S]*grid-template-columns/);
  assert.match(styles, /\.settings-category-nav \{\s*position: static;\s*display: flex/);
  assert.match(styles, /\.settings-summary-list \{\s*grid-template-columns: 1fr;/);
});

test("Settings copies the exact typed MCP client config generated for the runtime", async () => {
  const { copyMcpBridgeConfig, createMcpBridgeInfo } = await mcpBridgeContract();
  const info = createMcpBridgeInfo({
    args: ["C:/Program Files/Tasken/resources/mcp/server.mjs"],
    pendingProposalCount: 2,
    packaged: true,
  });
  assert.deepEqual(JSON.parse(info.configJson), {
    mcpServers: {
      tasken: {
        command: "node",
        args: ["C:/Program Files/Tasken/resources/mcp/server.mjs"],
      },
    },
  });
  assert.equal(info.transport, "stdio-core");
  assert.equal(info.pendingProposalCount, 2);
  assert.equal(info.coreStatus, "unknown");
  let copied = "";
  await copyMcpBridgeConfig(async (text) => {
    copied = text;
    return true;
  }, info);
  assert.equal(copied, info.configJson);
  assert.match(
    settings,
    /copyMcpBridgeConfig\(\(text\) => workspaceApi\.copyText\(text\), mcpInfo\)/,
  );
  assert.match(settings, /label: "設定をコピーできます", tone: "neutral"/);
  assert.match(settings, /mcpInfo\?\.coreStatus === "available"/);
  assert.match(settings, /mcpInfo\?\.coreNextAction/);
  assert.match(settings, /状態を再確認/);
  assert.match(settings, /Latest Proposal/);
  assert.doesNotMatch(settings, /const mcpSummary[\s\S]{0,300}label: "正常"/);
});
