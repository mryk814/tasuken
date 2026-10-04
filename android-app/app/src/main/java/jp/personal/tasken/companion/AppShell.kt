package jp.personal.tasken.companion

import android.content.Context
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Badge
import androidx.compose.material3.BadgedBox
import androidx.compose.material3.Button
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.NavigationBar
import androidx.compose.material3.NavigationBarItem
import androidx.compose.material3.NavigationRail
import androidx.compose.material3.NavigationRailItem
import androidx.compose.material3.Surface
import androidx.compose.material3.Switch
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.rememberModalBottomSheetState
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.role
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp

/** 下部タブとレールの並び。Desktopの呼び方（Task・Feed）に揃える。 */
internal fun sectionLabel(section: AppSection): String = when (section) {
    AppSection.Today -> "今日"
    AppSection.Tasks -> "Task"
    AppSection.Feed -> "Feed"
    AppSection.Records -> "記録"
}

internal fun sectionIcon(section: AppSection): Int = when (section) {
    AppSection.Today -> R.drawable.ic_tabler_sun
    AppSection.Tasks -> R.drawable.ic_tabler_checklist
    AppSection.Feed -> R.drawable.ic_tabler_message_circle
    AppSection.Records -> R.drawable.ic_tabler_notebook
}

/**
 * 同期の様子を1つの印にまとめる。押すと中身（未反映・要確認・未送信の入力）を開く。
 * 正常な間は緑の点だけ、対応が要るときだけ件数を出す。
 */
internal data class SyncSummary(
    val connected: Boolean,
    val needsRepair: Boolean,
    val lastSyncedAt: String?,
    val message: String?,
    val pending: Int,
    val conflicts: Int,
    val unsentCaptures: Int,
    val recoveredInputs: Int,
) {
    val attentionCount: Int get() = conflicts + unsentCaptures + recoveredInputs
    val healthy: Boolean get() = connected && pending == 0 && attentionCount == 0
}

internal fun syncSummary(
    uiState: TodayUiState,
    pending: Int?,
    conflicts: Int?,
    unsentCaptures: Int,
    recoveredInputs: Int,
): SyncSummary = SyncSummary(
    connected = uiState is TodayUiState.Success || uiState is TodayUiState.Empty,
    needsRepair = uiState is TodayUiState.PairingRequired ||
        (uiState as? TodayUiState.Cached)?.recovery == TodayUiState.CachedRecovery.RePair,
    lastSyncedAt = when (uiState) {
        is TodayUiState.Success -> uiState.generatedAt
        is TodayUiState.Cached -> uiState.generatedAt
        else -> null
    }?.takeIf { it.isNotBlank() },
    message = when (uiState) {
        is TodayUiState.Cached -> uiState.message
        is TodayUiState.Error -> uiState.message
        else -> null
    },
    pending = pending ?: 0,
    conflicts = conflicts ?: 0,
    unsentCaptures = unsentCaptures,
    recoveredInputs = recoveredInputs,
)

@Composable
internal fun SyncStatusButton(summary: SyncSummary, onClick: () -> Unit) {
    val scheme = MaterialTheme.colorScheme
    val dark = scheme.surface.luminanceIsDark()
    val description = when {
        summary.healthy -> "同期済み"
        summary.attentionCount > 0 -> "同期の確認 ${summary.attentionCount}件"
        summary.pending > 0 -> "PCへ未反映 ${summary.pending}件"
        else -> "PCに接続していません"
    }
    IconButton(
        onClick = onClick,
        modifier = Modifier.testTag("open-sync-status").semantics { contentDescription = description },
    ) {
        BadgedBox(badge = {
            when {
                summary.attentionCount > 0 -> Badge(containerColor = scheme.error) { Text("${summary.attentionCount}") }
                summary.pending > 0 -> Badge(containerColor = scheme.secondary) { Text("${summary.pending}") }
                summary.healthy -> Box(Modifier.size(8.dp).background(taskenSuccessColor(dark), CircleShape))
                else -> Box(Modifier.size(8.dp).background(scheme.error, CircleShape))
            }
        }) {
            Icon(painterResource(R.drawable.ic_tabler_cloud), contentDescription = null)
        }
    }
}

