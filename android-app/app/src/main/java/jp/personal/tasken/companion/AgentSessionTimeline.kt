package jp.personal.tasken.companion

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.text.selection.SelectionContainer
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.luminance
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import java.time.OffsetDateTime
import java.time.ZoneId
import java.time.format.DateTimeFormatter

private fun sessionClient(client: String): String = when (client) {
    "codex" -> "Codex"
    "claude_code" -> "Claude Code"
    "github_copilot" -> "Copilot"
    "opencode" -> "OpenCode"
    "deepseek_harness" -> "DeepSeek"
    else -> client
}

private fun sessionStatus(status: String): String = when (status) {
    "active" -> "進行中"
    "completed" -> "終了"
    "interrupted", "abandoned" -> "中断"
    "blocked" -> "停止"
    else -> "終了未確認"
}

private fun sessionTime(timestamp: String): String = runCatching {
    OffsetDateTime.parse(timestamp).atZoneSameInstant(ZoneId.systemDefault())
        .format(DateTimeFormatter.ofPattern("HH:mm"))
}.getOrDefault("—")

@OptIn(ExperimentalMaterial3Api::class)
@Composable
internal fun AgentSessionTimeline(
    sessions: List<MobileAgentSessionDto>,
    unavailable: Boolean = false,
    onRetry: () -> Unit = {},
) {
    var selectedId by remember { mutableStateOf<String?>(null) }
    val selected = sessions.find { it.id == selectedId }
    Column(Modifier.fillMaxWidth().testTag("agent-session-timeline")) {
        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
            Text("AIの作業", style = MaterialTheme.typography.titleMedium, modifier = Modifier.padding(vertical = 12.dp))
            if (unavailable) TextButton(onClick = onRetry) { Text("再読込") }
        }
        if (unavailable) Text("AIログを取得できませんでした", style = MaterialTheme.typography.bodySmall)
        sessions.sortedBy { it.startedAt }.forEach { session ->
            val colorToken = when (session.clientKind) {
                "codex" -> "chart-1"
                "claude_code" -> "chart-2"
                "github_copilot" -> "chart-3"
                "opencode" -> "chart-4"
                else -> "chart-5"
            }
            Row(
                Modifier.fillMaxWidth().heightIn(min = 56.dp)
                    .clickable(role = Role.Button, onClickLabel = "Sessionの詳細を開く") { selectedId = session.id }
                    .padding(vertical = 8.dp).testTag("agent-session-${session.id}"),
                horizontalArrangement = Arrangement.spacedBy(12.dp),
            ) {
                Text(sessionTime(session.startedAt), style = MaterialTheme.typography.labelMedium, modifier = Modifier.width(42.dp))
                Box(Modifier.width(3.dp).heightIn(min = 56.dp).background(
                    taskenThemeColor(colorToken, MaterialTheme.colorScheme.surface.luminance() < 0.5f),
                ))
                Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(3.dp)) {
                    Text(session.intent, style = MaterialTheme.typography.bodyMedium, maxLines = 2, overflow = TextOverflow.Ellipsis)
                    Text("${sessionClient(session.clientKind)} · ${sessionStatus(session.status)}", style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                    session.outcome?.takeIf { it != "成果の記録なし" }?.let {
                        Text(it, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant, maxLines = 2, overflow = TextOverflow.Ellipsis)
                    }
                }
            }
        }
    }
    if (selected != null) {
        ModalBottomSheet(onDismissRequest = { selectedId = null }) {
            SelectionContainer {
                Column(
                    Modifier.fillMaxWidth().verticalScroll(rememberScrollState()).padding(horizontal = 24.dp, vertical = 12.dp).testTag("agent-session-detail"),
                    verticalArrangement = Arrangement.spacedBy(16.dp),
                ) {
                    Text(sessionClient(selected.clientKind), style = MaterialTheme.typography.titleLarge)
                    Text("${sessionTime(selected.startedAt)}–${selected.endedAt?.let(::sessionTime) ?: "…"} · ${sessionStatus(selected.status)}", color = MaterialTheme.colorScheme.onSurfaceVariant)
                    Text("観測区間", style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                    SessionDetailSection("依頼", selected.intent)
                    SessionDetailSection("成果", selected.outcome ?: "成果の記録なし")
                    SessionDetailSection("残件", selected.remainingWork.joinToString("\n").ifBlank { "記録なし" })
                    SessionDetailSection("元Session", selected.sourceSessionId ?: selected.id)
                    TextButton(onClick = { selectedId = null }, modifier = Modifier.fillMaxWidth()) { Text("閉じる") }
                }
            }
        }
    }
}

@Composable
private fun SessionDetailSection(label: String, content: String) {
    Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
        Text(label, style = MaterialTheme.typography.labelMedium, fontWeight = FontWeight.SemiBold)
        Text(content, style = MaterialTheme.typography.bodyMedium)
    }
}
