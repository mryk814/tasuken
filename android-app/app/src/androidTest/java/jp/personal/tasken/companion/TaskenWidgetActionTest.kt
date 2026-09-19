package jp.personal.tasken.companion

import androidx.test.platform.app.InstrumentationRegistry
import java.time.Instant
import java.time.LocalDate
import java.util.UUID
import kotlinx.coroutines.delay
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.withTimeout
import org.junit.Assert.assertEquals
import org.junit.Test

class TaskenWidgetActionTest {
    @Test
    fun collection_pending_intent_queues_completion_without_opening_app() = runBlocking {
        val context = InstrumentationRegistry.getInstrumentation().targetContext
        val dao = MobileLocalDatabase.open(context).mobileDao()
        val previousSyncState = dao.syncState()
        val taskId = "widget-action-${UUID.randomUUID()}"
        val serverId = "widget-action-server-${UUID.randomUUID()}"

        try {
            dao.upsertSyncState(
                SyncStateEntity(
                    serverId = serverId,
                    apiVersion = 1,
                    schemaVersion = TASKEN_MOBILE_SCHEMA_VERSION,
                    cursor = "widget-action-cursor",
                    lastSuccessfulSyncAt = Instant.now().toString(),
                    lastAttemptAt = Instant.now().toString(),
                    lastError = null,
                ),
            )
            dao.upsertTask(
                TaskCacheEntity(
                    id = taskId,
                    serverVersion = 1,
                    title = "ウィジェット操作の検証",
                    themeId = null,
                    state = "todo",
                    workState = null,
                    todayDate = LocalDate.now().toString(),
                    updatedAt = Instant.now().toString(),
                    optimisticCommandId = null,
                ),
            )

            TaskenTodayWidget.widgetItemPendingIntent(context, 60_000).send(
                context,
                0,
                TaskenTodayWidget.widgetToggleTaskIntent(taskId, markDone = true),
            )

            withTimeout(5_000) {
                while (dao.task(taskId)?.state != "done") delay(50)
            }

            val command = dao.outboxForTask(taskId).single()
            assertEquals("CompleteTask", command.commandName)
            assertEquals(taskId, command.taskId)
        } finally {
            dao.outboxForTask(taskId).forEach { dao.deleteOutbox(it.commandId) }
            dao.deleteTask(taskId)
            if (previousSyncState != null) dao.upsertSyncState(previousSyncState)
        }
    }
}
