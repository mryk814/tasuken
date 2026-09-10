package jp.personal.tasken.companion

import androidx.test.platform.app.InstrumentationRegistry
import java.util.UUID
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.channels.Channel
import kotlinx.coroutines.launch
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.withTimeout
import kotlinx.coroutines.delay
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.cancel
import org.junit.Assert.assertTrue
import org.junit.Test

class WidgetRefreshTriggerTest {
    @Test
    fun taskCacheWriteEmitsWidgetRefreshTrigger() = runBlocking {
        val context = InstrumentationRegistry.getInstrumentation().targetContext
        val dao = MobileLocalDatabase.open(context).mobileDao()
        val taskId = "widget-refresh-${UUID.randomUUID()}"
        val signals = Channel<Unit>(Channel.CONFLATED)
        val scope = CoroutineScope(Dispatchers.IO)
        scope.launch { widgetRefreshTriggers(dao).collect { signals.trySend(Unit) } }
        try {
            // Room flows emit the initial snapshot on subscribe; drain it before asserting reactivity.
            delay(700)
            while (signals.tryReceive().isSuccess) { /* drain */ }
            dao.upsertTask(
                TaskCacheEntity(
                    id = taskId,
                    serverVersion = 1,
                    title = "更新検知",
                    themeId = null,
                    state = "todo",
                    workState = null,
                    todayDate = "2026-09-10",
                    updatedAt = "2026-09-10T00:00:00Z",
                    optimisticCommandId = null,
                ),
            )
            val received = withTimeout(5000) { signals.receive() }
            assertTrue(received == Unit)
        } finally {
            dao.deleteTask(taskId)
            scope.cancel()
        }
    }
}
