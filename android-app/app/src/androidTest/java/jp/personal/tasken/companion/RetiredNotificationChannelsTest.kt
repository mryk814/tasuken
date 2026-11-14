package jp.personal.tasken.companion

import android.app.NotificationChannel
import android.app.NotificationManager
import androidx.test.platform.app.InstrumentationRegistry
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Test

/** 束9a で外した AI の作業の確認の 2 チャンネルだけを消し、場所のリマインダーには触らない（#755）。 */
class RetiredNotificationChannelsTest {
    @Test
    fun retiresOnlyTheAiReviewChannels() {
        val context = InstrumentationRegistry.getInstrumentation().targetContext
        val manager = context.getSystemService(NotificationManager::class.java)
        TaskenNotifications.RetiredChannelIds.forEach { id ->
            manager.createNotificationChannel(NotificationChannel(id, id, NotificationManager.IMPORTANCE_DEFAULT))
        }
        PlaceReminderNotifications.createChannel(context)

        TaskenNotifications.retireRemovedChannels(context)
        // 二度目の起動でも落ちない（もう無いチャンネルは消そうとしない）。
        TaskenNotifications.retireRemovedChannels(context)

        TaskenNotifications.RetiredChannelIds.forEach { id -> assertNull(manager.getNotificationChannel(id)) }
        assertNotNull(manager.getNotificationChannel(PlaceReminderNotifications.ChannelId))
    }
}
