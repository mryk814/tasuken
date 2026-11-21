package jp.personal.tasken.companion

import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.CoroutineDispatcher
import kotlinx.coroutines.ExecutorCoroutineDispatcher
import kotlinx.coroutines.asCoroutineDispatcher
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.withTimeout
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import java.util.Collections
import java.util.concurrent.Executors

/**
 * 採る・見送るを持ってから押した順に 1 件ずつ送る（#774）。持つ時間は試験では短くする。
 * 同じ試験を、複数のスレッド（Dispatchers.Default）と、画面と同じ 1 本のスレッドの両方で流す
 * （ProposalDecisionHoldSingleThreadTest）。
 */
open class ProposalDecisionHoldTest {
    private val holdMillis = 150L

    protected open fun dispatcher(): CoroutineDispatcher = Dispatchers.Default

    private fun <T> withHold(
        online: Flow<Boolean> = MutableStateFlow(true),
        block: suspend (ProposalDecisionHold, MutableList<String>) -> T,
    ): T = runBlocking {
        val dispatcher = dispatcher()
        val scope = CoroutineScope(SupervisorJob() + dispatcher)
        val notSent = Collections.synchronizedList(mutableListOf<String>())
        try {
            val hold = ProposalDecisionHold(
                scope = scope,
                online = online,
                onNotSent = { held, message -> notSent += "${held.proposalId}:$message" },
                holdMillis = holdMillis,
            )
            block(hold, notSent)
        } finally {
            scope.cancel()
            if (dispatcher !== Dispatchers.Default) (dispatcher as? ExecutorCoroutineDispatcher)?.close()
        }
    }

    private suspend fun eventually(check: () -> Boolean) {
        withTimeout(5_000) { while (!check()) delay(10) }
    }

    @Test
    fun undoWithinTheHoldSendsNothingAndTheCardComesBack() = withHold { hold, _ ->
        val sent = Collections.synchronizedList(mutableListOf<String>())
        val held = hold.hold("p1", "accept") { sent += "p1"; true }!!
        assertEquals(mapOf("p1" to "accept"), hold.decided.value)
        assertEquals(held, hold.band.value)
        delay(holdMillis / 3)
        assertTrue(hold.undo(held.key))
        delay(holdMillis * 3)
        assertEquals(emptyList<String>(), sent)
        assertEquals(emptyMap<String, String>(), hold.decided.value)
        assertNull(hold.band.value)
    }

    @Test
    fun decisionsAreSentInPressedOrderOneAtATimeEvenWhenTheAnswerIsSlow() = withHold { hold, _ ->
        val order = Collections.synchronizedList(mutableListOf<String>())
        val firstAnswer = CompletableDeferred<Unit>()
        hold.hold("p1", "accept") { order += "p1"; firstAnswer.await(); true }
        delay(20)
        hold.hold("p2", "reject") { order += "p2"; true }
        eventually { order.size == 1 }
        // 前の答えが来るまで、次は送らない。
        delay(holdMillis * 3)
        assertEquals(listOf("p1"), order)
        val first = hold.held.value.first { it.proposalId == "p1" }
        assertFalse("送っている最中は取り消せない", hold.undo(first.key))
        firstAnswer.complete(Unit)
        eventually { hold.held.value.isEmpty() }
        assertEquals(listOf("p1", "p2"), order)
        // 届いた物は一覧から外したまま。
        assertEquals(mapOf("p1" to "accept", "p2" to "reject"), hold.decided.value)
    }

    @Test
    fun aRefusedDecisionComesBackWithoutBlockingTheNext() = withHold { hold, _ ->
        val order = Collections.synchronizedList(mutableListOf<String>())
        hold.hold("p1", "accept") { order += "p1"; false }
        hold.hold("p2", "accept") { order += "p2"; true }
        eventually { hold.held.value.isEmpty() }
        assertEquals(listOf("p1", "p2"), order)
        assertEquals(mapOf("p2" to "accept"), hold.decided.value)
    }

    @Test
    fun losingTheConnectionDuringTheHoldSendsNothingAndSaysSo() {
        val online = MutableStateFlow(true)
        withHold(online) { hold, notSent ->
            val sent = Collections.synchronizedList(mutableListOf<String>())
            hold.hold("p1", "reject") { sent += "p1"; true }
            delay(holdMillis / 3)
            online.value = false
            eventually { notSent.isNotEmpty() }
            delay(holdMillis * 2)
            assertEquals(emptyList<String>(), sent)
            assertEquals(emptyMap<String, String>(), hold.decided.value)
            assertTrue(notSent.single().startsWith("p1:つながりが切れた"))
        }
    }

    @Test
    fun theSameProposalCannotBeDecidedTwiceWhileHeld() = withHold { hold, _ ->
        assertTrue(hold.hold("p1", "accept") { true } != null)
        assertNull(hold.hold("p1", "reject") { true })
        eventually { hold.held.value.isEmpty() }
        assertEquals(mapOf("p1" to "accept"), hold.decided.value)
    }

    @Test
    fun aReloadThatBrieflyLooksOfflineDoesNotDropTheDecision() {
        val online = MutableStateFlow(true)
        val refreshing = MutableStateFlow(false)
        withHold(decisionConnection(online, refreshing)) { hold, notSent ->
            val sent = Collections.synchronizedList(mutableListOf<String>())
            hold.hold("p1", "accept") { sent += "p1"; true }
            delay(holdMillis / 3)
            // 引いて更新・回転・画面に戻った時の読み直し（TodayViewModel.refreshProposals の順）。
            refreshing.value = true
            online.value = false
            delay(holdMillis / 3)
            online.value = true
            refreshing.value = false
            eventually { hold.held.value.isEmpty() }
            assertEquals(listOf("p1"), sent)
            assertEquals(emptyList<String>(), notSent)
        }
    }

    @Test
    fun aReloadThatFailsIsALostConnection() {
        val online = MutableStateFlow(true)
        val refreshing = MutableStateFlow(false)
        withHold(decisionConnection(online, refreshing)) { hold, notSent ->
            val sent = Collections.synchronizedList(mutableListOf<String>())
            hold.hold("p1", "accept") { sent += "p1"; true }
            refreshing.value = true
            online.value = false
            delay(holdMillis / 3)
            refreshing.value = false
            eventually { notSent.isNotEmpty() }
            assertEquals(emptyList<String>(), sent)
        }
    }
}

/** 同じ試験を、画面（Main）と同じく 1 本のスレッドで流す。 */
class ProposalDecisionHoldSingleThreadTest : ProposalDecisionHoldTest() {
    override fun dispatcher(): CoroutineDispatcher = Executors.newSingleThreadExecutor().asCoroutineDispatcher()
}
