package jp.personal.tasken.companion

import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.flowOf
import org.junit.Assert.assertEquals
import org.junit.Assert.assertSame
import org.junit.Assert.assertTrue
import org.junit.Test

class TodayViewModelTest {
    @Test
    fun initialStateIsLoading() {
        assertSame(TodayUiState.Loading, TodayViewModel(FakeRepository(emptyList())).uiState.value)
    }

    @Test
    fun loadReachesEmptyState() {
        val viewModel = TodayViewModel(FakeRepository(emptyList()))
        runBlocking { viewModel.loadNow() }
        assertSame(TodayUiState.Empty, viewModel.uiState.value)
    }

    @Test
    fun loadReachesErrorStateWithRecovery() {
        val viewModel = TodayViewModel(object : MobileTaskRepository {
            override fun loadToday() = MobileTodayResult.Unavailable("接続失敗", "Desktopを確認してください。")
        })
        runBlocking { viewModel.loadNow() }
        assertEquals(
            TodayUiState.Error("接続失敗", "Desktopを確認してください。"),
            viewModel.uiState.value,
        )
    }

    @Test
    fun loadReachesImmutableSuccessProjection() {
        val source = mutableListOf(sampleTask())
        val viewModel = TodayViewModel(FakeRepository(source))
        runBlocking { viewModel.loadNow() }
        source.clear()
        val success = viewModel.uiState.value as TodayUiState.Success
        assertEquals(1, success.tasks.size)
        assertTrue(success.tasks !== source)
    }

    @Test
    fun offlineRepositoryProjectsRoomFlowInsteadOfNetworkReturnValue() {
        val cached = sampleTask().copy(title = "Room cache", pending = true)
        val network = sampleTask().copy(title = "Network object")
        val repository = object : MobileTaskRepository, MobileOfflineTaskRepository {
            override fun loadToday() = MobileTodayResult.Available(listOf(network), "2026-08-21T10:00:00.000Z")
            override fun observeCachedTasks(): Flow<List<MobileTask>> = flowOf(listOf(cached))
            override fun observePendingCount(): Flow<Int> = flowOf(1)
            override suspend fun enqueueCreateTask(title: String, todayDate: java.time.LocalDate?) = "unused"
            override suspend fun enqueueCompleteTask(taskId: String) = "unused"
            override suspend fun enqueueReopenTask(taskId: String) = "unused"
        }
        val viewModel = TodayViewModel(repository)

        runBlocking { viewModel.loadNow() }

        val success = viewModel.uiState.value as TodayUiState.Success
        assertEquals("Room cache", success.tasks.single().title)
        assertTrue(success.tasks.single().pending)
    }

    @Test
    fun createTaskQueuesOfflineCommandAndReportsTaskId() {
        var receivedTitle = ""
        val repository = object : MobileTaskRepository, MobileOfflineTaskRepository {
            override fun loadToday() = MobileTodayResult.Available(emptyList(), "2026-08-21T10:00:00.000Z")
            override fun observeCachedTasks(): Flow<List<MobileTask>> = flowOf(emptyList())
            override fun observePendingCount(): Flow<Int> = flowOf(0)
            override suspend fun enqueueCreateTask(title: String, todayDate: java.time.LocalDate?): String {
                receivedTitle = title
                return "queued-task-id"
            }
            override suspend fun enqueueCompleteTask(taskId: String) = "unused"
            override suspend fun enqueueReopenTask(taskId: String) = "unused"
        }
        val viewModel = TodayViewModel(repository)

        runBlocking { viewModel.createTaskNow("  外出先で追加  ") }

        assertEquals("外出先で追加", receivedTitle)
        assertEquals(CaptureUiState.Queued("queued-task-id"), viewModel.captureState.value)
    }

    @Test
    fun createTaskValidationKeepsActionRecoverable() {
        val viewModel = TodayViewModel(FakeRepository(emptyList()))

        runBlocking { viewModel.createTaskNow("   ") }

        assertEquals(CaptureUiState.Error("Task名を入力してください。"), viewModel.captureState.value)
    }

    @Test
    fun taskStateActionQueuesCompleteAndReopenIntents() {
        val received = mutableListOf<String>()
        val repository = object : MobileTaskRepository, MobileOfflineTaskRepository {
            override fun loadToday() = MobileTodayResult.Available(emptyList(), "2026-08-21T10:00:00.000Z")
            override fun observeCachedTasks(): Flow<List<MobileTask>> = flowOf(emptyList())
            override fun observePendingCount(): Flow<Int> = flowOf(0)
            override suspend fun enqueueCreateTask(title: String, todayDate: java.time.LocalDate?) = "unused"
            override suspend fun enqueueCompleteTask(taskId: String): String {
                received += "complete:$taskId"
                return "complete-command"
            }
            override suspend fun enqueueReopenTask(taskId: String): String {
                received += "reopen:$taskId"
                return "reopen-command"
            }
        }
        val viewModel = TodayViewModel(repository)
        val task = sampleTask()

        runBlocking { viewModel.toggleTaskStateNow(task) }
        assertEquals(TaskActionUiState.Queued("complete-command"), viewModel.taskActionState.value)
        runBlocking { viewModel.toggleTaskStateNow(task.copy(state = "done")) }
        assertEquals(TaskActionUiState.Queued("reopen-command"), viewModel.taskActionState.value)
        assertEquals(listOf("complete:${task.id}", "reopen:${task.id}"), received)
    }

    @Test
    fun pendingTaskStateActionStaysRecoverable() {
        val viewModel = TodayViewModel(FakeRepository(emptyList()))
        val task = sampleTask().copy(pending = true)

        runBlocking { viewModel.toggleTaskStateNow(task) }

        assertEquals(
            TaskActionUiState.Error(task.id, "このTaskの同期完了を待って再試行してください。"),
            viewModel.taskActionState.value,
        )
    }

    @Test
    fun taskStateLabelsUseSharedJapaneseVocabulary() {
        assertEquals("未着手", taskStateLabel("todo"))
        assertEquals("確認待ち", taskStateLabel("review"))
    }

    private class FakeRepository(private val tasks: List<MobileTask>) : MobileTaskRepository {
        override fun loadToday() = MobileTodayResult.Available(tasks, "2026-08-21T10:00:00.000Z")
    }

    private fun sampleTask() = MobileTask(
        id = "10000000-0000-4000-8000-000000000001",
        title = "Task",
        themeId = null,
        state = "todo",
        workState = null,
        updatedAt = "2026-08-21T09:00:00.000Z",
    )
}
