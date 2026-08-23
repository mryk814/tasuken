package jp.personal.tasken.companion

import android.content.res.Configuration
import android.content.Intent
import android.os.Bundle
import java.time.LocalDate
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.clickable
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Button
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.DatePicker
import androidx.compose.material3.DatePickerDialog
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.ExposedDropdownMenuBox
import androidx.compose.material3.ExposedDropdownMenuAnchorType
import androidx.compose.material3.ExposedDropdownMenuDefaults
import androidx.compose.material3.FilterChip
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.NavigationBar
import androidx.compose.material3.NavigationBarItem
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Scaffold
import androidx.compose.material3.SnackbarHost
import androidx.compose.material3.SnackbarHostState
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.TopAppBar
import androidx.compose.material3.TopAppBarDefaults
import androidx.compose.material3.rememberDatePickerState
import androidx.compose.material3.adaptive.ExperimentalMaterial3AdaptiveApi
import androidx.compose.material3.adaptive.currentWindowAdaptiveInfo
import androidx.compose.material3.adaptive.currentWindowDpSize
import androidx.compose.material3.adaptive.layout.AnimatedPane
import androidx.compose.material3.adaptive.layout.ListDetailPaneScaffoldRole
import androidx.compose.material3.adaptive.layout.PaneScaffoldDirective
import androidx.compose.material3.adaptive.layout.calculatePaneScaffoldDirective
import androidx.compose.material3.adaptive.navigation.NavigableListDetailPaneScaffold
import androidx.compose.material3.adaptive.navigation.rememberListDetailPaneScaffoldNavigator
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.mutableLongStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.snapshotFlow
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.saveable.Saver
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalConfiguration
import androidx.compose.ui.platform.LocalFocusManager
import androidx.compose.ui.platform.LocalSoftwareKeyboardController
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.role
import androidx.compose.ui.semantics.selected
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.semantics.stateDescription
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.LifecycleEventObserver
import androidx.lifecycle.compose.LocalLifecycleOwner
import androidx.lifecycle.viewmodel.compose.viewModel
import kotlinx.coroutines.launch
import kotlinx.coroutines.flow.MutableStateFlow

class MainActivity : ComponentActivity() {
    private val entryRequest = MutableStateFlow<MobileEntryRequest>(MobileEntryRequest.None)

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        entryRequest.value = MobileEntryRequestResolver.fromIntent(intent)
        val repository = AndroidMobileTaskRepository(applicationContext)
        setContent {
            TaskenTheme {
                val request by entryRequest.collectAsState()
                TodayApp(viewModel(factory = TodayViewModelFactory(repository)), request)
            }
        }
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        setIntent(intent)
        entryRequest.value = MobileEntryRequestResolver.fromIntent(intent)
    }
}

@Composable
private fun TaskenTheme(content: @Composable () -> Unit) {
    val isDark =
        (LocalConfiguration.current.uiMode and Configuration.UI_MODE_NIGHT_MASK) ==
            Configuration.UI_MODE_NIGHT_YES
    val colors = if (isDark) taskenDarkColorScheme() else taskenLightColorScheme()
    MaterialTheme(
        colorScheme = colors,
        shapes = MaterialTheme.shapes.copy(
            small = RoundedCornerShape(4.dp),
            medium = RoundedCornerShape(7.dp),
            large = RoundedCornerShape(10.dp),
        ),
        content = content,
    )
}

internal val TaskenDualPaneMinWidth = 700.dp

@OptIn(ExperimentalMaterial3AdaptiveApi::class)
internal fun taskenPaneScaffoldDirective(
    base: PaneScaffoldDirective,
    windowWidth: Dp,
): PaneScaffoldDirective = if (windowWidth >= TaskenDualPaneMinWidth) {
    base.copy(maxHorizontalPartitions = maxOf(2, base.maxHorizontalPartitions))
} else {
    base
}

