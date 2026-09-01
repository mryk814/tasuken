package jp.personal.tasken.companion

import android.content.res.Configuration
import android.graphics.Bitmap
import android.os.SystemClock
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.safeDrawingPadding
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.mutableStateOf
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalConfiguration
import androidx.compose.ui.test.assertCountEquals
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.assertIsNotEnabled
import androidx.compose.ui.test.junit4.v2.createComposeRule
import androidx.compose.ui.test.onAllNodesWithText
import androidx.compose.ui.test.onNodeWithContentDescription
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.test.platform.app.InstrumentationRegistry
import java.io.File
import org.junit.Assert.assertEquals
import org.junit.Rule
import org.junit.Test

class TaskListContextUiTest {
    @get:Rule
    val composeRule = createComposeRule()

    @Test
    fun todayListKeepsBaselineContextAndSelectionInLightAndDarkThemes() {
        val pane = TodayPaneState()
        var selectedTaskId: String? = null
        var stateActionTaskId: String? = null
        val tasks = listOf(
            task(
                id = "10000000-0000-4000-8000-000000000101",
                title = "実験結果を整理して、次回の打ち合わせで比較条件を確認する",
                themeId = "theme-research",
                state = "todo",
            ),
            task(
                id = "10000000-0000-4000-8000-000000000102",
                title = "今週の個人業務を送信待ちのまま安全に見直す",
                themeId = "theme-personal",
                state = "doing",
                pending = true,
            ),
        )
        val themes = listOf(
            MobileTheme(
                "theme-research",
                "研究プロジェクトの長いテーマ名を一覧で省略しながら読めるようにする" +
                    "・比較実験のログと改善メモ、関連する資料をまとめて管理する",
            ),
            MobileTheme("theme-personal", "個人業務"),
        )
        val lightConfiguration = Configuration(
            InstrumentationRegistry.getInstrumentation().targetContext.resources.configuration,
        ).apply {
            uiMode = (uiMode and Configuration.UI_MODE_NIGHT_MASK.inv()) or Configuration.UI_MODE_NIGHT_NO
        }
        val darkConfiguration = Configuration(
            InstrumentationRegistry.getInstrumentation().targetContext.resources.configuration,
        ).apply {
            uiMode = (uiMode and Configuration.UI_MODE_NIGHT_MASK.inv()) or Configuration.UI_MODE_NIGHT_YES
        }
        val configuration = mutableStateOf(lightConfiguration)

        composeRule.setContent {
            CompositionLocalProvider(LocalConfiguration provides configuration.value) {
                TaskenTheme {
                    ListSurface {
                        TodayTaskList(
                            tasks = tasks,
                            paneState = pane,
                            onTaskSelected = { selectedTaskId = it },
                            themes = themes,
                            actionState = TaskActionUiState.Idle,
                            onTaskStateAction = { stateActionTaskId = it.id },
                        )
                    }
                }
            }
        }

        composeRule.onNodeWithText(tasks[0].title).assertIsDisplayed()
        composeRule.onNodeWithText(themes[0].title, substring = true).assertIsDisplayed()
        composeRule.onNodeWithText("送信待ち").assertIsDisplayed()
        composeRule.onNodeWithContentDescription("${tasks[1].title}は同期後に操作").assertIsNotEnabled()
        capture("06-task-list-context-light")
        composeRule.onNodeWithContentDescription("${tasks[0].title}を完了").performClick()
        composeRule.runOnIdle {
            assertEquals(tasks[0].id, stateActionTaskId)
            assertEquals(null, selectedTaskId)
        }
        composeRule.onNodeWithText(tasks[0].title).performClick()
        composeRule.runOnIdle { assertEquals(tasks[0].id, selectedTaskId) }
        composeRule.runOnIdle { configuration.value = darkConfiguration }
        composeRule.onNodeWithText(tasks[1].title).assertIsDisplayed()
        capture("07-task-list-context-dark")
    }

