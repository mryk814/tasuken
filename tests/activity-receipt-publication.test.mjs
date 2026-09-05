import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import { build } from "esbuild";

const bundled = await build({
  entryPoints: [
    path.resolve("src/renderer/src/features/workspace/lib/activityReceiptPublication.ts"),
  ],
  bundle: true,
  platform: "node",
  format: "esm",
  write: false,
  logLevel: "silent",
});
const { buildActivityReceiptPublication } = await import(
  `data:text/javascript;base64,${Buffer.from(bundled.outputFiles[0].text).toString("base64")}`
);

function fixture() {
  const task = {
    id: "task-1",
    title: "モデル学習",
    project_id: "theme-1",
    ai_visibility: ["m365"],
  };
  const receipt = {
    id: "receipt-1",
    task_id: task.id,
    summary: "精度95%",
    completed_items: ["学習した"],
    changed_or_created_items: ["結果表"],
    verification: ["holdoutで検証"],
    remaining_work: ["別seedを試す"],
    runtime_metadata: { token: "runtime-secret" },
    provenance: { source_session: "internal-session" },
  };
  const event = {
    id: "accept-1",
    occurred_at: "2026-09-05T01:00:00.000Z",
    event_kind: "task_ai_accepted",
    entity_ref: { type: "task", id: task.id },
    theme_ref: { kind: "theme", id: "theme-1" },
    work_receipt_ref: { type: "work_receipt", id: receipt.id },
    metadata: { work_action: "accepted" },
    actor: { kind: "user" },
    summary: "採用",
  };
  const domain = { tasks: [task], work_receipts: [receipt], change_events: [event] };
  const input = {
    date: "2026-09-05",
    themes: [{ id: "theme-1", name: "研究" }],
    timezone: "Asia/Tokyo",
  };
  return { task, receipt, event, domain, input };
}

test("受入日の確認済みReceiptの結果・検証・残作業を公開し内部metadataは含めない", () => {
  const f = fixture();
  const text = buildActivityReceiptPublication(f.input, f.domain);
  for (const expected of ["精度95%", "holdoutで検証", "別seedを試す", "人間確認済み", "結果表"])
    assert.ok(text.includes(expected));
  assert.doesNotMatch(text, /runtime-secret|internal-session/);
  assert.equal(buildActivityReceiptPublication({ ...f.input, date: "2026-09-04" }, f.domain), "");
});

test("未確認・別Receipt・別Task・削除済みは出さない", () => {
  for (const mutate of [
    (f) => {
      f.event.metadata.work_action = "reported";
    },
    (f) => {
      f.event.work_receipt_ref.id = "other";
    },
    (f) => {
      f.receipt.task_id = "other";
    },
    (f) => {
      f.receipt.deleted_at = "2026-09-05";
    },
    (f) => {
      f.task.deleted_at = "2026-09-05";
    },
  ]) {
    const f = fixture();
    mutate(f);
    assert.equal(buildActivityReceiptPublication(f.input, f.domain), "");
  }
});

test("項目別AI設定を日誌に適用せず重複受入を一度だけ出す", () => {
  const f = fixture();
  f.task.ai_visibility = [];
  f.receipt.ai_visibility = [];
  f.input.themes[0].default_ai_visibility = [];
  f.domain.change_events.push({ ...f.event, id: "accept-2" });
  assert.equal(buildActivityReceiptPublication(f.input, f.domain).match(/精度95%/g).length, 1);
});

test("結果本文と項目の秘密・ローカルパスを既存public sanitizerで伏せる", () => {
  const f = fixture();
  f.receipt.summary = "結果 C:\\Users\\person\\secret.txt token=abcd-secret";
  f.receipt.verification = ["C:\\Users\\person\\data.csv"];
  const output = buildActivityReceiptPublication(f.input, f.domain);
  assert.doesNotMatch(output, /person|abcd-secret/);
});
