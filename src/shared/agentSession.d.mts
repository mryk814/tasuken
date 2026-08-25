export type AgentSessionStatus = "active" | "completed" | "blocked" | "abandoned";
export type AgentClientKind = "codex" | "claude_code" | "cursor" | "github_copilot" | "other";
export function normalizeWorkingCopy(input?: Record<string, unknown>): Record<string, unknown>;
export function normalizeAgentSession(input?: Record<string, unknown>): Record<string, unknown>;
export function publicWorkingCopy(input: Record<string, unknown>): Record<string, unknown>;
export function publicAgentSession(input: Record<string, unknown>): Record<string, unknown>;
export const AGENT_SESSION_STATUSES: readonly AgentSessionStatus[];
export const AGENT_CLIENT_KINDS: readonly AgentClientKind[];
