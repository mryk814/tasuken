package jp.personal.tasken.companion

import android.content.Context
import androidx.work.BackoffPolicy
import androidx.work.CoroutineWorker
import androidx.work.Data
import androidx.work.ExistingWorkPolicy
import androidx.work.OneTimeWorkRequestBuilder
import androidx.work.WorkManager
import androidx.work.WorkerParameters
import java.time.Duration
import java.time.LocalDateTime

/** 場所のリマインダーの、あとからやり直す仕事（付け直しと登録のやり直し）。 */
object PlaceReminderWork {
    private const val KeyTaskId = "taskId"

    /**
     * その Task のジオフェンスを at に付け直す。DWELL を条件の外で見送った後も、まだ中にいれば
     * INITIAL_TRIGGER_DWELL でそこから滞在 3 分後に鳴る。厳密な時刻ではない（Doze で遅れうる）。
     */
    fun scheduleRefit(context: Context, taskId: String, at: LocalDateTime) {
        val delay = Duration.between(LocalDateTime.now(), at).coerceAtLeast(Duration.ofMinutes(1))
        val request = OneTimeWorkRequestBuilder<PlaceReminderWorker>()
            .setInitialDelay(delay)
            .setInputData(Data.Builder().putString(KeyTaskId, taskId).build())
            .build()
        WorkManager.getInstance(context.applicationContext)
            .enqueueUniqueWork("tasken-place-refit-$taskId", ExistingWorkPolicy.REPLACE, request)
    }

    /** 登録に失敗した（位置情報オフなど）後のやり直し。失敗し続けても間隔を延ばして続ける。 */
    fun scheduleSyncRetry(context: Context) {
        val request = OneTimeWorkRequestBuilder<PlaceReminderWorker>()
            .setInitialDelay(Duration.ofMinutes(15))
            .setBackoffCriteria(BackoffPolicy.EXPONENTIAL, Duration.ofMinutes(15))
            .build()
        WorkManager.getInstance(context.applicationContext)
            .enqueueUniqueWork("tasken-place-sync-retry", ExistingWorkPolicy.KEEP, request)
    }

    internal fun taskIdOf(data: Data): String? = data.getString(KeyTaskId)
}

class PlaceReminderWorker(context: Context, params: WorkerParameters) : CoroutineWorker(context, params) {
    override suspend fun doWork(): Result {
        val dao = MobileLocalDatabase.open(applicationContext).mobileDao()
        val taskId = PlaceReminderWork.taskIdOf(inputData)
        return try {
            if (taskId != null) {
                PlaceReminderGeofences.forget(applicationContext, taskId)
                PlaceReminderGeofences.sync(applicationContext, dao, reinstall = false)
            } else {
                PlaceReminderGeofences.sync(applicationContext, dao, reinstall = true)
            }
            Result.success()
        } catch (error: kotlinx.coroutines.CancellationException) {
            throw error
        } catch (error: Exception) {
            PlaceReminderGeofences.forgetAll(applicationContext)
            Result.retry()
        }
    }
}
