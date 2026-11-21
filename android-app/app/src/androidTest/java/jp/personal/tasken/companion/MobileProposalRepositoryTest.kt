package jp.personal.tasken.companion

import android.content.Context
import androidx.room.Room
import androidx.test.core.app.ApplicationProvider
import androidx.test.ext.junit.runners.AndroidJUnit4
import java.io.IOException
import java.time.Duration
import java.time.Instant
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.async
import kotlinx.coroutines.delay
import kotlinx.coroutines.withTimeout
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.runBlocking
import kotlinx.serialization.json.Json
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith

@RunWith(AndroidJUnit4::class)
class MobileProposalRepositoryTest {
    private lateinit var context: Context
    private lateinit var database: MobileLocalDatabase
    private lateinit var dao: MobileLocalDao
    private lateinit var store: MobileGatewayConnectionStore

    @Before
    fun setUp() = runBlocking {
        context = ApplicationProvider.getApplicationContext()
        database = Room.inMemoryDatabaseBuilder(context, MobileLocalDatabase::class.java)
            .allowMainThreadQueries()
            .build()
        dao = database.mobileDao()
        dao.upsertSyncState(
            SyncStateEntity(
                serverId = "server-1",
                apiVersion = 1,
                schemaVersion = TASKEN_MOBILE_SCHEMA_VERSION,
                cursor = "cursor-1",
                lastSuccessfulSyncAt = "2026-08-22T01:00:00Z",
                lastAttemptAt = "2026-08-22T01:00:00Z",
                lastError = null,
            ),
        )
        store = MobileGatewayConnectionStore(context)
        store.clearToken()
        store.save("https://gateway.test", "p".repeat(43))
    }

    @After
    fun tearDown() {
        store.clearToken()
        database.close()
    }

    @Test
    fun proposalPreviewSurvivesOfflineAndAcceptUsesOnlineCanonicalDecision() = runBlocking {
        var online = true
        var decided = false
        var postedDecision: MobileTaskWorkProposalDecisionEnvelopeDto? = null
        val json = Json { ignoreUnknownKeys = false }
        val repository = repositoryWith { path, method, body ->
            if (!online) throw IOException("offline")
            when {
                path.startsWith("/v1/proposals?") -> GatewayHttpResponse(
                    200,
                    proposalsResponse(if (decided) emptyList() else listOf(proposalJson())),
                )
                path == "/v1/proposal-decisions" -> {
                    assertEquals("POST", method)
                    postedDecision = json.decodeFromString(requireNotNull(body))
                    decided = true
                    GatewayHttpResponse(200, decisionResponse(requireNotNull(postedDecision)))
                }
                path.startsWith("/v1/sync?") -> GatewayHttpResponse(200, syncResponse())
                // 答えは列の送り手が送る。その前に Desktop を確かめ、後で Theme を読む。
                path.startsWith("/v1/bootstrap") -> GatewayHttpResponse(200, bootstrapResponse())
                path.startsWith("/v1/themes") -> GatewayHttpResponse(404, "")
                else -> error("Unexpected Mobile Gateway path: $path")
            }
        }

        assertTrue(repository.refreshTaskWorkProposals())
        val remote = repository.observeCachedTaskWorkProposals().first().single()
        assertEquals("ProposalをAndroidで確認する", remote.taskTitle)
        assertEquals("report_done", remote.action)
        assertFalse(remote.stale)

        online = false
        assertFalse(repository.refreshTaskWorkProposals())
        assertEquals(remote, repository.observeCachedTaskWorkProposals().first().single())

        online = true
        val result = repository.reviewTaskWorkProposal(remote, "accept")
        assertQueued(remote.id, "accept", result)
        // 答えは列に積むだけで、送るのは列の送り手。
        assertEquals(null, postedDecision)
        repository.synchronizeIfPaired()
        assertEquals("accept", postedDecision?.decision)
        assertEquals(remote.id, postedDecision?.proposalId)
        assertEquals(remote.version, postedDecision?.expectedProposalVersion)
        assertEquals(remote.taskVersion, postedDecision?.expectedTaskVersion)
        assertTrue(repository.observeCachedTaskWorkProposals().first().isEmpty())
    }

