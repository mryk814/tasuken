package jp.personal.tasken.companion

import android.content.Context
import android.content.ContextWrapper
import android.graphics.Bitmap
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.v2.createComposeRule
import androidx.lifecycle.viewmodel.compose.viewModel
import androidx.test.platform.app.InstrumentationRegistry
import java.io.File
import java.time.LocalDate
import java.time.ZoneId
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.flowOf
import org.junit.After
import org.junit.Assert.*
import org.junit.Rule
import org.junit.Test

class MobileRecallTodayUiTest {
    @get:Rule val compose = createComposeRule()
    private val instrumentation = InstrumentationRegistry.getInstrumentation()
    private val context = object : ContextWrapper(instrumentation.targetContext) {
        override fun getApplicationContext(): Context = this
        override fun getSharedPreferences(name: String, mode: Int) = super.getSharedPreferences("recall-549-today-$name", mode)
    }
    @After fun cleanup() { MobileWorkLogDraftStore(context).clear() }

    @Test fun todayEntryReusesWorkLogInputAndReturnsToSelectedRecallDay() {
        MobileWorkLogDraftStore(context).clear()
        val repository = FixtureRepository()
        compose.setContent {
            val activityContext = LocalContext.current
            val isolatedContext = androidx.compose.runtime.remember(activityContext) { object : ContextWrapper(activityContext) {
                override fun getApplicationContext(): Context = this
                override fun getSharedPreferences(name: String, mode: Int) = context.getSharedPreferences(name, mode)
            } }
            CompositionLocalProvider(LocalContext provides isolatedContext) {
                TaskenTheme { TodayApp(viewModel(factory = TodayViewModelFactory(repository))) }
            }
        }
        compose.onNodeWithTag("open-recall").assertIsDisplayed()
        screenshot("06-today-entry")
        compose.onNodeWithTag("open-recall").performClick()
        val yesterday = LocalDate.now().minusDays(1).toString()
        compose.onNodeWithTag("recall-day-$yesterday").performClick().assertIsSelected()
        compose.onNodeWithText("一言残す").performClick()
        val original = "  日報用の別形式を増やさず保存する。\n🔬  "
        compose.onNodeWithTag("work-log-body").performTextReplacement(original)
        compose.onNodeWithTag("work-log-save").assertIsDisplayed().performClick()
        compose.waitUntil { repository.records.value.isNotEmpty() }
        assertEquals(original, repository.records.value.single().record.body)
        compose.onNodeWithTag("work-log-close").performClick()
        compose.onNodeWithTag("recall-day-$yesterday").assertIsSelected()
        screenshot("07-returned-day")
    }

    private fun screenshot(name: String) {
        compose.waitForIdle()
        val image = requireNotNull(instrumentation.uiAutomation.takeScreenshot())
        val folder = File(context.getExternalFilesDir(null), "recall-549").apply { mkdirs() }
        val width = context.resources.configuration.screenWidthDp
        File(folder, "$width-$name.png").outputStream().use { image.compress(Bitmap.CompressFormat.PNG, 100, it) }
        image.recycle()
    }

    private class FixtureRepository : MobileTaskRepository, MobileRecallRepository, MobileWorkLogRepository {
        val records = MutableStateFlow<List<MobileWorkLog>>(emptyList())
        override fun loadToday(): MobileTodayResult = MobileTodayResult.PairingRequired()
        override fun observeRecallDay(date: LocalDate, timezone: ZoneId) = flowOf(MobileRecallDay(date.toString(), timezone.id))
        override suspend fun refreshRecallDay(date: LocalDate, timezone: ZoneId, nextPage: Boolean) = Unit
        override suspend fun loadRecallWorkLog(id: String) = Unit
        override fun observeWorkLogs() = records
        override suspend fun recordWorkLog(draft: MobileWorkLogDraft): String {
            records.value = listOf(MobileWorkLog(WorkLogCacheEntity(draft.id, "fixture", null, draft.body, draft.performedDate,
                draft.enteredAt, draft.themeId, draft.taskId, false, false, null), null))
            return draft.id
        }
        override suspend fun deleteWorkLog(id: String) = Unit
        override suspend fun restoreWorkLog(id: String) = Unit
        override suspend fun retryWorkLog(id: String) = Unit
        override suspend fun refreshWorkLog(id: String) = Unit
    }
}