@OptIn(ExperimentalMaterial3Api::class, ExperimentalMaterial3AdaptiveApi::class)
@Composable
private fun TodayApp(
    todayViewModel: TodayViewModel = viewModel(),
    entryRequest: MobileEntryRequest = MobileEntryRequest.None,
) {
    val uiState by todayViewModel.uiState.collectAsState()
    val captureState by todayViewModel.captureState.collectAsState()
    val taskActionState by todayViewModel.taskActionState.collectAsState()
    val pendingCount by todayViewModel.pendingCount.collectAsState()
    val conflictCount by todayViewModel.conflictCount.collectAsState()
    val allTasks by todayViewModel.allTasks.collectAsState()
    val themeCatalogState by todayViewModel.themeCatalogState.collectAsState()
    val themes = themeCatalogState.themes
    val paneState = rememberTodayPaneState()
    val adaptiveInfo = currentWindowAdaptiveInfo()
    val scaffoldDirective = taskenPaneScaffoldDirective(
        base = calculatePaneScaffoldDirective(adaptiveInfo),
        windowWidth = currentWindowDpSize().width,
    )
    val navigator = rememberListDetailPaneScaffoldNavigator(
        scaffoldDirective = scaffoldDirective,
    )
    val coroutineScope = rememberCoroutineScope()
    val snackbarHostState = remember { SnackbarHostState() }
    val focusManager = LocalFocusManager.current
    val keyboardController = LocalSoftwareKeyboardController.current
    var handledEntryToken by rememberSaveable { mutableLongStateOf(0L) }

    val lifecycleOwner = LocalLifecycleOwner.current
    DisposableEffect(lifecycleOwner, todayViewModel) {
        val observer = LifecycleEventObserver { _, event ->
            if (event == Lifecycle.Event.ON_RESUME) todayViewModel.load()
        }
        lifecycleOwner.lifecycle.addObserver(observer)
        onDispose { lifecycleOwner.lifecycle.removeObserver(observer) }
    }
    LaunchedEffect(entryRequest, uiState, allTasks) {
        if (entryRequest.token == 0L || entryRequest.token == handledEntryToken) return@LaunchedEffect
        when (entryRequest) {
            is MobileEntryRequest.Capture -> {
                paneState.captureDraft = entryRequest.draft
                paneState.captureOpen = true
                handledEntryToken = entryRequest.token
            }
            is MobileEntryRequest.Task -> {
                val taskExists = allTasks.any { it.id == entryRequest.taskId }
                if (taskExists == true) {
                    paneState.activeSection = AppSection.Tasks
                    paneState.selectedTaskId = entryRequest.taskId
                    navigator.navigateTo(ListDetailPaneScaffoldRole.Detail, entryRequest.taskId)
                    focusManager.clearFocus(force = true)
                    keyboardController?.hide()
                    handledEntryToken = entryRequest.token
                } else if (uiState is TodayUiState.Empty || uiState is TodayUiState.Error) {
                    snackbarHostState.showSnackbar("Taskを開けませんでした。Tasksを同期して再試行してください。")
                    handledEntryToken = entryRequest.token
                }
            }
            is MobileEntryRequest.Today -> {
                paneState.activeSection = AppSection.Today
                navigator.navigateTo(ListDetailPaneScaffoldRole.List)
                handledEntryToken = entryRequest.token
            }
            MobileEntryRequest.None -> Unit
        }
    }
    LaunchedEffect(captureState) {
        if (captureState is CaptureUiState.Queued) {
            paneState.captureDraft = ""
            paneState.captureOpen = false
            snackbarHostState.showSnackbar("Taskを追加しました。Desktopへ自動送信します。")
            todayViewModel.resetCaptureState()
        }
    }
    LaunchedEffect(taskActionState) {
        when (taskActionState) {
            is TaskActionUiState.Queued -> {
                val queued = taskActionState as TaskActionUiState.Queued
                snackbarHostState.showSnackbar(
                    if (queued.requiresSync) {
                        "Taskを更新しました。Desktopへ自動送信します。"
                    } else {
                        "未送信の変更を取り消しました。"
                    },
                )
                todayViewModel.resetTaskActionState()
            }
            is TaskActionUiState.Error -> {
                snackbarHostState.showSnackbar((taskActionState as TaskActionUiState.Error).message)
            }
            is TaskActionUiState.ConflictResolved -> {
                val resolved = taskActionState as TaskActionUiState.ConflictResolved
                snackbarHostState.showSnackbar(
                    if (resolved.keptLocal) "この端末の変更を再送します。" else "Desktopの状態を採用しました。",
                )
                todayViewModel.resetTaskActionState()
            }
            is TaskActionUiState.RejectedThemeDismissed -> {
                snackbarHostState.showSnackbar("送信できなかったTheme変更を取り下げました。")
                todayViewModel.resetTaskActionState()
            }
            TaskActionUiState.Idle, is TaskActionUiState.Saving -> Unit
        }
    }

    Scaffold(
        snackbarHost = { SnackbarHost(snackbarHostState) },
        topBar = {
            TopAppBar(
                title = {
                    Text(
                        when (paneState.activeSection) {
                            AppSection.Today -> "Today"
                            AppSection.Tasks -> "Tasks"
                            AppSection.Ai -> "AI"
                        },
                    )
                },
                actions = {
                    if (conflictCount > 0) {
                        Surface(
                            color = MaterialTheme.colorScheme.errorContainer,
                            shape = RoundedCornerShape(7.dp),
                        ) {
                            Text(
                                "要確認 $conflictCount",
                                modifier = Modifier.padding(horizontal = 10.dp, vertical = 6.dp),
                                color = MaterialTheme.colorScheme.onErrorContainer,
                                fontSize = 12.sp,
                                fontWeight = FontWeight.SemiBold,
                            )
                        }
                    }
                    if (pendingCount > 0) {
                        Surface(
                            color = MaterialTheme.colorScheme.secondaryContainer,
                            shape = RoundedCornerShape(7.dp),
                        ) {
                            Text(
                                "送信待ち $pendingCount",
                                modifier = Modifier.padding(horizontal = 10.dp, vertical = 6.dp),
                                color = MaterialTheme.colorScheme.onSecondaryContainer,
                                fontSize = 12.sp,
                                fontWeight = FontWeight.SemiBold,
                            )
                        }
                    }
                },
                colors = TopAppBarDefaults.topAppBarColors(
                    containerColor = MaterialTheme.colorScheme.surface,
                ),
            )
        },
        bottomBar = {
            NavigationBar {
                NavigationBarItem(
                    selected = paneState.activeSection == AppSection.Today,
                    onClick = {
                        paneState.activeSection = AppSection.Today
                        coroutineScope.launch { navigator.navigateTo(ListDetailPaneScaffoldRole.List) }
                    },
                    icon = { Text("T") },
                    label = { Text("Today") },
                )
                NavigationBarItem(
                    selected = paneState.activeSection == AppSection.Tasks,
                    onClick = {
                        paneState.activeSection = AppSection.Tasks
                        coroutineScope.launch { navigator.navigateTo(ListDetailPaneScaffoldRole.List) }
                    },
                    icon = { Text("All") },
                    label = { Text("Tasks") },
                )
                NavigationBarItem(
                    selected = paneState.activeSection == AppSection.Ai,
                    onClick = {
                        paneState.activeSection = AppSection.Ai
                        coroutineScope.launch { navigator.navigateTo(ListDetailPaneScaffoldRole.List) }
                    },
                    icon = { Text("AI") },
                    label = { Text("AI") },
                )
                NavigationBarItem(
                    selected = false,
                    onClick = { paneState.captureOpen = true },
                    icon = { Text("+") },
                    label = { Text("追加") },
                )
            }
        },
    ) { padding ->
        NavigableListDetailPaneScaffold(
            navigator = navigator,
            listPane = {
                AnimatedPane {
                    val onTaskSelected: (String) -> Unit = { taskId ->
                        paneState.selectedTaskId = taskId
                        coroutineScope.launch {
                            navigator.navigateTo(ListDetailPaneScaffoldRole.Detail, taskId)
                            focusManager.clearFocus(force = true)
                            keyboardController?.hide()
                        }
                    }
                    when (paneState.activeSection) {
                        AppSection.Today -> TodayListPane(
                            uiState = uiState,
                            paneState = paneState,
                            onRetry = todayViewModel::load,
                            onRetryPairing = todayViewModel::retryPairing,
                            onPair = todayViewModel::pair,
                            onTaskSelected = onTaskSelected,
                        )
                        AppSection.Tasks -> TasksListPane(
                            uiState = uiState,
                            tasks = allTasks,
                            paneState = paneState,
                            onRetry = todayViewModel::load,
                            onRetryPairing = todayViewModel::retryPairing,
                            onPair = todayViewModel::pair,
                            onTaskSelected = onTaskSelected,
                        )
                        AppSection.Ai -> AiInboxListPane(
                            uiState = uiState,
                            tasks = allTasks,
                            paneState = paneState,
                            onRetry = todayViewModel::load,
                            onRetryPairing = todayViewModel::retryPairing,
                            onPair = todayViewModel::pair,
                            onTaskSelected = onTaskSelected,
                        )
                    }
                }
            },
            detailPane = {
                AnimatedPane {
                    val task = allTasks.firstOrNull { it.id == paneState.selectedTaskId }
                    TodayDetailPane(
                        task = task,
                        actionState = taskActionState,
                        themes = themes,
                        themeCatalogState = themeCatalogState,
                        onStateAction = todayViewModel::toggleTaskState,
                        onTitleUpdate = todayViewModel::updateTaskTitle,
                        onTodayDateUpdate = todayViewModel::updateTaskTodayDate,
                        onThemeUpdate = todayViewModel::updateTaskTheme,
                        onScheduleUpdate = todayViewModel::updateTaskSchedule,
                        onRejectedThemeDiscard = todayViewModel::discardRejectedThemeUpdate,
                        onConflictResolution = todayViewModel::resolveConflict,
                    )
                }
            },
            modifier = Modifier.padding(padding),
        )
    }

    if (paneState.captureOpen) {
        CaptureTaskSheet(
            draft = paneState.captureDraft,
            state = captureState,
            onDraftChanged = { paneState.captureDraft = it },
            onSubmit = { todayViewModel.createTask(paneState.captureDraft) },
            onDismiss = {
                if (captureState !is CaptureUiState.Saving) {
                    paneState.captureOpen = false
                    todayViewModel.resetCaptureState()
                }
            },
        )
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun CaptureTaskSheet(
    draft: String,
    state: CaptureUiState,
    onDraftChanged: (String) -> Unit,
    onSubmit: () -> Unit,
    onDismiss: () -> Unit,
) {
    ModalBottomSheet(onDismissRequest = onDismiss) {
        Column(
            modifier = Modifier.fillMaxWidth().padding(horizontal = 20.dp, vertical = 12.dp),
            verticalArrangement = Arrangement.spacedBy(12.dp),
        ) {
            Text("Taskを追加", fontSize = 20.sp, fontWeight = FontWeight.Bold)
            OutlinedTextField(
                value = draft,
                onValueChange = { onDraftChanged(it.take(500)) },
                label = { Text("Task名") },
                placeholder = { Text("例: 実験条件を整理する") },
                supportingText = if (state is CaptureUiState.Error) {
                    { Text(state.message) }
                } else {
                    null
                },
                isError = state is CaptureUiState.Error,
                enabled = state !is CaptureUiState.Saving,
                singleLine = true,
                keyboardOptions = KeyboardOptions(imeAction = ImeAction.Done),
                keyboardActions = KeyboardActions(onDone = { if (draft.isNotBlank()) onSubmit() }),
                modifier = Modifier.fillMaxWidth(),
            )
            Button(
                onClick = onSubmit,
                enabled = state !is CaptureUiState.Saving && draft.isNotBlank(),
                modifier = Modifier.align(Alignment.End),
            ) {
                Text(if (state is CaptureUiState.Saving) "保存中" else "追加する")
            }
        }
    }
}

@Composable
private fun TodayListPane(
    uiState: TodayUiState,
    paneState: TodayPaneState,
    onRetry: () -> Unit,
    onRetryPairing: () -> Unit,
    onPair: (String, String) -> Unit,
    onTaskSelected: (String) -> Unit,
) {
    when (uiState) {
        TodayUiState.Loading -> CenteredState {
            CircularProgressIndicator()
            Text("Todayを読み込んでいます")
        }
        TodayUiState.Empty -> CenteredState { Text("今日のTaskはありません") }
        is TodayUiState.PairingRequired -> PairingPane(uiState, onPair)
        is TodayUiState.Error -> GatewayErrorState(uiState, onRetry, onRetryPairing)
        is TodayUiState.Success -> TodayTaskList(uiState.tasks, paneState, onTaskSelected)
    }
}

internal enum class AiInboxSection { InProgress, NeedsReview, Blocked, RecentlyAccepted }

internal fun aiInboxSectionLabel(section: AiInboxSection): String = when (section) {
    AiInboxSection.InProgress -> "作業中"
    AiInboxSection.NeedsReview -> "確認待ち"
    AiInboxSection.Blocked -> "停止中"
    AiInboxSection.RecentlyAccepted -> "最近完了"
}

internal fun aiInboxSection(workState: String?): AiInboxSection? = when (workState) {
    "in_progress", "ready_for_agent", "working", "delegated" -> AiInboxSection.InProgress
    "needs_human_review", "reported_done", "needs_review" -> AiInboxSection.NeedsReview
    "blocked", "failed" -> AiInboxSection.Blocked
    "accepted", "completed" -> AiInboxSection.RecentlyAccepted
    else -> null
}

internal fun filterAiInboxTasks(tasks: List<MobileTask>): List<Pair<AiInboxSection, List<MobileTask>>> {
    val grouped = tasks.mapNotNull { task ->
        aiInboxSection(task.workState)?.let { section -> section to task }
    }.groupBy({ it.first }, { it.second })
    return listOf(
        AiInboxSection.InProgress,
        AiInboxSection.NeedsReview,
        AiInboxSection.Blocked,
        AiInboxSection.RecentlyAccepted,
    ).mapNotNull { section -> grouped[section]?.takeIf { it.isNotEmpty() }?.let { section to it } }
}

internal fun filterCachedTasks(
    tasks: List<MobileTask>,
    query: String,
    filter: TaskListFilter,
): List<MobileTask> {
    val normalizedQuery = query.trim()
    return tasks.filter { task ->
        val matchesQuery = normalizedQuery.isEmpty() || task.title.contains(normalizedQuery, ignoreCase = true)
        val matchesState = when (filter) {
            TaskListFilter.Open -> task.state !in setOf("done", "cancelled")
            TaskListFilter.Done -> task.state == "done"
            TaskListFilter.All -> true
        }
        matchesQuery && matchesState
    }
}

@Composable
private fun TasksListPane(
    uiState: TodayUiState,
    tasks: List<MobileTask>,
    paneState: TodayPaneState,
    onRetry: () -> Unit,
    onRetryPairing: () -> Unit,
    onPair: (String, String) -> Unit,
    onTaskSelected: (String) -> Unit,
) {
    when {
        uiState is TodayUiState.PairingRequired -> PairingPane(uiState, onPair)
        uiState is TodayUiState.Error && tasks.isEmpty() -> GatewayErrorState(uiState, onRetry, onRetryPairing)
        uiState is TodayUiState.Loading && tasks.isEmpty() -> CenteredState {
            CircularProgressIndicator()
            Text("Tasksを読み込んでいます")
        }
        else -> {
            val filtered = filterCachedTasks(tasks, paneState.taskSearch, paneState.taskFilter)
            Column(modifier = Modifier.fillMaxSize()) {
                OutlinedTextField(
                    value = paneState.taskSearch,
                    onValueChange = { paneState.taskSearch = it.take(100) },
                    modifier = Modifier.fillMaxWidth().padding(horizontal = 12.dp, vertical = 8.dp),
                    label = { Text("Taskを検索") },
                    singleLine = true,
                )
                Row(
                    modifier = Modifier.fillMaxWidth().padding(horizontal = 12.dp),
                    horizontalArrangement = Arrangement.spacedBy(8.dp),
                ) {
                    listOf(
                        TaskListFilter.Open to "進行中",
                        TaskListFilter.Done to "完了",
                        TaskListFilter.All to "すべて",
                    ).forEach { (filter, label) ->
                        FilterChip(
                            selected = paneState.taskFilter == filter,
                            onClick = { paneState.taskFilter = filter },
                            label = { Text(label) },
                        )
                    }
                }
                if (filtered.isEmpty()) {
                    CenteredState {
                        Text(if (tasks.isEmpty()) "Taskはありません" else "条件に合うTaskはありません")
                        if (paneState.taskSearch.isNotEmpty()) {
                            TextButton(onClick = { paneState.taskSearch = "" }) { Text("検索を解除") }
                        }
                    }
                } else {
                    TodayTaskList(filtered, paneState, onTaskSelected, allTasksMode = true)
                }
            }
        }
    }
}

@Composable
private fun AiInboxListPane(
    uiState: TodayUiState,
    tasks: List<MobileTask>,
    paneState: TodayPaneState,
    onRetry: () -> Unit,
    onRetryPairing: () -> Unit,
    onPair: (String, String) -> Unit,
    onTaskSelected: (String) -> Unit,
) {
    when {
        uiState is TodayUiState.PairingRequired -> PairingPane(uiState, onPair)
        uiState is TodayUiState.Error && tasks.isEmpty() -> GatewayErrorState(uiState, onRetry, onRetryPairing)
        uiState is TodayUiState.Loading && tasks.isEmpty() -> CenteredState {
            CircularProgressIndicator()
            Text("AI Inboxを読み込んでいます")
        }
        else -> {
            val sections = filterAiInboxTasks(tasks)
            if (sections.isEmpty()) {
                CenteredState { Text("AI作業中のTaskはありません") }
            } else {
                val listState = rememberLazyListState(
                    initialFirstVisibleItemIndex = paneState.aiListScrollIndex,
                    initialFirstVisibleItemScrollOffset = paneState.aiListScrollOffset,
                )
                LaunchedEffect(listState) {
                    snapshotFlow { listState.firstVisibleItemIndex to listState.firstVisibleItemScrollOffset }
                        .collect { (index, offset) -> paneState.recordAiScroll(index, offset) }
                }
                LazyColumn(
                    modifier = Modifier.fillMaxSize().testTag("ai-inbox-list"),
                    state = listState,
                    contentPadding = PaddingValues(12.dp),
                    verticalArrangement = Arrangement.spacedBy(8.dp),
                ) {
                    for ((section, sectionTasks) in sections) {
                        item(key = "section-${section.name}") {
                            Text(
                                aiInboxSectionLabel(section),
                                modifier = Modifier.padding(top = 8.dp, bottom = 4.dp),
                                style = MaterialTheme.typography.titleMedium,
                                fontWeight = FontWeight.Bold,
                            )
                        }
                        items(sectionTasks, key = { it.id }) { task ->
                            Card(
                                modifier = Modifier
                                    .fillMaxWidth()
                                    .semantics { role = Role.Button }
                                    .clickable { onTaskSelected(task.id) },
                                colors = CardDefaults.cardColors(
                                    containerColor = if (task.id == paneState.selectedTaskId) {
                                        MaterialTheme.colorScheme.secondaryContainer
                                    } else {
                                        MaterialTheme.colorScheme.surface
                                    },
                                ),
                                border = BorderStroke(
                                    1.dp,
                                    if (task.id == paneState.selectedTaskId) {
                                        MaterialTheme.colorScheme.primary
                                    } else {
                                        MaterialTheme.colorScheme.outline
                                    },
                                ),
                            ) {
                                Column(
                                    modifier = Modifier.fillMaxWidth().padding(14.dp),
                                    verticalArrangement = Arrangement.spacedBy(6.dp),
                                ) {
                                    Text(task.title, fontWeight = FontWeight.SemiBold)
                                    Text(
                                        taskWorkStateLabel(task.workState ?: ""),
                                        color = MaterialTheme.colorScheme.primary,
                                    )
                                    task.latestWorkReceipt?.summary?.let { summary ->
                                        Text(
                                            summary,
                                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                                            maxLines = 2,
                                        )
                                    }
                                }
                            }
                        }
                    }
                }
            }
        }
    }
}

@Composable
private fun GatewayErrorState(
    state: TodayUiState.Error,
    onRetry: () -> Unit,
    onRetryPairing: () -> Unit,
) {
    CenteredState {
        Text(state.message, fontWeight = FontWeight.SemiBold)
        Text(state.recovery, color = MaterialTheme.colorScheme.onSurfaceVariant)
        Button(onClick = onRetry) { Text("再読み込み") }
        TextButton(onClick = onRetryPairing) { Text("やり直す") }
    }
}

@Composable
private fun PairingPane(
    state: TodayUiState.PairingRequired,
    onPair: (String, String) -> Unit,
) {
    var origin by remember(state.origin) { mutableStateOf(state.origin) }
    var pairingCode by remember { mutableStateOf("") }
    CenteredState {
        Text("Desktopと接続", fontWeight = FontWeight.SemiBold)
        if (state.message.isNotBlank()) {
            Text(state.message, color = MaterialTheme.colorScheme.error)
        }
        OutlinedTextField(
            value = origin,
            onValueChange = { origin = it },
            label = { Text("Tailscale Serve URL") },
            placeholder = { Text("https://tasken.example.ts.net") },
            singleLine = true,
            modifier = Modifier.fillMaxWidth(),
        )
        OutlinedTextField(
            value = pairingCode,
            onValueChange = { pairingCode = it.filter(Char::isDigit).take(8) },
            label = { Text("8桁のPairing code") },
            keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Number),
            singleLine = true,
            modifier = Modifier.fillMaxWidth(),
        )
        Button(
            onClick = { onPair(origin, pairingCode) },
            enabled = origin.isNotBlank() && pairingCode.length == 8,
        ) {
            Text("接続")
        }
    }
}


@Composable
private fun TodayTaskList(
    tasks: List<MobileTask>,
    paneState: TodayPaneState,
    onTaskSelected: (String) -> Unit,
    allTasksMode: Boolean = false,
) {
    val listState = rememberLazyListState(
        initialFirstVisibleItemIndex = if (allTasksMode) paneState.taskListScrollIndex else paneState.listScrollIndex,
        initialFirstVisibleItemScrollOffset = if (allTasksMode) paneState.taskListScrollOffset else paneState.listScrollOffset,
    )
    LaunchedEffect(listState) {
        snapshotFlow { listState.firstVisibleItemIndex to listState.firstVisibleItemScrollOffset }
            .collect { (index, offset) ->
                if (allTasksMode) paneState.recordTaskScroll(index, offset) else paneState.recordScroll(index, offset)
            }
    }
    LazyColumn(
        modifier = Modifier.fillMaxSize(),
        state = listState,
        contentPadding = PaddingValues(12.dp),
        verticalArrangement = Arrangement.spacedBy(8.dp),
    ) {
        items(tasks, key = { it.id }) { task ->
            Card(
                modifier = Modifier
                    .fillMaxWidth()
                    .semantics { role = Role.Button }
                    .clickable { onTaskSelected(task.id) },
                colors = CardDefaults.cardColors(
                    containerColor = if (task.id == paneState.selectedTaskId) {
                        MaterialTheme.colorScheme.secondaryContainer
                    } else {
                        MaterialTheme.colorScheme.surface
                    },
                ),
                border = BorderStroke(
                    1.dp,
                    if (task.id == paneState.selectedTaskId) {
                        MaterialTheme.colorScheme.primary
                    } else {
                        MaterialTheme.colorScheme.outline
                    },
                ),
            ) {
                Row(
                    modifier = Modifier.fillMaxWidth().padding(14.dp),
                    horizontalArrangement = Arrangement.SpaceBetween,
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    Text(task.title, modifier = Modifier.weight(1f), fontWeight = FontWeight.SemiBold)
                    Column(horizontalAlignment = Alignment.End, verticalArrangement = Arrangement.spacedBy(4.dp)) {
                        if (task.pending) {
                            Surface(
                                color = MaterialTheme.colorScheme.secondaryContainer,
                                shape = RoundedCornerShape(7.dp),
                            ) {
                                Text(
                                    "送信待ち",
                                    modifier = Modifier.padding(horizontal = 8.dp, vertical = 4.dp),
                                    color = MaterialTheme.colorScheme.onSecondaryContainer,
                                    fontSize = 11.sp,
                                )
                            }
                        }
                        Text(taskStateLabel(task.state), color = MaterialTheme.colorScheme.primary)
                    }
                }
            }
        }
    }
}

@Composable
internal fun TodayDetailPane(
    task: MobileTask?,
    actionState: TaskActionUiState,
    themes: List<MobileTheme> = emptyList(),
    themeCatalogState: MobileThemeCatalogState = if (themes.isEmpty()) {
        MobileThemeCatalogState.Loading()
    } else {
        MobileThemeCatalogState.Available(themes, "local", 0, "")
    },
    onStateAction: (MobileTask) -> Unit,
    onTitleUpdate: (MobileTask, String) -> Unit = { _, _ -> },
    onTodayDateUpdate: (MobileTask, LocalDate?) -> Unit = { _, _ -> },
    onThemeUpdate: (MobileTask, String) -> Unit = { _, _ -> },
    onScheduleUpdate: (MobileTask, MobileTaskScheduleDraft) -> Unit = { _, _ -> },
    onRejectedThemeDiscard: (MobileTask) -> Unit = {},
    onConflictResolution: (MobileTask, Boolean) -> Unit = { _, _ -> },
) {
    if (task == null) {
        CenteredState { Text("Taskを選んでください") }
        return
    }
    var titleDraft by rememberSaveable(task.id) { mutableStateOf(task.title) }
    var themePickerOpenRequest by rememberSaveable(task.id) { mutableStateOf(0) }
    val canReselectTheme = themes.isNotEmpty() &&
        (themeCatalogState is MobileThemeCatalogState.Available ||
            themeCatalogState is MobileThemeCatalogState.Stale)
    LaunchedEffect(task.id, task.title, actionState) {
        val resolution = actionState as? TaskActionUiState.ConflictResolved
        if (resolution?.taskId == task.id) titleDraft = task.title
    }
    Surface(modifier = Modifier.fillMaxSize(), color = MaterialTheme.colorScheme.surface) {
        Column(
            modifier = Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(20.dp),
            verticalArrangement = Arrangement.spacedBy(12.dp),
        ) {
            Text(task.title, fontSize = 24.sp, fontWeight = FontWeight.Bold)
            OutlinedTextField(
                value = titleDraft,
                onValueChange = { if (it.length <= 500) titleDraft = it },
                modifier = Modifier.fillMaxWidth().testTag("task-title"),
                label = { Text("Task名") },
                singleLine = true,
                keyboardOptions = KeyboardOptions(imeAction = ImeAction.Done),
                keyboardActions = KeyboardActions(onDone = { onTitleUpdate(task, titleDraft) }),
                enabled = !task.pending && task.conflict == null && actionState !is TaskActionUiState.Saving,
            )
            Button(
                onClick = { onTitleUpdate(task, titleDraft) },
                enabled = titleDraft.trim().isNotEmpty() && titleDraft.trim() != task.title &&
                    !task.pending && task.conflict == null && actionState !is TaskActionUiState.Saving,
            ) { Text("Task名を保存") }
            if (task.pending) Text("送信待ち", color = MaterialTheme.colorScheme.onSecondaryContainer)
            task.conflict?.let { conflict ->
                Card(
                    colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.errorContainer),
                ) {
                    Column(
                        modifier = Modifier.fillMaxWidth().padding(12.dp),
                        verticalArrangement = Arrangement.spacedBy(8.dp),
                    ) {
                        Text("同期できなかった変更", fontWeight = FontWeight.Bold)
                        if (conflict.intendedAction == "UpdateTask") {
                            if (conflict.localThemeIdChanged) {
                                Text("Desktop  Theme ${themeTitleForDisplay(themes, conflict.serverThemeId)}")
                                Text("この端末  Theme ${themeTitleForDisplay(themes, conflict.localThemeId)}")
                            } else if (conflict.localScheduleChanged) {
                                Text("Desktop  予定 ${scheduleConflictLabel(conflict.serverSchedule)}")
                                Text("この端末  予定 ${scheduleConflictLabel(conflict.localSchedule)}")
                            } else if (conflict.localPlannedScheduleChanged) {
                                Text("時刻の変更は使えません。Desktopを採用してください。")
                            } else if (conflict.localTodayDateChanged) {
                                Text("Desktop  日付 ${taskTodayDateLabel(conflict.serverTodayDate)}")
                                Text("この端末  日付 ${taskTodayDateLabel(conflict.localTodayDate)}")
                            } else {
                                Text("Desktop  ${task.title}")
                                Text("この端末  ${conflict.localTitle}")
                            }
                        } else {
                            Text("Desktop  ${taskStateLabel(conflict.serverState)}  v${conflict.serverVersion}")
                            Text(
                                "この端末  ${if (conflict.intendedAction == "CompleteTask") "完了" else "再開"}  " +
                                    "(v${conflict.expectedVersion}から)",
                            )
                        }
                        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                            Button(
                                onClick = { onConflictResolution(task, true) },
                                enabled = actionState !is TaskActionUiState.Saving,
                            ) { Text("この端末を採用") }
                            TextButton(
                                onClick = { onConflictResolution(task, false) },
                                enabled = actionState !is TaskActionUiState.Saving,
                            ) { Text("Desktopを採用") }
                        }
                    }
                }
            }
            task.rejectedThemeUpdate?.let { rejection ->
                Card(
                    modifier = Modifier.fillMaxWidth().testTag("theme-rejection"),
                    colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.errorContainer),
                ) {
                    Column(
                        modifier = Modifier.fillMaxWidth().padding(12.dp),
                        verticalArrangement = Arrangement.spacedBy(8.dp),
                    ) {
                        Text("Theme変更を送信できませんでした", fontWeight = FontWeight.Bold)
                        Text(rejection.message)
                        Text("Themeを選び直すか、この変更を取り下げてください。")
                        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                            Button(
                                onClick = { themePickerOpenRequest += 1 },
                                enabled = canReselectTheme && actionState !is TaskActionUiState.Saving,
                                modifier = Modifier.testTag("theme-rejection-reselect"),
                            ) { Text("選び直す") }
                            TextButton(
                                onClick = { onRejectedThemeDiscard(task) },
                                enabled = actionState !is TaskActionUiState.Saving,
                                modifier = Modifier.testTag("theme-rejection-discard"),
                            ) { Text("取り下げる") }
                        }
                    }
                }
            }
            TaskThemePicker(
                taskId = task.id,
                themeId = task.themeId,
                themes = themes,
                catalogState = themeCatalogState,
                openRequest = themePickerOpenRequest,
                enabled = !task.pending && task.conflict == null && actionState !is TaskActionUiState.Saving,
                stateDescription = when {
                    task.pending -> "同期後に変更"
                    task.conflict != null -> "競合を解決してから変更"
                    actionState is TaskActionUiState.Saving -> "保存中"
                    themeCatalogState is MobileThemeCatalogState.Loading -> {
                        if (themes.isEmpty()) "Theme一覧を読み込み中" else "Theme一覧を更新中"
                    }
                    themeCatalogState is MobileThemeCatalogState.Stale -> "オフラインのTheme一覧を使用中"
                    themeCatalogState is MobileThemeCatalogState.Unsupported -> "このDesktopではTheme編集を利用できません"
                    themeCatalogState is MobileThemeCatalogState.Error -> "Theme一覧を取得できません"
                    themes.isEmpty() -> "利用できるThemeがありません"
                    else -> null
                },
                onThemeSelected = { onThemeUpdate(task, it) },
            )
            TaskScheduleEditor(
                task = task,
                enabled = !task.pending && task.conflict == null &&
                    actionState !is TaskActionUiState.Saving,
                stateDescription = when {
                    task.pending -> "同期後に変更"
                    task.conflict != null -> "競合を解決してから変更"
                    actionState is TaskActionUiState.Saving -> "保存中"
                    else -> null
                },
                onSave = { onScheduleUpdate(task, it) },
            )
            Text("状態  ${taskStateLabel(task.state)}")
            task.workState?.let { Text("作業状態  ${taskWorkStateLabel(it)}") }
            task.latestWorkReceipt?.let { receipt ->
                Card(
                    modifier = Modifier.fillMaxWidth().testTag("work-receipt-summary"),
                    colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surfaceVariant),
                ) {
                    Column(
                        modifier = Modifier.fillMaxWidth().padding(12.dp),
                        verticalArrangement = Arrangement.spacedBy(6.dp),
                    ) {
                        Text("最新のWork Receipt", style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.Bold)
                        Text("${receipt.executorLabel}  ${receipt.reportedAt}", color = MaterialTheme.colorScheme.onSurfaceVariant)
                        Text(receipt.summary)
                    }
                }
            }
            val today = LocalDate.now()
            Text("日付  ${taskTodayDateLabel(task.todayDate, today.toString())}")
            Button(
                onClick = {
                    onTodayDateUpdate(task, if (task.todayDate == today.toString()) null else today)
                },
                enabled = !task.pending && task.conflict == null && actionState !is TaskActionUiState.Saving,
            ) {
                Text(if (task.todayDate == today.toString()) "今日から外す" else "今日に入れる")
            }
            Text("更新  ${task.updatedAt}", color = MaterialTheme.colorScheme.onSurfaceVariant)
            Button(
                onClick = { onStateAction(task) },
                enabled = (!task.pending || task.canChangePendingState) &&
                    task.conflict == null && actionState !is TaskActionUiState.Saving,
            ) {
                Text(
                    when {
                        actionState is TaskActionUiState.Saving && actionState.taskId == task.id -> "保存中"
                        task.conflict != null -> "競合を解決してから操作"
                        task.pending && !task.canChangePendingState -> "同期後に操作"
                        task.pending && task.state == "done" -> "再開に変更"
                        task.pending -> "完了に変更"
                        task.state == "done" -> "再開する"
                        else -> "完了する"
                    },
                )
            }
        }
    }
}

