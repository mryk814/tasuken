package jp.personal.tasken.companion

import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.items
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import java.time.LocalDate
import java.time.ZoneId
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

@OptIn(ExperimentalMaterial3Api::class)
@Composable
internal fun MobileRecallSheet(
    repository: MobileRecallRepository,
    tasks: List<MobileTask>,
    onTask: (String) -> Unit,
    onWorkLog: (String?) -> Unit,
    onCapture: (MobilePendingCapture) -> Unit,
    onDismiss: () -> Unit,
    today: LocalDate = LocalDate.now(),
    timezone: ZoneId = ZoneId.systemDefault(),
) {
    var selectedDate by rememberSaveable { mutableStateOf(today.toString()) }
    val date = LocalDate.parse(selectedDate)
    val flow = remember(repository, date, timezone) { repository.observeRecallDay(date, timezone) }
    val collected by flow.collectAsState(MobileRecallDay(selectedDate, timezone.id))
    val day = collected.takeIf { it.date == selectedDate && it.timezone == timezone.id } ?: MobileRecallDay(selectedDate, timezone.id)
    val lastFetched = day.lastFetchedAt?.let { java.time.Instant.parse(it).atZone(timezone)
        .format(java.time.format.DateTimeFormatter.ofPattern("M/d HH:mm")) }
    var busy by remember { mutableStateOf(false) }
    var notice by remember { mutableStateOf<String?>(null) }
    val scope = rememberCoroutineScope()
    fun refresh(nextPage: Boolean) {
        if (busy) return
        busy = true
        scope.launch {
            try { withContext(Dispatchers.IO) { repository.refreshRecallDay(date, timezone, nextPage) } }
            catch (_: Exception) { notice = "取得できません。端末にある範囲を表示しています。" }
            finally { busy = false }
        }
    }
    ModalBottomSheet(onDismissRequest = onDismiss, sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true)) {
        Column(Modifier.fillMaxWidth().fillMaxHeight(0.94f).widthIn(max = 640.dp).padding(horizontal = 20.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
            Text("今日の記録", style = MaterialTheme.typography.titleLarge)
            Text("実績・入力を日ごとに振り返る", style = MaterialTheme.typography.bodyMedium)
            LazyRow(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                items((0L..6L).toList()) { offset ->
                    val value = today.minusDays(offset).toString()
                    FilterChip(selected = value == selectedDate, enabled = !busy,
                        onClick = { selectedDate = value; notice = null },
                        label = { Text(when(offset) { 0L -> "今日"; 1L -> "昨日"; else -> value.substring(5) }) },
                        modifier = Modifier.testTag("recall-day-$value"))
                }
            }
            Text("$selectedDate · ${timezone.id}", style = MaterialTheme.typography.labelLarge)
            Text(when {
                day.lastFetchedAt == null -> "Desktopの記録は未取得です。端末に保存した記録だけを表示します。"
                day.showingPreviousSnapshot -> "前回の取得分を表示 · 再取得は途中です。最終取得 $lastFetched"
                day.partial -> "部分取得 · 続きがあります。最終取得 $lastFetched"
                else -> "この日は取得済み · 最終取得 $lastFetched"
            }, style = MaterialTheme.typography.bodySmall, modifier = Modifier.testTag("recall-coverage"))
            (notice ?: day.error)?.let { Text(it, color = MaterialTheme.colorScheme.error, style = MaterialTheme.typography.bodySmall) }
            LazyColumn(Modifier.weight(1f).testTag("recall-list"), verticalArrangement = Arrangement.spacedBy(10.dp)) {
                if (day.rows.isEmpty()) item {
                    Text(if (day.lastFetchedAt != null && !day.partial) "取得した範囲に記録はありません。" else "表示できる記録はまだ端末にありません。")
                }
                items(day.rows, key = { it.id }) { row ->
                    ElevatedCard(Modifier.fillMaxWidth().testTag("recall-row-${row.id}")) {
                        Column(Modifier.padding(12.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
                            Text(row.stage + if (row.time.isNotBlank()) " · ${row.time}" else "", style = MaterialTheme.typography.labelLarge)
                            Text(row.title, style = MaterialTheme.typography.titleMedium, maxLines = 3, overflow = TextOverflow.Ellipsis)
                            if (row.summary.isNotBlank() && row.summary != row.title) Text(row.summary, maxLines = 4, overflow = TextOverflow.Ellipsis)
                            row.localStatus?.let { Text(it, style = MaterialTheme.typography.bodySmall) }
                            val unavailable = when {
                                row.source.status == "unavailable" -> if (row.source.reason == "not_found") "原記録が見つかりません。索引を表示しています。" else "この種類の原記録はAndroidで開けません。"
                                row.source.type == "task" && tasks.none { it.id == row.source.id } -> "Taskの原文は端末に未取得です。Task一覧を同期してから開いてください。"
                                row.source.type == "capture_entry" && row.capture == null -> "Captureの原文は端末に未取得です。このDesktopからの全文取得には未対応です。"
                                row.source.type !in setOf("task", "capture_entry", "work_log") -> "この種類の原記録はAndroidで開けません。"
                                else -> null
                            }
                            if (unavailable != null) Text(unavailable, style = MaterialTheme.typography.bodySmall)
                            else TextButton(enabled = !busy, onClick = {
                                when (row.source.type) {
                                    "task" -> onTask(row.source.id)
                                    "capture_entry" -> row.capture?.let(onCapture)
                                    "work_log" -> {
                                        busy = true
                                        scope.launch {
                                            try { withContext(Dispatchers.IO) { repository.loadRecallWorkLog(row.source.id) }; onWorkLog(row.source.id) }
                                            catch (failure: Exception) { notice = (failure as? MobileRecallSourceUnavailable)?.message
                                                ?: "原文を取得できません。Desktopへの接続と対応バージョンを確認してください。索引は端末に保持しています。" }
                                            finally { busy = false }
                                        }
                                    }
                                }
                            }) { Text("原記録を開く") }
                        }
                    }
                }
            }
            Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                TextButton(onClick = { refresh(false) }, enabled = !busy) { Text(if (busy) "取得中…" else "再取得") }
                if (day.hasNextPage) TextButton(onClick = { refresh(true) }, enabled = !busy, modifier = Modifier.testTag("recall-next")) { Text("続き500件") }
                Spacer(Modifier.weight(1f))
                Button(onClick = { onWorkLog(null) }, enabled = !busy) { Text("一言残す") }
            }
            TextButton(onClick = onDismiss) { Text("閉じる") }
        }
    }
}
