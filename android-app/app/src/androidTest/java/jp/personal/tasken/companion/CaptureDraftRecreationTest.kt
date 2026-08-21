package jp.personal.tasken.companion

import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performTextInput
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
        composeRule.onNodeWithText("追加").performClick()
        composeRule.onNodeWithText("Task名").performTextInput("rotationdraft")

        composeRule.activityRule.scenario.recreate()

        composeRule.onNodeWithText("Taskを追加").assertIsDisplayed()
        composeRule.onNodeWithText("rotationdraft").assertIsDisplayed()
    }
}