    @Test
    fun taskListUsesUnfinishedDoneAndAllFiltersWithThemeNames() {
        val pane = TodayPaneState()
        val tasks = listOf(
            task("task-todo", "未着手 Task", "theme-research", "todo"),
            task("task-doing", "進行中 Task", "theme-research", "doing"),
            task("task-waiting", "待機中 Task", "theme-personal", "waiting"),
            task("task-review", "確認中 Task", "theme-personal", "review"),
            task("task-done", "完了 Task", "theme-research", "done"),
        )
        val themes = listOf(
            MobileTheme("theme-research", "研究"),
            MobileTheme("theme-personal", "個人業務"),
        )

        composeRule.setContent {
            TaskenTheme {
                ListSurface {
                    TasksListPane(
                        uiState = TodayUiState.Cached(
                            tasks = tasks,
                            generatedAt = "2026-08-31T00:00:00Z",
                            message = "保存済みTaskを表示中です。Desktopへ再接続してください。",
                            recovery = TodayUiState.CachedRecovery.RePair,
                        ),
                        tasks = tasks,
                        themes = themes,
                        paneState = pane,
                        onRetry = {},
                        onRetryPairing = {},
                        onPair = { _, _ -> },
                        onTaskSelected = {},
                        actionState = TaskActionUiState.Idle,
                        onTaskStateAction = {},
                    )
                }
            }
        }

        composeRule.onNodeWithText("未完了").assertIsDisplayed()
        composeRule.onNodeWithText("保存済みTaskを表示中です。Desktopへ再接続してください。").assertIsDisplayed()
        composeRule.onNodeWithText("接続をやり直す").assertIsDisplayed()
        composeRule.onNodeWithText("未着手 Task").assertIsDisplayed()
        composeRule.onNodeWithText("進行中 Task").assertIsDisplayed()
        composeRule.onNodeWithText("待機中 Task").assertIsDisplayed()
        composeRule.onNodeWithText("確認中 Task").assertIsDisplayed()
        composeRule.onNodeWithText("完了 Task").assertDoesNotExist()
        composeRule.onAllNodesWithText("研究").assertCountEquals(2)
        composeRule.onAllNodesWithText("個人業務").assertCountEquals(2)
        capture("08-task-list-context-todo")

        composeRule.onNodeWithText("完了").performClick()
        composeRule.onNodeWithText("完了 Task").assertIsDisplayed()
        composeRule.onNodeWithText("未着手 Task").assertDoesNotExist()

        composeRule.onNodeWithText("すべて").performClick()
        composeRule.onNodeWithText("未着手 Task").assertIsDisplayed()
        composeRule.onNodeWithText("進行中 Task").assertIsDisplayed()
        composeRule.onNodeWithText("待機中 Task").assertIsDisplayed()
        composeRule.onNodeWithText("確認中 Task").assertIsDisplayed()
        composeRule.onNodeWithText("完了 Task").assertIsDisplayed()
    }

    @Test
    fun aiInboxShowsThemeNamesForTaskAndProposal() {
        val pane = TodayPaneState()
        val aiTask = task(
            id = "task-ai",
            title = "AIが進めているTask",
            themeId = "theme-research",
            state = "doing",
            workState = "in_progress",
        )
        val proposal = MobileTaskWorkProposal(
            id = "proposal-1",
            version = 1,
            taskId = "task-proposal",
            taskVersion = 1,
            taskTitle = "確認待ちの提案",
            themeId = "theme-personal",
            workState = "in_progress",
            action = "report_done",
            caller = "Hermes",
            sourceApp = "hermes-discord",
            receivedAt = "2026-08-31T00:00:00Z",
            expectedTaskVersion = 1,
            stale = false,
            executorLabel = "Hermes",
            startedAt = null,
            reportedAt = "2026-08-31T00:00:00Z",
            summary = null,
            completedItems = emptyList(),
            changedOrCreatedItems = emptyList(),
            verification = emptyList(),
            remainingWork = emptyList(),
            externalReferences = emptyList(),
            truncated = false,
        )
        val themes = listOf(
            MobileTheme("theme-research", "研究"),
            MobileTheme("theme-personal", "個人業務"),
        )

        composeRule.setContent {
            TaskenTheme {
                ListSurface {
                    AiInboxListPane(
                        uiState = TodayUiState.Success(listOf(aiTask), "2026-08-31T00:00:00Z"),
                        tasks = listOf(aiTask),
                        themes = themes,
                        proposals = listOf(proposal),
                        paneState = pane,
                        onRetry = {},
                        onRetryPairing = {},
                        onPair = { _, _ -> },
                        onTaskSelected = {},
                    )
                }
            }
        }

        composeRule.onNodeWithText(aiTask.title).assertIsDisplayed()
        composeRule.onNodeWithText(proposal.taskTitle).assertIsDisplayed()
        composeRule.onNodeWithText("研究").assertIsDisplayed()
        composeRule.onNodeWithText("個人業務").assertIsDisplayed()
        capture("09-task-list-context-ai")
    }

