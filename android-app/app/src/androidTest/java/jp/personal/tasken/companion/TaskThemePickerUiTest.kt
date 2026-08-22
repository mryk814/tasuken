package jp.personal.tasken.companion

import androidx.compose.material3.MaterialTheme
import androidx.compose.runtime.mutableStateOf
import androidx.compose.ui.test.assert
import androidx.compose.ui.test.assertIsEnabled
import androidx.compose.ui.test.assertIsNotEnabled
import androidx.compose.ui.test.assertTextContains
import androidx.compose.ui.test.hasStateDescription
import androidx.compose.ui.test.junit4.v2.createComposeRule
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import org.junit.Assert.assertEquals
import org.junit.Rule
import org.junit.Test

class TaskThemePickerUiTest {
    @get:Rule
    val composeRule = createComposeRule()

    @Test
    fun currentThemeIsVisibleAndSelectingAnotherThemeUpdatesImmediately() {
        var submittedThemeId = ""
        composeRule.setContent {
            MaterialTheme {
                TodayDetailPane(
                    task = sampleTask(themeId = "theme-research"),
                    actionState = TaskActionUiState.Idle,
                    themes = sampleThemes(),
                    onStateAction = {},
                    onThemeUpdate = { _, themeId -> submittedThemeId = themeId },
                )
            }
        }

        composeRule.onNodeWithTag("task-theme-picker")
            .assertIsEnabled()
            .assertTextContains("Research")
            .assert(hasStateDescription("現在のTheme: Research"))
            .performClick()
        composeRule.onNodeWithText("選択中").assertExists()
        composeRule.onNodeWithText("Personal").performClick()

        composeRule.runOnIdle { assertEquals("theme-personal", submittedThemeId) }
    }

    @Test
    fun pendingTaskDisablesThemePicker() {
        composeRule.setContent {
            MaterialTheme {
                TodayDetailPane(
                    task = sampleTask(themeId = "theme-research").copy(pending = true),
                    actionState = TaskActionUiState.Idle,
                    themes = sampleThemes(),
                    onStateAction = {},
                )
            }
        }

        composeRule.onNodeWithTag("task-theme-picker")
            .assertIsNotEnabled()
            .assert(hasStateDescription("同期後に変更"))
    }

    @Test
    fun conflictedTaskDisablesThemePickerAndShowsThemeTitles() {
        composeRule.setContent {
            MaterialTheme {
                TodayDetailPane(
                    task = sampleTask(themeId = "theme-research").copy(
                        conflict = MobileTaskConflict(
                            commandId = "command-theme",
                            intendedAction = "UpdateTask",
                            expectedVersion = 3,
                            serverVersion = 4,
                            serverState = "todo",
                            detectedAt = "2026-08-22T01:00:00Z",
                            serverThemeId = "theme-research",
                            localThemeId = "theme-personal",
                            localThemeIdChanged = true,
                        ),
                    ),
                    actionState = TaskActionUiState.Idle,
                    themes = sampleThemes(),
                    onStateAction = {},
                )
            }
        }

        composeRule.onNodeWithTag("task-theme-picker")
            .assertIsNotEnabled()
            .assert(hasStateDescription("競合を解決してから変更"))
        composeRule.onNodeWithText("Desktop  Theme Research").assertExists()
        composeRule.onNodeWithText("この端末  Theme Personal").assertExists()
    }

    @Test
    fun missingCurrentThemeDoesNotClearItAndAllowsReplacement() {
        var submittedThemeId = ""
        composeRule.setContent {
            MaterialTheme {
                TodayDetailPane(
                    task = sampleTask(themeId = "theme-missing"),
                    actionState = TaskActionUiState.Idle,
                    themes = sampleThemes(),
                    onStateAction = {},
                    onThemeUpdate = { _, themeId -> submittedThemeId = themeId },
                )
            }
        }

        composeRule.onNodeWithTag("task-theme-picker")
            .assertIsEnabled()
            .assertTextContains("Theme情報なし")
            .assert(hasStateDescription("現在のTheme情報なし"))
        composeRule.runOnIdle { assertEquals("", submittedThemeId) }
        composeRule.onNodeWithTag("task-theme-picker").performClick()
        composeRule.onNodeWithText("Personal").performClick()
        composeRule.runOnIdle { assertEquals("theme-personal", submittedThemeId) }
    }

    @Test
    fun emptyCatalogDisablesPickerAndExplainsHowToRecover() {
        composeRule.setContent {
            MaterialTheme {
                TodayDetailPane(
                    task = sampleTask(themeId = "theme-research"),
                    actionState = TaskActionUiState.Idle,
                    themes = emptyList(),
                    onStateAction = {},
                )
            }
        }

        composeRule.onNodeWithTag("task-theme-picker")
            .assertIsNotEnabled()
            .assertTextContains("読み込み中")
            .assert(hasStateDescription("Theme一覧を読み込み中"))
    }

    @Test
    fun staleCatalogStaysEditableAndExplainsQueuedSync() {
        var submittedThemeId = ""
        val themes = sampleThemes()
        composeRule.setContent {
            MaterialTheme {
                TodayDetailPane(
                    task = sampleTask(themeId = "theme-research"),
                    actionState = TaskActionUiState.Idle,
                    themes = themes,
                    themeCatalogState = MobileThemeCatalogState.Stale(
                        themes = themes,
                        serverId = "server",
                        serverRevision = 12,
                        generatedAt = "2026-08-22T01:00:00Z",
                        message = "offline",
                    ),
                    onStateAction = {},
                    onThemeUpdate = { _, themeId -> submittedThemeId = themeId },
                )
            }
        }

        composeRule.onNodeWithTag("task-theme-picker")
            .assertIsEnabled()
            .assert(hasStateDescription("オフラインのTheme一覧を使用中"))
            .performClick()
        composeRule.onNodeWithText("Personal").performClick()
        composeRule.onNodeWithText("Theme一覧はオフラインです。変更は送信待ちになります。").assertExists()
        composeRule.runOnIdle { assertEquals("theme-personal", submittedThemeId) }
    }

