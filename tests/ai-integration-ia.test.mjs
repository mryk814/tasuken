import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";

import { normalizeRoute } from "../src/renderer/src/pages/routes.ts";

const routesSource = readFileSync("src/renderer/src/pages/routes.ts", "utf8");
const workspaceAppSource = readFileSync(
  "src/renderer/src/features/workspace/WorkspaceApp.tsx",
  "utf8",
);
const feedPageSource = readFileSync(
  "src/renderer/src/features/workspace/pages/FeedPage.tsx",
  "utf8",
);
const aiProposalPanelSource = readFileSync(
  "src/renderer/src/features/workspace/components/AiProposalPanel.tsx",
  "utf8",
);
const semanticActionsSource = readFileSync("src/renderer/src/pages/semanticActions.ts", "utf8");
const feedStylesSource = readFileSync("src/renderer/src/styles/feed.css", "utf8");

test("AI proposals use the existing AI route beside Inbox with an action count", () => {
  assert.doesNotMatch(routesSource, /\["proposal-inbox", "AI提案の確認"\]/);
  assert.match(routesSource, /id: "ai-io",\s*label: "Agent Desk"/);
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

test("Feed hosts the safe proposal review surface", () => {
  // Agent Desk（ImportExportPage / AgentDeskPanel）はFeedへ集約して削除した。
  assert.equal(existsSync("src/renderer/src/features/workspace/pages/ImportExportPage.tsx"), false);
  assert.equal(
    existsSync("src/renderer/src/features/workspace/components/AgentDeskPanel.tsx"),
    false,
  );
  // 対応待ちの一覧はFeedが持ち、採否は選んだ1件の詳細（ProposalDetail）で決める。
  assert.match(feedPageSource, /<AiProposalPanel/);
  assert.match(feedPageSource, /<ProposalDetail/);
  assert.match(feedPageSource, /className="feed-needs-select"/);
  assert.match(feedPageSource, /className=\{`feed-needs-panel\$\{/);
  assert.match(aiProposalPanelSource, /export function AiProposalPanel/);
  assert.match(aiProposalPanelSource, /export function ProposalDetail/);
  assert.match(aiProposalPanelSource, /<h2>提案の履歴<\/h2>/);
  assert.match(aiProposalPanelSource, /履歴/);
  assert.match(aiProposalPanelSource, /proposalTargetLabel/);
  assert.match(aiProposalPanelSource, /quarantine/);
  // 一覧を持たない。同じ報告を2面に出さない（docs/feed-surface.md §6.6）。
  assert.doesNotMatch(aiProposalPanelSource, /className="proposal-row-select"/);
  assert.doesNotMatch(aiProposalPanelSource, /className="proposal-list"/);
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
});

test("Agent Desk can resync explicitly and quietly recovers when the window regains focus", () => {
  assert.match(feedPageSource, /useWorkspaceStore\(\(state\) => state\.refresh\)/);
  assert.match(feedPageSource, /window\.addEventListener\("focus", resyncOnFocus\)/);
  assert.match(feedPageSource, /onClick=\{\(\) => void refreshNeeds\(true\)\}/);
  assert.match(feedPageSource, /Proposalを更新できませんでした/);
  // 一覧を持つ面が更新の入口を持つ。履歴だけの面へ戻さない。
  assert.doesNotMatch(aiProposalPanelSource, /onClick=\{\(\) => void refreshProposals\(true\)\}/);
});

test("Proposal rows keep a visible focus ring for keyboard review", () => {
  assert.match(
    feedStylesSource,
    /\.feed-needs-select:focus-visible\s*\{[^}]*box-shadow:\s*var\(--focus-ring\)/s,
  );
  assert.match(
    feedStylesSource,
    /\.feed-needs-select\[aria-pressed="true"\]:focus-visible\s*\{[^}]*var\(--focus-ring\)[^}]*inset 3px/s,
  );
});

test("Selected attention uses a sticky two-column review surface on desktop", () => {
  assert.match(feedPageSource, /feed-needs-panel\$\{selectedNeedsItem \? " has-selection" : ""\}/);
  assert.match(
    feedStylesSource,
    /\.feed-needs-panel\.has-selection\s*\{[^}]*display:\s*grid;[^}]*grid-template-columns:[^;]+;/s,
  );
  assert.match(
    feedStylesSource,
    /\.feed-needs-panel\.has-selection > \.feed-needs-detail\s*\{[^}]*position:\s*sticky;[^}]*overflow:\s*auto;/s,
  );
});

test("Narrow attention review stacks the detail under the list", () => {
  const responsiveStart = feedStylesSource.indexOf("@media (max-width: 1120px)");
  assert.notEqual(responsiveStart, -1);
  const responsiveStyles = feedStylesSource.slice(responsiveStart);
  assert.match(responsiveStyles, /\.feed-needs-panel\.has-selection\s*\{[^}]*display:\s*flex;/s);
  assert.match(
    responsiveStyles,
    /\.feed-needs-panel\.has-selection > \.feed-needs-detail\s*\{[^}]*position:\s*static;/s,
  );
});

test("1050x800でも一覧と選択detailを同じviewportへ収める", () => {
  const responsiveStart = feedStylesSource.indexOf("@media (max-width: 1120px)");
  assert.notEqual(responsiveStart, -1);
  const responsiveStyles = feedStylesSource.slice(responsiveStart);
  assert.match(
    responsiveStyles,
    /\.feed-needs-panel\.has-selection > \.feed-needs-list\s*\{[^}]*max-height:\s*min\(42vh, 360px\);[^}]*overflow-y:\s*auto;[^}]*overscroll-behavior:\s*contain;/s,
  );
  assert.match(
    responsiveStyles,
    /\.feed-needs-panel\.has-selection > \.feed-needs-list,\s*\.feed-needs-panel\.has-selection > \.feed-needs-detail\s*\{[^}]*inline-size:\s*100%;/s,
  );
  assert.equal(Math.min(800 * 0.42, 360), 336);
});

test("Agent Desk offers adopt-and-complete only for completable Task work reports", () => {
  assert.match(
    aiProposalPanelSource,
    /ActionButton\s+action="aiProposalAcceptAndComplete"[\s\S]*?void acceptProposal\(\{ completeTask: true \}\)/,
  );
  assert.match(
    semanticActionsSource,
    /aiProposalAcceptAndComplete: \{[\s\S]*?label: "完了"[\s\S]*?role: "primary"/,
  );
  assert.match(aiProposalPanelSource, /activeWork && canCompleteActiveWork && \(/);
  assert.match(
    aiProposalPanelSource,
    /onClick=\{\(\) => void acceptProposal\(\{ completeTask: true \}\)\}/,
  );
  assert.match(aiProposalPanelSource, /name: "AcceptTaskWork"/);
  assert.match(aiProposalPanelSource, /receiptId: active\.id, completeTask: true/);
  assert.match(aiProposalPanelSource, /\["done", "cancelled"\]\.includes\(str\(/);
  assert.match(aiProposalPanelSource, /作業報告を採用し、Taskを完了しました。/);
  assert.match(aiProposalPanelSource, /対象Taskは既に完了またはキャンセルされています。/);
  assert.match(
    aiProposalPanelSource,
    /ActionButton\s+action="aiProposalAccept"[\s\S]*?void acceptProposal\(\)/,
  );
});

test("Attention rows lead with the content headline and keep the summary", () => {
  assert.match(aiProposalPanelSource, /export function proposalHeadline\(proposal: BaseRecord\)/);
  assert.match(
    aiProposalPanelSource,
    /str\(proposal\.summary\) \|\| str\(proposal\.title\) \|\| str\(proposal\.label\)/,
  );
  assert.match(aiProposalPanelSource, /str\(entry\.task_title\)/);
  assert.match(aiProposalPanelSource, /str\(entry\.taskTitle\)/);
  // 変更案の行は種別ラベルではなく中身の見出しを先頭にし、要旨が違うときだけ2行目へ出す。
  assert.match(feedPageSource, /item\.kind === "proposal_pending" && proposal/);
  assert.match(feedPageSource, /\? proposalHeadline\(proposal\)/);
  assert.match(feedPageSource, /className="feed-needs-title">\{title\}/);
  assert.match(
    feedPageSource,
    /item\.summary !== title[\s\S]*?className="feed-needs-summary">\{item\.summary\}/,
  );
});

test("Agent Deskの旧deep linkはFeedの対応待ちへ着地する（#600 集約）", () => {
  // 旧URLは消えない。Feedへ集約し、対応待ちタブを開く（ai-io / proposal-inbox）。
  assert.equal(normalizeRoute("proposal-inbox"), "feed");
  assert.equal(normalizeRoute("ai-io"), "feed");
  // 旧称を表示名として復活させない。
  assert.doesNotMatch(routesSource, /label: "AI Inbox"/);
  assert.doesNotMatch(routesSource, /label: "AI IO"/);
  // 変更案の採否と履歴はFeedの「対応待ち」タブから到達できる。
  assert.match(feedPageSource, /<AiProposalPanel/);
  assert.match(feedPageSource, /<ProposalDetail/);
  assert.match(aiProposalPanelSource, /<h2>提案の履歴<\/h2>/);
  assert.match(aiProposalPanelSource, /履歴/);
});
