package jp.personal.tasken.companion

import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.assertTextContains
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performScrollTo
import androidx.compose.ui.test.performTextReplacement
import androidx.test.ext.junit.runners.AndroidJUnit4
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith

@RunWith(AndroidJUnit4::class)
class CaptureDraftRecreationTest {
    @get:Rule
    val composeRule = createAndroidComposeRule<MainActivity>()

    @Test
    fun captureDraftSurvivesActivityRecreation() {
        composeRule.onNodeWithTag("open-capture-action", useUnmergedTree = true).performClick()
        composeRule.onNodeWithText("Task名").performTextReplacement("rotationdraft")

        composeRule.activityRule.scenario.recreate()

        composeRule.onNodeWithTag("capture-text-input").assertTextContains("rotationdraft")
        composeRule.onNodeWithTag("capture-submit-close").performScrollTo().assertIsDisplayed()
    }
}
