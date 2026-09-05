import { projectEntityForAi } from "../../../../../shared/aiMetadata.mjs";
import { queryActivityEvents } from "../../../../../shared/activityProjection.mjs";
import { sanitizePublicText } from "../../../../../shared/publicProjection";
import type { WorkspaceDomain } from "../domain-model/types";
import type { ActivityLogInput } from "./activityLog";

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function line(value: unknown): string {
  return sanitizePublicText(value)
    .replace(/[\r\n]+/g, " ")
    .trim();
}

/** Publish only the exact result accepted on this day, using current visibility. */
export function buildActivityReceiptPublication(
  input: ActivityLogInput,
  domain: WorkspaceDomain,
): string {
  const events = queryActivityEvents({
    events: (input.changeEvents ?? domain.change_events)
      .map(record)
      .filter((event) => !event.deleted_at && record(event.metadata).work_action === "accepted"),
    workspace: { ...domain, themes: input.themes },
    themes: input.themes,
    date: input.date,
    timezone: input.timezone,
    audience: "m365",
    workspaceDefault: input.workspaceDefault,
  }).events;
  const sections: string[] = [];
  const seen = new Set<string>();
  for (const event of events) {
    if (event.entity_ref.type !== "task" || event.work_receipt_ref?.type !== "work_receipt")
      continue;
    const receiptId = event.work_receipt_ref.id;
    const task = domain.tasks.find(
      (entry) => entry.id === event.entity_ref.id && !record(entry).deleted_at,
    );
    const receipt = domain.work_receipts.find(
      (entry) => entry.id === receiptId && entry.task_id === task?.id && !entry.deleted_at,
    );
    if (!task || !receipt || seen.has(receipt.id)) continue;
    // The event query already checks the Task. An explicit Receipt restriction
    // can narrow publication further; an absent setting inherits its Task.
    if (
      Array.isArray(receipt.ai_visibility) &&
      !projectEntityForAi("work_receipt", receipt, {
        audience: "m365",
        workspaceDefault: input.workspaceDefault,
      }).included
    )
      continue;
    seen.add(receipt.id);
    const rows = [
      `### ${line(task.title)} · 作業結果`,
      `- 採用状態: 人間確認済み（${line(event.local_time)}）`,
      "",
      "#### 結果",
      sanitizePublicText(receipt.summary).trim(),
    ];
    for (const [field, label] of [
      ["completed_items", "実施したこと"],
      ["changed_or_created_items", "変更・作成したもの"],
      ["verification", "検証"],
      ["remaining_work", "残作業"],
    ] as const) {
      const items = (receipt[field] ?? [])
        .filter((item) => typeof item === "string")
        .map(line)
        .filter(Boolean);
      rows.push(
        "",
        `#### ${label}`,
        ...(items.length ? items.map((item) => `- ${item}`) : ["- 記録なし"]),
      );
    }
    sections.push(rows.join("\n"));
  }
  return sections.length ? ["## 採用済みの作業結果", ...sections].join("\n\n") : "";
}
