package jp.personal.tasken.companion

import android.graphics.Bitmap
import android.graphics.Canvas
import android.view.View
import android.view.ViewGroup
import android.widget.FrameLayout
import android.widget.TextView
import androidx.test.platform.app.InstrumentationRegistry
import java.io.File
import org.junit.Assert.assertEquals
import org.junit.Test

/** ウィジェットの見出しに、AIが待っている件数を出す。0件なら何も出さない。 */
class TaskenWidgetAiBadgeTest {
    private val context = InstrumentationRegistry.getInstrumentation().targetContext

    @Test fun badgeShowsOnlyWhileAiIsWaiting() {
        val waiting = render(snapshot(aiNeedsYou = 2, firstAttentionId = "task-work:request:1"), "01-widget-ai-waiting")
        val badge = waiting.findViewById<TextView>(R.id.widget_ai)
        assertEquals(View.VISIBLE, badge.visibility)
        assertEquals("AI 2", badge.text.toString())
        assertEquals("AIが返事を待っています 2件", badge.contentDescription.toString())

        val quiet = render(snapshot(aiNeedsYou = 0, firstAttentionId = null), "02-widget-ai-none")
        assertEquals(View.GONE, quiet.findViewById<TextView>(R.id.widget_ai).visibility)
    }

    private fun snapshot(aiNeedsYou: Int, firstAttentionId: String?) = TaskenWidgetSnapshot(
        tasks = listOf(TaskenWidgetTask("w1", "測定条件を確認", isDone = false, section = "今日")),
        pendingCount = 0,
        conflictCount = 0,
        lastSuccessfulSyncAt = "2026-09-27T00:00:00Z",
        todayDoneCount = 1,
        todayTotalCount = 3,
        aiNeedsYou = aiNeedsYou,
        firstAttentionId = firstAttentionId,
    )

    private fun render(snapshot: TaskenWidgetSnapshot, name: String): View {
        lateinit var view: View
        InstrumentationRegistry.getInstrumentation().runOnMainSync {
            val parent = FrameLayout(context)
            view = TaskenTodayWidget.viewsForMode(context, 1, snapshot, TaskenWidgetMode.Medium).apply(context, parent)
            val width = (320 * context.resources.displayMetrics.density).toInt()
            val height = (180 * context.resources.displayMetrics.density).toInt()
            view.layoutParams = ViewGroup.LayoutParams(width, height)
            view.measure(View.MeasureSpec.makeMeasureSpec(width, View.MeasureSpec.EXACTLY), View.MeasureSpec.makeMeasureSpec(height, View.MeasureSpec.EXACTLY))
            view.layout(0, 0, width, height)
            val bitmap = Bitmap.createBitmap(width, height, Bitmap.Config.ARGB_8888)
            view.draw(Canvas(bitmap))
            val directory = File(context.getExternalFilesDir(null), "widget-verify").apply { mkdirs() }
            File(directory, "$name.png").outputStream().use { bitmap.compress(Bitmap.CompressFormat.PNG, 100, it) }
            bitmap.recycle()
        }
        return view
    }
}
