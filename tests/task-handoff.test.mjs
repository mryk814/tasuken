import assert from "node:assert/strict";
import test from "node:test";

import {
  HANDOFF_DELEGATE_LABELS,
  describeHandoffContextChange,
  handoffContextRef,
  handoffDelegateSchema,
  isSameHandoffContextRef,
} from "../src/shared/contracts/task/public.ts";
import { buildTaskAiRequest } from "../src/renderer/src/features/workspace/lib/taskAiRequest.ts";

const task = { id: "task-viscosity", title: "粘度測定の条件を決める" };

function preview(included, overrides = {}) {
  return {
    seed: { type: "task", id: "task-viscosity" },
    included: included.map((id, index) => ({
      ref: { type: index === 0 ? "task" : "note", id },
      includedReason: index === 0 ? "seed" : "explicitly_linked",
    })),
    truncation: { truncated: false },
    ...overrides,
  };
}

test("同じPreviewからは同じ参照版を導出する（並び順に依存しない）", () => {
  const a = handoffContextRef(preview(["task-viscosity", "note-b", "note-a"]));
  const b = handoffContextRef(preview(["task-viscosity", "note-a", "note-b"]));
  assert.equal(a, b);
  assert.ok(a.includes("seed=task:task-viscosity"));
  assert.ok(a.includes("included=3"));
  assert.ok(a.includes("truncated=no"));
});

test("関連資料が変わると参照版が変わり、再確認が必要になる", () => {
  const before = handoffContextRef(preview(["task-viscosity", "note-a"]));
  const after = handoffContextRef(preview(["task-viscosity", "note-a", "note-c"]));
  assert.notEqual(before, after);
  assert.equal(isSameHandoffContextRef(before, after), false);
  assert.equal(isSameHandoffContextRef(before, before), true);
  // 未確認（null）は一致扱いにしない。準備前の状態で通り抜けない。
  assert.equal(isSameHandoffContextRef(null, before), false);
  assert.equal(isSameHandoffContextRef(undefined, before), false);
});

test("切り詰めの有無も参照版に含める", () => {
  const plain = handoffContextRef(preview(["task-viscosity"]));
  const truncated = handoffContextRef(
    preview(["task-viscosity"], { truncation: { truncated: true } }),
  );
  assert.notEqual(plain, truncated);
  assert.ok(truncated.includes("truncated=yes"));
});

test("参照版の差を短い説明にする", () => {
  const before = handoffContextRef(preview(["task-viscosity", "note-a"]));
  const added = handoffContextRef(preview(["task-viscosity", "note-a", "note-c", "note-d"]));
  const removed = handoffContextRef(preview(["task-viscosity"]));
  assert.match(describeHandoffContextChange(before, added), /追加 2件/);
  assert.match(describeHandoffContextChange(before, removed), /削除 1件/);
  assert.match(describeHandoffContextChange(before, before), /Contextが更新されました/);
});

test("依頼文はPreviewで確認した参照版と依頼内容を同じ文面へ載せる", () => {
  const ref = handoffContextRef(preview(["task-viscosity", "note-a"]));
  const text = buildTaskAiRequest([task], {
    delegateLabel: HANDOFF_DELEGATE_LABELS.external_ai,
    expectedResult: "3条件の比較表",
    instruction: "既存の測定条件は変えない",
    contextRef: ref,
  });
  assert.ok(text.includes(`Task ID: ${task.id}`));
  assert.ok(text.includes("任せる相手: 外部AI"));
  assert.ok(text.includes("期待する成果:\n3条件の比較表"));
  assert.ok(text.includes("追加指示:\n既存の測定条件は変えない"));
  assert.ok(text.includes(ref));
  // 参照版が違えば知らせる、を依頼文に明記する。
  assert.ok(text.includes("異なるContextが返った場合"));
});

test("任意項目が空なら依頼文へ空の見出しを残さない", () => {
  const text = buildTaskAiRequest([task]);
  assert.equal(text.includes("任せる相手:"), false);
  assert.equal(text.includes("期待する成果:"), false);
  assert.equal(text.includes("追加指示:"), false);
  assert.equal(text.includes("参照版"), false);
  // 既存の手順は変わらない。
  assert.ok(text.includes("tasken.start_task_work"));
  assert.ok(text.includes("tasken.report_task_done"));
});

test("任せる相手は既知の値だけを受け付ける", () => {
  assert.equal(handoffDelegateSchema.safeParse("external_ai").success, true);
  assert.equal(handoffDelegateSchema.safeParse("codex").success, true);
  assert.equal(handoffDelegateSchema.safeParse("hermes").success, false);
  assert.equal(HANDOFF_DELEGATE_LABELS.other, "その他");
});