private fun Color.luminanceIsDark(): Boolean =
    (0.2126f * red + 0.7152f * green + 0.0722f * blue) < 0.5f

@OptIn(ExperimentalMaterial3Api::class)
@Composable
internal fun SyncStatusSheet(
    summary: SyncSummary,
    refreshing: Boolean,
    onSyncNow: () -> Unit,
    onRepair: () -> Unit,
    onOpenUnsentCaptures: () -> Unit,
    onOpenRecoveredInputs: () -> Unit,
    onDismiss: () -> Unit,
) {
    ModalBottomSheet(onDismissRequest = onDismiss, sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true)) {
        SheetColumn(Modifier.testTag("sync-status-sheet")) {
            Text("同期", style = MaterialTheme.typography.titleLarge, fontWeight = FontWeight.Bold)
            StatusRow(
                icon = if (summary.connected) R.drawable.ic_tabler_circle_check else R.drawable.ic_tabler_alert_triangle,
                tone = if (summary.connected) StatusTone.Good else StatusTone.Warn,
                title = when {
                    summary.connected -> "PCと同期しています"
                    summary.needsRepair -> "PCとの接続をやり直してください"
                    else -> "端末に保存した内容を表示しています"
                },
                detail = summary.message ?: summary.lastSyncedAt?.let { "最終同期 ${formatLocalTimestamp(it)}" },
            )
            StatusRow(
                icon = R.drawable.ic_tabler_arrow_up,
                tone = if (summary.pending > 0) StatusTone.Info else StatusTone.Good,
                title = "PCへ未反映",
                value = "${summary.pending}件",
                detail = if (summary.pending > 0) "接続すると自動で送ります。" else null,
                modifier = Modifier.testTag("sync-pending"),
            )
            StatusRow(
                icon = R.drawable.ic_tabler_alert_triangle,
                tone = if (summary.conflicts > 0) StatusTone.Warn else StatusTone.Good,
                title = "要確認（競合）",
                value = "${summary.conflicts}件",
                detail = if (summary.conflicts > 0) "該当するTaskを開いて、どちらを残すか選びます。" else null,
                modifier = Modifier.testTag("sync-conflicts"),
            )
            if (summary.unsentCaptures > 0) {
                StatusRow(
                    icon = R.drawable.ic_tabler_send,
                    tone = StatusTone.Warn,
                    title = "未送信の入力",
                    value = "${summary.unsentCaptures}件",
                    onClick = onOpenUnsentCaptures,
                    modifier = Modifier.testTag("open-pending-captures"),
                )
            }
            if (summary.recoveredInputs > 0) {
                StatusRow(
                    icon = R.drawable.ic_tabler_refresh,
                    tone = StatusTone.Warn,
                    title = "回復済み入力",
                    value = "${summary.recoveredInputs}件",
                    onClick = onOpenRecoveredInputs,
                    modifier = Modifier.testTag("open-input-recovery"),
                )
            }
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalAlignment = Alignment.CenterVertically) {
                if (summary.needsRepair) {
                    TextButton(onClick = onRepair, modifier = Modifier.testTag("sync-repair")) { Text("再接続") }
                }
                Spacer(Modifier.weight(1f))
                Button(
                    onClick = onSyncNow,
                    enabled = !refreshing,
                    modifier = Modifier.heightIn(min = 48.dp).testTag("sync-now"),
                ) {
                    Icon(painterResource(R.drawable.ic_tabler_refresh), contentDescription = null, modifier = Modifier.size(18.dp))
                    Text(if (refreshing) "確認中" else "今すぐ同期", modifier = Modifier.padding(start = 6.dp))
                }
            }
        }
    }
}

