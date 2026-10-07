package jp.personal.tasken.companion

import android.content.Context
import android.graphics.Bitmap
import android.graphics.Canvas
import android.view.View
import android.view.ViewGroup
import android.widget.BaseAdapter
import android.widget.FrameLayout
import android.widget.ListView
import android.widget.RemoteViews
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.compose.ui.viewinterop.AndroidView
import androidx.test.platform.app.InstrumentationRegistry
import java.io.File
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test

/**
 * ホーム画面ウィジェットの見た目を、実RemoteViewsを当てて画像に残す。
 * ランチャーへ置かずに、各サイズの見出し・進捗・行・空状態を目視確認するための撮影用。
 * 保存先: 端末の getExternalFilesDir()/widget-preview
 */
class TaskenWidgetPreviewCaptureTest {
    @get:Rule
    val composeRule = createAndroidComposeRule<androidx.activity.ComponentActivity>()

    private var host: FrameLayout? = null

    private val tasks = listOf(
        TaskenWidgetTask("p1", "実験室安全点検チェックシートを提出", false, "個人業務", widgetThemeColorInt("chart-1"), "期限切れ"),
        TaskenWidgetTask("p2", "試料Bを準備", false, "触媒探索", widgetThemeColorInt("chart-2"), "今日"),
        TaskenWidgetTask("p3", "考察メモを見直す", false, "触媒探索", widgetThemeColorInt("chart-2"), "今日"),
        TaskenWidgetTask("p4", "温度条件の違いを記録", false, "試料評価", widgetThemeColorInt("chart-3"), "今日", requiresWorkReceipt = true),
        TaskenWidgetTask("p5", "学会要旨の下書き", false, "試料評価", widgetThemeColorInt("chart-3"), "今後"),
        TaskenWidgetTask("p6", "装置メンテナンスの予約", false, null, null, "今後"),
    )

    private val snapshot = TaskenWidgetSnapshot(
        tasks = tasks,
        pendingCount = 1,
        conflictCount = 0,
        lastSuccessfulSyncAt = "2026-10-07T12:00:00Z",
        todayDoneCount = 1,
        todayTotalCount = 4,
        aiNeedsYou = 2,
    )

    @Test
    fun captureWidgetSizes() {
        val context = InstrumentationRegistry.getInstrumentation().targetContext
        val cases = listOf(
            Triple("01-medium-4x2", TaskenWidgetMode.Medium, 300 to 190),
            Triple("02-large-4x3", TaskenWidgetMode.Large, 300 to 290),
            Triple("03-tall-4x4", TaskenWidgetMode.Tall, 300 to 380),
            Triple("04-wide-5x2", TaskenWidgetMode.Wide, 380 to 190),
            Triple("05-small-2x1", TaskenWidgetMode.Small, 140 to 80),
        )
        cases.forEach { (name, mode, size) -> capture(context, name, mode, snapshot, size) }
        capture(
            context,
            "06-medium-empty",
            TaskenWidgetMode.Medium,
            TaskenWidgetSnapshot(emptyList(), 0, 0, "2026-10-07T12:00:00Z"),
            300 to 190,
        )
        capture(
            context,
            "07-medium-all-done",
            TaskenWidgetMode.Medium,
            snapshot.copy(tasks = emptyList(), todayDoneCount = 4, aiNeedsYou = 0, pendingCount = 0),
            300 to 190,
        )
    }

    private fun capture(
        context: Context,
        name: String,
        mode: TaskenWidgetMode,
        snapshot: TaskenWidgetSnapshot,
        sizeDp: Pair<Int, Int>,
    ) {
        if (host == null) {
            composeRule.setContent {
                AndroidView(
                    modifier = Modifier.fillMaxSize().background(Color(0xFFDDE3EA)),
                    factory = { factoryContext -> FrameLayout(factoryContext).also { host = it } },
                )
            }
            composeRule.waitForIdle()
        }
        composeRule.runOnUiThread {
            val frame = checkNotNull(host)
            val density = frame.resources.displayMetrics.density
            frame.removeAllViews()
            val root = TaskenTodayWidget.viewsForMode(frame.context, 1, snapshot, mode).apply(frame.context, frame)
            fillList(frame.context, root, snapshot)
            frame.addView(
                root,
                FrameLayout.LayoutParams(
                    (sizeDp.first * density).toInt(),
                    (sizeDp.second * density).toInt(),
                ).apply { setMargins((12 * density).toInt(), (12 * density).toInt(), 0, 0) },
            )
        }
        composeRule.waitForIdle()
        composeRule.runOnUiThread {
            val view = checkNotNull(host)
            val density = view.resources.displayMetrics.density
            val width = ((sizeDp.first + 24) * density).toInt()
            val height = ((sizeDp.second + 24) * density).toInt()
            val bitmap = Bitmap.createBitmap(width, height, Bitmap.Config.ARGB_8888)
            view.draw(Canvas(bitmap))
            val directory = File(context.getExternalFilesDir(null), "widget-preview").apply { mkdirs() }
            File(directory, "$name.png").outputStream().use {
                check(bitmap.compress(Bitmap.CompressFormat.PNG, 100, it))
            }
            bitmap.recycle()
        }
        composeRule.runOnIdle { assertTrue(checkNotNull(host).width > 0) }
    }

    /** RemoteViewsのリストはホスト外では埋まらないので、同じ行RemoteViewsで中身を詰める。 */
    private fun fillList(context: Context, root: View, snapshot: TaskenWidgetSnapshot) {
        val list = root.findViewById<ListView>(R.id.widget_list) ?: return
        val items = mutableListOf<RemoteViews>()
        var lastSection: String? = null
        snapshot.tasks.forEach { task ->
            if (task.section != null && task.section != lastSection) {
                items += RemoteViews(context.packageName, R.layout.tasken_widget_section_row)
                    .apply { setTextViewText(R.id.widget_section_title, task.section) }
                lastSection = task.section
            }
            items += TaskenTodayWidget.rowViews(context, task)
        }
        list.adapter = object : BaseAdapter() {
            override fun getCount() = items.size
            override fun getItem(position: Int) = items[position]
            override fun getItemId(position: Int) = position.toLong()
            override fun getView(position: Int, convertView: View?, parent: ViewGroup): View =
                items[position].apply(context, parent)
        }
    }
}
