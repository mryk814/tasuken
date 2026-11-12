package jp.personal.tasken.companion

import android.app.Application
import android.util.Log
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.conflate
import kotlinx.coroutines.flow.distinctUntilChanged
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
        // 場所のリマインダー（#727）。起動時・同期の後・Task の変更後・再起動後（Boot の受け手がプロセスを起こす）に、
        // 場所つきの未完了 Task が変わったときだけジオフェンスを登録し直し、不要になった通知を消す。
        scope.launch {
            try {
                val dao = MobileLocalDatabase.open(applicationContext).mobileDao()
                dao.observeAllTasks()
                    .map { rows -> rows.map { it.task.toMobileTask() } }
                    .distinctUntilChanged { old, new -> placeReminderGeofenceTargets(old) == placeReminderGeofenceTargets(new) }
                    .collect { tasks ->
                        // 1 回の登録失敗で監視を止めない（Play Services の一時的な不調は次の変更で直る）。
                        try {
                            PlaceReminderNotifications.cancelNoLongerCurrent(applicationContext, tasks)
                            PlaceReminderGeofences.sync(applicationContext, dao)
                        } catch (error: kotlinx.coroutines.CancellationException) {
                            throw error
                        } catch (error: Exception) {
                            Log.w("TaskenCompanionApp", "Place reminder sync failed", error)
                        }
                    }
            } catch (error: kotlinx.coroutines.CancellationException) {
                throw error
            } catch (error: Exception) {
                Log.w("TaskenCompanionApp", "Place reminder observer stopped", error)
            }
        }
    }
}
