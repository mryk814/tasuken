import type { CommandActor, CommandEnvelope } from "./applicationCommand.ts";
import type { Entity } from "./types/workspace.ts";

type Row = Record<string, unknown>;

/** 保存先のログ同期が作るAgent Session Proposalか。利用者が登録した保存先からの読み込みに限る。 */
export function isAgentLogSyncProposal(proposal: Row): boolean {
  return (
    proposal.payload_type === "agent_sessions" &&
    typeof proposal.source_app === "string" &&
    proposal.source_app.startsWith("tasken-log-sync:")
  );
}

function record(value: unknown): Row | null {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Row) : null;
}

/**
 * 採用待ちのAgent Session ProposalをそのままApplyAiProposalにする。
 * Rendererの「採用」と同じ候補（session本体と関連先）を同じ版確認で保存する。
 * 内容を選り分ける画面は通らないため、候補に問題があれば採用せずに理由を返す。
 */
export function agentSessionProposalAcceptanceCommand(
  proposal: Entity,
  findSession: (id: string) => Entity | null | undefined,
  options: { actor: CommandActor; source: CommandEnvelope["source"]; issuedAt: string },
): CommandEnvelope {
  if (proposal.payload_type !== "agent_sessions" || proposal.status !== "pending")
    throw new Error("採用待ちのAgent Session記録ではありません。");
  const payload = record(proposal.payload);
  const entries = Array.isArray(payload?.agent_sessions) ? payload.agent_sessions : [];
  if (!entries.length) throw new Error("agent_sessions がありません。");
  const historyVersion = Number(record(proposal.request)?.history_refresh_version || 0);
  const candidates: Array<{ type: "agent_session" | "reference"; entity: Entity }> = [];
  for (const raw of entries) {
    const entry = record(raw);
    const session = record(entry?.session);
    if (!entry || !session || typeof session.id !== "string" || !session.id)
      throw new Error("Agent Session 本体がありません。");
    const existing = findSession(session.id);
    if (entry.action === "capture" && historyVersion > 0) {
      if (!existing || Number(existing.version) !== historyVersion)
        throw new Error("記録が変更されています。提案を閉じて再同期してください。");
    } else if (entry.action === "finish" && !existing) {
      throw new Error("終了対象の Agent Session が見つかりません。");
    }
    candidates.push({ type: "agent_session", entity: session as Entity });
    for (const reference of Array.isArray(entry.references) ? entry.references : []) {
      const value = record(reference);
      if (value && typeof value.id === "string")
        candidates.push({ type: "reference", entity: value as Entity });
    }
  }
  const version = Number(proposal.version || 0);
  return {
    commandId: `${String(proposal.id)}:accept:v${version}`,
    name: "ApplyAiProposal",
    payload: { proposal: { ...proposal, status: "accepted" }, candidates },
    actor: options.actor,
    source: options.source,
    expectedVersions: [
      { type: "ai_proposal", id: String(proposal.id), version },
      ...candidates.flatMap(({ type, entity }) =>
        Number.isInteger(entity.version)
          ? [{ type, id: String(entity.id), version: Number(entity.version) }]
          : [],
      ),
    ],
    issuedAt: options.issuedAt,
  };
}