    @Test
    fun unsupportedCatalogKeepsTaskUsableAndExplainsDesktopUpdate() {
        composeRule.setContent {
            MaterialTheme {
                TodayDetailPane(
                    task = sampleTask(themeId = "theme-research"),
                    actionState = TaskActionUiState.Idle,
                    themes = emptyList(),
                    themeCatalogState = MobileThemeCatalogState.Unsupported(
                        serverId = "server",
                        message = "not_found",
                    ),
                    onStateAction = {},
                )
            }
        }

        composeRule.onNodeWithTag("task-theme-picker")
            .assertIsNotEnabled()
            .assertTextContains("未対応")
            .assert(hasStateDescription("このDesktopではTheme編集を利用できません"))
        composeRule.onNodeWithText("Desktopを更新するとThemeを変更できます。").assertExists()
        composeRule.onNodeWithText("完了する").assertExists()
    }

    @Test
    fun catalogErrorShowsRecoveryWithoutInventingThemeData() {
        composeRule.setContent {
            MaterialTheme {
                TodayDetailPane(
                    task = sampleTask(themeId = null),
                    actionState = TaskActionUiState.Idle,
                    themes = emptyList(),
                    themeCatalogState = MobileThemeCatalogState.Error(
                        serverId = "server",
                        message = "upstream_unavailable",
                    ),
                    onStateAction = {},
                )
            }
        }

        composeRule.onNodeWithTag("task-theme-picker")
            .assertIsNotEnabled()
            .assertTextContains("取得できません")
            .assert(hasStateDescription("Theme一覧を取得できません"))
        composeRule.onNodeWithText("接続を確認して再試行してください。").assertExists()
    }

    @Test
    fun rejectedThemeShowsCauseAndSupportsReselectOrDiscard() {
        var discardedCommandId = ""
        val rejectedTask = sampleTask(themeId = "theme-research").copy(
            rejectedThemeUpdate = MobileRejectedThemeUpdate(
                commandId = "rejected-command",
                attemptedThemeId = "theme-personal",
                code = "theme_not_found",
                message = "選択したThemeは削除済みか利用できません。",
                rejectedAt = "2026-08-22T02:00:00Z",
            ),
        )
        composeRule.setContent {
            MaterialTheme {
                TodayDetailPane(
                    task = rejectedTask,
                    actionState = TaskActionUiState.Idle,
                    themes = sampleThemes(),
                    onStateAction = {},
                    onRejectedThemeDiscard = { discardedCommandId = requireNotNull(it.rejectedThemeUpdate).commandId },
                )
            }
        }

        composeRule.onNodeWithTag("theme-rejection").assertExists()
        composeRule.onNodeWithText("選択したThemeは削除済みか利用できません。").assertExists()
        composeRule.onNodeWithTag("theme-rejection-reselect").assertIsEnabled().performClick()
        composeRule.onNodeWithText("Personal").assertExists().performClick()
        composeRule.onNodeWithTag("theme-rejection-discard").assertIsEnabled().performClick()
        composeRule.runOnIdle { assertEquals("rejected-command", discardedCommandId) }
    }

    @Test
    fun rejectedThemeStillAllowsDiscardWhenCatalogCannotReselect() {
        val rejectedTask = sampleTask(themeId = "theme-research").copy(
            rejectedThemeUpdate = MobileRejectedThemeUpdate(
                commandId = "rejected-command",
                attemptedThemeId = "theme-personal",
                code = "theme_not_found",
                message = "選択したThemeは削除済みか利用できません。",
                rejectedAt = "2026-08-22T02:00:00Z",
            ),
        )
        composeRule.setContent {
            MaterialTheme {
                TodayDetailPane(
                    task = rejectedTask,
                    actionState = TaskActionUiState.Idle,
                    themes = emptyList(),
                    themeCatalogState = MobileThemeCatalogState.Unsupported("server", "unsupported"),
                    onStateAction = {},
                )
            }
        }

        composeRule.onNodeWithTag("theme-rejection-reselect").assertIsNotEnabled()
        composeRule.onNodeWithTag("theme-rejection-discard").assertIsEnabled()
    }

    @Test
    fun openThemePickerSurvivesParentRecomposition() {
        val recompositionTrigger = mutableStateOf(0)
        composeRule.setContent {
            recompositionTrigger.value
            MaterialTheme {
                TodayDetailPane(
                    task = sampleTask(themeId = "theme-research"),
                    actionState = TaskActionUiState.Idle,
                    themes = sampleThemes(),
                    onStateAction = {},
                )
            }
        }
        composeRule.onNodeWithTag("task-theme-picker").performClick()
        composeRule.onNodeWithText("Personal").assertExists()

        composeRule.runOnIdle { recompositionTrigger.value += 1 }

        composeRule.onNodeWithText("Personal").assertExists()
    }

    private fun sampleThemes() = listOf(
        MobileTheme("theme-personal", "Personal"),
        MobileTheme("theme-research", "Research"),
    )

    private fun sampleTask(themeId: String?) = MobileTask(
        id = "10000000-0000-4000-8000-000000000001",
        title = "Task",
        themeId = themeId,
        state = "todo",
        workState = null,
        updatedAt = "2026-08-21T09:00:00.000Z",
    )
}
