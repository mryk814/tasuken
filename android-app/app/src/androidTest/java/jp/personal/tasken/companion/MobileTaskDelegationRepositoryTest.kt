package jp.personal.tasken.companion

import android.content.Context
import androidx.room.Room
import androidx.test.core.app.ApplicationProvider
import androidx.test.ext.junit.runners.AndroidJUnit4
import java.io.IOException
import kotlinx.coroutines.runBlocking
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith

@RunWith(AndroidJUnit4::class)
class MobileTaskDelegationRepositoryTest {
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
            SyncStateEntity(1, "server-1", 1, TASKEN_MOBILE_SCHEMA_VERSION, "cursor", null, null, null),
        )
        store = MobileGatewayConnectionStore(context)
        store.clearToken()
        store.save(
            "https://gateway.test",
            "w".repeat(43),
            setOf("mobile:read", "mobile:context-read", "mobile:task-write"),
        )
    }

    @After
    fun tearDown() {
        store.clearToken()
        database.close()
    }

    @Test
    fun responseLossAfterServerApplyReplaysByteIdenticalEnvelopeAfterRestart() = runBlocking {
        val sentBodies = mutableListOf<String>()
        var calls = 0
        val client = MobileGatewayHttpClient { _, path, method, body, _ ->
            when {
                path.startsWith("/v1/task-context-preview?") -> {
                    assertEquals("GET", method)
                    GatewayHttpResponse(200, previewResponse())
                }
                path == "/v1/task-delegations" -> {
                    assertEquals("POST", method)
                    val request = requireNotNull(body)
                    sentBodies += request
                    calls += 1
                    if (calls == 1) throw IOException("server applied, response lost")
                    GatewayHttpResponse(200, delegationResponse())
                }
                else -> error("Unexpected Mobile Gateway path: $path")
            }
        }
        fun repository() = AndroidMobileTaskRepository(
            context = context,
            store = store,
            database = database,
            scheduleOutboxOnStart = false,
            httpClient = client,
        )
        val task = MobileTask(
            id = "task-1",
            version = 4,
            title = "Delegate task",
            themeId = null,
            state = "todo",
            workState = "not_delegated",
            updatedAt = "2026-08-30T00:00:00Z",
        )
        val preview = (repository().previewTaskContext(task) as MobileTaskContextPreviewResult.Available).preview

        assertTrue(
            repository().delegateTask(task, preview, "done", "ship it") is MobileTaskDelegationResult.Unavailable,
        )
        val applied = repository().delegateTask(task, preview, "done", "ship it")

        assertTrue(applied is MobileTaskDelegationResult.Applied)
        assertEquals(2, sentBodies.size)
        assertEquals(sentBodies.first(), sentBodies.last())
        val cached = requireNotNull(dao.task("task-1"))
        assertEquals(5, cached.serverVersion)
        assertEquals("ready_for_agent", cached.workState)
    }

    @Test
    fun aiReadyUsesCanonicalUpdateWithoutPreviewDelegationOrShare() = runBlocking {
        val sent = mutableListOf<MobileTaskUpdateEnvelopeDto>()
        val paths = mutableListOf<String>()
        val client = MobileGatewayHttpClient { _, path, method, body, _ ->
            when {
                path == "/v1/commands" -> {
                    paths += path
                    assertEquals("POST", method)
                    val envelope = MobileTaskCommandContract.decodeUpdateEnvelope(requireNotNull(body))
                    sent += envelope
                    val enabled = envelope.command.changes.getValue("aiReady").toString().toBooleanStrict()
                    GatewayHttpResponse(
                        200,
                        aiReadyResponse(
                            commandId = envelope.commandId,
                            version = if (enabled) 5 else 6,
                            workState = if (enabled) "ready_for_agent" else "not_delegated",
                        ),
                    )
                }
                path.startsWith("/v1/sync?") -> throw IOException("post-command sync is not part of this assertion")
                else -> error("Unexpected Mobile Gateway path: $path")
            }
        }
        val repository = AndroidMobileTaskRepository(
            context = context,
            store = store,
            database = database,
            scheduleOutboxOnStart = false,
            httpClient = client,
        )
        val task = MobileTask(
            id = "task-1",
            version = 4,
            title = "Delegate task",
            themeId = null,
            state = "todo",
            workState = "not_delegated",
            updatedAt = "2026-08-30T00:00:00Z",
        )

        assertEquals(MobileAiReadyResult.Applied(task.id, true), repository.setTaskAiReady(task, true))
        assertEquals(
            MobileAiReadyResult.Applied(task.id, false),
            repository.setTaskAiReady(task.copy(version = 5, workState = "ready_for_agent"), false),
        )

        assertEquals(listOf("/v1/commands", "/v1/commands"), paths)
        assertEquals(setOf("aiReady"), sent[0].command.changes.keys)
        assertEquals("true", sent[0].command.changes.getValue("aiReady").toString())
        assertEquals("false", sent[0].command.base.getValue("aiReady").toString())
        assertEquals("false", sent[1].command.changes.getValue("aiReady").toString())
        assertEquals("true", sent[1].command.base.getValue("aiReady").toString())
        assertEquals("not_delegated", requireNotNull(dao.task("task-1")).workState)
    }

    @Test
    fun notificationDeliveryIsPersistentlyDeduplicatedUntilDelivered() = runBlocking {
        val delivery = TaskNotificationDeliveryEntity(
            deliveryId = "notification-1",
            serverId = "server-1",
            taskId = "task-1",
            taskVersion = 5,
            workState = "agent_done",
            receiptId = null,
            state = "pending",
            createdAt = "2026-08-30T00:00:02Z",
        )

        assertTrue(dao.insertTaskNotificationDelivery(delivery) != -1L)
        assertEquals(-1L, dao.insertTaskNotificationDelivery(delivery))
        assertEquals(1, dao.pendingTaskNotificationDeliveries("server-1").size)
        assertEquals(
            1,
            dao.markTaskNotificationDelivered(
                delivery.deliveryId,
                "server-1",
                "2026-08-30T00:00:03Z",
            ),
        )
        assertTrue(dao.pendingTaskNotificationDeliveries("server-1").isEmpty())
    }

    @Test
    fun recurringBootstrapQueuesAChangedCanonicalTaskInsteadOfReseedingIt() = runBlocking {
        val previous = taskCache(version = 4, workState = "ready_for_agent", receiptId = null)
        dao.upsertTask(previous)

        dao.applyBootstrap(
            tasks = listOf(
                taskCache(
                    version = 5,
                    workState = "needs_human_review",
                    receiptId = "receipt-5",
                ),
            ),
            syncState = SyncStateEntity(
                1,
                "server-1",
                1,
                TASKEN_MOBILE_SCHEMA_VERSION,
                "cursor-5",
                "2026-08-30T00:00:05Z",
                "2026-08-30T00:00:05Z",
                null,
            ),
        )

        val pending = dao.pendingTaskNotificationDeliveries("server-1")
        assertEquals(1, pending.size)
        assertEquals("needs_human_review", pending.single().workState)
        assertEquals("receipt-5", pending.single().receiptId)
    }

    @Test
    fun proposalBaselinePersistsEvenWhenTheFirstListIsEmpty() = runBlocking {
        dao.replaceTaskWorkProposalsAndQueueNotifications(
            serverId = "server-1",
            proposals = emptyList(),
            deliveries = emptyList(),
            observedAt = "2026-08-30T00:00:01Z",
        )
        assertEquals(1, dao.proposalNotificationBaselineCount("server-1"))
        assertTrue(dao.pendingTaskNotificationDeliveries("server-1").isEmpty())

        val delivery = TaskNotificationDeliveryEntity(
            deliveryId = "proposal-notification-1",
            serverId = "server-1",
            taskId = "task-1",
            taskVersion = 5,
            workState = "pending_proposal",
            receiptId = "proposal-1",
            state = "pending",
            createdAt = "2026-08-30T00:00:02Z",
        )
        dao.replaceTaskWorkProposalsAndQueueNotifications(
            serverId = "server-1",
            proposals = emptyList(),
            deliveries = listOf(delivery),
            observedAt = "2026-08-30T00:00:02Z",
        )

        assertEquals(
            listOf("proposal-notification-1"),
            dao.pendingTaskNotificationDeliveries("server-1").map { it.deliveryId },
        )
    }

    private fun previewResponse(): String =
        """
        {"ok":true,"meta":{"apiVersion":1,"schemaVersion":7,"serverId":"server-1","serverRevision":1,"generatedAt":"2026-08-30T00:00:01Z","truncated":false},"data":{"contextFingerprint":"sha256:${"a".repeat(64)}","task":{"id":"task-1","version":4,"title":"Delegate task","description":null,"state":"todo","workState":"not_delegated","updatedAt":"2026-08-30T00:00:00Z","ai":null},"theme":null,"repositoryContexts":[],"related":{"notes":[],"conversations":[],"artifacts":[],"resources":[],"activity":[]},"contextSelection":{"schema":"tasken-context-selection/v1","included":[],"excluded":[],"truncated":false},"warnings":[],"truncation":[]}}
        """.trimIndent()

    private fun delegationResponse(): String =
        """
        {"ok":true,"meta":{"apiVersion":1,"schemaVersion":7,"serverId":"server-1","serverRevision":2,"generatedAt":"2026-08-30T00:00:02Z","truncated":false},"data":{"commandId":"${commandId()}","status":"applied","task":{"id":"task-1","version":5,"title":"Delegate task","themeId":null,"state":"todo","workState":"ready_for_agent","todayDate":null,"plannedStartTime":null,"plannedDurationMinutes":null,"latestWorkReceipt":null,"checklistItems":[],"schedule":null,"updatedAt":"2026-08-30T00:00:02Z"},"safeShare":{"mimeType":"text/plain","title":"Delegate task","taskId":"task-1","taskLocator":"tasken://task/task-1","instruction":"ship it","text":"Tasken task context"}}}
        """.trimIndent()

    private fun aiReadyResponse(commandId: String, version: Int, workState: String): String =
        """
        {"ok":true,"meta":{"apiVersion":1,"schemaVersion":7,"serverId":"server-1","serverRevision":$version,"generatedAt":"2026-08-30T00:00:0${version}Z","truncated":false},"data":{"commandId":"$commandId","status":"applied","task":{"id":"task-1","version":$version,"title":"Delegate task","themeId":null,"state":"todo","workState":"$workState","todayDate":null,"plannedStartTime":null,"plannedDurationMinutes":null,"latestWorkReceipt":null,"checklistItems":[],"schedule":null,"updatedAt":"2026-08-30T00:00:0${version}Z"}}}
        """.trimIndent()

    private fun commandId(): String = taskDelegationCommandId(
        clientDeviceId = store.deviceId(),
        serverId = "server-1",
        taskId = "task-1",
        expectedTaskVersion = 4,
        fingerprint = "sha256:" + "a".repeat(64),
        expectedResult = "done",
        instruction = "ship it",
    )

    private fun taskCache(version: Int, workState: String, receiptId: String?): TaskCacheEntity =
        TaskCacheEntity(
            id = "task-1",
            serverVersion = version,
            title = "Delegate task",
            themeId = null,
            state = "todo",
            workState = workState,
            todayDate = null,
            updatedAt = "2026-08-30T00:00:0${version}Z",
            optimisticCommandId = null,
            latestReceiptId = receiptId,
        )
}
