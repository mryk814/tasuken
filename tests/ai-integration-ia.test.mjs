import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";

const routesSource = readFileSync("src/renderer/src/pages/routes.ts", "utf8");
const workspaceAppSource = readFileSync(
  "src/renderer/src/features/workspace/WorkspaceApp.tsx",
  "utf8",
);
const importExportPageSource = readFileSync(
  "src/renderer/src/features/workspace/pages/ImportExportPage.tsx",
  "utf8",
);
const aiProposalPanelSource = readFileSync(
  "src/renderer/src/features/workspace/components/AiProposalPanel.tsx",
  "utf8",
);
const stylesSource = readFileSync("src/renderer/src/styles/app.css", "utf8");

test("AI proposals use the existing AI route beside Inbox with an action count", () => {
  assert.doesNotMatch(routesSource, /\["proposal-inbox", "AI提案の確認"\]/);
  assert.match(routesSource, /id: "ai-io",\s*label: "AI Inbox"/);
  assert.match(routesSource, /id: "inbox"[\s\S]*group: "cross", order: 1/);
  assert.match(routesSource, /id: "ai-io"[\s\S]*group: "cross", order: 2/);
  assert.match(routesSource, /id: "debrief"[\s\S]*group: "cross", order: 3/);
  assert.match(routesSource, /id: "timeline"[\s\S]*group: "cross", order: 4/);
  assert.match(routesSource, /id: "proposal-inbox", parent: "ai-io"/);
  assert.match(
    workspaceAppSource,
    /import \{ normalizeRoute, routeLabel \} from "\.\.\/\.\.\/pages\/routes"/,
  );
  assert.doesNotMatch(workspaceAppSource, /ProposalInboxPage/);
  assert.equal(
    existsSync("src/renderer/src/features/workspace/pages/ProposalInboxPage.tsx"),
    false,
  );
});

test("AI Inbox contains only the safe proposal review surface", () => {
  assert.match(importExportPageSource, /PageHeader route="ai-io"/);
  assert.match(importExportPageSource, /ai-inbox-page/);
  assert.match(importExportPageSource, /AiProposalPanel/);
  assert.match(aiProposalPanelSource, /export function AiProposalPanel/);
  assert.match(aiProposalPanelSource, /AIの提案/);
  assert.match(aiProposalPanelSource, /処理履歴/);
  assert.match(aiProposalPanelSource, /proposalTargetLabel/);
  assert.match(aiProposalPanelSource, /quarantine/);
  assert.match(aiProposalPanelSource, /className="proposal-row-select"/);
  assert.match(aiProposalPanelSource, /onClick=\{\(\) => previewProposal\(proposal\)\}/);
  assert.match(aiProposalPanelSource, /className="proposal-inline-preview"/);
  assert.doesNotMatch(aiProposalPanelSource, /Pending Proposal|Proposal Preview|aiProposalPreview/);
  assert.match(aiProposalPanelSource, /ActionButton\s+action="actionReject"/);
  assert.match(aiProposalPanelSource, /ActionButton\s+action="aiProposalAccept"/);
  assert.match(
    aiProposalPanelSource,
    /NOTE_TYPE_LABELS\[str\(candidate\.entry\.note_type\)\] \|\| "Note"/,
  );
  assert.match(
    aiProposalPanelSource,
    /candidate\.type === "note" && candidate\.action === "create"/,
  );
  assert.match(aiProposalPanelSource, /<MarkdownPreview/);
  assert.match(aiProposalPanelSource, /previewHtml\(str\(candidate\.entry\.body\), "markdown"\)/);
  assert.doesNotMatch(aiProposalPanelSource, /danger-button/);
  assert.doesNotMatch(
    importExportPageSource,
    /buildAiImportPrompt|buildAiOrganizePrompt|buildExportData/,
  );
});

test("AI Inbox can resync explicitly and quietly recovers when the window regains focus", () => {
  assert.match(aiProposalPanelSource, /useWorkspaceStore\(\(state\) => state\.refresh\)/);
  assert.match(aiProposalPanelSource, /window\.addEventListener\("focus", resyncOnFocus\)/);
  assert.match(aiProposalPanelSource, /onClick=\{\(\) => void refreshProposals\(true\)\}/);
  assert.match(aiProposalPanelSource, /Proposalを更新できませんでした/);
});

