package jp.personal.tasken.companion

import android.content.Context
import android.content.ContextWrapper
import android.graphics.Bitmap
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.remember
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.semantics.SemanticsProperties
import androidx.compose.ui.graphics.asAndroidBitmap
import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.v2.createComposeRule
import androidx.lifecycle.viewmodel.compose.viewModel
import androidx.test.platform.app.InstrumentationRegistry
import java.io.File
import kotlinx.coroutines.flow.MutableStateFlow
import org.junit.Assert.*
import org.junit.Rule
import org.junit.Test

class MobileRelatedDocumentsTodayUiTest {
    @get:Rule val compose = createComposeRule()
    private val instrumentation = InstrumentationRegistry.getInstrumentation()
    @Test fun taskSelectionAndDetailScrollSurviveBodyRoundTrip() {
        val repository = FixtureRepository()
        compose.setContent {
            val activityContext = LocalContext.current
            val isolatedContext = remember(activityContext) { object : ContextWrapper(activityContext) {
                override fun getApplicationContext(): Context = this
                override fun getSharedPreferences(name: String, mode: Int) = super.getSharedPreferences("related-550-today-$name", mode)
            } }
            CompositionLocalProvider(LocalContext provides isolatedContext) {
                TaskenTheme { TodayApp(viewModel(factory = TodayViewModelFactory(repository))) }
            }
        }
        // Tap the title itself; the merged card's center can be a Checklist checkbox on wide layouts.
        compose.onAllNodesWithText(repository.task.title, useUnmergedTree = true).onFirst().performClick()
        compose.waitUntil(10000) { compose.onAllNodesWithTag("task-detail-content").fetchSemanticsNodes().size == 1 }
        compose.onNodeWithTag("task-detail-content").performTouchInput { swipeUp() }
        compose.onNodeWithTag("task-related-documents").performScrollTo()
        val before = compose.onNodeWithTag("task-detail-content").fetchSemanticsNode().config[SemanticsProperties.VerticalScrollAxisRange].value()
        assertTrue("Task detail must be scrolled before opening the reader", before > 0)
        compose.onNodeWithTag("task-related-documents").performClick()
        compose.onNodeWithTag("related-note").performClick()
        compose.onNodeWithText("測定の根拠として保存した原文").assertIsDisplayed()
        compose.onNodeWithText("Taskへ戻る").performClick()
        compose.onNodeWithTag("task-title-display").assertTextContains(repository.task.title)
        compose.onNodeWithTag("task-related-documents").assertIsDisplayed()
        assertEquals(before, compose.onNodeWithTag("task-detail-content").fetchSemanticsNode().config[SemanticsProperties.VerticalScrollAxisRange].value())
        compose.onNodeWithTag("task-related-documents").performClick()
        compose.onNodeWithText("Taskへ戻る").performClick()
        val after = compose.onNodeWithTag("task-detail-content").fetchSemanticsNode().config[SemanticsProperties.VerticalScrollAxisRange].value()
        assertEquals(before, after)
        val bitmap = compose.onRoot().captureToImage().asAndroidBitmap()
        val folder = File(instrumentation.targetContext.getExternalFilesDir(null), "related-550").apply { mkdirs() }
        val width = instrumentation.targetContext.resources.configuration.screenWidthDp
        File(folder, "$width-08-task-return.png").outputStream().use { bitmap.compress(Bitmap.CompressFormat.PNG, 100, it) }; bitmap.recycle()
    }
    private class FixtureRepository : MobileTaskRepository, MobileOfflineTaskRepository, MobileRelatedDocumentsRepository {
        val task = MobileTask("related-task", "測定結果を比較する", "theme", "todo", null, updatedAt = "2026-09-06T08:00:00Z", description = "詳細の位置を保つ。\n".repeat(30),
            checklistItems = (1..20).map { MobileChecklistItem("check-$it", "比較条件 $it", false, it.toDouble()) })
        val state = MutableStateFlow(RelatedDocumentsState(listOf(RelatedSummary("note", "note", "判断の根拠", 1, "available", listOf(RelatedReason("related_to", "from_task")))),
            listOf(CachedRelatedBody("note", "note", RelatedBody("判断の根拠", 1, "測定の根拠として保存した原文", 16, false), "2026-09-06T08:00:00Z")), "2026-09-06T08:00:00Z"))
        override fun loadToday() = MobileTodayResult.Available(listOf(task), "2026-09-06T08:00:00Z")
        override fun observeCachedTasks() = kotlinx.coroutines.flow.flowOf(listOf(task))
        override fun observePendingCount() = kotlinx.coroutines.flow.flowOf(0)
        override suspend fun enqueueCreateTask(draft: MobileCaptureDraft, todayDate: java.time.LocalDate?): String = error("Read-only fixture")
        override suspend fun enqueueCompleteTask(taskId: String): MobileStateActionResult = error("Read-only fixture")
        override suspend fun enqueueReopenTask(taskId: String): MobileStateActionResult = error("Read-only fixture")
        override fun observeRelatedDocuments(taskId: String) = state
        override suspend fun refreshRelatedDocuments(taskId: String, nextPage: Boolean) = Unit
        override suspend fun loadRelatedDocument(taskId: String, type: String, id: String) = Unit
    }
}
