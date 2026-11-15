import { agentWorkCardHeadline, type AgentWorkCard } from "../../shared/agentWorkCard.ts";
import { entityIdSchema } from "../../shared/kernel/public.ts";
import type { MobileTodayResponse } from "../../shared/contracts/mobile/public.ts";

type MobileAgentSession = NonNullable<MobileTodayResponse["data"]["agentSessions"]>[number];

function clip(value: string, max: number): string {
  return value.length > max ? value.slice(0, max) : value;
}

/**
 * AI の作業のカードを、Mobile Gateway の `/v1/today` が返す `agentSessions` の形に直す（#751）。
 *
 * 返す形は変えない（古い APK がそのまま読む）。新しい記録からも同じ形を作る:
 * intent ← intent、outcome ← summary、remainingWork ← remaining。
 *
 * 状態は APK が知っている語彙に直す。done → completed、blocked → blocked、
 * partial（途中）→ interrupted（APK は「中断」と出す）、動いている古い会話 → active。
 * 始まりの無い記録は、終わりの時刻を始まりにも入れる（APK は始まりを必ず読む）。
 * 依頼の無い記録は、要約の最初の一文を依頼の欄に入れる（APK は行の見出しに依頼を出す）。
 * 終わりが記録されていない古い会話は、今までどおり endedAt を null にする
 * （カードが並べるために持つ代わりの時刻を、終わった時刻として渡さない）。
 */
export function mobileAgentSessionFromWorkCard(card: AgentWorkCard): MobileAgentSession {
  return {
    id: entityIdSchema.parse(card.id),
    sourceSessionId: card.source_session_id ? clip(card.source_session_id, 500) : null,
    clientKind: clip(card.client_kind, 50),
    startedAt: card.started_at || card.ended_at,
    endedAt: card.running || !card.end_recorded ? null : card.ended_at,
    status: card.running
      ? "active"
      : card.status === "done"
        ? "completed"
        : card.status === "blocked"
          ? "blocked"
          : "interrupted",
    intent: clip(card.intent || agentWorkCardHeadline(card), 4000),
    outcome: card.summary ? clip(card.summary, 8000) : null,
    remainingWork: card.remaining.slice(0, 100).map((item) => clip(item, 1000)),
  };
}
