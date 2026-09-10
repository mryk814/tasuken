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
    val themeColor: Int? = null,
    val section: String? = null,
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

/** Light chart tokens mirror TaskVisuals.taskenThemeColor so the dot matches the app. */
internal fun widgetThemeColorInt(token: String?): Int = when (token?.trim()) {
    "chart-2" -> 0xFF2D7FB8.toInt()
    "chart-3" -> 0xFF2E8B57.toInt()
    "chart-4" -> 0xFFC77D29.toInt()
    "chart-5" -> 0xFF6D5BC7.toInt()
    "chart-6" -> 0xFF7C746E.toInt()
    "theme-extra-1" -> 0xFF6B5B9E.toInt()
    "theme-extra-2" -> 0xFF2FA39A.toInt()
    "theme-extra-3" -> 0xFF7BA23F.toInt()
    "theme-extra-4" -> 0xFF8A7FC0.toInt()
    else -> 0xFF8A2F3B.toInt()
}

internal fun widgetSectionFor(todayDate: String?, today: String): String = when {
    todayDate == null -> "日付なし"
    todayDate < today -> "期限切れ"
    todayDate == today -> "今日"
    else -> "今後"
}

internal fun orderWidgetTasks(
    tasks: List<TaskenWidgetTask>,
    today: String,
    todayDates: Map<String, String?>,
): List<TaskenWidgetTask> {
    val rank = mapOf("期限切れ" to 0, "今日" to 1, "今後" to 2, "日付なし" to 3)
    return tasks.sortedWith(
        compareBy({ rank[widgetSectionFor(todayDates[it.id], today)] ?: 9 }, { it.title }),
    )
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
        internal const val ACTION_TOGGLE_TASK = "jp.personal.tasken.companion.action.TOGGLE_WIDGET_TASK"
        internal const val EXTRA_TASK_ID = "task_id"
        internal const val EXTRA_MARK_DONE = "mark_done"
        const val ACTION_TOGGLE_TASK_PUBLIC = ACTION_TOGGLE_TASK
        const val EXTRA_TASK_ID_PUBLIC = EXTRA_TASK_ID
        const val EXTRA_MARK_DONE_PUBLIC = EXTRA_MARK_DONE
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
                manager.notifyAppWidgetViewDataChanged(id, R.id.widget_list)
            }
        }

        private suspend fun updateOneNow(
            context: Context,
            manager: AppWidgetManager,
            widgetId: Int,
            options: Bundle,
        ) {
            manager.updateAppWidget(widgetId, views(context, widgetId, loadSnapshot(context), options))
            manager.notifyAppWidgetViewDataChanged(widgetId, R.id.widget_list)
        }

        internal suspend fun loadListItems(
            context: Context,
            today: String,
            limit: Int,
        ): List<TaskenWidgetListItem> {
            val snapshot = loadSnapshot(context, today)
            val rows = snapshot.tasks.take(limit)
            val items = mutableListOf<TaskenWidgetListItem>()
            var lastSection: String? = null
            rows.forEach { task ->
                val section = task.section
                if (section != null && section != lastSection) {
                    items += TaskenWidgetListItem.Header(section)
                    lastSection = section
                }
                items += TaskenWidgetListItem.Row(task)
            }
            return items
        }

        private suspend fun loadSnapshot(context: Context, today: String = LocalDate.now().toString()): TaskenWidgetSnapshot {
            val dao = MobileLocalDatabase.open(context).mobileDao()
            val themesById = dao.themes().associate { it.id to it }
            val allTasks = dao.tasks()
            val ordered = orderWidgetTasks(
                allTasks.map {
                    val theme = it.themeId?.let(themesById::get)
                    val requiresWorkReceipt = it.workState in widgetStateActionWorkStates
                    TaskenWidgetTask(
                        id = it.id,
                        title = it.title,
                        isDone = it.state == "done",
                        themeTitle = theme?.title,
                        themeColor = theme?.let { widgetThemeColorInt(it.color) },
                        section = widgetSectionFor(it.todayDate, today),
                        isPending = it.optimisticCommandId != null,
                        hasConflict = it.conflictCommandId != null,
                        requiresWorkReceipt = requiresWorkReceipt,
                        canToggleState = canToggleTaskState(dao, it),
                    )
                }.filter { task ->
                    // Keep the widget focused: overdue + dated + undated open work, capped by mode limit.
                    task.section != null
                },
                today,
                allTasks.associate { it.id to it.todayDate },
            ).take(MAX_TASK_COUNT)
            return TaskenWidgetSnapshot(
                tasks = ordered,
                totalTaskCount = ordered.size,
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
                ),
                SizeF(LARGE_WIDTH_DP, LARGE_HEIGHT_DP) to taskViews(
                    context,
                    widgetId,
                    snapshot,
                    TaskenWidgetMode.Large,
                    R.layout.tasken_today_widget_large,
                ),
                SizeF(WIDE_WIDTH_DP, WIDE_HEIGHT_DP) to taskViews(
                    context,
                    widgetId,
                    snapshot,
                    TaskenWidgetMode.Wide,
                    R.layout.tasken_today_widget_wide,
                ),
                SizeF(WIDE_WIDTH_DP, LARGE_HEIGHT_DP) to taskViews(
                    context,
                    widgetId,
                    snapshot,
                    TaskenWidgetMode.Large,
                    R.layout.tasken_today_widget_large,
                ),
                SizeF(LARGE_WIDTH_DP, TALL_HEIGHT_DP) to taskViews(
                    context,
                    widgetId,
                    snapshot,
                    TaskenWidgetMode.Tall,
                    R.layout.tasken_today_widget_large,
                ),
                SizeF(WIDE_WIDTH_DP, TALL_HEIGHT_DP) to taskViews(
                    context,
                    widgetId,
                    snapshot,
                    TaskenWidgetMode.Tall,
                    R.layout.tasken_today_widget_large,
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
            TaskenWidgetMode.Medium -> taskViews(context, widgetId, snapshot, mode, R.layout.tasken_today_widget)
            TaskenWidgetMode.Large -> taskViews(context, widgetId, snapshot, mode, R.layout.tasken_today_widget_large)
            TaskenWidgetMode.Tall -> taskViews(context, widgetId, snapshot, mode, R.layout.tasken_today_widget_large)
            TaskenWidgetMode.Wide -> taskViews(context, widgetId, snapshot, mode, R.layout.tasken_today_widget_wide)
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
        ): RemoteViews = RemoteViews(context.packageName, layoutId).apply {
            val visibleTasks = snapshot.tasks.take(mode.taskLimit)
            setOnClickPendingIntent(R.id.widget_open_today, openAppIntent(context, widgetId, "tasken://today?source=widget"))
            bindAddAction(context, widgetId)
            bindVoiceAction(context, widgetId)
            setTextViewText(R.id.widget_status, statusText(snapshot))
            setOnClickPendingIntent(R.id.widget_status, openAppIntent(context, widgetId + 30_000, "tasken://today?source=widget"))
            if (hasLayoutElement(layoutId, "widget_count")) {
                setTextViewText(R.id.widget_count, taskCountText(snapshot))
            }
            val hasItems = visibleTasks.isNotEmpty()
            setViewVisibility(R.id.widget_empty, if (hasItems) View.GONE else View.VISIBLE)
            setViewVisibility(R.id.widget_list, if (hasItems) View.VISIBLE else View.GONE)
            setRemoteAdapter(R.id.widget_list, Intent(context, TaskenWidgetViewsService::class.java))
            setEmptyView(R.id.widget_list, R.id.widget_empty)
            setPendingIntentTemplate(
                R.id.widget_list,
                PendingIntent.getActivity(
                    context,
                    widgetId + 40_000,
                    Intent(Intent.ACTION_VIEW, Uri.parse("tasken://today?source=widget"), context, MainActivity::class.java),
                    PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_MUTABLE,
                ),
            )
        }

        private fun hasLayoutElement(layoutId: Int, name: String): Boolean = when (layoutId) {
            R.layout.tasken_today_widget_large, R.layout.tasken_today_widget_wide -> name == "widget_count"
            else -> false
        }

        private fun RemoteViews.bindAddAction(context: Context, widgetId: Int) {
            setOnClickPendingIntent(
                R.id.widget_add,
                openAppIntent(context, widgetId + 10_000, "tasken://capture/new?source=widget"),
            )
        }

        private fun RemoteViews.bindVoiceAction(context: Context, widgetId: Int) {
            setOnClickPendingIntent(
                R.id.widget_voice,
                openAppIntent(context, widgetId + 20_000, "tasken://capture/new?voice=1&source=widget"),
            )
        }

        internal fun taskText(task: TaskenWidgetTask): String {
            val attention = when {
                task.hasConflict -> "競合"
                task.requiresWorkReceipt -> "要確認"
                else -> null
            }
            return buildString {
                if (attention != null) append(attention).append(" ・ ")
                append(task.title)
            }
        }

        internal fun rowViews(context: Context, task: TaskenWidgetTask): RemoteViews =
            RemoteViews(context.packageName, R.layout.tasken_widget_list_row).apply {
                setTextViewText(R.id.widget_row_title, taskText(task))
                setImageViewResource(
                    R.id.widget_row_button,
                    when {
                        task.hasConflict || task.requiresWorkReceipt -> R.drawable.ic_tabler_alert_triangle
                        task.isDone -> R.drawable.ic_tabler_circle_check
                        else -> R.drawable.ic_tabler_circle
                    },
                )
                setContentDescription(
                    R.id.widget_row_button,
                    when {
                        task.hasConflict -> "競合を確認: ${task.title}"
                        task.requiresWorkReceipt -> "Work Receiptを確認: ${task.title}"
                        !task.canToggleState -> "同期状況を確認: ${task.title}"
                        task.isDone -> "Taskを再開: ${task.title}"
                        else -> "Taskを完了: ${task.title}"
                    },
                )
                if (task.themeColor != null) {
                    setViewVisibility(R.id.widget_row_dot, View.VISIBLE)
                    setInt(R.id.widget_row_dot, "setColorFilter", task.themeColor)
                } else {
                    setViewVisibility(R.id.widget_row_dot, View.INVISIBLE)
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
    }
}
