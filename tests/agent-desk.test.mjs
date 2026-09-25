import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

// Agent DeskはFeedへ集約した（#599/#602の契約はそのまま、検証先だけFeed）。
const feedPage = readFileSync("src/renderer/src/features/workspace/pages/FeedPage.tsx", "utf8");
const rail = readFileSync(
  "src/renderer/src/features/workspace/components/FeedContextRail.tsx",
  "utf8",
);
const agentActivity = readFileSync(
  "src/renderer/src/features/workspace/lib/agentActivity.ts",
  "utf8",
);

test("AIの動きは右レールへ縦に並べ、4列Kanbanにしない（#599）", () => {
  for (const heading of ["対応キュー", "AI活動", "今見るもの", "再発見"]) {
    assert.ok(rail.includes(`<h2>${heading}</h2>`), `見出し ${heading} がない`);
  }
  assert.doesNotMatch(rail, /kanban/i);
});

test("開始を偽装せず、取得済みとも表示しない（#599）", () => {
  assert.ok(rail.includes("開始は未確認"));
  // 文言として「取得済み」を出さない（コメントの説明文は除く）。
  assert.doesNotMatch(rail, /["'>]取得済み/);
  // 経過時間だけで状態を変えない。表示はderived stateだけを使う。
  assert.ok(agentActivity.includes("deriveAgentWorkState"));
});

test("成果確認の読み順と操作名が設計どおり（#599）", () => {
  const order = ["成果", "確認できたこと", "未確認事項", "Taskenへ反映する内容"];
  let cursor = -1;
  for (const label of order) {
    const index = feedPage.indexOf(`<dt>${label}</dt>`);
    assert.ok(index > cursor, `${label} の順序が違う`);
    cursor = index;
  }
  assert.ok(feedPage.includes("報告を採用"));
  assert.ok(feedPage.includes("採用してTaskを完了"));
  assert.ok(feedPage.includes("修正を依頼"));
  assert.ok(feedPage.includes("Taskも完了する"));
});

test("Task完了は選ばれていない明示オプションにする（#599）", () => {
  // 既定の主操作は「報告を採用」。チェックで初めて完了へ変わる（処理中は送信中の文言）。
  assert.match(feedPage, /completeTask\s*\n?\s*\?\s*"採用してTaskを完了"\s*\n?\s*:\s*"報告を採用"/);
  assert.ok(feedPage.includes("useState(false)"));
});

test("送信中は操作名を状態へ変え、二重送信を防ぐ（design-guide §5）", () => {
  assert.match(feedPage, /\{busy\s*\n?\s*\?\s*"処理中"/);
  assert.match(feedPage, /\{busy \? "送信中" : "修正を依頼"\}/);
});

test("回答は既存Commandへ渡し、Task完了とは別操作にする（#599）", () => {
  assert.ok(feedPage.includes('name: "ReplyToAgentRequest"'));
  assert.ok(feedPage.includes('name: "ApplyTaskWorkProposal"'));
  assert.ok(feedPage.includes('name: "AcceptTaskWork"'));
  assert.ok(feedPage.includes('name: "ReturnTaskWork"'));
  // 採用と完了は二つのCommand。前半だけ成功した場合を全体の失敗にしない。
  assert.ok(feedPage.includes("Task完了だけを再試行できます"));
});

test("採用はTaskの完了と混同しない文言にする（#602 報告だけ採用）", () => {
  // 採用しただけの報告を「Taskは継続」として読ませる。
  assert.ok(rail.includes('"受入れ済み／Taskは継続"'));
  assert.ok(rail.includes('"受入れ済み／Task完了"'));
  assert.ok(feedPage.includes("報告を採用しました。Taskは継続します。"));
  assert.ok(feedPage.includes("修正を依頼しました。Taskは継続します。"));
});

test("独自の状態管理を持たず、共通projectionを使う（#599）", () => {
  // レールはread modelだけを描く。選択や入力の正本も持たない。
  assert.doesNotMatch(rail, /localStorage/);
  assert.ok(agentActivity.includes("buildAttentionQueue") || rail.includes("buildAgentActivity"));
  assert.ok(feedPage.includes("taskWorkEntry"));
});
