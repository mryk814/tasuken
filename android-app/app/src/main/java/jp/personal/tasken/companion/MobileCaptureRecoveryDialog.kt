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
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalClipboardManager
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.text.AnnotatedString
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp

/** The owner checks its live draft again before restoring and persists before opening the editor. */
@Composable
internal fun MobileCaptureRecoveryDialog(
    entries: List<MobileRecoveredInput>,
    canRestore: Boolean,
    onRestore: (MobileRecoveredInput) -> Boolean,
    onDelete: (String) -> Boolean,
    onDismiss: () -> Unit,
) {
    var selectedId by rememberSaveable { mutableStateOf<String?>(null) }
    var confirmDelete by rememberSaveable { mutableStateOf(false) }
    var notice by rememberSaveable { mutableStateOf<String?>(null) }
    val selected = entries.firstOrNull { it.id == selectedId }
    val clipboard = LocalClipboardManager.current
    if (confirmDelete && selected != null) {
        AlertDialog(
            onDismissRequest = { confirmDelete = false },
            title = { Text("回復済み入力を削除") },
            text = { Text("この回復済み入力を端末から削除します。元に戻せません。") },
            confirmButton = {
                TextButton(
                    onClick = {
                        if (onDelete(selected.id)) {
                            selectedId = null
                            notice = "削除しました"
                        } else notice = "削除できませんでした。もう一度お試しください。"
                        confirmDelete = false
                    },
                    colors = ButtonDefaults.textButtonColors(contentColor = MaterialTheme.colorScheme.error),
                    modifier = Modifier.testTag("recovery-confirm-delete"),
                ) { Text("削除する") }
            },
            dismissButton = { TextButton(onClick = { confirmDelete = false }) { Text("キャンセル") } },
        )
        return
    }
    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text("回復済み入力") },
        text = {
            Column(
                modifier = Modifier.heightIn(max = 480.dp).verticalScroll(rememberScrollState()),
                verticalArrangement = Arrangement.spacedBy(8.dp),
            ) {
                notice?.let { Text(it, modifier = Modifier.testTag("recovery-notice")) }
                if (selected == null) {
                    if (entries.isEmpty()) Text("回復済み入力はありません")
                    if (entries.sumOf { it.byteCount.toLong() } >= 5 * 1024 * 1024) {
                        Text("回復済み入力が5 MBを超えています。必要な内容をコピーしてから不要な入力を削除できます。")
                    }
                    LazyColumn(Modifier.heightIn(max = 360.dp).testTag("recovery-list")) {
                        items(entries, key = { it.id }) { entry ->
                            TextButton(
                                onClick = { selectedId = entry.id; notice = null },
                                modifier = Modifier.fillMaxWidth().testTag("recovery-entry-${entry.id}"),
                            ) {
                                Column(Modifier.fillMaxWidth()) {
                                    Text(entry.text.ifBlank { "空の入力" }, maxLines = 2, overflow = TextOverflow.Ellipsis)
                                    Text(
                                        if (entry.snapshot == null) "元データを保管" else "保存から7日を過ぎた入力",
                                        style = MaterialTheme.typography.labelSmall,
                                    )
                                }
                            }
                        }
                    }
                } else {
                    if (selected.snapshot == null) Text("読み取れなかった元データです。コピーまたは文字列として入力へ戻せます。")
                    SelectionContainer {
                        Text(
                            selected.text,
                            color = MaterialTheme.colorScheme.onSurface,
                            modifier = Modifier.fillMaxWidth().heightIn(max = 280.dp)
                                .verticalScroll(rememberScrollState()).testTag("recovery-content"),
                        )
                    }
                    OutlinedButton(
                        colors = ButtonDefaults.outlinedButtonColors(contentColor = MaterialTheme.colorScheme.primary),
                        onClick = {
                            runCatching { clipboard.setText(AnnotatedString(selected.text)) }
                                .onSuccess { notice = "コピーしました" }
                                .onFailure { notice = "コピーできませんでした。もう一度お試しください。" }
                        },
                        modifier = Modifier.fillMaxWidth().testTag("recovery-copy"),
                    ) { Text("コピー") }
                    OutlinedButton(
                        enabled = canRestore,
                        onClick = {
                            if (onRestore(selected)) onDismiss()
                            else notice = "入力へ戻せませんでした。現在の入力と端末の空き容量を確認してください。"
                        },
                        modifier = Modifier.fillMaxWidth().testTag("recovery-restore"),
                    ) { Text("入力へ戻す") }
                    if (!canRestore) Text("現在の入力を保存してから戻せます。コピーはできます。")
                    TextButton(
                        onClick = { confirmDelete = true },
                        colors = ButtonDefaults.textButtonColors(contentColor = MaterialTheme.colorScheme.error),
                        modifier = Modifier.testTag("recovery-delete"),
                    ) { Text("削除") }
                }
            }
        },
        confirmButton = {
            TextButton(onClick = onDismiss) { Text("閉じる") }
        },
        dismissButton = {
            if (selected != null) TextButton(onClick = { selectedId = null; notice = null }) { Text("一覧へ") }
        },
    )
}
