package jp.personal.tasken.companion

import androidx.compose.animation.core.Spring
import androidx.compose.animation.togetherWith
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.core.animateFloat
import androidx.compose.animation.core.spring
import androidx.compose.foundation.ExperimentalFoundationApi
import androidx.compose.foundation.background
import androidx.compose.foundation.combinedClickable
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.interaction.collectIsPressedAsState
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.lazy.LazyListState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.graphics.luminance
import androidx.compose.ui.hapticfeedback.HapticFeedbackType
import androidx.compose.ui.platform.LocalHapticFeedback
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.semantics.CustomAccessibilityAction
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.customActions
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.dp

/** 押している間だけ少し沈む。離すとバネで戻る。 */
@Composable
internal fun Modifier.pressScale(interactionSource: MutableInteractionSource, pressed: Float = 0.97f): Modifier {
    val isPressed by interactionSource.collectIsPressedAsState()
    val scale by animateFloatAsState(
        targetValue = if (isPressed) pressed else 1f,
        animationSpec = spring(dampingRatio = Spring.DampingRatioMediumBouncy, stiffness = Spring.StiffnessMedium),
        label = "press-scale",
    )
    return graphicsLayer {
        scaleX = scale
        scaleY = scale
    }
}

/**
 * 追加の入口を1つにまとめたボタン。押すと書く、長押しで話す。
 * 長押しは読み上げの操作一覧にも出し、隠れた機能にしない。
 */
@OptIn(ExperimentalFoundationApi::class)
@Composable
internal fun ComposeFab(
    onWrite: () -> Unit,
    onSpeak: () -> Unit,
    modifier: Modifier = Modifier,
) {
    val interaction = remember { MutableInteractionSource() }
    val haptics = LocalHapticFeedback.current
    val shape = RoundedCornerShape(18.dp)
    Surface(
        shape = shape,
        color = MaterialTheme.colorScheme.primary,
        contentColor = MaterialTheme.colorScheme.onPrimary,
        shadowElevation = 6.dp,
        modifier = modifier
            .size(64.dp)
            .pressScale(interaction, pressed = 0.9f)
            .clip(shape)
            .combinedClickable(
                interactionSource = interaction,
                indication = androidx.compose.material3.ripple(),
                role = Role.Button,
                onClickLabel = "書いて追加",
                onLongClickLabel = "話して追加",
                onLongClick = {
                    haptics.performHapticFeedback(HapticFeedbackType.LongPress)
                    onSpeak()
                },
                onClick = onWrite,
            )
            .semantics {
                contentDescription = "追加（長押しで話して追加）"
                customActions = listOf(CustomAccessibilityAction("話して追加") { onSpeak(); true })
            }
            .testTag("open-capture-action"),
    ) {
        Box(contentAlignment = Alignment.Center) {
            Icon(painterResource(R.drawable.ic_tabler_plus), contentDescription = null, modifier = Modifier.size(28.dp))
            // 長押しで話せることを小さく示す。
            Icon(
                painterResource(R.drawable.ic_tabler_microphone),
                contentDescription = null,
                modifier = Modifier.align(Alignment.BottomEnd).padding(end = 9.dp, bottom = 9.dp).size(14.dp).alpha(0.8f),
            )
        }
    }
}

/** タブをもう一度押したら先頭へ戻る（Xと同じ手の動き）。 */
data class ScrollToTopRequest(val section: AppSection, val token: Long)

@Composable
internal fun ScrollToTopEffect(
    request: ScrollToTopRequest?,
    section: AppSection,
    listState: LazyListState,
) {
    LaunchedEffect(request) {
        if (request != null && request.section == section) {
            if (listState.firstVisibleItemIndex > 12) listState.scrollToItem(6)
            listState.animateScrollToItem(0)
        }
    }
}

/** タブの並び順へ向かって少しだけ滑らせる。長い移動はさせず、読む位置を乱さない。 */
internal fun sectionTransition(from: AppSection, to: AppSection): androidx.compose.animation.ContentTransform {
    val direction = if (to.ordinal > from.ordinal) 1 else -1
    val motion = spring<androidx.compose.ui.unit.IntOffset>(dampingRatio = Spring.DampingRatioNoBouncy, stiffness = Spring.StiffnessMediumLow)
    val enter = androidx.compose.animation.slideInHorizontally(motion) { it / 10 * direction } +
        androidx.compose.animation.fadeIn(androidx.compose.animation.core.tween(180))
    val exit = androidx.compose.animation.slideOutHorizontally(motion) { -it / 10 * direction } +
        androidx.compose.animation.fadeOut(androidx.compose.animation.core.tween(120))
    return enter togetherWith exit
}

