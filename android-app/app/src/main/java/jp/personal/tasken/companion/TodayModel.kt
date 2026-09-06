package jp.personal.tasken.companion

import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.lifecycle.ViewModel
import androidx.lifecycle.ViewModelProvider
import androidx.lifecycle.viewModelScope
import kotlinx.coroutines.CoroutineDispatcher
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.currentCoroutineContext
import kotlinx.coroutines.ensureActive
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.launch
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.withContext
import kotlinx.serialization.Serializable

data class MobileTask(
    val id: String,
    val title: String,
    val themeId: String?,
    val state: String,
    val workState: String?,
    val updatedAt: String,
    val todayDate: String? = null,
    val plannedStartTime: String? = null,
    val plannedDurationMinutes: Int? = null,
    val latestWorkReceipt: MobileWorkReceiptSummary? = null,
    val checklistItems: List<MobileChecklistItem> = emptyList(),
    val schedule: MobileTaskSchedule? = null,
    val pending: Boolean = false,
    val conflict: MobileTaskConflict? = null,
    val canChangePendingState: Boolean = false,
    val canEditPendingChecklist: Boolean = false,
    val canEditPendingCreate: Boolean = false,
    val canEditPendingTask: Boolean = false,
    val heldChanges: List<MobileHeldTaskChange> = emptyList(),
    val rejectedThemeUpdate: MobileRejectedThemeUpdate? = null,
    val version: Int = 0,
    val description: String? = null,
)

@Serializable
data class MobileChecklistItem(
    val id: String,
    val title: String,
    val done: Boolean,
    val sortOrder: Double,
    val completedAt: String? = null,
)

data class MobileTaskSchedule(
    val id: String?,
    val version: Int?,
    val startDate: String?,
    val endDate: String?,
    val dateKind: String,
    val rangeSemantics: String?,
    val confidence: String = "fixed",
    val granularity: String = "day",
)

data class MobileTaskScheduleDraft(
    val startDate: String?,
    val endDate: String?,
    val rangeSemantics: String?,
    val plannedStartTime: String? = null,
    val plannedDurationMinutes: Int? = null,
)

data class MobileWorkReceiptSummary(
    val id: String,
    val reportedAt: String,
    val executorLabel: String,
    val summary: String,
)

data class MobileWorkReceiptDetail(
    val id: String,
    val taskId: String,
    val executorKind: String,
    val executorLabel: String,
    val startedAt: String?,
    val reportedAt: String,
    val reportKind: String,
    val summary: String,
    val completedItems: List<String>,
    val changedOrCreatedItems: List<String>,
    val verification: List<String>,
    val remainingWork: List<String>,
    val externalReferences: List<MobileWorkReceiptExternalReference>,
    val truncated: Boolean,
)

data class MobileWorkReceiptExternalReference(
    val kind: String,
    val provider: String?,
    val displayLabel: String,
    val url: String,
    val externalId: String?,
)

data class MobileTaskWorkProposal(
    val id: String,
    val version: Int,
    val taskId: String,
    val taskVersion: Int,
    val taskTitle: String,
    val themeId: String?,
    val workState: String?,
    val action: String,
    val caller: String,
    val sourceApp: String,
    val receivedAt: String,
    val expectedTaskVersion: Int,
    val stale: Boolean,
    val executorLabel: String?,
    val startedAt: String?,
    val reportedAt: String?,
    val summary: String?,
    val completedItems: List<String>,
    val changedOrCreatedItems: List<String>,
    val verification: List<String>,
    val remainingWork: List<String>,
    val externalReferences: List<MobileWorkReceiptExternalReference>,
    val truncated: Boolean,
)

sealed interface MobileProposalReviewResult {
    data class Applied(val proposalId: String, val decision: String) : MobileProposalReviewResult
    data class Conflict(val proposalId: String, val message: String) : MobileProposalReviewResult
    data class Unavailable(val proposalId: String, val message: String) : MobileProposalReviewResult
}

sealed interface ProposalReviewUiState {
    data object Idle : ProposalReviewUiState
    data class Reviewing(val proposalId: String, val decision: String) : ProposalReviewUiState
    data class Applied(val proposalId: String, val decision: String) : ProposalReviewUiState
    data class Error(val proposalId: String, val message: String) : ProposalReviewUiState
}

sealed interface MobileHumanReviewResult {
    data class Applied(val taskId: String, val action: String) : MobileHumanReviewResult
    data class Conflict(val taskId: String, val message: String) : MobileHumanReviewResult
    data class Rejected(val taskId: String, val message: String) : MobileHumanReviewResult
    data class Unavailable(val taskId: String, val message: String) : MobileHumanReviewResult
}

data class MobileHumanReviewPending(
    val taskId: String,
    val action: String,
)

sealed interface HumanReviewUiState {
    data object Idle : HumanReviewUiState
    data class Reviewing(val pending: MobileHumanReviewPending) : HumanReviewUiState
    data class Applied(val taskId: String, val action: String) : HumanReviewUiState
    data class Conflict(val taskId: String, val message: String) : HumanReviewUiState
    data class Rejected(val taskId: String, val message: String) : HumanReviewUiState
    data class Unavailable(val taskId: String, val message: String) : HumanReviewUiState
}

sealed interface TaskDelegationUiState {
    data object Idle : TaskDelegationUiState
    data class PreviewLoading(val taskId: String) : TaskDelegationUiState
    data class PreviewAvailable(val preview: MobileTaskContextPreview) : TaskDelegationUiState
    data class Delegating(val taskId: String) : TaskDelegationUiState
    data class Applied(val taskId: String) : TaskDelegationUiState
    data class Conflict(val taskId: String, val message: String) : TaskDelegationUiState
    data class Rejected(val taskId: String, val message: String) : TaskDelegationUiState
    data class Unavailable(val taskId: String, val message: String) : TaskDelegationUiState
}

sealed interface MobileAiReadyResult {
    data class Applied(val taskId: String, val enabled: Boolean) : MobileAiReadyResult
    data class Conflict(val taskId: String, val message: String) : MobileAiReadyResult
    data class Rejected(val taskId: String, val message: String) : MobileAiReadyResult
    data class Unavailable(val taskId: String, val message: String) : MobileAiReadyResult
}

sealed interface AiReadyUiState {
    data object Idle : AiReadyUiState
    data class Updating(val taskId: String, val enabled: Boolean) : AiReadyUiState
    data class Applied(val taskId: String, val enabled: Boolean) : AiReadyUiState
    data class Conflict(val taskId: String, val message: String) : AiReadyUiState
    data class Rejected(val taskId: String, val message: String) : AiReadyUiState
    data class Unavailable(val taskId: String, val message: String) : AiReadyUiState
}

sealed interface MobileWorkReceiptLoadResult {
    data class Available(
        val detail: MobileWorkReceiptDetail,
        val fromCache: Boolean,
        val warning: String? = null,
    ) : MobileWorkReceiptLoadResult

    data class Unavailable(val receiptId: String, val message: String) : MobileWorkReceiptLoadResult
}

sealed interface WorkReceiptDetailUiState {
    data object Idle : WorkReceiptDetailUiState
    data class Loading(val receiptId: String) : WorkReceiptDetailUiState
    data class Available(
        val detail: MobileWorkReceiptDetail,
        val fromCache: Boolean,
        val warning: String? = null,
    ) : WorkReceiptDetailUiState
    data class Error(val receiptId: String, val message: String) : WorkReceiptDetailUiState
}

data class MobileRejectedThemeUpdate(
    val commandId: String,
    val attemptedThemeId: String?,
    val code: String,
    val message: String,
    val rejectedAt: String,
)

data class MobileTheme(
    val id: String,
    val title: String,
    val color: String? = null,
)

sealed interface MobileThemeCatalogState {
    val themes: List<MobileTheme>

    data class Loading(
        override val themes: List<MobileTheme> = emptyList(),
        val serverId: String? = null,
        val serverRevision: Int? = null,
    ) : MobileThemeCatalogState

    data class Available(
        override val themes: List<MobileTheme>,
        val serverId: String,
        val serverRevision: Int,
        val generatedAt: String,
    ) : MobileThemeCatalogState

    data class Stale(
        override val themes: List<MobileTheme>,
        val serverId: String,
        val serverRevision: Int,
        val generatedAt: String,
        val message: String,
    ) : MobileThemeCatalogState

    data class Unsupported(
        val serverId: String,
        val message: String,
    ) : MobileThemeCatalogState {
        override val themes: List<MobileTheme> = emptyList()
    }

    data class Error(
        val serverId: String,
        val message: String,
    ) : MobileThemeCatalogState {
        override val themes: List<MobileTheme> = emptyList()
    }
}

