package jp.personal.tasken.companion

import android.Manifest
import android.annotation.SuppressLint
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import android.util.Log
import androidx.core.app.NotificationCompat
import androidx.core.content.ContextCompat
import com.google.android.gms.common.ConnectionResult
import com.google.android.gms.common.GoogleApiAvailability
import com.google.android.gms.location.Geofence
import com.google.android.gms.location.GeofencingEvent
import com.google.android.gms.location.GeofencingRequest
import com.google.android.gms.location.LocationServices
import com.google.android.gms.tasks.Task
import java.time.LocalDateTime
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.launch
import kotlinx.coroutines.suspendCancellableCoroutine
import kotlinx.coroutines.sync.withLock
import kotlin.coroutines.resume
import kotlin.coroutines.resumeWithException

/** 場所のリマインダーが、いま通知できる状態か。できないときは画面で見た目に出す。 */
enum class PlaceReminderReadiness {
    Ready,
    NoPlayServices,
    NoLocationPermission,
    /** 「常に許可」が無い。アプリを閉じていると位置が届かない。 */
    NoBackgroundLocation,
    NoNotificationPermission,
}

private const val TAG = "PlaceReminder"
private const val DWELL_MS = 3 * 60 * 1000
private const val RESPONSIVENESS_MS = 2 * 60 * 1000

/**
 * 場所つきの未完了 Task を、Play Services のジオフェンス（DWELL のみ・滞在 3 分）として登録し直す。
 * 駅の近くで GPS が揺れても、通り過ぎただけでは鳴らさないための滞在判定。
 * 登録は端末の再起動・位置情報オフ・Play Services のデータ消去で消えるので、起動時と変更時に毎回登録し直す。
 */
internal object PlaceReminderGeofences {
    fun playServicesAvailable(context: Context): Boolean =
        GoogleApiAvailability.getInstance().isGooglePlayServicesAvailable(context) == ConnectionResult.SUCCESS

    fun hasForegroundLocation(context: Context): Boolean =
        ContextCompat.checkSelfPermission(context, Manifest.permission.ACCESS_FINE_LOCATION) == PackageManager.PERMISSION_GRANTED

    fun hasBackgroundLocation(context: Context): Boolean =
        Build.VERSION.SDK_INT < 29 ||
            ContextCompat.checkSelfPermission(context, Manifest.permission.ACCESS_BACKGROUND_LOCATION) == PackageManager.PERMISSION_GRANTED

