package jp.personal.tasken.companion

import android.content.Context
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.RowScope
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.BadgedBox
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
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
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Surface
import androidx.compose.material3.Switch
import androidx.compose.material3.Text
import androidx.compose.material3.rememberModalBottomSheetState
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.role
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import java.time.Instant
import java.time.ZoneId
import java.time.format.DateTimeFormatter

/** 下部タブとレールの並び。Desktopの呼び方（Task・Feed）に揃える。 */
internal fun sectionLabel(section: AppSection): String = when (section) {
    AppSection.Today -> "今日"
    AppSection.Tasks -> "やること"
    AppSection.Feed -> "近況"
    AppSection.Records -> "日誌"
}

internal fun sectionIcon(section: AppSection): Int = when (section) {
    AppSection.Today -> R.drawable.ic_tabler_sun
    AppSection.Tasks -> R.drawable.ic_tabler_checklist
    AppSection.Feed -> R.drawable.ic_tabler_message_circle
    AppSection.Records -> R.drawable.ic_tabler_notebook
}

/** 受け取られなかった物の一つ。[taskId] があれば、その Task を開いて決める。無ければ入力の一覧を開く。 */
internal data class SyncReturned(val title: String, val reason: String, val taskId: String? = null)

/**
 * 同期の様子。未送信は、理由で三つに分ける（送信の列の state と 1 対 1）。
 * - つながったら送る（[waiting]）: pending・sending・retry_wait。待てば自分で送る。
 * - 直すと送れる（[fixable]）: 上と同じ命令でも、この端末の登録が切れている間（[needsRepair]）は本人がつなぎ直すまで送れない。
 *   それと、PC の版が古くて受け取れなかった入力（rejected のうち capability_unavailable）。
 * - 受け取られなかった（[returned]）: conflict と、それ以外の rejected（後ろで止まっている blocked も同じ Task に含む）。
 *   捨てずに端末に残し、本人が開いて決める。
 */
internal data class SyncSummary(
    val connected: Boolean,
    val needsRepair: Boolean,
    val lastSyncedAt: String?,
    val message: String?,
    val waiting: Int,
    val retry: MobileSendRetry?,
    val nextSendAt: Long?,
    val fixable: Int,
    val fixReason: String?,
    val returned: List<SyncReturned>,
    val unsentCaptures: Int,
    val recoveredInputs: Int,
) {
    /** 上の帯の「割印＋数」。端末に残った入力（回復した下書き）も、本人が入れてまだ届いていない物として数える。 */
    val unsent: Int get() = waiting + fixable + returned.size + recoveredInputs
    val healthy: Boolean get() = connected && unsent == 0
}

internal fun MobileTask.toSyncReturned(): SyncReturned? = when {
    conflict != null -> SyncReturned(title, "PC で先に変わっていました", id)
    heldChanges.any { it.rejected } -> SyncReturned(title, heldChanges.first { it.rejected }.reason, id)
    else -> null
}

internal fun syncSummary(
    uiState: TodayUiState,
    pending: Int?,
    tasks: List<MobileTask>,
    captures: List<MobilePendingCapture>,
    recoveredInputs: Int,
    retry: MobileSendRetry? = null,
    nextSendAt: Long? = null,
): SyncSummary {
    val needsRepair = uiState is TodayUiState.PairingRequired ||
        (uiState as? TodayUiState.Cached)?.recovery == TodayUiState.CachedRecovery.RePair
    val message = when (uiState) {
        is TodayUiState.Cached -> uiState.message
        is TodayUiState.Error -> uiState.message
        is TodayUiState.PairingRequired -> uiState.message
        else -> null
    }?.takeIf { it.isNotBlank() }
    val shown = when (uiState) {
        is TodayUiState.Success -> uiState.tasks
        is TodayUiState.Cached -> uiState.tasks
        else -> emptyList()
    }
    val sendable = pending ?: 0
    val oldPcCaptures = captures.count { it.needsFix }
    return SyncSummary(
        connected = uiState is TodayUiState.Success || uiState is TodayUiState.Empty,
        needsRepair = needsRepair,
        lastSyncedAt = when (uiState) {
            is TodayUiState.Success -> uiState.generatedAt
            is TodayUiState.Cached -> uiState.generatedAt
            else -> null
        }?.takeIf { it.isNotBlank() },
        message = message,
        waiting = if (needsRepair) 0 else sendable,
        retry = retry.takeUnless { needsRepair },
        nextSendAt = nextSendAt.takeUnless { needsRepair },
        fixable = (if (needsRepair) sendable else 0) + oldPcCaptures,
        fixReason = when {
            needsRepair -> message ?: "この端末の登録が切れました"
            oldPcCaptures > 0 -> "PC の Tasken が古く、受け取れない入力があります"
            else -> null
        },
        returned = (tasks + shown).distinctBy { it.id }.mapNotNull(MobileTask::toSyncReturned) +
            captures.filter { it.canRetry && !it.needsFix }.map {
                SyncReturned(it.text.lineSequence().firstOrNull().orEmpty().take(40), "PC が受け取りませんでした")
            },
        unsentCaptures = captures.size,
        recoveredInputs = recoveredInputs,
    )
}

