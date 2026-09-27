package jp.personal.tasken.companion

import android.content.Context
import androidx.compose.foundation.BorderStroke
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
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
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

@Composable
internal fun AiAvatar(modifier: Modifier = Modifier) {
    Box(
        modifier = modifier
            .size(36.dp)
            .clip(CircleShape)
            .background(MaterialTheme.colorScheme.primaryContainer),
        contentAlignment = Alignment.Center,
    ) {
        Icon(
            painterResource(R.drawable.ic_tabler_sparkles),
            contentDescription = null,
            tint = MaterialTheme.colorScheme.primary,
            modifier = Modifier.size(20.dp),
        )
    }
}

/**
 * タイムラインの1投稿。左にAI、右に「誰が・何をした・いつ」、本文、操作を置く。
 * 新着は左端の点と薄い下地で示し、色だけに頼らず「新着」と読み上げる。
 */
@Composable
internal fun AiPost(
    author: String,
    verb: String,
    at: Instant?,
    isNew: Boolean,
    modifier: Modifier = Modifier,
    onClick: (() -> Unit)? = null,
    highlighted: Boolean = false,
    content: @Composable () -> Unit,
) {
    Surface(
        modifier = modifier
            .fillMaxWidth()
            .then(if (onClick != null) Modifier.semantics { role = Role.Button }.clickable(onClick = onClick) else Modifier),
        shape = RoundedCornerShape(12.dp),
        color = when {
            highlighted -> MaterialTheme.colorScheme.primaryContainer
            isNew -> MaterialTheme.colorScheme.surfaceContainerLow
            else -> MaterialTheme.colorScheme.surface
        },
        border = BorderStroke(1.dp, if (highlighted) MaterialTheme.colorScheme.primary else MaterialTheme.colorScheme.outlineVariant),
    ) {
        Row(
            modifier = Modifier.padding(start = 12.dp, end = 14.dp, top = 12.dp, bottom = 12.dp),
            horizontalArrangement = Arrangement.spacedBy(10.dp),
        ) {
            Box {
                AiAvatar()
                if (isNew) {
                    Box(
                        Modifier
                            .align(Alignment.TopEnd)
                            .size(10.dp)
                            .clip(CircleShape)
                            .background(MaterialTheme.colorScheme.primary)
                            .semantics { },
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
