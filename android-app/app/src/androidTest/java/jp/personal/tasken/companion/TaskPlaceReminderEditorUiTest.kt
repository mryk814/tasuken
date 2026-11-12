package jp.personal.tasken.companion

import android.Manifest
import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.safeDrawingPadding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.assertIsEnabled
import androidx.compose.ui.test.assertIsNotEnabled
import androidx.compose.ui.test.assertTextContains
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performScrollTo
import androidx.compose.ui.test.performTextReplacement
import androidx.compose.ui.unit.dp
import androidx.test.core.app.ApplicationProvider
import androidx.test.platform.app.InstrumentationRegistry
import java.io.File
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Rule
import org.junit.Test

class TaskPlaceReminderEditorUiTest {
    @get:Rule
    val composeRule = createComposeRule()

    private val sannomiya = MobilePlaceReminder("三ノ宮", 34.6937, 135.1956, 300, emptyList(), null, null)
    private val motomachi = MobilePlaceReminder("元町商店街の北側にある長い名前の場所", 34.6895, 135.1830, 500, listOf(1, 2, 3, 4, 5), "17:00", "21:00")

    private var place by mutableStateOf<MobilePlaceReminder?>(null)
    private val previous = listOf(sannomiya, MobilePlaceReminder("自宅", 34.7, 135.2, 200))
    private var readiness by mutableStateOf<PlaceReminderReadiness?>(PlaceReminderReadiness.Ready)
    private var overLimit by mutableStateOf(false)
    private var located: MobilePlaceReminder? = null

    /** inPane: 詳細の画面ごと。そうでなければ場所の欄だけ（権限の状態を固定できる）。 */
    private fun render(inPane: Boolean) {
        composeRule.setContent {
            // 画面の形・ダーク・文字の大きさは端末（adb の wm size / cmd uimode / font_scale）の設定に従う。
            run {
                MaterialTheme(colorScheme = if (isSystemInDarkTheme()) taskenDarkColorScheme() else taskenLightColorScheme()) {
                    Surface(modifier = Modifier.fillMaxSize().safeDrawingPadding(), color = MaterialTheme.colorScheme.surface) {
                        Box(Modifier.fillMaxSize()) {
                            if (inPane) {
                                TodayDetailPane(
                                    task = MobileTask(
                                        id = "10000000-0000-4000-8000-000000000727", title = "三ノ宮で買い物をする", themeId = null,
                                        state = "todo", workState = null, updatedAt = "2026-11-12T00:00:00Z", placeReminder = place,
                                    ),
                                    actionState = TaskActionUiState.Idle,
                                    onStateAction = {},
                                    previousPlaces = previous,
                                    onPlaceReminderUpdate = { _, next -> place = next },
                                )
                            } else {
                                Column(Modifier.verticalScroll(rememberScrollState()).padding(20.dp)) {
                                    TaskPlaceReminderEditor(
                                        place = place, previousPlaces = previous, enabled = true, stateDescription = null,
                                        onChange = { place = it }, readinessOverride = readiness,
                                        overLimit = overLimit, locate = { located },
                                    )
                                }
                            }
                        }
                    }
                }
            }
        }
    }

    private fun showEditor() {
        composeRule.onNodeWithTag("task-place-editor").performScrollTo().assertIsDisplayed()
    }

    @Test
    fun pickingAPreviousPlaceIsOneTapAndStartsEverydayAllDay() {
        // 許可の画面が前に出ると操作できないので、先に許可しておく（許可の流れは別に確かめる）。
        val automation = InstrumentationRegistry.getInstrumentation().uiAutomation
        val packageName = ApplicationProvider.getApplicationContext<android.content.Context>().packageName
        listOf(
            Manifest.permission.ACCESS_FINE_LOCATION, Manifest.permission.ACCESS_COARSE_LOCATION,
            Manifest.permission.ACCESS_BACKGROUND_LOCATION, Manifest.permission.POST_NOTIFICATIONS,
        ).forEach { automation.grantRuntimePermission(packageName, it) }
        place = null
        render(inPane = true)
        showEditor()
        composeRule.onNodeWithTag("place-use-current").assertIsDisplayed()
        composeRule.onNodeWithTag("place-previous-0").assertTextContains("三ノ宮", substring = true)
        composeRule.onNodeWithTag("place-previous-1").performClick()
        composeRule.waitForIdle()
        assertEquals(MobilePlaceReminder("自宅", 34.7, 135.2, 200, emptyList(), null, null), place)
        composeRule.onNodeWithTag("place-name").assertTextContains("自宅", substring = true)
        composeRule.onNodeWithTag("task-place-chip").assertExists()
    }

