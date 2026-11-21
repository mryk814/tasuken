package jp.personal.tasken.companion

import android.provider.Settings
import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.core.Animatable
import androidx.compose.animation.core.CubicBezierEasing
import androidx.compose.animation.core.EaseIn
import androidx.compose.animation.core.EaseInOut
import androidx.compose.animation.core.EaseOut
import androidx.compose.animation.core.LinearEasing
import androidx.compose.animation.core.keyframes
import androidx.compose.animation.core.tween
import androidx.compose.animation.expandVertically
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.shrinkVertically
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.LocalContentColor
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.rotate
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.StrokeJoin
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch

/**
 * 提案を決める型の動き（#774。Desktop の lib/decisionMotion.ts と同じ数）。
 *
 * - 採る: 本人の判（傾けた角丸四角の輪郭にチェック。色は文字の色）が 1.6 倍・-13° から 200ms で降り、
 *   0.92 まで沈んで戻る。カードも 0.96 まで沈む。降りた後 380ms 止まり、240ms で薄れ、200ms で詰まる。
 * - 見送る: 判なしで右へ 48dp・2.5°、240ms で流れ、200ms で詰まる。
 * - 取り消した・届かなかった: 採ったなら判を押したまま戻ってから判が浮いて消え、見送ったなら右から戻る。
 * - 動きを減らす設定（アニメーションの長さ 0）: 採るは判を 500ms 置くだけ、見送る・戻るは動かさない。
 *
 * [decision] は持っている（または届いた）決定。null に戻ったらカードが戻る。
 */