    @Test
    fun unknownThemeIdStaysHiddenUntilCatalogArrivesAndTaskRemainsSelectable() {
        val pane = TodayPaneState()
        val catalog = mutableStateOf(emptyList<MobileTheme>())
        val task = task(
            id = "task-later",
            title = "後からThemeが届くTask",
            themeId = "theme-later",
            state = "todo",
        )
        val taskWithoutTheme = task(
            id = "task-without-theme",
            title = "ThemeなしのTask",
            themeId = null,
            state = "doing",
        )
        var selectedTaskId: String? = null

        composeRule.setContent {
            TaskenTheme {
                ListSurface {
                    TodayTaskList(
                        tasks = listOf(task, taskWithoutTheme),
                        paneState = pane,
                        onTaskSelected = { selectedTaskId = it },
                        themes = catalog.value,
                        actionState = TaskActionUiState.Idle,
                        onTaskStateAction = {},
                    )
                }
            }
        }

        composeRule.onNodeWithText("theme-later").assertDoesNotExist()
        composeRule.onNodeWithText("後から届くTheme").assertDoesNotExist()
        composeRule.onNodeWithText("Themeなし").assertDoesNotExist()
        composeRule.onNodeWithText(task.title).performClick()
        composeRule.runOnIdle { assertEquals(task.id, selectedTaskId) }
        composeRule.onNodeWithText(taskWithoutTheme.title).performClick()
        composeRule.runOnIdle { assertEquals(taskWithoutTheme.id, selectedTaskId) }
        composeRule.runOnIdle {
            catalog.value = listOf(MobileTheme("theme-later", "後から届くTheme"))
        }
        composeRule.onNodeWithText("後から届くTheme").assertIsDisplayed()
        composeRule.onNodeWithText(task.title).performClick()
        composeRule.runOnIdle { assertEquals(task.id, selectedTaskId) }
    }

    private fun task(
        id: String,
        title: String,
        themeId: String?,
        state: String,
        workState: String? = null,
        pending: Boolean = false,
    ) = MobileTask(
        id = id,
        title = title,
        themeId = themeId,
        state = state,
        workState = workState,
        updatedAt = "2026-08-31T00:00:00Z",
        pending = pending,
    )

    @Composable
    private fun ListSurface(content: @Composable () -> Unit) {
        Surface(
            modifier = Modifier.fillMaxSize().safeDrawingPadding(),
            color = MaterialTheme.colorScheme.surface,
            content = content,
        )
    }

    private fun capture(name: String) {
        composeRule.waitForIdle()
        SystemClock.sleep(250)
        composeRule.waitForIdle()
        val instrumentation = InstrumentationRegistry.getInstrumentation()
        val directory = File(instrumentation.targetContext.getExternalFilesDir(null), "ux-audit")
        check(directory.isDirectory || directory.mkdirs())
        val screenshot = checkNotNull(instrumentation.uiAutomation.takeScreenshot())
        File(directory, "$name.png").outputStream().use {
            check(screenshot.compress(Bitmap.CompressFormat.PNG, 100, it))
        }
        screenshot.recycle()
    }
}
