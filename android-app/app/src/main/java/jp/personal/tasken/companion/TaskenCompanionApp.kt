package jp.personal.tasken.companion

import android.app.Application
import android.util.Log
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.conflate
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.flow.merge
import kotlinx.coroutines.launch

/** Emits whenever locally cached Task or Theme data changes. */
internal fun widgetRefreshTriggers(dao: MobileLocalDao): Flow<Unit> =
    merge(
        dao.observeAllTasks().map { },
        dao.observeThemes().map { },
    )

class TaskenCompanionApp : Application() {
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Default)

    override fun onCreate() {
        super.onCreate()
        MobileOutboxScheduler.ensurePeriodicSync(this)
        MobileTaskNotifications.createChannel(this)
        TaskenTodayWidget.updateAll(this)
        // アプリ内のTask・Theme変更をウィジェットへ即時反映する。
        // 定期同期だけでは完了・編集・追加が次の同期まで古いままになる。
        scope.launch {
            try {
                val dao = MobileLocalDatabase.open(applicationContext).mobileDao()
                widgetRefreshTriggers(dao).conflate()
                    .collect { TaskenTodayWidget.updateAllNow(applicationContext) }
            } catch (error: Exception) {
                Log.w("TaskenCompanionApp", "Widget refresh observer stopped", error)
            }
        }
    }
}