    @Test
    fun staleProposalCanBeRejectedButCannotBeAccepted() = runBlocking {
        var postCount = 0
        val repository = repositoryWith { path, method, body ->
            when {
                path.startsWith("/v1/proposals?") -> GatewayHttpResponse(
                    200,
                    proposalsResponse(listOf(proposalJson(stale = true, expectedTaskVersion = 2))),
                )
                path == "/v1/proposal-decisions" -> {
                    postCount += 1
                    val envelope = Json.decodeFromString<MobileTaskWorkProposalDecisionEnvelopeDto>(requireNotNull(body))
                    assertEquals("POST", method)
                    assertEquals("reject", envelope.decision)
                    GatewayHttpResponse(200, decisionResponse(envelope))
                }
                path.startsWith("/v1/sync?") -> GatewayHttpResponse(200, syncResponse())
                // 答えは列の送り手が送る。その前に Desktop を確かめ、後で Theme を読む。
                path.startsWith("/v1/bootstrap") -> GatewayHttpResponse(200, bootstrapResponse())
                path.startsWith("/v1/themes") -> GatewayHttpResponse(404, "")
                else -> error("Unexpected Mobile Gateway path: $path")
            }
        }
        assertTrue(repository.refreshTaskWorkProposals())
        val proposal = repository.observeCachedTaskWorkProposals().first().single()

        val accepted = repository.reviewTaskWorkProposal(proposal, "accept")
        assertTrue(accepted is MobileProposalReviewResult.Conflict)
        assertEquals(0, postCount)

        val rejected = repository.reviewTaskWorkProposal(proposal, "reject")
        assertQueued(proposal.id, "reject", rejected)
        repository.synchronizeIfPaired()
        assertEquals(1, postCount)
    }

    // ---- 提案への答えは送信の列に積む（#816）。圏外でも消えず、つながったら同じ commandId で送る。
    //      PC で先に決まった・変わった提案への答えは「受け取られなかった」として残り、本人が閉じるまで消えない。 ----

    /** Desktop の側の提案。答えは commandId ごとに一度だけ決まる。 */
    private var desktopProposalVersion = 1
    private var desktopProposalOpen = true
    /** false の時は、PC で Task（と提案）が消されている（受け口は not_found を返す）。 */
    private var desktopTaskExists = true
    private var desktopOnline = false
    private var dropNextDecisionReceipt = false
    private val desktopDecisions = linkedMapOf<String, String>()
    private val postedDecisionBodies = mutableListOf<String>()
    private var scheduled = 0
    /** 取り消しの待ちが明けた後に送り手を起こすよう頼まれた答え（commandId と待ち）。 */
    private val scheduledAfter = mutableListOf<Pair<String, Duration>>()
    private val unscheduledAfter = mutableListOf<String>()
    /** 答えの POST を受けた時に呼ぶ（送っている最中を作る試験だけが使う）。 */
    private var decisionPostGate: (() -> Unit)? = null

    /**
     * [held] が false なら、答えを 5 秒前に積んだことにする（取り消しの待ちを越えた答えとして、すぐ送れる）。
     * true なら今の時刻で積み、待ちの間の答えになる（#774）。
     */
    private fun outboxRepository(held: Boolean = false): AndroidMobileTaskRepository = AndroidMobileTaskRepository(
        context = context,
        store = store,
        database = database,
        scheduleOutboxOnStart = false,
        httpClient = MobileGatewayHttpClient { _, path, method, body, _ ->
            if (!desktopOnline) throw IOException("offline")
            when {
                path.startsWith("/v1/bootstrap") -> GatewayHttpResponse(200, bootstrapResponse())
                path.startsWith("/v1/proposals?") -> GatewayHttpResponse(
                    200,
                    proposalsResponse(
                        if (desktopProposalOpen) listOf(proposalJson(version = desktopProposalVersion)) else emptyList(),
                    ),
                )
                path == "/v1/proposal-decisions" && method == "POST" -> desktopDecision(requireNotNull(body))
                path.startsWith("/v1/sync?") -> GatewayHttpResponse(200, syncResponse())
                else -> GatewayHttpResponse(404, "")
            }
        },
        scheduleOutbox = { scheduled += 1 },
        scheduleOutboxAfter = { key, delay -> scheduledAfter += key to delay },
        unscheduleOutboxAfter = { key -> unscheduledAfter += key },
        proposalDecisionNow = { if (held) Instant.now() else Instant.now().minusMillis(PROPOSAL_DECISION_HOLD_MILLIS) },
    )

