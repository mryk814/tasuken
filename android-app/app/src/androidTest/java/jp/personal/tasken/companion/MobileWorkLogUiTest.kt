package jp.personal.tasken.companion

import android.content.Context
import android.content.ContextWrapper
import android.graphics.Bitmap
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.remember
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.v2.createComposeRule
import androidx.test.platform.app.InstrumentationRegistry
import java.io.File
import kotlinx.coroutines.flow.MutableStateFlow
import org.junit.After
import org.junit.Assert.*
import org.junit.Rule
import org.junit.Test

class MobileWorkLogUiTest {
    @get:Rule val compose = createComposeRule()
    private val instrumentation = InstrumentationRegistry.getInstrumentation()
    private val context = object : ContextWrapper(instrumentation.targetContext) {
        override fun getApplicationContext(): Context = this
        override fun getSharedPreferences(name: String, mode: Int) = super.getSharedPreferences("work-log-540-ui-$name", mode)
    }
    private val store = MobileWorkLogDraftStore(context)
    private val raw = "  測定条件を見直した。\n判断できなかった点は明日確認する。🔬\n  "
    @After fun cleanup() { store.clear() }

    @Test fun failedSaveKeepsInputAndDateThenSuccessfulSaveShowsSameBody() {
        store.clear()
        val repository = FixtureRepository()
        repository.fail = true
        content(repository)
        compose.onNodeWithTag("work-log-body").performTextReplacement(raw)
        compose.onNodeWithTag("work-log-date").performScrollTo().performTextReplacement("2026-09-06")
        compose.onNodeWithTag("work-log-save").assertIsDisplayed().assertIsEnabled().performClick()
        compose.waitUntil { compose.onAllNodesWithTag("work-log-error").fetchSemanticsNodes().isNotEmpty() }
        compose.onNodeWithTag("work-log-body").assertTextContains(raw)
        assertEquals(raw, store.load()?.body)
        assertEquals("2026-09-06", store.load()?.performedDate)
        screenshot("01-save-failure-ime")
        repository.fail = false
        compose.onNodeWithTag("work-log-save").performClick()
        compose.waitUntil { repository.saved != null }
        compose.onNodeWithText("保存した記録").assertIsDisplayed()
        assertEquals(raw, repository.saved?.body)
        assertEquals("2026-09-06", repository.saved?.performedDate)
        compose.onNodeWithText(raw).assertIsDisplayed()
        screenshot("02-saved-original")
    }

    @Test fun longDraftReopensWithoutTruncationAndSaveStaysReachableWithKeyboard() {
        val rawLong = " \n" + "原".repeat(11994) + "🔬\n "
        assertEquals(12000, rawLong.length)
        assertTrue(store.save(MobileWorkLogDraft(body = rawLong, performedDate = "2026-09-05")))
        val repository = FixtureRepository()
        content(repository)
        compose.onNodeWithTag("work-log-body").assertTextContains(rawLong).performClick()
        compose.onNodeWithTag("work-log-save").assertIsDisplayed().assertIsEnabled()
        screenshot("03-long-draft-ime")
        compose.onNodeWithTag("work-log-body").performTextReplacement(rawLong + "末")
        compose.onNodeWithTag("work-log-save").assertIsNotEnabled()
        assertEquals(rawLong + "末", store.load()?.body)
        compose.onNodeWithTag("work-log-body").performTextReplacement(rawLong)
        compose.onNodeWithTag("work-log-save").assertIsEnabled().performClick()
        compose.waitUntil { repository.saved != null }
        assertEquals(rawLong, repository.saved?.body)
        assertEquals("2026-09-05", repository.saved?.performedDate)
    }

    @Test fun emptyHistoryIsReadableAndCloseKeepsDraft() {
        store.clear()
        content(FixtureRepository())
        compose.onNodeWithTag("work-log-body").performTextReplacement(raw)
        compose.onNodeWithText("保存した記録").performClick()
        compose.onNodeWithText("まだ記録がありません。やったことを一言残せます。").assertIsDisplayed()
        screenshot("04-empty-history")
        compose.onNodeWithText("入力へ").performClick()
        compose.onNodeWithTag("work-log-body").assertTextContains(raw)
        assertEquals(raw, store.load()?.body)
    }

    @Test fun taskDetailProvidesReferenceWithoutCompletingTask() {
        val task = MobileTask("task-540", "測定結果を比較する", "theme-540", "todo", null, updatedAt = "2026-09-06T00:00:00Z")
        var selected: MobileTask? = null
        var stateActions = 0
        compose.setContent { TaskenTheme {
            TodayDetailPane(task, TaskActionUiState.Idle, onRecordWorkLog = { selected = it }, onStateAction = { stateActions++ })
        } }
        compose.onNodeWithTag("task-record-work-log").performScrollTo().assertIsDisplayed().performClick()
        compose.runOnIdle { assertEquals(task, selected); assertEquals(0, stateActions) }
    }

    @Test fun taskReferenceIsInitialValueWithoutCopyingItsThemeVisibility() {
        store.clear()
        val task = MobileTask("task-540", "測定結果を比較する", "theme-540", "todo", null, updatedAt = "2026-09-06T00:00:00Z")
        val repository = FixtureRepository()
        content(repository, task)
        compose.onNodeWithTag("work-log-body").performTextReplacement(raw)
        compose.onNodeWithTag("work-log-save").performClick()
        compose.waitUntil { repository.saved != null }
        assertEquals(task.id, repository.saved?.taskId)
        assertNull(repository.saved?.themeId)
    }

    private fun content(repository: FixtureRepository, initialTask: MobileTask? = null) = compose.setContent {
        val activityContext = LocalContext.current
        val isolatedContext = remember(activityContext) { object : ContextWrapper(activityContext) {
            override fun getApplicationContext(): Context = this
            override fun getSharedPreferences(name: String, mode: Int) = context.getSharedPreferences(name, mode)
        } }
        CompositionLocalProvider(LocalContext provides isolatedContext) {
            TaskenTheme { MobileWorkLogSheet(repository, emptyList(), listOfNotNull(initialTask), initialTask, onDismiss = {}) }
        }
    }

    private class FixtureRepository : MobileWorkLogRepository {
        val records = MutableStateFlow<List<MobileWorkLog>>(emptyList())
        @Volatile var fail = false
        @Volatile var saved: MobileWorkLogDraft? = null
        override fun observeWorkLogs() = records
        override suspend fun recordWorkLog(draft: MobileWorkLogDraft): String {
            if (fail) error("保存に失敗しました。本文を保持しています。")
            records.value = listOf(MobileWorkLog(WorkLogCacheEntity(draft.id, "test", null, draft.body, draft.performedDate,
                draft.enteredAt, draft.themeId, draft.taskId, false, false, null), null))
            saved = draft
            return draft.id
        }
        override suspend fun deleteWorkLog(id: String) = Unit
        override suspend fun restoreWorkLog(id: String) = Unit
        override suspend fun retryWorkLog(id: String) = Unit
        override suspend fun refreshWorkLog(id: String) = Unit
    }

    private fun screenshot(name: String) {
        compose.waitForIdle()
        val form = InstrumentationRegistry.getArguments().getString("workLogForm", "compact")
        val directory = File(context.getExternalFilesDir(null), "work-log-540").apply { mkdirs() }
        val bitmap = requireNotNull(instrumentation.uiAutomation.takeScreenshot())
        File(directory, "$form-$name.png").outputStream().use { check(bitmap.compress(Bitmap.CompressFormat.PNG, 100, it)) }
        bitmap.recycle()
    }
}
