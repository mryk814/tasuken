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
  // 対応待ちタブは置かない（2026-10-06）。AIからの質問・変更案はホームの投稿として並び、
  // 開いた投稿の下の詳細（ProposalDetail）で採否を決める。決着した履歴は畳んで残す。
  assert.doesNotMatch(feedPageSource, /\{ id: "needs", label: "対応待ち" \}/);
  assert.match(feedPageSource, /const renderAttentionPost = \(item: FeedItem\)/);
  assert.match(feedPageSource, /className=\{`feed-attention-post/);
  assert.match(feedPageSource, /interleaved=\{\s*tab === "home" && !authorFilter/);
  assert.match(feedPageSource, /\{open \? renderNeedsDetail\(item\) : null\}/);
  assert.match(feedPageSource, /<ProposalDetail/);
  assert.match(feedPageSource, /<summary>決着した提案の履歴<\/summary>\s*<AiProposalPanel/);
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
  // 履歴だけの面に更新の入口を戻さない。
  assert.doesNotMatch(aiProposalPanelSource, /onClick=\{\(\) => void refreshProposals\(true\)\}/);
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

test("Attention posts lead with the content headline and keep the summary", () => {
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
  assert.match(feedPageSource, /<p className="feed-post-text">\{title\}<\/p>/);
  assert.match(
    feedPageSource,
    /item\.summary !== title[\s\S]*?className="feed-attention-summary">\{item\.summary\}/,
  );
});

test("Agent Deskの旧deep linkはFeedのホームへ着地する（#600 集約・対応待ち廃止）", () => {
  // 旧URLは消えない。Feedへ集約し、ホームを開く（ai-io / proposal-inbox）。
  assert.match(workspaceAppSource, /requestFeedTab\("home"\)/);
  assert.doesNotMatch(workspaceAppSource, /requestFeedTab\("needs"\)/);
  assert.equal(normalizeRoute("proposal-inbox"), "feed");
  assert.equal(normalizeRoute("ai-io"), "feed");
  // 旧称を表示名として復活させない。
  assert.doesNotMatch(routesSource, /label: "AI Inbox"/);
  assert.doesNotMatch(routesSource, /label: "AI IO"/);
  // 変更案の採否はホームの投稿から、履歴はホーム末尾の畳んだ欄から到達できる。
  assert.match(feedPageSource, /<AiProposalPanel/);
  assert.match(feedPageSource, /<ProposalDetail/);
  assert.match(aiProposalPanelSource, /<h2>提案の履歴<\/h2>/);
  assert.match(aiProposalPanelSource, /履歴/);
});