    private fun desktopDecision(body: String): GatewayHttpResponse {
        decisionPostGate?.invoke()
        postedDecisionBodies += body
        val envelope = Json.decodeFromString<MobileTaskWorkProposalDecisionEnvelopeDto>(body)
        // 同じ命令の送り直しには、前の受領を返す（Core の commandId の扱い）。
        if (!desktopTaskExists) {
            return GatewayHttpResponse(
                404,
                """{"ok":false,"meta":${metaJson()},"error":{"code":"not_found","message":"not found","retryable":false}}""",
            )
        }
        if (envelope.commandId !in desktopDecisions) {
            if (!desktopProposalOpen || envelope.expectedProposalVersion != desktopProposalVersion) {
                return GatewayHttpResponse(
                    409,
                    """{"ok":false,"meta":${metaJson()},"error":{"code":"proposal_conflict",""" +
                        """"message":"Proposalまたは対象Taskが更新されています。再読み込みしてください。","retryable":false}}""",
                )
            }
            desktopDecisions[envelope.commandId] = envelope.decision
            desktopProposalOpen = false
        }
        if (dropNextDecisionReceipt) {
            dropNextDecisionReceipt = false
            throw IOException("receipt lost after the Desktop decided")
        }
        return GatewayHttpResponse(200, decisionResponse(envelope))
    }

    private suspend fun cachedProposal(repository: AndroidMobileTaskRepository): MobileTaskWorkProposal {
        desktopOnline = true
        assertTrue(repository.refreshTaskWorkProposals())
        return repository.observeCachedTaskWorkProposals().first().single()
    }

    @Test
    fun anOfflineAnswerStaysOnTheDeviceAndIsSentWhenTheDesktopIsReachable() = runBlocking {
        val repository = outboxRepository()
        val proposal = cachedProposal(repository)
        desktopOnline = false

        assertQueued(proposal.id, "accept", repository.reviewTaskWorkProposal(proposal, "accept"))
        val queued = repository.observeProposalDecisions().first().single()
        assertEquals(proposal.id to "accept", queued.proposalId to queued.decision)
        assertEquals(OutboxState.Pending, queued.state)
        assertEquals(1, dao.pendingCount())
        assertEquals(listOf(queued.commandId to Duration.ofMillis(PROPOSAL_DECISION_HOLD_MILLIS)), scheduledAfter)

        // つながらない間は、送ろうとしても端末に残る。
        assertFalse(repository.synchronizeIfPaired())
        assertEquals(queued.commandId, repository.observeProposalDecisions().first().single().commandId)
        assertTrue(desktopDecisions.isEmpty())

        desktopOnline = true
        repository.synchronizeIfPaired()

        assertEquals(mapOf(queued.commandId to "accept"), desktopDecisions)
        val sent = Json.decodeFromString<MobileTaskWorkProposalDecisionEnvelopeDto>(postedDecisionBodies.single())
        assertEquals(proposal.version, sent.expectedProposalVersion)
        assertEquals(proposal.taskVersion, sent.expectedTaskVersion)
        assertTrue(repository.observeProposalDecisions().first().isEmpty())
        assertTrue(repository.observeCachedTaskWorkProposals().first().isEmpty())
        assertEquals(0, dao.outboxCount())
    }

    @Test
    fun aResendAfterALostReceiptKeepsTheSameCommandAndDecidesOnce() = runBlocking {
        val repository = outboxRepository()
        val proposal = cachedProposal(repository)
        repository.reviewTaskWorkProposal(proposal, "reject")
        dropNextDecisionReceipt = true

        repository.synchronizeIfPaired()
        // Desktop は決めたが、応答が届かなかった。答えは列に残る。
        assertEquals(1, desktopDecisions.size)
        assertEquals(OutboxState.RetryWait, repository.observeProposalDecisions().first().single().state)

        repository.synchronizeIfPaired()

        assertEquals(2, postedDecisionBodies.size)
        assertEquals(postedDecisionBodies[0], postedDecisionBodies[1])
        assertEquals(1, desktopDecisions.size)
        assertTrue(repository.observeProposalDecisions().first().isEmpty())
        assertEquals(0, dao.outboxCount())
    }

