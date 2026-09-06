package jp.personal.tasken.companion

import android.graphics.Bitmap
import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.v2.createComposeRule
import androidx.compose.ui.graphics.asAndroidBitmap
import androidx.test.platform.app.InstrumentationRegistry
import java.io.File
import kotlinx.coroutines.flow.MutableStateFlow
import org.junit.Assert.*
import org.junit.Rule
import org.junit.Test

class MobileRelatedDocumentsUiTest {
    @get:Rule val compose = createComposeRule()
    private fun summary(id: String) = RelatedSummary("note", id, "測定条件の比較 $id", 1, "available", listOf(RelatedReason("related_to", "from_task")))
    @Test fun cachedBodyAndListPositionSurviveReaderRoundTripWithOfflineError() {
        val repository = FixtureRepository()
        val text = "比較した条件と判断の根拠を残した。\n".repeat(80)
        repository.state.value = RelatedDocumentsState((1..20).map { summary("note-$it") },
            listOf(CachedRelatedBody("note", "note-12", RelatedBody("測定条件の比較", 1, text, text.length, false), "2026-09-06T08:00:00Z")), "2026-09-06T08:00:00Z", "next")
        content(repository)
        compose.onNodeWithTag("related-note-12").performScrollTo().performClick()
        compose.onNodeWithText(text).assertExists()
        compose.onNodeWithText("Desktopへ接続できません。保存した本文を表示しています。").assertIsDisplayed()
        screenshot("01-cached-offline")
        compose.onNodeWithText("関連一覧へ戻る").performClick()
        compose.onNodeWithTag("related-note-12").assertIsDisplayed()
        screenshot("02-list-return")
    }
    @Test fun unfetchedEmptyBrokenAndLongBodyHaveExplicitStates() {
        val repository = FixtureRepository()
        content(repository)
        compose.onNodeWithText("関連資料は未取得です。Desktopへの接続が必要です。").assertIsDisplayed()
        screenshot("03-unfetched")
        compose.runOnIdle { repository.state.value = RelatedDocumentsState(fetchedAt = "2026-09-06T08:00:00Z") }
        compose.onNodeWithText("関連資料はありません。").assertIsDisplayed()
        screenshot("04-empty")
        compose.runOnIdle { repository.state.value = RelatedDocumentsState(listOf(summary("note"), summary("broken").copy(status = "not_found", version = null, title = "参照先が見つかりません")), fetchedAt = "2026-09-06T08:00:00Z") }
        compose.onNodeWithTag("related-broken").assertIsNotEnabled()
        screenshot("05-broken")
        compose.onNodeWithTag("related-note").performClick()
        compose.onNodeWithText("本文は未取得です。Desktopに接続すると読めます。").assertIsDisplayed()
        screenshot("06-body-unfetched")
        compose.runOnIdle { repository.state.value = repository.state.value.copy(bodies = listOf(CachedRelatedBody("note", "note", RelatedBody("長文", 1, "長い資料\n".repeat(100), 70000, true), "2026-09-06T08:00:00Z"))) }
        compose.onNodeWithText("長い本文の先頭50,000文字を表示しています（全70000文字）。").assertIsDisplayed()
        screenshot("07-long-body")
    }
    private fun content(repository: FixtureRepository) { compose.setContent { TaskenTheme { MobileRelatedDocumentsSheet(repository, "task", {}) } } }
    private fun screenshot(name: String) {
        compose.waitForIdle()
        val instrumentation = InstrumentationRegistry.getInstrumentation()
        val bitmap = compose.onNodeWithTag("related-documents").captureToImage().asAndroidBitmap()
        val directory = File(instrumentation.targetContext.getExternalFilesDir(null), "related-550").apply { mkdirs() }
        val width = instrumentation.targetContext.resources.configuration.screenWidthDp
        File(directory, "$width-$name.png").outputStream().use { bitmap.compress(Bitmap.CompressFormat.PNG, 100, it) }
        bitmap.recycle()
    }
    private class FixtureRepository : MobileRelatedDocumentsRepository {
        val state = MutableStateFlow(RelatedDocumentsState())
        override fun observeRelatedDocuments(taskId: String) = state
        override suspend fun refreshRelatedDocuments(taskId: String, nextPage: Boolean) = Unit
        override suspend fun loadRelatedDocument(taskId: String, type: String, id: String) { state.value = state.value.copy(error = "Desktopへ接続できません。保存した本文を表示しています。") }
    }
}
