package jp.personal.tasken.companion

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.unit.dp

/** Origin and unreadness only. Opening the explanation never accepts or completes a Task. */
@Composable
internal fun AiOriginMark(origin: MobileAiOrigin?, modifier: Modifier = Modifier) {
    if (origin == null) return
    var expanded by rememberSaveable(origin) { mutableStateOf(false) }
    val label = "AI作成 · " + if (origin.seenAt == null) "未確認" else "既読"
    Box(modifier) {
        IconButton(onClick = { expanded = !expanded }, modifier = Modifier.size(48.dp)) {
            Box(Modifier.size(24.dp)) {
                Icon(painterResource(R.drawable.ic_tabler_sparkles), contentDescription = "$label。作成元を表示",
                    tint = MaterialTheme.colorScheme.onSurfaceVariant, modifier = Modifier.size(20.dp).align(Alignment.Center))
                if (origin.seenAt == null) Box(Modifier.size(6.dp).align(Alignment.TopEnd)
                    .background(MaterialTheme.colorScheme.primary, CircleShape))
            }
        }
        DropdownMenu(expanded = expanded, onDismissRequest = { expanded = false }) {
            Column(Modifier.widthIn(max = 272.dp).padding(16.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                Text(label, style = MaterialTheme.typography.titleSmall)
                Text("${origin.caller} · ${origin.receivedAt.take(10)}", style = MaterialTheme.typography.bodyMedium)
                Text("既読は内容の正確さの確認やTask完了とは別です。", style = MaterialTheme.typography.bodySmall)
                TextButton(onClick = { expanded = false }) { Text("閉じる") }
            }
        }
    }
}
