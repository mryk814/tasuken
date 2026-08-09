export type DataHealthSeverity = "info" | "warning" | "error";
export type DataHealthIssueState = "open" | "ignored" | "resolved";

export interface DataHealthIssue {
  id: string;
  ruleId: string;
  label: string;
  severity: DataHealthSeverity;
  ref: { type: string; id: string };
  themeId: string | null;
  reason: string;
  fixActions: string[];
  metadata: Record<string, unknown>;
  state: DataHealthIssueState;
}

export interface DataHealthResult {
  schema: "tasken-data-health/v1";
  generatedAt: string;
  issues: DataHealthIssue[];
  counts: Record<DataHealthIssueState, number>;
  evaluation: { evaluatedEntities: number; reusedEntities: number; totalEntities: number };
  stateRevision: number;
}

export interface DataHealthStateEnvelope {
  schema: "tasken-data-health-state/v1";
  revision: number;
  updatedAt: string;
  issues: Record<string, { state: Exclude<DataHealthIssueState, "open">; updatedAt: string; note: string }>;
}

export const DATA_HEALTH_SCHEMA: "tasken-data-health/v1";
export const DATA_HEALTH_STATE_SCHEMA: "tasken-data-health-state/v1";
export const DATA_HEALTH_RULES: readonly Array<{ id: string; label: string; severity: DataHealthSeverity; fixActions: readonly string[] }>;
export function normalizeDataHealthState(value: unknown): DataHealthStateEnvelope;
export function buildDataHealth(workspace: unknown, options?: Record<string, unknown>): DataHealthResult;
export class DataHealthEvaluator {
  evaluate(workspace: unknown, options?: Record<string, unknown>): DataHealthResult;
}
