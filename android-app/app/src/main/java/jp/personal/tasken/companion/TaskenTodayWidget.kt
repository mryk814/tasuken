package jp.personal.tasken.companion

import android.annotation.TargetApi
import android.app.PendingIntent
import android.appwidget.AppWidgetManager
import android.appwidget.AppWidgetProvider
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.util.Log
import android.util.SizeF
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
    val themeTitle: String? = null,
    val isPending: Boolean = false,
    val hasConflict: Boolean = false,
    val requiresWorkReceipt: Boolean = false,
    val canToggleState: Boolean = !isPending && !hasConflict && !requiresWorkReceipt,
)

data class TaskenWidgetSnapshot(
    val tasks: List<TaskenWidgetTask>,
    val pendingCount: Int,
    val conflictCount: Int,
    val lastSuccessfulSyncAt: String?,
    val totalTaskCount: Int = tasks.size,
)

internal enum class TaskenWidgetMode(val taskLimit: Int) {
    Small(0),
    Medium(2),
    Large(4),
    Tall(6),
    Wide(2),
}

internal fun widgetModeFor(widthDp: Int, heightDp: Int): TaskenWidgetMode = when {
    widthDp < 180 || heightDp < 150 -> TaskenWidgetMode.Small
    heightDp >= 316 -> TaskenWidgetMode.Tall
    heightDp >= 230 -> TaskenWidgetMode.Large
    widthDp >= 360 && heightDp >= 180 -> TaskenWidgetMode.Wide
    else -> TaskenWidgetMode.Medium
}

class TaskenTodayWidget : AppWidgetProvider() {
    override fun onUpdate(context: Context, manager: AppWidgetManager, appWidgetIds: IntArray) {
        appWidgetIds.forEach { renderLoading(context, manager, it, manager.getAppWidgetOptions(it)) }
        val pendingResult = goAsync()
        CoroutineScope(Dispatchers.IO).launch {
            try {
                updateAllNow(context.applicationContext)
            } finally {
                pendingResult.finish()
            }
        }
    }

