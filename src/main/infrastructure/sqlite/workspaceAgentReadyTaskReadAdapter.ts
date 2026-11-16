import type { AgentReadyTaskSourceRecord, AgentReadyTaskThemeRecord } from "../../core/public.ts";

export interface AgentReadyTaskWorkspacePersistence {
  list(type: "task", includeDeleted?: boolean): AgentReadyTaskSourceRecord[];
  list(type: "theme", includeDeleted?: boolean): AgentReadyTaskThemeRecord[];
}
