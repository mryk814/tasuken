package jp.personal.tasken.companion

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.*
import androidx.compose.material3.pulltorefresh.PullToRefreshBox
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.role
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import java.time.LocalDate
import java.time.ZoneId
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

/**
 * 記録タブ。実績・入力を日ごとに時系列で振り返る。
 * 行を押すと原記録へ進み、先頭の入力欄から「やったこと」を一言残せる。
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
internal fun RecordsListPane(
    repository: MobileRecallRepository?,
    tasks: List<MobileTask>,
    onTask: (String) -> Unit,
    onWorkLog: (String?) -> Unit,
    onCapture: (MobilePendingCapture) -> Unit,
    today: LocalDate = LocalDate.now(),
    timezone: ZoneId = ZoneId.systemDefault(),
) {
    if (repository == null) {
        Box(Modifier.fillMaxSize().padding(24.dp), contentAlignment = Alignment.Center) {
            Text("PCと接続すると、日ごとの記録をここで振り返れます。", color = MaterialTheme.colorScheme.onSurfaceVariant)
        }
        return
    }
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
    fun open(row: MobileRecallRow) {
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
    }
    Column(Modifier.fillMaxSize()) {
        LazyRow(
            contentPadding = PaddingValues(horizontal = 12.dp, vertical = 8.dp),
            horizontalArrangement = Arrangement.spacedBy(8.dp),
        ) {
            items((0L..6L).toList()) { offset ->
                val value = today.minusDays(offset).toString()
                FilterChip(selected = value == selectedDate, enabled = !busy,
                    onClick = { selectedDate = value; notice = null },
                    label = { Text(when (offset) { 0L -> "今日"; 1L -> "昨日"; else -> value.substring(5).replace('-', '/') }) },
                    modifier = Modifier.testTag("recall-day-$value"))
            }
        }
        PullToRefreshBox(
            isRefreshing = busy,
            onRefresh = { refresh(false) },
            modifier = Modifier.weight(1f).testTag("records-pull-refresh"),
        ) {
            LazyColumn(
                Modifier.fillMaxSize().testTag("recall-list"),
                contentPadding = PaddingValues(start = 12.dp, end = 12.dp, bottom = 96.dp),
                verticalArrangement = Arrangement.spacedBy(0.dp),
            ) {
                item(key = "composer") {
                    // SNSの「いまどうしてる？」と同じ位置。押すとやったことの入力を開く。
                    Surface(
                        onClick = { onWorkLog(null) },
                        enabled = !busy,
                        shape = RoundedCornerShape(24.dp),
                        color = MaterialTheme.colorScheme.surfaceContainerHigh,
                        modifier = Modifier.fillMaxWidth().heightIn(min = 52.dp).testTag("records-composer"),
                    ) {
                        Row(
                            Modifier.padding(horizontal = 16.dp, vertical = 12.dp),
                            verticalAlignment = Alignment.CenterVertically,
                            horizontalArrangement = Arrangement.spacedBy(10.dp),
                        ) {
                            Icon(painterResource(R.drawable.ic_tabler_pencil), contentDescription = null,
                                tint = MaterialTheme.colorScheme.primary, modifier = Modifier.size(20.dp))
                            Text("一言残す", style = MaterialTheme.typography.bodyLarge, fontWeight = FontWeight.SemiBold)
                            Text("やったこと・気づいたこと", style = MaterialTheme.typography.bodyMedium,
                                color = MaterialTheme.colorScheme.onSurfaceVariant, maxLines = 1, overflow = TextOverflow.Ellipsis)
                        }
                    }
                }
                item(key = "coverage") {
                    Row(
                        Modifier.fillMaxWidth().padding(top = 8.dp, bottom = 4.dp),
                        verticalAlignment = Alignment.CenterVertically,
                    ) {
                        Text(when {
                            day.lastFetchedAt == null -> "PCの記録は未取得 · 端末の記録だけを表示"
                            day.showingPreviousSnapshot -> "前回の取得分を表示 · 再取得は途中です。最終取得 $lastFetched"
                            day.partial -> "部分取得 · 続きがあります。最終取得 $lastFetched"
                            else -> "取得済み · $lastFetched"
                        }, style = MaterialTheme.typography.labelMedium, color = MaterialTheme.colorScheme.onSurfaceVariant,
                            modifier = Modifier.weight(1f).testTag("recall-coverage"))
                        TextButton(onClick = { refresh(false) }, enabled = !busy) { Text(if (busy) "取得中…" else "再取得") }
                    }
                    (notice ?: day.error)?.let {
                        Text(it, color = MaterialTheme.colorScheme.error, style = MaterialTheme.typography.bodySmall)
                    }
                }
                if (day.rows.isEmpty()) item(key = "empty") {
                    Text(
                        if (day.lastFetchedAt != null && !day.partial) "取得した範囲に記録はありません。" else "表示できる記録はまだ端末にありません。",
                        modifier = Modifier.padding(vertical = 24.dp),
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                }
                items(day.rows, key = { it.id }) { row ->
                    val unavailable = when {
                        row.source.status == "unavailable" -> if (row.source.reason == "not_found") "原記録が見つかりません。索引を表示しています。" else "この種類の原記録はAndroidで開けません。"
                        row.source.type == "task" && tasks.none { it.id == row.source.id } -> "Taskの原文は端末に未取得です。Task一覧を同期してから開いてください。"
                        row.source.type == "capture_entry" && row.capture == null -> "Captureの原文は端末に未取得です。このDesktopからの全文取得には未対応です。"
                        row.source.type !in setOf("task", "capture_entry", "work_log") -> "この種類の原記録はAndroidで開けません。"
                        else -> null
                    }
                    RecordTimelineRow(
                        row = row,
                        unavailable = unavailable,
                        enabled = !busy,
                        onOpen = { open(row) },
                        modifier = Modifier.testTag("recall-row-${row.id}"),
                    )
                }
                if (day.hasNextPage) item(key = "next") {
                    TextButton(onClick = { refresh(true) }, enabled = !busy, modifier = Modifier.testTag("recall-next")) { Text("続き500件") }
                }
            }
        }
    }
}

/** 時刻・点・線で一日をつなぐ1行。開ける記録は行全体が押せる。 */
@Composable
private fun RecordTimelineRow(
    row: MobileRecallRow,
    unavailable: String?,
    enabled: Boolean,
    onOpen: () -> Unit,
    modifier: Modifier = Modifier,
) {
    val canOpen = unavailable == null
    Row(
        modifier = modifier
            .fillMaxWidth()
            .then(if (canOpen) Modifier.semantics { role = Role.Button }.clickable(enabled = enabled, onClickLabel = "原記録を開く", onClick = onOpen) else Modifier)
            .height(IntrinsicSize.Min),
        horizontalArrangement = Arrangement.spacedBy(10.dp),
    ) {
        Text(
            row.time.ifBlank { "--:--" },
            style = MaterialTheme.typography.labelMedium,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
            modifier = Modifier.width(40.dp).padding(top = 14.dp),
        )
        Column(Modifier.fillMaxHeight(), horizontalAlignment = Alignment.CenterHorizontally) {
            Spacer(Modifier.height(16.dp))
            Box(Modifier.size(10.dp).background(MaterialTheme.colorScheme.primary, CircleShape))
            Box(Modifier.width(2.dp).weight(1f).background(MaterialTheme.colorScheme.outlineVariant))
        }
        Column(
            Modifier.weight(1f).padding(top = 10.dp, bottom = 14.dp),
            verticalArrangement = Arrangement.spacedBy(3.dp),
        ) {
            Text(row.stage,
                style = MaterialTheme.typography.labelMedium, color = MaterialTheme.colorScheme.primary)
            Text(row.title, style = MaterialTheme.typography.titleSmall, fontWeight = FontWeight.SemiBold,
                maxLines = 3, overflow = TextOverflow.Ellipsis)
            if (row.summary.isNotBlank() && row.summary != row.title) {
                Text(row.summary, style = MaterialTheme.typography.bodyMedium, maxLines = 4, overflow = TextOverflow.Ellipsis)
            }
            row.localStatus?.let { Text(it, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant) }
            if (unavailable != null) {
                Text(unavailable, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
            }
        }
    }
}