    @Test
    fun anAnswerToAProposalAlreadyDecidedOnThePcStaysReturnedUntilClosed() = runBlocking {
        val repository = outboxRepository()
        val proposal = cachedProposal(repository)
        desktopOnline = false
        repository.reviewTaskWorkProposal(proposal, "accept")
        val queued = repository.observeProposalDecisions().first().single()
        // 送る前の答えは閉じられない（黙って落とさない）。
        assertFalse(repository.discardProposalDecision(queued.commandId))

        // 圏外の間に、PC で先に決まった。
        desktopProposalOpen = false
        desktopOnline = true
        repository.synchronizeIfPaired()

        val returned = repository.observeProposalDecisions().first().single()
        assertEquals(queued.commandId, returned.commandId)
        assertTrue(returned.returned)
        assertEquals(PROPOSAL_DECISION_CONFLICT, returned.reason)
        assertEquals(0, dao.pendingCount())
        // 提案は読み直しで消え、答えだけが Task の詳細に残る。
        assertTrue(repository.observeCachedTaskWorkProposals().first().isEmpty())
        assertEquals(proposal.taskId, returned.taskId)

        // 版が古いので自動では送り直さない。
        repository.synchronizeIfPaired()
        assertEquals(1, postedDecisionBodies.size)
        assertTrue(desktopDecisions.isEmpty())

        assertTrue(repository.discardProposalDecision(returned.commandId))
        assertEquals(0, dao.outboxCount())
    }

    @Test
    fun answeringAChangedProposalAgainReplacesTheReturnedAnswer() = runBlocking {
        val repository = outboxRepository()
        val proposal = cachedProposal(repository)
        desktopOnline = false
        repository.reviewTaskWorkProposal(proposal, "accept")

        // 圏外の間に、提案が新しい版になった。
        desktopProposalVersion = 2
        desktopOnline = true
        repository.synchronizeIfPaired()
        val returned = repository.observeProposalDecisions().first().single()
        assertTrue(returned.returned)
        val renewed = repository.observeCachedTaskWorkProposals().first().single()
        assertEquals(2, renewed.version)

        assertQueued(renewed.id, "accept", repository.reviewTaskWorkProposal(renewed, "accept"))
        val replacing = repository.observeProposalDecisions().first().single()
        assertFalse(replacing.returned)
        assertTrue(replacing.commandId != returned.commandId)

        repository.synchronizeIfPaired()
        assertEquals(listOf("accept"), desktopDecisions.values.toList())
        assertTrue(repository.observeProposalDecisions().first().isEmpty())
        assertEquals(0, dao.outboxCount())
    }

    /**
     * 答えを積んだ後に PC で Task が消された。答えは「確かめられなかった」として残り（届かなかったとは言わない）、
     * Task に依らずに閉じられ、閉じれば別の PC へのつなぎ直しを止める行が残らない。
     */
    @Test
    fun anAnswerForATaskDeletedOnThePcCanBeClosedWithoutTheTask() = runBlocking {
        val repository = outboxRepository()
        val proposal = cachedProposal(repository)
        desktopOnline = false
        repository.reviewTaskWorkProposal(proposal, "accept")

        desktopTaskExists = false
        desktopProposalOpen = false
        desktopOnline = true
        repository.synchronizeIfPaired()

        val returned = repository.observeProposalDecisions().first().single()
        assertTrue(returned.returned)
        assertEquals("not_found", returned.code)
        assertEquals(PROPOSAL_DECISION_GONE, returned.reason)
        assertEquals("「採る」を確かめられませんでした", returned.returnedTitle())
        assertEquals(1, dao.incompatibleOutboxCount("server-2"))

        assertTrue(repository.discardProposalDecision(returned.commandId))
        assertEquals(0, dao.incompatibleOutboxCount("server-2"))
    }

    /** 「閉じる」と答え直しがほぼ同時でも、置き換える前の答えがもう無いことで落ちない。 */
    @Test
    fun answeringAgainAfterTheReturnedAnswerWasClosedDoesNotThrow() = runBlocking {
        val repository = outboxRepository()
        val proposal = cachedProposal(repository)
        desktopOnline = false
        repository.reviewTaskWorkProposal(proposal, "accept")
        val first = requireNotNull(dao.outbox(repository.observeProposalDecisions().first().single().commandId))
        dao.markRejected(first.commandId, "refused")
        assertEquals(1, dao.discardReturnedProposalDecision(first.commandId))

        dao.enqueueProposalDecision(first.copy(commandId = "replacement", state = OutboxState.Pending), replacing = listOf(first.commandId))

        assertEquals(listOf("replacement"), dao.proposalDecisions().map { it.commandId })
    }

