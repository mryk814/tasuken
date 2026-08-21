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
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

data class MobileTask(
    val id: String,
    val title: String,
    val themeId: String?,
    val state: String,
    val workState: String?,
    val updatedAt: String,
    val pending: Boolean = false,
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

class TodayViewModel(
    private val repository: MobileTaskRepository = DisconnectedMobileTaskRepository(),
    private val ioDispatcher: CoroutineDispatcher = Dispatchers.IO,
) : ViewModel() {
    private val mutableUiState = MutableStateFlow<TodayUiState>(TodayUiState.Loading)
    val uiState: StateFlow<TodayUiState> = mutableUiState.asStateFlow()
    private val mutableCaptureState = MutableStateFlow<CaptureUiState>(CaptureUiState.Idle)
    val captureState: StateFlow<CaptureUiState> = mutableCaptureState.asStateFlow()
    private val mutablePendingCount = MutableStateFlow(0)
    val pendingCount: StateFlow<Int> = mutablePendingCount.asStateFlow()
    private var observingCache = false
    private var cachedGeneratedAt = ""

    init {
        val offlineRepository = repository as? MobileOfflineTaskRepository
        if (offlineRepository != null) {
            viewModelScope.launch(ioDispatcher) {
                offlineRepository.observePendingCount().collect { mutablePendingCount.value = it }
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


class TodayPaneState(
    selectedTaskId: String? = null,
    listScrollIndex: Int = 0,
    listScrollOffset: Int = 0,
    captureDraft: String = "",
    captureOpen: Boolean = false,
) {
    var selectedTaskId by mutableStateOf(selectedTaskId)
    var listScrollIndex by mutableIntStateOf(listScrollIndex)
        private set
    var listScrollOffset by mutableIntStateOf(listScrollOffset)
        private set
    var captureDraft by mutableStateOf(captureDraft)
    var captureOpen by mutableStateOf(captureOpen)

    fun recordScroll(index: Int, offset: Int) {
        listScrollIndex = index.coerceAtLeast(0)
        listScrollOffset = offset.coerceAtLeast(0)
    }

    fun save(): List<Any?> = listOf(selectedTaskId, listScrollIndex, listScrollOffset, captureDraft, captureOpen)

    companion object {
        fun restore(saved: List<Any?>): TodayPaneState = TodayPaneState(
            selectedTaskId = saved[0] as String?,
            listScrollIndex = saved[1] as Int,
            listScrollOffset = saved[2] as Int,
            captureDraft = saved.getOrNull(3) as? String ?: "",
            captureOpen = saved.getOrNull(4) as? Boolean ?: false,
        )
    }
}

interface MobileGatewayRepository : MobileTaskRepository {
    fun configuration(): MobileGatewayConfiguration
    fun pair(origin: String, pairingCode: String): MobileTodayResult
}

interface MobileOfflineTaskRepository {
    fun observeCachedTasks(): Flow<List<MobileTask>>
    fun observePendingCount(): Flow<Int>
    suspend fun enqueueCreateTask(title: String, todayDate: java.time.LocalDate? = java.time.LocalDate.now()): String
    suspend fun enqueueCompleteTask(taskId: String): String
    suspend fun enqueueReopenTask(taskId: String): String
}
