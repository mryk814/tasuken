package jp.personal.tasken.companion

import android.content.res.Configuration
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.text.KeyboardOptions
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
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
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
    val paneState = rememberTodayPaneState()
    val adaptiveInfo = currentWindowAdaptiveInfo()
    val navigator = rememberListDetailPaneScaffoldNavigator(
        scaffoldDirective = calculatePaneScaffoldDirective(adaptiveInfo),
    )
    val coroutineScope = rememberCoroutineScope()

    LaunchedEffect(Unit) { todayViewModel.load() }

    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text("Today") },
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
                    TodayDetailPane(task)
                }
            },
            modifier = Modifier.padding(padding),
        )
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
                    Text(task.state, color = MaterialTheme.colorScheme.primary)
                }
            }
        }
    }
}

@Composable
private fun TodayDetailPane(task: MobileTask?) {
    if (task == null) {
        CenteredState { Text("Taskを選んでください") }
        return
    }
    Surface(modifier = Modifier.fillMaxSize(), color = MaterialTheme.colorScheme.surface) {
        Column(modifier = Modifier.padding(20.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
            Text(task.title, fontSize = 24.sp, fontWeight = FontWeight.Bold)
            Text("状態  ${task.state}")
            task.workState?.let { Text("作業状態  $it") }
            Text("更新  ${task.updatedAt}", color = MaterialTheme.colorScheme.onSurfaceVariant)
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
    save = { listOf(it.selectedTaskId, it.listScrollIndex, it.listScrollOffset) },
    restore = { TodayPaneState.restore(it) },
)

@Composable
private fun rememberTodayPaneState(): TodayPaneState =
    rememberSaveable(saver = TodayPaneStateSaver) { TodayPaneState() }
