package jp.personal.tasken.companion

import android.content.Context
import android.content.res.Configuration
import android.graphics.Bitmap
import android.os.SystemClock
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.ui.platform.LocalConfiguration
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.junit4.v2.createComposeRule
import androidx.compose.ui.test.onAllNodesWithTag
import androidx.compose.ui.test.onAllNodesWithText
import androidx.compose.ui.test.onNodeWithContentDescription
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performScrollTo
import androidx.room.Room
import androidx.test.core.app.ApplicationProvider
import androidx.test.platform.app.InstrumentationRegistry
import java.io.File
import java.io.IOException
import java.time.Instant
import java.time.LocalDate
import kotlinx.coroutines.runBlocking
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import org.junit.After
import org.junit.Before
import org.junit.Rule
import org.junit.Test

/**
 * 続けることを圏外で記録した時の見せ方を、実際の画面（TodayApp）と送信の列（in-memory の Room）で確かめて撮る。
 * 押した時点で数が増えて行に割印、同期の一覧の「つながったら送る」に入り、つながったら送られて割印が消える。
 * 撮った物は `files/offline-look` に残る（取り出し方は OfflineLookCaptureTest の頭）。
 */
class RoutineOfflineLookCaptureTest {
    @get:Rule val composeRule = createComposeRule()

    private lateinit var context: Context
    private lateinit var database: MobileLocalDatabase
    private lateinit var store: MobileGatewayConnectionStore
    private val today = LocalDate.now().toString()
    private var online = true
    private var desktopCount = 1
    /** mode（1回足す）を知らない古い Desktop として断る。 */
    private var oldDesktop = false

    @Before
    fun setUp() = runBlocking {
        context = ApplicationProvider.getApplicationContext()
        database = Room.inMemoryDatabaseBuilder(context, MobileLocalDatabase::class.java).allowMainThreadQueries().build()
        database.mobileDao().upsertSyncState(
            SyncStateEntity(
                serverId = "server-1", apiVersion = 1, schemaVersion = TASKEN_MOBILE_SCHEMA_VERSION, cursor = null,
                lastSuccessfulSyncAt = null, lastAttemptAt = null, lastError = null,
            ),
        )
        store = MobileGatewayConnectionStore(context)
        store.clearToken()
        store.save("https://gateway.test", "l".repeat(43), setOf("mobile:read", "mobile:task-write", "mobile:capture-write"))
    }

    @After
    fun tearDown() {
        store.clearToken()
        database.close()
    }

    @Test fun light() = recordWhileOffline(dark = false)

    @Test fun dark() = recordWhileOffline(dark = true)

    private fun recordWhileOffline(dark: Boolean) {
        val suffix = if (dark) "dark" else "light"
        val viewModel = TodayViewModel(repository())
        composeRule.setContent { Themed(dark) { TodayApp(todayViewModel = viewModel) } }
        composeRule.waitUntil(10_000) { viewModel.routines.value != null }

        online = false
        composeRule.onNodeWithTag("today-routines").performScrollTo()
        composeRule.onNodeWithContentDescription("論文を読むを1回記録").performClick()
        composeRule.waitUntil(5_000) { viewModel.routines.value?.habits?.first()?.unsent == 1 }
        composeRule.onNodeWithText("毎日1回 · 今日2回 · 今週4/7回", substring = true).assertIsDisplayed()
        composeRule.onNodeWithTag("routine-habit-habit-read-unsent", useUnmergedTree = true).assertIsDisplayed()
        capture("routine-today-offline-$suffix")

        composeRule.onNodeWithTag("open-sync-status").performClick()
        composeRule.onNodeWithText("つながったら送る").assertIsDisplayed()
        capture("routine-sync-offline-$suffix")
        // 一覧を閉じてから、つながった後の同期を走らせる。
        InstrumentationRegistry.getInstrumentation().sendKeyDownUpSync(android.view.KeyEvent.KEYCODE_BACK)
        composeRule.waitUntil(5_000) {
            composeRule.onAllNodesWithTag("sync-status-sheet").fetchSemanticsNodes().isEmpty()
        }

        online = true
        viewModel.load()
        composeRule.waitUntil(10_000) {
            viewModel.routines.value?.habits?.first()?.let { it.unsent == 0 && it.habit.todayCount == 2 } == true
        }
        composeRule.onNodeWithTag("today-routines").performScrollTo()
        composeRule.onNodeWithText("毎日1回 · 今日2回 · 今週4/7回", substring = true).assertIsDisplayed()
        composeRule.onNodeWithTag("routine-habit-habit-read-unsent", useUnmergedTree = true).assertDoesNotExist()
        capture("routine-today-online-$suffix")
    }