    @Test
    fun radiusWeekdaysAndTimeWindowAreEditedWithSingleTapsAndRemoveClearsThePlace() {
        place = motomachi.copy(radiusMeters = 300, days = emptyList(), timeFrom = null, timeTo = null)
        render(inPane = false)
        showEditor()
        composeRule.onNodeWithTag("place-radius-1000").performClick()
        assertEquals(1000, place?.radiusMeters)
        composeRule.onNodeWithTag("place-day-5").performClick()
        composeRule.onNodeWithTag("place-day-1").performClick()
        assertEquals(listOf(1, 5), place?.days)
        composeRule.onNodeWithTag("place-day-5").performClick()
        assertEquals(listOf(1), place?.days)
        place = place?.copy(timeFrom = "22:00", timeTo = "02:00")
        composeRule.waitForIdle()
        composeRule.onNodeWithTag("place-time-window").assertTextContains("22:00–02:00", substring = true)
        composeRule.onNodeWithTag("place-time-clear").performClick()
        assertNull(place?.timeFrom)
        assertNull(place?.timeTo)
        composeRule.onNodeWithTag("place-remove").performClick()
        assertNull(place)
        composeRule.onNodeWithTag("place-use-current").assertIsDisplayed()
    }

    @Test
    fun timeWindowTakesFromThenTo() {
        place = sannomiya
        render(inPane = false)
        showEditor()
        composeRule.onNodeWithTag("place-time-window").performClick()
        composeRule.onNodeWithTag("place-time-input").assertIsDisplayed()
        composeRule.onNodeWithTag("place-time-next").performClick()
        composeRule.onNodeWithTag("place-time-next").performClick()
        composeRule.waitForIdle()
        assertEquals("17:00", place?.timeFrom)
        // 2 段目は「まで」の初期値（21:00）から始まる。1 段目の値を引きずらない。
        assertEquals("21:00", place?.timeTo)
    }

    @Test
    fun currentLocationAsksForANameAndIsNotSavedWithoutOne() {
        val automation = InstrumentationRegistry.getInstrumentation().uiAutomation
        val packageName = ApplicationProvider.getApplicationContext<android.content.Context>().packageName
        listOf(Manifest.permission.ACCESS_FINE_LOCATION, Manifest.permission.ACCESS_COARSE_LOCATION,
            Manifest.permission.ACCESS_BACKGROUND_LOCATION, Manifest.permission.POST_NOTIFICATIONS)
            .forEach { automation.grantRuntimePermission(packageName, it) }
        located = MobilePlaceReminder("", 34.6937, 135.1956, 300)
        place = null
        render(inPane = false)
        showEditor()
        composeRule.onNodeWithTag("place-use-current").performClick()
        // 座標は取れたが名前が空: 入力がその場で開き、決定できない。まだ保存されない。
        composeRule.onNodeWithTag("place-name-input").assertIsDisplayed()
        composeRule.onNodeWithTag("place-name-save").assertIsNotEnabled()
        assertNull(place)
        composeRule.onNodeWithTag("place-name-input").performTextReplacement("三ノ宮駅前")
        composeRule.onNodeWithTag("place-name-save").assertIsEnabled().performClick()
        composeRule.waitForIdle()
        assertEquals(MobilePlaceReminder("三ノ宮駅前", 34.6937, 135.1956, 300), place?.copy(days = emptyList()))
    }

    @Test
    fun cancellingTheNameDiscardsTheCurrentLocation() {
        val automation = InstrumentationRegistry.getInstrumentation().uiAutomation
        val packageName = ApplicationProvider.getApplicationContext<android.content.Context>().packageName
        listOf(Manifest.permission.ACCESS_FINE_LOCATION, Manifest.permission.ACCESS_COARSE_LOCATION,
            Manifest.permission.ACCESS_BACKGROUND_LOCATION, Manifest.permission.POST_NOTIFICATIONS)
            .forEach { automation.grantRuntimePermission(packageName, it) }
        located = MobilePlaceReminder("", 34.6937, 135.1956, 300)
        place = null
        readiness = PlaceReminderReadiness.Ready
        render(inPane = false)
        showEditor()
        composeRule.onNodeWithTag("place-use-current").performClick()
        composeRule.onNodeWithText("キャンセル").performClick()
        composeRule.waitForIdle()
        assertNull(place)
    }

