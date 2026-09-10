package jp.personal.tasken.companion

import android.graphics.Bitmap
import android.widget.LinearLayout
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.runtime.remember
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.compose.ui.viewinterop.AndroidView
import androidx.test.platform.app.InstrumentationRegistry
import java.io.File
import java.time.LocalDate
import kotlinx.coroutines.runBlocking
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test

class TaskenWidgetBindingUiTest {
    @get:Rule
    val composeRule = createAndroidComposeRule<androidx.activity.ComponentActivity>()

    private var hostView: LinearLayout? = null

    @Test
    fun seededDatabaseProducesSectionedScrollableRows() {
        val instrumentation = InstrumentationRegistry.getInstrumentation()
        val context = instrumentation.targetContext
        val today = LocalDate.now()
        val overdue = today.minusDays(1).toString()
        val todayText = today.toString()
        val future = today.plusDays(2).toString()
        val dao = MobileLocalDatabase.open(context).mobileDao()
        runBlocking {
            dao.upsertThemes(
                listOf(
                    ThemeCacheEntity("widget-verify-blue", "検証Blue", color = "chart-2"),
                    ThemeCacheEntity("widget-verify-green", "検証Green", color = "chart-3"),
                ),
            )
            dao.upsertTask(widgetTask("widget-verify-1", "期限切れの件", "widget-verify-blue", "todo", overdue, null))
            dao.upsertTask(widgetTask("widget-verify-2", "今日の件", "widget-verify-green", "todo", todayText, null))
            dao.upsertTask(widgetTask("widget-verify-3", "完了済みの件", null, "done", todayText, null))
            dao.upsertTask(widgetTask("widget-verify-4", "今後の件", "widget-verify-blue", "todo", future, "cmd-missing"))
        }

        val items = runBlocking { TaskenTodayWidget.loadListItems(context, todayText, 6) }
        val flat = items.map {
            when (it) {
                is TaskenWidgetListItem.Header -> "H:${it.title}"
                is TaskenWidgetListItem.Row -> "R:${it.task.id}:${TaskenTodayWidget.taskText(it.task)}"
            }
        }
        assertEquals(
            listOf(
                "H:期限切れ",
                "R:widget-verify-1:期限切れの件",
                "H:今日",
                "R:widget-verify-2:今日の件",
                "R:widget-verify-3:完了済みの件",
                "H:今後",
                "R:widget-verify-4:今後の件",
            ),
            flat,
        )
        val rows = items.filterIsInstance<TaskenWidgetListItem.Row>().associate { it.task.id to it.task }
        // 返信待ちのような送信待ち表示は行に出さない。
        assertTrue(rows.getValue("widget-verify-4").isPending)
        assertEquals(0xFF2D7FB8.toInt(), rows.getValue("widget-verify-1").themeColor)
        assertEquals(0xFF2E8B57.toInt(), rows.getValue("widget-verify-2").themeColor)
        assertNull(rows.getValue("widget-verify-3").themeColor)
        assertTrue(rows.getValue("widget-verify-1").canToggleState)

        composeRule.setContent {
            val appContext = LocalContext.current.applicationContext
            val views = remember(items) {
                items.map { item ->
                    when (item) {
                        is TaskenWidgetListItem.Header -> android.widget.RemoteViews(
                            appContext.packageName, R.layout.tasken_widget_section_row,
                        ).apply { setTextViewText(R.id.widget_section_title, item.title) }
                        is TaskenWidgetListItem.Row -> TaskenTodayWidget.rowViews(appContext, item.task)
                    }
                }
            }
            AndroidView(
                modifier = Modifier.fillMaxSize().background(Color.White),
                factory = { factoryContext ->
                LinearLayout(factoryContext).apply {
                    orientation = LinearLayout.VERTICAL
                    views.forEach { addView(it.apply(factoryContext, this)) }
                    hostView = this
                }
            })
        }
        composeRule.waitForIdle()
        val hostSize = IntArray(2)
        composeRule.runOnUiThread {
            hostSize[0] = hostView?.width ?: -1
            hostSize[1] = hostView?.height ?: -1
            hostView?.let { host ->
                if (host.width > 0 && host.height > 0) {
                    val bitmap = Bitmap.createBitmap(host.width, host.height, Bitmap.Config.ARGB_8888)
                    host.draw(android.graphics.Canvas(bitmap))
                    val directory = File(
                        InstrumentationRegistry.getInstrumentation().targetContext.getExternalFilesDir(null),
                        "widget-verify",
                    ).apply { mkdirs() }
                    File(directory, "compact-01-widget-sections-real-binding.png").outputStream().use {
                        check(bitmap.compress(Bitmap.CompressFormat.PNG, 100, it))
                    }
                    bitmap.recycle()
                }
            }
        }
        composeRule.runOnIdle { assertTrue("host laid out: ${hostSize.toList()}", hostSize[0] > 0 && hostSize[1] > 0) }
        composeRule.runOnIdle { assertEquals(7, items.size) }
        val shownTexts = mutableListOf<String>()
        composeRule.runOnUiThread {
            val root = composeRule.activity.window.decorView as android.view.ViewGroup
            val queue = ArrayDeque<android.view.View>().apply { add(root) }
            while (queue.isNotEmpty()) {
                val view = queue.removeFirst()
                if (view is android.widget.TextView) shownTexts += view.text.toString()
                if (view is android.view.ViewGroup) {
                    for (index in 0 until view.childCount) queue.add(view.getChildAt(index))
                }
            }
        }
        // 実RemoteViewsの適用結果が画面階層に存在すること（ドット・タイトル・右チェックの行）。
        listOf("期限切れ", "期限切れの件", "今日", "今日の件", "完了済みの件", "今後", "今後の件").forEach { expected ->
            assertTrue("missing in view hierarchy: $expected", shownTexts.any { it.contains(expected) })
        }
    }

    private fun widgetTask(
        id: String,
        title: String,
        themeId: String?,
        state: String,
        todayDate: String?,
        optimisticCommandId: String?,
    ) = TaskCacheEntity(
        id = id,
        serverVersion = 1,
        title = title,
        themeId = themeId,
        state = state,
        workState = null,
        todayDate = todayDate,
        updatedAt = "2026-09-10T00:00:00Z",
        optimisticCommandId = optimisticCommandId,
    )
}
