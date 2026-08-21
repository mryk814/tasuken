package jp.personal.tasken.companion

import android.content.res.Configuration
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.clickable
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
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Scaffold
import androidx.compose.material3.SnackbarHost
import androidx.compose.material3.SnackbarHostState
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.TopAppBar
import androidx.compose.material3.TopAppBarDefaults
import androidx.compose.material3.adaptive.ExperimentalMaterial3AdaptiveApi
import androidx.compose.material3.adaptive.currentWindowAdaptiveInfo
import androidx.compose.material3.adaptive.layout.AnimatedPane
import androidx.compose.material3.adaptive.layout.ListDetailPaneScaffoldRole
import androidx.compose.material3.adaptive.layout.calculatePaneScaffoldDirective
import androidx.compose.material3.adaptive.navigation.NavigableListDetailPaneScaffold
import androidx.compose.material3.adaptive.navigation.rememberListDetailPaneScaffoldNavigator
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
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
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.role
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.lifecycle.viewmodel.compose.viewModel
import kotlinx.coroutines.launch

class MainActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        val repository = AndroidMobileTaskRepository(applicationContext)
        setContent {
            TaskenTheme {
                TodayApp(viewModel(factory = TodayViewModelFactory(repository)))
            }
        }
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

@OptIn(ExperimentalMaterial3Api::class, ExperimentalMaterial3AdaptiveApi::class)
@Composable
private fun TodayApp(todayViewModel: TodayViewModel = viewModel()) {
    val uiState by todayViewModel.uiState.collectAsState()
    val captureState by todayViewModel.captureState.collectAsState()
    val taskActionState by todayViewModel.taskActionState.collectAsState()
    val pendingCount by todayViewModel.pendingCount.collectAsState()
    val paneState = rememberTodayPaneState()
    val adaptiveInfo = currentWindowAdaptiveInfo()
    val navigator = rememberListDetailPaneScaffoldNavigator(
        scaffoldDirective = calculatePaneScaffoldDirective(adaptiveInfo),
    )
    val coroutineScope = rememberCoroutineScope()
    val snackbarHostState = remember { SnackbarHostState() }

    LaunchedEffect(Unit) { todayViewModel.load() }
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
                snackbarHostState.showSnackbar("Taskの状態を更新しました。Desktopへ自動送信します。")
                todayViewModel.resetTaskActionState()
            }
            is TaskActionUiState.Error -> {
                snackbarHostState.showSnackbar((taskActionState as TaskActionUiState.Error).message)
            }
            TaskActionUiState.Idle, is TaskActionUiState.Saving -> Unit
        }
    }

    Scaffold(
        snackbarHost = { SnackbarHost(snackbarHostState) },
        topBar = {
            TopAppBar(
                title = { Text("Today") },
                actions = {
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
                    TextButton(onClick = { paneState.captureOpen = true }) { Text("追加") }
                },
                colors = TopAppBarDefaults.topAppBarColors(
                    containerColor = MaterialTheme.colorScheme.surface,
                ),
            )
        },
    ) { padding ->
        NavigableListDetailPaneScaffold(
            navigator = navigator,
            listPane = {
                AnimatedPane {
                    TodayListPane(
                        uiState = uiState,
                        paneState = paneState,
                        onRetry = todayViewModel::load,
                        onPair = todayViewModel::pair,
                        onTaskSelected = { taskId ->
                            paneState.selectedTaskId = taskId
                            coroutineScope.launch {
                                navigator.navigateTo(ListDetailPaneScaffoldRole.Detail, taskId)
                            }
                        },
                    )
                }
            },
            detailPane = {
                AnimatedPane {
                    val task = (uiState as? TodayUiState.Success)
                        ?.tasks
                        ?.firstOrNull { it.id == paneState.selectedTaskId }
                    TodayDetailPane(
                        task = task,
                        actionState = taskActionState,
                        onStateAction = todayViewModel::toggleTaskState,
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
        is TodayUiState.Error -> CenteredState {
            Text(uiState.message, fontWeight = FontWeight.SemiBold)
            Text(uiState.recovery, color = MaterialTheme.colorScheme.onSurfaceVariant)
            Button(onClick = onRetry) { Text("再読み込み") }
        }
        is TodayUiState.Success -> TodayTaskList(uiState.tasks, paneState, onTaskSelected)
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
            keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.NumberPassword),
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
) {
    val listState = rememberLazyListState(
        initialFirstVisibleItemIndex = paneState.listScrollIndex,
        initialFirstVisibleItemScrollOffset = paneState.listScrollOffset,
    )
    LaunchedEffect(listState) {
        snapshotFlow { listState.firstVisibleItemIndex to listState.firstVisibleItemScrollOffset }
            .collect { (index, offset) -> paneState.recordScroll(index, offset) }
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
    onStateAction: (MobileTask) -> Unit,
) {
    if (task == null) {
        CenteredState { Text("Taskを選んでください") }
        return
    }
    Surface(modifier = Modifier.fillMaxSize(), color = MaterialTheme.colorScheme.surface) {
        Column(modifier = Modifier.padding(20.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
            Text(task.title, fontSize = 24.sp, fontWeight = FontWeight.Bold)
            if (task.pending) Text("送信待ち", color = MaterialTheme.colorScheme.onSecondaryContainer)
            Text("状態  ${taskStateLabel(task.state)}")
            task.workState?.let { Text("作業状態  $it") }
            Text("更新  ${task.updatedAt}", color = MaterialTheme.colorScheme.onSurfaceVariant)
            Button(
                onClick = { onStateAction(task) },
                enabled = !task.pending && actionState !is TaskActionUiState.Saving,
            ) {
                Text(
                    when {
                        actionState is TaskActionUiState.Saving && actionState.taskId == task.id -> "保存中"
                        task.pending -> "同期後に操作"
                        task.state == "done" -> "再開する"
                        else -> "完了する"
                    },
                )
            }
        }
    }
}

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
