package jp.personal.tasken.companion

import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.content.BroadcastReceiver
import android.util.Log
import androidx.core.app.NotificationCompat
import androidx.core.app.RemoteInput
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch

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
        val builder = NotificationCompat.Builder(context, ChannelId)
            .setSmallIcon(smallIconResId)
            .setContentTitle("Tasken: 対応待ちが${rows.size}件あります")
            .setContentText(body)
            .setContentIntent(contentIntent)
            .setAutoCancel(true)
            .setOnlyAlertOnce(true)
            .setVisibility(NotificationCompat.VISIBILITY_PRIVATE)
        // 1件の質問なら、開かずに通知から返信できる。送れなかったときは本文を残して知らせる。
        if (rows.size == 1 && first.canReply) builder.addAction(replyAction(context, first.attentionId))
        context.getSystemService(NotificationManager::class.java).notify(NotificationId, builder.build())
    }

    private fun replyAction(context: Context, attentionId: String): NotificationCompat.Action {
        val intent = Intent(context, AttentionReplyReceiver::class.java)
            .setAction(ACTION_REPLY)
            .putExtra(EXTRA_ATTENTION_ID, attentionId)
        // RemoteInputで入力を受け取るため、この PendingIntent だけは可変にする。
        val pending = PendingIntent.getBroadcast(
            context,
            attentionId.hashCode(),
            intent,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_MUTABLE,
        )
        val input = RemoteInput.Builder(KEY_REPLY_TEXT).setLabel("返信").build()
        return NotificationCompat.Action.Builder(R.drawable.ic_tabler_send, "返信", pending)
            .addRemoteInput(input)
            .setAllowGeneratedReplies(false)
            .setSemanticAction(NotificationCompat.Action.SEMANTIC_ACTION_REPLY)
            .build()
    }

    /** 通知から送った返信の結果。失敗時は書いた文を消さずに通知へ残す。 */
    internal fun showReplyResult(context: Context, sent: Boolean, message: String, draft: String?) {
        if (!MobileTaskNotifications.canPost(context)) return
        createChannel(context)
        val open = PendingIntent.getActivity(
            context,
            NotificationId,
            Intent(context, MainActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_CLEAR_TOP or Intent.FLAG_ACTIVITY_SINGLE_TOP),
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
        )
        val text = if (sent || draft.isNullOrBlank()) message else "$message\n書いた返信: $draft"
        context.getSystemService(NotificationManager::class.java).notify(
            NotificationId,
            NotificationCompat.Builder(context, ChannelId)
                .setSmallIcon(smallIconResId)
                .setContentTitle(if (sent) "Tasken: 返信しました" else "Tasken: 返信を送れませんでした")
                .setContentText(message)
                .setStyle(NotificationCompat.BigTextStyle().bigText(text))
                .setContentIntent(open)
                .setAutoCancel(true)
                .setOnlyAlertOnce(true)
                .setTimeoutAfter(if (sent) 4_000L else 0L)
                .setVisibility(NotificationCompat.VISIBILITY_PRIVATE)
                .build(),
        )
    }

    internal fun attentionUri(attentionId: String): Uri =
        Uri.parse("tasken://attention/${Uri.encode(attentionId)}")

    internal fun cancel(context: Context) {
        context.getSystemService(NotificationManager::class.java).cancel(NotificationId)
    }

    internal const val ACTION_REPLY = "jp.personal.tasken.companion.action.ATTENTION_REPLY"
    internal const val EXTRA_ATTENTION_ID = "jp.personal.tasken.companion.extra.ATTENTION_ID"
    internal const val KEY_REPLY_TEXT = "tasken_attention_reply"
    internal const val EXTRA_SERVER_ID = "jp.personal.tasken.companion.extra.ATTENTION_SERVER_ID"
    private const val NotificationId = 0x7A4E
}

/**
 * 通知の「返信」から、アプリを開かずにAIへ答える。
 * 送る前に端末が知っている最新の判断と照合し、版の食い違いはDesktopが競合として返す。
 */
class AttentionReplyReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        if (intent.action != MobileAttentionNotifications.ACTION_REPLY) return
        val attentionId = intent.getStringExtra(MobileAttentionNotifications.EXTRA_ATTENTION_ID) ?: return
        val body = RemoteInput.getResultsFromIntent(intent)
            ?.getCharSequence(MobileAttentionNotifications.KEY_REPLY_TEXT)
            ?.toString()?.trim().orEmpty()
        if (body.isEmpty()) return
        val appContext = context.applicationContext
        val pendingResult = goAsync()
        CoroutineScope(Dispatchers.IO).launch {
            try {
                val repository = AndroidMobileTaskRepository(appContext)
                val row = repository.cachedAttentionSnapshot().items.firstOrNull { it.attentionId == attentionId }
                if (row == null || !row.canReply) {
                    MobileAttentionNotifications.showReplyResult(appContext, false, "この質問はもう対応待ちにありません。", body)
                    return@launch
                }
                when (val result = repository.replyToAgent(row, null, body)) {
                    is MobileAgentReplyResult.Applied -> {
                        MobileAttentionNotifications.showReplyResult(appContext, true, agentDisplayStateLabel(result.displayState), null)
                        TaskenTodayWidget.updateAllNow(appContext)
                    }
                    is MobileAgentReplyResult.Conflict ->
                        MobileAttentionNotifications.showReplyResult(appContext, false, result.message, body)
                    is MobileAgentReplyResult.Rejected ->
                        MobileAttentionNotifications.showReplyResult(appContext, false, result.message, body)
                    is MobileAgentReplyResult.Unavailable ->
                        MobileAttentionNotifications.showReplyResult(appContext, false, result.message, body)
                }
            } catch (error: Exception) {
                Log.w("AttentionReply", "Notification reply failed", error)
                MobileAttentionNotifications.showReplyResult(appContext, false, "送れませんでした。アプリで開いて再送してください。", body)
            } finally {
                pendingResult.finish()
            }
        }
    }
}
