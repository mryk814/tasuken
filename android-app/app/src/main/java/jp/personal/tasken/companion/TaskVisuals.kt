package jp.personal.tasken.companion

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.sizeIn
import androidx.compose.foundation.selection.toggleable
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.StrokeJoin
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.graphics.luminance
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.style.TextDecoration
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp

@Composable
internal fun TaskCompletionControl(
    checked: Boolean,
    onCheckedChange: (Boolean) -> Unit,
    enabled: Boolean = true,
    modifier: Modifier = Modifier,
) {
    Box(
        modifier = modifier.sizeIn(minWidth = 48.dp, minHeight = 48.dp)
            .clip(CircleShape)
            .toggleable(value = checked, enabled = enabled, role = Role.Checkbox, onValueChange = onCheckedChange),
        contentAlignment = Alignment.Center,
    ) {
        CompletionMark(checked, enabled, 22.dp)
    }
}

@Composable
internal fun InlineChecklistControl(
    item: MobileChecklistItem,
    enabled: Boolean,
    modifier: Modifier = Modifier,
    onToggle: () -> Unit,
) {
    val textColor = if (item.done) MaterialTheme.colorScheme.onSurfaceVariant else MaterialTheme.colorScheme.onSurface
    Row(
        modifier = modifier.sizeIn(minWidth = 44.dp, minHeight = 44.dp)
            .clip(CircleShape)
            .toggleable(value = item.done, enabled = enabled, role = Role.Checkbox, onValueChange = { onToggle() })
            .semantics(mergeDescendants = true) {}
            .padding(horizontal = 4.dp),
        horizontalArrangement = Arrangement.spacedBy(5.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        CompletionMark(item.done, enabled, 16.dp)
        Text(
            item.title,
            modifier = Modifier.weight(1f, fill = false),
            style = MaterialTheme.typography.labelSmall,
            color = textColor.copy(alpha = if (enabled) 1f else 0.5f),
            textDecoration = if (item.done) TextDecoration.LineThrough else TextDecoration.None,
            maxLines = 1,
            overflow = TextOverflow.Ellipsis,
        )
    }
}

@Composable
private fun CompletionMark(checked: Boolean, enabled: Boolean, diameter: Dp) {
    val dark = MaterialTheme.colorScheme.surface.luminance() < 0.5f
    // Desktop .todo-check-circle uses the design-standard success and border-strong tokens.
    val success = if (dark) Color(0xFF5BB98B) else Color(0xFF2E8B57)
    val border = if (dark) Color(0xFF5E3F43) else Color(0xFFC9A6AA)
    val alpha = if (enabled) 1f else 0.5f
    Canvas(Modifier.size(diameter)) {
        val stroke = size.minDimension * (2f / 22f)
        val radius = size.minDimension / 2 - stroke / 2
        if (checked) {
            drawCircle(success.copy(alpha = alpha), radius = size.minDimension / 2)
            val mark = Path().apply {
                moveTo(size.width * 0.27f, size.height * 0.51f)
                lineTo(size.width * 0.44f, size.height * 0.68f)
                lineTo(size.width * 0.74f, size.height * 0.35f)
            }
            drawPath(mark, Color.White.copy(alpha = alpha), style = Stroke(stroke, cap = StrokeCap.Round, join = StrokeJoin.Round))
        } else {
            drawCircle(border.copy(alpha = alpha), radius = radius, style = Stroke(stroke))
        }
    }
}

@Composable
internal fun ColoredThemeLabel(theme: MobileTheme, modifier: Modifier = Modifier) {
    val scheme = MaterialTheme.colorScheme
    val color = taskenThemeColor(theme.color, dark = scheme.surface.luminance() < 0.5f)
    Surface(
        modifier = modifier,
        shape = CircleShape,
        color = mixSrgb(scheme.surface, color, 0.12f),
        contentColor = scheme.onSurface,
        border = BorderStroke(1.dp, color.copy(alpha = 0.6f)),
    ) {
        Row(
            Modifier.padding(horizontal = 8.dp, vertical = 3.dp),
            horizontalArrangement = Arrangement.spacedBy(5.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Box(Modifier.size(7.dp).background(color, CircleShape))
            Text(theme.title, style = MaterialTheme.typography.labelSmall, maxLines = 1, overflow = TextOverflow.Ellipsis)
        }
    }
}

// Chart values come from design-standard/tokens.css; extra colors match app.css color-mix.
internal fun taskenThemeColor(token: String?, dark: Boolean): Color {
    val chart = if (dark) listOf(
        Color(0xFFD06A78), Color(0xFF67A9D8), Color(0xFF63BD91),
        Color(0xFFDCA45D), Color(0xFF9A8BE0), Color(0xFFB7ABA6),
    ) else listOf(
        Color(0xFF8A2F3B), Color(0xFF2D7FB8), Color(0xFF2E8B57),
        Color(0xFFC77D29), Color(0xFF6D5BC7), Color(0xFF7C746E),
    )
    return when (token?.trim()) {
        "chart-2" -> chart[1]
        "chart-3" -> chart[2]
        "chart-4" -> chart[3]
        "chart-5" -> chart[4]
        "chart-6" -> chart[5]
        "theme-extra-1" -> mixSrgb(chart[0], chart[1], 0.3f)
        "theme-extra-2" -> mixSrgb(chart[1], chart[2], 0.3f)
        "theme-extra-3" -> mixSrgb(chart[2], chart[3], 0.3f)
        "theme-extra-4" -> mixSrgb(chart[4], chart[5], 0.35f)
        else -> chart[0]
    }
}

private fun mixSrgb(start: Color, end: Color, fraction: Float) = Color(
    red = start.red * (1 - fraction) + end.red * fraction,
    green = start.green * (1 - fraction) + end.green * fraction,
    blue = start.blue * (1 - fraction) + end.blue * fraction,
)
