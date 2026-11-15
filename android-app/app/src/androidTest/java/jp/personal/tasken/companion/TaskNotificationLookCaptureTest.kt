package jp.personal.tasken.companion

import android.Manifest
import android.content.res.Configuration
import android.graphics.Bitmap
import android.os.SystemClock
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.compose.ui.platform.LocalConfiguration
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.junit4.v2.createComposeRule
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.onNodeWithText
import androidx.test.platform.app.InstrumentationRegistry
import java.io.File
import java.time.Instant
import java.time.LocalDate
import java.time.LocalDateTime
import java.time.LocalTime
import kotlinx.coroutines.runBlocking
import org.junit.Rule
import org.junit.Test

/**
 * 時刻と期限の知らせ（#753）の見た目を撮るための入口。
 *
 * - [settingsLight]・[settingsDark]: 設定の「期限の日」の時刻の欄を、実際の画面の部品で撮る（files/task-notification-look）。
 * - [seedRealNotifications]: アプリの実際の写しに Task を置き、実際の通知を出して残す。通知の引き出し・ロック画面・
 *   「完了」「1 時間後」「明日」は、この後に端末を操作して確かめる。
 *
 * 走り終わるとアプリごと消える connected 系では通知も撮った物も残らないので、APK を入れて `am instrument -e class ...` で
 * 走らせる（FAILURES.md 2026-11-12）。試験用の端末でだけ走らせる（アプリの写しに試験の Task を書く）。
 */
class TaskNotificationLookCaptureTest {
    @get:Rule val composeRule = createComposeRule()

    @Test fun settingsLight() = settings(dark = false)

    @Test fun settingsDark() = settings(dark = true)

    private fun settings(dark: Boolean) {
        val suffix = if (dark) "dark" else "light"
        var times by mutableStateOf(TaskNotificationPlan.DefaultDueTimes)
        var exact by mutableStateOf(true)
        composeRule.setContent {
            Themed(dark) {
                AppSettingsSheet(
                    notificationsAllowed = true,
                    notificationPermissionDenied = false,
                    onRequestNotifications = {},
                    onRepair = {},
                    onDismiss = {},
                    dueTimes = times,
                    onDueTimesChange = { times = it },
                    exactAlarmsAllowed = exact,
                    onRequestExactAlarms = {},
                )
            }
        }
        composeRule.onNodeWithTag("due-times-row").assertIsDisplayed()
        composeRule.onNodeWithText("09:00").assertIsDisplayed()
        composeRule.onNodeWithTag("due-time-add").assertIsDisplayed()
        capture("settings-default-$suffix")
        times = listOf(LocalTime.of(8, 30), LocalTime.of(18, 0))
        exact = false
        composeRule.onNodeWithText("18:00").assertIsDisplayed()
        composeRule.onNodeWithTag("exact-alarm-action").assertIsDisplayed()
        capture("settings-twice-inexact-$suffix")
    }

    @Test
    fun seedRealNotifications() = runBlocking {
        val instrumentation = InstrumentationRegistry.getInstrumentation()
        val context = instrumentation.targetContext
        instrumentation.uiAutomation.grantRuntimePermission(context.packageName, Manifest.permission.POST_NOTIFICATIONS)
        val dao = MobileLocalDatabase.open(context).mobileDao()
        val now = LocalDateTime.now()
        val today = LocalDate.now().toString()
        val syncedAt = Instant.now().minusSeconds(600).toString()
        dao.upsertSyncState(SyncStateEntity(serverId = "look-server", apiVersion = 1, schemaVersion = TASKEN_MOBILE_SCHEMA_VERSION, cursor = "cursor", lastSuccessfulSyncAt = syncedAt, lastAttemptAt = syncedAt, lastError = null))
        fun task(id: String, title: String, reminderAt: String? = null, dueDate: String? = null) = TaskCacheEntity(
            id = id, serverVersion = 3, title = title, themeId = null, state = "todo", workState = null,
            todayDate = today, updatedAt = syncedAt, optimisticCommandId = null, reminderAt = reminderAt,
            scheduleId = dueDate?.let { "schedule-$id" }, scheduleVersion = dueDate?.let { 1 }, scheduleEndDate = dueDate,
            scheduleDateKind = dueDate?.let { "deadline" },
        )
        dao.upsertTask(task("10000000-0000-4000-8000-000000007531", "確定申告の書類を出す", dueDate = today))
        dao.upsertTask(task("10000000-0000-4000-8000-000000007532", "歯医者に電話する", reminderAt = now.minusMinutes(1).withSecond(0).withNano(0).toString().take(16)))
        dao.upsertTask(task("10000000-0000-4000-8000-000000007533", "図書館の本を返す", dueDate = LocalDate.now().plusDays(1).toString()))
        dao.upsertTask(task("10000000-0000-4000-8000-000000007534", "来月の予定を決める", dueDate = LocalDate.now().plusDays(12).toString()))
        // 期限の日の知らせを「いま」出すため、時刻を今の 1 分前にする（撮った後は既定に戻す: restoreDefaultDueTimes）。
        TaskNotificationSettings.setDueTimes(context, listOf(now.toLocalTime().minusMinutes(1)))
        TaskNotificationSettings.writeFired(context, emptyMap())
        TaskNotificationScheduler.sync(context, dao)
        SystemClock.sleep(1_500)
    }

    @Test
    fun restoreDefaultDueTimes() {
        TaskNotificationSettings.setDueTimes(InstrumentationRegistry.getInstrumentation().targetContext, TaskNotificationPlan.DefaultDueTimes)
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
        val directory = File(instrumentation.targetContext.getExternalFilesDir(null), "task-notification-look")
        check(directory.isDirectory || directory.mkdirs())
        val bitmap = checkNotNull(instrumentation.uiAutomation.takeScreenshot())
        File(directory, "$name.png").outputStream().use { check(bitmap.compress(Bitmap.CompressFormat.PNG, 100, it)) }
        bitmap.recycle()
    }
}
