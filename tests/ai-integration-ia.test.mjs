import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";

const routesSource = readFileSync("src/renderer/src/pages/routes.ts", "utf8");
const workspaceAppSource = readFileSync("src/renderer/src/features/workspace/WorkspaceApp.tsx", "utf8");
const importExportPageSource = readFileSync("src/renderer/src/features/workspace/pages/ImportExportPage.tsx", "utf8");
const aiProposalPanelSource = readFileSync("src/renderer/src/features/workspace/components/AiProposalPanel.tsx", "utf8");

test("AI proposals are folded into the AI integration page", () => {
  assert.doesNotMatch(routesSource, /\["proposal-inbox", "AI提案の確認"\]/);
  assert.match(routesSource, /\["ai-io", "AI連携"\]/);
  assert.match(routesSource, /"proposal-inbox": "ai-io"/);
  assert.match(workspaceAppSource, /route === "proposal-inbox" \? "ai-io"/);
  assert.doesNotMatch(workspaceAppSource, /ProposalInboxPage/);
  assert.equal(existsSync("src/renderer/src/features/workspace/pages/ProposalInboxPage.tsx"), false);
});

test("AI integration page includes handoff and proposal review lanes", () => {
  assert.match(importExportPageSource, /PageHeader title="AI連携"/);
  assert.match(importExportPageSource, /AiProposalPanel/);
  assert.match(aiProposalPanelSource, /export function AiProposalPanel/);
  assert.doesNotMatch(aiProposalPanelSource, /PageHeader/);
});
