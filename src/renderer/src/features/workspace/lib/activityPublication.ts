import { safeReceiptText } from "../../../../../shared/taskContext.mjs";
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

/** Daily documents follow the selected output folder, without per-item AI permissions. */
export function buildActivityPublication(input: ActivityLogInput, domain: WorkspaceDomain): string {
  if (input.changeEvents === undefined) {
    throw new Error("日誌を生成できません。活動履歴を再読み込みしてください。");
  }
  const rows = buildAgentWorkProjection(domain, {
    limit: Math.max(domain.agent_sessions.length, 1),
  });
  const contexts = buildDailyAgentSessionContexts(rows, input.date, []);
  const sessions = projectActivitySessionLogEntries(contexts, input.themes).map((session) => ({
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
  });
  const sessionLog = appendActivitySessionsToLog("", sessions);
  const content = [
    base,
    sessionLog ? `${sessionLog}\n> AI作業はセッションの記録です。Taskの完了承認とは別です。` : "",
    buildActivityReceiptPublication(input, domain),
  ]
    .filter(Boolean)
    .join("\n\n");
  return content;
}