    fun readiness(context: Context): PlaceReminderReadiness = when {
        !playServicesAvailable(context) -> PlaceReminderReadiness.NoPlayServices
        !hasForegroundLocation(context) -> PlaceReminderReadiness.NoLocationPermission
        !hasBackgroundLocation(context) -> PlaceReminderReadiness.NoBackgroundLocation
        !MobileTaskNotifications.canPost(context) -> PlaceReminderReadiness.NoNotificationPermission
        else -> PlaceReminderReadiness.Ready
    }

    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)

    private val syncLock = kotlinx.coroutines.sync.Mutex()

    /** 画面や権限の結果から、待たずに登録し直す。reinstall は再起動・更新の後（OS が登録を消すので全部付け直す）。 */
    fun syncAsync(context: Context, reinstall: Boolean = false) {
        val app = context.applicationContext
        scope.launch { syncOrRetry(app, MobileLocalDatabase.open(app).mobileDao(), reinstall) }
    }

    /**
     * 登録に失敗したら（位置情報オフの 1000 など）、あとで WorkManager がやり直す。位置情報が戻れば登録される。
     * 失敗した回は OS の状態が分からないので、登録済みの記録を捨て、やり直しは全部付け直す。
     */
    suspend fun syncOrRetry(context: Context, dao: MobileLocalDao, reinstall: Boolean = false) {
        try {
            sync(context, dao, reinstall)
        } catch (error: kotlinx.coroutines.CancellationException) {
            throw error
        } catch (error: Exception) {
            Log.w(TAG, "Geofence sync failed; will retry", error)
            forgetAll(context)
            PlaceReminderWork.scheduleSyncRetry(context)
        }
    }

    /** OS 側の登録が消えた（エラーのイベント・位置情報オフ・Play Services のデータ消去）とき、記録も空にする。 */
    fun forgetAll(context: Context) = writeRegistered(context, emptyMap())

    /** その Task だけ付け直しの対象にする（OS の登録は同じ id の add で置き換わる）。 */
    fun forget(context: Context, taskId: String) = writeRegistered(context, readRegistered(context) - taskId)

    // 登録済みの集合（id→位置と半径の要約）。差分だけ登録するため、端末に持つ。
    private fun registeredStore(context: Context) = context.getSharedPreferences("place_reminder_geofences", Context.MODE_PRIVATE)

    private fun readRegistered(context: Context): Map<String, String> =
        registeredStore(context).all.mapNotNull { (k, v) -> (v as? String)?.let { k to it } }.toMap()

    private fun writeRegistered(context: Context, value: Map<String, String>) {
        registeredStore(context).edit().clear().apply { value.forEach { (k, v) -> putString(k, v) } }.apply()
    }

    /**
     * キャッシュの Task と登録済みの差分だけを OS に反映する。権限か Play Services が無ければ何も付けない。
     * 初期トリガーは DWELL: すでに中にいる Task も、滞在 3 分で通知する（1 日 1 回の抑制は発火側）。
     */
    @SuppressLint("MissingPermission")
    suspend fun sync(context: Context, dao: MobileLocalDao, reinstall: Boolean = false) = syncLock.withLock {
        dao.prunePlaceReminderNotices()
        if (!playServicesAvailable(context)) return@withLock
        val client = LocationServices.getGeofencingClient(context)
        val pendingIntent = pendingIntent(context)
        val permitted = hasForegroundLocation(context) && hasBackgroundLocation(context)
        var registered = readRegistered(context)
        if (reinstall || !permitted) {
            if (reinstall || registered.isNotEmpty()) {
                client.removeGeofences(pendingIntent).await()
                writeRegistered(context, emptyMap())
                registered = emptyMap()
            }
            if (!permitted) return@withLock
        }
        val targets = placeReminderGeofenceTargets(dao.tasks().map { it.toMobileTask() })
        val plan = planGeofenceChanges(registered, targets)
        if (plan.removeIds.isNotEmpty()) client.removeGeofences(plan.removeIds).await()
        if (plan.add.isNotEmpty()) {
            val geofences = plan.add.map { (taskId, place) ->
                Geofence.Builder()
                    .setRequestId(taskId)
                    .setCircularRegion(place.latitude, place.longitude, place.radiusMeters.toFloat())
                    .setTransitionTypes(Geofence.GEOFENCE_TRANSITION_DWELL)
                    .setLoiteringDelay(DWELL_MS)
                    // 既定の 5 分だと滞在 3 分の判定が遅れるので、2 分にする。
                    .setNotificationResponsiveness(RESPONSIVENESS_MS)
                    .setExpirationDuration(Geofence.NEVER_EXPIRE)
                    .build()
            }
            val request = GeofencingRequest.Builder().setInitialTrigger(GeofencingRequest.INITIAL_TRIGGER_DWELL).addGeofences(geofences).build()
            client.addGeofences(request, pendingIntent).await()
        }
        writeRegistered(context, targets.associate { it.first to geofenceSignature(it.second) })
    }

    private fun pendingIntent(context: Context): PendingIntent = PendingIntent.getBroadcast(
        context,
        0,
        Intent(context, PlaceReminderGeofenceReceiver::class.java),
        // Play Services が位置のイベントを足すので、MUTABLE が要る（明示的な Intent なので安全）。
        PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_MUTABLE,
    )
}

private suspend fun <T> Task<T>.await(): T = suspendCancellableCoroutine { continuation ->
    addOnSuccessListener { continuation.resume(it) }
    addOnFailureListener { continuation.resumeWithException(it) }
    addOnCanceledListener { continuation.cancel() }
}

internal object PlaceReminderNotifications {
    const val ChannelId = "tasken_place_reminder"
    private const val NotificationBaseId = 0x7a10

    fun createChannel(context: Context) {
        context.getSystemService(NotificationManager::class.java).createNotificationChannel(
            NotificationChannel(ChannelId, "場所のリマインダー", NotificationManager.IMPORTANCE_HIGH),
        )
    }

