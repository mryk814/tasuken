package jp.personal.tasken.companion

import android.content.res.Configuration
import android.graphics.Bitmap
import android.os.SystemClock
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.ui.platform.LocalConfiguration
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.junit4.v2.createComposeRule
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.test.platform.app.InstrumentationRegistry
import java.io.File
import java.time.Instant
import java.time.LocalDate
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.flowOf
import org.junit.Rule
import org.junit.Test

/**
 * つながらない時の見せ方（写しの日付印・未送信の割印・理由の三つ）を、実際の画面の組み立て（TodayApp）で確かめて撮る。
 * 走り終わるとアプリごと消える connected 系では撮った物が残らないので、絵が要る時は APK を入れて `am instrument` で走らせ、
 * `files/offline-look` を取り出す（FAILURES.md 2026-11-12）。
 */
class OfflineLookCaptureTest {
    @get:Rule val composeRule = createComposeRule()

    @Test fun light() = threeReasons(dark = false)

    @Test fun dark() = threeReasons(dark = true)

    @Test fun repairLight() = registrationGone(dark = false)

    @Test fun repairDark() = registrationGone(dark = true)

    /** つながらない時。今日は写し、行に割印と「戻」、同期の一覧に理由の三つが並ぶ。 */
    private fun threeReasons(dark: Boolean) {
        val suffix = if (dark) "dark" else "light"
        // 次に送る時刻は WorkManager の予定から読むので、定期の送信を予定に入れておく。
        MobileOutboxScheduler.ensurePeriodicSync(InstrumentationRegistry.getInstrumentation().targetContext)
        val viewModel = TodayViewModel(OfflineRepository(registrationGone = false))
        composeRule.setContent { Themed(dark) { TodayApp(todayViewModel = viewModel) } }
        composeRule.waitUntil(5_000) { viewModel.uiState.value is TodayUiState.Cached }
        composeRule.onNodeWithTag("today-copy-stamp").assertIsDisplayed()
        composeRule.onNodeWithTag("task-unsent-t1", useUnmergedTree = true).assertIsDisplayed()
        composeRule.onNodeWithTag("task-returned-t2", useUnmergedTree = true).assertIsDisplayed()
        capture("today-$suffix")
        composeRule.onNodeWithTag("open-sync-status").performClick()
        composeRule.onNodeWithTag("sync-arrived-stamp").assertIsDisplayed()
        composeRule.onNodeWithText("未送信 5").assertIsDisplayed()
        composeRule.onNodeWithText("つながったら送る").assertIsDisplayed()
        composeRule.onNodeWithText("4回送った", substring = true).assertIsDisplayed()
        composeRule.onNodeWithText("直すと送れる").assertIsDisplayed()
        composeRule.onNodeWithTag("sync-conflicts").assertIsDisplayed()
        composeRule.onNodeWithText("開いて決める").assertIsDisplayed()
        capture("sync-$suffix")
    }

    /** この端末の登録が切れた時。待っても送れないので、未送信は「直すと送れる」に入り、つなぎ直す入口が出る。 */
    private fun registrationGone(dark: Boolean) {
        val suffix = if (dark) "dark" else "light"
        val viewModel = TodayViewModel(OfflineRepository(registrationGone = true))
        composeRule.setContent { Themed(dark) { TodayApp(todayViewModel = viewModel) } }
        composeRule.waitUntil(5_000) { viewModel.uiState.value is TodayUiState.Cached }
        capture("today-repair-$suffix")
        composeRule.onNodeWithTag("open-sync-status").performClick()
        composeRule.onNodeWithText("直すと送れる").assertIsDisplayed()
        composeRule.onNodeWithTag("sync-repair").assertIsDisplayed()
        composeRule.onNodeWithTag("sync-pending").assertDoesNotExist()
        capture("sync-repair-$suffix")
    }

