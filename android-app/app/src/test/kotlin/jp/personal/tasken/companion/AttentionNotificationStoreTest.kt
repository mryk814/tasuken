package jp.personal.tasken.companion

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * 要対応の新着通知の規則（#601）。
 *
 * 通知の候補は質問・判断依頼・成果確認だけで、変更案と不明な種別は候補にしない。
 * 同じ判断の再送では新規として扱わない（一度記録したIDは返さない）。
 */
class AttentionNotificationStoreTest {
    @Test
    fun onlyQuestionsDecisionsAndReviewsAreNotificationCandidates() {
        assertTrue(AttentionNotificationStore.isNotificationCandidate(AttentionKind.AnswerRequest))
        assertTrue(AttentionNotificationStore.isNotificationCandidate(AttentionKind.DecisionRequest))
        assertTrue(AttentionNotificationStore.isNotificationCandidate(AttentionKind.ReviewReport))
        assertFalse(AttentionNotificationStore.isNotificationCandidate(AttentionKind.ProposalPending))
        assertFalse(AttentionNotificationStore.isNotificationCandidate(AttentionKind.Unknown))
    }

    @Test
    fun newArrivalsKeepTheDesktopOrderAndIgnoreKnownAndNonCandidateRows() {
        val rows = listOf(
            row("task-work:review:1", AttentionKind.ReviewReport),
            row("proposal:proposal-1", AttentionKind.ProposalPending),
            row("task-work:request:1", AttentionKind.AnswerRequest),
            row("task-work:request:2", AttentionKind.AnswerRequest),
        )

        val arrivals = AttentionNotificationStore.newArrivals(
            rows = rows,
            knownIds = setOf("task-work:request:1"),
        )

        // Desktopが返した順のまま。既知の判断と候補外（変更案）は含めない。
        assertEquals(
            listOf("task-work:review:1", "task-work:request:2"),
            arrivals.map { it.attentionId },
        )
    }

    @Test
    fun aResentJudgementIsNotANewArrival() {
        val rows = listOf(row("task-work:request:1", AttentionKind.AnswerRequest))

        assertEquals(
            emptyList<String>(),
            AttentionNotificationStore.newArrivals(rows, knownIds = setOf("task-work:request:1"))
                .map { it.attentionId },
        )
        // いま一覧にある判断で記録を置き換えるので、消えた判断は次に現れたとき新規になる。
        assertEquals(
            listOf("task-work:request:1"),
            AttentionNotificationStore.newArrivals(rows, knownIds = setOf("task-work:request:9"))
                .map { it.attentionId },
        )
    }

    private fun row(attentionId: String, kind: AttentionKind) = AttentionRow(
        attentionId = attentionId,
        kind = kind,
        taskId = "task-viscosity",
        taskTitle = "粘度測定の条件を決める",
        taskVersion = 12,
        headline = "見出し",
        summary = "要旨",
        questionOrAction = "質問",
        agentLabel = "Codex",
        requestId = "33333333-3333-4333-8333-333333333333",
        canReply = kind == AttentionKind.AnswerRequest,
    )
}
