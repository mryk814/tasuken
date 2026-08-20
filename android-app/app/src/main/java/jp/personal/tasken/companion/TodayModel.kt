package jp.personal.tasken.companion

import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.lifecycle.ViewModel
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow

data class MobileTask(
    val id: String,
    val title: String,
    val themeId: String?,
    val state: String,
    val workState: String?,
    val updatedAt: String,
)

sealed interface MobileTodayResult {
    data class Available(val tasks: List<MobileTask>, val generatedAt: String) : MobileTodayResult
    data class Unavailable(val message: String, val recovery: String) : MobileTodayResult
}

interface MobileTaskRepository {
    fun loadToday(): MobileTodayResult
}

class DisconnectedMobileTaskRepository : MobileTaskRepository {
    override fun loadToday(): MobileTodayResult = MobileTodayResult.Unavailable(
        message = "Mobile Gatewayに接続できません。",
        recovery = "DesktopでMobile Gatewayを起動してから再読み込みしてください。",
    )
}

sealed interface TodayUiState {
    data object Loading : TodayUiState
    data object Empty : TodayUiState
    data class Error(val message: String, val recovery: String) : TodayUiState
    data class Success(val tasks: List<MobileTask>, val generatedAt: String) : TodayUiState
}

class TodayViewModel(
    private val repository: MobileTaskRepository = DisconnectedMobileTaskRepository(),
) : ViewModel() {
    private val mutableUiState = MutableStateFlow<TodayUiState>(TodayUiState.Loading)
    val uiState: StateFlow<TodayUiState> = mutableUiState.asStateFlow()

    fun load() {
        mutableUiState.value = TodayUiState.Loading
        mutableUiState.value = when (val result = repository.loadToday()) {
            is MobileTodayResult.Available -> if (result.tasks.isEmpty()) {
                TodayUiState.Empty
            } else {
                TodayUiState.Success(result.tasks.toList(), result.generatedAt)
            }
            is MobileTodayResult.Unavailable -> TodayUiState.Error(result.message, result.recovery)
        }
    }
}

class TodayPaneState(
    selectedTaskId: String? = null,
    listScrollIndex: Int = 0,
    listScrollOffset: Int = 0,
) {
    var selectedTaskId by mutableStateOf(selectedTaskId)
    var listScrollIndex by mutableIntStateOf(listScrollIndex)
        private set
    var listScrollOffset by mutableIntStateOf(listScrollOffset)
        private set

    fun recordScroll(index: Int, offset: Int) {
        listScrollIndex = index.coerceAtLeast(0)
        listScrollOffset = offset.coerceAtLeast(0)
    }

    fun save(): List<Any?> = listOf(selectedTaskId, listScrollIndex, listScrollOffset)

    companion object {
        fun restore(saved: List<Any?>): TodayPaneState = TodayPaneState(
            selectedTaskId = saved[0] as String?,
            listScrollIndex = saved[1] as Int,
            listScrollOffset = saved[2] as Int,
        )
    }
}
