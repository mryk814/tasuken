export type AgentLogService = "codex" | "claude_code";
export type AgentLogProbe = {
  state: "ready" | "empty" | "missing" | "denied" | "limited" | "error";
  count: number;
  lastUpdated: string | null;
  message: string;
};
export type AgentLogSource = {
  id: string;
  service: AgentLogService;
  path: string;
  destination: string;
  lastScan: string | null;
  message: string;
};
export type AgentLogSyncStatus = {
  sources: AgentLogSource[];
  background: boolean;
  state: "idle" | "running" | "cancelled" | "error";
  scanned: number;
  queued: number;
  unchanged: number;
  deferred: number;
  errors: string[];
};
export type AgentLogSourceConfig = {
  service: AgentLogService;
  path: string;
  consent: boolean;
  destination: string;
};
export type AgentLogSetup = AgentLogSyncStatus & {
  destination: string;
  candidates: Array<{ service: AgentLogService; label: string; path: string }>;
};
