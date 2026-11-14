package jp.personal.tasken.companion

import androidx.compose.material3.MaterialTheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.ReadOnlyComposable
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.drawWithContent
import androidx.compose.ui.geometry.CornerRadius
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.PathEffect
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.graphics.luminance
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp

/*
 * 色は「誰が」、線は「決まったか」。
 * 藍は AI が書いたもの・AI の提案だけ。tertiary（情報の浅葱）は送信待ちや更新中など AI 以外にも使うので、
 * 藍は Material の役割に混ぜず、ここに別に持つ。値は design-standard/tokens.json の ai 系（試験が比べる）。
 * 点線は未決（機械が拾った候補・本人がまだ答えていない提案）、実線は決まったもの。
 */

data class TaskenAiColors(val ai: Color, val aiStrong: Color, val aiBg: Color, val aiBd: Color)

object TaskenAiColorTokens {
    val light = mapOf(
        "ai" to TokenColorReference("ai", "#2F4B8A"),
        "aiStrong" to TokenColorReference("aiStrong", "#243C72"),
        "aiBg" to TokenColorReference("aiBg", "#E3E8F3"),
        "aiBd" to TokenColorReference("aiBd", "#B9C6E0"),
    )
    val dark = mapOf(
        "ai" to TokenColorReference("ai", "#8FA6DC"),
        "aiStrong" to TokenColorReference("aiStrong", "#B3C3E8"),
        "aiBg" to TokenColorReference("aiBg", "#1D2638"),
        "aiBd" to TokenColorReference("aiBd", "#34446A"),
    )
}

private fun Map<String, TokenColorReference>.toAiColors(): TaskenAiColors {
    fun role(name: String) = Color(0xFF000000 or getValue(name).hex.removePrefix("#").toLong(16))
    return TaskenAiColors(role("ai"), role("aiStrong"), role("aiBg"), role("aiBd"))
}

private val LightAiColors = TaskenAiColorTokens.light.toAiColors()
private val DarkAiColors = TaskenAiColorTokens.dark.toAiColors()

/** いまの表示（明るい・暗い）に合う藍。テーマの地の明るさで決めるので、どのテーマの下でも使える。 */
@Composable
@ReadOnlyComposable
internal fun taskenAiColors(): TaskenAiColors =
    if (MaterialTheme.colorScheme.background.luminance() < 0.5f) DarkAiColors else LightAiColors

/**
 * 未決の印の点線。[visualHeight] は、押せる範囲より見た目が小さい部品（Chip）で、見た目の高さに線を合わせる時に渡す。
 */
internal fun Modifier.dashedOutline(
    color: Color,
    cornerRadius: Dp,
    width: Dp = 1.dp,
    visualHeight: Dp? = null,
): Modifier = drawWithContent {
    // 面を持つ部品（Card）は自分の面を上から塗るので、線は中身の後に描く。
    drawContent()
    val stroke = width.toPx()
    val height = (visualHeight?.toPx() ?: size.height).coerceAtMost(size.height)
    val dash = 4.dp.toPx()
    drawRoundRect(
        color = color,
        topLeft = Offset(stroke / 2, (size.height - height) / 2 + stroke / 2),
        size = Size(size.width - stroke, height - stroke),
        cornerRadius = CornerRadius(cornerRadius.toPx()),
        style = Stroke(width = stroke, pathEffect = PathEffect.dashPathEffect(floatArrayOf(dash, dash))),
    )
}