@Composable
internal fun DecisionMotion(
    decision: String?,
    modifier: Modifier = Modifier,
    content: @Composable () -> Unit,
) {
    val reduceMotion = rememberReduceMotion()
    val density = LocalDensity.current
    val cardScale = remember { Animatable(1f) }
    val cardAlpha = remember { Animatable(1f) }
    val shift = remember { Animatable(0f) }
    val tilt = remember { Animatable(0f) }
    val sealScale = remember { Animatable(1f) }
    val sealAlpha = remember { Animatable(0f) }
    val sealLift = remember { Animatable(0f) }
    var shown by remember { mutableStateOf(decision == null) }
    var previous by remember { mutableStateOf(decision) }
    LaunchedEffect(decision) {
        val before = previous
        previous = decision
        if (decision != null) {
            if (!shown) return@LaunchedEffect
            if (decision == "accept") {
                if (reduceMotion) {
                    sealScale.snapTo(1f)
                    sealAlpha.snapTo(1f)
                    delay(500)
                    shown = false
                    return@LaunchedEffect
                }
                sealScale.snapTo(1.6f)
                sealAlpha.snapTo(0f)
                sealLift.snapTo(0f)
                coroutineScope {
                    launch {
                        cardScale.animateTo(1f, keyframes {
                            durationMillis = 200
                            0.96f at 140 using EaseOut
                        })
                    }
                    launch {
                        sealAlpha.animateTo(1f, keyframes {
                            durationMillis = 200
                            0f at 0 using CubicBezierEasing(.5f, 0f, .9f, .4f)
                            1f at 140
                        })
                    }
                    sealScale.animateTo(1f, keyframes {
                        durationMillis = 200
                        1.6f at 0 using CubicBezierEasing(.5f, 0f, .9f, .4f)
                        0.92f at 140 using EaseOut
                    })
                }
                delay(380)
                sealAlpha.snapTo(0.6f)
                cardAlpha.animateTo(0f, tween(240, easing = EaseIn))
            } else if (!reduceMotion) {
                coroutineScope {
                    launch { shift.animateTo(48f, tween(240, easing = EaseIn)) }
                    launch { tilt.animateTo(2.5f, tween(240, easing = EaseIn)) }
                    cardAlpha.animateTo(0f, tween(240, easing = EaseIn))
                }
            }
            shown = false
        } else if (before != null) {
            // 取り消した・届かなかった: カードが戻る。
            cardScale.snapTo(1f)
            if (reduceMotion) {
                cardAlpha.snapTo(1f)
                shift.snapTo(0f)
                tilt.snapTo(0f)
                sealAlpha.snapTo(0f)
                shown = true
                return@LaunchedEffect
            }
            if (before == "accept") {
                cardAlpha.snapTo(1f)
                shift.snapTo(0f)
                tilt.snapTo(0f)
                sealScale.snapTo(1f)
                sealLift.snapTo(0f)
                sealAlpha.snapTo(1f)
                shown = true
                delay(200)
                coroutineScope {
                    launch { sealScale.animateTo(1.25f, tween(240, easing = EaseIn)) }
                    launch { sealLift.animateTo(-14f, tween(240, easing = EaseIn)) }
                    sealAlpha.animateTo(0f, tween(240, easing = EaseIn))
                }
            } else {
                sealAlpha.snapTo(0f)
                shift.snapTo(48f)
                tilt.snapTo(2.5f)
                cardAlpha.snapTo(0f)
                shown = true
                delay(200)
                coroutineScope {
                    launch { shift.animateTo(0f, tween(240, easing = EaseOut)) }
                    launch { tilt.animateTo(0f, tween(240, easing = EaseOut)) }
                    cardAlpha.animateTo(1f, tween(240, easing = EaseOut))
                }
            }
        }
    }
    AnimatedVisibility(
        visible = shown,
        modifier = modifier,
        enter = expandVertically(tween(200, easing = EaseInOut), expandFrom = Alignment.Top),
        exit = shrinkVertically(tween(200, easing = EaseInOut), shrinkTowards = Alignment.Top),
    ) {
        Box(
            Modifier.graphicsLayer {
                alpha = cardAlpha.value
                scaleX = cardScale.value
                scaleY = cardScale.value
                translationX = shift.value * density.density
                rotationZ = tilt.value
            },
        ) {
            content()
            if (sealAlpha.value > 0f) {
                DecisionSeal(
                    Modifier
                        .align(Alignment.TopEnd)
                        .padding(top = 10.dp, end = 12.dp)
                        .graphicsLayer {
                            rotationZ = -13f
                            scaleX = sealScale.value
                            scaleY = sealScale.value
                            alpha = sealAlpha.value
                            translationY = sealLift.value * density.density
                        }
                        .testTag("decision-seal"),
                )
            }
        }
    }
}

/** 本人の判。角丸四角の輪郭にチェック、色は文字の色（赤は誤りと要確認の色なので使わない）。 */
@Composable
private fun DecisionSeal(modifier: Modifier = Modifier) {
    val ink = MaterialTheme.colorScheme.onSurface
    Box(
        modifier
            .size(44.dp)
            .background(MaterialTheme.colorScheme.surface.copy(alpha = 0.85f), RoundedCornerShape(10.dp))
            .border(3.dp, ink, RoundedCornerShape(10.dp)),
        contentAlignment = Alignment.Center,
    ) {
        CheckMark(ink, 28.dp, 3.dp)
    }
}

@Composable
private fun CheckMark(color: Color, size: Dp, stroke: Dp) {
    Canvas(Modifier.size(size)) {
        val unit = this.size.width / 24f
        val path = Path().apply {
            moveTo(5f * unit, 12.5f * unit)
            lineTo(9.5f * unit, 17f * unit)
            lineTo(19f * unit, 7.5f * unit)
        }
        drawPath(path, color, style = Stroke(stroke.toPx(), cap = StrokeCap.Round, join = StrokeJoin.Round))
    }
}

/**
 * 決めた帯（#774）。押した印（採った＝判、見送った＝灰の横棒）と結果の文と「取り消す」、
 * 下に 5 秒で尽きる線。トーストと同じ位置に出す。動きを減らす設定では線を動かさない。
 */
