import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";

const routesSource = readFileSync("src/renderer/src/pages/routes.ts", "utf8");
const workspaceAppSource = readFileSync("src/renderer/src/features/workspace/WorkspaceApp.tsx", "utf8");
const importExportPageSource = readFileSync("src/renderer/src/features/workspace/pages/ImportExportPage.tsx", "utf8");
const aiProposalPanelSource = readFileSync("src/renderer/src/features/workspace/components/AiProposalPanel.tsx", "utf8");

test("AI proposals use the existing AI route as a review inbox", () => {
  assert.doesNotMatch(routesSource, /\["proposal-inbox", "AI提案の確認"\]/);
  assert.match(routesSource, /"ai-io": \{ label: "AI Inbox"/);
  assert.match(routesSource, /toolNavigation = \["ai-io", "settings"\]/);
  assert.match(routesSource, /"proposal-inbox": "ai-io"/);
  assert.match(workspaceAppSource, /route === "proposal-inbox" \? "ai-io"/);
  assert.doesNotMatch(workspaceAppSource, /ProposalInboxPage/);
  assert.equal(existsSync("src/renderer/src/features/workspace/pages/ProposalInboxPage.tsx"), false);
});

test("AI Inbox contains only the safe proposal review surface", () => {
  assert.match(importExportPageSource, /PageHeader route="ai-io"/);
  assert.match(importExportPageSource, /ai-inbox-page/);
  assert.match(importExportPageSource, /AiProposalPanel/);
  assert.match(aiProposalPanelSource, /export function AiProposalPanel/);
  assert.match(aiProposalPanelSource, /Pending Proposal/);
  assert.match(aiProposalPanelSource, /処理履歴/);
  assert.match(aiProposalPanelSource, /proposalTargetLabel/);
  assert.match(aiProposalPanelSource, /quarantine/);
  assert.doesNotMatch(importExportPageSource, /buildAiImportPrompt|buildAiOrganizePrompt|buildExportData/);
});
