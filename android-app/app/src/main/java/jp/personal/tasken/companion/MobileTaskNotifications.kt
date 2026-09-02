package jp.personal.tasken.companion

import android.Manifest
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.util.Log
import androidx.activity.ComponentActivity
import androidx.core.app.NotificationCompat
import androidx.core.content.ContextCompat
import androidx.lifecycle.lifecycleScope
import java.time.Instant
import java.util.UUID
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

/** Notification adapter accepts only a durable delivery projection, never Preview/Task/Receipt bodies. */
internal object MobileTaskNotifications {
    private const val ChannelId = "tasken_task_updates"
    private val smallIconResId = R.drawable.ic_tasken_notification
    private const val ExtraDeliveryId = "jp.personal.tasken.companion.notification.DELIVERY_ID"
    private const val ExtraServerId = "jp.personal.tasken.companion.notification.SERVER_ID"
    private const val ExtraTaskId = "jp.personal.tasken.companion.notification.TASK_ID"
    private const val OpenAction = "open"
    private const val LaterAction = "later"

    fun createChannel(context: Context) {
        val manager = context.getSystemService(NotificationManager::class.java)
        manager.createNotificationChannel(
            NotificationChannel(ChannelId, "Taskの更新", NotificationManager.IMPORTANCE_DEFAULT).apply {
                description = "AI作業の確認待ち・停止中をお知らせします。"
            },
        )
    }

    suspend fun drain(context: Context, dao: MobileLocalDao) {
        if (!canPost(context)) return
        val serverId = dao.syncState()?.serverId?.takeIf(String::isNotBlank) ?: return
        createChannel(context)
        val manager = context.getSystemService(NotificationManager::class.java)
        cancelNotificationsFromOtherServers(manager, serverId)
        cancelNotificationsNoLongerCurrent(manager, dao, serverId)
        dao.pendingTaskNotificationDeliveries(serverId).forEach { delivery ->
            val notificationId = notificationId(delivery.deliveryId)
            val notificationTag = notificationTag(delivery.serverId, delivery.deliveryId)
            val open = PendingIntent.getActivity(
                context,
                notificationId,
                Intent(context, MobileTaskNotificationOpenActivity::class.java)
                    .setAction(actionIdentity(delivery.serverId, delivery.deliveryId, OpenAction))
                    .putExtra(ExtraServerId, delivery.serverId)
                    .putExtra(ExtraDeliveryId, delivery.deliveryId)
                    .putExtra(ExtraTaskId, delivery.taskId),
                PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
            )
            val later = PendingIntent.getBroadcast(
                context,
                notificationId,
                Intent(context, MobileTaskNotificationLaterReceiver::class.java)
                    .setAction(actionIdentity(delivery.serverId, delivery.deliveryId, LaterAction))
                    .putExtra(ExtraServerId, delivery.serverId)
                    .putExtra(ExtraDeliveryId, delivery.deliveryId),
                PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
            )
            manager.notify(
                notificationTag,
                notificationId,
                NotificationCompat.Builder(context, ChannelId)
                    .setSmallIcon(smallIconResId)
                    .setContentTitle("Tasken: 確認が必要な作業があります")
                    .setContentText("アプリで開いて確認してください。")
                    .setContentIntent(open)
                    .addAction(0, "開く", open)
                    .addAction(0, "後で", later)
                    .setAutoCancel(true)
                    .setOnlyAlertOnce(true)
                    .setVisibility(NotificationCompat.VISIBILITY_PRIVATE)
                    .build(),
            )
            if (dao.markTaskNotificationDelivered(delivery.deliveryId, serverId, Instant.now().toString()) == 0) {
                manager.cancel(notificationTag, notificationId)
            }
        }
    }

    internal fun actionIdentity(serverId: String, deliveryId: String, action: String): String =
        "jp.personal.tasken.companion.notification.$action.${stableIdentity(serverId, deliveryId)}"

    internal fun notificationTag(serverId: String, deliveryId: String): String =
        "${serverTagPrefix(serverId)}${stableIdentity(serverId, deliveryId)}"

    internal fun isServerBoundTag(tag: String?, serverId: String): Boolean =
        tag?.startsWith(serverTagPrefix(serverId)) == true

    internal fun isActiveServer(expectedServerId: String, activeServerId: String?): Boolean =
        expectedServerId.isNotBlank() && expectedServerId == activeServerId

    internal fun cancel(context: Context, serverId: String, deliveryId: String) {
        context.getSystemService(NotificationManager::class.java).cancel(
            notificationTag(serverId, deliveryId),
            notificationId(deliveryId),
        )
    }