private enum class ScheduleDateTarget {
    Start,
    End,
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun TaskScheduleEditor(
    task: MobileTask,
    enabled: Boolean,
    stateDescription: String?,
    onSave: (MobileTaskScheduleDraft) -> Unit,
) {
    val schedule = task.schedule
    val scheduleFingerprint = listOf(
        schedule?.id,
        schedule?.version,
        schedule?.startDate,
        schedule?.endDate,
        schedule?.rangeSemantics,
    ).joinToString("|")
    var startDraft by rememberSaveable(task.id, scheduleFingerprint) {
        mutableStateOf(schedule?.startDate.orEmpty())
    }
    var endDraft by rememberSaveable(task.id, scheduleFingerprint) {
        mutableStateOf(schedule?.endDate.orEmpty())
    }
    var rangeSemanticsDraft by rememberSaveable(task.id, scheduleFingerprint) {
        mutableStateOf(schedule?.rangeSemantics.orEmpty())
    }
    var dateTarget by rememberSaveable(task.id) { mutableStateOf<ScheduleDateTarget?>(null) }

    val startDate = startDraft.toLocalDateOrNull()
    val endDate = endDraft.toLocalDateOrNull()
    val isValid = startDate == null || endDate == null || !endDate.isBefore(startDate)
    val isTrueRange = isTrueScheduleRange(startDate, endDate)
    val draft = MobileTaskScheduleDraft(
        startDate = startDate?.toString(),
        endDate = endDate?.toString(),
        rangeSemantics = rangeSemanticsDraft.takeIf { isTrueRange && it.isNotEmpty() },
    )
    val original = MobileTaskScheduleDraft(
        startDate = schedule?.startDate,
        endDate = schedule?.endDate,
        rangeSemantics = schedule?.rangeSemantics,
    )
    val hasChanges = draft != original

    fun updateDates(newStart: LocalDate?, newEnd: LocalDate?) {
        val wasTrueRange = isTrueScheduleRange(startDate, endDate)
        val becomesTrueRange = isTrueScheduleRange(newStart, newEnd)
        startDraft = newStart?.toString().orEmpty()
        endDraft = newEnd?.toString().orEmpty()
        rangeSemanticsDraft = when {
            !becomesTrueRange -> ""
            wasTrueRange -> rangeSemanticsDraft
            else -> "once_within_window"
        }
    }

    Column(
        modifier = Modifier.fillMaxWidth().testTag("task-schedule-editor"),
        verticalArrangement = Arrangement.spacedBy(8.dp),
    ) {
        Row(
            modifier = Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.SpaceBetween,
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Text("予定", style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.Bold)
            Text(
                scheduleDraftLabel(startDate, endDate, rangeSemanticsDraft),
                modifier = Modifier.testTag("schedule-kind"),
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
        }
        ScheduleDateField(
            label = "開始",
            value = startDate,
            enabled = enabled,
            stateDescription = stateDescription,
            fieldTag = "schedule-start-date",
            clearTag = "schedule-start-clear",
            onOpen = { dateTarget = ScheduleDateTarget.Start },
            onClear = { updateDates(null, endDate) },
        )
        ScheduleDateField(
            label = "期限",
            value = endDate,
            enabled = enabled,
            stateDescription = stateDescription,
            fieldTag = "schedule-end-date",
            clearTag = "schedule-end-clear",
            onOpen = { dateTarget = ScheduleDateTarget.End },
            onClear = { updateDates(startDate, null) },
        )
        if (!isValid) {
            Text(
                "期限は開始以降を選んでください。",
                modifier = Modifier.testTag("schedule-date-error"),
                color = MaterialTheme.colorScheme.error,
            )
        }
        if (isTrueRange) {
            Text("この期間の意味", fontWeight = FontWeight.SemiBold)
            if (rangeSemanticsDraft.isEmpty()) {
                Text(
                    "期間未分類",
                    modifier = Modifier.testTag("schedule-range-unspecified"),
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }
            Row(
                modifier = Modifier.fillMaxWidth().testTag("schedule-range-semantics"),
                horizontalArrangement = Arrangement.spacedBy(8.dp),
            ) {
                FilterChip(
                    selected = rangeSemanticsDraft == "once_within_window",
                    onClick = { rangeSemanticsDraft = "once_within_window" },
                    enabled = enabled,
                    label = { Text("期間内に一度") },
                    modifier = Modifier.testTag("schedule-range-once"),
                )
                FilterChip(
                    selected = rangeSemanticsDraft == "ongoing",
                    onClick = { rangeSemanticsDraft = "ongoing" },
                    enabled = enabled,
                    label = { Text("期間中継続") },
                    modifier = Modifier.testTag("schedule-range-ongoing"),
                )
            }
        }
        Row(
            modifier = Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.spacedBy(8.dp, Alignment.End),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            TextButton(
                onClick = { updateDates(null, null) },
                enabled = enabled && (startDate != null || endDate != null || rangeSemanticsDraft.isNotEmpty()),
                modifier = Modifier.testTag("schedule-clear"),
            ) { Text("予定をクリア") }
            Button(
                onClick = { onSave(draft) },
                enabled = enabled && isValid && hasChanges,
                modifier = Modifier.testTag("schedule-save"),
            ) { Text("予定を保存") }
        }
    }

    dateTarget?.let { target ->
        val currentDate = if (target == ScheduleDateTarget.Start) startDate else endDate
        val pickerState = rememberDatePickerState(
            initialSelectedDateMillis = currentDate?.toPickerMillis(),
        )
        DatePickerDialog(
            onDismissRequest = { dateTarget = null },
            confirmButton = {
                TextButton(
                    onClick = {
                        pickerState.selectedDateMillis?.toPickerLocalDate()?.let { selectedDate ->
                            if (target == ScheduleDateTarget.Start) {
                                updateDates(selectedDate, endDate)
                            } else {
                                updateDates(startDate, selectedDate)
                            }
                        }
                        dateTarget = null
                    },
                    enabled = pickerState.selectedDateMillis != null,
                ) { Text("決定") }
            },
            dismissButton = {
                TextButton(onClick = { dateTarget = null }) { Text("キャンセル") }
            },
        ) {
            DatePicker(
                state = pickerState,
                title = {
                    Text(
                        if (target == ScheduleDateTarget.Start) "開始を選択" else "期限を選択",
                        modifier = Modifier.padding(start = 24.dp, top = 16.dp),
                    )
                },
            )
        }
    }
}

@Composable
private fun ScheduleDateField(
    label: String,
    value: LocalDate?,
    enabled: Boolean,
    stateDescription: String?,
    fieldTag: String,
    clearTag: String,
    onOpen: () -> Unit,
    onClear: () -> Unit,
) {
    Row(
        modifier = Modifier.fillMaxWidth(),
        horizontalArrangement = Arrangement.spacedBy(8.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        OutlinedButton(
            onClick = onOpen,
            enabled = enabled,
            modifier = Modifier
                .weight(1f)
                .testTag(fieldTag)
                .semantics {
                    this.stateDescription = stateDescription ?: "$label: ${value ?: "未設定"}"
                },
        ) {
            Text("$label  ${value ?: "未設定"}")
        }
        TextButton(
            onClick = onClear,
            enabled = enabled && value != null,
            modifier = Modifier.testTag(clearTag),
        ) { Text("解除") }
    }
}

private fun String.toLocalDateOrNull(): LocalDate? = takeIf(String::isNotEmpty)?.let(LocalDate::parse)

private fun isTrueScheduleRange(startDate: LocalDate?, endDate: LocalDate?): Boolean =
    startDate != null && endDate != null && endDate.isAfter(startDate)

private fun scheduleDraftLabel(
    startDate: LocalDate?,
    endDate: LocalDate?,
    rangeSemantics: String,
): String = when {
    startDate == null && endDate == null -> "未設定"
    startDate == null -> "期限"
    endDate == null || startDate == endDate -> "実施日"
    rangeSemantics == "once_within_window" -> "期間内に一度"
    rangeSemantics == "ongoing" -> "期間中継続"
    else -> "期間未分類"
}

private fun scheduleConflictLabel(schedule: MobileTaskSchedule?): String = scheduleConflictLabel(
    startDate = schedule?.startDate,
    endDate = schedule?.endDate,
    rangeSemantics = schedule?.rangeSemantics,
)

private fun scheduleConflictLabel(schedule: MobileTaskScheduleDraft?): String = scheduleConflictLabel(
    startDate = schedule?.startDate,
    endDate = schedule?.endDate,
    rangeSemantics = schedule?.rangeSemantics,
)

private fun scheduleConflictLabel(
    startDate: String?,
    endDate: String?,
    rangeSemantics: String?,
): String {
    if (startDate == null && endDate == null) return "未設定"
    return buildList {
        startDate?.let { add("開始 $it") }
        endDate?.let { add("期限 $it") }
        if (startDate != null && endDate != null && endDate > startDate) {
            add(
                when (rangeSemantics) {
                    "once_within_window" -> "期間内に一度"
                    "ongoing" -> "期間中継続"
                    else -> "期間未分類"
                },
            )
        }
    }.joinToString(" / ")
}

private const val MillisPerDay = 86_400_000L

private fun LocalDate.toPickerMillis(): Long = toEpochDay() * MillisPerDay

private fun Long.toPickerLocalDate(): LocalDate = LocalDate.ofEpochDay(Math.floorDiv(this, MillisPerDay))

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun TaskThemePicker(
    taskId: String,
    themeId: String?,
    themes: List<MobileTheme>,
    catalogState: MobileThemeCatalogState,
    openRequest: Int = 0,
    enabled: Boolean,
    stateDescription: String?,
    onThemeSelected: (String) -> Unit,
) {
    var expanded by rememberSaveable(taskId) { mutableStateOf(false) }
    val selectedTheme = themes.firstOrNull { it.id == themeId }
    val catalogAllowsSelection = catalogState is MobileThemeCatalogState.Available ||
        catalogState is MobileThemeCatalogState.Stale
    val pickerEnabled = enabled && catalogAllowsSelection && themes.isNotEmpty()
    LaunchedEffect(openRequest, pickerEnabled) {
        if (openRequest > 0 && pickerEnabled) expanded = true
    }
    val displayedState = stateDescription ?: selectedTheme?.let { "現在のTheme: ${it.title}" }
        ?: "現在のTheme情報なし"
    val emptyValue = when (catalogState) {
        is MobileThemeCatalogState.Loading -> "読み込み中"
        is MobileThemeCatalogState.Unsupported -> "未対応"
        is MobileThemeCatalogState.Error -> "取得できません"
        is MobileThemeCatalogState.Available,
        is MobileThemeCatalogState.Stale -> "Theme情報なし"
    }

    ExposedDropdownMenuBox(
        expanded = expanded,
        onExpandedChange = { if (pickerEnabled) expanded = !expanded },
        modifier = Modifier.fillMaxWidth(),
    ) {
        OutlinedTextField(
            value = selectedTheme?.title ?: emptyValue,
            onValueChange = {},
            modifier = Modifier
                .menuAnchor(ExposedDropdownMenuAnchorType.PrimaryNotEditable, enabled = pickerEnabled)
                .fillMaxWidth()
                .testTag("task-theme-picker")
                .semantics { this.stateDescription = displayedState },
            label = { Text("Theme") },
            trailingIcon = { ExposedDropdownMenuDefaults.TrailingIcon(expanded = expanded) },
            readOnly = true,
            singleLine = true,
            enabled = pickerEnabled,
        )
        ExposedDropdownMenu(
            expanded = expanded,
            onDismissRequest = { expanded = false },
        ) {
            themes.forEach { theme ->
                val isSelected = theme.id == themeId
                DropdownMenuItem(
                    text = { Text(theme.title) },
                    trailingIcon = { if (isSelected) Text("選択中") },
                    onClick = {
                        expanded = false
                        if (!isSelected) onThemeSelected(theme.id)
                    },
                    modifier = Modifier.semantics { selected = isSelected },
                )
            }
        }
    }
    val helperText = when (catalogState) {
        is MobileThemeCatalogState.Loading -> null
        is MobileThemeCatalogState.Available -> if (themes.isEmpty()) "利用できるThemeがありません。" else null
        is MobileThemeCatalogState.Stale -> "Theme一覧はオフラインです。変更は送信待ちになります。"
        is MobileThemeCatalogState.Unsupported -> "Desktopを更新するとThemeを変更できます。"
        is MobileThemeCatalogState.Error -> "接続を確認して再試行してください。"
    }
    if (helperText != null) {
        Text(
            helperText,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
        )
    }
}

private fun themeTitleForDisplay(themes: List<MobileTheme>, themeId: String?): String =
    themes.firstOrNull { it.id == themeId }?.title ?: "Theme情報なし"

@Composable
private fun CenteredState(content: @Composable () -> Unit) {
    Column(
        modifier = Modifier.fillMaxSize().padding(24.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.spacedBy(12.dp, Alignment.CenterVertically),
    ) { content() }
}

private val TodayPaneStateSaver = Saver<TodayPaneState, List<Any?>>(
    save = { it.save() },
    restore = { TodayPaneState.restore(it) },
)

@Composable
private fun rememberTodayPaneState(): TodayPaneState =
    rememberSaveable(saver = TodayPaneStateSaver) { TodayPaneState() }
