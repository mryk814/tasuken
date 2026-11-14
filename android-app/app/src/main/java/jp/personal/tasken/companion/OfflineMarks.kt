package jp.personal.tasken.companion

import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.requiredSize
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.ReadOnlyComposable
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.drawBehind
import androidx.compose.ui.draw.rotate
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.PathFillType
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.StrokeJoin
import androidx.compose.ui.graphics.drawscope.DrawScope
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.graphics.drawscope.scale
import androidx.compose.ui.graphics.luminance
import androidx.compose.ui.graphics.vector.PathParser
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.PlatformTextStyle
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.LineHeightStyle
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import java.time.Instant
import java.time.ZoneId
import java.time.format.DateTimeFormatter

/*
 * つながらない時の見せ方の型（割印と日付印）。
 * 状態は、それが当てはまる物の上に印で示す。丸い印は時刻、四角い印は本人、墨の面は戻ってきた物。印が言うことは文にしない。
 *
 * 寸法と形は共通の意匠の決まり（src/renderer/src/styles/ishou/offline.css の頭の寸法表。px は dp と読む）のとおり。
 * 形は元絵の path をそのまま持つ。大きくする時は [scale] だけ変える（比は変えない）。
 *
 * 色: 写しの日付印は補足の墨、未送信の割印は朱、「!」と「戻」は墨の面に紙色の字。藍は使わない。
 * 点線は使わない（点線は候補だけ）。
 */

/** 朱（本人の印）と薄い墨（割印の右半分の輪郭）。値は共通の色の写し（src/renderer/src/styles/ishou/tokens.css）と同じ（試験が比べる）。 */
internal data class TaskenOfflineColors(val seal: Color, val inkFaint: Color)

internal object TaskenOfflineColorTokens {
    val light = mapOf("seal" to "#B4472F", "ink-faint" to "#9A948A")
    val dark = mapOf("seal" to "#E08A72", "ink-faint" to "#6D675F")
}

private fun Map<String, String>.toOfflineColors(): TaskenOfflineColors {
    fun role(name: String) = Color(0xFF000000 or getValue(name).removePrefix("#").toLong(16))
    return TaskenOfflineColors(role("seal"), role("ink-faint"))
}

private val LightOfflineColors = TaskenOfflineColorTokens.light.toOfflineColors()
private val DarkOfflineColors = TaskenOfflineColorTokens.dark.toOfflineColors()

@Composable
@ReadOnlyComposable
internal fun taskenOfflineColors(): TaskenOfflineColors =
    if (MaterialTheme.colorScheme.background.luminance() < 0.5f) DarkOfflineColors else LightOfflineColors

/** 割印の左半分（16×30）。朱の面から「[」の彫りを抜く。 */
private const val WARI_HALF_PATH =
    "M6 0h10v30H6a6 6 0 0 1-6-6V6a6 6 0 0 1 6-6zM5 8v14a2 2 0 0 0 2 2h4v-2H7V8h4V6H7a2 2 0 0 0-2 2z"

/** 割印の右半分の輪郭（32×30 の升目の右側、線 1.5）。 */
private const val WARI_REST_PATH = "M16 .75h10A5.25 5.25 0 0 1 31.25 6v18A5.25 5.25 0 0 1 26 29.25H16"

/** 電波なしの絵（24 の升目、線 1.8、端は丸）。扇形の電波に斜線。 */
private const val NOWAVE_PATH = "M5 12.5a10 10 0 0 1 14 0M8.5 16a5 5 0 0 1 7 0M12 19.5h.01M3 3l18 18"

private fun parsePath(data: String, evenOdd: Boolean = false) =
    PathParser().parsePathString(data).toPath().apply { if (evenOdd) fillType = PathFillType.EvenOdd }

private fun DrawScope.drawWariHalf(path: androidx.compose.ui.graphics.Path, seal: Color, unit: Float) {
    scale(unit, unit, pivot = Offset.Zero) { drawPath(path, seal) }
}

/**
 * 割印（未送信）。左の半分は朱の面、右の半分は薄い墨の輪郭。32×30、-5° 傾ける。
 * [description] を渡さない時は飾りとして読み上げない（そばの字が同じことを言う時）。
 */
