package jp.personal.tasken.companion

import android.app.PendingIntent
import android.appwidget.AppWidgetManager
import android.appwidget.AppWidgetProvider
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.util.Log
import android.view.View
import android.widget.RemoteViews
import java.time.LocalDate
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch

data class TaskenWidgetTask(
    val id: String,
    val title: String,
    val isDone: Boolean,
)

data class TaskenWidgetSnapshot(
    val tasks: List<TaskenWidgetTask>,
    val pendingCount: Int,
    val conflictCount: Int,
    val lastSuccessfulSyncAt: String?,
)

class TaskenTodayWidget : AppWidgetProvider() {
    override fun onUpdate(context: Context, manager: AppWidgetManager, appWidgetIds: IntArray) {
        appWidgetIds.forEach { renderLoading(context, manager, it) }
        val pendingResult = goAsync()
        CoroutineScope(Dispatchers.IO).launch {
            try {
                updateAllNow(context.applicationContext)
            } finally {
                pendingResult.finish()
            }
        }
    }

    override fun onReceive(context: Context, intent: Intent) {
        super.onReceive(context, intent)
        if (intent.action != ACTION_TOGGLE_TASK) return
        val taskId = intent.getStringExtra(EXTRA_TASK_ID) ?: return
        val markDone = intent.getBooleanExtra(EXTRA_MARK_DONE, true)
        val pendingResult = goAsync()
        CoroutineScope(Dispatchers.IO).launch {
            try {
                val repository = AndroidMobileTaskRepository(context.applicationContext)
                if (markDone) repository.enqueueCompleteTask(taskId) else repository.enqueueReopenTask(taskId)
                updateAllNow(context.applicationContext)
            } catch (error: Exception) {
                Log.w("TaskenTodayWidget", "Widget Task action failed", error)
                updateAllNow(context.applicationContext)
            } finally {
                pendingResult.finish()
            }
        }
    }

    companion object {
        private const val ACTION_TOGGLE_TASK = "jp.personal.tasken.companion.action.TOGGLE_WIDGET_TASK"
        private const val EXTRA_TASK_ID = "task_id"
        private const val EXTRA_MARK_DONE = "mark_done"
        private val rowIds = listOf(
            Triple(R.id.widget_task_1, R.id.widget_task_1_button, R.id.widget_task_1_title),
            Triple(R.id.widget_task_2, R.id.widget_task_2_button, R.id.widget_task_2_title),
            Triple(R.id.widget_task_3, R.id.widget_task_3_button, R.id.widget_task_3_title),
        )

        fun updateAll(context: Context) {
            CoroutineScope(Dispatchers.IO).launch { updateAllNow(context.applicationContext) }
        }

        internal suspend fun updateAllNow(context: Context) {
            val manager = AppWidgetManager.getInstance(context)
            val ids = manager.getAppWidgetIds(ComponentName(context, TaskenTodayWidget::class.java))
            if (ids.isEmpty()) return
            val dao = MobileLocalDatabase.open(context).mobileDao()
            val snapshot = TaskenWidgetSnapshot(
                tasks = dao.tasksForDate(LocalDate.now().toString()).take(3).map {
                    TaskenWidgetTask(it.id, it.title, it.state == "done")
                },
                pendingCount = dao.pendingCount(),
                conflictCount = dao.conflictCount(),
                lastSuccessfulSyncAt = dao.syncState()?.lastSuccessfulSyncAt,
            )
            ids.forEach { manager.updateAppWidget(it, views(context, it, snapshot)) }
        }

        private fun views(context: Context, widgetId: Int, snapshot: TaskenWidgetSnapshot): RemoteViews =
            RemoteViews(context.packageName, R.layout.tasken_today_widget).apply {
                setOnClickPendingIntent(R.id.widget_header, openAppIntent(context, widgetId))
                setOnClickPendingIntent(R.id.widget_add, openAppIntent(context, widgetId + 10_000))
                setTextViewText(R.id.widget_status, statusText(snapshot))
                setViewVisibility(R.id.widget_empty, if (snapshot.tasks.isEmpty()) View.VISIBLE else View.GONE)
                rowIds.forEachIndexed { index, (rowId, buttonId, titleId) ->
                    val task = snapshot.tasks.getOrNull(index)
                    setViewVisibility(rowId, if (task == null) View.GONE else View.VISIBLE)
                    if (task != null) {
                        setTextViewText(buttonId, if (task.isDone) "↻" else "✓")
                        setTextViewText(titleId, task.title)
                        setOnClickPendingIntent(buttonId, toggleIntent(context, widgetId, index, task))
                        setOnClickPendingIntent(titleId, openAppIntent(context, widgetId + index + 1))
                    }
                }
            }

        internal fun statusText(snapshot: TaskenWidgetSnapshot): String = when {
            snapshot.conflictCount > 0 -> "競合 ${snapshot.conflictCount}件"
            snapshot.pendingCount > 0 -> "送信待ち ${snapshot.pendingCount}件"
            snapshot.lastSuccessfulSyncAt == null -> "未同期"
            else -> "同期済み"
        }

        private fun renderLoading(context: Context, manager: AppWidgetManager, widgetId: Int) {
            manager.updateAppWidget(
                widgetId,
                RemoteViews(context.packageName, R.layout.tasken_today_widget).apply {
                    setTextViewText(R.id.widget_status, "読込中")
                },
            )
        }

        private fun openAppIntent(context: Context, requestCode: Int): PendingIntent = PendingIntent.getActivity(
            context,
            requestCode,
            Intent(context, MainActivity::class.java),
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
        )

        private fun toggleIntent(
            context: Context,
            widgetId: Int,
            index: Int,
            task: TaskenWidgetTask,
        ): PendingIntent = PendingIntent.getBroadcast(
            context,
            widgetId * 10 + index,
            Intent(context, TaskenTodayWidget::class.java).apply {
                action = ACTION_TOGGLE_TASK
                putExtra(EXTRA_TASK_ID, task.id)
                putExtra(EXTRA_MARK_DONE, !task.isDone)
            },
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
        )
    }
}
