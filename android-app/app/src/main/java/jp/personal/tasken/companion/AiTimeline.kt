package jp.personal.tasken.companion

import android.content.Context
import androidx.compose.foundation.ExperimentalFoundationApi
import androidx.compose.foundation.combinedClickable
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.hapticfeedback.HapticFeedbackType
import androidx.compose.ui.platform.LocalHapticFeedback
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.role
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import java.time.Duration
import java.time.Instant
import java.time.ZoneId
import java.time.format.DateTimeFormatter

/** AIの動きを新しい順に1本へ並べた1件。要対応（あなたの番）とは別に持つ。 */
internal sealed interface AiTimelineEntry {
    val key: String
    val at: Instant?

    data class TaskActivity(val task: MobileTask, override val at: Instant?) : AiTimelineEntry {
        override val key: String get() = "timeline-task-${task.id}"
    }

    data class Proposal(val proposal: MobileTaskWorkProposal, override val at: Instant?) : AiTimelineEntry {
        override val key: String get() = "proposal-${proposal.id}"
    }
}

internal fun parseInstantOrNull(value: String?): Instant? =
    value?.takeIf { it.isNotBlank() }?.let { runCatching { Instant.parse(it) }.getOrNull() }

/** AIが関わるTaskとProposalを新しい順に並べる。時刻が読めないものは末尾へ。 */
internal fun buildAiTimeline(
    tasks: List<MobileTask>,
    proposals: List<MobileTaskWorkProposal>,
): List<AiTimelineEntry> {
    val taskEntries = tasks
        .filter { aiInboxSection(it.workState) != null }
        .map { AiTimelineEntry.TaskActivity(it, parseInstantOrNull(it.latestWorkReceipt?.reportedAt) ?: parseInstantOrNull(it.updatedAt)) }
    val proposalEntries = proposals.map {
        AiTimelineEntry.Proposal(it, parseInstantOrNull(it.reportedAt) ?: parseInstantOrNull(it.receivedAt))
    }
    return (taskEntries + proposalEntries).sortedWith(
        compareByDescending<AiTimelineEntry> { it.at != null }.thenByDescending { it.at },
    )
}

internal fun newestAiActivity(entries: List<AiTimelineEntry>): Instant? = entries.mapNotNull { it.at }.maxOrNull()

internal fun relativeTimeLabel(at: Instant, now: Instant = Instant.now(), zone: ZoneId = ZoneId.systemDefault()): String {
    val elapsed = Duration.between(at, now)
    return when {
        elapsed.isNegative || elapsed.toMinutes() < 1 -> "たった今"
        elapsed.toMinutes() < 60 -> "${elapsed.toMinutes()}分前"
        elapsed.toHours() < 24 -> "${elapsed.toHours()}時間前"
        elapsed.toDays() < 2 -> "昨日"
        else -> DateTimeFormatter.ofPattern("M/d").withZone(zone).format(at)
    }
}

/** AIの動きをどこまで見たか。端末内だけに持ち、正本データには書かない。 */
internal class AiSeenStore(context: Context) {
    private val preferences = context.getSharedPreferences("tasken_ai_timeline", Context.MODE_PRIVATE)

    fun lastSeenAt(): Instant? = parseInstantOrNull(preferences.getString(KEY_LAST_SEEN, null))

    fun markSeen(at: Instant) {
        val current = lastSeenAt()
        if (current == null || at.isAfter(current)) preferences.edit().putString(KEY_LAST_SEEN, at.toString()).apply()
    }

    private companion object { const val KEY_LAST_SEEN = "last_seen_at" }
}

internal fun aiActivityVerb(section: AiInboxSection?): String = when (section) {
    AiInboxSection.InProgress -> "作業しています"
    AiInboxSection.NeedsReview -> "報告が届きました"
    AiInboxSection.Blocked -> "手が止まっています"
    AiInboxSection.RecentlyAccepted -> "完了しました"
    null -> "更新しました"
}

/**
 * 投稿者の丸。出所ごとに色と頭文字を変えて見分ける（DesktopのFeedと同じ考え方）。
 * サービスのロゴは模さない。
 */
@Composable
internal fun FeedAvatar(name: String, modifier: Modifier = Modifier) {
    val palette = feedAvatarPalette()
    val (container, content) = palette[Math.floorMod(name.hashCode(), palette.size)]
    Box(
        modifier = modifier.size(40.dp).clip(CircleShape).background(container),
        contentAlignment = Alignment.Center,
    ) {
        Text(
            name.trim().firstOrNull()?.uppercase() ?: "?",
            color = content,
            style = MaterialTheme.typography.titleMedium,
            fontWeight = FontWeight.Bold,
        )
    }
}

@Composable
private fun feedAvatarPalette(): List<Pair<Color, Color>> {
    val scheme = MaterialTheme.colorScheme
    return listOf(
        scheme.primaryContainer to scheme.onPrimaryContainer,
        scheme.secondaryContainer to scheme.onSecondaryContainer,
        scheme.tertiaryContainer to scheme.onTertiaryContainer,
        scheme.surfaceContainerHighest to scheme.onSurface,
    )
}

/**
 * Feedの1投稿。左に投稿者、右に「誰が・何をした・いつ」、本文、操作を置く。
 * 投稿の間は細い線だけで区切り、枠で囲まない。新着は左上の点と「新着」の語で示す。
 * 長押しで操作メニューを開ける（[menu] がある場合）。
 */
