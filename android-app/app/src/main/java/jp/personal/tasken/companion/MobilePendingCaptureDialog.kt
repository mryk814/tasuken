package jp.personal.tasken.companion

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.text.selection.SelectionContainer
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalClipboardManager
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.text.AnnotatedString
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import kotlinx.coroutines.launch

@Composable
internal fun CaptureCopyButton(text: String, modifier: Modifier = Modifier) {
    val clipboard = LocalClipboardManager.current
    var notice by remember(text) { mutableStateOf<String?>(null) }
    Column {
        TextButton(
            onClick = {
                notice = runCatching { clipboard.setText(AnnotatedString(text)) }
                    .fold({ "全文をコピーしました" }, { "コピーできませんでした。もう一度お試しください。" })
            },
            modifier = modifier.testTag("capture-copy-full-text"),
        ) { Text("全文をコピー") }
        notice?.let { Text(it, style = MaterialTheme.typography.labelSmall) }
    }
}

@Composable
internal fun MobilePendingCaptureDialog(
    entries: List<MobilePendingCapture>,
    onRetry: suspend (String) -> Boolean,
    onDismiss: () -> Unit,
    initialSelectedId: String? = null,
    title: String = "送信待ちのCapture",
) {
    var selectedId by rememberSaveable { mutableStateOf(initialSelectedId) }
    var retrying by remember { mutableStateOf(false) }
    var notice by remember { mutableStateOf<String?>(null) }
    val selected = entries.firstOrNull { it.commandId == selectedId }
    val scope = rememberCoroutineScope()
    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text(title) },
        text = {
            Column(
                modifier = Modifier.heightIn(max = 440.dp).verticalScroll(rememberScrollState()),
                verticalArrangement = Arrangement.spacedBy(8.dp),
            ) {
                if (selected == null) {
                    if (entries.isEmpty()) Text("送信待ちのCaptureはありません。送信済みの本文はDesktopで読めます。")
                    LazyColumn(Modifier.heightIn(max = 340.dp).testTag("pending-capture-list")) {
                        items(entries, key = { it.commandId }) { entry ->
                            TextButton(
                                onClick = { selectedId = entry.commandId; notice = null },
                                modifier = Modifier.fillMaxWidth().testTag("pending-capture-${entry.commandId}"),
                            ) {
                                Column(Modifier.fillMaxWidth()) {
                                    Text(entry.text, maxLines = 2, overflow = TextOverflow.Ellipsis)
                                    Text(if (entry.canRetry) "送信の確認が必要" else "送信待ち", style = MaterialTheme.typography.labelSmall)
                                }
                            }
                        }
                    }
                } else {
                    Text(selected.status, modifier = Modifier.testTag("pending-capture-status"))
                    SelectionContainer {
                        Text(
                            selected.text,
                            color = MaterialTheme.colorScheme.onSurface,
                            modifier = Modifier.fillMaxWidth().heightIn(max = 220.dp)
                                .verticalScroll(rememberScrollState()).testTag("pending-capture-body"),
                        )
                    }
                    CaptureCopyButton(selected.text)
                    if (selected.canRetry) {
                        OutlinedButton(
                            enabled = !retrying,
                            colors = ButtonDefaults.outlinedButtonColors(contentColor = MaterialTheme.colorScheme.primary),
                            onClick = {
                                retrying = true
                                scope.launch {
                                    notice = if (runCatching { onRetry(selected.commandId) }.getOrDefault(false)) {
                                        "同じCaptureを再送します。"
                                    } else "再送を開始できませんでした。原文は保持しています。"
                                    retrying = false
                                }
                            },
                            modifier = Modifier.fillMaxWidth().testTag("pending-capture-retry"),
                        ) { Text(if (retrying) "再送を準備中" else "再送する") }
                    }
                    notice?.let { Text(it) }
                }
            }
        },
        confirmButton = { TextButton(onClick = onDismiss) { Text("閉じる") } },
        dismissButton = {
            if (selected != null) TextButton(onClick = { selectedId = null; notice = null }) { Text("一覧へ") }
        },
    )
}