    /**
     * DWELL を受けた Task を通知してよいか決め、よければ出して「今日は通知した」を記録する。
     * 通知の権限が無いときは記録しない（あとで権限を付ければ今日のうちにまた届く）。
     */
    suspend fun deliver(
        context: Context,
        dao: MobileLocalDao,
        taskId: String,
        now: LocalDateTime,
        canPost: Boolean = MobileTaskNotifications.canPost(context),
        scheduleRefit: (String, LocalDateTime) -> Unit = { id, at -> PlaceReminderWork.scheduleRefit(context, id, at) },
    ): Boolean {
        val task = dao.task(taskId)
        val place = task?.let { decodeMobilePlaceReminder(it.placeReminderJson) }
        if (task == null || place == null || !PlaceReminderPolicy.isOpenTask(task.state)) {
            cancel(context, taskId)
            return false
        }
        val last = dao.placeReminderNoticeDate(taskId)?.let(java.time.LocalDate::parse)
        if (!PlaceReminderPolicy.shouldNotify(place, task.state, now, last)) {
            // 条件の外・通知済みで見送ると、中にいる間は二度と DWELL が来ない。次に合う時刻に付け直す。
            nextEligibleAt(place, task.state, now, last)?.let { scheduleRefit(taskId, it) }
            return false
        }
        if (!canPost) return false
        if (!dao.claimPlaceReminderNotice(taskId, now.toLocalDate().toString())) return false
        // 夜をまたいで同じ場所にいても、翌日の最初の合う時刻にまた付け直す。
        nextEligibleAt(place, task.state, now, now.toLocalDate())?.let { scheduleRefit(taskId, it) }
        createChannel(context)
        val open = if (MobileTaskLocator.isCanonicalTaskId(taskId)) PendingIntent.getActivity(
            context,
            notificationId(taskId),
            Intent(
                Intent.ACTION_VIEW,
                Uri.parse("${MobileTaskLocator.format(taskId)}?source=notification"),
                context,
                MainActivity::class.java,
            ).addFlags(Intent.FLAG_ACTIVITY_CLEAR_TOP or Intent.FLAG_ACTIVITY_SINGLE_TOP),
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
        ) else null
        context.getSystemService(NotificationManager::class.java).notify(
            tag(taskId),
            notificationId(taskId),
            NotificationCompat.Builder(context, ChannelId)
                .setSmallIcon(R.drawable.ic_tasken_notification)
                .setContentTitle(task.title)
                .setContentText(place.name)
                .setContentIntent(open)
                .setAutoCancel(true)
                .setCategory(NotificationCompat.CATEGORY_REMINDER)
                .build(),
        )
        return true
    }

    /** 完了・削除・場所を外された Task の、出ている通知を消す。 */
    fun cancel(context: Context, taskId: String) {
        context.getSystemService(NotificationManager::class.java).cancel(tag(taskId), notificationId(taskId))
    }

    /** 出ている場所の通知のうち、もう通知する理由が無い Task のものを消す。 */
    fun cancelNoLongerCurrent(context: Context, tasks: List<MobileTask>) {
        val manager = context.getSystemService(NotificationManager::class.java)
        val current = placeReminderGeofenceTargets(tasks).map { it.first }.toSet()
        manager.activeNotifications.filter { it.notification.channelId == ChannelId }.forEach { active ->
            val taskId = active.tag?.removePrefix("tasken-place:")
            if (taskId != null && taskId !in current) manager.cancel(active.tag, active.id)
        }
    }

    private fun tag(taskId: String) = "tasken-place:$taskId"
    private fun notificationId(taskId: String) = NotificationBaseId + (taskId.hashCode() and 0xffff)
}

class PlaceReminderGeofenceReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        val event = GeofencingEvent.fromIntent(intent) ?: return
        if (event.hasError()) {
            // GEOFENCE_NOT_AVAILABLE など。OS 側の登録が消えた見込みなので、記録を空にして、位置情報が戻ったら付け直す。
            Log.w(TAG, "Geofence error ${event.errorCode}")
            PlaceReminderGeofences.forgetAll(context)
            PlaceReminderWork.scheduleSyncRetry(context)
            return
        }
        if (event.geofenceTransition != Geofence.GEOFENCE_TRANSITION_DWELL) return
        val taskIds = event.triggeringGeofences.orEmpty().map { it.requestId }
        if (taskIds.isEmpty()) return
        val app = context.applicationContext
        val pending = goAsync()
        CoroutineScope(SupervisorJob() + Dispatchers.IO).launch {
            try {
                val dao = MobileLocalDatabase.open(app).mobileDao()
                val now = LocalDateTime.now()
                taskIds.forEach { PlaceReminderNotifications.deliver(app, dao, it, now) }
            } catch (error: kotlinx.coroutines.CancellationException) {
                throw error
            } catch (error: Exception) {
                Log.w(TAG, "Place reminder delivery failed", error)
            } finally {
                pending.finish()
            }
        }
    }
}

/** 再起動でジオフェンスは消える。アプリのプロセスを起こせば TaskenCompanionApp が登録し直す。 */
class PlaceReminderBootReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        if (intent.action == Intent.ACTION_BOOT_COMPLETED || intent.action == Intent.ACTION_MY_PACKAGE_REPLACED) {
            // 再起動・更新で OS はジオフェンスを消す。全部を付け直し、終わるまで受け手を生かす。
            val app = context.applicationContext
            val pending = goAsync()
            CoroutineScope(SupervisorJob() + Dispatchers.IO).launch {
                try {
                    PlaceReminderGeofences.syncOrRetry(app, MobileLocalDatabase.open(app).mobileDao(), reinstall = true)
                } finally {
                    pending.finish()
                }
            }
        }
    }
}
