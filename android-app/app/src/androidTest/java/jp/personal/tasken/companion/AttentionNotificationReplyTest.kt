package jp.personal.tasken.companion

import android.Manifest
import android.app.NotificationManager
import android.content.Context
import android.os.Build
import androidx.test.core.app.ApplicationProvider
import androidx.test.platform.app.InstrumentationRegistry
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Before
import org.junit.Test

/** 要対応の通知から、開かずに返信できる入口があること。 */
class AttentionNotificationReplyTest {
    private val context = ApplicationProvider.getApplicationContext<Context>()
    private val manager get() = context.getSystemService(NotificationManager::class.java)

    @Before fun grant() {
        if (Build.VERSION.SDK_INT >= 33) {
            InstrumentationRegistry.getInstrumentation().uiAutomation.grantRuntimePermission(
                context.packageName,
                Manifest.permission.POST_NOTIFICATIONS,
            )
        }
    }

    @After fun clear() = MobileAttentionNotifications.cancel(context)

    @Test fun singleQuestionOffersInlineReply() {
        MobileAttentionNotifications.notifyArrivals(context, listOf(row(canReply = true)), "server-1")
        val reply = postedActions().singleOrNull { it.title == "返信" }
        assertNotNull(reply)
        val input = reply!!.remoteInputs.single()
        assertEquals(MobileAttentionNotifications.KEY_REPLY_TEXT, input.resultKey)
    }

    @Test fun reviewWithoutReplyAndSeveralArrivalsOnlyOpenTheApp() {
        MobileAttentionNotifications.notifyArrivals(context, listOf(row(canReply = false)), "server-1")
        assertNull(postedActions().firstOrNull { it.title == "返信" })
        MobileAttentionNotifications.notifyArrivals(
            context,
            listOf(row(canReply = true), row(canReply = true).copy(attentionId = "task-work:request:2")),
            "server-1",
        )
        assertNull(postedActions(expectedCount = 2).firstOrNull { it.title == "返信" })
    }

    /** 通知の反映は非同期。期待する件数の通知が並ぶまで短く待つ。 */
    private fun postedActions(expectedCount: Int = 1): List<android.app.Notification.Action> {
        val deadline = android.os.SystemClock.uptimeMillis() + 3_000
        while (true) {
            val posted = manager.activeNotifications.firstOrNull {
                it.packageName == context.packageName && it.id == 0x7A4E &&
                    it.notification.extras.getCharSequence("android.title")?.contains("${expectedCount}件") == true
            }
            if (posted != null) return posted.notification.actions?.toList().orEmpty()
            check(android.os.SystemClock.uptimeMillis() < deadline) { "要対応の通知が出ませんでした" }
            Thread.sleep(50)
        }
    }

    private fun row(canReply: Boolean) = AttentionRow(
        attentionId = "task-work:request:1",
        kind = if (canReply) AttentionKind.AnswerRequest else AttentionKind.ReviewReport,
        taskId = "task-viscosity",
        taskTitle = "粘度測定の条件を決める",
        taskVersion = 12,
        headline = "測定温度が決まっていません。",
        summary = "測定温度が決まっていません。",
        questionOrAction = "25℃と40℃のどちらで進めますか。",
        agentLabel = "Codex",
        requestId = "33333333-3333-4333-8333-333333333333",
        canReply = canReply,
    )
}
