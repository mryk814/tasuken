package jp.personal.tasken.companion

import androidx.compose.runtime.mutableStateOf
import androidx.compose.foundation.layout.widthIn
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.SemanticsProperties
import androidx.compose.ui.test.SemanticsMatcher
import androidx.compose.ui.test.assert
import androidx.compose.ui.test.assertHeightIsAtLeast
import androidx.compose.ui.test.assertIsOff
import androidx.compose.ui.test.assertIsOn
import androidx.compose.ui.test.assertIsNotEnabled
import androidx.compose.ui.test.assertWidthIsAtLeast
import androidx.compose.ui.test.assertWidthIsEqualTo
import androidx.compose.ui.test.assertTextEquals
import androidx.compose.ui.test.junit4.v2.createComposeRule
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.performClick
import androidx.compose.ui.unit.dp
import org.junit.Assert.assertEquals
import org.junit.Rule
import org.junit.Test

class TaskVisualsUiTest {
    @get:Rule val composeRule = createComposeRule()

    @Test
    fun inlineChecklistKeepsFullAccessibleLabelAndWholeRowToggleWithinCompactWidth() {
        val title = "研究会の参加人数と会場設備を確認する"
        val item = mutableStateOf(MobileChecklistItem("item", title, false, 0.0))
        val enabled = mutableStateOf(true)
        composeRule.setContent {
            TaskenTheme {
                InlineChecklistControl(
                    item.value, enabled.value, Modifier.widthIn(max = 160.dp).testTag("inline-checklist"),
                ) { item.value = item.value.copy(done = !item.value.done) }
            }
        }
        val node = composeRule.onNodeWithTag("inline-checklist")
        node.assert(SemanticsMatcher.expectValue(SemanticsProperties.Role, Role.Checkbox))
            .assertTextEquals(title)
            .assertWidthIsEqualTo(160.dp).assertHeightIsAtLeast(44.dp)
            .assertIsOff().performClick()
        node.assertIsOn()
        composeRule.runOnIdle { enabled.value = false }
        node.assertIsNotEnabled().performClick()
        composeRule.runOnIdle { assertEquals(true, item.value.done) }
    }

    @Test
    fun roundCompletionRetainsCheckboxStateAndAccessibleTouchTarget() {
        val checked = mutableStateOf(false)
        val enabled = mutableStateOf(true)
        composeRule.setContent {
            TaskenTheme {
                TaskCompletionControl(checked.value, { checked.value = it }, enabled.value, Modifier.testTag("completion"))
            }
        }
        val node = composeRule.onNodeWithTag("completion")
        node.assertIsOff().assertWidthIsAtLeast(48.dp).assertHeightIsAtLeast(48.dp).performClick()
        node.assertIsOn()
        composeRule.runOnIdle { enabled.value = false }
        node.assertIsNotEnabled().performClick()
        composeRule.runOnIdle { assertEquals(true, checked.value) }
    }
}