data class MobileTaskConflict(
    val commandId: String,
    val intendedAction: String,
    val expectedVersion: Int,
    val serverVersion: Int,
    val serverState: String,
    val localTitle: String? = null,
    val detectedAt: String,
    val serverTodayDate: String? = null,
    val localTodayDate: String? = null,
    val localTodayDateChanged: Boolean = false,
    val serverThemeId: String? = null,
    val localThemeId: String? = null,
    val localThemeIdChanged: Boolean = false,
    val serverChecklistItems: List<MobileChecklistItem> = emptyList(),
    val localChecklistItems: List<MobileChecklistItem> = emptyList(),
    val localChecklistItemsChanged: Boolean = false,
    val serverSchedule: MobileTaskSchedule? = null,
    val localSchedule: MobileTaskScheduleDraft? = null,
    val localScheduleChanged: Boolean = false,
    val serverPlannedStartTime: String? = null,
    val serverPlannedDurationMinutes: Int? = null,
    val localPlannedStartTime: String? = null,
    val localPlannedDurationMinutes: Int? = null,
    val localPlannedScheduleChanged: Boolean = false,
)

sealed interface MobileTodayResult {
    data class Available(val tasks: List<MobileTask>, val generatedAt: String) : MobileTodayResult
    data class Unavailable(val message: String, val recovery: String) : MobileTodayResult
    data class PairingRequired(val origin: String = "", val message: String = "") : MobileTodayResult
}

interface MobileTaskRepository {
    fun loadToday(): MobileTodayResult
}

class DisconnectedMobileTaskRepository : MobileTaskRepository {
    override fun loadToday(): MobileTodayResult = MobileTodayResult.PairingRequired()
}

sealed interface TodayUiState {
    data object Loading : TodayUiState
    data object Empty : TodayUiState
    data class PairingRequired(val origin: String, val message: String = "") : TodayUiState
    data class Error(val message: String, val recovery: String) : TodayUiState
    enum class CachedRecovery { Reload, RePair }
    data class Cached(
        val tasks: List<MobileTask>,
        val generatedAt: String,
        val message: String,
        val recovery: CachedRecovery,
    ) : TodayUiState
    data class Success(val tasks: List<MobileTask>, val generatedAt: String) : TodayUiState
}

data class MobileTodayCache(
    val tasks: List<MobileTask>,
    val hasStoredTasks: Boolean,
    val lastSuccessfulSyncAt: String? = null,
)

enum class CaptureCompletionBehavior { Close, Continue }

sealed interface CaptureUiState {
    data object Idle : CaptureUiState
    data object Saving : CaptureUiState
    data class Queued(
        val entityId: String,
        val kind: MobileCaptureKind,
        val completionBehavior: CaptureCompletionBehavior = CaptureCompletionBehavior.Close,
        val additionalEntityIds: List<String> = emptyList(),
    ) : CaptureUiState
    data class Error(val message: String) : CaptureUiState
}

sealed interface TaskActionUiState {
    data object Idle : TaskActionUiState
    data class Saving(val taskId: String) : TaskActionUiState
    data class Queued(
        val taskId: String,
        val requiresSync: Boolean = true,
        val message: String? = null,
    ) : TaskActionUiState
    data class ConflictResolved(val taskId: String, val keptLocal: Boolean) : TaskActionUiState
    data class RejectedThemeDismissed(val taskId: String) : TaskActionUiState
    data class Error(val taskId: String, val message: String) : TaskActionUiState
}

