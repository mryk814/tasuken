import * as z from "zod/v4";

const boundedText = (max: number) => z.string().trim().min(1).max(max);
const optionalTimestampSchema = z
  .string()
  .trim()
  .refine((value) => !Number.isNaN(Date.parse(value)), "ISO 8601 timestampが必要です。")
  .optional();

export const taskWorkProposalActorSchema = z
  .object({
    kind: z.literal("ai_agent"),
    id: boundedText(200).optional(),
  })
  .strict();

export const taskWorkRepositoryContextSchema = z
  .object({
    repository_context_id: boundedText(200).optional(),
    provider: z
      .enum(["github", "gitlab", "azure_devops", "local", "generic_git", "unknown"])
      .optional(),
    repository_slug: boundedText(500)
      .regex(/^[A-Za-z0-9._-]+(?:\/[A-Za-z0-9._-]+)*$/)
      .optional(),
    branch: boundedText(500)
      .refine((value) => !/[\x00-\x1f\x7f]/.test(value), "branchに制御文字は使えません。")
      .optional(),
  })
  .strict();

export const taskWorkExternalReferenceSchema = z
  .object({
    kind: z.enum([
      "issue",
      "pull_request",
      "merge_request",
      "commit",
      "branch",
      "file",
      "pipeline",
      "other",
    ]),
    provider: z.string().trim().max(120).optional(),
    display_label: boundedText(200),
    url: z
      .string()
      .trim()
      .url()
      .refine((value) => {
        try {
          const parsed = new URL(value);
          return parsed.protocol === "https:" && !parsed.username && !parsed.password;
        } catch {
          return false;
        }
      }, "HTTPS URL without credentialsが必要です。"),
    external_id: z.string().trim().max(200).optional(),
  })
  .strict();

const workItemListSchema = z.array(boundedText(1000)).max(100).optional();
const requestBase = {
  task_id: boundedText(200),
  expected_version: z.number().int().nonnegative(),
  idempotency_key: boundedText(200),
  caller: boundedText(200),
  actor: taskWorkProposalActorSchema,
  source: z.literal("mcp"),
  source_session: boundedText(200).optional(),
  source_app: boundedText(120).optional(),
  repository_context: taskWorkRepositoryContextSchema.optional(),
};

const receiptFields = {
  executor_kind: z.enum(["self", "human", "ai_agent", "external", "unknown"]),
  executor_label: boundedText(200),
  summary: boundedText(10_000),
  completed_items: workItemListSchema,
  changed_or_created_items: workItemListSchema,
  verification: workItemListSchema,
  remaining_work: workItemListSchema,
  external_references: z.array(taskWorkExternalReferenceSchema).max(100).optional(),
  reported_at: optionalTimestampSchema,
  provider: z.string().trim().max(120).optional(),
  model: z.string().trim().max(200).optional(),
};

export const proposeTaskWorkRequestSchema = z.discriminatedUnion("action", [
  z
    .object({
      ...requestBase,
      action: z.literal("start"),
      executor_kind: z.enum(["self", "human", "ai_agent", "external", "unknown"]).optional(),
      executor_identity: z.string().trim().max(200).optional(),
      started_at: optionalTimestampSchema,
    })
    .strict(),
  z.object({ ...requestBase, ...receiptFields, action: z.literal("append_receipt") }).strict(),
  z.object({ ...requestBase, ...receiptFields, action: z.literal("report_done") }).strict(),
  z
    .object({
      ...requestBase,
      action: z.literal("report_blocked"),
      executor_kind: z.enum(["self", "human", "ai_agent", "external", "unknown"]).optional(),
      executor_label: boundedText(200),
      blocker: boundedText(10_000),
      attempted_work: workItemListSchema,
      needed_input: workItemListSchema,
      retained_artifacts: workItemListSchema,
      external_references: z.array(taskWorkExternalReferenceSchema).max(100).optional(),
      reported_at: optionalTimestampSchema,
      provider: z.string().trim().max(120).optional(),
      model: z.string().trim().max(200).optional(),
    })
    .strict(),
]);

export const proposeTaskWorkResponseSchema = z
  .object({
    proposal_id: z.string().uuid(),
    status: z.enum(["queued", "duplicate"]),
    payload_type: z.literal("task_work"),
    message: boundedText(500),
  })
  .strict();

export type ProposeTaskWorkRequest = z.output<typeof proposeTaskWorkRequestSchema>;
export type ProposeTaskWorkResponse = z.output<typeof proposeTaskWorkResponseSchema>;

type WorkRecord = { id: string; [key: string]: unknown };
export function taskWorkEntry(proposal: WorkRecord): Record<string, unknown> | null {
  if (proposal.deleted_at || proposal.payload_type !== "task_work") return null;
  try {
    const payload =
      typeof proposal.payload === "string" ? JSON.parse(proposal.payload) : proposal.payload;
    const entries = payload?.task_work;
    return Array.isArray(entries) && entries.length === 1 && typeof entries[0]?.task_id === "string"
      ? entries[0]
      : null;
  } catch {
    return null; // Invalid legacy payloads remain individually reviewable in AI Inbox.
  }
}

export function taskWorkReportTime(proposal: WorkRecord): string {
  const entry = taskWorkEntry(proposal);
  const value = String(
    entry?.reported_at || entry?.started_at || proposal.received_at || proposal.created_at || "",
  );
  return Number.isFinite(Date.parse(value)) ? new Date(value).toISOString() : "";
}

