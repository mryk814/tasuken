package jp.personal.tasken.companion

import android.Manifest
import android.app.NotificationManager
import android.content.Context
import android.content.pm.PackageManager
import android.os.Build
import androidx.core.content.ContextCompat

/**
 * 通知の権限と、もう使わない通知チャンネルの片付け。
 *
 * AI の作業の確認（要対応・作業報告の採否）はスマホから外した（#755 束9a）。その知らせに使っていた
 * 2 つのチャンネルは、Android の決まりどおり deleteNotificationChannel で消す。消したチャンネルに
 * 出ていた通知も一緒に消える。ほかのチャンネル（場所のリマインダー）には触らない。
 */
internal object TaskenNotifications {
    /** 束9a で外したチャンネル。ID は前の版と同じ文字にする（違うと消せない）。 */
    internal val RetiredChannelIds = listOf(
        // 「要対応の新着」: 質問・判断依頼・成果確認の新着。
        "tasken_attention_updates",
        // 「Taskの更新」: AI 作業の確認待ち・停止中と、新しい案の着信。
        "tasken_task_updates",
    )

    fun retireRemovedChannels(context: Context) {
        val manager = context.getSystemService(NotificationManager::class.java)
        RetiredChannelIds.forEach { id ->
            if (manager.getNotificationChannel(id) != null) manager.deleteNotificationChannel(id)
        }
    }

    fun canPost(context: Context): Boolean =
        Build.VERSION.SDK_INT < 33 || ContextCompat.checkSelfPermission(
            context,
            Manifest.permission.POST_NOTIFICATIONS,
        ) == PackageManager.PERMISSION_GRANTED
}