    // ---- 積んでから 5 秒は送らず、その間の「取り消す」で何も送らずに消せる（#774）。 ----

    /**
     * 答えごとの待ち明けの起こしは、ほかの送り手が送っている最中にも起きる。後から起きた送り手は、途中で止まった
     * 命令を戻す前に先の送り手が終わるのを待ち、送っている最中の答えを戻して二度送らない。
     */
    @Test
    fun aSenderWakingWhileAnotherIsSendingWaitsInsteadOfResendingIt() = runBlocking {
        val first = outboxRepository()
        val proposal = cachedProposal(first)
        first.reviewTaskWorkProposal(proposal, "accept")
        val commandId = first.observeProposalDecisions().first().single().commandId
        val posting = CountDownLatch(1)
        val release = CountDownLatch(1)
        decisionPostGate = {
            posting.countDown()
            release.await(10, TimeUnit.SECONDS)
        }

        withTimeout(20_000) {
            val firstDrain = async(Dispatchers.IO) { first.synchronizeIfPaired() }
            assertTrue(posting.await(10, TimeUnit.SECONDS))
            val second = outboxRepository()
            val secondDrain = async(Dispatchers.IO) {
                second.recoverInterruptedOutbox()
                second.synchronizeIfPaired()
            }
            delay(500)
            // 後の送り手は錠で待っていて、送っている最中の答えを戻していない。
            assertEquals(OutboxState.Sending, dao.outbox(commandId)?.state)
            release.countDown()
            firstDrain.await()
            secondDrain.await()
        }

        assertEquals(1, postedDecisionBodies.size)
        assertEquals(mapOf(commandId to "accept"), desktopDecisions)
        assertEquals(0, dao.outboxCount())
    }

    @Test
    fun aJustPressedAnswerIsNotSentAndAWakeIsScheduledForWhenTheWaitEnds() = runBlocking {
        val repository = outboxRepository(held = true)
        val proposal = cachedProposal(repository)

        assertQueued(proposal.id, "accept", repository.reviewTaskWorkProposal(proposal, "accept"))
        val queued = repository.observeProposalDecisions().first().single()
        assertEquals(listOf(queued.commandId to Duration.ofMillis(PROPOSAL_DECISION_HOLD_MILLIS)), scheduledAfter)

        // つながっていても、待ちの間は送り手が取らない。
        repository.synchronizeIfPaired()
        assertTrue(postedDecisionBodies.isEmpty())
        val waiting = requireNotNull(dao.outbox(queued.commandId))
        assertEquals(OutboxState.Pending to 0, waiting.state to waiting.attemptCount)
    }

    @Test
    fun undoWithinTheWaitRemovesTheAnswerAndNothingIsSent() = runBlocking {
        val repository = outboxRepository(held = true)
        val proposal = cachedProposal(repository)
        repository.reviewTaskWorkProposal(proposal, "reject")
        val queued = repository.observeProposalDecisions().first().single()

        assertTrue(repository.undoProposalDecision(queued.commandId))
        assertEquals(listOf(queued.commandId), unscheduledAfter)
        repository.synchronizeIfPaired()

        assertTrue(postedDecisionBodies.isEmpty())
        assertTrue(desktopDecisions.isEmpty())
        assertEquals(0, dao.outboxCount())
        // 提案は未決のまま残り、もう一度答えられる。
        assertEquals(proposal.id, repository.observeCachedTaskWorkProposals().first().single().id)
    }

    @Test
    fun undoAfterTheSenderTookTheAnswerFailsAndKeepsIt() = runBlocking {
        val repository = outboxRepository()
        val proposal = cachedProposal(repository)
        repository.reviewTaskWorkProposal(proposal, "accept")
        val queued = repository.observeProposalDecisions().first().single()
        // Desktop は決めたが応答を失った。答えは送り直しを待つ。
        dropNextDecisionReceipt = true
        repository.synchronizeIfPaired()
        assertEquals(OutboxState.RetryWait, repository.observeProposalDecisions().first().single().state)

        assertFalse(repository.undoProposalDecision(queued.commandId))
        assertTrue(unscheduledAfter.isEmpty())
        assertEquals(queued.commandId, repository.observeProposalDecisions().first().single().commandId)

        repository.synchronizeIfPaired()
        assertEquals(1, desktopDecisions.size)
        assertEquals(0, dao.outboxCount())
    }

