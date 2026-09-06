package jp.personal.tasken.companion

import android.Manifest
import android.content.pm.PackageManager
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.text.selection.SelectionContainer
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Modifier
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalSoftwareKeyboardController
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.unit.dp
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

/** Entry and saved records share a self-contained surface, reusable outside Today. */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
internal fun MobileWorkLogSheet(
    repository: MobileWorkLogRepository,
    themes: List<MobileTheme>,
    tasks: List<MobileTask>,
    initialTask: MobileTask? = null,
    initialRecordId: String? = null,
    onDismiss: () -> Unit,
) {
    val context = LocalContext.current
    val store = remember(context) { MobileWorkLogDraftStore(context.applicationContext) }
    val restored = remember(store) { runCatching { store.load() } }
    var draft by remember { mutableStateOf(restored.getOrNull() ?: MobileWorkLogDraft(taskId = initialTask?.id)) }
    var error by remember { mutableStateOf(if (restored.isFailure) "保存中の入力を読み込めません。元のデータは保持しています。" else null) }
    var historyOpen by rememberSaveable { mutableStateOf(initialRecordId != null) }
    var busy by remember { mutableStateOf(false) }
    var selectedId by rememberSaveable { mutableStateOf(initialRecordId) }
    val recordsFlow = remember(repository) { repository.observeWorkLogs() }
    val records by recordsFlow.collectAsState(emptyList())
    val scope = rememberCoroutineScope()
    val keyboard = LocalSoftwareKeyboardController.current
    val sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true)
    val speech = remember(context) { AndroidShortSpeechRecognizer(context.applicationContext) }
    var speechState by remember { mutableStateOf<ShortSpeechUiState>(ShortSpeechUiState.Idle(speech.availableMode())) }
    val changeDraft: (MobileWorkLogDraft) -> Unit = { next ->
        draft = next
        error = if (restored.isFailure || !runCatching { store.save(next) }.getOrDefault(false)) {
            "入力の保存に失敗しました。画面の本文を保持しています。閉じずに再試行してください。"
        } else null
    }
    val startSpeech = {
        speech.start { next ->
            speechState = next
            if (next is ShortSpeechUiState.Result) {
                changeDraft(draft.copy(body = draft.body + (if (draft.body.isEmpty()) "" else "\n") + next.result.text))
            }
        }
    }
    val microphone = rememberLauncherForActivityResult(ActivityResultContracts.RequestPermission()) { granted ->
        if (granted) startSpeech() else error = "マイク権限がありません。手入力はそのまま使えます。"
    }
    DisposableEffect(speech) { onDispose { speech.cancel() } }
    val speechBusy = speechState is ShortSpeechUiState.Listening || speechState is ShortSpeechUiState.Partial || speechState is ShortSpeechUiState.Processing
    fun action(block: suspend () -> Unit) {
        if (busy) return
        busy = true
        scope.launch {
            try { withContext(Dispatchers.IO) { block() }; error = null }
            catch (failure: Exception) { error = failure.message ?: "操作を完了できませんでした。本文は保持しています。" }
            finally { busy = false }
        }
    }
    ModalBottomSheet(
        onDismissRequest = { if (!busy && !speechBusy) onDismiss() },
        sheetState = sheetState,
        contentWindowInsets = { WindowInsets.safeDrawing.only(WindowInsetsSides.Horizontal + WindowInsetsSides.Top) },
    ) {
        Column(Modifier.fillMaxWidth().fillMaxHeight(0.94f).windowInsetsPadding(WindowInsets.safeDrawing.union(WindowInsets.ime).only(WindowInsetsSides.Bottom))) {
            Row(Modifier.fillMaxWidth().padding(horizontal = 20.dp), horizontalArrangement = Arrangement.SpaceBetween) {
                Text(if (historyOpen) "保存した記録" else "やったことを残す", style = MaterialTheme.typography.titleLarge)
                TextButton(onClick = { historyOpen = !historyOpen; selectedId = null; keyboard?.hide() }, enabled = !busy && !speechBusy) {
                    Text(if (historyOpen) "入力へ" else "保存した記録")
                }
            }
            Column(Modifier.weight(1f).verticalScroll(rememberScrollState()).padding(horizontal = 20.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
                error?.let { Text(it, color = MaterialTheme.colorScheme.error, modifier = Modifier.testTag("work-log-error")) }
                if (!historyOpen) {
                    MobileWorkLogEditor(draft, themes, tasks, !busy && !speechBusy, changeDraft)
                    Text(speechPrivacyDescription(speech.availableMode()), style = MaterialTheme.typography.bodySmall)
                    Row {
                        TextButton(onClick = {
                            if (context.checkSelfPermission(Manifest.permission.RECORD_AUDIO) == PackageManager.PERMISSION_GRANTED) startSpeech()
                            else microphone.launch(Manifest.permission.RECORD_AUDIO)
                        }, enabled = !busy && !speechBusy && speech.availableMode() != null) { Text("音声を文字にする") }
                        if (speechBusy) TextButton(onClick = { speech.stop() }) { Text("音声を終了") }
                    }
                    (speechState as? ShortSpeechUiState.Partial)?.let { Text(it.text, style = MaterialTheme.typography.bodySmall) }
                    (speechState as? ShortSpeechUiState.Error)?.let { Text(it.message, color = MaterialTheme.colorScheme.error) }
                } else {
                    if (records.isEmpty()) Text("まだ記録がありません。やったことを一言残せます。")
                    records.sortedBy { if (it.record.id == initialRecordId) 0 else 1 }.forEach { item ->
                        val record = item.record
                        ElevatedCard(Modifier.fillMaxWidth().testTag("work-log-record-${record.id}")) {
                            Column(Modifier.padding(12.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
                                Text(record.performedDate, style = MaterialTheme.typography.labelLarge)
                                SelectionContainer { Text(record.body, maxLines = if (selectedId == record.id) Int.MAX_VALUE else 3) }
                                Text(item.status, style = MaterialTheme.typography.bodySmall)
                                if (record.taskMissing || (record.taskId != null && tasks.none { it.id == record.taskId })) Text("関連Taskが見つかりません。記録は保持しています。", style = MaterialTheme.typography.bodySmall)
                                TextButton(onClick = { selectedId = if (selectedId == record.id) null else record.id }) { Text(if (selectedId == record.id) "閉じる" else "内容と操作") }
                                if (selectedId == record.id) {
                                    record.themeId?.let { id -> Text("Theme: ${themes.firstOrNull { it.id == id }?.title ?: id}") }
                                    record.taskId?.let { id -> Text("Task: ${tasks.firstOrNull { it.id == id }?.title ?: id}") }
                                    item.errorMessage?.let { Text(it, color = MaterialTheme.colorScheme.error, style = MaterialTheme.typography.bodySmall) }
                                    if (item.pending?.state == OutboxState.Rejected || item.pending?.state == OutboxState.RetryWait) {
                                        TextButton(onClick = { action { repository.retryWorkLog(record.id) } }, enabled = !busy) { Text("再送する") }
                                    }
                                    if (item.pending?.state == OutboxState.Rejected && record.serverVersion == null && (record.taskId != null || record.themeId != null)) {
                                        TextButton(onClick = {
                                            changeDraft(MobileWorkLogDraft(body = record.body, performedDate = record.performedDate, enteredAt = record.enteredAt))
                                            historyOpen = false
                                        }, enabled = !busy && draft.body.isBlank()) { Text("参照を外して新しい記録へ") }
                                    }
                                    if ((item.pending == null || item.pending.state == OutboxState.Rejected) && record.serverVersion != null) {
                                        TextButton(onClick = { action { repository.refreshWorkLog(record.id) } }, enabled = !busy) { Text("Desktopの記録を確認") }
                                    }
                                    HorizontalDivider()
                                    if (record.deleted) {
                                        TextButton(onClick = { action { repository.restoreWorkLog(record.id) } }, enabled = !busy && item.pending == null) { Text("削除を元に戻す") }
                                    } else {
                                        Text("Taskの状態を変えずに記録を削除します。元に戻せます。", style = MaterialTheme.typography.bodySmall)
                                        TextButton(onClick = { action { repository.deleteWorkLog(record.id) } },
                                            enabled = !busy && (item.pending == null || (item.pending.state == OutboxState.Pending && item.pending.attemptCount == 0)),
                                            colors = ButtonDefaults.textButtonColors(contentColor = MaterialTheme.colorScheme.error)) { Text(if (record.serverVersion == null) "未送信の記録を取り消す" else "記録を削除") }
                                    }
                                }
                            }
                        }
                    }
                }
                Spacer(Modifier.height(12.dp))
            }
            Row(Modifier.fillMaxWidth().padding(horizontal = 20.dp, vertical = 12.dp), horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                TextButton(onClick = onDismiss, enabled = !busy && !speechBusy, modifier = Modifier.testTag("work-log-close")) { Text("閉じる") }
                if (!historyOpen) Button(
                    modifier = Modifier.weight(1f).testTag("work-log-save"),
                    enabled = !busy && !speechBusy && restored.isSuccess && runCatching { MobileWorkLogContract.validateDraft(draft) }.isSuccess,
                    onClick = {
                        val submitted = draft
                        action {
                            repository.recordWorkLog(submitted)
                            withContext(Dispatchers.Main) {
                                if (store.clear()) { draft = MobileWorkLogDraft(); historyOpen = true; selectedId = submitted.id; keyboard?.hide() }
                                else error("記録は保存済みです。入力欄の片付けに失敗したため、同じ入力を保持しています。")
                            }
                        }
                    },
                ) { Text(if (busy) "保存中…" else "端末に保存") }
            }
        }
    }
}

@Composable
internal fun MobileWorkLogEditor(
    draft: MobileWorkLogDraft,
    themes: List<MobileTheme>,
    tasks: List<MobileTask>,
    enabled: Boolean,
    onChange: (MobileWorkLogDraft) -> Unit,
) {
    var themeOpen by remember { mutableStateOf(false) }
    var taskOpen by remember { mutableStateOf(false) }
    val focus = remember { FocusRequester() }
    LaunchedEffect(Unit) { focus.requestFocus() }
    OutlinedTextField(value = draft.body, onValueChange = { onChange(draft.copy(body = it)) },
        label = { Text("やったこと") }, placeholder = { Text("例: 測定条件を確認し、次の試験方法を決めた") },
        modifier = Modifier.fillMaxWidth().testTag("work-log-body").focusRequester(focus), minLines = 4, maxLines = 10,
        enabled = enabled, isError = draft.body.length > MOBILE_WORK_LOG_BODY_LIMIT,
        supportingText = { Text("${draft.body.length} / 12,000文字・原文のまま保存") })
    OutlinedTextField(value = draft.performedDate, onValueChange = { onChange(draft.copy(performedDate = it)) },
        label = { Text("実施日（YYYY-MM-DD）") }, singleLine = true, enabled = enabled,
        modifier = Modifier.fillMaxWidth().testTag("work-log-date"))
    TextButton(onClick = { themeOpen = !themeOpen }, enabled = enabled) {
        Text("Theme: ${themes.firstOrNull { it.id == draft.themeId }?.title ?: if (draft.themeId == null) "未指定" else "参照先を確認"}")
    }
    if (themeOpen) {
        TextButton(onClick = { onChange(draft.copy(themeId = null)); themeOpen = false }) { Text("Themeを指定しない") }
        themes.forEach { theme -> TextButton(onClick = { onChange(draft.copy(themeId = theme.id)); themeOpen = false }) { Text(theme.title) } }
    }
    TextButton(onClick = { taskOpen = !taskOpen }, enabled = enabled) {
        Text("Task: ${tasks.firstOrNull { it.id == draft.taskId }?.title ?: if (draft.taskId == null) "未指定" else "参照先を確認"}")
    }
    if (taskOpen) {
        TextButton(onClick = { onChange(draft.copy(taskId = null)); taskOpen = false }) { Text("Taskを指定しない") }
        tasks.forEach { task -> TextButton(onClick = { onChange(draft.copy(taskId = task.id)); taskOpen = false }) { Text(task.title) } }
    }
}