// Only earlier reports from this exact producer and Task revision are covered.
export function taskWorkReportsCoveredBy<T extends WorkRecord>(done: T, proposals: T[]): T[] {
  const final = taskWorkEntry(done);
  if (final?.action !== "report_done") return [];
  return proposals.filter((proposal) => {
    const entry = taskWorkEntry(proposal);
    return (
      proposal.id !== done.id &&
      proposal.status === "pending" &&
      entry &&
      ["append_receipt", "report_done", "report_blocked"].includes(String(entry.action)) &&
      entry.task_id === final.task_id &&
      entry.expected_version === final.expected_version &&
      proposal.source_app === done.source_app &&
      entry.caller === final.caller &&
      (entry.source_session || null) === (final.source_session || null) &&
      taskWorkReportTime(proposal) <= taskWorkReportTime(done)
    );
  });
}

export function taskWorkInboxGroups<T extends WorkRecord>(proposals: T[]) {
  const groups = new Map<string, T[]>();
  for (const proposal of proposals.filter((item) => !item.deleted_at)) {
    const entry = taskWorkEntry(proposal);
    const key = entry ? `task:${entry.task_id}` : `proposal:${proposal.id}`;
    groups.set(key, [...(groups.get(key) || []), proposal]);
  }
  return [...groups.entries()].map(([id, reports]) => {
    reports.sort(
      (a, b) =>
        taskWorkReportTime(a).localeCompare(taskWorkReportTime(b)) || a.id.localeCompare(b.id),
    );
    const pending = reports.filter((item) => item.status === "pending");
    const terminal = pending.filter((item) =>
      ["report_done", "report_blocked"].includes(String(taskWorkEntry(item)?.action)),
    );
    const latest = terminal.at(-1) || pending.at(-1) || reports.at(-1)!;
    return {
      id,
      taskId: taskWorkEntry(latest)?.task_id as string | undefined,
      reports,
      latest,
      actionable: pending.length > 0 && (!taskWorkEntry(latest) || terminal.length > 0),
    };
  });
}

export interface TaskWorkPeriod {
  id: string;
  task_id: string;
  title: string;
  started_at: string;
  ended_at: string | null;
  status: "active" | "completed" | "blocked";
  review_status: "pending" | "accepted" | "recorded";
  summary: string;
  executor_label: string;
  source_session: string | null;
  verification: string[];
  remaining_work: string[];
  proposal_id: string | null;
}

// A read-only view of Task work, never a fabricated AgentSession or a Task completion.
export function taskWorkPeriods(
  tasks: WorkRecord[],
  proposals: WorkRecord[],
  receipts: WorkRecord[],
): TaskWorkPeriod[] {
  const taskById = new Map(tasks.filter((task) => !task.deleted_at).map((task) => [task.id, task]));
  const receiptById = new Map(
    receipts.filter((item) => !item.deleted_at).map((item) => [item.id, item]),
  );
  const candidates = new Map<string, { report: WorkRecord; proposal?: WorkRecord }>();
  for (const receipt of receiptById.values()) {
    candidates.set(receipt.id, { report: receipt });
  }
  for (const proposal of proposals) {
    const entry = taskWorkEntry(proposal);
    if (!entry || !["pending", "accepted"].includes(String(proposal.status))) continue;
    candidates.set(proposal.id, {
      report: {
        ...entry,
        ...receiptById.get(proposal.id),
        source_session: entry.source_session,
        id: proposal.id,
      },
      proposal,
    });
  }
  const periods = new Map<string, TaskWorkPeriod>();
  const ordered = [...candidates.values()].sort(
    (a, b) =>
      Date.parse(String(a.report.reported_at || a.proposal?.received_at || "")) -
      Date.parse(String(b.report.reported_at || b.proposal?.received_at || "")),
  );
  const list = (value: unknown) =>
    Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
  for (const { report, proposal } of ordered) {
    const task = taskById.get(String(report.task_id));
    if (!task) continue;
    const ended = String(report.reported_at || proposal?.received_at || proposal?.created_at || "");
    const taskStart = String(task.work_started_at || "");
    const started = String(
      report.started_at ||
        (proposal?.request as Record<string, unknown> | undefined)?.work_started_at ||
        (taskStart && Date.parse(taskStart) <= Date.parse(ended) ? taskStart : ended),
    );
    if (
      !Number.isFinite(Date.parse(started)) ||
      !Number.isFinite(Date.parse(ended)) ||
      Date.parse(ended) < Date.parse(started)
    )
      continue;
    const id = `task-work:${task.id}:${new Date(started).toISOString()}`;
    const terminal =
      report.action === "report_done" ||
      report.action === "report_blocked" ||
      (report.runtime_metadata as Record<string, unknown> | undefined)?.report_kind === "done" ||
      (report.runtime_metadata as Record<string, unknown> | undefined)?.report_kind === "blocked" ||
      task.work_reported_at === ended;
    const previous = periods.get(id);
    if (
      previous?.review_status === "accepted" &&
      previous.status === "completed" &&
      proposal?.status === "pending"
    )
      continue;
    periods.set(id, {
      id,
      task_id: task.id,
      title: String(task.title || task.id),
      started_at: started,
      ended_at: terminal ? ended : null,
      status: !terminal
        ? "active"
        : report.action === "report_blocked" ||
            (report.runtime_metadata as Record<string, unknown> | undefined)?.report_kind ===
              "blocked"
          ? "blocked"
          : "completed",
      review_status:
        proposal?.status === "pending"
          ? "pending"
          : proposal?.status === "accepted"
            ? "accepted"
            : "recorded",
      summary: String(report.summary || ""),
      executor_label: String(report.executor_label || task.executor_identity || "AI"),
      source_session: typeof report.source_session === "string" ? report.source_session : null,
      verification: list(report.verification),
      remaining_work: list(report.remaining_work),
      proposal_id: proposal?.id || null,
    });
  }
  return [...periods.values()];
}
