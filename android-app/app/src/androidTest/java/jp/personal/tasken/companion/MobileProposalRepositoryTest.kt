package jp.personal.tasken.companion

import android.content.Context
import androidx.room.Room
import androidx.test.core.app.ApplicationProvider
import androidx.test.ext.junit.runners.AndroidJUnit4
import java.io.IOException
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
        assertTrue(result is MobileProposalReviewResult.Applied)
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
                else -> error("Unexpected Mobile Gateway path: $path")
            }
        }
        assertTrue(repository.refreshTaskWorkProposals())
        val proposal = repository.observeCachedTaskWorkProposals().first().single()

        val accepted = repository.reviewTaskWorkProposal(proposal, "accept")
        assertTrue(accepted is MobileProposalReviewResult.Conflict)
        assertEquals(0, postCount)

        val rejected = repository.reviewTaskWorkProposal(proposal, "reject")
        assertTrue(rejected is MobileProposalReviewResult.Applied)
        assertEquals(1, postCount)
    }

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
    )

    private fun proposalsResponse(proposals: List<String>): String =
        """
        {
          "ok": true,
          "meta": {
            "apiVersion": 1,
            "schemaVersion": 6,
            "serverId": "server-1",
            "serverRevision": 42,
            "generatedAt": "2026-08-22T02:00:00Z",
            "truncated": false
          },
          "data": { "proposals": [${proposals.joinToString(",")}] }
        }
        """.trimIndent()

    private fun proposalJson(stale: Boolean = false, expectedTaskVersion: Int = 3): String =
        """
        {
          "id": "11111111-1111-5111-8111-111111111111",
          "version": 1,
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
            "schemaVersion": 6,
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
            "schemaVersion": 6,
            "serverId": "server-1",
            "serverRevision": 43,
            "generatedAt": "2026-08-22T02:01:00Z",
            "truncated": false
          },
          "data": { "changes": [], "nextCursor": "cursor-1", "hasMore": false }
        }
        """.trimIndent()
}