class TodayViewModel(
    private val repository: MobileTaskRepository = DisconnectedMobileTaskRepository(),
    private val ioDispatcher: CoroutineDispatcher = Dispatchers.IO,
    private val refreshExternalProjection: () -> Unit = {},
    private val today: () -> java.time.LocalDate = java.time.LocalDate::now,
) : ViewModel() {
    val workLogRepository: MobileWorkLogRepository? get() = repository as? MobileWorkLogRepository
    val recallRepository: MobileRecallRepository? get() = repository as? MobileRecallRepository
    val relatedDocumentsRepository: MobileRelatedDocumentsRepository? get() = repository as? MobileRelatedDocumentsRepository
    suspend fun organizeCapture(draft: MobileCaptureDraft): List<MobileCaptureOrganization> =
        kotlinx.coroutines.withContext(ioDispatcher) {
            val gateway = repository as? MobileGatewayRepository
                ?: error("Desktopへ接続するとAI整理を利用できます。")
            gateway.organizeCapture(draft)
        }
    private val mutableUiState = MutableStateFlow<TodayUiState>(TodayUiState.Loading)
    val uiState: StateFlow<TodayUiState> = mutableUiState.asStateFlow()
    private val mutableRefreshing = MutableStateFlow(false)
    val refreshing: StateFlow<Boolean> = mutableRefreshing.asStateFlow()
    private val mutableCaptureState = MutableStateFlow<CaptureUiState>(CaptureUiState.Idle)
    val captureState: StateFlow<CaptureUiState> = mutableCaptureState.asStateFlow()
    private val mutablePendingCaptures = MutableStateFlow<List<MobilePendingCapture>>(emptyList())
    val pendingCaptures: StateFlow<List<MobilePendingCapture>> = mutablePendingCaptures.asStateFlow()
    private val mutableTaskActionState = MutableStateFlow<TaskActionUiState>(TaskActionUiState.Idle)
    val taskActionState: StateFlow<TaskActionUiState> = mutableTaskActionState.asStateFlow()
    private val mutablePendingCount = MutableStateFlow<Int?>(null)
    val pendingCount: StateFlow<Int?> = mutablePendingCount.asStateFlow()
    private val mutableConflictCount = MutableStateFlow<Int?>(null)
    val conflictCount: StateFlow<Int?> = mutableConflictCount.asStateFlow()
    private val mutableAllTasks = MutableStateFlow<List<MobileTask>>(emptyList())
    val allTasks: StateFlow<List<MobileTask>> = mutableAllTasks.asStateFlow()
    private val mutableThemes = MutableStateFlow<List<MobileTheme>>(emptyList())
    val themes: StateFlow<List<MobileTheme>> = mutableThemes.asStateFlow()
    private val mutableThemeCatalogState = MutableStateFlow<MobileThemeCatalogState>(
        MobileThemeCatalogState.Loading(),
    )
    val themeCatalogState: StateFlow<MobileThemeCatalogState> = mutableThemeCatalogState.asStateFlow()
    private val mutableWorkReceiptDetailState = MutableStateFlow<WorkReceiptDetailUiState>(
        WorkReceiptDetailUiState.Idle,
    )
    val workReceiptDetailState: StateFlow<WorkReceiptDetailUiState> = mutableWorkReceiptDetailState.asStateFlow()
    private val mutableTaskWorkProposals = MutableStateFlow<List<MobileTaskWorkProposal>>(emptyList())
    val taskWorkProposals: StateFlow<List<MobileTaskWorkProposal>> = mutableTaskWorkProposals.asStateFlow()
    private val mutableProposalReviewOnline = MutableStateFlow(false)
    val proposalReviewOnline: StateFlow<Boolean> = mutableProposalReviewOnline.asStateFlow()
    private val mutableProposalRefreshing = MutableStateFlow(false)
    val proposalRefreshing: StateFlow<Boolean> = mutableProposalRefreshing.asStateFlow()
    private val mutableProposalReviewState = MutableStateFlow<ProposalReviewUiState>(ProposalReviewUiState.Idle)
    val proposalReviewState: StateFlow<ProposalReviewUiState> = mutableProposalReviewState.asStateFlow()
    private val mutableHumanReviewOnline = MutableStateFlow(false)
    val humanReviewOnline: StateFlow<Boolean> = mutableHumanReviewOnline.asStateFlow()
    private val mutableHumanReviewRequiresRePairing = MutableStateFlow(false)
    val humanReviewRequiresRePairing: StateFlow<Boolean> = mutableHumanReviewRequiresRePairing.asStateFlow()
    private val mutableHumanReviewState = MutableStateFlow<HumanReviewUiState>(HumanReviewUiState.Idle)
    val humanReviewState: StateFlow<HumanReviewUiState> = mutableHumanReviewState.asStateFlow()
    private val mutableTaskDelegationState = MutableStateFlow<TaskDelegationUiState>(TaskDelegationUiState.Idle)
    val taskDelegationState: StateFlow<TaskDelegationUiState> = mutableTaskDelegationState.asStateFlow()
    private val mutableAiReadyState = MutableStateFlow<AiReadyUiState>(AiReadyUiState.Idle)
    val aiReadyState: StateFlow<AiReadyUiState> = mutableAiReadyState.asStateFlow()
    private val mutablePendingSafeShare = MutableStateFlow<MobileSafeShareDto?>(null)
    val pendingSafeShare: StateFlow<MobileSafeShareDto?> = mutablePendingSafeShare.asStateFlow()
    private var workReceiptLoadJob: Job? = null
    private var proposalRefreshJob: Job? = null
    private var cacheJob: Job? = null
    private var cacheDate: java.time.LocalDate? = null
    private var cachedGeneratedAt = ""
    private var cachedPairingRequired: MobileTodayResult.PairingRequired? = null
    private var cachedUnavailable: MobileTodayResult.Unavailable? = null
    private var pairingFormOpen = false
    private val connectionGeneration = java.util.concurrent.atomic.AtomicLong()
    private val loadMutex = Mutex()

    init {
        val offlineRepository = repository as? MobileOfflineTaskRepository
        if (offlineRepository != null) {
            observeCache(offlineRepository)
            viewModelScope.launch(ioDispatcher) {
                offlineRepository.observePendingCaptures().collect { mutablePendingCaptures.value = it }
            }
            viewModelScope.launch(ioDispatcher) {
                offlineRepository.observePendingCount().collect { mutablePendingCount.value = it }
            }
            viewModelScope.launch(ioDispatcher) {
                offlineRepository.observeConflictCount().collect { mutableConflictCount.value = it }
            }
            viewModelScope.launch(ioDispatcher) {
                offlineRepository.observeAllCachedTasks().collect { mutableAllTasks.value = it.toList() }
            }
            viewModelScope.launch(ioDispatcher) {
                offlineRepository.observeThemeCatalogState().collect { state ->
                    mutableThemeCatalogState.value = state
                    mutableThemes.value = state.themes.toList()
                }
            }
            viewModelScope.launch(ioDispatcher) {
                offlineRepository.observeCachedTaskWorkProposals().collect { proposals ->
                    mutableTaskWorkProposals.value = proposals.toList()
                }
            }
        }
    }

    fun load() {
        refreshLocalDate()
        viewModelScope.launch { loadNow() }
    }

    fun refreshLocalDate() {
        (repository as? MobileOfflineTaskRepository)?.let(::observeCache)
    }

    internal suspend fun loadNow(): Unit = loadMutex.withLock {
        mutableRefreshing.value = true
        try {
            refreshTodayNow()
        } finally {
            mutableRefreshing.value = false
        }
    }

    private suspend fun refreshTodayNow() {
        val generation = connectionGeneration.get()
        if (pairingFormOpen) return
        val offlineRepository = repository as? MobileOfflineTaskRepository
        if (offlineRepository != null) {
            val cache = currentCache(offlineRepository)
            if (generation != connectionGeneration.get() || pairingFormOpen) return
            applyCacheSnapshot(cache)
        }
        val result = withContext(ioDispatcher) { repository.loadToday() }
        if (generation != connectionGeneration.get() || pairingFormOpen) return
        val gatewayConfiguration = (repository as? MobileGatewayRepository)?.configuration()
        mutableHumanReviewOnline.value = result is MobileTodayResult.Available &&
            gatewayConfiguration?.canReviewWorkReceipts() == true
        mutableHumanReviewRequiresRePairing.value = gatewayConfiguration?.paired == true &&
            !gatewayConfiguration.canReviewWorkReceipts()
        refreshExternalProjection()
        var projectedCache = false
        if (offlineRepository != null) {
            val cache = currentCache(offlineRepository)
            if (generation != connectionGeneration.get() || pairingFormOpen) return
            if (cache.hasStoredTasks || cache.lastSuccessfulSyncAt != null || result is MobileTodayResult.Available) {
                if (result is MobileTodayResult.Available) cachedGeneratedAt = result.generatedAt
                cachedPairingRequired = result as? MobileTodayResult.PairingRequired
                cachedUnavailable = result as? MobileTodayResult.Unavailable
                cache.lastSuccessfulSyncAt?.let { cachedGeneratedAt = it }
                applyCachedTasks(cache.tasks)
                observeCache(offlineRepository)
                projectedCache = true
            }
        }
        if (!projectedCache) {
            cachedPairingRequired = null
            cachedUnavailable = null
            applyResult(result)
        }
        refreshProposals(result !is MobileTodayResult.PairingRequired)
    }

    private fun refreshProposals(canConnect: Boolean) {
        proposalRefreshJob?.cancel()
        mutableProposalReviewOnline.value = false
        val gateway = repository as? MobileGatewayRepository
        if (!canConnect || gateway == null) {
            mutableProposalRefreshing.value = false
            return
        }
        mutableProposalRefreshing.value = true
        proposalRefreshJob = viewModelScope.launch(ioDispatcher) {
            val online = try {
                gateway.refreshTaskWorkProposals()
            } catch (error: CancellationException) {
                throw error
            } catch (_: Exception) {
                // Proposal availability is independent of Today; a failed refresh leaves review offline.
                false
            }
            currentCoroutineContext().ensureActive()
            mutableProposalReviewOnline.value = online
            mutableProposalRefreshing.value = false
        }
    }

    private suspend fun currentCache(repository: MobileOfflineTaskRepository): MobileTodayCache {
        while (true) {
            val date = today()
            observeCache(repository)
            val cache = withContext(ioDispatcher) { repository.observeTodayCache(date).first() }
            if (date == today()) return cache
        }
    }

    private fun observeCache(repository: MobileOfflineTaskRepository) {
        val date = today()
        if (cacheDate == date) return
        cacheJob?.cancel()
        cacheDate = date
        cacheJob = viewModelScope.launch(ioDispatcher) {
            repository.observeTodayCache(date).collect { cache ->
                if (cacheDate == date) applyCacheSnapshot(cache)
            }
        }
    }

    private fun applyCacheSnapshot(cache: MobileTodayCache) {
        cache.lastSuccessfulSyncAt?.let { cachedGeneratedAt = it }
        if (pairingFormOpen) return
        if (cache.hasStoredTasks || cache.lastSuccessfulSyncAt != null ||
            mutableUiState.value is TodayUiState.Success || mutableUiState.value is TodayUiState.Cached ||
            mutableUiState.value == TodayUiState.Empty
        ) applyCachedTasks(cache.tasks)
    }

    private fun applyCachedTasks(tasks: List<MobileTask>) {
        val pairing = cachedPairingRequired
        val unavailable = cachedUnavailable
        mutableUiState.value = if (pairing != null) {
            TodayUiState.Cached(
                tasks = tasks.toList(),
                generatedAt = cachedGeneratedAt,
                message = pairing.message.ifBlank { "保存済みTaskを表示しています。Desktopとの接続をやり直してください。" },
                recovery = TodayUiState.CachedRecovery.RePair,
            )
        } else if (unavailable != null) {
            TodayUiState.Cached(
                tasks = tasks.toList(),
                generatedAt = cachedGeneratedAt,
                message = "${unavailable.message} ${unavailable.recovery}",
                recovery = TodayUiState.CachedRecovery.Reload,
            )
        } else if (tasks.isEmpty() && cachedGeneratedAt.isBlank()) {
            TodayUiState.Empty
        } else {
            TodayUiState.Success(tasks.toList(), cachedGeneratedAt)
        }
    }

    fun pair(origin: String, pairingCode: String) {
        viewModelScope.launch { pairNow(origin, pairingCode) }
    }

    internal suspend fun pairNow(origin: String, pairingCode: String) {
        val gateway = repository as? MobileGatewayRepository ?: return
        val generation = connectionGeneration.incrementAndGet()
        val result = withContext(ioDispatcher) { gateway.pair(origin, pairingCode) }
        if (generation != connectionGeneration.get()) return
        pairingFormOpen = result !is MobileTodayResult.Available
        cachedPairingRequired = null
        cachedUnavailable = null
        applyResult(result)
        refreshProposals(result is MobileTodayResult.Available)
        val configuration = gateway.configuration()
        mutableHumanReviewOnline.value = result is MobileTodayResult.Available && configuration.canReviewWorkReceipts()
        mutableHumanReviewRequiresRePairing.value = configuration.paired && !configuration.canReviewWorkReceipts()
    }

    fun retryPairing() {
        val gateway = repository as? MobileGatewayRepository ?: return
        connectionGeneration.incrementAndGet()
        pairingFormOpen = true
        proposalRefreshJob?.cancel()
        mutableProposalRefreshing.value = false
        mutableProposalReviewOnline.value = false
        mutableHumanReviewOnline.value = false
        mutableHumanReviewRequiresRePairing.value = false
        cachedPairingRequired = null
        cachedUnavailable = null
        applyResult(gateway.retryPairing())
    }

    fun reviewTaskWorkProposal(proposal: MobileTaskWorkProposal, decision: String) {
        viewModelScope.launch { reviewTaskWorkProposalNow(proposal, decision) }
    }

    internal suspend fun reviewTaskWorkProposalNow(proposal: MobileTaskWorkProposal, decision: String) {
        if (decision !in setOf("accept", "reject")) return
        if (decision == "accept" && proposal.stale) {
            mutableProposalReviewState.value = ProposalReviewUiState.Error(
                proposal.id,
                "Taskが更新されています。AIへ再報告を依頼してください。",
            )
            return
        }
        if (!mutableProposalReviewOnline.value) {
            mutableProposalReviewState.value = ProposalReviewUiState.Error(
                proposal.id,
                "Desktopへ接続してからProposalを判断してください。",
            )
            return
        }
        val gateway = repository as? MobileGatewayRepository
        if (gateway == null) {
            mutableProposalReviewState.value = ProposalReviewUiState.Error(
                proposal.id,
                "この環境ではProposalを判断できません。",
            )
            return
        }
        mutableProposalReviewState.value = ProposalReviewUiState.Reviewing(proposal.id, decision)
        when (val result = withContext(ioDispatcher) { gateway.reviewTaskWorkProposal(proposal, decision) }) {
            is MobileProposalReviewResult.Applied -> {
                mutableProposalReviewOnline.value = true
                mutableProposalReviewState.value = ProposalReviewUiState.Applied(result.proposalId, result.decision)
            }
            is MobileProposalReviewResult.Conflict -> {
                mutableProposalReviewState.value = ProposalReviewUiState.Error(result.proposalId, result.message)
            }
            is MobileProposalReviewResult.Unavailable -> {
                mutableProposalReviewOnline.value = false
                mutableProposalReviewState.value = ProposalReviewUiState.Error(result.proposalId, result.message)
            }
        }
    }

    fun resetProposalReviewState() {
        mutableProposalReviewState.value = ProposalReviewUiState.Idle
    }

    fun reviewTaskWork(task: MobileTask, action: String, reviewNote: String? = null) {
        viewModelScope.launch { reviewTaskWorkNow(task, action, reviewNote) }
    }

    internal suspend fun reviewTaskWorkNow(task: MobileTask, action: String, reviewNote: String? = null) {
        if (action !in setOf("accept", "return")) return
        val receipt = task.latestWorkReceipt
        if (receipt == null || task.version <= 0) {
            mutableHumanReviewState.value = HumanReviewUiState.Conflict(task.id, "最新のTaskとWork Receiptを同期してから判断してください。")
            return
        }
        val normalizedNote = reviewNote?.trim()
        if (action == "return" && normalizedNote.isNullOrEmpty()) {
            mutableHumanReviewState.value = HumanReviewUiState.Rejected(task.id, "差し戻しまたは返信の内容を入力してください。")
            return
        }
        if (!mutableHumanReviewOnline.value) {
            val message = if (mutableHumanReviewRequiresRePairing.value) {
                "この権限ではWork Receiptを判断できません。Desktopで新しいコードを発行して再ペアリングしてください。"
            } else {
                "Desktopへ接続してからWork Receiptを判断してください。"
            }
            mutableHumanReviewState.value = HumanReviewUiState.Unavailable(task.id, message)
            return
        }
        val gateway = repository as? MobileGatewayRepository
        if (gateway == null) {
            mutableHumanReviewState.value = HumanReviewUiState.Unavailable(task.id, "この環境ではWork Receiptを判断できません。")
            return
        }
        mutableHumanReviewState.value = HumanReviewUiState.Reviewing(MobileHumanReviewPending(task.id, action))
        when (val result = withContext(ioDispatcher) { gateway.reviewTaskWork(task, action, normalizedNote) }) {
            is MobileHumanReviewResult.Applied -> {
                mutableHumanReviewOnline.value = true
                mutableHumanReviewState.value = HumanReviewUiState.Applied(result.taskId, result.action)
            }
            is MobileHumanReviewResult.Conflict -> {
                mutableHumanReviewOnline.value = true
                mutableHumanReviewState.value = HumanReviewUiState.Conflict(result.taskId, result.message)
            }
            is MobileHumanReviewResult.Rejected -> {
                mutableHumanReviewOnline.value = true
                mutableHumanReviewState.value = HumanReviewUiState.Rejected(result.taskId, result.message)
            }
            is MobileHumanReviewResult.Unavailable -> {
                mutableHumanReviewOnline.value = false
                mutableHumanReviewState.value = HumanReviewUiState.Unavailable(result.taskId, result.message)
            }
        }
    }

    fun resetHumanReviewState() {
        mutableHumanReviewState.value = HumanReviewUiState.Idle
    }

    fun setTaskAiReady(task: MobileTask, enabled: Boolean) {
        viewModelScope.launch { setTaskAiReadyNow(task, enabled) }
    }

    internal suspend fun setTaskAiReadyNow(task: MobileTask, enabled: Boolean) {
        if (task.pending || task.conflict != null) {
            mutableAiReadyState.value = AiReadyUiState.Conflict(
                task.id,
                "このTaskの同期を解決してからAI Readyを変更してください。",
            )
            return
        }
        val gateway = repository as? MobileGatewayRepository
        if (gateway == null) {
            mutableAiReadyState.value = AiReadyUiState.Unavailable(
                task.id,
                "この環境ではAI Readyを変更できません。",
            )
            return
        }
        mutableAiReadyState.value = AiReadyUiState.Updating(task.id, enabled)
        when (val result = withContext(ioDispatcher) { gateway.setTaskAiReady(task, enabled) }) {
            is MobileAiReadyResult.Applied -> {
                mutableAiReadyState.value = AiReadyUiState.Applied(result.taskId, result.enabled)
            }
            is MobileAiReadyResult.Conflict -> {
                mutableAiReadyState.value = AiReadyUiState.Conflict(result.taskId, result.message)
            }
            is MobileAiReadyResult.Rejected -> {
                mutableAiReadyState.value = AiReadyUiState.Rejected(result.taskId, result.message)
            }
            is MobileAiReadyResult.Unavailable -> {
                mutableAiReadyState.value = AiReadyUiState.Unavailable(result.taskId, result.message)
            }
        }
    }

    internal suspend fun previewTaskContextNow(task: MobileTask) {
        val gateway = repository as? MobileGatewayRepository
        if (gateway == null) {
            mutableTaskDelegationState.value = TaskDelegationUiState.Unavailable(task.id, "この環境ではAI委任を利用できません。")
            return
        }
        mutableTaskDelegationState.value = TaskDelegationUiState.PreviewLoading(task.id)
        mutableTaskDelegationState.value = when (val result = withContext(ioDispatcher) { gateway.previewTaskContext(task) }) {
            is MobileTaskContextPreviewResult.Available -> TaskDelegationUiState.PreviewAvailable(result.preview)
            is MobileTaskContextPreviewResult.Unavailable -> TaskDelegationUiState.Unavailable(result.taskId, result.message)
        }
    }

    internal suspend fun delegateTaskNow(task: MobileTask, expectedResult: String?, instruction: String?) {
        val preview = (mutableTaskDelegationState.value as? TaskDelegationUiState.PreviewAvailable)?.preview
        if (preview == null || preview.taskId != task.id || preview.taskVersion != task.version) {
            mutableTaskDelegationState.value = TaskDelegationUiState.Conflict(task.id, "Context Previewを確認してから委任してください。")
            return
        }
        val gateway = repository as? MobileGatewayRepository
        if (gateway == null) {
            mutableTaskDelegationState.value = TaskDelegationUiState.Unavailable(task.id, "この環境ではAI委任を利用できません。")
            return
        }
        mutableTaskDelegationState.value = TaskDelegationUiState.Delegating(task.id)
        when (val result = withContext(ioDispatcher) { gateway.delegateTask(task, preview, expectedResult, instruction) }) {
            is MobileTaskDelegationResult.Applied -> {
                mutableTaskDelegationState.value = TaskDelegationUiState.Applied(result.taskId)
                mutablePendingSafeShare.value = result.safeShare
            }
            is MobileTaskDelegationResult.Conflict -> mutableTaskDelegationState.value =
                TaskDelegationUiState.Conflict(result.taskId, result.message)
            is MobileTaskDelegationResult.Rejected -> mutableTaskDelegationState.value =
                TaskDelegationUiState.Rejected(result.taskId, result.message)
            is MobileTaskDelegationResult.Unavailable -> mutableTaskDelegationState.value =
                TaskDelegationUiState.Unavailable(result.taskId, result.message)
        }
    }

    fun consumeSafeShare(share: MobileSafeShareDto) {
        if (mutablePendingSafeShare.value == share) mutablePendingSafeShare.value = null
    }

    fun resetTaskDelegationState() {
        mutableTaskDelegationState.value = TaskDelegationUiState.Idle
    }

    fun loadWorkReceipt(taskId: String, receiptId: String, force: Boolean = false) {
        val current = mutableWorkReceiptDetailState.value
        if (!force && current is WorkReceiptDetailUiState.Available && current.detail.id == receiptId) return
        if (!force && current is WorkReceiptDetailUiState.Loading && current.receiptId == receiptId) return
        val gateway = repository as? MobileGatewayRepository
        if (gateway == null) {
            mutableWorkReceiptDetailState.value = WorkReceiptDetailUiState.Error(
                receiptId,
                "この環境ではWork Receipt詳細を利用できません。",
            )
            return
        }
        workReceiptLoadJob?.cancel()
        mutableWorkReceiptDetailState.value = WorkReceiptDetailUiState.Loading(receiptId)
        workReceiptLoadJob = viewModelScope.launch(ioDispatcher) {
            mutableWorkReceiptDetailState.value = when (val result = gateway.loadWorkReceipt(taskId, receiptId)) {
                is MobileWorkReceiptLoadResult.Available -> WorkReceiptDetailUiState.Available(
                    detail = result.detail,
                    fromCache = result.fromCache,
                    warning = result.warning,
                )
                is MobileWorkReceiptLoadResult.Unavailable -> WorkReceiptDetailUiState.Error(
                    result.receiptId,
                    result.message,
                )
            }
        }
    }

    fun createCapture(
        draft: MobileCaptureDraft,
        completionBehavior: CaptureCompletionBehavior = CaptureCompletionBehavior.Close,
    ) {
        mutableCaptureState.value = CaptureUiState.Saving
        viewModelScope.launch(ioDispatcher) { createCaptureNow(draft, completionBehavior) }
    }
    internal suspend fun createCaptureNow(
        draft: MobileCaptureDraft,
        completionBehavior: CaptureCompletionBehavior = CaptureCompletionBehavior.Close,
    ) {
        val entityLabel = if (draft.kind == MobileCaptureKind.Task) "Task" else "Capture"
        val drafts = if (draft.kind == MobileCaptureKind.Task) draft.organizedTaskDrafts() else listOf(draft)
        val normalizedDrafts = drafts.map { if (it.kind == MobileCaptureKind.Task) it.withText(it.text.trim()) else it }
        if (normalizedDrafts.any { it.text.isBlank() }) {
            mutableCaptureState.value = CaptureUiState.Error("${entityLabel}の内容を入力してください。")
            return
        }
        val textLimit = if (draft.kind == MobileCaptureKind.Task) MOBILE_TASK_TITLE_MAX_LENGTH else MOBILE_CAPTURE_TEXT_MAX_LENGTH
        if (normalizedDrafts.any { it.text.length > textLimit }) {
            mutableCaptureState.value = CaptureUiState.Error("${entityLabel}は${textLimit}文字以内で入力してください。全文は保持しています。")
            return
        }
        if (normalizedDrafts.any { runCatching { it.organization?.validate() }.isFailure }) {
            mutableCaptureState.value = CaptureUiState.Error("整理案の日付・チェック項目を確認してから追加してください。")
            return
        }
        val offlineRepository = repository as? MobileOfflineTaskRepository
        if (offlineRepository == null) {
            mutableCaptureState.value = CaptureUiState.Error("この環境では${entityLabel}を追加できません。")
            return
        }
        mutableCaptureState.value = try {
            val entityIds = withContext(ioDispatcher) {
                if (draft.kind == MobileCaptureKind.Task) offlineRepository.enqueueCreateTasks(normalizedDrafts)
                else normalizedDrafts.map { normalizedDraft ->
                    when (normalizedDraft.kind) {
                        MobileCaptureKind.Task -> offlineRepository.enqueueCreateTask(normalizedDraft)
                        MobileCaptureKind.Capture -> offlineRepository.enqueueCreateCapture(normalizedDraft)
                    }
                }
            }
            CaptureUiState.Queued(
                entityId = entityIds.first(),
                kind = draft.kind,
                completionBehavior = completionBehavior,
                additionalEntityIds = entityIds.drop(1),
            )
        } catch (_: Exception) {
            CaptureUiState.Error("${entityLabel}を保存できませんでした。入力を残したまま再試行してください。")
        }
    }

    suspend fun retryPendingCapture(commandId: String): Boolean = withContext(ioDispatcher) {
        (repository as? MobileOfflineTaskRepository)?.retryPendingCapture(commandId) ?: false
    }

    fun undoCreatedCapture(entityId: String, kind: MobileCaptureKind) {
        viewModelScope.launch { undoCreatedCaptureNow(entityId, kind) }
    }

    fun undoCreatedCaptures(entityIds: List<String>) {
        if (entityIds.isEmpty()) return
        viewModelScope.launch {
            val offlineRepository = repository as? MobileOfflineTaskRepository
            if (offlineRepository == null) {
                mutableTaskActionState.value = TaskActionUiState.Error(
                    entityIds.first(),
                    "この環境ではTask追加を元に戻せません。",
                )
                return@launch
            }
            mutableTaskActionState.value = TaskActionUiState.Saving(entityIds.first())
            mutableTaskActionState.value = try {
                val results = withContext(ioDispatcher) {
                    entityIds.asReversed().map { offlineRepository.undoCreateTask(it) }
                }
                TaskActionUiState.Queued(
                    taskId = entityIds.first(),
                    requiresSync = results.any(MobileUndoCreateResult::requiresSync),
                    message = "${entityIds.size}件のTask追加を元に戻しました。",
                )
            } catch (error: Exception) {
                TaskActionUiState.Error(
                    entityIds.first(),
                    error.message ?: "Task追加を元に戻せませんでした。",
                )
            }
        }
    }

    internal suspend fun undoCreatedCaptureNow(entityId: String, kind: MobileCaptureKind) {
        val entityLabel = if (kind == MobileCaptureKind.Task) "Task" else "Capture"
        val offlineRepository = repository as? MobileOfflineTaskRepository
        if (offlineRepository == null) {
            mutableTaskActionState.value = TaskActionUiState.Error(entityId, "この環境では${entityLabel}追加を元に戻せません。")
            return
        }
        mutableTaskActionState.value = TaskActionUiState.Saving(entityId)
        mutableTaskActionState.value = try {
            val result = withContext(ioDispatcher) {
                when (kind) {
                    MobileCaptureKind.Task -> offlineRepository.undoCreateTask(entityId)
                    MobileCaptureKind.Capture -> offlineRepository.undoCreateCapture(entityId)
                }
            }
            TaskActionUiState.Queued(
                taskId = entityId,
                requiresSync = result.requiresSync,
                message = if (result.requiresSync) {
                    "${entityLabel}削除をDesktopへ自動送信します。"
                } else {
                    "${entityLabel}追加を元に戻しました。"
                },
            )
        } catch (error: Exception) {
            TaskActionUiState.Error(entityId, error.message ?: "${entityLabel}追加を元に戻せませんでした。")
        }
    }

    fun toggleTaskState(task: MobileTask) {
        viewModelScope.launch { toggleTaskStateNow(task) }
    }

    fun updateTaskTitle(task: MobileTask, title: String) {
        viewModelScope.launch { updateTaskTitleNow(task, title) }
    }

    internal suspend fun updateTaskTitleNow(task: MobileTask, title: String) {
        val normalized = title.trim()
        if (normalized.isEmpty() || normalized.length > 500 || normalized == task.title) return
        if ((task.pending && !task.canEditPendingCreate && !task.canEditPendingTask) || task.conflict != null) {
            mutableTaskActionState.value = TaskActionUiState.Error(task.id, "このTaskの同期を解決してから編集してください。")
            return
        }
        val offlineRepository = repository as? MobileOfflineTaskRepository
        if (offlineRepository == null) {
            mutableTaskActionState.value = TaskActionUiState.Error(task.id, "この環境ではTaskを編集できません。")
            return
        }
        mutableTaskActionState.value = TaskActionUiState.Saving(task.id)
        mutableTaskActionState.value = try {
            withContext(ioDispatcher) { offlineRepository.enqueueUpdateTaskTitle(task.id, normalized) }
            TaskActionUiState.Queued(task.id)
        } catch (error: Exception) {
            TaskActionUiState.Error(task.id, error.message ?: "Task名を変更できませんでした。")
        }
    }

    fun updateTaskTodayDate(task: MobileTask, todayDate: java.time.LocalDate?) {
        viewModelScope.launch { updateTaskTodayDateNow(task, todayDate) }
    }

    internal suspend fun updateTaskTodayDateNow(task: MobileTask, todayDate: java.time.LocalDate?) {
        if (task.todayDate == todayDate?.toString()) return
        if ((task.pending && !task.canEditPendingCreate && !task.canEditPendingTask) || task.conflict != null) {
            mutableTaskActionState.value = TaskActionUiState.Error(task.id, "このTaskの同期を解決してから予定を変更してください。")
            return
        }
        val offlineRepository = repository as? MobileOfflineTaskRepository
        if (offlineRepository == null) {
            mutableTaskActionState.value = TaskActionUiState.Error(task.id, "この環境ではTaskの予定を変更できません。")
            return
        }
        mutableTaskActionState.value = TaskActionUiState.Saving(task.id)
        mutableTaskActionState.value = try {
            withContext(ioDispatcher) { offlineRepository.enqueueUpdateTaskTodayDate(task.id, todayDate) }
            TaskActionUiState.Queued(task.id)
        } catch (error: Exception) {
            TaskActionUiState.Error(task.id, error.message ?: "Taskの予定を変更できませんでした。")
        }
    }

    fun updateTaskSchedule(task: MobileTask, draft: MobileTaskScheduleDraft) {
        viewModelScope.launch { updateTaskScheduleNow(task, draft) }
    }

    internal suspend fun updateTaskScheduleNow(task: MobileTask, draft: MobileTaskScheduleDraft) {
        val normalized = try {
            normalizeScheduleDraft(draft)
        } catch (error: Exception) {
            mutableTaskActionState.value = TaskActionUiState.Error(
                task.id,
                error.message ?: "予定の日付を確認してください。",
            )
            return
        }
        if (
            task.schedule?.startDate == normalized.startDate &&
            task.schedule?.endDate == normalized.endDate &&
            task.schedule?.rangeSemantics == normalized.rangeSemantics &&
            task.plannedStartTime == normalized.plannedStartTime &&
            task.plannedDurationMinutes == normalized.plannedDurationMinutes
        ) return
        if ((task.pending && !task.canEditPendingCreate && !task.canEditPendingTask) || task.conflict != null) {
            mutableTaskActionState.value = TaskActionUiState.Error(task.id, "このTaskの同期を解決してから予定を変更してください。")
            return
        }
        val offlineRepository = repository as? MobileOfflineTaskRepository
        if (offlineRepository == null) {
            mutableTaskActionState.value = TaskActionUiState.Error(task.id, "この環境ではTaskの予定を変更できません。")
            return
        }
        mutableTaskActionState.value = TaskActionUiState.Saving(task.id)
        mutableTaskActionState.value = try {
            withContext(ioDispatcher) { offlineRepository.enqueueUpdateTaskSchedule(task.id, normalized) }
            TaskActionUiState.Queued(task.id)
        } catch (error: Exception) {
            TaskActionUiState.Error(task.id, error.message ?: "Taskの予定を変更できませんでした。")
        }
    }

    private fun normalizeScheduleDraft(draft: MobileTaskScheduleDraft): MobileTaskScheduleDraft {
        val start = draft.startDate?.takeIf(String::isNotBlank)?.let(java.time.LocalDate::parse)
        val end = draft.endDate?.takeIf(String::isNotBlank)?.let(java.time.LocalDate::parse)
        require(start == null || end == null || !end.isBefore(start)) { "終了日は開始日以降にしてください。" }
        require(draft.rangeSemantics == null || draft.rangeSemantics in setOf("once_within_window", "ongoing")) {
            "期間の意味を選び直してください。"
        }
        require(draft.rangeSemantics == null || (start != null && end != null && end.isAfter(start))) {
            "期間の意味は開始日と終了日が異なるときだけ設定できます。"
        }
        require(draft.plannedStartTime == null || isPlannedStartTime(draft.plannedStartTime)) { "予定開始時刻は HH:mm で入力してください。" }
        require(draft.plannedDurationMinutes == null || isPlannedDurationMinutes(draft.plannedDurationMinutes)) { "所要時間は1〜10080分で入力してください。" }
        return draft.copy(startDate = start?.toString(), endDate = end?.toString())
    }

    fun updateTaskTheme(task: MobileTask, themeId: String?) {
        viewModelScope.launch { updateTaskThemeNow(task, themeId) }
    }

    fun updateTaskChecklist(task: MobileTask, items: List<MobileChecklistItem>) {
        viewModelScope.launch { updateTaskChecklistNow(task, items) }
    }

    internal suspend fun updateTaskChecklistNow(task: MobileTask, items: List<MobileChecklistItem>) {
        val normalized = try {
            normalizeChecklist(items)
        } catch (error: Exception) {
            mutableTaskActionState.value = TaskActionUiState.Error(
                task.id,
                error.message ?: "Checklistを確認してください。",
            )
            return
        }
        if (normalized == normalizeChecklist(task.checklistItems)) return
        if ((task.pending && !task.canEditPendingChecklist && !task.canEditPendingCreate && !task.canEditPendingTask) || task.conflict != null) {
            mutableTaskActionState.value = TaskActionUiState.Error(
                task.id,
                if (task.conflict != null) "先に同期競合を解決してください。" else "このTaskの同期完了を待ってください。",
            )
            return
        }
        val offlineRepository = repository as? MobileOfflineTaskRepository
        if (offlineRepository == null) {
            mutableTaskActionState.value = TaskActionUiState.Error(task.id, "この環境ではChecklistを編集できません。")
            return
        }
        mutableTaskActionState.value = TaskActionUiState.Saving(task.id)
        mutableTaskActionState.value = try {
            withContext(ioDispatcher) { offlineRepository.enqueueUpdateTaskChecklist(task.id, normalized) }
            TaskActionUiState.Queued(task.id)
        } catch (error: Exception) {
            TaskActionUiState.Error(task.id, error.message ?: "Checklistを変更できませんでした。")
        }
    }

    private fun normalizeChecklist(items: List<MobileChecklistItem>): List<MobileChecklistItem> {
        require(items.size <= 100) { "Checklistは100件以内にしてください。" }
        require(items.map { it.id.trim() }.distinct().size == items.size) { "Checklist itemが重複しています。" }
        return items.mapIndexed { index, item ->
            val id = item.id.trim()
            val title = item.title.trim()
            require(id.isNotEmpty() && id.length <= 200) { "Checklist itemを作り直してください。" }
            require(title.isNotEmpty() && title.length <= 200) { "Checklistは1〜200文字で入力してください。" }
            item.copy(
                id = id,
                title = title,
                sortOrder = index.toDouble(),
                completedAt = if (item.done) item.completedAt else null,
            )
        }
    }

    fun discardRejectedThemeUpdate(task: MobileTask) {
        viewModelScope.launch { discardRejectedThemeUpdateNow(task) }
    }

    internal suspend fun discardRejectedThemeUpdateNow(task: MobileTask) {
        val rejection = task.rejectedThemeUpdate ?: return
        val offlineRepository = repository as? MobileOfflineTaskRepository
        if (offlineRepository == null) {
            mutableTaskActionState.value = TaskActionUiState.Error(task.id, "この環境では却下情報を破棄できません。")
            return
        }
        mutableTaskActionState.value = TaskActionUiState.Saving(task.id)
        mutableTaskActionState.value = try {
            withContext(ioDispatcher) {
                offlineRepository.discardRejectedThemeUpdate(task.id, rejection.commandId)
            }
            TaskActionUiState.RejectedThemeDismissed(task.id)
        } catch (error: Exception) {
            TaskActionUiState.Error(task.id, error.message ?: "Theme変更の却下情報を破棄できませんでした。")
        }
    }

    internal suspend fun updateTaskThemeNow(task: MobileTask, themeId: String?) {
        if (task.themeId == themeId) return
        if ((task.pending && !task.canEditPendingCreate && !task.canEditPendingTask) || task.conflict != null) {
            mutableTaskActionState.value = TaskActionUiState.Error(task.id, "このTaskの同期を解決してからThemeを変更してください。")
            return
        }
        val offlineRepository = repository as? MobileOfflineTaskRepository
        if (offlineRepository == null) {
            mutableTaskActionState.value = TaskActionUiState.Error(task.id, "この環境ではTaskのThemeを変更できません。")
            return
        }
        mutableTaskActionState.value = TaskActionUiState.Saving(task.id)
        mutableTaskActionState.value = try {
            withContext(ioDispatcher) { offlineRepository.enqueueUpdateTaskTheme(task.id, themeId) }
            TaskActionUiState.Queued(task.id)
        } catch (error: Exception) {
            TaskActionUiState.Error(task.id, error.message ?: "TaskのThemeを変更できませんでした。")
        }
    }

    internal suspend fun toggleTaskStateNow(task: MobileTask) {
        if ((task.pending && !task.canChangePendingState) || task.conflict != null) {
            mutableTaskActionState.value = TaskActionUiState.Error(
                task.id,
                if (task.conflict != null) "先に同期競合を解決してください。" else "このTaskの同期完了を待って再試行してください。",
            )
            return
        }
        val offlineRepository = repository as? MobileOfflineTaskRepository
        if (offlineRepository == null) {
            mutableTaskActionState.value = TaskActionUiState.Error(task.id, "この環境ではTaskの状態を変更できません。")
            return
        }
        mutableTaskActionState.value = TaskActionUiState.Saving(task.id)
        mutableTaskActionState.value = try {
            val result = withContext(ioDispatcher) {
                if (task.state == "done") {
                    offlineRepository.enqueueReopenTask(task.id)
                } else {
                    offlineRepository.enqueueCompleteTask(task.id)
                }
            }
            TaskActionUiState.Queued(task.id, result.requiresSync)
        } catch (error: Exception) {
            TaskActionUiState.Error(task.id, error.message ?: "Taskの状態を変更できませんでした。")
        }
    }

    fun resolveConflict(task: MobileTask, keepLocal: Boolean) {
        viewModelScope.launch { resolveConflictNow(task, keepLocal) }
    }

    internal suspend fun resolveConflictNow(task: MobileTask, keepLocal: Boolean) {
        val conflict = task.conflict
        val offlineRepository = repository as? MobileOfflineTaskRepository
        val rejected = task.heldChanges.firstOrNull { it.rejected }
        if ((conflict == null && rejected == null) || offlineRepository == null) {
            mutableTaskActionState.value = TaskActionUiState.Error(task.id, "競合情報を読み込めませんでした。")
            return
        }
        mutableTaskActionState.value = TaskActionUiState.Saving(task.id)
        mutableTaskActionState.value = try {
            withContext(ioDispatcher) {
                if (conflict == null) {
                    if (keepLocal) offlineRepository.retryRejectedTaskChanges(requireNotNull(rejected).commandId)
                    else offlineRepository.discardRejectedTaskChanges(requireNotNull(rejected).commandId)
                } else if (keepLocal) {
                    offlineRepository.keepLocalConflict(conflict.commandId)
                } else {
                    offlineRepository.acceptServerConflict(conflict.commandId)
                }
            }
            TaskActionUiState.ConflictResolved(task.id, keepLocal)
        } catch (error: Exception) {
            TaskActionUiState.Error(task.id, error.message ?: "同期競合を解決できませんでした。")
        }
    }

    fun resetTaskActionState() {
        mutableTaskActionState.value = TaskActionUiState.Idle
    }

    fun resetCaptureState() {
        mutableCaptureState.value = CaptureUiState.Idle
    }

    private fun applyResult(result: MobileTodayResult) {
        mutableUiState.value = when (result) {
            is MobileTodayResult.Available -> if (result.tasks.isEmpty()) {
                TodayUiState.Empty
            } else {
                TodayUiState.Success(result.tasks.toList(), result.generatedAt)
            }
            is MobileTodayResult.Unavailable -> TodayUiState.Error(result.message, result.recovery)
            is MobileTodayResult.PairingRequired -> TodayUiState.PairingRequired(result.origin, result.message)
        }
    }
}

