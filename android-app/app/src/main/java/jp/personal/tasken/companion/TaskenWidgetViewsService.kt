package jp.personal.tasken.companion

import android.content.Context
import android.content.Intent
import android.net.Uri
import android.view.View
import android.widget.RemoteViews
import android.widget.RemoteViewsService
import java.time.LocalDate
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.runBlocking

internal sealed interface TaskenWidgetListItem {
    data class Header(val title: String) : TaskenWidgetListItem
    data class Row(val task: TaskenWidgetTask) : TaskenWidgetListItem
}

class TaskenWidgetViewsService : RemoteViewsService() {
    override fun onGetViewFactory(intent: Intent): RemoteViewsFactory =
        TaskenWidgetViewsFactory(applicationContext)
}

private class TaskenWidgetViewsFactory(
    private val context: Context,
) : RemoteViewsService.RemoteViewsFactory {
    private var items: List<TaskenWidgetListItem> = emptyList()
    private var limit: Int = TaskenTodayWidget.WIDGET_LIST_LIMIT

    override fun onCreate() = Unit

    override fun onDataSetChanged() {
        limit = TaskenTodayWidget.WIDGET_LIST_LIMIT
        items = runBlocking(Dispatchers.IO) {
            TaskenTodayWidget.loadListItems(context, LocalDate.now().toString(), limit)
        }
    }

    override fun onDestroy() {
        items = emptyList()
    }

    override fun getCount(): Int = items.size

    override fun getViewAt(position: Int): RemoteViews {
        if (position < 0 || position >= items.size) {
            return RemoteViews(context.packageName, R.layout.tasken_widget_section_row).apply {
                setTextViewText(R.id.widget_section_title, "")
            }
        }
        return when (val item = items[position]) {
            is TaskenWidgetListItem.Header -> RemoteViews(context.packageName, R.layout.tasken_widget_section_row).apply {
                setTextViewText(R.id.widget_section_title, item.title)
            }
            is TaskenWidgetListItem.Row -> {
                val task = item.task
                TaskenTodayWidget.rowViews(context, task).apply {
                    val openFill = Intent().apply {
                        data = Uri.parse("${MobileTaskLocator.format(task.id)}?source=widget")
                    }
                    setOnClickFillInIntent(R.id.widget_row_title, openFill)
                    if (task.canToggleState) {
                        val toggleFill = Intent().apply {
                            action = TaskenTodayWidget.ACTION_TOGGLE_TASK_PUBLIC
                            putExtra(TaskenTodayWidget.EXTRA_TASK_ID_PUBLIC, task.id)
                            putExtra(TaskenTodayWidget.EXTRA_MARK_DONE_PUBLIC, !task.isDone)
                        }
                        setOnClickFillInIntent(R.id.widget_row_button, toggleFill)
                    } else {
                        setOnClickFillInIntent(R.id.widget_row_button, openFill)
                    }
                }
            }
        }
    }

    override fun getLoadingView(): RemoteViews? = null

    override fun getViewTypeCount(): Int = 2

    override fun getItemId(position: Int): Long = position.toLong()

    override fun hasStableIds(): Boolean = false
}