    @Test fun reopenedLight() = reopenWhileOffline(dark = false)

    @Test fun reopenedDark() = reopenWhileOffline(dark = true)

    @Test fun morningLight() = morningWhileOffline(dark = false)

    @Test fun morningDark() = morningWhileOffline(dark = true)

    @Test fun retryAllLight() = refusedByAnOldDesktop(dark = false)

    @Test fun retryAllDark() = refusedByAnOldDesktop(dark = true)

    /**
     * 今日まだ一度も読めていない朝に圏外。前の日の写しから名前と頻度だけを出し、今日の数の所は電波なしの絵。
     * 押した記録は列にたまり、「+1」と割印で見える。日付印は前の日の日付。
     */
    private fun morningWhileOffline(dark: Boolean) {
        val suffix = if (dark) "dark" else "light"
        val yesterday = LocalDate.parse(today).minusDays(1)
        runBlocking {
            repository().synchronizeIfPaired()
            val copy = MobileRoutineContract.decode(routines()).data.copy(date = yesterday.toString())
            database.mobileDao().upsertRoutineCache(
                RoutineCacheEntity(
                    serverId = "server-1",
                    date = yesterday.toString(),
                    payloadJson = MobileRoutineContract.encodeCopy(copy),
                    fetchedAt = yesterday.atTime(21, 4).atZone(java.time.ZoneId.systemDefault()).toInstant().toString(),
                ),
            )
        }
        online = false
        val viewModel = TodayViewModel(repository())
        composeRule.setContent { Themed(dark) { TodayApp(todayViewModel = viewModel) } }
        composeRule.waitUntil(10_000) { viewModel.routines.value?.countsKnown == false }
        composeRule.onNodeWithTag("today-routines").performScrollTo()
        composeRule.onNodeWithContentDescription("論文を読むを1回記録").performClick()
        composeRule.waitUntil(5_000) { viewModel.routines.value?.habits?.first()?.unsent == 1 }
        composeRule.onNodeWithTag("routine-habit-habit-read-counts-unknown", useUnmergedTree = true).assertIsDisplayed()
        composeRule.onNodeWithTag("routine-habit-habit-read-unsent", useUnmergedTree = true).assertIsDisplayed()
        composeRule.onNodeWithTag("today-routines-copy-stamp", useUnmergedTree = true).assertIsDisplayed()
        capture("routine-today-morning-offline-$suffix")
    }

    /** 古い Desktop に断られた記録が二つ。同期の一覧から、まとめて送り直せる。 */
    private fun refusedByAnOldDesktop(dark: Boolean) {
        val suffix = if (dark) "dark" else "light"
        runBlocking {
            val before = repository()
            before.synchronizeIfPaired()
            checkNotNull(before.fetchRoutines(today))
            oldDesktop = true
            listOf(2, 3).forEach { sequence ->
                before.recordRoutine(
                    MobileRoutineActionDto(name = ROUTINE_RECORD_COMMAND, performedOn = today, habitId = "habit-read", sequence = sequence),
                )
            }
            before.synchronizeIfPaired()
        }
        val viewModel = TodayViewModel(repository())
        composeRule.setContent { Themed(dark) { TodayApp(todayViewModel = viewModel) } }
        composeRule.waitUntil(10_000) { viewModel.routineRecords.value.count { it.rejected } == 2 }
        composeRule.onNodeWithTag("open-sync-status").performClick()
        composeRule.onNodeWithTag("sync-returned-routines-retry-all").assertIsDisplayed()
        check(composeRule.onAllNodesWithText(ROUTINE_UPDATE_PC_REQUIRED).fetchSemanticsNodes().size == 2)
        capture("routine-sync-retry-all-$suffix")
    }