/**
 * 上の帯の同期の印。未送信がある間は「割印＋数」、受け取られなかった物だけなら「戻」、
 * つながらないだけなら電波なしの絵、何も無ければ緑の点。押すと理由の三つの一覧を開く。
 */
@Composable
internal fun SyncStatusButton(summary: SyncSummary, onClick: () -> Unit) {
    val scheme = MaterialTheme.colorScheme
    val dark = scheme.surface.luminanceIsDark()
    val onlyReturned = summary.returned.isNotEmpty() && summary.unsent == summary.returned.size
    val description = when {
        summary.healthy -> "同期 届いています"
        onlyReturned -> "同期 受け取られなかった ${summary.unsent}"
        summary.unsent > 0 -> "同期 未送信 ${summary.unsent}"
        summary.needsRepair -> "同期 つなぎ直しが要ります"
        else -> "同期 つながらない"
    }
    Row(
        modifier = Modifier
            .heightIn(min = 48.dp)
            .widthIn(min = 48.dp)
            .clip(CircleShape)
            .clickable(role = Role.Button, onClick = onClick)
            .testTag("open-sync-status")
            .clearAndSetSemantics { contentDescription = description }
            .padding(horizontal = 8.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.Center,
    ) {
        when {
            summary.unsent > 0 -> {
                Icon(painterResource(R.drawable.ic_tabler_cloud), contentDescription = null)
                Spacer(Modifier.size(4.dp))
                if (onlyReturned) OflModo(description = null) else OflWari(scale = 0.8f, description = null)
                Text(
                    "${summary.unsent}",
                    style = MaterialTheme.typography.labelLarge.copy(fontFeatureSettings = "tnum"),
                    fontWeight = FontWeight.ExtraBold,
                    modifier = Modifier.padding(start = 4.dp),
                )
            }
            summary.healthy -> BadgedBox(badge = { Box(Modifier.size(8.dp).background(taskenSuccessColor(dark), CircleShape)) }) {
                Icon(painterResource(R.drawable.ic_tabler_cloud), contentDescription = null)
            }
            summary.needsRepair -> {
                Icon(painterResource(R.drawable.ic_tabler_cloud), contentDescription = null)
                Spacer(Modifier.size(4.dp))
                OflBang(description = null)
            }
            else -> OflNowave(Modifier.size(24.dp), color = scheme.onSurfaceVariant)
        }
    }
}

private fun Color.luminanceIsDark(): Boolean =
    (0.2126f * red + 0.7152f * green + 0.0722f * blue) < 0.5f

private val SYNC_CLOCK: DateTimeFormatter = DateTimeFormatter.ofPattern("H:mm")

private fun clockLabel(at: Instant, zone: ZoneId = ZoneId.systemDefault()): String = SYNC_CLOCK.withZone(zone).format(at)

/** 「4回送った・最後 12:31」。試した記録が無ければ null。 */
internal fun retrySummaryLabel(retry: MobileSendRetry?, zone: ZoneId = ZoneId.systemDefault()): String? {
    if (retry == null || retry.attempts <= 0) return null
    val last = parseInstantOrNull(retry.lastAttemptAt)?.let { "・最後 ${clockLabel(it, zone)}" }.orEmpty()
    return "${retry.attempts}回送った$last"
}

/** 「次は 12:45」。予定が分からない時と、過ぎた時刻（通信が戻るのを待っている）は出さない。 */
internal fun nextSendLabel(nextSendAt: Long?, now: Long = System.currentTimeMillis(), zone: ZoneId = ZoneId.systemDefault()): String? =
    nextSendAt?.takeIf { it > now }?.let { "次は ${clockLabel(Instant.ofEpochMilli(it), zone)}" }

/**
 * 同期の一覧。見出しの右に、最後に届いた時刻の日付印。未送信は理由の三つの行に分け、理由ごとに印を変える。
 * 割印だけ＝つながったら送る、割印＋「!」＝直すと送れる、「戻」＝受け取られなかった。
 */
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
    onOpenReturned: (SyncReturned) -> Unit = {},
) {
    ModalBottomSheet(onDismissRequest = onDismiss, sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true)) {
        SheetColumn(Modifier.testTag("sync-status-sheet")) {
            Row(verticalAlignment = Alignment.CenterVertically, modifier = Modifier.heightIn(min = 56.dp)) {
                Text("同期", style = MaterialTheme.typography.titleLarge, fontWeight = FontWeight.Bold)
                if (!summary.connected && !summary.needsRepair) {
                    Spacer(Modifier.size(12.dp))
                    OflNowave()
                    Text(
                        "つながらない",
                        style = MaterialTheme.typography.labelLarge,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                        modifier = Modifier.padding(start = 4.dp).testTag("sync-disconnected"),
                    )
                }
                Spacer(Modifier.weight(1f))
                parseInstantOrNull(summary.lastSyncedAt)?.let { at ->
                    Text(
                        stampAgeLabel(at),
                        style = MaterialTheme.typography.labelLarge,
                        fontWeight = FontWeight.SemiBold,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                        modifier = Modifier.padding(end = 8.dp),
                    )
                    OflStamp("届いた", at, modifier = Modifier.testTag("sync-arrived-stamp"))
                }
            }
            // つながらない理由は、送り直しの行があればそこに出る。無い時だけ、ここに一行で出す。
            val retryLine = retrySummaryLabel(summary.retry)
            if (!summary.connected && !summary.needsRepair && summary.message != null && summary.retry?.reason == null) {
                Text(summary.message, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
            }
            if (summary.unsent > 0) {
                Text(
                    "未送信 ${summary.unsent}",
                    style = MaterialTheme.typography.labelLarge,
                    fontWeight = FontWeight.Bold,
                    color = MaterialTheme.colorScheme.onSurface,
                    modifier = Modifier.padding(top = 4.dp).testTag("sync-unsent-count"),
                )
            }
            if (summary.waiting > 0) {
                HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant)
                ReasonRow(
                    mark = { OflWari(description = null) },
                    title = "つながったら送る",
                    count = summary.waiting,
                    modifier = Modifier.testTag("sync-pending"),
                ) {
                    listOfNotNull(retryLine, summary.retry?.reason).joinToString(" ").takeIf { it.isNotBlank() }?.let { ReasonDetail(it) }
                    nextSendLabel(summary.nextSendAt)?.let { ReasonDetail(it) }
                }
            }
            if (summary.fixable > 0 || summary.needsRepair) {
                HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant)
                ReasonRow(
                    mark = {
                        if (summary.fixable > 0) OflWari(description = null)
                        OflBang(Modifier.padding(start = if (summary.fixable > 0) 4.dp else 0.dp), description = null)
                    },
                    title = if (summary.fixable > 0) "直すと送れる" else "つなぎ直すと届きます",
                    count = summary.fixable.takeIf { it > 0 },
                    modifier = Modifier.testTag("sync-fix"),
                ) {
                    summary.fixReason?.let { ReasonDetail(it, strong = true) }
                    if (summary.needsRepair) {
                        ToolButton(onClick = onRepair, modifier = Modifier.testTag("sync-repair")) {
                            Text("つなぎ直す", fontWeight = FontWeight.Bold)
                        }
                    } else {
                        ToolButton(onClick = onOpenUnsentCaptures, modifier = Modifier.testTag("sync-fix-open")) {
                            Text("開いて送り直す", fontWeight = FontWeight.Bold)
                        }
                    }
                }
            }
            if (summary.returned.isNotEmpty()) {
                HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant)
                ReasonRow(
                    mark = { OflModo(description = null) },
                    title = "受け取られなかった",
                    count = summary.returned.size,
                    modifier = Modifier.testTag("sync-conflicts"),
                ) {
                    // 多い時は先の三つまで。残りは、開いた先（Task の一覧の「戻」の印）で見つかる。
                    summary.returned.take(3).forEachIndexed { index, item ->
                        Text(
                            "「${item.title}」",
                            style = MaterialTheme.typography.bodyMedium,
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                            maxLines = 1,
                            overflow = TextOverflow.Ellipsis,
                            modifier = Modifier.padding(top = if (index == 0) 0.dp else 8.dp),
                        )
                        ReasonDetail(item.reason, strong = true)
                        ToolButton(
                            onClick = { if (item.taskId != null) onOpenReturned(item) else onOpenUnsentCaptures() },
                            modifier = Modifier.testTag("sync-returned-open-$index"),
                        ) { Text("開いて決める", fontWeight = FontWeight.Bold) }
                    }
                    if (summary.returned.size > 3) ReasonDetail("ほか ${summary.returned.size - 3}")
                }
            }
            if (summary.unsentCaptures > 0 || summary.recoveredInputs > 0) {
                HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant)
            }
            if (summary.unsentCaptures > 0) {
                StatusRow(
                    icon = R.drawable.ic_tabler_send,
                    tone = StatusTone.Info,
                    title = "未送信の入力",
                    value = "${summary.unsentCaptures}件",
                    onClick = onOpenUnsentCaptures,
                    modifier = Modifier.testTag("open-pending-captures"),
                )
            }
            if (summary.recoveredInputs > 0) {
                StatusRow(
                    icon = R.drawable.ic_tabler_refresh,
                    tone = StatusTone.Info,
                    title = "端末に残った入力",
                    value = "${summary.recoveredInputs}件",
                    onClick = onOpenRecoveredInputs,
                    modifier = Modifier.testTag("open-input-recovery"),
                )
            }
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalAlignment = Alignment.CenterVertically) {
                Spacer(Modifier.weight(1f))
                Button(
                    onClick = onSyncNow,
                    enabled = !refreshing,
                    modifier = Modifier.heightIn(min = 48.dp).testTag("sync-now"),
                ) {
                    Icon(painterResource(R.drawable.ic_tabler_refresh), contentDescription = null, modifier = Modifier.size(18.dp))
                    Text(
                        when {
                            refreshing -> "確かめています"
                            summary.waiting > 0 -> "今すぐ送る"
                            else -> "今すぐ同期"
                        },
                        modifier = Modifier.padding(start = 6.dp),
                    )
                }
            }
        }
    }
}