class TodayViewModelFactory(
    private val repository: MobileTaskRepository,
    private val refreshExternalProjection: () -> Unit = {},
) : ViewModelProvider.Factory {
    @Suppress("UNCHECKED_CAST")
    override fun <T : ViewModel> create(modelClass: Class<T>): T {
        require(modelClass.isAssignableFrom(TodayViewModel::class.java))
        return TodayViewModel(
            repository = repository,
            refreshExternalProjection = refreshExternalProjection,
        ) as T
    }
}


enum class AppSection { Today, Tasks, Ai }
enum class TaskListFilter { Open, Done, All }

class TodayPaneState(
    selectedTaskId: String? = null,
    listScrollIndex: Int = 0,
    listScrollOffset: Int = 0,
    captureDraft: MobileCaptureDraft = MobileCaptureDraft.fresh(),
    captureOpen: Boolean = false,
    captureVoiceStartRequested: Boolean = false,
    captureInputFocusRequested: Boolean = false,
    activeSection: AppSection = AppSection.Today,
    taskSearch: String = "",
    taskFilter: TaskListFilter = TaskListFilter.Open,
    taskListScrollIndex: Int = 0,
    taskListScrollOffset: Int = 0,
    aiListScrollIndex: Int = 0,
    aiListScrollOffset: Int = 0,
    taskScheduleFilter: TaskScheduleFilter = TaskScheduleFilter.All,
    taskThemeId: String? = null,
) {
    var selectedTaskId by mutableStateOf(selectedTaskId)
    var listScrollIndex by mutableIntStateOf(listScrollIndex)
        private set
    var listScrollOffset by mutableIntStateOf(listScrollOffset)
        private set
    var captureDraft by mutableStateOf(captureDraft)
    var captureOpen by mutableStateOf(captureOpen)
    var captureVoiceStartRequested by mutableStateOf(captureVoiceStartRequested)
        private set
    var captureInputFocusRequested by mutableStateOf(captureInputFocusRequested)
        private set
    var activeSection by mutableStateOf(activeSection)
    var taskSearch by mutableStateOf(taskSearch)
    var taskFilter by mutableStateOf(taskFilter)
    var taskScheduleFilter by mutableStateOf(taskScheduleFilter)
    var taskThemeId by mutableStateOf(taskThemeId)
    var taskListScrollIndex by mutableIntStateOf(taskListScrollIndex)
        private set
    var taskListScrollOffset by mutableIntStateOf(taskListScrollOffset)
        private set
    var aiListScrollIndex by mutableIntStateOf(aiListScrollIndex)
        private set
    var aiListScrollOffset by mutableIntStateOf(aiListScrollOffset)
        private set

    fun recordScroll(index: Int, offset: Int) {
        listScrollIndex = index.coerceAtLeast(0)
        listScrollOffset = offset.coerceAtLeast(0)
    }

    fun recordTaskScroll(index: Int, offset: Int) {
        taskListScrollIndex = index.coerceAtLeast(0)
        taskListScrollOffset = offset.coerceAtLeast(0)
    }

    fun resetTaskFilters() {
        taskSearch = ""
        taskFilter = TaskListFilter.Open
        taskScheduleFilter = TaskScheduleFilter.All
        taskThemeId = null
        recordTaskScroll(0, 0)
    }

    fun recordAiScroll(index: Int, offset: Int) {
        aiListScrollIndex = index.coerceAtLeast(0)
        aiListScrollOffset = offset.coerceAtLeast(0)
    }

    fun openCapture(
        source: MobileCaptureSource,
        initialText: String = "",
        requestVoice: Boolean = false,
        sharedMimeType: String? = null,
        replaceDraft: Boolean = true,
    ) {
        if (replaceDraft || captureDraft.text.isBlank()) {
            captureDraft = MobileCaptureDraft.fresh(
                text = initialText,
                source = source,
                kind = if (source == MobileCaptureSource.ShareTarget) {
                    MobileCaptureKind.Capture
                } else {
                    MobileCaptureKind.Task
                },
                share = sharedMimeType?.let(::MobileShareProvenance),
            )
        }
        captureOpen = true
        captureVoiceStartRequested = requestVoice
        captureInputFocusRequested = false
    }

    fun consumeVoiceStartRequest() {
        captureVoiceStartRequested = false
    }

    fun openVoiceCapture() {
        openCapture(
            source = MobileCaptureSource.AndroidApp,
            requestVoice = true,
            replaceDraft = false,
        )
    }

    fun continueCapture() {
        val previous = captureDraft
        captureDraft = MobileCaptureDraft.fresh(
            source = MobileCaptureSource.AndroidApp,
            kind = previous.kind,
            projectId = previous.projectId,
        )
        captureOpen = true
        captureVoiceStartRequested = false
        captureInputFocusRequested = previous.source != MobileCaptureSource.AndroidSpeech
    }

    fun consumeInputFocusRequest() {
        captureInputFocusRequested = false
    }

    fun resetCapture() {
        captureDraft = MobileCaptureDraft.fresh()
        captureOpen = false
        captureVoiceStartRequested = false
        captureInputFocusRequested = false
    }

    fun save(): List<Any?> = listOf(
        selectedTaskId,
        listScrollIndex,
        listScrollOffset,
        captureDraft.text,
        captureOpen,
        activeSection.name,
        taskSearch,
        taskFilter.name,
        taskListScrollIndex,
        taskListScrollOffset,
        aiListScrollIndex,
        aiListScrollOffset,
        captureDraft.draftId,
        captureDraft.kind.wireValue,
        captureDraft.projectId,
        captureDraft.source.wireValue,
        captureDraft.speech?.recognitionMode?.wireValue,
        captureDraft.speech?.language,
        captureDraft.speech?.confidence,
        captureDraft.createdAt,
        captureVoiceStartRequested,
        captureDraft.speech?.sourceAudioAvailable,
        captureInputFocusRequested,
        captureDraft.share?.mimeType,
        taskScheduleFilter.name,
        taskThemeId,
        captureDraft.organization?.let { kotlinx.serialization.json.Json.encodeToString(MobileCaptureOrganization.serializer(), it) },
        captureDraft.originalText,
        captureDraft.speech?.capturedAt,
        captureDraft.speech?.timeZone,
        captureDraft.originalThemeId,
    )

    companion object {
        fun restore(saved: List<Any?>): TodayPaneState = TodayPaneState(
            selectedTaskId = saved[0] as String?,
            listScrollIndex = saved[1] as Int,
            listScrollOffset = saved[2] as Int,
            captureDraft = MobileCaptureDraft(
                draftId = saved.getOrNull(12) as? String ?: java.util.UUID.randomUUID().toString(),
                text = saved.getOrNull(3) as? String ?: "",
                kind = MobileCaptureKind.fromWireValue(saved.getOrNull(13) as? String),
                projectId = saved.getOrNull(14) as? String,
                source = MobileCaptureSource.fromWireValue(saved.getOrNull(15) as? String),
                speech = (saved.getOrNull(16) as? String)?.let { mode ->
                    MobileSpeechProvenance(
                        recognitionMode = MobileSpeechRecognitionMode.fromWireValue(mode),
                        language = saved.getOrNull(17) as? String ?: "",
                        confidence = saved.getOrNull(18) as? Float,
                        sourceAudioAvailable = saved.getOrNull(21) as? Boolean ?: false,
                        capturedAt = saved.getOrNull(28) as? String,
                        timeZone = saved.getOrNull(29) as? String,
                    )
                },
                share = (saved.getOrNull(23) as? String)?.let(::MobileShareProvenance)
                    ?: if (MobileCaptureSource.fromWireValue(saved.getOrNull(15) as? String) == MobileCaptureSource.ShareTarget) {
                        MobileShareProvenance("text/plain")
                    } else {
                        null
                    },
                createdAt = saved.getOrNull(19) as? String ?: java.time.Instant.now().toString(),
                organization = (saved.getOrNull(26) as? String)?.let {
                    kotlinx.serialization.json.Json.decodeFromString(MobileCaptureOrganization.serializer(), it)
                },
                originalText = saved.getOrNull(27) as? String,
                originalThemeId = saved.getOrNull(30) as? String,
            ),
            captureOpen = saved.getOrNull(4) as? Boolean ?: false,
            captureVoiceStartRequested = saved.getOrNull(20) as? Boolean ?: false,
            captureInputFocusRequested = saved.getOrNull(22) as? Boolean ?: false,
            activeSection = (saved.getOrNull(5) as? String)
                ?.let { runCatching { AppSection.valueOf(it) }.getOrNull() }
                ?: AppSection.Today,
            taskSearch = saved.getOrNull(6) as? String ?: "",
            taskFilter = (saved.getOrNull(7) as? String)
                ?.let { runCatching { TaskListFilter.valueOf(it) }.getOrNull() }
                ?: TaskListFilter.Open,
            taskListScrollIndex = saved.getOrNull(8) as? Int ?: 0,
            taskListScrollOffset = saved.getOrNull(9) as? Int ?: 0,
            aiListScrollIndex = saved.getOrNull(10) as? Int ?: 0,
            aiListScrollOffset = saved.getOrNull(11) as? Int ?: 0,
            taskScheduleFilter = (saved.getOrNull(24) as? String)
                ?.let { runCatching { TaskScheduleFilter.valueOf(it) }.getOrNull() }
                ?: TaskScheduleFilter.All,
            taskThemeId = saved.getOrNull(25) as? String,
        )
    }
}