    /** つながる間に一度読み、圏外で 1 回記録してから開き直す。続けることは写しから出て、日付印と割印が付く。 */
    private fun reopenWhileOffline(dark: Boolean) {
        val suffix = if (dark) "dark" else "light"
        runBlocking {
            val before = repository()
            before.synchronizeIfPaired()
            checkNotNull(before.fetchRoutines(today))
            online = false
            check(
                before.recordRoutine(
                    MobileRoutineActionDto(name = ROUTINE_RECORD_COMMAND, performedOn = today, habitId = "habit-read", sequence = 2),
                ) == MobileRoutineActionResult.Queued,
            )
        }
        // 開き直し: 新しい送り手と ViewModel が、同じ端末の DB だけから組み立てる。
        val viewModel = TodayViewModel(repository())
        composeRule.setContent { Themed(dark) { TodayApp(todayViewModel = viewModel) } }
        composeRule.waitUntil(10_000) { viewModel.routines.value?.copyAt != null }
        composeRule.onNodeWithTag("today-routines").performScrollTo()
        composeRule.onNodeWithTag("today-routines-copy-stamp", useUnmergedTree = true).assertIsDisplayed()
        composeRule.onNodeWithText("毎日1回 · 今日2回 · 今週4/7回", substring = true).assertIsDisplayed()
        composeRule.onNodeWithTag("routine-habit-habit-read-unsent", useUnmergedTree = true).assertIsDisplayed()
        capture("routine-today-reopened-offline-$suffix")
    }

    private fun repository() = AndroidMobileTaskRepository(
        context = context,
        store = store,
        database = database,
        scheduleOutboxOnStart = false,
        httpClient = MobileGatewayHttpClient { _, path, method, body, _ ->
            if (!online) throw IOException("offline")
            when {
                path.startsWith("/v1/bootstrap") -> GatewayHttpResponse(200, page("tasks", TASKS.mapIndexed { i, t -> taskJson("t$i", t) }))
                path.startsWith("/v1/sync") -> GatewayHttpResponse(200, page("changes", emptyList()))
                path.startsWith("/v1/routines") -> GatewayHttpResponse(200, routines())
                path == "/v1/routine-actions" && method == "POST" && oldDesktop -> GatewayHttpResponse(
                    400,
                    """{"ok":false,"meta":${meta()},"error":{"code":"validation_failed","message":"invalid","retryable":false}}""",
                )
                path == "/v1/routine-actions" && method == "POST" -> {
                    val commandId = Json.parseToJsonElement(requireNotNull(body)).jsonObject.getValue("commandId").jsonPrimitive.content
                    desktopCount += 1
                    GatewayHttpResponse(200, """{"ok":true,"meta":${meta()},"data":{"commandId":"$commandId","status":"applied"}}""")
                }
                else -> GatewayHttpResponse(404, "")
            }
        },
        scheduleOutbox = {},
    )

    private fun routines(): String {
        val week = desktopCount + 2
        val habit = """{"habitId":"habit-read","title":"論文を読む","scheduleLabel":"毎日1回","todayCount":$desktopCount,""" +
            """"nextSequence":${desktopCount + 1},"weekCount":$week,"weekTarget":7,"todayLabel":"今日${desktopCount}回",""" +
            """"weekLabel":"今週$week/7回","met":false}"""
        val walk = """{"habitId":"habit-walk","title":"昼に歩く","scheduleLabel":"週3回","todayCount":0,"nextSequence":1,""" +
            """"weekCount":1,"weekTarget":3,"todayLabel":"今日0回","weekLabel":"今週1/3回","met":false}"""
        return """{"ok":true,"meta":${meta()},"data":{"date":"$today","habits":[$habit,$walk]}}"""
    }

    private fun meta(): String =
        """{"apiVersion":1,"schemaVersion":$TASKEN_MOBILE_SCHEMA_VERSION,"serverId":"server-1",""" +
            """"serverRevision":8,"generatedAt":"${Instant.now()}","truncated":false}"""

    private fun taskJson(id: String, title: String): String =
        """{"id":"$id","version":1,"title":"$title","themeId":null,"state":"todo","workState":null,""" +
            """"todayDate":"$today","schedule":null,"updatedAt":"${Instant.now()}"}"""

    private fun page(field: String, items: List<String>): String =
        """{"ok":true,"meta":${meta()},"data":{"$field":[${items.joinToString(",")}],"nextCursor":"cursor-1","hasMore":false}}"""

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

    private companion object {
        val TASKS = listOf("触媒Aの測定結果を比較", "試料Bを準備", "考察メモを見直す")
    }
}
