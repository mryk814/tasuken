package jp.personal.tasken.companion

import androidx.compose.animation.core.Spring
import androidx.compose.animation.togetherWith
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.core.spring
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
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
import androidx.compose.runtime.setValue
import androidx.compose.ui.semantics.LiveRegionMode
import androidx.compose.ui.semantics.liveRegion
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.graphics.luminance
import androidx.compose.ui.hapticfeedback.HapticFeedbackType
import androidx.compose.ui.platform.LocalHapticFeedback
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
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
 * 追加の入口（書いて追加）。音声入力は別のアプリ（yamabiko）が受け持つので、ここには置かない（#808）。
 * 押している間だけ少し沈み、押した瞬間に軽い触覚を返す。
 */
@Composable
internal fun ComposeFab(
    onWrite: () -> Unit,
    modifier: Modifier = Modifier,
) {
    val shape = RoundedCornerShape(20.dp)
    val description = "書いて追加"
    val interaction = remember { MutableInteractionSource() }
    val haptics = LocalHapticFeedback.current
    Surface(
        shape = shape,
        color = MaterialTheme.colorScheme.primary,
        contentColor = MaterialTheme.colorScheme.onPrimary,
        shadowElevation = 6.dp,
        modifier = modifier,
    ) {
        Box(
            contentAlignment = Alignment.Center,
            modifier = Modifier
                .testTag("open-capture-action")
                .size(60.dp)
                .pressScale(interaction, pressed = 0.86f)
                .clip(shape)
                .clickable(
                    interactionSource = interaction,
                    indication = androidx.compose.material3.ripple(),
                    role = Role.Button,
                    onClickLabel = description,
                ) {
                    haptics.performHapticFeedback(HapticFeedbackType.ContextClick)
                    onWrite()
                }
                .semantics { contentDescription = description },
        ) {
            Icon(painterResource(R.drawable.ic_tabler_plus), contentDescription = null, modifier = Modifier.size(26.dp))
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
 * 端末への保存が済んだ瞬間だけ出る小さな印。押印のように一度弾んで、少し経つと消える。
 * 保存前・送信前には出さない（呼び出し側が永続保存の後に eventKey を渡す）。
 */
@Composable
internal fun SavedStamp(
    eventKey: Any?,
    text: String = "端末に保存しました",
    onShown: () -> Unit = {},
    modifier: Modifier = Modifier,
) {
    var visible by androidx.compose.runtime.remember { androidx.compose.runtime.mutableStateOf(false) }
    LaunchedEffect(eventKey) {
        if (eventKey == null) return@LaunchedEffect
        visible = true
        kotlinx.coroutines.delay(1800)
        visible = false
        onShown()
    }
    val dark = MaterialTheme.colorScheme.surface.luminance() < 0.5f
    val success = taskenSuccessColor(dark)
    androidx.compose.animation.AnimatedVisibility(
        visible = visible,
        modifier = modifier,
        enter = androidx.compose.animation.scaleIn(
            spring(dampingRatio = 0.45f, stiffness = 500f),
            initialScale = 1.4f,
        ) + androidx.compose.animation.fadeIn(),
        exit = androidx.compose.animation.fadeOut(androidx.compose.animation.core.tween(240)),
    ) {
        Surface(
            shape = RoundedCornerShape(50),
            color = success.copy(alpha = 0.12f),
            contentColor = success,
            border = androidx.compose.foundation.BorderStroke(1.dp, success.copy(alpha = 0.6f)),
            modifier = Modifier.semantics { liveRegion = LiveRegionMode.Polite },
        ) {
            androidx.compose.foundation.layout.Row(
                modifier = Modifier.padding(horizontal = 10.dp, vertical = 4.dp),
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = androidx.compose.foundation.layout.Arrangement.spacedBy(4.dp),
            ) {
                Icon(painterResource(R.drawable.ic_tabler_circle_check), contentDescription = null, modifier = Modifier.size(16.dp))
                androidx.compose.material3.Text(text, style = MaterialTheme.typography.labelMedium, fontWeight = androidx.compose.ui.text.font.FontWeight.SemiBold)
            }
        }
    }
}

/**
 * いま追加した行を一度だけ明るくし、ゆっくり元の面へ戻す。
 * どこに入ったかを目で追えるようにする。
 */
@Composable
internal fun rememberJustAddedTint(highlighted: Boolean): androidx.compose.ui.graphics.Color {
    val amount = remember { androidx.compose.animation.core.Animatable(0f) }
    LaunchedEffect(highlighted) {
        if (highlighted) {
            amount.snapTo(1f)
            kotlinx.coroutines.delay(400)
            amount.animateTo(0f, androidx.compose.animation.core.tween(1400))
        }
    }
    return MaterialTheme.colorScheme.primary.copy(alpha = 0.16f * amount.value)
}
