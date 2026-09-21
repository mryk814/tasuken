package jp.personal.tasken.companion

import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.net.Uri
import androidx.core.app.NotificationCompat

/**
 * 要対応の新着を短く知らせる（#601）。
 *
 * - 既定では出さない。利用者が「要対応の新着を通知」を有効にしたときだけ出す。
 * - 出すのは**新規発生の判断があるとき**だけで、本文は件数と最初の質問だけにする。
 *   行の本文全体を通知へ写さない。
 * - タップすると `tasken://attention/<判断ID>` を開き、その判断へ移動する（deep link）。
 * - 同じ判断では一度しか出さない（`AttentionNotificationStore` が記録する）。
 */
internal object MobileAttentionNotifications {
    private const val ChannelId = "tasken_attention_updates"
    private val smallIconResId = R.drawable.ic_tasken_notification

    fun createChannel(context: Context) {
        val manager = context.getSystemService(NotificationManager::class.java)
        manager.createNotificationChannel(
            NotificationChannel(ChannelId, "要対応の新着", NotificationManager.IMPORTANCE_DEFAULT).apply {
                description = "質問・判断依頼・成果確認が新しく届いたときにお知らせします。"
            },
        )
    }

    /** 新着の判断を1件の通知にまとめる。 */
    fun notifyArrivals(context: Context, rows: List<AttentionRow>, serverId: String) {
        if (rows.isEmpty()) return
        if (!MobileTaskNotifications.canPost(context)) return
        createChannel(context)
        val first = rows.first()
        val body = if (rows.size == 1) {
            first.headline
        } else {
            "${first.headline} ほか${rows.size - 1}件"
        }
        val intent = Intent(Intent.ACTION_VIEW, attentionUri(first.attentionId), context, MainActivity::class.java)
            .addFlags(Intent.FLAG_ACTIVITY_CLEAR_TOP or Intent.FLAG_ACTIVITY_SINGLE_TOP)
            .putExtra(EXTRA_SERVER_ID, serverId)
        val contentIntent = PendingIntent.getActivity(
            context,
            NotificationId,
            intent,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
        )
        context.getSystemService(NotificationManager::class.java).notify(
            NotificationId,
            NotificationCompat.Builder(context, ChannelId)
                .setSmallIcon(smallIconResId)
                .setContentTitle("Tasken: 対応待ちが${rows.size}件あります")
                .setContentText(body)
                .setContentIntent(contentIntent)
                .setAutoCancel(true)
                .setOnlyAlertOnce(true)
                .setVisibility(NotificationCompat.VISIBILITY_PRIVATE)
                .build(),
        )
    }

    internal fun attentionUri(attentionId: String): Uri =
        Uri.parse("tasken://attention/${Uri.encode(attentionId)}")

    internal fun cancel(context: Context) {
        context.getSystemService(NotificationManager::class.java).cancel(NotificationId)
    }

    internal const val EXTRA_SERVER_ID = "jp.personal.tasken.companion.extra.ATTENTION_SERVER_ID"
    private const val NotificationId = 0x7A4E
}