    internal fun isExpectedAction(intent: Intent, action: String): Boolean {
        val serverId = intent.getStringExtra(ExtraServerId).orEmpty()
        val deliveryId = intent.getStringExtra(ExtraDeliveryId).orEmpty()
        return serverId.isNotBlank() && deliveryId.isNotBlank() &&
            intent.action == actionIdentity(serverId, deliveryId, action)
    }

    internal fun serverId(intent: Intent): String = intent.getStringExtra(ExtraServerId).orEmpty()

    internal fun deliveryId(intent: Intent): String = intent.getStringExtra(ExtraDeliveryId).orEmpty()

    internal fun taskId(intent: Intent): String = intent.getStringExtra(ExtraTaskId).orEmpty()

    private fun stableIdentity(serverId: String, deliveryId: String): String = UUID.nameUUIDFromBytes(
        "tasken-notification-v2|$serverId|$deliveryId".toByteArray(Charsets.UTF_8),
    ).toString()

    private fun serverTagPrefix(serverId: String): String {
        val serverIdentity = UUID.nameUUIDFromBytes(
            "tasken-notification-server-v1|$serverId".toByteArray(Charsets.UTF_8),
        )
        return "tasken-task:$serverIdentity:"
    }

    private fun cancelNotificationsFromOtherServers(manager: NotificationManager, serverId: String) {
        manager.activeNotifications
            .filter { it.notification.channelId == ChannelId && !isServerBoundTag(it.tag, serverId) }
            .forEach { notification ->
                if (notification.tag == null) manager.cancel(notification.id)
                else manager.cancel(notification.tag, notification.id)
            }
    }

    private suspend fun cancelNotificationsNoLongerCurrent(
        manager: NotificationManager,
        dao: MobileLocalDao,
        serverId: String,
    ) {
        dao.deliveredTaskNotificationDeliveries(serverId).forEach { delivery ->
            val proposal = if (delivery.workState == "pending_proposal") {
                delivery.receiptId?.let { dao.taskWorkProposal(it, serverId) }
            } else {
                null
            }
            if (!delivery.matchesCurrentState(dao.task(delivery.taskId), proposal)) {
                manager.cancel(
                    notificationTag(delivery.serverId, delivery.deliveryId),
                    notificationId(delivery.deliveryId),
                )
                dao.markTaskNotificationCancelled(delivery.deliveryId, serverId)
            }
        }
    }

    private fun notificationId(deliveryId: String): Int = deliveryId.hashCode()

    fun canPost(context: Context): Boolean =
        Build.VERSION.SDK_INT < 33 || ContextCompat.checkSelfPermission(
            context,
            Manifest.permission.POST_NOTIFICATIONS,
        ) == PackageManager.PERMISSION_GRANTED
}

class MobileTaskNotificationOpenActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        if (!MobileTaskNotifications.isExpectedAction(intent, "open")) {
            finish()
            return
        }
        val expectedServerId = MobileTaskNotifications.serverId(intent)
        val deliveryId = MobileTaskNotifications.deliveryId(intent)
        val taskId = MobileTaskNotifications.taskId(intent)
        if (!MobileTaskLocator.isCanonicalTaskId(taskId)) {
            finish()
            return
        }
        lifecycleScope.launch {
            try {
                val activeServerId = withContext(Dispatchers.IO) {
                    MobileLocalDatabase.open(applicationContext).mobileDao().syncState()?.serverId
                }
                if (MobileTaskNotifications.isActiveServer(expectedServerId, activeServerId)) {
                    startActivity(
                        Intent(
                            Intent.ACTION_VIEW,
                            Uri.parse("${MobileTaskLocator.format(taskId)}?source=notification"),
                            this@MobileTaskNotificationOpenActivity,
                            MainActivity::class.java,
                        ).addFlags(Intent.FLAG_ACTIVITY_CLEAR_TOP or Intent.FLAG_ACTIVITY_SINGLE_TOP),
                    )
                }
            } catch (error: CancellationException) {
                throw error
            } catch (error: Exception) {
                Log.w("TaskenTaskNotification", "Notification Task locator could not be opened", error)
            } finally {
                MobileTaskNotifications.cancel(applicationContext, expectedServerId, deliveryId)
                finish()
            }
        }
    }
}

class MobileTaskNotificationLaterReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        if (!MobileTaskNotifications.isExpectedAction(intent, "later")) return
        MobileTaskNotifications.cancel(
            context,
            MobileTaskNotifications.serverId(intent),
            MobileTaskNotifications.deliveryId(intent),
        )
    }
}
