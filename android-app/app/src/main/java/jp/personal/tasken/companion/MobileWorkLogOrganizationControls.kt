package jp.personal.tasken.companion

import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.text.selection.SelectionContainer
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.unit.dp
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

@Composable
internal fun MobileWorkLogOrganizationControls(item: MobileWorkLog, repository: MobileWorkLogOrganizationRepository, enabled: Boolean) {
    val source = item.record
    val value = item.organization
    var busy by remember(source.id) { mutableStateOf(false) }
    var error by remember(source.id) { mutableStateOf<String?>(null) }
    val scope = rememberCoroutineScope()
    fun action(block: suspend () -> Unit) {
        if (busy) return
        busy = true
        scope.launch {
            try { withContext(Dispatchers.IO) { block() }; error = null }
            catch (cancelled: CancellationException) { throw cancelled }
            catch (failure: Exception) { error = failure.message ?: "操作できませんでした。原文は保存済みです。" }
            finally { busy = false }
        }
    }
    val current = value?.sourceVersion == source.serverVersion
    val available = enabled && !source.deleted && source.serverVersion != null && item.pending == null
    Column(Modifier.fillMaxWidth().testTag("work-log-organization"), verticalArrangement = Arrangement.spacedBy(8.dp)) {
        Text("AIで整理（任意）", style = MaterialTheme.typography.titleSmall)
        Text("保存した原文1件をDesktopで設定したAIへ送り、文ごとに分類します。採用すると別の補足として保存します。", style = MaterialTheme.typography.bodySmall)
        error?.let { Text(it, color = MaterialTheme.colorScheme.error) }
        if (value == null || value.state in setOf("discarded", "generating") || (!current && value.state == "proposal")) {
            if (!current && value != null) Text("原文が更新されています。新しく整理してください。")
            TextButton(onClick = { action { repository.organizeWorkLog(source.id) } }, enabled = available && !busy,
                modifier = Modifier.testTag("work-log-organize")) { Text(if (busy) "整理中…" else "原文をAIで整理") }
        }
        if (value?.state == "generating" && busy) TextButton(onClick = {
            scope.launch {
                try { withContext(Dispatchers.IO) { repository.discardWorkLogOrganization(source.id) } }
                catch (cancelled: CancellationException) { throw cancelled }
                catch (_: Exception) { error = "取り消せませんでした。原文は保存済みです。" }
            }
        }) { Text("この整理を取り消す") }
        val proposal = runCatching { value?.proposal() }.getOrNull()
        if (proposal != null && value?.state != "discarded") {
            Text("AIによる分類・原文引用です。確認済みの知識や実績を示しません。", style = MaterialTheme.typography.bodySmall)
            listOf("やったこと" to proposal.done, "気づき・所感" to proposal.observations, "未解決・仮説" to proposal.unresolved).forEach { (heading, quotes) ->
                Text(heading, style = MaterialTheme.typography.labelLarge)
                if (quotes.isEmpty()) Text("該当する記述なし", style = MaterialTheme.typography.bodySmall)
                quotes.forEach { quote -> SelectionContainer { Text("「$quote」") } }
            }
            if (value?.state == "proposal") {
                Button(onClick = { action { repository.adoptWorkLogOrganization(source.id) } }, enabled = available && current && !busy,
                    modifier = Modifier.testTag("work-log-adopt")) { Text("整理案を補足として採用") }
                TextButton(onClick = { action { repository.discardWorkLogOrganization(source.id) } }, enabled = !busy) { Text("整理案を破棄") }
            }
            if (value?.state == "adopting") Text("補足を端末に保存済み・Desktopへ送信中")
            if (value?.state == "adopted") {
                Text("整理補足をDesktopに保存済み", modifier = Modifier.testTag("work-log-adopted"))
                Text("次のTask（任意）", style = MaterialTheme.typography.labelLarge)
                if (proposal.nextActions.isEmpty()) Text("明示された次の行動はありません。Taskの追加は不要です。")
                val created = value.createdTaskIndices.split(',').mapNotNull(String::toIntOrNull)
                proposal.nextActions.forEachIndexed { index, quote ->
                    SelectionContainer { Text("「$quote」") }
                    TextButton(onClick = { action { repository.createWorkLogNextAction(source.id, index) } },
                        enabled = available && current && !busy && index !in created,
                        modifier = Modifier.testTag("work-log-task-$index")) { Text(if (index in created) "Taskを端末に追加済み" else "この行動をTaskとして追加") }
                }
            }
        }
    }
}
