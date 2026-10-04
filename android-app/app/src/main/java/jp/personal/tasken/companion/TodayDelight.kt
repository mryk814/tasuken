package jp.personal.tasken.companion

import androidx.compose.animation.AnimatedContent
import androidx.compose.animation.animateContentSize
import androidx.compose.animation.core.Animatable
import androidx.compose.animation.core.FastOutSlowInEasing
import androidx.compose.animation.core.Spring
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.core.spring
import androidx.compose.animation.core.tween
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.slideInVertically
import androidx.compose.animation.slideOutVertically
import androidx.compose.animation.togetherWith
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.gestures.detectHorizontalDragGestures
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.graphics.luminance
import androidx.compose.ui.hapticfeedback.HapticFeedbackType
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.layout.onSizeChanged
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.platform.LocalHapticFeedback
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.semantics.CustomAccessibilityAction
import androidx.compose.ui.semantics.customActions
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.IntOffset
import androidx.compose.ui.unit.dp
import java.time.LocalDate
import java.time.format.DateTimeFormatter
import java.util.Locale
import kotlin.math.PI
import kotlin.math.abs
import kotlin.math.cos
import kotlin.math.roundToInt
import kotlin.math.sin
import kotlinx.coroutines.launch

/** Todayの進み具合。取り消し済みは分母に入れない。 */
internal data class TodayProgress(val done: Int, val total: Int) {
    val remaining: Int get() = total - done
    val allDone: Boolean get() = total > 0 && done == total
    val fraction: Float get() = if (total == 0) 0f else done.toFloat() / total
}

internal fun todayProgress(tasks: List<MobileTask>): TodayProgress {
    val counted = tasks.filter { it.state != "cancelled" }
    return TodayProgress(done = counted.count { it.state == "done" }, total = counted.size)
}

/**
 * Todayの冒頭。今日の仕事の残りを主役にし、正常な同期状態は小さな表示へまとめる。
 * 端末保存のみ・再接続が必要な状態は、理由と復旧操作を常に見える位置に残す。
 */
@Composable
internal fun TodayProgressHeader(
    tasks: List<MobileTask>,
    cached: TodayUiState.Cached?,
    refreshing: Boolean,
    generatedAt: String,
    onRetry: () -> Unit,
    onRetryPairing: () -> Unit,
    /** 一覧をスクロールしている間は縮め、縦の余白を一覧へ返す。 */
    collapsed: Boolean = false,
) {
    val progress = todayProgress(tasks)
    // 表示中に「全部完了」へ変わった時だけ祝う。開き直し・再描画・同期受信では再演しない。
    var celebratedAllDone by rememberSaveable { mutableStateOf(progress.allDone) }
    var celebrationEventId by remember { mutableStateOf<Long?>(null) }
    val haptics = LocalHapticFeedback.current
    LaunchedEffect(progress.allDone) {
        if (progress.allDone && !celebratedAllDone) {
            celebrationEventId = System.nanoTime()
            haptics.performHapticFeedback(HapticFeedbackType.Confirm)
        }
        celebratedAllDone = progress.allDone
    }
    Column(
        modifier = Modifier
            .fillMaxWidth()
            .animateContentSize()
            .padding(start = 16.dp, end = 12.dp, top = if (collapsed) 4.dp else 8.dp, bottom = 4.dp),
        verticalArrangement = Arrangement.spacedBy(if (collapsed) 4.dp else 6.dp),
    ) {
        // 状態の札が出入りしても高さを変えない（一覧の位置を動かさず、誤タップを防ぐ）。
        Row(verticalAlignment = Alignment.CenterVertically, modifier = Modifier.heightIn(min = 48.dp)) {
            Column(modifier = Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(0.dp)) {
                // 「今日やること」と日付は上部バーに置く。ここは残りの数から始める。
                AnimatedContent(
                    targetState = progress,
                    transitionSpec = {
                        (slideInVertically { it / 2 } + fadeIn()) togetherWith (slideOutVertically { -it / 2 } + fadeOut())
                    },
                    label = "today-remaining",
                ) { current ->
                    Text(
                        when {
                            current.total == 0 -> "今日の予定はまだありません"
                            current.allDone -> "ぜんぶ完了！おつかれさま"
                            else -> "あと${current.remaining}件"
                        },
                        style = if (collapsed) MaterialTheme.typography.titleMedium else MaterialTheme.typography.headlineSmall,
                        fontWeight = FontWeight.Bold,
                        maxLines = 1,
                        overflow = TextOverflow.Ellipsis,
                    )
                }
            }
            // 正常な同期は上部の雲の印に任せる。端末保存だけの間は、理由と復旧をここにも残す。
            if (cached != null) {
                TodaySyncPill(
                    cached = cached,
                    refreshing = refreshing,
                    generatedAt = generatedAt,
                    onClick = if (cached.recovery == TodayUiState.CachedRecovery.RePair) onRetryPairing else onRetry,
                )
            }
        }
        if (progress.total > 0) {
            Box {
                TodayProgressBar(progress)
                CompletionBurst(celebrationEventId, Modifier.matchParentSize(), particles = 18, spread = 1.8f)
            }
        }
        // 同期の理由がある時だけ文を出す。行の高さは1行に固定し、一覧の位置を動かさない（誤タップ防止）。
        Text(
            when {
                cached != null -> cached.message
                refreshing -> "PCの最新状態を確認しています"
                else -> ""
            },
            modifier = Modifier.fillMaxWidth(),
            style = MaterialTheme.typography.labelSmall,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
            minLines = 1,
            maxLines = 1,
            overflow = TextOverflow.Ellipsis,
        )
    }
}

