package jp.personal.tasken.companion

import android.content.Context
import android.content.ContextWrapper
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.remember
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.semantics.SemanticsProperties
import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.v2.createComposeRule
import androidx.lifecycle.viewmodel.compose.viewModel
import kotlinx.coroutines.flow.flowOf
import org.junit.Assert.*
import org.junit.Rule
import org.junit.Test

class MobileLocalSearchTodayUiTest {
    @get:Rule val compose = createComposeRule()
    @Test fun eachSourceOpensExistingReaderAndReturnsToSearchPositionWithoutNetwork() {
        val repository = Fixture()
        compose.setContent {
            val activity = LocalContext.current
            val isolated = remember(activity) { object : ContextWrapper(activity) {
                override fun getApplicationContext(): Context = this
                override fun getSharedPreferences(name: String, mode: Int) = super.getSharedPreferences("search-552-${name}", mode)
            } }
            CompositionLocalProvider(LocalContext provides isolated) { TaskenTheme { TodayApp(viewModel(factory = TodayViewModelFactory(repository))) } }
        }
        compose.onNodeWithText("ToDo").performClick()
        compose.waitUntil(10000) { compose.onAllNodesWithTag("open-local-search").fetchSemanticsNodes().isNotEmpty() }
        compose.onNodeWithTag("open-local-search").performClick()
        compose.onNodeWithTag("local-search-query").performTextReplacement("比較")
        compose.onNodeWithTag("local-search-query").performImeAction()
        fun result() { compose.waitUntil(10000) { compose.onAllNodesWithTag("local-search").fetchSemanticsNodes().isNotEmpty() && compose.onAllNodesWithTag("local-search-loading").fetchSemanticsNodes().isEmpty() } }
        result()
        fun open(kind: MobileLocalSearchKind): Float {
            compose.onNodeWithTag("local-search-results").performScrollToNode(hasTestTag("local-search-${kind.sourceType}:${kind.name}"))
            val scroll = compose.onNodeWithTag("local-search-results").fetchSemanticsNode().config[SemanticsProperties.VerticalScrollAxisRange].value()
            compose.onNodeWithTag("local-search-${kind.sourceType}:${kind.name}").performClick()
            return scroll
        }
        fun returned(scroll: Float) {
            result()
            compose.onNodeWithTag("local-search-query").assertTextContains("比較")
            assertEquals(scroll, compose.onNodeWithTag("local-search-results").fetchSemanticsNode().config[SemanticsProperties.VerticalScrollAxisRange].value())
        }
        var scroll = open(MobileLocalSearchKind.Task)
        compose.onNodeWithTag("task-title-display").assertTextContains(repository.task.title)
        compose.onNodeWithTag("local-search-return").performClick(); returned(scroll)
        scroll = open(MobileLocalSearchKind.Note)
        compose.onNodeWithText("比較の根拠を残したNote原文").assertExists()
        compose.onNodeWithText("検索へ戻る").performClick(); returned(scroll)
        scroll = open(MobileLocalSearchKind.Capture)
        compose.onNodeWithTag("pending-capture-body").assertTextContains("比較のCapture原文")
        compose.onNodeWithText("閉じる").performClick(); returned(scroll)
        scroll = open(MobileLocalSearchKind.WorkLog)
        compose.onNodeWithTag("work-log-record-WorkLog").assertExists()
        compose.onNodeWithTag("work-log-close").performClick(); returned(scroll)
        assertEquals(0, repository.readRequests)
    }

    private class Fixture : MobileTaskRepository, MobileOfflineTaskRepository, MobileRelatedDocumentsRepository, MobileLocalSearchRepository, MobileWorkLogRepository {
        var readRequests = 0
        val task = MobileTask("Task", "比較するTask", null, "todo", null, updatedAt = "2026-09-08T08:00:00Z")
        override fun loadToday() = MobileTodayResult.Available(listOf(task), "2026-09-08T08:00:00Z")
        override fun observeCachedTasks() = flowOf(listOf(task))
        override fun observePendingCount() = flowOf(0)
        override suspend fun enqueueCreateTask(draft: MobileCaptureDraft, todayDate: java.time.LocalDate?): String = error("Read-only fixture")
        override suspend fun enqueueCompleteTask(taskId: String): MobileStateActionResult = error("Read-only fixture")
        override suspend fun enqueueReopenTask(taskId: String): MobileStateActionResult = error("Read-only fixture")
        override fun observeLocalSearch(request: MobileLocalSearchRequest) = flowOf(MobileLocalSearchPage(request,
            MobileLocalSearchKind.entries.map { MobileLocalSearchHit(it, it.name, "比較 ${it.label}", "保存した比較の本文", "2026-09-08", "入力日", listOf(null), coverage = "端末保存", relatedTaskId = if (it == MobileLocalSearchKind.Note) "Task" else null) }, 4))
        override suspend fun localSearchCapture(id: String) = MobilePendingCapture("capture", "比較のCapture原文", "2026-09-08T08:00:00Z", "端末保存", false)
        override fun observeRelatedDocuments(taskId: String) = flowOf(RelatedDocumentsState(
            listOf(RelatedSummary("note", "Note", "比較Note", 1, "available", listOf(RelatedReason("related_to", "from_task")))),
            listOf(CachedRelatedBody("note", "Note", RelatedBody("比較Note", 1, "比較の根拠を残したNote原文", 18, false), "2026-09-08T08:00:00Z")), "2026-09-08T08:00:00Z"))
        override suspend fun refreshRelatedDocuments(taskId: String, nextPage: Boolean) { readRequests++ }
        override suspend fun loadRelatedDocument(taskId: String, type: String, id: String) { readRequests++ }
        override fun observeWorkLogs() = flowOf(listOf(MobileWorkLog(WorkLogCacheEntity("WorkLog", "server", 1, "比較を進めた作業記録", "2026-09-08", "2026-09-08T08:00:00Z", null, null, false, false, null), null)))
        override suspend fun recordWorkLog(draft: MobileWorkLogDraft): String = error("Read-only fixture")
        override suspend fun deleteWorkLog(id: String) = error("Read-only fixture")
        override suspend fun restoreWorkLog(id: String) = error("Read-only fixture")
        override suspend fun retryWorkLog(id: String) = error("Read-only fixture")
        override suspend fun refreshWorkLog(id: String) { readRequests++ }
    }
}