/**
 * 設定を1か所へ集める。各画面に散らばっていた通知・PCなし整理・接続をここから開く。
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
internal fun AppSettingsSheet(
    notificationsAllowed: Boolean,
    notificationPermissionDenied: Boolean,
    onRequestNotifications: (() -> Unit)?,
    feedNotificationsEnabled: Boolean,
    onToggleFeedNotifications: () -> Unit,
    onOpenDirectAiSettings: () -> Unit,
    onRepair: () -> Unit,
    onDismiss: () -> Unit,
) {
    ModalBottomSheet(onDismissRequest = onDismiss, sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true)) {
        SheetColumn(Modifier.testTag("app-settings-sheet")) {
            Text("設定", style = MaterialTheme.typography.titleLarge, fontWeight = FontWeight.Bold)
            SettingsGroupLabel("通知")
            if (onRequestNotifications != null && !notificationsAllowed) {
                StatusRow(
                    icon = R.drawable.ic_tabler_bell,
                    tone = StatusTone.Warn,
                    title = "この端末の通知がオフです",
                    value = if (notificationPermissionDenied) "設定を開く" else "許可する",
                    onClick = onRequestNotifications,
                    modifier = Modifier.testTag("notification-permission-action"),
                )
            }
            Row(
                modifier = Modifier
                    .fillMaxWidth()
                    .heightIn(min = 56.dp)
                    .clickable(onClick = onToggleFeedNotifications)
                    .testTag("attention-notifications-toggle"),
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(12.dp),
            ) {
                StatusIcon(R.drawable.ic_tabler_message_circle, StatusTone.Info)
                Column(Modifier.weight(1f)) {
                    Text("Feedの質問を通知", style = MaterialTheme.typography.bodyLarge)
                    Text(
                        "あなたの返事を待つ投稿が届いたら知らせます",
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                }
                Switch(checked = feedNotificationsEnabled, onCheckedChange = { onToggleFeedNotifications() })
            }
            HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant)
            SettingsGroupLabel("入力の整理")
            StatusRow(
                icon = R.drawable.ic_tabler_sparkles,
                tone = StatusTone.Info,
                title = "PCなし整理",
                detail = "PCがオフでも、入力をTaskへ分けられるようにします",
                value = "開く",
                onClick = onOpenDirectAiSettings,
                modifier = Modifier.testTag("open-direct-ai-settings"),
            )
            HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant)
            SettingsGroupLabel("接続")
            StatusRow(
                icon = R.drawable.ic_tabler_link,
                tone = StatusTone.Info,
                title = "PCとの接続をやり直す",
                detail = "Pairing codeを入れ直します",
                value = "開く",
                onClick = onRepair,
                modifier = Modifier.testTag("settings-repair"),
            )
        }
    }
}

@Composable
private fun SheetColumn(modifier: Modifier = Modifier, content: @Composable ColumnScope.() -> Unit) {
    Column(
        modifier = modifier
            .fillMaxWidth()
            .widthIn(max = 640.dp)
            .verticalScroll(rememberScrollState())
            .padding(start = 20.dp, end = 20.dp, bottom = 16.dp)
            .navigationBarsPadding(),
        verticalArrangement = Arrangement.spacedBy(8.dp),
        content = content,
    )
}

@Composable
private fun SettingsGroupLabel(text: String) {
    Text(
        text,
        style = MaterialTheme.typography.labelLarge,
        color = MaterialTheme.colorScheme.primary,
        modifier = Modifier.padding(top = 8.dp),
    )
}

internal enum class StatusTone { Good, Info, Warn }

@Composable
private fun StatusIcon(icon: Int, tone: StatusTone) {
    val scheme = MaterialTheme.colorScheme
    val dark = scheme.surface.luminanceIsDark()
    val (container, content) = when (tone) {
        StatusTone.Good -> taskenSuccessColor(dark).copy(alpha = 0.14f) to taskenSuccessColor(dark)
        StatusTone.Info -> scheme.secondaryContainer to scheme.onSecondaryContainer
        StatusTone.Warn -> scheme.errorContainer to scheme.onErrorContainer
    }
    Box(
        Modifier.size(36.dp).background(container, RoundedCornerShape(10.dp)),
        contentAlignment = Alignment.Center,
    ) {
        Icon(painterResource(icon), contentDescription = null, tint = content, modifier = Modifier.size(20.dp))
    }
}

@Composable
private fun StatusRow(
    icon: Int,
    tone: StatusTone,
    title: String,
    modifier: Modifier = Modifier,
    detail: String? = null,
    value: String? = null,
    onClick: (() -> Unit)? = null,
) {
    Row(
        modifier = modifier
            .fillMaxWidth()
            .heightIn(min = 56.dp)
            .then(
                if (onClick != null) Modifier.semantics { role = Role.Button }.clickable(onClick = onClick) else Modifier,
            )
            .padding(vertical = 6.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        StatusIcon(icon, tone)
        Column(Modifier.weight(1f)) {
            Text(title, style = MaterialTheme.typography.bodyLarge)
            detail?.let {
                Text(it, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
            }
        }
        value?.let {
            Text(
                if (onClick != null) "$it ›" else it,
                style = MaterialTheme.typography.labelLarge,
                color = if (onClick != null) MaterialTheme.colorScheme.primary else MaterialTheme.colorScheme.onSurfaceVariant,
            )
        }
    }
}

/** スマホ幅の下部タブ。 */
@Composable
internal fun AppNavigationBar(
    active: AppSection,
    onSelect: (AppSection) -> Unit,
    badge: @Composable (AppSection) -> Unit,
) {
    NavigationBar {
        AppSection.entries.forEach { section ->
            NavigationBarItem(
                selected = active == section,
                onClick = { onSelect(section) },
                icon = { BadgedBox(badge = { badge(section) }) { Icon(painterResource(sectionIcon(section)), contentDescription = null) } },
                label = { Text(sectionLabel(section)) },
                modifier = Modifier.testTag("nav-${section.name.lowercase()}"),
            )
        }
    }
}