@OptIn(ExperimentalFoundationApi::class)
@Composable
internal fun AiPost(
    author: String,
    verb: String,
    at: Instant?,
    isNew: Boolean,
    modifier: Modifier = Modifier,
    onClick: (() -> Unit)? = null,
    highlighted: Boolean = false,
    menu: (@Composable ColumnScope.(close: () -> Unit) -> Unit)? = null,
    content: @Composable () -> Unit,
) {
    var menuOpen by remember { mutableStateOf(false) }
    val haptics = LocalHapticFeedback.current
    Column(modifier = modifier.fillMaxWidth()) {
        Box {
            Row(
                modifier = Modifier
                    .fillMaxWidth()
                    .background(
                        when {
                            highlighted -> MaterialTheme.colorScheme.secondaryContainer
                            isNew -> MaterialTheme.colorScheme.surfaceContainerLow
                            else -> Color.Transparent
                        },
                        RoundedCornerShape(12.dp),
                    )
                    .then(
                        if (onClick != null || menu != null) {
                            Modifier.semantics { role = Role.Button }.combinedClickable(
                                onClick = { onClick?.invoke() },
                                onLongClickLabel = if (menu != null) "操作メニュー" else null,
                                onLongClick = if (menu != null) {
                                    {
                                        haptics.performHapticFeedback(HapticFeedbackType.LongPress)
                                        menuOpen = true
                                    }
                                } else {
                                    null
                                },
                            )
                        } else {
                            Modifier
                        },
                    )
                    .padding(start = 8.dp, end = 12.dp, top = 12.dp, bottom = 12.dp),
                horizontalArrangement = Arrangement.spacedBy(12.dp),
            ) {
                Box {
                    FeedAvatar(author)
                    if (isNew) {
                        Box(
                            Modifier
                                .align(Alignment.TopEnd)
                                .size(10.dp)
                                .clip(CircleShape)
                                .background(MaterialTheme.colorScheme.primary),
                        )
                    }
                }
                Column(modifier = Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(4.dp)) {
                    FlowRow(
                        horizontalArrangement = Arrangement.spacedBy(6.dp),
                        verticalArrangement = Arrangement.spacedBy(2.dp),
                        itemVerticalAlignment = Alignment.CenterVertically,
                    ) {
                        Text(author, style = MaterialTheme.typography.labelLarge, fontWeight = FontWeight.Bold, maxLines = 1, overflow = TextOverflow.Ellipsis)
                        Text(verb, style = MaterialTheme.typography.labelMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
                        at?.let {
                            Text(
                                "· ${relativeTimeLabel(it)}",
                                style = MaterialTheme.typography.labelMedium,
                                color = MaterialTheme.colorScheme.onSurfaceVariant,
                            )
                        }
                        if (isNew) {
                            Text("新着", style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.primary, fontWeight = FontWeight.Bold)
                        }
                    }
                    content()
                }
            }
            if (menu != null) {
                DropdownMenu(expanded = menuOpen, onDismissRequest = { menuOpen = false }) {
                    menu { menuOpen = false }
                }
            }
        }
        HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant, modifier = Modifier.padding(start = 60.dp))
    }
}

/** 前回見たところ。ここより上が、前に開いてから増えたAIの動き。 */
@Composable
internal fun AiSeenDivider(modifier: Modifier = Modifier) {
    Row(
        modifier = modifier.fillMaxWidth().padding(vertical = 4.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(8.dp),
    ) {
        HorizontalDivider(Modifier.weight(1f), color = MaterialTheme.colorScheme.outline)
        Text("前回ここまで見ました", style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
        HorizontalDivider(Modifier.weight(1f), color = MaterialTheme.colorScheme.outline)
    }
}

/** 作業中・開始待ちは要対応ではない。件数だけを小さな札で並べる。 */
@Composable
internal fun AiCountsStrip(counts: MobileAttentionCountsDto?) {
    if (counts == null) return
    FlowRow(
        modifier = Modifier.fillMaxWidth().padding(vertical = 4.dp),
        horizontalArrangement = Arrangement.spacedBy(8.dp),
        verticalArrangement = Arrangement.spacedBy(6.dp),
        itemVerticalAlignment = Alignment.CenterVertically,
    ) {
        AiCountChip("作業中 ${counts.working}", active = counts.working > 0)
        AiCountChip("開始待ち ${counts.queued}", active = false)
        Text(
            "開始は未確認",
            style = MaterialTheme.typography.labelSmall,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
        )
    }
}

@Composable
private fun AiCountChip(text: String, active: Boolean) {
    Surface(
        shape = RoundedCornerShape(50),
        color = if (active) MaterialTheme.colorScheme.primaryContainer else MaterialTheme.colorScheme.surfaceContainer,
    ) {
        Row(
            modifier = Modifier.padding(horizontal = 10.dp, vertical = 5.dp),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(6.dp),
        ) {
            if (active) Box(Modifier.size(6.dp).clip(CircleShape).background(MaterialTheme.colorScheme.primary))
            Text(
                text,
                style = MaterialTheme.typography.labelMedium,
                fontWeight = FontWeight.SemiBold,
                color = if (active) MaterialTheme.colorScheme.onPrimaryContainer else MaterialTheme.colorScheme.onSurfaceVariant,
            )
        }
    }
}

@Composable
internal fun AiSectionTitle(text: String, modifier: Modifier = Modifier) {
    Text(
        text,
        modifier = modifier.padding(top = 12.dp, bottom = 2.dp),
        style = MaterialTheme.typography.titleMedium,
        fontWeight = FontWeight.Bold,
    )
}
