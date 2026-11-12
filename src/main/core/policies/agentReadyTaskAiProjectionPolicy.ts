import { buildAiEntityHeader } from "../../../shared/aiMetadata.mjs";
import type { AgentReadyTaskSourceRecord } from "../ports/agentReadyTaskReadPort.ts";

/** Attaches the shared AI metadata header to each Task. Every Task is returned. */
export class AgentReadyTaskAiProjectionPolicy {
  project(tasks: AgentReadyTaskSourceRecord[]) {
    return {
      records: tasks.map((task) => ({ ...task, ai: buildAiEntityHeader("task", task) })),
    };
  }
}
