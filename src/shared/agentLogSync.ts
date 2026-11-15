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
/** 最後の動きからこの時間がたった会話を「静か」と見て拾う（#751）。動いている会話は読まない。 */
export const AGENT_LOG_QUIET_MS = 60 * 60_000;
export type AgentLogSyncStatus = {
  sources: AgentLogSource[];
  background: boolean;
  state: "idle" | "running" | "cancelled" | "error";
  /** 見たログの数。 */
  scanned: number;
  /** 新しく 1 件として書いた会話の数。 */
  recorded: number;
  /** 前に見た時から変わっていない・もう数えてある（AI が書いた、前に拾った、本人が消した）会話の数。 */
  unchanged: number;
  /** まだ動いている（最後の動きから 60 分たっていない）ので、読まなかった会話の数。 */
  active: number;
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
