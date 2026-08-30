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
    fun workReceiptLoadProjectsCachedWarningAndSupportsExplicitRetry() {
        var calls = 0
        val detail = MobileWorkReceiptDetail(
            id = "receipt-1",
            taskId = "task-1",
            executorKind = "ai_agent",
            executorLabel = "Codex",
            startedAt = null,
            reportedAt = "2026-08-21T10:00:00Z",
            reportKind = "report",
            summary = "確認してください。",
            completedItems = listOf("実装"),
            changedOrCreatedItems = emptyList(),
            verification = emptyList(),
            remainingWork = emptyList(),
            externalReferences = emptyList(),
            truncated = false,
        )
        val repository = object : MobileGatewayRepository {
            override fun loadToday() = MobileTodayResult.Available(emptyList(), "")
            override fun configuration() = MobileGatewayConfiguration("https://gateway.test", true)
            override fun pair(origin: String, pairingCode: String) = loadToday()
            override fun retryPairing() = MobileTodayResult.PairingRequired()
            override suspend fun loadWorkReceipt(taskId: String, receiptId: String): MobileWorkReceiptLoadResult {
                calls += 1
                return MobileWorkReceiptLoadResult.Available(
                    detail = detail,
                    fromCache = true,
                    warning = "保存済みです。",
                )
            }
        }
        val viewModel = TodayViewModel(repository, Dispatchers.Unconfined)

        viewModel.loadWorkReceipt("task-1", "receipt-1")
        val first = viewModel.workReceiptDetailState.value as WorkReceiptDetailUiState.Available
        assertEquals(detail, first.detail)
        assertEquals(true, first.fromCache)
        assertEquals("保存済みです。", first.warning)

        viewModel.loadWorkReceipt("task-1", "receipt-1")
        assertEquals(1, calls)
        viewModel.loadWorkReceipt("task-1", "receipt-1", force = true)
        assertEquals(2, calls)
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
    fun lostPairingKeepsRoomCacheVisibleWithReconnectState() {
        val cached = sampleTask().copy(title = "Pending after restart", pending = true)
        val origin = "https://desktop.example.ts.net:48178"
        val repository = object : MobileTaskRepository, MobileOfflineTaskRepository {
            override fun loadToday() = MobileTodayResult.PairingRequired(origin)
            override fun observeCachedTasks(): Flow<List<MobileTask>> = flowOf(listOf(cached))
            override fun observePendingCount(): Flow<Int> = flowOf(1)
            override suspend fun enqueueCreateTask(draft: MobileCaptureDraft, todayDate: java.time.LocalDate?) = "unused"
            override suspend fun enqueueCompleteTask(taskId: String) = MobileStateActionResult("unused", true)
            override suspend fun enqueueReopenTask(taskId: String) = MobileStateActionResult("unused", true)
        }
        val viewModel = TodayViewModel(repository, Dispatchers.Unconfined)

        runBlocking { viewModel.loadNow() }

        val state = viewModel.uiState.value as TodayUiState.Cached
        assertEquals("Pending after restart", state.tasks.single().title)
        assertEquals(origin, state.pairing.origin)
        assertEquals(1, viewModel.pendingCount.value)
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
            viewModel.createCaptureNow(
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
        assertEquals(
            CaptureUiState.Queued("queued-task-id", MobileCaptureKind.Task),
            viewModel.captureState.value,
        )
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
            viewModel.createCaptureNow(
                MobileCaptureDraft.fresh(text = "続けて追加"),
                CaptureCompletionBehavior.Continue,
            )
        }

        assertEquals(
            CaptureUiState.Queued(
                "continued-task",
                MobileCaptureKind.Task,
                CaptureCompletionBehavior.Continue,
            ),
            viewModel.captureState.value,
        )
    }

    @Test
    fun createCaptureUsesCanonicalCaptureQueue() {
        var receivedDraft: MobileCaptureDraft? = null
        val repository = object : MobileTaskRepository, MobileOfflineTaskRepository {
            override fun loadToday() = MobileTodayResult.Available(emptyList(), "2026-08-21T10:00:00.000Z")
            override fun observeCachedTasks(): Flow<List<MobileTask>> = flowOf(emptyList())
            override fun observePendingCount(): Flow<Int> = flowOf(0)
            override suspend fun enqueueCreateTask(draft: MobileCaptureDraft, todayDate: java.time.LocalDate?) =
                error("Task path must not be used")
            override suspend fun enqueueCreateCapture(draft: MobileCaptureDraft): String {
                receivedDraft = draft
                return "queued-capture-id"
            }
            override suspend fun enqueueCompleteTask(taskId: String) = MobileStateActionResult("unused", true)
            override suspend fun enqueueReopenTask(taskId: String) = MobileStateActionResult("unused", true)
        }
        val viewModel = TodayViewModel(repository)

        runBlocking {
            viewModel.createCaptureNow(
                MobileCaptureDraft.fresh(text = "  共有メモ  ", kind = MobileCaptureKind.Capture),
            )
        }

        assertEquals("共有メモ", receivedDraft?.text)
        assertEquals(MobileCaptureKind.Capture, receivedDraft?.kind)
        assertEquals(
            CaptureUiState.Queued("queued-capture-id", MobileCaptureKind.Capture),
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

        runBlocking { viewModel.undoCreatedCaptureNow("task-local", MobileCaptureKind.Task) }
        assertEquals(
            TaskActionUiState.Queued(
                taskId = "task-local",
                requiresSync = false,
                message = "Task追加を元に戻しました。",
            ),
            viewModel.taskActionState.value,
        )

        requiresSync = true
        runBlocking { viewModel.undoCreatedCaptureNow("task-canonical", MobileCaptureKind.Task) }
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

        runBlocking { viewModel.createCaptureNow(MobileCaptureDraft.fresh(text = "   ")) }

        assertEquals(CaptureUiState.Error("Taskの内容を入力してください。"), viewModel.captureState.value)
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
    fun safeShareRemainsPendingUntilTheMatchingShareIsConsumed() {
        val task = sampleTask().copy(version = 3, workState = "not_delegated")
        val previewData = MobileTaskContextPreviewDataDto(
            contextFingerprint = "fingerprint-1",
            task = MobileTaskContextPreviewTaskDto(
                id = task.id,
                version = task.version,
                title = task.title,
                description = null,
                state = task.state,
                workState = task.workState.orEmpty(),
                updatedAt = task.updatedAt,
            ),
            related = MobileTaskContextPreviewRelatedDto(),
            contextSelection = MobileTaskContextSelectionDto(schema = "task-context-selection/v1", truncated = false),
        )
        val preview = MobileTaskContextPreview(
            taskId = task.id,
            taskVersion = task.version,
            fingerprint = previewData.contextFingerprint,
            title = task.title,
            includedCount = 0,
            excludedCount = 0,
            truncated = false,
            warnings = emptyList(),
            data = previewData,
        )
        val share = MobileSafeShareDto(
            mimeType = "text/plain",
            title = task.title,
            taskId = task.id,
            taskLocator = "tasken://task/${task.id}",
            text = "Delegate ${task.title}",
        )
        val repository = object : MobileGatewayRepository {
            override fun loadToday() = MobileTodayResult.Available(listOf(task), "2026-08-30T00:00:00Z")
            override fun configuration() = MobileGatewayConfiguration("https://gateway.test", paired = true)
            override fun pair(origin: String, pairingCode: String) = loadToday()
            override fun retryPairing() = MobileTodayResult.PairingRequired()
            override suspend fun previewTaskContext(task: MobileTask) = MobileTaskContextPreviewResult.Available(preview)
            override suspend fun delegateTask(
                task: MobileTask,
                preview: MobileTaskContextPreview,
                expectedResult: String?,
                instruction: String?,
            ) = MobileTaskDelegationResult.Applied(task.id, share)
        }
        val viewModel = TodayViewModel(repository, Dispatchers.Unconfined)

        runBlocking {
            viewModel.previewTaskContextNow(task)
            viewModel.delegateTaskNow(task, "PR", null)
        }

        assertEquals(share, viewModel.pendingSafeShare.value)
        viewModel.consumeSafeShare(share.copy(taskId = "other"))
        assertEquals(share, viewModel.pendingSafeShare.value)
        viewModel.consumeSafeShare(share)
        assertNull(viewModel.pendingSafeShare.value)
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
    fun proposalReviewRequiresOnlineRefreshAndProjectsCanonicalResult() {
        var received: Pair<String, String>? = null
        val repository = object : MobileGatewayRepository {
            override fun loadToday() = MobileTodayResult.Available(emptyList(), "2026-08-23T00:00:00Z")
            override fun configuration() = MobileGatewayConfiguration("https://gateway.test", paired = true)
            override fun pair(origin: String, pairingCode: String) = loadToday()
            override fun retryPairing() = MobileTodayResult.PairingRequired()
            override suspend fun refreshTaskWorkProposals() = true
            override suspend fun reviewTaskWorkProposal(
                proposal: MobileTaskWorkProposal,
                decision: String,
            ): MobileProposalReviewResult {
                received = proposal.id to decision
                return MobileProposalReviewResult.Applied(proposal.id, decision)
            }
        }
        val viewModel = TodayViewModel(repository, Dispatchers.Unconfined)
        val proposal = sampleProposal()

        runBlocking {
            viewModel.loadNow()
            viewModel.reviewTaskWorkProposalNow(proposal, "accept")
        }

        assertEquals(true, viewModel.proposalReviewOnline.value)
        assertEquals(proposal.id to "accept", received)
        assertEquals(ProposalReviewUiState.Applied(proposal.id, "accept"), viewModel.proposalReviewState.value)
    }

    @Test
    fun staleOrOfflineProposalCannotBeAccepted() {
        var calls = 0
        val repository = object : MobileGatewayRepository {
            override fun loadToday() = MobileTodayResult.Available(emptyList(), "2026-08-23T00:00:00Z")
            override fun configuration() = MobileGatewayConfiguration("https://gateway.test", paired = true)
            override fun pair(origin: String, pairingCode: String) = loadToday()
            override fun retryPairing() = MobileTodayResult.PairingRequired()
            override suspend fun refreshTaskWorkProposals() = false
            override suspend fun reviewTaskWorkProposal(
                proposal: MobileTaskWorkProposal,
                decision: String,
            ): MobileProposalReviewResult {
                calls += 1
                return MobileProposalReviewResult.Applied(proposal.id, decision)
            }
        }
        val viewModel = TodayViewModel(repository, Dispatchers.Unconfined)

        runBlocking {
            viewModel.loadNow()
            viewModel.reviewTaskWorkProposalNow(sampleProposal(), "accept")
        }
        assertTrue((viewModel.proposalReviewState.value as ProposalReviewUiState.Error).message.contains("Desktop"))
        assertEquals(0, calls)

        runBlocking { viewModel.reviewTaskWorkProposalNow(sampleProposal().copy(stale = true), "accept") }
        assertTrue((viewModel.proposalReviewState.value as ProposalReviewUiState.Error).message.contains("更新"))
        assertEquals(0, calls)
    }

    @Test
    fun humanReviewUsesLatestReceiptAndKeepsBlockedReplyCanonical() {
        var received: Triple<String, String, String?>? = null
        val repository = object : MobileGatewayRepository {
            override fun loadToday() = MobileTodayResult.Available(emptyList(), "2026-08-23T00:00:00Z")
            override fun configuration() = MobileGatewayConfiguration(
                "https://gateway.test",
                paired = true,
                scopes = setOf("mobile:human-review"),
            )
            override fun pair(origin: String, pairingCode: String) = loadToday()
            override fun retryPairing() = MobileTodayResult.PairingRequired()
            override suspend fun refreshTaskWorkProposals() = true
            override suspend fun reviewTaskWork(
                task: MobileTask,
                action: String,
                reviewNote: String?,
            ): MobileHumanReviewResult {
                received = Triple(task.latestWorkReceipt?.id.orEmpty(), action, reviewNote)
                return MobileHumanReviewResult.Applied(task.id, action)
            }
        }
        val viewModel = TodayViewModel(repository, Dispatchers.Unconfined)
        val task = sampleTask().copy(
            version = 4,
            workState = "blocked",
            latestWorkReceipt = MobileWorkReceiptSummary(
                id = "receipt-blocked",
                reportedAt = "2026-08-23T00:00:00Z",
                executorLabel = "Hermes",
                summary = "入力が必要です。",
            ),
        )

        runBlocking {
            viewModel.loadNow()
            viewModel.reviewTaskWorkNow(task, "return", "  設定値はalphaです。  ")
        }

        assertEquals(Triple("receipt-blocked", "return", "設定値はalphaです。"), received)
        assertEquals(HumanReviewUiState.Applied(task.id, "return"), viewModel.humanReviewState.value)
    }

    @Test
    fun unpairedOrUnsyncedHumanReviewIsRejectedBeforeNetwork() {
        var calls = 0
        val repository = object : MobileGatewayRepository {
            override fun loadToday() = MobileTodayResult.Available(emptyList(), "2026-08-23T00:00:00Z")
            override fun configuration() = MobileGatewayConfiguration("https://gateway.test", paired = false)
            override fun pair(origin: String, pairingCode: String) = loadToday()
            override fun retryPairing() = MobileTodayResult.PairingRequired()
            override suspend fun refreshTaskWorkProposals() = false
            override suspend fun reviewTaskWork(
                task: MobileTask,
                action: String,
                reviewNote: String?,
            ): MobileHumanReviewResult {
                calls += 1
                return MobileHumanReviewResult.Applied(task.id, action)
            }
        }
        val viewModel = TodayViewModel(repository, Dispatchers.Unconfined)
        val task = sampleTask().copy(
            version = 4,
            workState = "needs_human_review",
            latestWorkReceipt = MobileWorkReceiptSummary("receipt-1", "2026-08-23T00:00:00Z", "Hermes", "確認してください。"),
        )

        runBlocking {
            viewModel.loadNow()
            viewModel.reviewTaskWorkNow(task, "accept")
        }

        assertTrue((viewModel.humanReviewState.value as HumanReviewUiState.Unavailable).message.contains("Desktop"))
        assertEquals(0, calls)
        runBlocking { viewModel.reviewTaskWorkNow(task.copy(version = 0), "accept") }
        assertTrue((viewModel.humanReviewState.value as HumanReviewUiState.Conflict).message.contains("同期"))
        assertEquals(0, calls)
    }

    @Test
    fun humanReviewAvailabilityDoesNotDependOnProposalRefresh() {
        var calls = 0
        val repository = object : MobileGatewayRepository {
            override fun loadToday() = MobileTodayResult.Available(emptyList(), "2026-08-23T00:00:00Z")
            override fun configuration() = MobileGatewayConfiguration(
                "https://gateway.test",
                paired = true,
                scopes = setOf("mobile:human-review"),
            )
            override fun pair(origin: String, pairingCode: String) = loadToday()
            override fun retryPairing() = MobileTodayResult.PairingRequired()
            override suspend fun refreshTaskWorkProposals() = false
            override suspend fun reviewTaskWork(
                task: MobileTask,
                action: String,
                reviewNote: String?,
            ): MobileHumanReviewResult {
                calls += 1
                return MobileHumanReviewResult.Applied(task.id, action)
            }
        }
        val viewModel = TodayViewModel(repository, Dispatchers.Unconfined)
        val task = sampleTask().copy(
            version = 4,
            workState = "needs_human_review",
            latestWorkReceipt = MobileWorkReceiptSummary("receipt-1", "2026-08-23T00:00:00Z", "Hermes", "review ready"),
        )

        runBlocking {
            viewModel.loadNow()
            viewModel.reviewTaskWorkNow(task, "accept")
        }

        assertTrue(viewModel.humanReviewOnline.value)
        assertEquals(1, calls)
        assertEquals(HumanReviewUiState.Applied(task.id, "accept"), viewModel.humanReviewState.value)
    }

    @Test
    fun humanReviewOutcomeStatesRemainDistinct() {
        var nextResult: MobileHumanReviewResult = MobileHumanReviewResult.Applied("task-1", "accept")
        val repository = object : MobileGatewayRepository {
            override fun loadToday() = MobileTodayResult.Available(emptyList(), "2026-08-23T00:00:00Z")
            override fun configuration() = MobileGatewayConfiguration(
                "https://gateway.test",
                paired = true,
                scopes = setOf("mobile:human-review"),
            )
            override fun pair(origin: String, pairingCode: String) = loadToday()
            override fun retryPairing() = MobileTodayResult.PairingRequired()
            override suspend fun refreshTaskWorkProposals() = false
            override suspend fun reviewTaskWork(
                task: MobileTask,
                action: String,
                reviewNote: String?,
            ): MobileHumanReviewResult = nextResult
        }
        val viewModel = TodayViewModel(repository, Dispatchers.Unconfined)
        val task = sampleTask().copy(
            version = 4,
            latestWorkReceipt = MobileWorkReceiptSummary("receipt-1", "2026-08-23T00:00:00Z", "Hermes", "review ready"),
        )

        runBlocking { viewModel.loadNow() }
        nextResult = MobileHumanReviewResult.Conflict(task.id, "Task conflict")
        runBlocking { viewModel.reviewTaskWorkNow(task, "accept") }
        assertEquals(HumanReviewUiState.Conflict(task.id, "Task conflict"), viewModel.humanReviewState.value)
        assertTrue(viewModel.humanReviewOnline.value)

        nextResult = MobileHumanReviewResult.Rejected(task.id, "Receipt cannot be reviewed")
        runBlocking { viewModel.reviewTaskWorkNow(task, "accept") }
        assertEquals(HumanReviewUiState.Rejected(task.id, "Receipt cannot be reviewed"), viewModel.humanReviewState.value)
        assertTrue(viewModel.humanReviewOnline.value)

        nextResult = MobileHumanReviewResult.Unavailable(task.id, "Gateway unavailable")
        runBlocking { viewModel.reviewTaskWorkNow(task, "accept") }
        assertEquals(HumanReviewUiState.Unavailable(task.id, "Gateway unavailable"), viewModel.humanReviewState.value)
        assertEquals(false, viewModel.humanReviewOnline.value)
    }

    @Test
    fun humanReviewRequiresNewPairingWhenScopeIsMissing() {
        var calls = 0
        val repository = object : MobileGatewayRepository {
            override fun loadToday() = MobileTodayResult.Available(emptyList(), "2026-08-23T00:00:00Z")
            override fun configuration() = MobileGatewayConfiguration(
                "https://gateway.test",
                paired = true,
                scopes = setOf("mobile:read"),
            )
            override fun pair(origin: String, pairingCode: String) = loadToday()
            override fun retryPairing() = MobileTodayResult.PairingRequired()
            override suspend fun refreshTaskWorkProposals() = false
            override suspend fun reviewTaskWork(
                task: MobileTask,
                action: String,
                reviewNote: String?,
            ): MobileHumanReviewResult {
                calls += 1
                return MobileHumanReviewResult.Applied(task.id, action)
            }
        }
        val viewModel = TodayViewModel(repository, Dispatchers.Unconfined)
        val task = sampleTask().copy(
            version = 4,
            latestWorkReceipt = MobileWorkReceiptSummary("receipt-1", "2026-08-23T00:00:00Z", "Hermes", "review ready"),
        )

        runBlocking {
            viewModel.loadNow()
            viewModel.reviewTaskWorkNow(task, "accept")
        }

        assertEquals(false, viewModel.humanReviewOnline.value)
        assertTrue(viewModel.humanReviewRequiresRePairing.value)
        assertEquals(0, calls)
        assertTrue((viewModel.humanReviewState.value as HumanReviewUiState.Unavailable).message.contains("再ペアリング"))
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

    private fun sampleProposal() = MobileTaskWorkProposal(
        id = "11111111-1111-5111-8111-111111111111",
        version = 1,
        taskId = sampleTask().id,
        taskVersion = 3,
        taskTitle = sampleTask().title,
        themeId = null,
        workState = "in_progress",
        action = "report_done",
        caller = "Hermes",
        sourceApp = "hermes-discord",
        receivedAt = "2026-08-23T00:00:00Z",
        expectedTaskVersion = 3,
        stale = false,
        executorLabel = "Hermes",
        startedAt = null,
        reportedAt = "2026-08-23T00:00:00Z",
        summary = "確認してください。",
        completedItems = listOf("実装"),
        changedOrCreatedItems = emptyList(),
        verification = emptyList(),
        remainingWork = emptyList(),
        externalReferences = emptyList(),
        truncated = false,
    )
}