/** 理由の一行。左に印（幅をそろえる）、題と数、その下に理由と押す物。 */
@Composable
private fun ReasonRow(
    mark: @Composable () -> Unit,
    title: String,
    count: Int?,
    modifier: Modifier = Modifier,
    content: @Composable ColumnScope.() -> Unit,
) {
    Row(
        modifier = modifier.fillMaxWidth().padding(vertical = 8.dp),
        horizontalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        Row(Modifier.width(60.dp).heightIn(min = 30.dp), verticalAlignment = Alignment.CenterVertically) { mark() }
        Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(2.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically, modifier = Modifier.heightIn(min = 30.dp)) {
                Text(
                    title,
                    style = MaterialTheme.typography.titleMedium,
                    fontWeight = FontWeight.Bold,
                    color = MaterialTheme.colorScheme.onSurface,
                    modifier = Modifier.weight(1f),
                )
                count?.let {
                    Text(
                        "$it",
                        style = MaterialTheme.typography.titleMedium.copy(fontFeatureSettings = "tnum"),
                        fontWeight = FontWeight.ExtraBold,
                        color = MaterialTheme.colorScheme.onSurface,
                    )
                }
            }
            content()
        }
    }
}

/** 理由の行に添える、押せる物。道具の一色（アプリの主の色）は押せる物だけに使う。 */
@Composable
private fun ToolButton(onClick: () -> Unit, modifier: Modifier = Modifier, content: @Composable RowScope.() -> Unit) {
    OutlinedButton(
        onClick = onClick,
        colors = ButtonDefaults.outlinedButtonColors(contentColor = MaterialTheme.colorScheme.primary),
        border = BorderStroke(1.dp, MaterialTheme.colorScheme.primary),
        modifier = modifier.padding(top = 6.dp).heightIn(min = 44.dp),
        content = content,
    )
}