@Composable
internal fun OflWari(modifier: Modifier = Modifier, scale: Float = 1f, description: String? = "未送信") {
    val colors = taskenOfflineColors()
    val half = remember { parsePath(WARI_HALF_PATH, evenOdd = true) }
    val rest = remember { parsePath(WARI_REST_PATH) }
    Canvas(
        modifier
            .size(32.dp * scale, 30.dp * scale)
            .rotate(-5f)
            .markSemantics(description),
    ) {
        val unit = size.width / 32f
        drawWariHalf(half, colors.seal, unit)
        scale(unit, unit, pivot = Offset.Zero) { drawPath(rest, colors.inkFaint, style = Stroke(width = 1.5f)) }
    }
}

/**
 * 行の端の割印。左半分だけ（16×30、傾きなし）を、行やカードの右の端に付ける（端が切れ目）。
 * 親は右に 20dp ほど余白を取り、字や押す所と重ねない。親が角を丸めて切り抜いていれば、印も一緒に切れる。
 */
@Composable
internal fun OflWariEdge(modifier: Modifier = Modifier, description: String? = "未送信") {
    val colors = taskenOfflineColors()
    val half = remember { parsePath(WARI_HALF_PATH, evenOdd = true) }
    Canvas(modifier.size(16.dp, 30.dp).markSemantics(description)) {
        drawWariHalf(half, colors.seal, size.width / 16f)
    }
}

/** 数つきの割印（「未送信 3」の 3）。 */
@Composable
internal fun OflCount(count: Int, modifier: Modifier = Modifier, scale: Float = 1f) {
    Row(
        modifier = modifier.clearAndSetSemantics { contentDescription = "未送信 $count" },
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(4.dp),
    ) {
        OflWari(scale = scale, description = null)
        Text(
            "$count",
            style = MaterialTheme.typography.labelLarge.copy(fontFeatureSettings = "tnum"),
            fontWeight = FontWeight.ExtraBold,
            color = MaterialTheme.colorScheme.onSurface,
        )
    }
}

/** 「!」（直すと送れる）。直径 20 の墨の丸に紙色の「!」。割印の右に 4 あけて置く。 */
@Composable
internal fun OflBang(modifier: Modifier = Modifier, description: String? = "直すと送れる") {
    val ink = MaterialTheme.colorScheme.onSurface
    val paper = MaterialTheme.colorScheme.surface
    Canvas(modifier.size(20.dp).markSemantics(description)) {
        val unit = size.width / 20f
        drawCircle(ink)
        drawLine(paper, Offset(10f * unit, 5.2f * unit), Offset(10f * unit, 11.2f * unit), 2.2f * unit, StrokeCap.Round)
        drawLine(paper, Offset(10f * unit, 14.8f * unit), Offset(10f * unit, 14.81f * unit), 2.2f * unit, StrokeCap.Round)
    }
}

/** 「戻」（受け取られなかった）。22×22、角の丸み 3 の墨の面に紙色の字、+4° 傾ける。 */
@Composable
internal fun OflModo(modifier: Modifier = Modifier, description: String? = "受け取られなかった") {
    val density = LocalDensity.current
    Box(
        modifier
            .size(22.dp)
            .rotate(4f)
            .background(MaterialTheme.colorScheme.onSurface, RoundedCornerShape(3.dp))
            .markSemantics(description),
        contentAlignment = Alignment.Center,
    ) {
        // 印の字は印の大きさと一緒に決まる。文字の大きさの設定で字だけ伸びると面からはみ出すので、dp で持つ。
        Text(
            "戻",
            color = MaterialTheme.colorScheme.surface,
            style = TextStyle(
                fontSize = with(density) { 12.dp.toSp() },
                lineHeight = with(density) { 12.dp.toSp() },
                fontWeight = FontWeight.Bold,
                platformStyle = PlatformTextStyle(includeFontPadding = false),
                lineHeightStyle = LineHeightStyle(LineHeightStyle.Alignment.Center, LineHeightStyle.Trim.None),
            ),
            modifier = Modifier.clearAndSetSemantics {},
        )
    }
}

