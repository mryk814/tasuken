package jp.personal.tasken.companion

import android.graphics.Bitmap
import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.v2.createComposeRule
import androidx.compose.ui.test.junit4.StateRestorationTester
import androidx.test.platform.app.InstrumentationRegistry
import java.io.File
import kotlinx.coroutines.flow.flow
import org.junit.Assert.*
import org.junit.Rule
import org.junit.Test

class MobileLocalSearchUiTest {
    @get:Rule val compose = createComposeRule()
    private val instrumentation = InstrumentationRegistry.getInstrumentation()
    private class Fixture : MobileLocalSearchRepository {
        override fun observeLocalSearch(request: MobileLocalSearchRequest) = flow {
            kotlinx.coroutines.delay(300)
            if (request.query == "失敗") error("fixture")
            val hits = if (request.query == "なし") emptyList() else (0..49).map {
                MobileLocalSearchHit(MobileLocalSearchKind.Note, "${request.page}-$it", "温度と濃度の比較 $it",
                    "測定の原文を端末に保存しています。条件の違いを比較するための記録です。", "2026-09-08", "本文取得日",
                    listOf(null), coverage = "取得済み本文", relatedTaskId = "task")
            }
            emit(MobileLocalSearchPage(request, hits, if (hits.isEmpty()) 0 else 120,
                MobileLocalSearchCoverage(12, 4, 8, 50, 3, 7, 1)))
        }
        override suspend fun localSearchCapture(id: String): MobilePendingCapture? = null
    }
    private fun waitResult() { compose.waitUntil(10000) { compose.onAllNodesWithTag("local-search-loading").fetchSemanticsNodes().isEmpty() } }
    private fun shot(name: String) {
        compose.waitForIdle()
        instrumentation.waitForIdleSync()
        android.os.SystemClock.sleep(250)
        val image = instrumentation.uiAutomation.takeScreenshot()
        val folder = File(instrumentation.targetContext.getExternalFilesDir(null), "search-552").apply { mkdirs() }
        val width = instrumentation.targetContext.resources.configuration.screenWidthDp
        File(folder, "$width-$name.png").outputStream().use { image.compress(Bitmap.CompressFormat.PNG, 100, it) }
        image.recycle()
    }
    @Test fun loadingEmptyFailureAndResultsKeepQueryAndRestoreConditionsAndPage() {
        val restoration = StateRestorationTester(compose)
        val repository = Fixture()
        restoration.setContent { TaskenTheme { MobileLocalSearchSheet(repository, emptyList(), {}, {}) } }
        compose.onNodeWithTag("local-search-loading").assertExists()
        waitResult(); shot("01-results")
        compose.onNodeWithTag("local-search-query").performTextReplacement("なし")
        waitResult(); compose.onNodeWithTag("local-search-empty").assertExists(); shot("02-empty")
        compose.onNodeWithTag("local-search-query").performTextReplacement("失敗")
        waitResult(); compose.onNodeWithText("端末の記録を検索できませんでした。入力を保ったまま開き直してください。").assertExists()
        compose.onNodeWithTag("local-search-query").assertTextContains("失敗"); shot("03-error")
        compose.onNodeWithTag("local-search-query").performTextReplacement("温度 比較")
        compose.onNodeWithTag("local-search-filters").performClick()
        compose.onNodeWithText("Themeなし").performClick()
        compose.onNodeWithTag("local-search-from").performTextReplacement("2026-09-01")
        compose.onNodeWithTag("local-search-until").performTextReplacement("2026-09-08")
        compose.onNodeWithTag("local-search-until").performImeAction()
        waitResult()
        compose.onNodeWithTag("local-search-next").performClick(); waitResult()
        compose.onNodeWithTag("local-search-results").performScrollToIndex(12)
        val before = compose.onNodeWithTag("local-search-results").fetchSemanticsNode().config[androidx.compose.ui.semantics.SemanticsProperties.VerticalScrollAxisRange].value()
        assertTrue(before > 0)
        restoration.emulateSavedInstanceStateRestore(); waitResult()
        compose.onNodeWithTag("local-search-query").assertTextContains("温度 比較")
        compose.onNodeWithTag("local-search-from").assertTextContains("2026-09-01")
        compose.onNodeWithTag("local-search-until").assertTextContains("2026-09-08")
        compose.onNodeWithText("2ページ").assertExists()
        assertEquals(before, compose.onNodeWithTag("local-search-results").fetchSemanticsNode().config[androidx.compose.ui.semantics.SemanticsProperties.VerticalScrollAxisRange].value())
        shot("04-restored-filters")
    }
}
