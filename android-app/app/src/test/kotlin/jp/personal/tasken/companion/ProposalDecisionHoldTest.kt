package jp.personal.tasken.companion

import java.time.Instant
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * 提案への答えの取り消しの待ち（#774）。答えは押した時に送信の列に積み、積んでから 5 秒は列の送り手が取らない。
 * その間に帯の「取り消す」を押せば、一度も送っていない行を消せる（消す側は MobileProposalRepositoryTest）。
 */
class ProposalDecisionHoldTest {
    private val pressedAt: Instant = Instant.parse("2026-11-22T01:00:00Z")

    private fun decision(
        id: String = "decision-1",
        createdAt: Instant = pressedAt,
        state: String = OutboxState.Pending,
        attemptCount: Int = 0,
    ) = OutboxCommandEntity(
        commandId = id, idempotencyKey = id, requestId = "request-$id", clientDeviceId = "device",
        issuedAt = createdAt.toString(), commandName = PROPOSAL_DECISION_COMMAND, envelopeJson = "",
        serverId = "server-1", state = state, attemptCount = attemptCount, createdAt = createdAt.toString(),
        lastAttemptAt = if (attemptCount == 0) null else createdAt.plusSeconds(10).toString(), lastError = null,
    )

    private fun taskEdit(id: String, createdAt: Instant) = OutboxCommandEntity(
        commandId = id, idempotencyKey = id, requestId = "request-$id", clientDeviceId = "device",
        issuedAt = createdAt.toString(), commandName = "UpdateTask", envelopeJson = "", serverId = "server-1",
        state = OutboxState.Pending, attemptCount = 0, createdAt = createdAt.toString(), lastAttemptAt = null,
        lastError = null, taskId = "task-1",
    )

    @Test
    fun anAnswerIsNotTakenWithinFiveSecondsOfThePress() {
        val held = decision()

        assertNull(nextSendableCommand(listOf(held), "server-1", now = pressedAt))
        assertNull(nextSendableCommand(listOf(held), "server-1", now = pressedAt.plusMillis(PROPOSAL_DECISION_HOLD_MILLIS - 1)))
    }

    @Test
    fun anAnswerIsTakenOnceTheFiveSecondsHavePassed() {
        val held = decision()

        assertEquals(held, nextSendableCommand(listOf(held), "server-1", now = pressedAt.plusMillis(PROPOSAL_DECISION_HOLD_MILLIS)))
    }

    @Test
    fun aWaitingAnswerDoesNotHoldBackOtherCommands() {
        // 先に積んだ答えが待っている間も、後から積んだ Task の変更は送る。
        val held = decision(createdAt = pressedAt)
        val edit = taskEdit("edit-1", pressedAt.plusSeconds(1))

        assertEquals(edit, nextSendableCommand(listOf(held, edit), "server-1", now = pressedAt.plusSeconds(2)))
    }

    @Test
    fun onlyANeverTriedAnswerWaits() {
        // 一度送った答え（応答を失って送り直しを待つ物）は、もう取り消せないので待たせない。
        val retried = decision(state = OutboxState.RetryWait, attemptCount = 1)

        assertFalse(retried.isHeldProposalDecision(pressedAt))
        assertTrue(decision().isHeldProposalDecision(pressedAt))
        assertFalse(taskEdit("edit-1", pressedAt).isHeldProposalDecision(pressedAt))
    }

    private fun queued(commandId: String, proposalId: String, state: String = OutboxState.Pending) = MobileProposalDecision(
        commandId = commandId,
        proposalId = proposalId,
        taskId = "task-1",
        decision = "accept",
        state = state,
        reason = null,
    )

    @Test
    fun aQueuedAnswerTakesItsCardOutAndAnUndoneOneBringsItBack() {
        val decided = decidedProposals(emptyMap(), listOf(queued("c1", "p1")), setOf("p1"), emptySet())
        assertEquals(mapOf("p1" to DecidedProposal("c1", "accept")), decided)

        // 取り消した後に、まだ消える前の列の知らせが届いても、カードは戻ったまま。
        assertEquals(emptyMap<String, DecidedProposal>(), decidedProposals(decided, listOf(queued("c1", "p1")), setOf("p1"), setOf("c1")))
        assertEquals(emptyMap<String, DecidedProposal>(), decidedProposals(decided, emptyList(), setOf("p1"), setOf("c1")))
    }

    @Test
    fun aDeliveredAnswerKeepsItsCardOutUntilTheProposalIsGone() {
        val decided = decidedProposals(emptyMap(), listOf(queued("c1", "p1")), setOf("p1"), emptySet())

        // 届いて列から消えた。写しから提案が消える知らせは、別に届く。
        val delivered = decidedProposals(decided, emptyList(), setOf("p1"), emptySet())
        assertEquals(decided, delivered)
        assertEquals(emptyMap<String, DecidedProposal>(), decidedProposals(delivered, emptyList(), emptySet(), emptySet()))
    }

    @Test
    fun aReturnedAnswerBringsTheCardBack() {
        val decided = decidedProposals(emptyMap(), listOf(queued("c1", "p1")), setOf("p1"), emptySet())

        val returned = decidedProposals(decided, listOf(queued("c1", "p1", OutboxState.Rejected)), setOf("p1"), emptySet())
        assertEquals(emptyMap<String, DecidedProposal>(), returned)
    }
}