@Composable
private fun ReasonDetail(text: String, strong: Boolean = false) {
    Text(
        text,
        style = MaterialTheme.typography.bodyMedium,
        color = if (strong) MaterialTheme.colorScheme.onSurface else MaterialTheme.colorScheme.onSurfaceVariant,
    )
}
/**
 * 設定を1か所へ集める。通知の許可と接続をここから開く。
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
internal fun AppSettingsSheet(
    notificationsAllowed: Boolean,
    notificationPermissionDenied: Boolean,
    onRequestNotifications: (() -> Unit)?,
    onRepair: () -> Unit,
    onDismiss: () -> Unit,
) {
    ModalBottomSheet(onDismissRequest = onDismiss, sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true)) {
        SheetColumn(Modifier.testTag("app-settings-sheet")) {
            Text("設定", style = MaterialTheme.typography.titleLarge, fontWeight = FontWeight.Bold)
            // 通知は場所のリマインダーだけになった。許可が無い時だけ、許可の入口を出す。
            if (onRequestNotifications != null && !notificationsAllowed) {
                SettingsGroupLabel("通知")
                StatusRow(
                    icon = R.drawable.ic_tabler_bell,
                    tone = StatusTone.Warn,
                    title = "この端末の通知がオフです",
                    value = if (notificationPermissionDenied) "設定を開く" else "許可する",
                    onClick = onRequestNotifications,
                    modifier = Modifier.testTag("notification-permission-action"),
                )
                HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant)
            }
            SettingsGroupLabel("接続")
            StatusRow(
                icon = R.drawable.ic_tabler_link,
                tone = StatusTone.Info,
                title = "PC とつなぎ直す",
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
