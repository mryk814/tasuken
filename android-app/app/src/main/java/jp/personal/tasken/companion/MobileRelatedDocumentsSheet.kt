package jp.personal.tasken.companion

import androidx.activity.compose.BackHandler
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.text.selection.SelectionContainer
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.unit.dp
import androidx.compose.ui.window.Dialog
import androidx.compose.ui.window.DialogProperties
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import java.time.Instant
import java.time.ZoneId
import java.time.format.DateTimeFormatter

private fun relatedFetchedLabel(value: String): String = runCatching {
    Instant.parse(value).atZone(ZoneId.systemDefault()).format(DateTimeFormatter.ofPattern("M/d HH:mm"))
}.getOrDefault(value)

private fun relatedReasonLabel(reason: RelatedReason): String = when {
    reason.predicate == "triaged_to" -> "このTaskの作成元"
    reason.predicate == "created_for" && reason.direction == "to_task" -> "このTaskのために作成"
    reason.predicate in listOf("derived_from", "generated_from") && reason.direction == "from_task" -> "このTaskの元資料"
    reason.predicate == "related_to" -> "Taskに関連付けた資料"
    reason.direction == "from_task" -> "Taskから関連付け"
    else -> "この資料からTaskへ関連付け"
}

@Composable
internal fun MobileRelatedDocumentsSheet(repository: MobileRelatedDocumentsRepository, taskId: String, onDismiss: () -> Unit,
    initialDocument: Pair<String, String>? = null, dismissLabel: String = "Taskへ戻る") {
    val flow = remember(repository, taskId) { repository.observeRelatedDocuments(taskId) }
    val state by flow.collectAsState(RelatedDocumentsState())
    var selectedType by rememberSaveable(taskId) { mutableStateOf(initialDocument?.first) }
    var selectedId by rememberSaveable(taskId) { mutableStateOf(initialDocument?.second) }
    var busy by remember { mutableStateOf(false) }
    val scope = rememberCoroutineScope()
    val listScroll = rememberScrollState()
    val bodyScroll = rememberScrollState()
    fun action(block: suspend () -> Unit) {
        if (busy) return
        busy = true
        scope.launch { try { withContext(Dispatchers.IO) { block() } } finally { busy = false } }
    }
    LaunchedEffect(taskId) { if (initialDocument == null) action { repository.refreshRelatedDocuments(taskId) } }
    Dialog(onDismissRequest = onDismiss, properties = DialogProperties(usePlatformDefaultWidth = false)) {
        BackHandler(selectedId != null) { selectedId = null; selectedType = null }
        Surface(Modifier.widthIn(max = 720.dp).fillMaxWidth().fillMaxHeight(0.92f).testTag("related-documents"), shape = MaterialTheme.shapes.large) {
            Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
                    Text(if (selectedId == null) "関連資料" else "本文", style = MaterialTheme.typography.titleLarge)
                    TextButton(onClick = onDismiss) { Text(dismissLabel) }
                }
                if (busy) LinearProgressIndicator(Modifier.fillMaxWidth())
                state.error?.let { Text(it, color = MaterialTheme.colorScheme.error, style = MaterialTheme.typography.bodySmall) }
                if (selectedId == null) {
                    Row {
                        TextButton(enabled = !busy, onClick = { action { repository.refreshRelatedDocuments(taskId) } }) { Text("再取得") }
                        state.fetchedAt?.let { Text("最終取得 ${relatedFetchedLabel(it)}", style = MaterialTheme.typography.labelSmall) }
                    }
                    if (state.nextCursor != null) Text("取得済み ${state.documents.size}件・続きあり", style = MaterialTheme.typography.labelSmall)
                    Column(Modifier.weight(1f).verticalScroll(listScroll), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                        if (state.documents.isEmpty()) Text(if (state.fetchedAt == null) "関連資料は未取得です。Desktopへの接続が必要です。" else "関連資料はありません。")
                        state.documents.forEach { item ->
                            OutlinedCard(onClick = {
                                selectedType = item.type; selectedId = item.id
                                scope.launch { bodyScroll.scrollTo(0) }
                                action { repository.loadRelatedDocument(taskId, item.type, item.id) }
                            }, enabled = item.status == "available" && !busy, modifier = Modifier.fillMaxWidth().testTag("related-${item.id}")) {
                                Column(Modifier.padding(12.dp)) {
                                    Text(item.title, style = MaterialTheme.typography.titleSmall)
                                    Text((if (item.type == "note") "Note" else "Capture") + " · " + item.reasons.joinToString(" / ", transform = ::relatedReasonLabel), style = MaterialTheme.typography.bodySmall)
                                    val cached = state.bodies.firstOrNull { it.type == item.type && it.id == item.id }
                                    Text(if (item.status != "available") "参照先なし" else if (cached == null) "本文は未取得" else if (cached.document.version != item.version) "本文に更新あり" else "本文を端末に保存済み", style = MaterialTheme.typography.labelSmall)
                                }
                            }
                        }
                        if (state.nextCursor != null) TextButton(enabled = !busy, onClick = { action { repository.refreshRelatedDocuments(taskId, true) } }) { Text("続きを取得") }
                    }
                } else {
                    val cached = state.bodies.firstOrNull { it.type == selectedType && it.id == selectedId }
                    val summary = state.documents.firstOrNull { it.type == selectedType && it.id == selectedId }
                    Row {
                        TextButton(onClick = { selectedId = null; selectedType = null }) { Text("関連一覧へ戻る") }
                        if (summary != null) TextButton(enabled = !busy, onClick = { action { repository.loadRelatedDocument(taskId, summary.type, summary.id) } }) { Text("本文を再取得") }
                    }
                    if (summary == null) Text("参照先は利用できません。")
                    else {
                        Text(summary.title, style = MaterialTheme.typography.titleMedium)
                        if (cached == null) Text("本文は未取得です。Desktopに接続すると読めます。")
                        else {
                            Text("最終取得 ${relatedFetchedLabel(cached.fetchedAt)}" + if (cached.document.version != summary.version) " · 更新あり" else " · 端末保存", style = MaterialTheme.typography.labelSmall)
                            if (cached.document.truncated) Text("長い本文の先頭50,000文字を表示しています（全${cached.document.totalCharacters}文字）。", style = MaterialTheme.typography.bodySmall)
                            SelectionContainer(Modifier.weight(1f).verticalScroll(bodyScroll)) { Text(cached.document.body.ifEmpty { "本文は空です。" }, style = MaterialTheme.typography.bodyLarge) }
                        }
                    }
                }
            }
        }
    }
}
