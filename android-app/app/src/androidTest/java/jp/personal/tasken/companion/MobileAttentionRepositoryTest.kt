package jp.personal.tasken.companion

import android.content.Context
import androidx.room.Room
import androidx.test.core.app.ApplicationProvider
import androidx.test.ext.junit.runners.AndroidJUnit4
import java.io.IOException
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.runBlocking
import kotlinx.serialization.decodeFromString
import kotlinx.serialization.json.Json
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith

/**
 * 要対応の取得と回答の往復（#601）。
 *
 * Desktopが返した一覧をそのまま保存し、回答は同じcommandIdで再送する。
 * 取得できていない状態（counts = null）と0件を混同しないことも確認する。
 */
@RunWith(AndroidJUnit4::class)
class MobileAttentionRepositoryTest {
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
                lastSuccessfulSyncAt = "2026-09-20T00:00:00Z",
                lastAttemptAt = "2026-09-20T00:00:00Z",
                lastError = null,
            ),
        )
        store = MobileGatewayConnectionStore(context)
        store.clearToken()
        store.save("https://gateway.test", "w".repeat(43), setOf("mobile:read", "mobile:human-review"))
    }

    @After
    fun tearDown() {
        store.clearToken()
        database.close()
    }

    private fun repository(httpClient: MobileGatewayHttpClient) = AndroidMobileTaskRepository(
        context = context,
        store = store,
        database = database,
        scheduleOutboxOnStart = false,
        httpClient = httpClient,
    )

    @Test
    fun cachesTheAttentionQueueAndKeepsTheDesktopOrder() = runBlocking {
        val repository = repository(
            MobileGatewayHttpClient { _, path, method, _, token ->
                assertEquals("w".repeat(43), token)
                assertEquals("GET", method)
                assertTrue(path.startsWith("/v1/attention?"))
                GatewayHttpResponse(200, attentionResponse(fullQueue(), needsYou = 3))
            },
        )

        assertTrue(repository.refreshAttention())
        val snapshot = repository.observeCachedAttention().first()

        assertEquals(3, snapshot.items.size)
        assertEquals(3, snapshot.counts?.needsYou)
        assertEquals(1, snapshot.counts?.working)
        assertEquals(1, snapshot.counts?.queued)
        assertEquals(false, snapshot.truncated)
        // Desktopの並び（回答待ち → 成果確認 → 変更案）をそのまま使う。
        assertEquals(
            listOf(AttentionKind.AnswerRequest, AttentionKind.ReviewReport, AttentionKind.ProposalPending),
            snapshot.items.map { it.kind },
        )
        val question = snapshot.items.first()
        assertEquals("33333333-3333-4333-8333-333333333333", question.requestId)
        assertEquals(12L, question.taskVersion)
        assertTrue(question.canReply)
    }

    @Test
    fun anUnknownKindIsStillStoredAndShown() = runBlocking {
        val repository = repository(
            MobileGatewayHttpClient { _, _, _, _, _ ->
                GatewayHttpResponse(
                    200,
                    attentionResponse(
                        listOf(questionItem(kind = "something_new"), reviewItem(), proposalItem()),
                        needsYou = 3,
                    ),
                )
            },
        )

        assertTrue(repository.refreshAttention())
        val snapshot = repository.observeCachedAttention().first()

        // 未知の種類でも要対応から黙って消さない。回答だけをさせない。
        assertEquals(AttentionKind.Unknown, snapshot.items.first().kind)
        assertEquals(false, snapshot.items.first().canReply)
        assertEquals(3, snapshot.items.size)
    }

    @Test
    fun responseLossRetryKeepsTheSameReplyAndRemovesTheAnsweredItem() = runBlocking {
        val requestBodies = mutableListOf<String>()
        var attempts = 0
        var replied = false
        val repository = repository(
            MobileGatewayHttpClient { _, path, method, body, _ ->
                when {
                    path.startsWith("/v1/attention?") ->
                        GatewayHttpResponse(
                            200,
                            if (replied) {
                                attentionResponse(listOf(reviewItem(), proposalItem()), needsYou = 2)
                            } else {
                                attentionResponse(fullQueue(), needsYou = 3)
                            },
                        )
                    path == "/v1/agent-replies" -> {
                        assertEquals("POST", method)
                        val requestBody = requireNotNull(body)
                        requestBodies += requestBody
                        attempts += 1
                        // 1回目は応答を失う。2回目は同じ内容なので同じcommandIdになる。
                        if (attempts == 1) throw IOException("response lost")
                        val envelope = Json.decodeFromString<MobileAgentReplyEnvelopeDto>(requestBody)
                        replied = true
                        GatewayHttpResponse(200, replyResponse(envelope.commandId))
                    }
                    else -> error("Unexpected Mobile Gateway path: $path")
                }
            },
        )
        assertTrue(repository.refreshAttention())
        val question = repository.observeCachedAttention().first().items.first { it.canReply }

        val lost = repository.replyToAgent(question, "choice-25c", "  25℃で進めてください。  ")

        assertTrue(lost is MobileAgentReplyResult.Unavailable)
        val lostCommandId =
            Json.decodeFromString<MobileAgentReplyEnvelopeDto>(requestBodies.first()).commandId
        // 送ったかどうか分からない回答は、正式成功として扱わず保留のまま残す。
        assertNotNull(dao.pendingAgentReply(lostCommandId))
        assertNotNull(dao.attention(question.attentionId, "server-1"))

        val applied = repository.replyToAgent(question, "choice-25c", "25℃で進めてください。")

        assertTrue(applied is MobileAgentReplyResult.Applied)
        // 表示状態はDesktopの導出結果。Android側で作り直さない。
        assertEquals("answered_resume_waiting", (applied as MobileAgentReplyResult.Applied).displayState)
        assertEquals(2, requestBodies.size)
        assertEquals(requestBodies.first(), requestBodies.last())
        assertNull(dao.pendingAgentReply(lostCommandId))
        // 回答済みの判断はDesktopが確定した事実なので、ローカルからも外れる。
        assertNull(dao.attention(question.attentionId, "server-1"))
        assertEquals(2, dao.attentionState("server-1")?.needsYou)
        // 取り直した一覧にも回答済みの判断は無い。
        val reloaded = repository.observeCachedAttention().first()
        assertEquals(2, reloaded.items.size)
        assertTrue(reloaded.items.none { it.attentionId == question.attentionId })
    }

    @Test
    fun aConflictIsNotReportedAsSuccessAndConvergesWithTheDesktop() = runBlocking {
        var attentionReads = 0
        val repository = repository(
            MobileGatewayHttpClient { _, path, _, _, _ ->
                when {
                    path.startsWith("/v1/attention?") -> {
                        attentionReads += 1
                        GatewayHttpResponse(
                            200,
                            if (attentionReads > 1) {
                                attentionResponse(emptyList(), needsYou = 0)
                            } else {
                                attentionResponse(fullQueue(), needsYou = 3)
                            },
                        )
                    }
                    path == "/v1/agent-replies" -> GatewayHttpResponse(409, conflictResponse())
                    else -> error("Unexpected Mobile Gateway path: $path")
                }
            },
        )
        assertTrue(repository.refreshAttention())
        val question = repository.observeCachedAttention().first().items.first { it.canReply }

        val result = repository.replyToAgent(question, null, "25℃で進めてください。")

        assertTrue(result is MobileAgentReplyResult.Conflict)
        assertTrue((result as MobileAgentReplyResult.Conflict).message.contains("再読み込み"))
        // 競合した回答は残さない。要対応はDesktopの最新へ収束する。
        assertNull(dao.attention(question.attentionId, "server-1"))
        assertEquals(0, repository.observeCachedAttention().first().items.size)
        assertEquals(0, repository.observeCachedAttention().first().counts?.needsYou)
    }

    @Test
    fun anUnreadableAttentionIsNotReportedAsZero() = runBlocking {
        val repository = repository(
            MobileGatewayHttpClient { _, _, _, _, _ -> throw IOException("offline") },
        )

        assertEquals(false, repository.refreshAttention())
        val snapshot = repository.observeCachedAttention().first()

        // 「まだ読めていない」と「0件」を混同させない。
        assertNull(snapshot.counts)
        assertEquals(0, snapshot.items.size)
    }

    private fun fullQueue(): List<String> = listOf(questionItem(), reviewItem(), proposalItem())

    private fun questionItem(kind: String = "answer_request"): String =
        """
        {
          "attentionId": "task-work:request:33333333-3333-4333-8333-333333333333",
          "kind": "$kind",
          "taskId": "task-viscosity",
          "taskTitle": "粘度測定の条件を決める",
          "taskVersion": 12,
          "themeId": null,
          "themeName": null,
          "agentLabel": "Codex",
          "headline": "測定温度が決まっていません。",
          "summary": "測定温度が決まっていません。",
          "questionOrAction": "測定温度が決まっていません。",
          "createdAt": "2026-09-20T00:00:00Z",
          "updatedAt": "2026-09-20T00:00:00Z",
          "sourceType": "work_receipt",
          "sourceId": "receipt-1",
          "sourceVersion": 1,
          "workAttemptId": null,
          "requestId": "33333333-3333-4333-8333-333333333333",
          "availableActions": ["answer_request", "open_task", "defer_attention"]
        }
        """.trimIndent()

    private fun reviewItem(): String =
        """
        {
          "attentionId": "task-work:review:receipt-2",
          "kind": "review_report",
          "taskId": "task-review",
          "taskTitle": "比較表の作成",
          "taskVersion": 7,
          "themeId": null,
          "themeName": null,
          "agentLabel": "Codex",
          "headline": "3条件の比較表を作成しました。",
          "summary": "3条件の比較表を作成しました。",
          "questionOrAction": "3条件の比較表を作成しました。",
          "createdAt": "2026-09-20T00:00:00Z",
          "updatedAt": "2026-09-20T00:00:00Z",
          "sourceType": "work_receipt",
          "sourceId": "receipt-2",
          "sourceVersion": 1,
          "workAttemptId": null,
          "requestId": null,
          "availableActions": ["review_report", "accept_report", "accept_and_complete", "request_revision"]
        }
        """.trimIndent()

    private fun proposalItem(): String =
        """
        {
          "attentionId": "proposal:proposal-1",
          "kind": "proposal_pending",
          "taskId": null,
          "taskTitle": null,
          "taskVersion": null,
          "themeId": null,
          "themeName": null,
          "agentLabel": "codex",
          "headline": "Noteの変更案",
          "summary": "Noteの変更案",
          "questionOrAction": "内容を確認して、採用するかどうかを決めてください。",
          "createdAt": "2026-09-20T00:00:00Z",
          "updatedAt": "2026-09-20T00:00:00Z",
          "sourceType": "ai_proposal",
          "sourceId": "proposal-1",
          "sourceVersion": 1,
          "workAttemptId": null,
          "requestId": null,
          "availableActions": ["view_proposal", "reject_proposal", "defer_attention"]
        }
        """.trimIndent()

    private fun attentionResponse(items: List<String>, needsYou: Int): String =
        """
        {
          "ok": true,
          "meta": {
            "apiVersion": 1,
            "schemaVersion": 7,
            "serverId": "server-1",
            "serverRevision": 42,
            "generatedAt": "2026-09-20T00:00:01Z",
            "truncated": false
          },
          "data": {
            "attention": [${items.joinToString(",")}],
            "counts": { "needsYou": $needsYou, "working": 1, "queued": 1 },
            "truncated": false
          }
        }
        """.trimIndent()

    private fun replyResponse(commandId: String): String =
        """
        {
          "ok": true,
          "meta": {
            "apiVersion": 1,
            "schemaVersion": 7,
            "serverId": "server-1",
            "serverRevision": 43,
            "generatedAt": "2026-09-20T00:00:02Z",
            "truncated": false
          },
          "data": {
            "commandId": "$commandId",
            "commandStatus": "applied",
            "taskId": "task-viscosity",
            "taskVersion": 12,
            "questionId": "33333333-3333-4333-8333-333333333333",
            "displayState": "answered_resume_waiting"
          }
        }
        """.trimIndent()

    private fun conflictResponse(): String =
        """
        {
          "ok": false,
          "meta": {
            "apiVersion": 1,
            "schemaVersion": 7,
            "serverId": "server-1",
            "serverRevision": 43,
            "generatedAt": "2026-09-20T00:00:02Z",
            "truncated": false
          },
          "error": {
            "code": "entity_conflict",
            "message": "同じIDが既に存在するか、対象が更新済みです。再読み込みして再試行してください。",
            "retryable": false
          }
        }
        """.trimIndent()
}