    @Composable
    private fun Themed(dark: Boolean, content: @Composable () -> Unit) {
        val base = LocalConfiguration.current
        val configuration = Configuration(base).apply {
            uiMode = (uiMode and Configuration.UI_MODE_NIGHT_MASK.inv()) or
                if (dark) Configuration.UI_MODE_NIGHT_YES else Configuration.UI_MODE_NIGHT_NO
        }
        CompositionLocalProvider(LocalConfiguration provides configuration) { TaskenTheme(content) }
    }

    private fun capture(name: String) {
        composeRule.waitForIdle()
        SystemClock.sleep(800)
        val instrumentation = InstrumentationRegistry.getInstrumentation()
        val directory = File(instrumentation.targetContext.getExternalFilesDir(null), "offline-look")
        check(directory.isDirectory || directory.mkdirs())
        val bitmap = checkNotNull(instrumentation.uiAutomation.takeScreenshot())
        File(directory, "$name.png").outputStream().use { check(bitmap.compress(Bitmap.CompressFormat.PNG, 100, it)) }
        bitmap.recycle()
    }

    /** PC につながらず、端末の写しを見せている時。未送信が 3 件、PC が古くて送れない入力が 1 件、受け取られなかった物が 1 件。 */
    private class OfflineRepository(private val registrationGone: Boolean) : MobileTaskRepository, MobileOfflineTaskRepository {
        private val now = Instant.now()
        private val syncedAt = now.minusSeconds(3 * 3600 + 120).toString()
        private val tasks = TITLES.mapIndexed { index, title ->
            MobileTask(
                id = "t${index + 1}",
                title = title,
                themeId = null,
                state = if (index == 0) "done" else "todo",
                workState = null,
                updatedAt = syncedAt,
                todayDate = LocalDate.now().toString(),
                pending = index in setOf(0, 2),
                canChangePendingState = index in setOf(0, 2),
                canEditPendingTask = index in setOf(0, 2),
                conflict = if (index == 1) {
                    MobileTaskConflict(
                        commandId = "c-conflict",
                        intendedAction = "UpdateTask",
                        expectedVersion = 3,
                        serverVersion = 4,
                        serverState = "done",
                        detectedAt = syncedAt,
                    )
                } else {
                    null
                },
            )
        }

        override fun loadToday(): MobileTodayResult = if (registrationGone) {
            MobileTodayResult.PairingRequired(message = "この端末の登録が切れました。")
        } else {
            MobileTodayResult.Unavailable("PC につながりません。", "")
        }
        override fun observeCachedTasks(): Flow<List<MobileTask>> = flowOf(tasks)
        override fun observeTodayCache(date: LocalDate): Flow<MobileTodayCache> =
            flowOf(MobileTodayCache(tasks, hasStoredTasks = true, lastSuccessfulSyncAt = syncedAt))
        override fun observePendingCount(): Flow<Int> = flowOf(3)
        override fun observeConflictCount(): Flow<Int> = flowOf(1)
        override fun observeSendRetry(): Flow<MobileSendRetry?> =
            flowOf(MobileSendRetry(4, now.minusSeconds(14 * 60).toString(), "PC につながりません。"))
        override fun observePendingCaptures(): Flow<List<MobilePendingCapture>> = flowOf(
            listOf(
                MobilePendingCapture(
                    "capture-1", "装置の予約を来週に動かす。写真つき。", syncedAt,
                    PHOTO_CAPTURE_UPDATE_REQUIRED, canRetry = true, needsFix = true,
                ),
            ),
        )
        override suspend fun enqueueCreateTask(draft: MobileCaptureDraft, todayDate: LocalDate?): String = "unused"
        override suspend fun enqueueCompleteTask(taskId: String): MobileStateActionResult = error("unused")
        override suspend fun enqueueReopenTask(taskId: String): MobileStateActionResult = error("unused")
    }

    private companion object {
        val TITLES = listOf(
            "触媒Aの測定結果を比較",
            "試料Bを準備",
            "考察メモを見直す",
            "比較図を作る",
            "温度条件の違いを記録",
            "学会要旨の下書き",
        )
    }
}
