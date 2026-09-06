package jp.personal.tasken.companion

import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.v2.createComposeRule
import androidx.test.platform.app.InstrumentationRegistry
import android.graphics.Bitmap
import java.io.File
import java.time.LocalDate
import java.time.ZoneId
import kotlinx.coroutines.flow.MutableStateFlow
import org.junit.Assert.*
import org.junit.Rule
import org.junit.Test

class MobileRecallUiTest {
    @get:Rule val compose = createComposeRule()
    private val date = LocalDate.parse("2026-09-06")
    private val zone = ZoneId.of("Asia/Tokyo")

    private fun row(id: String, type: String = "work_log", stage: String = "作業記録") = MobileRecallRow(id,
        MobileRecallSource(type, id, "available"), "測定条件の比較 $id", "比較した条件と判断の根拠を残した。\n未解決の点は明日確認する。",
        stage, date.toString(), if (type == "work_log") "" else "09:30")

    @Test fun cachedRecordsShowBeforeNetworkAndYesterdaySeparatesUnfetchedFromEmpty() {
        val repository = FixtureRepository()
        repository.today.value = repository.today.value.copy(rows = listOf(row("note")), lastFetchedAt = "2026-09-06T09:30:00Z")
        content(repository)
        compose.onNodeWithText("測定条件の比較 note").assertIsDisplayed()
        assertEquals(0, repository.requests)
        screenshot("01-cached")
        compose.onNodeWithTag("recall-day-2026-09-05").performClick()
        compose.onNodeWithText("表示できる記録はまだ端末にありません。").assertIsDisplayed()
        compose.onNodeWithTag("recall-coverage").assertTextContains("未取得", substring = true)
        screenshot("02-unfetched")
        compose.onNodeWithText("再取得").performClick()
        compose.waitUntil { repository.requests == 1 }
        compose.onNodeWithText("取得した範囲に記録はありません。").assertIsDisplayed()
        screenshot("03-confirmed-empty")
        compose.onNodeWithTag("recall-day-2026-09-06").performClick()
        compose.onNodeWithText("測定条件の比較 note").assertIsDisplayed()
    }

    @Test fun partialOfflineKeepsRowsAndExplanationWithReachableContinue() {
        val repository = FixtureRepository()
        repository.today.value = repository.today.value.copy(rows = listOf(row("note"), row("capture", "capture_entry", "未整理Capture")),
            lastFetchedAt = "2026-09-06T09:30:00Z", partial = true, hasNextPage = true, showingPreviousSnapshot = true)
        repository.fail = true
        content(repository)
        compose.onNodeWithTag("recall-next").assertIsDisplayed().performClick()
        compose.waitUntil { repository.requests == 1 }
        compose.onNodeWithText("測定条件の比較 note").assertIsDisplayed()
        compose.onNodeWithTag("recall-coverage").assertTextContains("前回の取得分を表示", substring = true)
        compose.onNodeWithText("Desktopに接続できません。端末の記録を表示しています。").assertIsDisplayed()
        compose.onNodeWithText("一言残す").assertIsDisplayed()
        screenshot("04-partial-offline")
    }

    @Test fun sourceActionsUseWorkLogAndCapturePathsAndNewInputIsReused() {
        val repository = FixtureRepository()
        val original = MobilePendingCapture("capture-command", "  Captureの原文\n🔬  ", "2026-09-06T09:00:00+09:00", "端末に保存済み", false)
        repository.today.value = repository.today.value.copy(rows = listOf(row("note"), row("capture", "capture_entry", "未整理Capture").copy(capture = original)))
        var selectedWorkLog: String? = "unchanged"
        var selectedCapture: MobilePendingCapture? = null
        compose.setContent { TaskenTheme { MobileRecallSheet(repository, emptyList(), {}, { selectedWorkLog = it }, { selectedCapture = it }, {}, date, zone) } }
        compose.onNodeWithTag("recall-row-note").onChildren().filter(hasText("原記録を開く")).onFirst().performClick()
        compose.waitUntil { selectedWorkLog == "note" }
        assertEquals("note", repository.loaded)
        compose.onNodeWithTag("recall-row-capture").performScrollTo()
        compose.onAllNodesWithText("原記録を開く").onLast().performClick()
        assertEquals(original, selectedCapture)
        compose.onNodeWithText("一言残す").performClick()
        assertNull(selectedWorkLog)
    }

    @Test fun missingOriginalAndAiStagesAreExplicitWithoutPromotingAcceptance() {
        val repository = FixtureRepository()
        repository.today.value = repository.today.value.copy(rows = listOf(
            row("capture", "capture_entry", "未整理Capture"),
            row("ai", "work_receipt", "AIの報告").copy(source = MobileRecallSource("work_receipt", "ai", "unavailable", "unsupported_type")),
            row("accepted", "task", "人間が採用"),
        ), lastFetchedAt = "2026-09-06T09:30:00Z")
        content(repository)
        compose.onNodeWithText("Captureの原文は端末に未取得です。このDesktopからの全文取得には未対応です。").assertIsDisplayed()
        screenshot("05-source-unavailable")
        compose.onNodeWithTag("recall-row-ai").performScrollTo()
        compose.onNodeWithText("AIの報告 · 09:30").assertIsDisplayed()
        compose.onNodeWithTag("recall-row-accepted").performScrollTo()
        compose.onNodeWithText("人間が採用 · 09:30").assertIsDisplayed()
    }

    private fun content(repository: FixtureRepository) {
        compose.setContent { TaskenTheme { MobileRecallSheet(repository, emptyList(), {}, {}, {}, {}, date, zone) } }
    }

    private fun screenshot(name: String) {
        compose.waitForIdle()
        val instrumentation = InstrumentationRegistry.getInstrumentation()
        val bitmap = requireNotNull(instrumentation.uiAutomation.takeScreenshot())
        val width = instrumentation.targetContext.resources.configuration.screenWidthDp
        val folder = File(instrumentation.targetContext.getExternalFilesDir(null), "recall-549").apply { mkdirs() }
        File(folder, "$width-$name.png").outputStream().use { bitmap.compress(Bitmap.CompressFormat.PNG, 100, it) }
        bitmap.recycle()
    }

    private inner class FixtureRepository : MobileRecallRepository {
        val today = MutableStateFlow(MobileRecallDay(date.toString(), zone.id))
        private val yesterday = MutableStateFlow(MobileRecallDay(date.minusDays(1).toString(), zone.id))
        var requests = 0
        var fail = false
        var loaded: String? = null
        override fun observeRecallDay(date: LocalDate, timezone: ZoneId) = if (date == this@MobileRecallUiTest.date) today else yesterday
        override suspend fun refreshRecallDay(date: LocalDate, timezone: ZoneId, nextPage: Boolean) {
            val state = observeRecallDay(date, timezone)
            state.value = if (fail) state.value.copy(error = "Desktopに接続できません。端末の記録を表示しています。")
                else state.value.copy(lastFetchedAt = "2026-09-06T10:00:00Z", error = null)
            requests++
        }
        override suspend fun loadRecallWorkLog(id: String) { loaded = id }
    }
}