    @Test
    fun overLimitTasksShowTheBellOffMark() {
        place = sannomiya
        overLimit = true
        render(inPane = false)
        showEditor()
        composeRule.onNodeWithTag("place-over-limit").assertIsDisplayed()
    }

    @Test
    fun theNameCanBeChanged() {
        place = sannomiya.copy(name = "現在地")
        render(inPane = false)
        showEditor()
        composeRule.onNodeWithTag("place-name").performClick()
        composeRule.onNodeWithTag("place-name-input").performTextReplacement("三ノ宮駅")
        composeRule.onNodeWithTag("place-name-save").performClick()
        composeRule.waitForIdle()
        assertEquals("三ノ宮駅", place?.name)
    }

    @Test
    fun whenItCannotNotifyTheCardSaysSoWithAnIconAndOnlyThen() {
        place = sannomiya
        readiness = PlaceReminderReadiness.NoBackgroundLocation
        render(inPane = false)
        showEditor()
        composeRule.onNodeWithTag("place-not-notifying").assertIsDisplayed()
        readiness = PlaceReminderReadiness.Ready
        composeRule.waitForIdle()
        composeRule.onNodeWithTag("place-not-notifying").assertDoesNotExist()
    }

    /**
     * 画面の確認用。状態ごとに実画面を撮る（失敗の条件ではない）。
     * 画面の形は `-e shape <名前>` で名前を付け、端末側を wm size / wm density / cmd uimode night / font_scale で変えて走らせる。
     */
    @Test
    fun screenshots() {
        val automation = InstrumentationRegistry.getInstrumentation().uiAutomation
        val packageName = ApplicationProvider.getApplicationContext<android.content.Context>().packageName
        listOf(Manifest.permission.ACCESS_FINE_LOCATION, Manifest.permission.ACCESS_COARSE_LOCATION,
            Manifest.permission.ACCESS_BACKGROUND_LOCATION, Manifest.permission.POST_NOTIFICATIONS)
            .forEach { automation.grantRuntimePermission(packageName, it) }
        val shape = InstrumentationRegistry.getArguments().getString("shape") ?: "default"
        val states = listOf(
            Triple("empty", null as MobilePlaceReminder?, PlaceReminderReadiness.Ready),
            Triple("set", motomachi, PlaceReminderReadiness.Ready),
            Triple("set-everyday", sannomiya, PlaceReminderReadiness.Ready),
            Triple("blocked-background", sannomiya, PlaceReminderReadiness.NoBackgroundLocation),
            Triple("blocked-noplay", sannomiya, PlaceReminderReadiness.NoPlayServices),
        )
        val night = (ApplicationProvider.getApplicationContext<android.content.Context>().resources.configuration.uiMode and
            android.content.res.Configuration.UI_MODE_NIGHT_MASK) == android.content.res.Configuration.UI_MODE_NIGHT_YES
        render(inPane = false)
        for ((state, value, ready) in states) {
            place = value
            readiness = ready
            composeRule.waitForIdle()
            showEditor()
            capture("$shape-${if (night) "dark" else "light"}-$state")
        }
        // 名前の入力（現在地の取得後は空で開く）。
        located = MobilePlaceReminder("", 34.6937, 135.1956, 300)
        place = null
        readiness = PlaceReminderReadiness.Ready
        composeRule.waitForIdle()
        composeRule.onNodeWithTag("place-use-current").performClick()
        composeRule.onNodeWithTag("place-name-input").assertIsDisplayed()
        capture("$shape-${if (night) "dark" else "light"}-name-input")
        composeRule.onNodeWithTag("place-name-input").performTextReplacement("三ノ宮駅前")
        capture("$shape-${if (night) "dark" else "light"}-name-input-filled")
    }

    private fun capture(name: String) {
        Thread.sleep(700) // 窓が実際に描かれてから撮る（最初の 1 枚が空白になるため）
        composeRule.waitForIdle()
        val instrumentation = InstrumentationRegistry.getInstrumentation()
        val directory = File(instrumentation.targetContext.getExternalFilesDir(null), "place-ui").apply { mkdirs() }
        val screenshot = checkNotNull(instrumentation.uiAutomation.takeScreenshot())
        File(directory, "$name.png").outputStream().use {
            check(screenshot.compress(android.graphics.Bitmap.CompressFormat.PNG, 100, it))
        }
        screenshot.recycle()
    }
}