/** 電波なしの絵（つながらない）。18×18。色は添える字と同じにする。 */
@Composable
internal fun OflNowave(modifier: Modifier = Modifier, color: Color = MaterialTheme.colorScheme.onSurfaceVariant, description: String? = null) {
    val path = remember { parsePath(NOWAVE_PATH) }
    Canvas(modifier.size(18.dp).markSemantics(description)) {
        val unit = size.width / 24f
        scale(unit, unit, pivot = Offset.Zero) {
            drawPath(path, color, style = Stroke(width = 1.8f, cap = StrokeCap.Round, join = StrokeJoin.Round))
        }
    }
}

/**
 * 日付印（丸い印＝時刻）。直径 56、輪郭 1.5、-7° 傾ける。上の語は「写し」か「届いた」、中は日付、下は時刻。
 * [scale] で印ごと小さくできる（見出しが縮んだ時）。押せる範囲は呼ぶ側が決める。
 */
@Composable
internal fun OflStamp(label: String, at: Instant, modifier: Modifier = Modifier, scale: Float = 1f, zone: ZoneId = ZoneId.systemDefault()) {
    val color = MaterialTheme.colorScheme.onSurfaceVariant
    val density = LocalDensity.current
    val date = STAMP_DATE.withZone(zone).format(at)
    val time = STAMP_TIME.withZone(zone).format(at)
    // 印の字は印の大きさと一緒に決まる（文字の大きさの設定で字だけ伸びると円からはみ出す）ので、dp で持つ。
    fun style(size: Float, weight: FontWeight) = with(density) {
        TextStyle(
            fontSize = (size * scale).dp.toSp(),
            lineHeight = (size * scale).dp.toSp(),
            fontWeight = weight,
            textAlign = TextAlign.Center,
            fontFeatureSettings = "tnum",
            color = color,
            // 字の上下の余白を切り、印の中の決まった位置に置く。
            platformStyle = PlatformTextStyle(includeFontPadding = false),
            lineHeightStyle = LineHeightStyle(LineHeightStyle.Alignment.Center, LineHeightStyle.Trim.Both),
        )
    }
    Box(
        modifier
            .requiredSize(56.dp * scale)
            .rotate(-7f)
            .drawBehind {
                val unit = size.width / 56f
                val stroke = 1.5f * unit
                drawCircle(color, radius = 27.25f * unit, style = Stroke(stroke))
                // 中の帯の上下の線（円の中だけ）。
                drawLine(color, Offset(2.5f * unit, 18.5f * unit), Offset(53.5f * unit, 18.5f * unit), stroke)
                drawLine(color, Offset(2.5f * unit, 37.5f * unit), Offset(53.5f * unit, 37.5f * unit), stroke)
            }
            .clearAndSetSemantics { contentDescription = "$label $date $time" },
    ) {
        Text(label, style = style(10f, FontWeight.Bold), modifier = Modifier.align(Alignment.TopCenter).stampOffset(4.5f * scale))
        Text(date, style = style(12.5f, FontWeight.ExtraBold), modifier = Modifier.align(Alignment.Center))
        Text(time, style = style(10f, FontWeight.Bold), modifier = Modifier.align(Alignment.BottomCenter).stampOffset(-6f * scale))
    }
}

private fun Modifier.stampOffset(y: Float): Modifier = offset(y = y.dp)

private fun Modifier.markSemantics(description: String?): Modifier =
    if (description == null) clearAndSetSemantics {} else semantics { contentDescription = description }

private val STAMP_DATE: DateTimeFormatter = DateTimeFormatter.ofPattern("M.d")
private val STAMP_TIME: DateTimeFormatter = DateTimeFormatter.ofPattern("H:mm")

/** 「3 時間前」。古さは印の横の文で読ませる。 */
internal fun stampAgeLabel(at: Instant, now: Instant = Instant.now(), zone: ZoneId = ZoneId.systemDefault()): String =
    relativeTimeLabel(at, now, zone)
