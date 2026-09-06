package jp.personal.tasken.companion

import androidx.compose.runtime.mutableStateOf
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.safeDrawingPadding
import androidx.compose.material3.Surface
import androidx.compose.material3.MaterialTheme
import androidx.compose.ui.Modifier
import androidx.compose.ui.test.assertIsFocused
import androidx.compose.ui.test.assertIsNotEnabled
import androidx.compose.ui.test.assertIsOn
import androidx.compose.ui.test.assertTextContains
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performImeAction
import androidx.compose.ui.test.performTextReplacement
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Rule
import org.junit.Test

class TaskInlineEditingUiTest {
    @get:Rule val composeRule = createComposeRule()

    @Test fun titleTapFocusesInPlaceAndFailureKeepsInputForRetry() {
        val current = mutableStateOf(task())
        val action = mutableStateOf<TaskActionUiState>(TaskActionUiState.Idle)
        var submitted = ""
        composeRule.setContent {
            TaskenTheme {
                TodayDetailPane(current.value, action.value, onStateAction = {},
                    onTitleUpdate = { _, title -> submitted = title })
            }
        }
        composeRule.onNodeWithTag("task-title-display").performClick()
        composeRule.onNodeWithTag("task-title").assertIsFocused().performTextReplacement("帰りに牛乳とコーヒー豆を買う")
        composeRule.onNodeWithTag("task-title").performImeAction()
        composeRule.runOnIdle {
            assertEquals("帰りに牛乳とコーヒー豆を買う", submitted)
            action.value = TaskActionUiState.Error("inline", "保存できませんでした")
        }
        composeRule.onNodeWithTag("task-title").assertTextContains(submitted)
        capture("detail-edit-error")
        composeRule.onNodeWithText("Task名を保存").performClick()
        composeRule.runOnIdle {
            current.value = current.value.copy(title = submitted)
            action.value = TaskActionUiState.Idle
        }
        composeRule.onNodeWithTag("task-title").assertDoesNotExist()
        composeRule.onNodeWithTag("task-title-display").assertTextContains(submitted)
        capture("detail-saved")
    }

    @Test fun checklistCanCompleteInListWithoutOpeningDetailAndRespectsSaving() {
        val current = mutableStateOf(task().copy(checklistItems = listOf(
            MobileChecklistItem("milk", "低脂肪乳を買う", false, 0.0),
            MobileChecklistItem("coffee", "いつもの深煎りコーヒー豆を買う", true, 1.0),
            MobileChecklistItem("soap", "洗剤の残りが少なければ買う", false, 2.0),
            MobileChecklistItem("egg", "卵", false, 3.0),
        )))
        val action = mutableStateOf<TaskActionUiState>(TaskActionUiState.Idle)
        var opened = false
        val dark = mutableStateOf(true)
        composeRule.setContent {
            TaskenTheme {
                MaterialTheme(colorScheme = if (dark.value) taskenDarkColorScheme() else taskenLightColorScheme()) {
                Surface(modifier = Modifier.fillMaxSize().safeDrawingPadding()) {
                TodayTaskList(listOf(current.value, task().copy(id = "research", title = "試料の測定条件を確認する", themeId = "lab")), TodayPaneState(), { opened = true },
                    themes = listOf(MobileTheme("life", "暮らし", "chart-2"), MobileTheme("lab", "研究・材料評価", "chart-4")), actionState = action.value,
                    onTaskStateAction = {}, onChecklistUpdate = { _, items ->
                        current.value = current.value.copy(checklistItems = items)
                    })
                }
                }
            }
        }
        composeRule.onNodeWithTag("task-list-checklist-inline-milk").performClick().assertIsOn()
        composeRule.runOnIdle {
            assertEquals(false, opened)
            assertNotNull(current.value.checklistItems.first().completedAt)
        }
        composeRule.onNodeWithText("ほか1項目").assertExists()
        capture("list-checklist")
        composeRule.runOnIdle { dark.value = false }
        capture("list-checklist-light")
        composeRule.runOnIdle { action.value = TaskActionUiState.Saving("inline") }
        composeRule.onNodeWithTag("task-list-checklist-inline-milk").assertIsNotEnabled()
        composeRule.onNodeWithText("ほか1項目").performClick()
        composeRule.runOnIdle { assertEquals(true, opened) }
    }

    private fun task() = MobileTask(
        id = "inline", title = "帰りに牛乳・コーヒー豆を買う", themeId = "life", state = "todo",
        workState = "not_delegated", updatedAt = "2026-09-06T00:00:00Z",
    )

    private fun capture(name: String) {
        composeRule.waitForIdle()
        val instrumentation = androidx.test.platform.app.InstrumentationRegistry.getInstrumentation()
        val directory = java.io.File(instrumentation.targetContext.getExternalFilesDir(null), "ux-inline").apply { mkdirs() }
        val screenshot = checkNotNull(instrumentation.uiAutomation.takeScreenshot())
        java.io.File(directory, "$name.png").outputStream().use {
            check(screenshot.compress(android.graphics.Bitmap.CompressFormat.PNG, 100, it))
        }
        screenshot.recycle()
    }
}