@Composable
private fun TodayProgressBar(progress: TodayProgress) {
    val dark = MaterialTheme.colorScheme.surface.luminance() < 0.5f
    val fraction by animateFloatAsState(
        targetValue = progress.fraction,
        animationSpec = spring(dampingRatio = Spring.DampingRatioMediumBouncy, stiffness = Spring.StiffnessLow),
        label = "today-progress",
    )
    val fill = if (progress.allDone) taskenSuccessColor(dark) else MaterialTheme.colorScheme.primary
    Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(10.dp)) {
        Box(
            modifier = Modifier
                .weight(1f)
                .height(8.dp)
                .clip(CircleShape)
                .background(MaterialTheme.colorScheme.surfaceContainerHighest),
        ) {
            Box(
                Modifier
                    .fillMaxHeight()
                    .fillMaxWidth(fraction.coerceIn(0f, 1f))
                    .clip(CircleShape)
                    .background(fill),
            )
        }
        Text(
            "${progress.done}/${progress.total}",
            style = MaterialTheme.typography.labelMedium,
            fontWeight = FontWeight.SemiBold,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
        )
    }
}

/** 正常時は一行の小さな状態。押すと再読み込み（引っぱって更新と同じ）。 */
@Composable
private fun TodaySyncPill(
    cached: TodayUiState.Cached?,
    refreshing: Boolean,
    generatedAt: String,
    onClick: () -> Unit,
) {
    val dark = MaterialTheme.colorScheme.surface.luminance() < 0.5f
    val dot = when {
        refreshing -> MaterialTheme.colorScheme.tertiary
        cached != null -> MaterialTheme.colorScheme.onSurfaceVariant
        generatedAt.isNotBlank() -> taskenSuccessColor(dark)
        else -> MaterialTheme.colorScheme.outline
    }
    Surface(
        shape = RoundedCornerShape(50),
        color = MaterialTheme.colorScheme.surfaceContainer,
        modifier = Modifier
            .heightIn(min = 48.dp)
            .clip(RoundedCornerShape(50))
            .clickable(enabled = !refreshing, onClickLabel = if (cached?.recovery == TodayUiState.CachedRecovery.RePair) "再接続" else "再読み込み", onClick = onClick),
    ) {
        Row(
            modifier = Modifier.padding(horizontal = 12.dp, vertical = 6.dp),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(6.dp),
        ) {
            Box(Modifier.size(8.dp).clip(CircleShape).background(dot))
            Column {
                Text(
                    when {
                        cached != null -> "端末に保存済み"
                        refreshing -> "PCと同期中"
                        generatedAt.isNotBlank() -> "PC同期済み"
                        else -> "同期状態未確認"
                    },
                    style = MaterialTheme.typography.labelSmall,
                    fontWeight = FontWeight.SemiBold,
                    maxLines = 1,
                )
                if (cached?.recovery == TodayUiState.CachedRecovery.RePair) {
                    Text(
                        "再接続",
                        style = MaterialTheme.typography.labelSmall,
                        color = MaterialTheme.colorScheme.primary,
                        fontWeight = FontWeight.SemiBold,
                        maxLines = 1,
                    )
                } else {
                    Text(
                        generatedAt.takeIf { it.isNotBlank() }?.let { "最終同期 ${formatLocalTimestamp(it).substringAfter(' ')}" }
                            ?: "最終同期 未確認",
                        style = MaterialTheme.typography.labelSmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                        maxLines = 1,
                    )
                }
            }
        }
    }
}