/** Foldの展開幅では左のレールへ。追加ボタンもレールの頭に置き、親指と視線の起点を揃える。 */
@Composable
internal fun AppNavigationRail(
    active: AppSection,
    onSelect: (AppSection) -> Unit,
    badge: @Composable (AppSection) -> Unit,
    header: @Composable ColumnScope.() -> Unit,
) {
    NavigationRail(header = header, modifier = Modifier.fillMaxHeight()) {
        Spacer(Modifier.size(8.dp))
        AppSection.entries.forEach { section ->
            NavigationRailItem(
                selected = active == section,
                onClick = { onSelect(section) },
                icon = { BadgedBox(badge = { badge(section) }) { Icon(painterResource(sectionIcon(section)), contentDescription = null) } },
                label = { Text(sectionLabel(section)) },
                modifier = Modifier.testTag("nav-${section.name.lowercase()}"),
            )
        }
    }
}

/** 一度読めば足りる操作のヒント。端末内だけに覚え、正本データには書かない。 */
internal class UiHintStore(context: Context) {
    private val preferences = context.getSharedPreferences("tasken_ui_hints", Context.MODE_PRIVATE)

    fun shown(key: String): Boolean = preferences.getBoolean(key, false)

    fun markShown(key: String) {
        preferences.edit().putBoolean(key, true).apply()
    }

    companion object {
        const val TODAY_GESTURES = "today_gestures"
    }
}

/** 初回だけ出す一行のヒント。押すと閉じて、以後は出さない。 */
@Composable
internal fun GestureHint(text: String, onDismiss: () -> Unit, modifier: Modifier = Modifier) {
    Surface(
        onClick = onDismiss,
        shape = RoundedCornerShape(12.dp),
        color = MaterialTheme.colorScheme.secondaryContainer,
        contentColor = MaterialTheme.colorScheme.onSecondaryContainer,
        modifier = modifier.fillMaxWidth().testTag("gesture-hint"),
    ) {
        Row(
            modifier = Modifier.padding(horizontal = 14.dp, vertical = 10.dp),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(10.dp),
        ) {
            Icon(painterResource(R.drawable.ic_tabler_arrow_right), contentDescription = null, modifier = Modifier.size(18.dp))
            Text(text, style = MaterialTheme.typography.bodySmall, modifier = Modifier.weight(1f))
            Icon(painterResource(R.drawable.ic_tabler_x), contentDescription = "ヒントを閉じる", modifier = Modifier.size(16.dp))
        }
    }
}
