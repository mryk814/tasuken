import type { Entity } from "../../../../shared/types/workspace.ts";

const intendedExecutors = new Set(["self", "human", "ai_agent", "unassigned"]);
const assignmentInFlightStates = new Set(["in_progress", "reported_done", "needs_human_review"]);

/** Assignment changes reset idle state and reject ownership changes during active work. */
export function normalizeTaskAssignment(input: Entity, previous: Entity | null = null): Entity {
  const normalized: Entity = { ...input };
  if (!Object.prototype.hasOwnProperty.call(normalized, "intended_executor")) return normalized;
  if (!intendedExecutors.has(String(normalized.intended_executor))) return normalized;

  const changed = !previous || previous.intended_executor !== normalized.intended_executor;
  if (!changed) return normalized;

  const previousWorkState = previous?.work_state
    || (previous?.intended_executor === "ai_agent" ? "ready_for_agent" : "not_delegated");
  if (previous && assignmentInFlightStates.has(String(previousWorkState))) {
    throw new Error("作業中または確認中のTaskは、先にWork Receiptを受け入れるか差し戻してから再割当してください。");
  }

  normalized["work_state"] = normalized["intended_executor"] === "ai_agent" ? "ready_for_agent" : "not_delegated";
  normalized["work_started_at"] = null;
  normalized["work_reported_at"] = null;
  normalized["work_review_note"] = null;
  return normalized;
}
