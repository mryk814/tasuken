package jp.personal.tasken.companion

import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.lifecycle.ViewModel
import androidx.lifecycle.ViewModelProvider
import androidx.lifecycle.viewModelScope
import kotlinx.coroutines.CoroutineDispatcher
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

data class MobileTask(
    val id: String,
    val title: String,
    val themeId: String?,
    val state: String,
    val workState: String?,
    val updatedAt: String,
    val todayDate: String? = null,
    val pending: Boolean = false,
    val conflict: MobileTaskConflict? = null,
    val canChangePendingState: Boolean = false,
    val rejectedThemeUpdate: MobileRejectedThemeUpdate? = null,
)

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
    data class Success(val tasks: List<MobileTask>, val generatedAt: String) : TodayUiState
}

sealed interface CaptureUiState {
    data object Idle : CaptureUiState
    data object Saving : CaptureUiState
    data class Queued(val taskId: String) : CaptureUiState
    data class Error(val message: String) : CaptureUiState
}

sealed interface TaskActionUiState {
    data object Idle : TaskActionUiState
    data class Saving(val taskId: String) : TaskActionUiState
    data class Queued(val taskId: String, val requiresSync: Boolean = true) : TaskActionUiState
    data class ConflictResolved(val taskId: String, val keptLocal: Boolean) : TaskActionUiState
    data class RejectedThemeDismissed(val taskId: String) : TaskActionUiState
    data class Error(val taskId: String, val message: String) : TaskActionUiState
}

