import assert from "node:assert/strict";
import test from "node:test";

import {
  FEED_CANONICAL_ITEMS,
  FEED_FIXTURE_ITEMS,
  FEED_OPTIONAL_DAILY_BUDGET,
  FEED_PAGE_SIZE,
  buildFeedProjection,
  countUnresolved,
  selectNeedsYou,
  selectRecent,
} from "../src/renderer/src/features/workspace/lib/feedFixtures.ts";

test("5種類のfixtureが揃い、同じ文章の焼き増しがない", () => {
  const kinds = FEED_CANONICAL_ITEMS.map((item) => item.kind);
  assert.deepEqual(kinds, [
    "today_task",
    "stale_suggestion",
    "human_question",
    "review_ready",
    "past_context",
  ]);
  const headlines = FEED_FIXTURE_ITEMS.map((item) => item.headline);
  assert.equal(new Set(headlines).size, headlines.length);
  const ids = FEED_FIXTURE_ITEMS.map((item) => item.id);
  assert.equal(new Set(ids).size, ids.length);
});

test("今見るは 対応待ち → 成果確認 → 今日の変化 → 任意 の順に並ぶ", () => {
  const { items } = buildFeedProjection(FEED_FIXTURE_ITEMS);
  const groups = items.map((item) => item.group);
  const rank = { needs_you: 0, review: 1, today_change: 2, optional: 3 };
  const ranks = groups.map((group) => rank[group]);
  assert.deepEqual(
    ranks,
    [...ranks].sort((a, b) => a - b),
  );
  assert.equal(items[0].kind, "human_question");
});

test("同じ段階では人が設定した期限を優先し、次に受信の古い順にする", () => {
  const { items } = buildFeedProjection(FEED_FIXTURE_ITEMS);
  const today = items.filter((item) => item.group === "today_change");
  assert.deepEqual(
    today.map((item) => item.dueAt),
    ["2026-09-20", "2026-09-25", "2026-09-30"],
  );
  const needsYou = items.filter((item) => item.group === "needs_you");
  assert.deepEqual(
    needsYou.map((item) => item.receivedAt),
    ["2026-09-20T09:12:00+09:00", "2026-09-20T09:30:00+09:00"],
  );
});

test("任意の提案と関連記録は一日の上限を超えず、要対応項目を隠さない", () => {
  const many = Array.from({ length: 9 }, (_, index) => ({
    ...FEED_CANONICAL_ITEMS[1],
    id: `optional-${index}`,
    receivedAt: `2026-09-20T0${index}:00:00+09:00`,
  }));
  const mixed = [...FEED_CANONICAL_ITEMS, ...many];
  const projection = buildFeedProjection(mixed);
  const shownOptional = projection.items.filter((item) => item.group === "optional");
  assert.equal(shownOptional.length, FEED_OPTIONAL_DAILY_BUDGET);
  assert.equal(projection.budgetedOptionalCount, 9 + 2 - FEED_OPTIONAL_DAILY_BUDGET);
  // 要対応と成果確認は上限の影響を受けない。
  assert.equal(
    projection.items.filter((item) => item.group === "needs_you").length,
    mixed.filter((item) => item.group === "needs_you").length,
  );
});

test("後で見るは一覧から外すが、未解決の件数を減らさない", () => {
  const before = countUnresolved(FEED_FIXTURE_ITEMS);
  const target = FEED_FIXTURE_ITEMS.find((item) => item.kind === "human_question");
  assert.ok(target);
  const projection = buildFeedProjection(FEED_FIXTURE_ITEMS, {
    deferred: new Set([target.id]),
  });
  assert.equal(
    projection.items.some((item) => item.id === target.id),
    false,
  );
  assert.equal(projection.deferredCount, 1);
  assert.equal(countUnresolved(FEED_FIXTURE_ITEMS), before);
});

test("対応待ちは未解決の判断だけ、最近の更新は受信の新しい順にする", () => {
  const { items } = buildFeedProjection(FEED_FIXTURE_ITEMS);
  const needs = selectNeedsYou(items);
  assert.equal(
    needs.every((item) => item.group === "needs_you" || item.group === "review"),
    true,
  );
  assert.equal(
    needs.some((item) => item.kind === "stale_suggestion"),
    false,
  );
  const recent = selectRecent(items);
  assert.deepEqual(
    recent.map((item) => item.receivedAt),
    [...recent.map((item) => item.receivedAt)].sort((a, b) => b.localeCompare(a)),
  );
});

test("AI生成のラベルは生成文にだけ付け、通常のTaskと自分の記録には付けない", () => {
  for (const item of FEED_FIXTURE_ITEMS) {
    if (item.generated === "ai_summary") {
      // 要約には原文への参照を必ず残す。
      assert.ok(item.sourceLabel, `${item.id} に参照がない`);
    }
    if (item.kind === "today_task" || item.kind === "human_question") {
      assert.equal(item.generated, null, `${item.id} に生成ラベルが付いている`);
    }
  }
});

test("常時表示する操作は主要1つと補助1つまでで、design-guideの上限4個を超えない", () => {
  for (const item of FEED_FIXTURE_ITEMS) {
    assert.ok(item.actions.length <= 2, `${item.id} の操作が多すぎる`);
    assert.ok(item.actions.length > 0);
    // 主操作は各行に高々1つ。日付操作だけのTask行は主操作を持たない（#604の操作の意味）。
    assert.ok(
      item.actions.filter((action) => action.role === "primary").length <= 1,
      `${item.id} の主操作が複数ある`,
    );
  }
  // 判断を求める行は、開いたときに主操作を持つ。
  for (const item of FEED_FIXTURE_ITEMS.filter(
    (entry) => entry.group === "needs_you" || entry.group === "review",
  )) {
    assert.equal(
      item.actions.filter((action) => action.role === "primary").length,
      1,
      `${item.id} に主操作がない`,
    );
  }
});

test("表示理由をすべての行が説明できる", () => {
  for (const item of FEED_FIXTURE_ITEMS) {
    assert.ok(item.reasonShown.length > 0, `${item.id} に表示理由がない`);
    assert.ok(item.pathLabel.includes("›") || item.pathLabel.length > 0);
  }
});

test("初回表示は20行で、全fixtureはその範囲に収まる", () => {
  assert.equal(FEED_PAGE_SIZE, 20);
  const { items } = buildFeedProjection(FEED_FIXTURE_ITEMS);
  assert.ok(items.length <= FEED_PAGE_SIZE);
});
