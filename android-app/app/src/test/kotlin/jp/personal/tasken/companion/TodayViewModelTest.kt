package jp.personal.tasken.companion

import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.flowOf
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
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
    fun loadRefreshesExternalProjectionAfterRepositorySettles() {
        val events = mutableListOf<String>()
        val repository = object : MobileTaskRepository {
            override fun loadToday(): MobileTodayResult {
                events += "repository"
                return MobileTodayResult.Available(emptyList(), "2026-08-23T00:00:00Z")
            }
        }
        val viewModel = TodayViewModel(
            repository = repository,
            ioDispatcher = Dispatchers.Unconfined,
            refreshExternalProjection = { events += "projection" },
        )

        runBlocking { viewModel.loadNow() }

        assertEquals(listOf("repository", "projection"), events)
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
            override suspend fun enqueueCreateTask(draft: MobileCaptureDraft, todayDate: java.time.LocalDate?) = "unused"
            override suspend fun enqueueCompleteTask(taskId: String) = MobileStateActionResult("unused", true)
            override suspend fun enqueueReopenTask(taskId: String) = MobileStateActionResult("unused", true)
        }
        val viewModel = TodayViewModel(repository)

        runBlocking { viewModel.loadNow() }

        val success = viewModel.uiState.value as TodayUiState.Success
        assertEquals("Room cache", success.tasks.single().title)
        assertTrue(success.tasks.single().pending)
    }

    @Test
    fun createTaskQueuesOfflineCommandAndReportsTaskId() {
        var receivedDraft: MobileCaptureDraft? = null
        val repository = object : MobileTaskRepository, MobileOfflineTaskRepository {
            override fun loadToday() = MobileTodayResult.Available(emptyList(), "2026-08-21T10:00:00.000Z")
            override fun observeCachedTasks(): Flow<List<MobileTask>> = flowOf(emptyList())
            override fun observePendingCount(): Flow<Int> = flowOf(0)
            override suspend fun enqueueCreateTask(draft: MobileCaptureDraft, todayDate: java.time.LocalDate?): String {
                receivedDraft = draft
                return "queued-task-id"
            }
            override suspend fun enqueueCompleteTask(taskId: String) = MobileStateActionResult("unused", true)
            override suspend fun enqueueReopenTask(taskId: String) = MobileStateActionResult("unused", true)
        }
        val viewModel = TodayViewModel(repository)

        runBlocking {
            viewModel.createTaskNow(
                MobileCaptureDraft.fresh(
                    text = "  外出先で追加  ",
                    source = MobileCaptureSource.AndroidSpeech,
                    projectId = "theme-research",
                ),
            )
        }

        assertEquals("外出先で追加", receivedDraft?.text)
        assertEquals(MobileCaptureSource.AndroidSpeech, receivedDraft?.source)
        assertEquals("theme-research", receivedDraft?.projectId)
        assertEquals(CaptureUiState.Queued("queued-task-id"), viewModel.captureState.value)
    }

    @Test
    fun createTaskCarriesContinueBehaviorWithoutReusingSubmitPath() {
        val repository = object : MobileTaskRepository, MobileOfflineTaskRepository {
            override fun loadToday() = MobileTodayResult.Available(emptyList(), "2026-08-21T10:00:00.000Z")
            override fun observeCachedTasks(): Flow<List<MobileTask>> = flowOf(emptyList())
            override fun observePendingCount(): Flow<Int> = flowOf(0)
            override suspend fun enqueueCreateTask(draft: MobileCaptureDraft, todayDate: java.time.LocalDate?) = "continued-task"
            override suspend fun enqueueCompleteTask(taskId: String) = MobileStateActionResult("unused", true)
            override suspend fun enqueueReopenTask(taskId: String) = MobileStateActionResult("unused", true)
        }
        val viewModel = TodayViewModel(repository)

        runBlocking {
            viewModel.createTaskNow(
                MobileCaptureDraft.fresh(text = "続けて追加"),
                CaptureCompletionBehavior.Continue,
            )
        }

        assertEquals(
            CaptureUiState.Queued("continued-task", CaptureCompletionBehavior.Continue),
            viewModel.captureState.value,
        )
    }

    @Test
    fun undoCreatedTaskReportsLocalCancelAndCanonicalDeleteSeparately() {
        var requiresSync = false
        val repository = object : MobileTaskRepository, MobileOfflineTaskRepository {
            override fun loadToday() = MobileTodayResult.Available(emptyList(), "2026-08-21T10:00:00.000Z")
            override fun observeCachedTasks(): Flow<List<MobileTask>> = flowOf(emptyList())
            override fun observePendingCount(): Flow<Int> = flowOf(0)
            override suspend fun enqueueCreateTask(draft: MobileCaptureDraft, todayDate: java.time.LocalDate?) = "unused"
            override suspend fun undoCreateTask(taskId: String) = MobileUndoCreateResult(
                commandId = if (requiresSync) "delete-command" else null,
                requiresSync = requiresSync,
            )
            override suspend fun enqueueCompleteTask(taskId: String) = MobileStateActionResult("unused", true)
            override suspend fun enqueueReopenTask(taskId: String) = MobileStateActionResult("unused", true)
        }
        val viewModel = TodayViewModel(repository)

        runBlocking { viewModel.undoCreatedTaskNow("task-local") }
        assertEquals(
            TaskActionUiState.Queued(
                taskId = "task-local",
                requiresSync = false,
                message = "Task追加を元に戻しました。",
            ),
            viewModel.taskActionState.value,
        )

        requiresSync = true
        runBlocking { viewModel.undoCreatedTaskNow("task-canonical") }
        assertEquals(
            TaskActionUiState.Queued(
                taskId = "task-canonical",
                requiresSync = true,
                message = "Task削除をDesktopへ自動送信します。",
            ),
            viewModel.taskActionState.value,
        )
    }

    @Test
    fun createTaskValidationKeepsActionRecoverable() {
        val viewModel = TodayViewModel(FakeRepository(emptyList()))

        runBlocking { viewModel.createTaskNow(MobileCaptureDraft.fresh(text = "   ")) }

        assertEquals(CaptureUiState.Error("Task名を入力してください。"), viewModel.captureState.value)
    }

    @Test
    fun taskStateActionQueuesCompleteAndReopenIntents() {
        val received = mutableListOf<String>()
        val repository = object : MobileTaskRepository, MobileOfflineTaskRepository {
            override fun loadToday() = MobileTodayResult.Available(emptyList(), "2026-08-21T10:00:00.000Z")
            override fun observeCachedTasks(): Flow<List<MobileTask>> = flowOf(emptyList())
            override fun observePendingCount(): Flow<Int> = flowOf(0)
            override suspend fun enqueueCreateTask(draft: MobileCaptureDraft, todayDate: java.time.LocalDate?) = "unused"
            override suspend fun enqueueCompleteTask(taskId: String): MobileStateActionResult {
                received += "complete:$taskId"
                return MobileStateActionResult("complete-command", true)
            }
            override suspend fun enqueueReopenTask(taskId: String): MobileStateActionResult {
                received += "reopen:$taskId"
                return MobileStateActionResult("reopen-command", true)
            }
        }
        val viewModel = TodayViewModel(repository)
        val task = sampleTask()

        runBlocking { viewModel.toggleTaskStateNow(task) }
        assertEquals(TaskActionUiState.Queued(task.id), viewModel.taskActionState.value)
        runBlocking { viewModel.toggleTaskStateNow(task.copy(state = "done")) }
        assertEquals(TaskActionUiState.Queued(task.id), viewModel.taskActionState.value)
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
    fun unsentPendingTaskCanCoalesceBackToCanonicalState() {
        val task = sampleTask().copy(state = "done", pending = true, canChangePendingState = true)
        val repository = object : MobileTaskRepository, MobileOfflineTaskRepository {
            override fun loadToday() = MobileTodayResult.Available(listOf(task), "2026-08-21T10:00:00.000Z")
            override fun observeCachedTasks(): Flow<List<MobileTask>> = flowOf(listOf(task))
            override fun observePendingCount(): Flow<Int> = flowOf(1)
            override suspend fun enqueueCreateTask(draft: MobileCaptureDraft, todayDate: java.time.LocalDate?) = "unused"
            override suspend fun enqueueCompleteTask(taskId: String) = MobileStateActionResult("unused", true)
            override suspend fun enqueueReopenTask(taskId: String) = MobileStateActionResult(null, false)
        }
        val viewModel = TodayViewModel(repository)

        runBlocking { viewModel.toggleTaskStateNow(task) }

        assertEquals(TaskActionUiState.Queued(task.id, requiresSync = false), viewModel.taskActionState.value)
    }

    @Test
    fun todayDateActionQueuesTheExplicitDateWithoutLocalScheduleRules() {
        var received: java.time.LocalDate? = null
        val repository = object : MobileTaskRepository, MobileOfflineTaskRepository {
            override fun loadToday() = MobileTodayResult.Available(emptyList(), "2026-08-21T10:00:00.000Z")
            override fun observeCachedTasks(): Flow<List<MobileTask>> = flowOf(emptyList())
            override fun observePendingCount(): Flow<Int> = flowOf(0)
            override suspend fun enqueueCreateTask(draft: MobileCaptureDraft, todayDate: java.time.LocalDate?) = "unused"
            override suspend fun enqueueUpdateTaskTodayDate(taskId: String, todayDate: java.time.LocalDate?): String {
                received = todayDate
                return "schedule-command"
            }
            override suspend fun enqueueCompleteTask(taskId: String) = MobileStateActionResult("unused", true)
            override suspend fun enqueueReopenTask(taskId: String) = MobileStateActionResult("unused", true)
        }
        val viewModel = TodayViewModel(repository)
        val date = java.time.LocalDate.parse("2026-08-22")

        runBlocking { viewModel.updateTaskTodayDateNow(sampleTask(), date) }

        assertEquals(date, received)
        assertEquals(TaskActionUiState.Queued(sampleTask().id), viewModel.taskActionState.value)
    }

    @Test
    fun canonicalScheduleActionValidatesDatesAndQueuesNormalizedDraft() {
        var received: MobileTaskScheduleDraft? = null
        val repository = object : MobileTaskRepository, MobileOfflineTaskRepository {
            override fun loadToday() = MobileTodayResult.Available(emptyList(), "2026-08-21T10:00:00.000Z")
            override fun observeCachedTasks(): Flow<List<MobileTask>> = flowOf(emptyList())
            override fun observePendingCount(): Flow<Int> = flowOf(0)
            override suspend fun enqueueCreateTask(draft: MobileCaptureDraft, todayDate: java.time.LocalDate?) = "unused"
            override suspend fun enqueueUpdateTaskSchedule(taskId: String, schedule: MobileTaskScheduleDraft): String {
                received = schedule
                return "schedule-command"
            }
            override suspend fun enqueueCompleteTask(taskId: String) = MobileStateActionResult("unused", true)
            override suspend fun enqueueReopenTask(taskId: String) = MobileStateActionResult("unused", true)
        }
        val viewModel = TodayViewModel(repository)
        val draft = MobileTaskScheduleDraft("2026-08-23", "2026-08-25", null)

        runBlocking { viewModel.updateTaskScheduleNow(sampleTask(), draft) }

        assertEquals(draft, received)
        assertEquals(TaskActionUiState.Queued(sampleTask().id), viewModel.taskActionState.value)

        received = null
        runBlocking {
            viewModel.updateTaskScheduleNow(
                sampleTask(),
                MobileTaskScheduleDraft("2026-08-25", "2026-08-23", null),
            )
        }
        assertNull(received)
        assertEquals(
            TaskActionUiState.Error(sampleTask().id, "終了日は開始日以降にしてください。"),
            viewModel.taskActionState.value,
        )
    }

    @Test
    fun themeCatalogIsExposedAndCanonicalSelectionQueuesOfflineIntent() {
        var called = false
        var receivedThemeId = "not-called"
        val repository = object : MobileTaskRepository, MobileOfflineTaskRepository {
            override fun loadToday() = MobileTodayResult.Available(emptyList(), "2026-08-21T10:00:00.000Z")
            override fun observeCachedTasks(): Flow<List<MobileTask>> = flowOf(emptyList())
            override fun observeThemeCatalogState(): Flow<MobileThemeCatalogState> = flowOf(
                MobileThemeCatalogState.Available(
                    themes = listOf(MobileTheme("theme-1", "研究Theme")),
                    serverId = "server-1",
                    serverRevision = 7,
                    generatedAt = "2026-08-22T01:00:00Z",
                ),
            )
            override fun observePendingCount(): Flow<Int> = flowOf(0)
            override suspend fun enqueueCreateTask(draft: MobileCaptureDraft, todayDate: java.time.LocalDate?) = "unused"
            override suspend fun enqueueUpdateTaskTheme(taskId: String, themeId: String): String {
                called = true
                receivedThemeId = themeId
                return "theme-command"
            }
            override suspend fun enqueueCompleteTask(taskId: String) = MobileStateActionResult("unused", true)
            override suspend fun enqueueReopenTask(taskId: String) = MobileStateActionResult("unused", true)
        }
        val viewModel = TodayViewModel(repository, Dispatchers.Unconfined)
        val task = sampleTask().copy(themeId = "theme-old")

        runBlocking { viewModel.updateTaskThemeNow(task, "theme-1") }

        assertEquals(listOf(MobileTheme("theme-1", "研究Theme")), viewModel.themes.value)
        val catalog = viewModel.themeCatalogState.value as MobileThemeCatalogState.Available
        assertEquals("server-1", catalog.serverId)
        assertEquals(7, catalog.serverRevision)
        assertTrue(called)
        assertEquals("theme-1", receivedThemeId)
        assertEquals(TaskActionUiState.Queued(task.id), viewModel.taskActionState.value)
    }

    @Test
    fun discardRejectedThemeDelegatesPersistentCommandAndReportsRecovery() {
        var discarded: Pair<String, String>? = null
        val repository = object : MobileTaskRepository, MobileOfflineTaskRepository {
            override fun loadToday() = MobileTodayResult.Available(emptyList(), "2026-08-21T10:00:00.000Z")
            override fun observeCachedTasks(): Flow<List<MobileTask>> = flowOf(emptyList())
            override fun observePendingCount(): Flow<Int> = flowOf(0)
            override suspend fun enqueueCreateTask(draft: MobileCaptureDraft, todayDate: java.time.LocalDate?) = "unused"
            override suspend fun enqueueCompleteTask(taskId: String) = MobileStateActionResult("unused", true)
            override suspend fun enqueueReopenTask(taskId: String) = MobileStateActionResult("unused", true)
            override suspend fun discardRejectedThemeUpdate(taskId: String, commandId: String) {
                discarded = taskId to commandId
            }
        }
        val task = sampleTask().copy(
            rejectedThemeUpdate = MobileRejectedThemeUpdate(
                commandId = "rejected-command",
                attemptedThemeId = "theme-deleted",
                code = "theme_not_found",
                message = "選択したThemeは削除済みか利用できません。",
                rejectedAt = "2026-08-22T02:00:00Z",
            ),
        )
        val viewModel = TodayViewModel(repository, Dispatchers.Unconfined)

        runBlocking { viewModel.discardRejectedThemeUpdateNow(task) }

        assertEquals(task.id to "rejected-command", discarded)
        assertEquals(TaskActionUiState.RejectedThemeDismissed(task.id), viewModel.taskActionState.value)
    }

    @Test
    fun pairFailureKeepsPairingFormAndOrigin() {
        val repository = object : MobileTaskRepository, MobileGatewayRepository {
            override fun loadToday() = MobileTodayResult.PairingRequired("https://old.example.ts.net")
            override fun configuration() = MobileGatewayConfiguration("https://old.example.ts.net", paired = false)
            override fun pair(origin: String, pairingCode: String) = MobileTodayResult.PairingRequired(
                origin,
                "ペアリングできませんでした。Desktopで新しいコードを発行してください。",
            )
            override fun retryPairing() = MobileTodayResult.PairingRequired(configuration().origin)
        }
        val viewModel = TodayViewModel(repository, Dispatchers.Unconfined)

        runBlocking { viewModel.pairNow("https://desktop.example.ts.net:48178", "12345678") }

        val state = viewModel.uiState.value as TodayUiState.PairingRequired
        assertEquals("https://desktop.example.ts.net:48178", state.origin)
        assertEquals("ペアリングできませんでした。Desktopで新しいコードを発行してください。", state.message)
    }

    @Test
    fun retryPairingReturnsToPairingFormWithSavedOrigin() {
        val origin = "https://desktop-55avlhd.tail4d1e1e.ts.net:48178"
        val repository = object : MobileTaskRepository, MobileGatewayRepository {
            override fun loadToday() = MobileTodayResult.Unavailable(
                "Mobile Gatewayに接続できません。",
                "DesktopとTailscale接続を確認して再読み込みするか、やり直してURLとコードを入力し直してください。",
            )
            override fun configuration() = MobileGatewayConfiguration(origin, paired = true)
            override fun pair(origin: String, pairingCode: String) = loadToday()
            override fun retryPairing() = MobileTodayResult.PairingRequired(origin)
        }
        val viewModel = TodayViewModel(repository, Dispatchers.Unconfined)
        runBlocking { viewModel.loadNow() }
        assertTrue(viewModel.uiState.value is TodayUiState.Error)

        viewModel.retryPairing()

        val state = viewModel.uiState.value as TodayUiState.PairingRequired
        assertEquals(origin, state.origin)
        assertEquals("", state.message)
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
