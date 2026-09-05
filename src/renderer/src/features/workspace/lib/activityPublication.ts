import { projectEntityForAi } from "../../../../../shared/aiMetadata.mjs";
import { safeReceiptText } from "../../../../../shared/taskContext.mjs";
import { normalizeReferenceAssertion } from "../../../../../shared/relationAssertion.mjs";
import type { WorkspaceDomain } from "../domain-model/types";
import { buildAgentWorkProjection } from "../domain-model/agentSessionProjection";
import {
  buildDailyAgentSessionContexts,
  projectActivitySessionLogEntries,
} from "./activityTimeline";
import {
  appendActivitySessionsToLog,
  buildActivityLog,
  type ActivityLogInput,
} from "./activityLog";
import { buildActivityReceiptPublication } from "./activityReceiptPublication";

/** A session is one narrative: never publish a partial authorization of mixed work. */
export function buildActivityPublication(input: ActivityLogInput, domain: WorkspaceDomain): string {
  const allowed = (type: string, entity: unknown, theme?: unknown) =>
    projectEntityForAi(type, entity, {
      audience: "m365",
      theme: theme as Record<string, unknown> | undefined,
      workspaceDefault: input.workspaceDefault,
    }).included;
  const rows = buildAgentWorkProjection(domain, {
    limit: Math.max(domain.agent_sessions.length, 1),
  });
  const contexts = buildDailyAgentSessionContexts(rows, input.date, []);
  const references = domain.references.flatMap((reference) => {
    const raw = reference as unknown as Record<string, unknown>;
    if (raw.deleted_at) return [];
    try {
      const normalized = normalizeReferenceAssertion(raw, { legacyRead: true }) as unknown as {
        status: string;
        subject: { type: string; id: string };
        object: { type: string; id: string };
      };
      return normalized.status === "superseded" ? [] : [normalized];
    } catch {
      // Invalid legacy references are also ignored by the local session projection.
      return [];
    }
  });
  const activityEntityAllowed = (event: Record<string, unknown>) => {
    const ref = event.entity_ref as { type?: string; id?: string } | undefined;
    const type = ref?.type || String(event.entity_type || "");
    const id = ref?.id || String(event.entity_id || "");
    const collections = domain as unknown as Record<string, Array<Record<string, unknown>>>;
    const records =
      type === "theme"
        ? input.themes
        : collections[type === "capture_entry" ? "capture_entries" : `${type}s`];
    const entity = records?.find((item) => item.id === id);
    return Boolean(
      entity &&
      allowed(
        type,
        entity,
        input.themes.find((theme) => theme.id === (entity.project_id || entity.theme_id)),
      ),
    );
  };
  const publishable = contexts.filter(({ sessionRow: row }) => {
    if (!row.themes.length) return false;
    return (
      row.themes.every((theme) => allowed("agent_session", row.session, theme)) &&
      references.every((reference) => {
        const target =
          reference.subject.type === "agent_session" && reference.subject.id === row.session.id
            ? reference.object
            : reference.object.type === "agent_session" && reference.object.id === row.session.id
              ? reference.subject
              : null;
        if (
          !target ||
          ["project", "theme", "repository_context", "working_copy", "work_receipt"].includes(
            target.type,
          )
        )
          return true;
        return activityEntityAllowed({ entity_ref: target });
      }) &&
      row.activities.every((event) =>
        activityEntityAllowed(event as unknown as Record<string, unknown>),
      ) &&
      row.receipts.every((receipt) => {
        const task = domain.tasks.find((entry) => entry.id === receipt.task_id);
        return (
          Boolean(
            task &&
            allowed(
              "task",
              task,
              input.themes.find((theme) => theme.id === task.project_id),
            ),
          ) &&
          (!Array.isArray(receipt.ai_visibility) || receipt.ai_visibility.includes("m365"))
        );
      }) &&
      row.tasks.every((task) =>
        allowed(
          "task",
          task,
          input.themes.find((theme) => theme.id === task.project_id),
        ),
      )
    );
  });
  const sessions = projectActivitySessionLogEntries(publishable, input.themes).map((session) => ({
    ...session,
    intent: safeReceiptText(session.intent),
    outcome: safeReceiptText(session.outcome),
    theme_names: session.theme_names.map((name) => safeReceiptText(name)),
    // Machine/repository labels are operational context, not the published result.
    repository_names: [],
    remaining_work: session.remaining_work?.map((item) => safeReceiptText(item)),
  }));
  const base = buildActivityLog({
    ...input,
    workspace: { ...domain, ...input.workspace },
    audience: "m365",
  });
  const sessionLog = appendActivitySessionsToLog("", sessions);
  const content = [
    base,
    sessionLog ? `${sessionLog}\n> AI作業はセッションの記録です。Taskの完了承認とは別です。` : "",
    buildActivityReceiptPublication(input, domain),
  ]
    .filter(Boolean)
    .join("\n\n");
  const excluded = contexts.length - publishable.length;
  return `${content}\n\n> 公開先: M365 Copilot。公開範囲を許可した記録のみ。${excluded ? `AI作業 ${excluded}件は公開範囲を確認できないため除外。` : ""}\n`;
}