/** 完了の瞬間に一度だけ広がる輪と粒。eventIdが変わった時だけ再生する。 */
@Composable
internal fun CompletionBurst(
    eventId: Long?,
    modifier: Modifier = Modifier,
    particles: Int = 8,
    spread: Float = 1f,
) {
    val progress = remember { Animatable(1f) }
    LaunchedEffect(eventId) {
        if (eventId == null) return@LaunchedEffect
        progress.snapTo(0f)
        progress.animateTo(1f, tween(durationMillis = 520, easing = FastOutSlowInEasing))
    }
    val dark = MaterialTheme.colorScheme.surface.luminance() < 0.5f
    val colors = listOf(
        taskenSuccessColor(dark),
        MaterialTheme.colorScheme.primary,
        if (dark) Color(0xFFDCA45D) else Color(0xFFC77D29),
    )
    Canvas(modifier) {
        val t = progress.value
        if (t >= 1f) return@Canvas
        val base = size.minDimension / 2
        val center = Offset(size.width / 2, size.height / 2)
        val fade = 1f - t
        if (spread <= 1f) {
            drawCircle(
                colors[0].copy(alpha = 0.45f * fade),
                radius = base * (0.5f + 0.7f * t),
                center = center,
                style = Stroke(width = 3.dp.toPx() * fade),
            )
        }
        repeat(particles) { index ->
            val angle = (2 * PI * index / particles + PI / particles * (index % 2)).toFloat()
            // 横長の領域（進捗バー）では、幅に沿って散らす。
            val reachX = if (spread > 1f) size.width / 2 * (0.2f + 0.8f * t) else base * (0.6f + 0.9f * t)
            val reachY = if (spread > 1f) base * spread * 3f * t else base * (0.6f + 0.9f * t)
            val jitter = if (index % 3 == 0) 0.8f else 1f
            drawCircle(
                colors[index % colors.size].copy(alpha = fade),
                radius = 3.dp.toPx() * (1f - 0.6f * t),
                center = Offset(
                    center.x + cos(angle) * reachX * jitter,
                    center.y + sin(angle) * reachY * jitter,
                ),
            )
        }
    }
}

/**
 * 行を横に払う操作。右へ払うと完了（または戻す）、左へ払うと予定日の移動。
 * 閾値を越えた時に触覚を返し、指を離した時だけ実行する。行は元の位置へ戻る。
 */