@Composable
internal fun DecisionBand(
    band: HeldProposalDecision?,
    onUndo: (HeldProposalDecision) -> Unit,
    modifier: Modifier = Modifier,
    holdMillis: Long = PROPOSAL_DECISION_HOLD_MILLIS,
) {
    val reduceMotion = rememberReduceMotion()
    var shownBand by remember { mutableStateOf(band) }
    if (band != null) shownBand = band
    AnimatedVisibility(visible = band != null, modifier = modifier, enter = fadeIn(), exit = fadeOut()) {
        val current = shownBand ?: return@AnimatedVisibility
        Surface(
            color = MaterialTheme.colorScheme.inverseSurface,
            contentColor = MaterialTheme.colorScheme.inverseOnSurface,
            shape = RoundedCornerShape(8.dp),
            shadowElevation = 6.dp,
            modifier = Modifier
                .statusBarsPadding()
                .padding(horizontal = 16.dp, vertical = 8.dp)
                .widthIn(max = 560.dp)
                .fillMaxWidth()
                .testTag("decision-band"),
        ) {
            Box {
                Row(
                    modifier = Modifier.padding(start = 16.dp, end = 8.dp, top = 8.dp, bottom = 14.dp),
                    horizontalArrangement = Arrangement.spacedBy(12.dp),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    val ink = LocalContentColor.current
                    if (current.decision == "accept") {
                        Box(
                            Modifier
                                .size(22.dp)
                                .rotate(-13f)
                                .border(2.dp, ink, RoundedCornerShape(6.dp))
                                .testTag("decision-band-mark-adopt"),
                            contentAlignment = Alignment.Center,
                        ) {
                            CheckMark(ink, 16.dp, 2.5.dp)
                        }
                    } else {
                        Box(
                            Modifier
                                .width(22.dp)
                                .height(3.dp)
                                .background(ink.copy(alpha = 0.53f), RoundedCornerShape(2.dp))
                                .testTag("decision-band-mark-dismiss"),
                        )
                    }
                    Text(
                        if (current.decision == "accept") "提案を採りました。" else "提案を見送りました。",
                        modifier = Modifier.weight(1f),
                        fontWeight = FontWeight.Medium,
                    )
                    // 帯の地の上で読める色にする（えんじの inversePrimary は暗い地で沈む）。手本と同じ淡い丸の地。
                    TextButton(
                        onClick = { onUndo(current) },
                        shape = RoundedCornerShape(50),
                        colors = ButtonDefaults.textButtonColors(
                            containerColor = ink.copy(alpha = 0.13f),
                            contentColor = ink,
                        ),
                        modifier = Modifier.testTag("decision-undo"),
                    ) {
                        Text("取り消す", fontWeight = FontWeight.Bold)
                    }
                }
                val left = remember(current.commandId) {
                    val elapsed = (System.currentTimeMillis() - current.pressedAtMillis).coerceIn(0L, holdMillis)
                    Animatable(1f - elapsed.toFloat() / holdMillis)
                }
                LaunchedEffect(current.commandId, reduceMotion) {
                    if (!reduceMotion) left.animateTo(0f, tween((left.value * holdMillis).toInt(), easing = LinearEasing))
                }
                val ink = LocalContentColor.current
                Box(
                    Modifier
                        .align(Alignment.BottomStart)
                        .padding(start = 22.dp, end = 22.dp, bottom = 5.dp)
                        .fillMaxWidth(if (reduceMotion) 1f else left.value)
                        .height(2.dp)
                        .background(ink.copy(alpha = 0.53f), RoundedCornerShape(2.dp))
                        .testTag("decision-band-line"),
                )
            }
        }
    }
}

/** 端末の「アニメーションを無効にする」（アニメーションの長さ 0）。 */
@Composable
private fun rememberReduceMotion(): Boolean {
    val context = LocalContext.current
    return remember(context) {
        Settings.Global.getFloat(context.contentResolver, Settings.Global.ANIMATOR_DURATION_SCALE, 1f) == 0f
    }
}