    private fun metaJson(): String =
        """{"apiVersion":1,"schemaVersion":$TASKEN_MOBILE_SCHEMA_VERSION,"serverId":"server-1",""" +
            """"serverRevision":43,"generatedAt":"2026-08-22T02:01:00Z","truncated":false}"""

    private fun bootstrapResponse(): String =
        """{"ok":true,"meta":${metaJson()},"data":{"tasks":[],"nextCursor":"cursor-1","hasMore":false}}"""

    private fun repositoryWith(
        response: (path: String, method: String, body: String?) -> GatewayHttpResponse,
    ): AndroidMobileTaskRepository = AndroidMobileTaskRepository(
        context = context,
        store = store,
        database = database,
        scheduleOutboxOnStart = false,
        httpClient = MobileGatewayHttpClient { _, path, method, body, token ->
            assertEquals("p".repeat(43), token)
            response(path, method, body)
        },
        // 答えは取り消しの待ちを越えた物として積み、試験の中の送り手ですぐ送る。
        scheduleOutboxAfter = { _, _ -> },
        unscheduleOutboxAfter = {},
        proposalDecisionNow = { Instant.now().minusMillis(PROPOSAL_DECISION_HOLD_MILLIS) },
    )

    private fun assertQueued(proposalId: String, decision: String, result: MobileProposalReviewResult) {
        val queued = result as MobileProposalReviewResult.Queued
        assertEquals(proposalId to decision, queued.proposalId to queued.decision)
    }

    private fun proposalsResponse(proposals: List<String>): String =
        """
        {
          "ok": true,
          "meta": {
            "apiVersion": 1,
            "schemaVersion": 7,
            "serverId": "server-1",
            "serverRevision": 42,
            "generatedAt": "2026-08-22T02:00:00Z",
            "truncated": false
          },
          "data": { "proposals": [${proposals.joinToString(",")}] }
        }
        """.trimIndent()

    private fun proposalJson(stale: Boolean = false, expectedTaskVersion: Int = 3, version: Int = 1): String =
        """
        {
          "id": "11111111-1111-5111-8111-111111111111",
          "version": $version,
          "status": "pending",
          "task": {
            "id": "task-proposal-review",
            "version": 3,
            "title": "ProposalをAndroidで確認する",
            "themeId": "theme-personal-default",
            "workState": "in_progress"
          },
          "action": "report_done",
          "caller": "Hermes",
          "sourceApp": "hermes-discord",
          "receivedAt": "2026-08-22T01:59:00Z",
          "expectedTaskVersion": $expectedTaskVersion,
          "stale": $stale,
          "executorLabel": "Hermes",
          "startedAt": "2026-08-22T01:00:00Z",
          "reportedAt": "2026-08-22T01:50:00Z",
          "summary": "Androidで確認してください。",
          "completedItems": ["Gateway contract"],
          "changedOrCreatedItems": ["MobileProposalDto.kt"],
          "verification": ["instrumentation"],
          "remainingWork": ["Fold7 signoff"],
          "externalReferences": []
        }
        """.trimIndent()

    private fun decisionResponse(envelope: MobileTaskWorkProposalDecisionEnvelopeDto): String =
        """
        {
          "ok": true,
          "meta": {
            "apiVersion": 1,
            "schemaVersion": 7,
            "serverId": "server-1",
            "serverRevision": 43,
            "generatedAt": "2026-08-22T02:01:00Z",
            "truncated": false
          },
          "data": {
            "commandId": "${envelope.commandId}",
            "commandStatus": "applied",
            "proposalId": "${envelope.proposalId}",
            "proposalStatus": "${if (envelope.decision == "accept") "accepted" else "rejected"}",
            "decision": "${envelope.decision}",
            "taskId": "${envelope.taskId}",
            "taskVersion": 4
          }
        }
        """.trimIndent()

    private fun syncResponse(): String =
        """
        {
          "ok": true,
          "meta": {
            "apiVersion": 1,
            "schemaVersion": 7,
            "serverId": "server-1",
            "serverRevision": 43,
            "generatedAt": "2026-08-22T02:01:00Z",
            "truncated": false
          },
          "data": { "changes": [], "nextCursor": "cursor-1", "hasMore": false }
        }
        """.trimIndent()
}