test("Proposal rows keep a visible focus ring for keyboard review", () => {
  assert.match(
    stylesSource,
    /\.proposal-row-select:focus-visible\s*\{[^}]*box-shadow:\s*var\(--focus-ring\)/s,
  );
  assert.match(
    stylesSource,
    /\.proposal-row-select\[aria-pressed="true"\]:focus-visible\s*\{[^}]*var\(--focus-ring\)[^}]*inset 3px/s,
  );
});

test("Selected Proposal uses a sticky two-column review surface on desktop", () => {
  assert.match(
    aiProposalPanelSource,
    /proposal-inbox-panel\$\{selected && preview \? " has-selection" : ""\}/,
  );
  assert.match(
    stylesSource,
    /\.proposal-inbox-panel\.has-selection\s*\{[^}]*display:\s*grid;[^}]*grid-template-columns:[^;]+;/s,
  );
  assert.match(
    stylesSource,
    /\.proposal-inbox-panel\.has-selection > \.proposal-inline-preview\s*\{[^}]*position:\s*sticky;[^}]*overflow:\s*auto;/s,
  );
});

test("Narrow Proposal review stacks preview before history", () => {
  const responsiveStart = stylesSource.indexOf("@media (max-width: 1120px)");
  const responsiveEnd = stylesSource.indexOf(".metric-grid", responsiveStart);
  assert.notEqual(responsiveStart, -1);
  assert.notEqual(responsiveEnd, -1);
  const responsiveStyles = stylesSource.slice(responsiveStart, responsiveEnd);
  assert.match(
    responsiveStyles,
    /\.proposal-inbox-panel\.has-selection\s*\{[^}]*display:\s*flex;/s,
  );
  assert.match(
    responsiveStyles,
    /\.proposal-inbox-panel\.has-selection > \.proposal-inline-preview\s*\{[^}]*position:\s*static;/s,
  );
  assert.match(stylesSource, /\.proposal-list\s*\{\s*order:\s*0;/);
  assert.match(stylesSource, /\.proposal-inline-preview\s*\{[^}]*order:\s*1;/s);
  assert.match(stylesSource, /\.proposal-history\s*\{[^}]*order:\s*2;/s);
});

test("1050x800でもProposal一覧と選択previewを同じviewportへ収める", () => {
  const responsiveStart = stylesSource.indexOf("@media (max-width: 1120px)");
  const responsiveEnd = stylesSource.indexOf(".metric-grid", responsiveStart);
  assert.notEqual(responsiveStart, -1);
  assert.notEqual(responsiveEnd, -1);
  const responsiveStyles = stylesSource.slice(responsiveStart, responsiveEnd);
  assert.match(
    responsiveStyles,
    /\.proposal-inbox-panel\.has-selection > \.proposal-list\s*\{[^}]*max-height:\s*min\(42vh, 360px\);[^}]*overflow-y:\s*auto;[^}]*overscroll-behavior:\s*contain;/s,
  );
  assert.match(
    responsiveStyles,
    /\.proposal-inbox-panel\.has-selection > \.proposal-list,\s*\.proposal-inbox-panel\.has-selection > \.proposal-inline-preview,\s*\.proposal-inbox-panel\.has-selection > \.proposal-history\s*\{[^}]*inline-size:\s*100%;/s,
  );
  assert.match(
    responsiveStyles,
    /\.proposal-inbox-panel\.has-selection\s*\{[^}]*align-items:\s*stretch;/s,
  );
  assert.equal(Math.min(800 * 0.42, 360), 336);
});

test("Proposal rows lead with a content-specific headline", () => {
  assert.match(aiProposalPanelSource, /function proposalHeadline\(proposal: BaseRecord\)/);
  assert.match(
    aiProposalPanelSource,
    /str\(proposal\.summary\) \|\| str\(proposal\.title\) \|\| str\(proposal\.label\)/,
  );
  assert.match(aiProposalPanelSource, /str\(entry\.task_title\)/);
  assert.match(aiProposalPanelSource, /str\(entry\.taskTitle\)/);
  assert.match(
    aiProposalPanelSource,
    /className="proposal-row-title">\{proposalHeadline\(proposal\)\}<\/strong>/,
  );
  assert.match(
    aiProposalPanelSource,
    /className="proposal-row-kind">\{proposalTypeLabel\(proposal\)\}/,
  );
  assert.match(aiProposalPanelSource, /選択すると、本文と採用範囲を確認できます。/);
  assert.doesNotMatch(aiProposalPanelSource, /選択すると、下で本文と採用範囲を確認できます。/);
});