class TodayViewModel(
    private val repository: MobileTaskRepository = DisconnectedMobileTaskRepository(),
    private val ioDispatcher: CoroutineDispatcher = Dispatchers.IO,
) : ViewModel() {
    private val mutableUiState = MutableStateFlow<TodayUiState>(TodayUiState.Loading)
    val uiState: StateFlow<TodayUiState> = mutableUiState.asStateFlow()
    private val mutableCaptureState = MutableStateFlow<CaptureUiState>(CaptureUiState.Idle)
    val captureState: StateFlow<CaptureUiState> = mutableCaptureState.asStateFlow()
    private val mutableTaskActionState = MutableStateFlow<TaskActionUiState>(TaskActionUiState.Idle)
    val taskActionState: StateFlow<TaskActionUiState> = mutableTaskActionState.asStateFlow()
    private val mutablePendingCount = MutableStateFlow(0)
    val pendingCount: StateFlow<Int> = mutablePendingCount.asStateFlow()
    private val mutableConflictCount = MutableStateFlow(0)
    val conflictCount: StateFlow<Int> = mutableConflictCount.asStateFlow()
    private val mutableAllTasks = MutableStateFlow<List<MobileTask>>(emptyList())
    val allTasks: StateFlow<List<MobileTask>> = mutableAllTasks.asStateFlow()
    private val mutableThemes = MutableStateFlow<List<MobileTheme>>(emptyList())
    val themes: StateFlow<List<MobileTheme>> = mutableThemes.asStateFlow()
    private val mutableThemeCatalogState = MutableStateFlow<MobileThemeCatalogState>(
        MobileThemeCatalogState.Loading(),
    )
    val themeCatalogState: StateFlow<MobileThemeCatalogState> = mutableThemeCatalogState.asStateFlow()
    private var observingCache = false
    private var cachedGeneratedAt = ""

    init {
        val offlineRepository = repository as? MobileOfflineTaskRepository
        if (offlineRepository != null) {
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
        }
    }

    fun load() {
        viewModelScope.launch { loadNow() }
    }

    internal suspend fun loadNow() {
        mutableUiState.value = TodayUiState.Loading
        val result = withContext(ioDispatcher) { repository.loadToday() }
        val offlineRepository = repository as? MobileOfflineTaskRepository
        if (offlineRepository != null && result !is MobileTodayResult.PairingRequired) {
            val cachedTasks = withContext(ioDispatcher) { offlineRepository.observeCachedTasks().first() }
            if (cachedTasks.isNotEmpty() || result is MobileTodayResult.Available) {
                cachedGeneratedAt = (result as? MobileTodayResult.Available)?.generatedAt.orEmpty()
                applyCachedTasks(cachedTasks)
                observeCache(offlineRepository)
                return
            }
        }
        applyResult(result)
    }

    private fun observeCache(repository: MobileOfflineTaskRepository) {
        if (observingCache) return
        observingCache = true
        viewModelScope.launch(ioDispatcher) {
            repository.observeCachedTasks().collect(::applyCachedTasks)
        }
    }

    private fun applyCachedTasks(tasks: List<MobileTask>) {
        mutableUiState.value = if (tasks.isEmpty()) {
            TodayUiState.Empty
        } else {
            TodayUiState.Success(tasks.toList(), cachedGeneratedAt)
        }
    }

    fun pair(origin: String, pairingCode: String) {
        val gateway = repository as? MobileGatewayRepository ?: return
        mutableUiState.value = TodayUiState.Loading
        viewModelScope.launch {
            applyResult(withContext(ioDispatcher) { gateway.pair(origin, pairingCode) })
        }
    }

    fun createTask(title: String) {
        mutableCaptureState.value = CaptureUiState.Saving
        viewModelScope.launch(ioDispatcher) { createTaskNow(title) }
    }

    internal suspend fun createTaskNow(title: String) {
        val normalized = title.trim()
        if (normalized.isEmpty()) {
            mutableCaptureState.value = CaptureUiState.Error("Task名を入力してください。")
            return
        }
        if (normalized.length > 500) {
            mutableCaptureState.value = CaptureUiState.Error("Task名は500文字以内で入力してください。")
            return
        }
        val offlineRepository = repository as? MobileOfflineTaskRepository
        if (offlineRepository == null) {
            mutableCaptureState.value = CaptureUiState.Error("この環境ではTaskを追加できません。")
            return
        }
        mutableCaptureState.value = try {
            CaptureUiState.Queued(withContext(ioDispatcher) { offlineRepository.enqueueCreateTask(normalized) })
        } catch (_: Exception) {
            CaptureUiState.Error("Taskを保存できませんでした。入力を残したまま再試行してください。")
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
        if (task.pending || task.conflict != null) {
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
        if (task.pending || task.conflict != null) {
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

    fun updateTaskTheme(task: MobileTask, themeId: String) {
        viewModelScope.launch { updateTaskThemeNow(task, themeId) }
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

    internal suspend fun updateTaskThemeNow(task: MobileTask, themeId: String) {
        if (task.themeId == themeId) return
        if (task.pending || task.conflict != null) {
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
        if (conflict == null || offlineRepository == null) {
            mutableTaskActionState.value = TaskActionUiState.Error(task.id, "競合情報を読み込めませんでした。")
            return
        }
        mutableTaskActionState.value = TaskActionUiState.Saving(task.id)
        mutableTaskActionState.value = try {
            withContext(ioDispatcher) {
                if (keepLocal) {
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
) : ViewModelProvider.Factory {
    @Suppress("UNCHECKED_CAST")
    override fun <T : ViewModel> create(modelClass: Class<T>): T {
        require(modelClass.isAssignableFrom(TodayViewModel::class.java))
        return TodayViewModel(repository) as T
    }
}


enum class AppSection { Today, Tasks }
enum class TaskListFilter { Open, Done, All }

class TodayPaneState(
    selectedTaskId: String? = null,
    listScrollIndex: Int = 0,
    listScrollOffset: Int = 0,
    captureDraft: String = "",
    captureOpen: Boolean = false,
    activeSection: AppSection = AppSection.Today,
    taskSearch: String = "",
    taskFilter: TaskListFilter = TaskListFilter.Open,
    taskListScrollIndex: Int = 0,
    taskListScrollOffset: Int = 0,
) {
    var selectedTaskId by mutableStateOf(selectedTaskId)
    var listScrollIndex by mutableIntStateOf(listScrollIndex)
        private set
    var listScrollOffset by mutableIntStateOf(listScrollOffset)
        private set
    var captureDraft by mutableStateOf(captureDraft)
    var captureOpen by mutableStateOf(captureOpen)
    var activeSection by mutableStateOf(activeSection)
    var taskSearch by mutableStateOf(taskSearch)
    var taskFilter by mutableStateOf(taskFilter)
    var taskListScrollIndex by mutableIntStateOf(taskListScrollIndex)
        private set
    var taskListScrollOffset by mutableIntStateOf(taskListScrollOffset)
        private set

    fun recordScroll(index: Int, offset: Int) {
        listScrollIndex = index.coerceAtLeast(0)
        listScrollOffset = offset.coerceAtLeast(0)
    }

    fun recordTaskScroll(index: Int, offset: Int) {
        taskListScrollIndex = index.coerceAtLeast(0)
        taskListScrollOffset = offset.coerceAtLeast(0)
    }

    fun save(): List<Any?> = listOf(
        selectedTaskId,
        listScrollIndex,
        listScrollOffset,
        captureDraft,
        captureOpen,
        activeSection.name,
        taskSearch,
        taskFilter.name,
        taskListScrollIndex,
        taskListScrollOffset,
    )

    companion object {
        fun restore(saved: List<Any?>): TodayPaneState = TodayPaneState(
            selectedTaskId = saved[0] as String?,
            listScrollIndex = saved[1] as Int,
            listScrollOffset = saved[2] as Int,
            captureDraft = saved.getOrNull(3) as? String ?: "",
            captureOpen = saved.getOrNull(4) as? Boolean ?: false,
            activeSection = (saved.getOrNull(5) as? String)
                ?.let { runCatching { AppSection.valueOf(it) }.getOrNull() }
                ?: AppSection.Today,
            taskSearch = saved.getOrNull(6) as? String ?: "",
            taskFilter = (saved.getOrNull(7) as? String)
                ?.let { runCatching { TaskListFilter.valueOf(it) }.getOrNull() }
                ?: TaskListFilter.Open,
            taskListScrollIndex = saved.getOrNull(8) as? Int ?: 0,
            taskListScrollOffset = saved.getOrNull(9) as? Int ?: 0,
        )
    }
}

interface MobileGatewayRepository : MobileTaskRepository {
    fun configuration(): MobileGatewayConfiguration
    fun pair(origin: String, pairingCode: String): MobileTodayResult
}

interface MobileOfflineTaskRepository {
    fun observeCachedTasks(): Flow<List<MobileTask>>
    fun observeAllCachedTasks(): Flow<List<MobileTask>> = observeCachedTasks()
    fun observeCachedThemes(): Flow<List<MobileTheme>> = kotlinx.coroutines.flow.flowOf(emptyList())
    fun observeThemeCatalogState(): Flow<MobileThemeCatalogState> = observeCachedThemes().map { themes ->
        MobileThemeCatalogState.Loading(themes = themes.toList())
    }
    fun observePendingCount(): Flow<Int>
    fun observeConflictCount(): Flow<Int> = kotlinx.coroutines.flow.flowOf(0)
    suspend fun enqueueCreateTask(title: String, todayDate: java.time.LocalDate? = java.time.LocalDate.now()): String
    suspend fun enqueueUpdateTaskTitle(taskId: String, title: String): String = error("この環境ではTaskを編集できません。")
    suspend fun enqueueUpdateTaskTodayDate(taskId: String, todayDate: java.time.LocalDate?): String =
        error("この環境ではTaskの予定を変更できません。")
    suspend fun enqueueUpdateTaskTheme(taskId: String, themeId: String): String =
        error("この環境ではTaskのThemeを変更できません。")
    suspend fun discardRejectedThemeUpdate(taskId: String, commandId: String) {
        error("この環境ではTheme変更の却下情報を破棄できません。")
    }
    suspend fun enqueueCompleteTask(taskId: String): MobileStateActionResult
    suspend fun enqueueReopenTask(taskId: String): MobileStateActionResult
    suspend fun acceptServerConflict(commandId: String) {
        error("この環境では競合を解決できません。")
    }
    suspend fun keepLocalConflict(commandId: String): String = error("この環境では競合を解決できません。")
}
