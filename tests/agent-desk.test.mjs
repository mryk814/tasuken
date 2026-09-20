import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync(
  "src/renderer/src/features/workspace/components/AgentDeskPanel.tsx",
  "utf8",
);

test("Agent Deskは4つの見出しを一つの一覧へ置く（#599）", () => {
  for (const heading of ["対応待ち", "作業中", "開始待ち", "最近の結果"]) {
    assert.ok(source.includes(`<h2>${heading}</h2>`), `見出し ${heading} がない`);
  }
  // 4列Kanbanにしない。見出しは縦に並ぶ。
  assert.doesNotMatch(source, /kanban/i);
});

test("開始を偽装せず、取得済みとも表示しない（#599）", () => {
  assert.ok(source.includes("開始は未確認"));
  // 文言として「取得済み」を出さない（コメントの説明文は除く）。
  assert.doesNotMatch(source, /["'>]取得済み/);
  // 経過時間だけで状態を変えない。表示はderived stateだけを使う。
  assert.ok(source.includes("deriveAgentWorkState"));
});

test("成果確認の読み順と操作名が設計どおり（#599）", () => {
  const detail = source.slice(source.indexOf('selected.kind === "review_report"'));
  const order = ["成果", "確認できたこと", "未確認事項", "Taskenへ反映する内容"];
  let cursor = -1;
  for (const label of order) {
    const index = detail.indexOf(`<dt>${label}</dt>`);
    assert.ok(index > cursor, `${label} の順序が違う`);
    cursor = index;
  }
  assert.ok(detail.includes("報告を採用"));
  assert.ok(detail.includes("採用してTaskを完了"));
  assert.ok(detail.includes("修正を依頼"));
  assert.ok(detail.includes("Taskも完了する"));
});

test("Task完了は選ばれていない明示オプションにする（#599）", () => {
  // 既定の主操作は「報告を採用」。チェックで初めて完了へ変わる。
  assert.ok(source.includes('completeTask ? "採用してTaskを完了" : "報告を採用"'));
  assert.ok(source.includes("useState(false)"));
});

test("回答は既存Commandへ渡し、Task完了とは別操作にする（#599）", () => {
  assert.ok(source.includes('name: "ReplyToAgentRequest"'));
  assert.ok(source.includes('name: "ApplyTaskWorkProposal"'));
  assert.ok(source.includes('name: "AcceptTaskWork"'));
  assert.ok(source.includes('name: "ReturnTaskWork"'));
  // 採用と完了は二つのCommand。前半だけ成功した場合を全体の失敗にしない。
  assert.ok(source.includes("Task完了だけを再試行できます"));
});

test("独自の状態管理を持たず、共通projectionを使う（#599）", () => {
  assert.ok(source.includes("buildAttentionQueue"));
  assert.ok(source.includes("taskWorkEntry"));
  // 画面内に状態の正本を作らない（選択や入力だけを持つ）。
  assert.doesNotMatch(source, /localStorage/);
});
