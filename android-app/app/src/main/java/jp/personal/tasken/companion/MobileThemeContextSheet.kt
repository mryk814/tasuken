package jp.personal.tasken.companion

import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.text.selection.SelectionContainer
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.unit.dp
import androidx.compose.ui.window.Dialog
import androidx.compose.ui.window.DialogProperties
import java.time.OffsetDateTime
import java.time.ZoneId
import java.time.format.DateTimeFormatter
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

private fun themeContextTime(value: String): String = runCatching {
    OffsetDateTime.parse(value).atZoneSameInstant(ZoneId.systemDefault()).format(DateTimeFormatter.ofPattern("M/d HH:mm"))
}.getOrDefault(value)

@Composable
internal fun MobileThemeContextSheet(repository: MobileThemeContextRepository, themeId: String, onDismiss: () -> Unit) {
    val flow = remember(repository, themeId) { repository.observeThemeContext(themeId) }
    val state by flow.collectAsState(ThemeContextState())
    var busy by remember { mutableStateOf(false) }
    val scope = rememberCoroutineScope()
    val scroll = rememberScrollState()
    fun refresh() {
        if (busy) return
        busy = true
        scope.launch {
            try { withContext(Dispatchers.IO) { repository.refreshThemeContext(themeId) } }
            finally { busy = false }
        }
    }
    LaunchedEffect(themeId) { refresh() }
    Dialog(onDismissRequest = onDismiss, properties = DialogProperties(usePlatformDefaultWidth = false)) {
        Surface(
            Modifier.widthIn(max = 720.dp).fillMaxWidth().fillMaxHeight(0.92f).testTag("theme-context"),
            shape = MaterialTheme.shapes.large,
        ) {
            Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
                    Text("Themeの目的・現在地", Modifier.weight(1f), style = MaterialTheme.typography.titleLarge)
                    TextButton(onClick = onDismiss, modifier = Modifier.testTag("theme-context-close")) { Text("Taskへ戻る") }
                }
                if (busy) LinearProgressIndicator(Modifier.fillMaxWidth())
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    TextButton(enabled = !busy, onClick = ::refresh) { Text("再取得") }
                    state.fetchedAt?.let { Text("最終取得 ${themeContextTime(it)}", style = MaterialTheme.typography.labelSmall) }
                }
                val failureLabel = when (state.failure) {
                    ThemeContextFailure.Offline -> "Desktopへ接続できません。"
                    ThemeContextFailure.Unsupported -> "このDesktopはTheme詳細の取得に対応していません。"
                    ThemeContextFailure.InvalidResponse -> "Theme詳細を確認できませんでした。再取得してください。"
                    ThemeContextFailure.AccessDenied -> "接続権限が失効しました。端末の閲覧内容を削除しました。"
                    null -> null
                }
                failureLabel?.let { Text(it, color = MaterialTheme.colorScheme.error, style = MaterialTheme.typography.bodySmall) }
                Column(Modifier.weight(1f).verticalScroll(scroll).testTag("theme-context-content"), verticalArrangement = Arrangement.spacedBy(16.dp)) {
                    when (state.content) {
                        ThemeContextContent.Unfetched -> Text("Themeの目的・現在地は未取得です。")
                        ThemeContextContent.Missing -> Text("Themeは削除されたか、見つかりません。保存していた内容は表示していません。")
                        ThemeContextContent.Available -> state.theme?.let { theme ->
                            Text(theme.title, style = MaterialTheme.typography.titleLarge)
                            Text("端末に保存した内容です。古い可能性があります。", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                            Text(theme.updatedAt?.let { "Theme更新 ${themeContextTime(it)}" } ?: "Theme更新日時は不明です。", style = MaterialTheme.typography.labelSmall)
                            SelectionContainer {
                                Column(verticalArrangement = Arrangement.spacedBy(16.dp)) {
                                    Text("目的・到達像", style = MaterialTheme.typography.titleMedium)
                                    val charter = theme.charter
                                    if (charter == null) Text("目的・到達像は未設定です。", color = MaterialTheme.colorScheme.onSurfaceVariant)
                                    else {
                                        ThemeContextField("目的", charter.purpose)
                                        ThemeContextField("到達像", charter.desired_outcome)
                                        ThemeContextItems("判断の原則", charter.principles)
                                        ThemeContextField("扱う範囲", charter.scope)
                                        ThemeContextItems("扱わないもの", charter.non_goals)
                                        ThemeContextItems("長期の問い", charter.long_term_questions)
                                        ThemeContextItems("学習関心", charter.learning_interests)
                                    }
                                    Text("現在地", style = MaterialTheme.typography.titleMedium)
                                    val current = theme.currentState
                                    if (current == null) Text("現在地は未設定です。", color = MaterialTheme.colorScheme.onSurfaceVariant)
                                    else {
                                        Text(current.updated_at?.let { "現在地更新 ${themeContextTime(it)}" } ?: "現在地の更新日時は不明です。", style = MaterialTheme.typography.labelSmall)
                                        ThemeContextField("現在の方向", current.current_direction)
                                        ThemeContextItems("いまの問い", current.active_questions)
                                        ThemeContextItems("試している仮説・方針", current.current_bets)
                                        ThemeContextItems("障害", current.blockers)
                                        ThemeContextItems("未決定のこと", current.unresolved_decisions)
                                        ThemeContextField("次の地平", current.next_frontier)
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
private fun ThemeContextField(label: String, value: String) {
    if (value.isNotEmpty()) Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
        Text(label, style = MaterialTheme.typography.labelLarge, color = MaterialTheme.colorScheme.onSurfaceVariant)
        Text(value, style = MaterialTheme.typography.bodyLarge)
    }
}

@Composable
private fun ThemeContextItems(label: String, values: List<String>) {
    if (values.isNotEmpty()) Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
        Text(label, style = MaterialTheme.typography.labelLarge, color = MaterialTheme.colorScheme.onSurfaceVariant)
        values.forEach { Text("・$it", style = MaterialTheme.typography.bodyLarge) }
    }
}