interface MobileGatewayRepository : MobileTaskRepository {
    suspend fun organizeCapture(draft: MobileCaptureDraft): List<MobileCaptureOrganization> =
        error("このDesktopではAI整理を利用できません。Desktopを更新してください。")
    fun configuration(): MobileGatewayConfiguration
    fun pair(origin: String, pairingCode: String): MobileTodayResult
    fun retryPairing(): MobileTodayResult
    suspend fun loadWorkReceipt(taskId: String, receiptId: String): MobileWorkReceiptLoadResult =
        MobileWorkReceiptLoadResult.Unavailable(receiptId, "このDesktopではWork Receipt詳細を利用できません。")
    suspend fun refreshTaskWorkProposals(): Boolean = false
    suspend fun reviewTaskWorkProposal(
        proposal: MobileTaskWorkProposal,
        decision: String,
    ): MobileProposalReviewResult = MobileProposalReviewResult.Unavailable(
        proposal.id,
        "このDesktopではProposal判断を利用できません。",
    )
    suspend fun reviewTaskWork(
        task: MobileTask,
        action: String,
        reviewNote: String?,
    ): MobileHumanReviewResult = MobileHumanReviewResult.Unavailable(
        task.id,
        "このDesktopではWork Receipt判断を利用できません。",
    )
    suspend fun setTaskAiReady(task: MobileTask, enabled: Boolean): MobileAiReadyResult =
        MobileAiReadyResult.Unavailable(task.id, "このDesktopではAI Readyを変更できません。")
    suspend fun previewTaskContext(task: MobileTask): MobileTaskContextPreviewResult =
        MobileTaskContextPreviewResult.Unavailable(task.id, "このDesktopではContext Previewを利用できません。")
    suspend fun delegateTask(
        task: MobileTask,
        preview: MobileTaskContextPreview,
        expectedResult: String?,
        instruction: String?,
    ): MobileTaskDelegationResult = MobileTaskDelegationResult.Unavailable(
        task.id,
        "このDesktopではAI委任を利用できません。",
    )
}

