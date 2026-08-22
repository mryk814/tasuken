package jp.personal.tasken.companion

import androidx.compose.material3.adaptive.ExperimentalMaterial3AdaptiveApi
import androidx.compose.material3.adaptive.layout.PaneScaffoldDirective
import androidx.compose.ui.geometry.Rect
import androidx.compose.ui.unit.dp
import org.junit.Assert.assertEquals
import org.junit.Test

@OptIn(ExperimentalMaterial3AdaptiveApi::class)
class TaskenAdaptiveDirectiveTest {
    @Test
    fun unfoldedFoldWidthEnablesTwoHorizontalPanes() {
        val directive = taskenPaneScaffoldDirective(
            base = PaneScaffoldDirective.Default,
            windowWidth = 750.dp,
        )

        assertEquals(2, directive.maxHorizontalPartitions)
    }

    @Test
    fun narrowWindowKeepsTheOfficialDirective() {
        val base = PaneScaffoldDirective.Default.copy(
            horizontalPartitionSpacerSize = 12.dp,
        )

        assertEquals(base, taskenPaneScaffoldDirective(base, 699.dp))
    }

    @Test
    fun expandedOverridePreservesHingeExclusionsAndSpacing() {
        val excludedBounds = listOf(Rect(360f, 0f, 390f, 900f))
        val base = PaneScaffoldDirective.Default.copy(
            horizontalPartitionSpacerSize = 18.dp,
            excludedBounds = excludedBounds,
        )
        val directive = taskenPaneScaffoldDirective(base, 750.dp)

        assertEquals(2, directive.maxHorizontalPartitions)
        assertEquals(18.dp, directive.horizontalPartitionSpacerSize)
        assertEquals(excludedBounds, directive.excludedBounds)
    }
}
