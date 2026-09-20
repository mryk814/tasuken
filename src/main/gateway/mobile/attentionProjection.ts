import type { MobileAttentionItem } from "../../../shared/contracts/mobile/public.ts";
import type { AttentionItem } from "../../../shared/contracts/task/public.ts";

/**
 * Agent Deskの要対応を、Androidへ渡すread modelへ射影する（#601）。
 *
 * **Androidは状態を導出しない。** Desktopと同じ `buildAttentionQueue` の結果を
 * そのまま受け取り、表示と短い返答だけを行う。射影はここ1箇所に置く。
 */
export function projectAttentionItem(
  item: AttentionItem,
  taskVersion: number | null,
): MobileAttentionItem {
  return {
    attentionId: item.attentionId,
    kind: item.kind,
    taskId: item.taskId,
    taskTitle: item.taskTitle,
    taskVersion: item.taskId ? taskVersion : null,
    themeId: item.themeId,
    themeName: item.themeName,
    agentLabel: item.agentLabel,
    headline: item.headline,
    summary: item.summary,
    questionOrAction: item.questionOrAction,
    createdAt: item.createdAt,
    updatedAt: item.updatedAt,
    sourceType: item.sourceType,
    sourceId: item.sourceId,
    sourceVersion: item.sourceVersion,
    workAttemptId: item.workAttemptId,
    requestId: item.requestId,
    availableActions: item.availableActions,
    // MobileのIDはbranded type。境界で `mobileAttentionResponseSchema` が検証するため、
    // ここでは形を合わせて一度だけcastする。
  } as unknown as MobileAttentionItem;
}

/** 一覧全体を射影する。件数は**判断単位**で数え、Desktopのbadgeと同じ意味にする。 */
export function projectAttentionQueue(input: {
  items: readonly AttentionItem[];
  taskVersions: ReadonlyMap<string, number>;
  working: number;
  queued: number;
  limit: number;
}): {
  attention: MobileAttentionItem[];
  counts: { needsYou: number; working: number; queued: number };
  truncated: boolean;
} {
  const truncated = input.items.length > input.limit;
  return {
    attention: input.items
      .slice(0, input.limit)
      .map((item) =>
        projectAttentionItem(
          item,
          item.taskId ? (input.taskVersions.get(item.taskId) ?? null) : null,
        ),
      ),
    counts: { needsYou: input.items.length, working: input.working, queued: input.queued },
    truncated,
  };
}