@Composable
internal fun SwipeTaskActions(
    completeLabel: String?,
    onComplete: () -> Unit,
    rescheduleLabel: String?,
    onReschedule: () -> Unit,
    modifier: Modifier = Modifier,
    content: @Composable () -> Unit,
) {
    val density = LocalDensity.current
    val haptics = LocalHapticFeedback.current
    val scope = rememberCoroutineScope()
    val offset = remember { Animatable(0f) }
    var width by remember { mutableStateOf(1) }
    val threshold = with(density) { 96.dp.toPx() }.coerceAtMost(width * 0.35f)
    var armed by remember { mutableStateOf(false) }
    val dark = MaterialTheme.colorScheme.surface.luminance() < 0.5f
    val actions = buildList {
        completeLabel?.let { add(CustomAccessibilityAction(it) { onComplete(); true }) }
        rescheduleLabel?.let { add(CustomAccessibilityAction(it) { onReschedule(); true }) }
    }
    Box(
        modifier = modifier
            .onSizeChanged { width = it.width.coerceAtLeast(1) }
            .semantics { if (actions.isNotEmpty()) customActions = actions },
    ) {
        val value = offset.value
        if (value != 0f) {
            val toRight = value > 0
            val reached = abs(value) >= threshold
            Row(
                modifier = Modifier
                    .matchParentSize()
                    .clip(RoundedCornerShape(12.dp))
                    .background(
                        when {
                            toRight && reached -> taskenSuccessColor(dark)
                            toRight -> taskenSuccessColor(dark).copy(alpha = 0.35f)
                            reached -> MaterialTheme.colorScheme.primary
                            else -> MaterialTheme.colorScheme.primary.copy(alpha = 0.35f)
                        },
                    )
                    .padding(horizontal = 20.dp),
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = if (toRight) Arrangement.Start else Arrangement.End,
            ) {
                val icon = if (toRight) R.drawable.ic_tabler_circle_check else R.drawable.ic_tabler_sun
                val progress = (abs(value) / threshold).coerceIn(0f, 1f)
                if (!toRight) Text(rescheduleLabel.orEmpty(), color = Color.White, fontWeight = FontWeight.SemiBold)
                if (!toRight) Spacer(Modifier.width(8.dp))
                Icon(
                    painterResource(icon),
                    contentDescription = null,
                    tint = Color.White,
                    modifier = Modifier.size((18 + 8 * progress).dp),
                )
                if (toRight) Spacer(Modifier.width(8.dp))
                if (toRight) Text(completeLabel.orEmpty(), color = Color.White, fontWeight = FontWeight.SemiBold)
            }
        }
        Box(
            modifier = Modifier
                .offset { IntOffset(offset.value.roundToInt(), 0) }
                .pointerInput(completeLabel, rescheduleLabel) {
                    detectHorizontalDragGestures(
                        onDragEnd = {
                            val current = offset.value
                            if (abs(current) >= threshold) {
                                if (current > 0) onComplete() else onReschedule()
                            }
                            armed = false
                            scope.launch { offset.animateTo(0f, spring(dampingRatio = Spring.DampingRatioMediumBouncy)) }
                        },
                        onDragCancel = {
                            armed = false
                            scope.launch { offset.animateTo(0f) }
                        },
                    ) { change, dragAmount ->
                        val next = offset.value + dragAmount
                        val allowed = when {
                            next > 0 && completeLabel == null -> 0f
                            next < 0 && rescheduleLabel == null -> 0f
                            // 閾値を越えた先は抵抗を付けて、払いすぎを防ぐ。
                            abs(next) > threshold -> offset.value + dragAmount * 0.35f
                            else -> next
                        }
                        if (allowed != offset.value) change.consume()
                        val nowArmed = abs(allowed) >= threshold
                        if (nowArmed && !armed) haptics.performHapticFeedback(HapticFeedbackType.SegmentTick)
                        armed = nowArmed
                        scope.launch { offset.snapTo(allowed) }
                    }
                },
        ) { content() }
    }
}