interface MobileOfflineTaskRepository {
    fun observeCachedTasks(): Flow<List<MobileTask>>
    fun observeAllCachedTasks(): Flow<List<MobileTask>> = observeCachedTasks()
    fun observeTodayCache(date: java.time.LocalDate): Flow<MobileTodayCache> =
        combine(observeCachedTasks(), observeAllCachedTasks()) { tasks, allTasks ->
            MobileTodayCache(tasks, tasks.isNotEmpty() || allTasks.isNotEmpty())
        }
    fun observeCachedThemes(): Flow<List<MobileTheme>> = kotlinx.coroutines.flow.flowOf(emptyList())
    fun observeThemeCatalogState(): Flow<MobileThemeCatalogState> = observeCachedThemes().map { themes ->
        MobileThemeCatalogState.Loading(themes = themes.toList())
    }
    fun observeCachedTaskWorkProposals(): Flow<List<MobileTaskWorkProposal>> =
        kotlinx.coroutines.flow.flowOf(emptyList())
    fun observePendingCount(): Flow<Int>
    fun observePendingCaptures(): Flow<List<MobilePendingCapture>> = kotlinx.coroutines.flow.flowOf(emptyList())
    suspend fun retryPendingCapture(commandId: String): Boolean = false
    fun observeConflictCount(): Flow<Int> = kotlinx.coroutines.flow.flowOf(0)
    suspend fun enqueueCreateTask(
        draft: MobileCaptureDraft,
        todayDate: java.time.LocalDate? = java.time.LocalDate.now(),
    ): String
    suspend fun enqueueCreateTasks(
        drafts: List<MobileCaptureDraft>,
        todayDate: java.time.LocalDate? = java.time.LocalDate.now(),
    ): List<String> {
        require(drafts.size == 1) { "この環境では複数のTaskを一度に追加できません。" }
        return listOf(enqueueCreateTask(drafts.single(), todayDate))
    }
    suspend fun enqueueCreateCapture(draft: MobileCaptureDraft): String =
        error("この環境ではCaptureを追加できません。")
    suspend fun undoCreateTask(taskId: String): MobileUndoCreateResult =
        error("この環境ではTask追加を元に戻せません。")
    suspend fun undoCreateCapture(captureId: String): MobileUndoCreateResult =
        error("この環境ではCapture追加を元に戻せません。")
    suspend fun enqueueUpdateTaskTitle(taskId: String, title: String): String = error("この環境ではTaskを編集できません。")
    suspend fun enqueueUpdateTaskTodayDate(taskId: String, todayDate: java.time.LocalDate?): String =
        error("この環境ではTaskの予定を変更できません。")
    suspend fun enqueueUpdateTaskSchedule(taskId: String, schedule: MobileTaskScheduleDraft): String =
        error("この環境ではTaskの予定を変更できません。")
    suspend fun enqueueUpdateTaskTheme(taskId: String, themeId: String?): String =
        error("この環境ではTaskのThemeを変更できません。")
    suspend fun enqueueUpdateTaskChecklist(taskId: String, items: List<MobileChecklistItem>): String =
        error("この環境ではChecklistを変更できません。")
    suspend fun discardRejectedThemeUpdate(taskId: String, commandId: String) {
        error("この環境ではTheme変更の却下情報を破棄できません。")
    }
    suspend fun enqueueCompleteTask(taskId: String): MobileStateActionResult
    suspend fun enqueueReopenTask(taskId: String): MobileStateActionResult
    suspend fun acceptServerConflict(commandId: String) {
        error("この環境では競合を解決できません。")
    }
    suspend fun keepLocalConflict(commandId: String): String = error("この環境では競合を解決できません。")
    suspend fun retryRejectedTaskChanges(commandId: String): Unit = error("この環境では再試行できません。")
    suspend fun discardRejectedTaskChanges(commandId: String): Unit = error("この環境では破棄できません。")
}