/**
 * つながったリストの角。先頭と末尾だけを大きく丸め、間は小さく丸めて一続きに見せる。
 * 枠線を使わず、面の区切りだけで行を分ける。
 */
internal fun segmentShape(index: Int, count: Int): RoundedCornerShape {
    val outer = 16.dp
    val inner = 4.dp
    val top = if (index == 0) outer else inner
    val bottom = if (index == count - 1) outer else inner
    return RoundedCornerShape(topStart = top, topEnd = top, bottomStart = bottom, bottomEnd = bottom)
}

/** 行の中のTheme。枠を付けず、色の点と名前だけで示す。 */
@Composable
internal fun InlineThemeLabel(theme: MobileTheme, modifier: Modifier = Modifier) {
    val scheme = MaterialTheme.colorScheme
    val color = taskenThemeColor(theme.color, dark = scheme.surface.luminance() < 0.5f)
    androidx.compose.foundation.layout.Row(
        modifier = modifier,
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = androidx.compose.foundation.layout.Arrangement.spacedBy(5.dp),
    ) {
        Box(Modifier.size(7.dp).background(color, CircleShape))
        androidx.compose.material3.Text(
            theme.title,
            style = MaterialTheme.typography.labelMedium,
            color = scheme.onSurfaceVariant,
            maxLines = 1,
            overflow = androidx.compose.ui.text.style.TextOverflow.Ellipsis,
        )
    }
}

/**
 * 入力欄の下の音声ボタン。聞いている間だけ輪が脈打ち、音を拾っていることを示す。
 * 押すたびの意味（始める／確定する）は読み上げにも同じ言葉で伝える。
 */
@Composable
internal fun VoiceToolButton(
    speechState: ShortSpeechUiState,
    hasText: Boolean,
    enabled: Boolean,
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
) {
    val listening = speechState is ShortSpeechUiState.Listening || speechState is ShortSpeechUiState.Partial
    val label = when {
        speechState is ShortSpeechUiState.Processing -> "文字にしています…"
        listening -> "音声を確定"
        hasText -> "話し直す"
        else -> "音声で入力"
    }
    val primary = MaterialTheme.colorScheme.primary
    Box(contentAlignment = Alignment.Center, modifier = modifier.size(48.dp)) {
        if (listening) {
            val pulse = androidx.compose.animation.core.rememberInfiniteTransition(label = "voice-pulse")
            val t by pulse.animateFloat(
                initialValue = 0f,
                targetValue = 1f,
                animationSpec = androidx.compose.animation.core.infiniteRepeatable(
                    androidx.compose.animation.core.tween<Float>(1100, easing = androidx.compose.animation.core.LinearOutSlowInEasing),
                ),
                label = "voice-pulse-t",
            )
            androidx.compose.foundation.Canvas(Modifier.matchParentSize()) {
                drawCircle(primary.copy(alpha = 0.35f * (1f - t)), radius = size.minDimension / 2 * (0.6f + 0.5f * t))
            }
        }
        androidx.compose.material3.FilledIconToggleButton(
            checked = listening,
            onCheckedChange = { onClick() },
            enabled = enabled,
            modifier = Modifier.size(40.dp).semantics { contentDescription = label },
            colors = androidx.compose.material3.IconButtonDefaults.filledIconToggleButtonColors(
                containerColor = androidx.compose.ui.graphics.Color.Transparent,
                contentColor = MaterialTheme.colorScheme.onSurfaceVariant,
                checkedContainerColor = primary,
                checkedContentColor = MaterialTheme.colorScheme.onPrimary,
            ),
        ) {
            Icon(
                painterResource(if (listening) R.drawable.ic_tabler_player_stop else R.drawable.ic_tabler_microphone),
                contentDescription = null,
            )
        }
    }
}

/** 返信欄で話して入力するための口。認識状態と開始・確定の操作を束ねる。 */
internal class ReplyDictation(
    val state: ShortSpeechUiState,
    val start: ((String) -> Unit) -> Unit,
    val stop: () -> Unit,
)