    override fun onAppWidgetOptionsChanged(
        context: Context,
        appWidgetManager: AppWidgetManager,
        appWidgetId: Int,
        newOptions: Bundle,
    ) {
        super.onAppWidgetOptionsChanged(context, appWidgetManager, appWidgetId, newOptions)
        renderLoading(context, appWidgetManager, appWidgetId, newOptions)
        val pendingResult = goAsync()
        CoroutineScope(Dispatchers.IO).launch {
            try {
                updateOneNow(context.applicationContext, appWidgetManager, appWidgetId, newOptions)
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
                val applicationContext = context.applicationContext
                val dao = MobileLocalDatabase.open(applicationContext).mobileDao()
                val task = dao.task(taskId)
                if (task == null || !canToggleTaskState(dao, task)) {
                    updateAllNow(applicationContext)
                    return@launch
                }
                val repository = AndroidMobileTaskRepository(applicationContext)
                if (markDone) repository.enqueueCompleteTask(taskId) else repository.enqueueReopenTask(taskId)
                updateAllNow(applicationContext)
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
        private const val MAX_TASK_COUNT = 6
        private const val SMALL_WIDTH_DP = 110f
        private const val SMALL_HEIGHT_DP = 60f
        private const val MEDIUM_WIDTH_DP = 180f
        private const val MEDIUM_HEIGHT_DP = 150f
        private const val LARGE_WIDTH_DP = 180f
        private const val LARGE_HEIGHT_DP = 230f
        private const val TALL_HEIGHT_DP = 316f
        private const val WIDE_WIDTH_DP = 360f
        private const val WIDE_HEIGHT_DP = 180f
        private val widgetStateActionWorkStates = setOf("needs_human_review", "reported_done", "blocked")
        private val mediumRowIds = listOf(
            Triple(R.id.widget_task_1, R.id.widget_task_1_button, R.id.widget_task_1_title),
            Triple(R.id.widget_task_2, R.id.widget_task_2_button, R.id.widget_task_2_title),
            Triple(R.id.widget_task_3, R.id.widget_task_3_button, R.id.widget_task_3_title),
        )
        private val expandedRowIds = mediumRowIds + listOf(
            Triple(R.id.widget_task_4, R.id.widget_task_4_button, R.id.widget_task_4_title),
            Triple(R.id.widget_task_5, R.id.widget_task_5_button, R.id.widget_task_5_title),
            Triple(R.id.widget_task_6, R.id.widget_task_6_button, R.id.widget_task_6_title),
        )

        fun updateAll(context: Context) {
            CoroutineScope(Dispatchers.IO).launch { updateAllNow(context.applicationContext) }
        }

        internal suspend fun updateAllNow(context: Context) {
            val manager = AppWidgetManager.getInstance(context)
            val ids = manager.getAppWidgetIds(ComponentName(context, TaskenTodayWidget::class.java))
            if (ids.isEmpty()) return
            val snapshot = loadSnapshot(context)
            ids.forEach { id ->
                manager.updateAppWidget(id, views(context, id, snapshot, manager.getAppWidgetOptions(id)))
            }
        }

        private suspend fun updateOneNow(
            context: Context,
            manager: AppWidgetManager,
            widgetId: Int,
            options: Bundle,
        ) {
            manager.updateAppWidget(widgetId, views(context, widgetId, loadSnapshot(context), options))
        }

        private suspend fun loadSnapshot(context: Context): TaskenWidgetSnapshot {
            val dao = MobileLocalDatabase.open(context).mobileDao()
            val themesById = dao.themes().associate { it.id to it.title }
            val todayTasks = dao.tasksForDate(LocalDate.now().toString())
            return TaskenWidgetSnapshot(
                tasks = todayTasks.take(MAX_TASK_COUNT).map {
                    val requiresWorkReceipt = it.workState in widgetStateActionWorkStates
                    TaskenWidgetTask(
                        id = it.id,
                        title = it.title,
                        isDone = it.state == "done",
                        themeTitle = it.themeId?.let(themesById::get),
                        isPending = it.optimisticCommandId != null,
                        hasConflict = it.conflictCommandId != null,
                        requiresWorkReceipt = requiresWorkReceipt,
                        canToggleState = canToggleTaskState(dao, it),
                    )
                },
                totalTaskCount = todayTasks.size,
                pendingCount = dao.pendingCount(),
                conflictCount = dao.conflictCount(),
                lastSuccessfulSyncAt = dao.syncState()?.lastSuccessfulSyncAt,
            )
        }

        private fun views(
            context: Context,
            widgetId: Int,
            snapshot: TaskenWidgetSnapshot,
            options: Bundle,
        ): RemoteViews = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            responsiveViews(context, widgetId, snapshot)
        } else {
            viewsForMode(context, widgetId, snapshot, modeFrom(options))
        }

        @TargetApi(Build.VERSION_CODES.S)
        private fun responsiveViews(context: Context, widgetId: Int, snapshot: TaskenWidgetSnapshot): RemoteViews = RemoteViews(
            linkedMapOf(
                SizeF(SMALL_WIDTH_DP, SMALL_HEIGHT_DP) to smallViews(context, widgetId),
                SizeF(MEDIUM_WIDTH_DP, MEDIUM_HEIGHT_DP) to taskViews(
                    context,
                    widgetId,
                    snapshot,
                    TaskenWidgetMode.Medium,
                    R.layout.tasken_today_widget,
                    mediumRowIds,
                ),
                SizeF(LARGE_WIDTH_DP, LARGE_HEIGHT_DP) to taskViews(
                    context,
                    widgetId,
                    snapshot,
                    TaskenWidgetMode.Large,
                    R.layout.tasken_today_widget_large,
                    expandedRowIds,
                ),
                SizeF(WIDE_WIDTH_DP, WIDE_HEIGHT_DP) to taskViews(
                    context,
                    widgetId,
                    snapshot,
                    TaskenWidgetMode.Wide,
                    R.layout.tasken_today_widget_wide,
                    expandedRowIds,
                ),
                SizeF(WIDE_WIDTH_DP, LARGE_HEIGHT_DP) to taskViews(
                    context,
                    widgetId,
                    snapshot,
                    TaskenWidgetMode.Large,
                    R.layout.tasken_today_widget_large,
                    expandedRowIds,
                ),
                SizeF(LARGE_WIDTH_DP, TALL_HEIGHT_DP) to taskViews(
                    context,
                    widgetId,
                    snapshot,
                    TaskenWidgetMode.Tall,
                    R.layout.tasken_today_widget_large,
                    expandedRowIds,
                ),
                SizeF(WIDE_WIDTH_DP, TALL_HEIGHT_DP) to taskViews(
                    context,
                    widgetId,
                    snapshot,
                    TaskenWidgetMode.Tall,
                    R.layout.tasken_today_widget_large,
                    expandedRowIds,
                ),
            ),
        )

        private fun viewsForMode(
            context: Context,
            widgetId: Int,
            snapshot: TaskenWidgetSnapshot,
            mode: TaskenWidgetMode,
        ): RemoteViews = when (mode) {
            TaskenWidgetMode.Small -> smallViews(context, widgetId)
            TaskenWidgetMode.Medium -> taskViews(context, widgetId, snapshot, mode, R.layout.tasken_today_widget, mediumRowIds)
            TaskenWidgetMode.Large -> taskViews(context, widgetId, snapshot, mode, R.layout.tasken_today_widget_large, expandedRowIds)
            TaskenWidgetMode.Tall -> taskViews(context, widgetId, snapshot, mode, R.layout.tasken_today_widget_large, expandedRowIds)
            TaskenWidgetMode.Wide -> taskViews(context, widgetId, snapshot, mode, R.layout.tasken_today_widget_wide, expandedRowIds)
        }

        private fun smallViews(context: Context, widgetId: Int): RemoteViews =
            RemoteViews(context.packageName, R.layout.tasken_today_widget_small).apply {
                bindAddAction(context, widgetId)
            }

        private fun taskViews(
            context: Context,
            widgetId: Int,
            snapshot: TaskenWidgetSnapshot,
            mode: TaskenWidgetMode,
            layoutId: Int,
            rows: List<Triple<Int, Int, Int>>,
        ): RemoteViews = RemoteViews(context.packageName, layoutId).apply {
            val visibleTasks = snapshot.tasks.take(mode.taskLimit)
            setOnClickPendingIntent(R.id.widget_open_today, openAppIntent(context, widgetId, "tasken://today?source=widget"))
            bindAddAction(context, widgetId)
            setTextViewText(R.id.widget_status, statusText(snapshot))
            setOnClickPendingIntent(R.id.widget_status, openAppIntent(context, widgetId + 30_000, "tasken://today?source=widget"))
            setViewVisibility(R.id.widget_empty, if (visibleTasks.isEmpty()) View.VISIBLE else View.GONE)
            if (mode == TaskenWidgetMode.Large || mode == TaskenWidgetMode.Tall || mode == TaskenWidgetMode.Wide) {
                setTextViewText(R.id.widget_count, taskCountText(snapshot))
            }
            bindRows(context, widgetId, visibleTasks, rows)
        }

        private fun RemoteViews.bindAddAction(context: Context, widgetId: Int) {
            setOnClickPendingIntent(
                R.id.widget_add,
                openAppIntent(context, widgetId + 10_000, "tasken://capture/new?source=widget"),
            )
        }

        private fun RemoteViews.bindRows(
            context: Context,
            widgetId: Int,
            tasks: List<TaskenWidgetTask>,
            rows: List<Triple<Int, Int, Int>>,
        ) {
            rows.forEachIndexed { index, (rowId, buttonId, titleId) ->
                val task = tasks.getOrNull(index)
                setViewVisibility(rowId, if (task == null) View.GONE else View.VISIBLE)
                if (task == null) return@forEachIndexed
                val taskIntent = openAppIntent(
                    context,
                    widgetId * 100 + index + 1,
                    "${MobileTaskLocator.format(task.id)}?source=widget",
                )
                setImageViewResource(
                    buttonId,
                    when {
                        task.hasConflict || task.requiresWorkReceipt -> R.drawable.ic_tabler_alert_triangle
                        task.isDone -> R.drawable.ic_tabler_circle_check
                        else -> R.drawable.ic_tabler_circle
                    },
                )
                setTextViewText(titleId, taskText(task))
                setContentDescription(
                    buttonId,
                    when {
                        task.hasConflict -> "競合を確認: ${task.title}"
                        task.requiresWorkReceipt -> "Work Receiptを確認: ${task.title}"
                        !task.canToggleState -> "同期状況を確認: ${task.title}"
                        task.isDone -> "Taskを再開: ${task.title}"
                        else -> "Taskを完了: ${task.title}"
                    },
                )
                setOnClickPendingIntent(
                    buttonId,
                    if (task.canToggleState) toggleIntent(context, widgetId, index, task) else taskIntent,
                )
                setOnClickPendingIntent(titleId, taskIntent)
            }
        }

        internal fun taskText(task: TaskenWidgetTask): String {
            val theme = task.themeTitle?.trim()?.takeIf { it.isNotEmpty() }
            val attention = when {
                task.hasConflict -> "競合"
                task.requiresWorkReceipt -> "要確認"
                task.isPending -> "送信待ち"
                else -> null
            }
            return buildString {
                if (attention != null) append(attention).append(" ・ ")
                append(task.title)
                if (theme != null) append(" ・ ").append(theme)
            }
        }

        private suspend fun canToggleTaskState(dao: MobileLocalDao, task: TaskCacheEntity): Boolean {
            if (task.conflictCommandId != null || task.workState in widgetStateActionWorkStates) return false
            val commandId = task.optimisticCommandId ?: return true
            val optimisticCommand = dao.outbox(commandId) ?: return false
            return optimisticCommand.state == OutboxState.Pending &&
                optimisticCommand.attemptCount == 0 &&
                optimisticCommand.commandName in setOf("CreateTask", "CompleteTask", "ReopenTask")
        }

        internal fun taskCountText(snapshot: TaskenWidgetSnapshot): String =
            snapshot.totalTaskCount.takeIf { it > 0 }?.let { "${it}件" }.orEmpty()

        internal fun statusText(snapshot: TaskenWidgetSnapshot): String = when {
            snapshot.conflictCount > 0 -> "競合 ${snapshot.conflictCount}件"
            snapshot.pendingCount > 0 -> "送信待ち ${snapshot.pendingCount}件"
            snapshot.lastSuccessfulSyncAt == null -> "未同期"
            else -> ""
        }

        private fun modeFrom(options: Bundle): TaskenWidgetMode {
            val width = options.getInt(AppWidgetManager.OPTION_APPWIDGET_MIN_WIDTH).takeIf { it > 0 }
                ?: MEDIUM_WIDTH_DP.toInt()
            val height = options.getInt(AppWidgetManager.OPTION_APPWIDGET_MIN_HEIGHT).takeIf { it > 0 }
                ?: MEDIUM_HEIGHT_DP.toInt()
            return widgetModeFor(width, height)
        }

        private fun renderLoading(
            context: Context,
            manager: AppWidgetManager,
            widgetId: Int,
            options: Bundle,
        ) {
            val loading = TaskenWidgetSnapshot(emptyList(), 0, 0, null)
            manager.updateAppWidget(widgetId, views(context, widgetId, loading, options))
        }

        private fun openAppIntent(context: Context, requestCode: Int, uri: String): PendingIntent = PendingIntent.getActivity(
            context,
            requestCode,
            Intent(Intent.ACTION_VIEW, Uri.parse(uri), context, MainActivity::class.java),
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
