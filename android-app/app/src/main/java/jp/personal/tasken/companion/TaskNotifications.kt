package jp.personal.tasken.companion

import android.app.AlarmManager
import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Build
import android.util.Log
import androidx.core.app.NotificationCompat
import java.time.Duration
import java.time.Instant
import java.time.LocalDateTime
import java.time.LocalTime
import java.time.ZoneId
import java.time.format.DateTimeFormatter
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.launch
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock

private const val TAG = "TaskNotification"

/**
 * 期限の日の知らせの時刻と、もう出した知らせの控え。この端末だけの設定で、同期しない
 * （Desktop は Desktop の設定を持つ。朝に見る端末と時刻は端末ごとに違ってよい）。
 */
internal object TaskNotificationSettings {
    private const val KeyDueTimes = "dueTimes"

    private fun settings(context: Context) = context.getSharedPreferences("task_notifications", Context.MODE_PRIVATE)

    private fun firedStore(context: Context) = context.getSharedPreferences("task_notifications_fired", Context.MODE_PRIVATE)

    fun dueTimes(context: Context): List<LocalTime> =
        TaskNotificationPlan.normalizeDueTimes(settings(context).getString(KeyDueTimes, null).orEmpty().split(","))

    fun setDueTimes(context: Context, times: List<LocalTime>) {
        val normalized = TaskNotificationPlan.normalizeDueTimes(times.map { it.format(DateTimeFormatter.ofPattern("HH:mm")) })
        settings(context).edit().putString(KeyDueTimes, normalized.joinToString(",") { it.format(DateTimeFormatter.ofPattern("HH:mm")) }).apply()
    }

    fun fired(context: Context): Map<String, String> =
        firedStore(context).all.mapNotNull { (key, value) -> (value as? String)?.let { key to it } }.toMap()

    fun writeFired(context: Context, fired: Map<String, String>) {
        firedStore(context).edit().clear().apply { fired.forEach { (key, value) -> putString(key, value) } }.apply()
    }
}

/**
 * 時刻と期限の知らせを、端末の写しから組んで出す（#753）。
 *
 * アラームは「次の知らせの時刻」に 1 本だけ掛ける。鳴ったら、出すべき知らせを出して、次の 1 本を掛け直す。
 * 掛け直すのは、Task が変わった時・設定を変えた時・アラームが鳴った時・再起動やアプリの更新の後・時計や時差が変わった時。
 * 正確なアラームが許されていない端末では、近い時刻に鳴るアラーム（Doze の間は数分〜十数分遅れうる）に落とす。
 */
internal object TaskNotificationScheduler {
    const val ChannelId = "tasken_task_reminder"
    const val ExtraNoticeKind = "tasken.noticeKind"
    const val ExtraNoticeAt = "tasken.noticeAt"
    private const val NotificationBaseId = 0x7b10
    private const val GroupKey = "tasken-task-reminders"
    private const val SummaryTag = "tasken-time-summary"
    private const val SummaryId = 0x7b0f
    private const val TagPrefix = "tasken-time:"

    /** 消したばかりの通知。OS の一覧から消えるまでの間、まとめの件数に数えないための控え。 */
    private val pendingCancels = java.util.concurrent.ConcurrentHashMap.newKeySet<String>()
    private val StaleCopy: Duration = Duration.ofHours(24)
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)
    private val lock = Mutex()

    fun createChannel(context: Context) {
        context.getSystemService(NotificationManager::class.java).createNotificationChannel(
            NotificationChannel(ChannelId, "時刻と期限", NotificationManager.IMPORTANCE_HIGH).apply {
                // ロック画面には件数だけの公開版を出す（題名は、ロックを外した画面でだけ見える）。
                lockscreenVisibility = Notification.VISIBILITY_PRIVATE
            },
        )
    }

    /** 正確な時刻のアラームを掛けられるか。Android 12 以降は許可が要り、本人が後から外すこともある。 */
    fun canScheduleExact(context: Context): Boolean =
        Build.VERSION.SDK_INT < Build.VERSION_CODES.S || context.getSystemService(AlarmManager::class.java).canScheduleExactAlarms()

    fun syncAsync(context: Context) {
        val app = context.applicationContext
        scope.launch { syncOrLog(app) }
    }

    suspend fun syncOrLog(context: Context) {
        try {
            sync(context, MobileLocalDatabase.open(context).mobileDao())
        } catch (error: kotlinx.coroutines.CancellationException) {
            throw error
        } catch (error: Exception) {
            Log.w(TAG, "Task notification sync failed", error)
        }
    }

    /** 出すべき知らせを出し、理由の無くなった通知を消し、次の知らせの時刻にアラームを掛け直す。 */
    suspend fun sync(
        context: Context,
        dao: MobileLocalDao,
        now: LocalDateTime = LocalDateTime.now(),
        zone: ZoneId = ZoneId.systemDefault(),
        canPost: Boolean = TaskenNotifications.canPost(context),
        scheduleAlarm: (LocalDateTime?) -> Unit = { scheduleNext(context, it, zone) },
    ): List<TaskNotice> = lock.withLock {
        val rows = dao.tasks()
        val tasks = rows.map { it.toNotifiableTask() }
        val dueTimes = TaskNotificationSettings.dueTimes(context)
        cancelNoLongerCurrent(context, tasks, zone)
        val posted = deliver(context, tasks, dueTimes, now, zone, canPost, dao.syncState()?.lastSuccessfulSyncAt)
        updateSummary(context, posted, canPost)
        scheduleAlarm(TaskNotificationPlan.nextTriggerAt(tasks, dueTimes, now, zone))
        posted
    }

    private fun deliver(
        context: Context,
        tasks: List<NotifiableTask>,
        dueTimes: List<LocalTime>,
        now: LocalDateTime,
        zone: ZoneId,
        canPost: Boolean,
        lastSyncedAt: String?,
    ): List<TaskNotice> {
        val notices = TaskNotificationPlan.dueNotices(tasks, dueTimes, now, zone)
        val fired = TaskNotificationPlan.pruneFired(TaskNotificationSettings.fired(context), now.toLocalDate())
        val fresh = notices.filter { it.key !in fired }
        // 通知の権限が無い時は控えない（あとで権限を付ければ、その時に届く）。
        if (fresh.isEmpty() || !canPost) return emptyList()
        createChannel(context)
        val manager = context.getSystemService(NotificationManager::class.java)
        val staleNote = staleCopyNote(lastSyncedAt, now, zone)
        // 1 つの Task には通知を 1 つ。時刻と期限が同時に来たら、新しい方の文にする。
        fresh.groupBy { it.taskId }.forEach { (taskId, group) ->
            manager.notify(tag(taskId), notificationId(taskId), build(context, group.maxBy { it.at }, now, staleNote))
        }
        TaskNotificationSettings.writeFired(context, fired + fresh.associate { it.key to now.toLocalDate().toString() })
        return fresh
    }

    /**
     * 写しが古い（丸 1 日つながっていない）時は、通知にそのことを添える。
     * ほかの端末で完了・変更していても、この端末は知らないまま鳴るため。
     */
    internal fun staleCopyNote(lastSyncedAt: String?, now: LocalDateTime, zone: ZoneId): String? {
        val synced = lastSyncedAt?.let { runCatching { Instant.parse(it) }.getOrNull() } ?: return "未同期"
        val age = Duration.between(synced, now.atZone(zone).toInstant())
        if (age < StaleCopy) return null
        return "同期 ${age.toDays()}日前"
    }

    /**
     * まとめの通知。Android は同じアプリの通知を 1 つに束ね、ロック画面では束の見出しだけを出す。
     * 見出しに件数が出るよう、自分でまとめを持つ（題名は入れない）。
     * 通知が 1 つでも残っている間は消さない（まとめを消すと、Android は束の中の通知も一緒に消す）。
     */
    private fun updateSummary(context: Context, posted: List<TaskNotice>, canPost: Boolean) {
        val manager = context.getSystemService(NotificationManager::class.java)
        val active = manager.activeNotifications
            .filter { it.notification.channelId == ChannelId && it.tag?.startsWith(TagPrefix) == true }
        pendingCancels.retainAll(active.mapNotNull { it.tag }.toSet())
        val kinds: Map<String, TaskNoticeKind?> = active.filter { it.tag !in pendingCancels }.associate { shown ->
            shown.tag to shown.notification.extras.getString(ExtraNoticeKind)?.let { runCatching { TaskNoticeKind.valueOf(it) }.getOrNull() }
        } + posted.groupBy { it.taskId }.map { (taskId, group) -> tag(taskId) to group.maxBy { it.at }.kind }
        if (kinds.isEmpty()) {
            manager.cancel(SummaryTag, SummaryId)
            return
        }
        if (!canPost) return
        val text = summaryText(kinds.values.toList())
        // 文が同じなら出し直さない。Android は短い間に続く通知の更新を捨てる（1 秒に 5 回ほどまで）ので、
        // 要らない更新で、要る更新（件数が変わった時）が捨てられないようにする。捨てられても、次の同期で直る。
        val shownText = manager.activeNotifications.firstOrNull { it.tag == SummaryTag }
            ?.notification?.extras?.getCharSequence(Notification.EXTRA_TEXT)?.toString()
        if (shownText == text) return
        fun builder() = NotificationCompat.Builder(context, ChannelId)
            .setSmallIcon(R.drawable.ic_tasken_notification)
            .setContentTitle("Tasken")
            .setContentText(text)
        manager.notify(
            SummaryTag,
            SummaryId,
            builder()
                .setGroup(GroupKey)
                .setGroupSummary(true)
                .setGroupAlertBehavior(NotificationCompat.GROUP_ALERT_CHILDREN)
                .setOnlyAlertOnce(true)
                .setAutoCancel(true)
                .setVisibility(NotificationCompat.VISIBILITY_PRIVATE)
                .setPublicVersion(builder().build())
                .build(),
        )
    }

    /** まとめの文。種類ごとの件数だけ（例: Task の期限 2 件・時刻 1 件）。期限の時刻の知らせ（End）も期限に数える。 */
    internal fun summaryText(kinds: List<TaskNoticeKind?>): String {
        val due = kinds.count { it == TaskNoticeKind.Due || it == TaskNoticeKind.End }
        val time = kinds.count { it == TaskNoticeKind.Time }
        val parts = listOfNotNull(
            if (due > 0) "期限 $due 件" else null,
            if (time > 0) "時刻 $time 件" else null,
        )
        return if (parts.isEmpty() || due + time < kinds.size) "Task の知らせ ${kinds.size} 件" else "Task の${parts.joinToString("・")}"
    }

    /** 通知の見出し。期限の時刻の知らせ（End）は「あと30分で期限」など、ほかは Task の題名（#785）。 */
    internal fun titleText(notice: TaskNotice, now: LocalDateTime): String = when (notice.kind) {
        TaskNoticeKind.End -> TaskNotificationPlan.endNoticeTitle(notice.endAt, now)
        else -> notice.title
    }

    internal fun privateText(notice: TaskNotice, now: LocalDateTime): String = when (notice.kind) {
        TaskNoticeKind.Due -> {
            val day = if (notice.dueTomorrow) "明日" else "今日"
            notice.endAt?.let { "$day ${it.format(DateTimeFormatter.ofPattern("HH:mm"))} が期限" } ?: "${day}が期限"
        }
        // 本文は「HH:mm 題名」（Desktop の dueNoticeLine と同じ）。
        TaskNoticeKind.End -> TaskNotificationPlan.dueNoticeLine(notice)
        TaskNoticeKind.Time -> notice.at.format(
            DateTimeFormatter.ofPattern(if (notice.at.toLocalDate() == now.toLocalDate()) "HH:mm" else "M/d HH:mm"),
        )
    }

    /** ロック画面に出す文。題名は出さず、種類と件数だけ。 */
    internal fun publicText(kind: TaskNoticeKind): String = when (kind) {
        TaskNoticeKind.Due, TaskNoticeKind.End -> "Task の期限 1 件"
        TaskNoticeKind.Time -> "Task の時刻 1 件"
    }

    private fun build(context: Context, notice: TaskNotice, now: LocalDateTime, staleNote: String?): Notification {
        val open = if (MobileTaskLocator.isCanonicalTaskId(notice.taskId)) PendingIntent.getActivity(
            context,
            notificationId(notice.taskId),
            Intent(
                Intent.ACTION_VIEW,
                Uri.parse("${MobileTaskLocator.format(notice.taskId)}?source=notification"),
                context,
                MainActivity::class.java,
            ).addFlags(Intent.FLAG_ACTIVITY_CLEAR_TOP or Intent.FLAG_ACTIVITY_SINGLE_TOP),
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
        ) else null
        val publicVersion = NotificationCompat.Builder(context, ChannelId)
            .setSmallIcon(R.drawable.ic_tasken_notification)
            .setContentTitle("Tasken")
            .setContentText(publicText(notice.kind))
            .build()
        return NotificationCompat.Builder(context, ChannelId)
            .setSmallIcon(R.drawable.ic_tasken_notification)
            .setContentTitle(titleText(notice, now))
            .setContentText(privateText(notice, now))
            .setSubText(staleNote)
            .setContentIntent(open)
            .setAutoCancel(true)
            .setCategory(NotificationCompat.CATEGORY_REMINDER)
            .setGroup(GroupKey)
            .setGroupAlertBehavior(NotificationCompat.GROUP_ALERT_CHILDREN)
            .setVisibility(NotificationCompat.VISIBILITY_PRIVATE)
            .setPublicVersion(publicVersion)
            .addExtras(
                android.os.Bundle().apply {
                    putString(ExtraNoticeKind, notice.kind.name)
                    putString(ExtraNoticeAt, notice.at.toString())
                },
            )
            .addAction(0, "完了", actionIntent(context, notice, TaskNotificationAction.Complete))
            .addAction(0, "1 時間後", actionIntent(context, notice, TaskNotificationAction.SnoozeHour))
            .addAction(0, "明日", actionIntent(context, notice, TaskNotificationAction.SnoozeTomorrow))
            .build()
    }

    /** 通知から変えられなかった時は、通知を消さずにそのことを書く（本人が開いて確かめられるように）。 */
    fun showActionFailure(context: Context, taskId: String, title: String) {
        if (!TaskenNotifications.canPost(context)) return
        createChannel(context)
        val open = if (MobileTaskLocator.isCanonicalTaskId(taskId)) PendingIntent.getActivity(
            context,
            notificationId(taskId),
            Intent(Intent.ACTION_VIEW, Uri.parse("${MobileTaskLocator.format(taskId)}?source=notification"), context, MainActivity::class.java)
                .addFlags(Intent.FLAG_ACTIVITY_CLEAR_TOP or Intent.FLAG_ACTIVITY_SINGLE_TOP),
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
        ) else null
        context.getSystemService(NotificationManager::class.java).notify(
            tag(taskId),
            notificationId(taskId),
            NotificationCompat.Builder(context, ChannelId)
                .setSmallIcon(R.drawable.ic_tasken_notification)
                .setContentTitle(title)
                .setContentText("ここからは変えられませんでした。開いて確かめてください")
                .setContentIntent(open)
                .setAutoCancel(true)
                .setOnlyAlertOnce(true)
                .setGroup(GroupKey)
                .setGroupAlertBehavior(NotificationCompat.GROUP_ALERT_CHILDREN)
                .setVisibility(NotificationCompat.VISIBILITY_PRIVATE)
                .setPublicVersion(
                    NotificationCompat.Builder(context, ChannelId)
                        .setSmallIcon(R.drawable.ic_tasken_notification)
                        .setContentTitle("Tasken")
                        .setContentText("Task の知らせ 1 件")
                        .build(),
                )
                .build(),
        )
    }

    fun cancel(context: Context, taskId: String) {
        pendingCancels += tag(taskId)
        context.getSystemService(NotificationManager::class.java).cancel(tag(taskId), notificationId(taskId))
    }

    /**
     * 出ている通知のうち、理由の無くなったものを消す: 完了・中止・削除した Task、時刻を先へ送った（後で）Task、
     * 期限の日・期限の時刻・知らせを変えた Task。時刻が過ぎただけでは消さない（見ていない知らせを勝手に片付けない）。
     */
    private fun cancelNoLongerCurrent(context: Context, tasks: List<NotifiableTask>, zone: ZoneId) {
        val manager = context.getSystemService(NotificationManager::class.java)
        val byId = tasks.associateBy { it.id }
        manager.activeNotifications.filter { it.notification.channelId == ChannelId && it.tag?.startsWith(TagPrefix) == true }.forEach { active ->
            val taskId = active.tag.removePrefix(TagPrefix)
            val extras = active.notification.extras
            val kind = extras.getString(ExtraNoticeKind)?.let { runCatching { TaskNoticeKind.valueOf(it) }.getOrNull() }
            val at = extras.getString(ExtraNoticeAt)?.let { runCatching { LocalDateTime.parse(it) }.getOrNull() }
            if (!isStillCurrent(byId[taskId], kind, at, zone)) {
                pendingCancels += active.tag
                manager.cancel(active.tag, active.id)
            }
        }
    }

    internal fun isStillCurrent(task: NotifiableTask?, kind: TaskNoticeKind?, at: LocalDateTime?, zone: ZoneId): Boolean {
        if (task == null || !TaskNotificationPlan.isOpen(task.state)) return false
        // 「変えられませんでした」の通知（種類なし）は、Task が開いている間は残す。
        if (kind == null || at == null) return true
        return when (kind) {
            TaskNoticeKind.Time -> TaskNotificationPlan.parseReminderAt(task.reminderAt, zone) == at
            // 時刻の早い期限は前の日に知らせる（#785）ので、その時刻に出す日と比べる。
            TaskNoticeKind.Due -> TaskNotificationPlan.dueNoticeDate(task, at.toLocalTime()) == at.toLocalDate()
            TaskNoticeKind.End -> TaskNotificationPlan.endNoticeAt(task) == at
        }
    }

    private fun scheduleNext(context: Context, at: LocalDateTime?, zone: ZoneId) {
        val alarms = context.getSystemService(AlarmManager::class.java)
        val pendingIntent = PendingIntent.getBroadcast(
            context,
            0,
            Intent(context, TaskNotificationAlarmReceiver::class.java),
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
        )
        if (at == null) {
            alarms.cancel(pendingIntent)
            return
        }
        val triggerAt = at.atZone(zone).toInstant().toEpochMilli()
        if (canScheduleExact(context)) {
            try {
                alarms.setExactAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, triggerAt, pendingIntent)
                return
            } catch (error: SecurityException) {
                // 確かめた直後に許可を外された。近い時刻のアラームに落とす。
                Log.w(TAG, "Exact alarm denied; falling back to an inexact alarm", error)
            }
        }
        alarms.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, triggerAt, pendingIntent)
    }

    private fun actionIntent(context: Context, notice: TaskNotice, action: TaskNotificationAction): PendingIntent =
        PendingIntent.getBroadcast(
            context,
            0,
            Intent(context, TaskNotificationActionReceiver::class.java)
                // 押した通知と操作ごとに別の PendingIntent にする（extras だけでは同じものとして上書きされる）。
                .setData(Uri.parse("tasken-notification://${action.name}/${Uri.encode(notice.taskId)}"))
                .putExtra(TaskNotificationActionReceiver.ExtraTaskId, notice.taskId)
                .putExtra(TaskNotificationActionReceiver.ExtraAction, action.name)
                // 期限の通知か時刻の通知か。「後で」が Task の時刻を書いてよいかが、これで変わる。
                .putExtra(TaskNotificationActionReceiver.ExtraKind, notice.kind.name),
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
        )

    internal fun tag(taskId: String) = "$TagPrefix$taskId"
    internal fun notificationId(taskId: String) = NotificationBaseId + (taskId.hashCode() and 0xffff)
}

internal enum class TaskNotificationAction { Complete, SnoozeHour, SnoozeTomorrow }

/**
 * 通知の「完了」「1 時間後」「明日」。端末の写しに先に書き、未送信の列（outbox）で送る。
 * つながらなくても押した結果はすぐ端末に残り、つながった時に送られる。断られた変更は列に残って画面に出る。
 */
internal object TaskNotificationActions {
    suspend fun handle(
        context: Context,
        dao: MobileLocalDao,
        taskId: String,
        action: TaskNotificationAction,
        now: LocalDateTime = LocalDateTime.now(),
        zone: ZoneId = ZoneId.systemDefault(),
        kind: TaskNoticeKind? = null,
        complete: suspend (String) -> Unit = { AndroidMobileTaskRepository(context).enqueueCompleteTask(it) },
        snooze: suspend (String, String) -> Unit = { id, at -> AndroidMobileTaskRepository(context).enqueueUpdateTaskReminderAt(id, at) },
    ): Boolean {
        val task = dao.task(taskId)
        if (task == null || !TaskNotificationPlan.isOpen(task.state)) {
            // もう完了・削除されている。通知だけ片付ける。
            TaskNotificationScheduler.cancel(context, taskId)
            return true
        }
        return try {
            when (action) {
                TaskNotificationAction.Complete -> complete(taskId)
                // 期限の通知の「後で」は、本人が付けた先の時刻を上書きしない（通知を消すだけ。その時刻に鳴る）。
                TaskNotificationAction.SnoozeHour, TaskNotificationAction.SnoozeTomorrow ->
                    if (TaskNotificationPlan.snoozeWritesReminder(kind, task.reminderAt, now, zone)) snooze(
                        taskId,
                        TaskNotificationPlan.snoozedReminderAt(
                            if (action == TaskNotificationAction.SnoozeHour) SnoozeChoice.Hour else SnoozeChoice.Tomorrow,
                            now,
                            TaskNotificationSettings.dueTimes(context),
                            zone,
                        ),
                    )
            }
            TaskNotificationScheduler.cancel(context, taskId)
            true
        } catch (error: kotlinx.coroutines.CancellationException) {
            throw error
        } catch (error: Exception) {
            // 競合の解決待ち・AI の作業の確認待ちなど、ここからは変えられない Task。黙って消さずに知らせる。
            Log.w(TAG, "Task notification action failed", error)
            TaskNotificationScheduler.showActionFailure(context, taskId, task.title)
            false
        }
    }
}

class TaskNotificationActionReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        val taskId = intent.getStringExtra(ExtraTaskId) ?: return
        val action = intent.getStringExtra(ExtraAction)?.let { runCatching { TaskNotificationAction.valueOf(it) }.getOrNull() } ?: return
        val app = context.applicationContext
        val pending = goAsync()
        CoroutineScope(SupervisorJob() + Dispatchers.IO).launch {
            try {
                val kind = intent.getStringExtra(ExtraKind)?.let { runCatching { TaskNoticeKind.valueOf(it) }.getOrNull() }
                TaskNotificationActions.handle(app, MobileLocalDatabase.open(app).mobileDao(), taskId, action, kind = kind)
                TaskNotificationScheduler.syncOrLog(app)
                TaskenTodayWidget.updateAllNow(app)
            } catch (error: Exception) {
                Log.w(TAG, "Task notification action receiver failed", error)
            } finally {
                pending.finish()
            }
        }
    }

    companion object {
        const val ExtraTaskId = "taskId"
        const val ExtraAction = "action"
        const val ExtraKind = "kind"
    }
}

/** アラームが鳴った時。出すべき知らせを出して、次の 1 本を掛け直す。 */
class TaskNotificationAlarmReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        val app = context.applicationContext
        val pending = goAsync()
        CoroutineScope(SupervisorJob() + Dispatchers.IO).launch {
            try {
                TaskNotificationScheduler.syncOrLog(app)
            } finally {
                pending.finish()
            }
        }
    }
}

/**
 * アラームが消える・ずれる出来事の後に掛け直す: 再起動、アプリの更新、時計の変更、時差の変更、
 * 正確なアラームの許可の変更。再起動の間に過ぎた知らせも、ここで出る。
 */
class TaskNotificationRescheduleReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        if (intent.action !in RescheduleActions) return
        val app = context.applicationContext
        val pending = goAsync()
        CoroutineScope(SupervisorJob() + Dispatchers.IO).launch {
            try {
                TaskNotificationScheduler.syncOrLog(app)
            } finally {
                pending.finish()
            }
        }
    }

    companion object {
        internal val RescheduleActions = setOf(
            Intent.ACTION_BOOT_COMPLETED,
            Intent.ACTION_MY_PACKAGE_REPLACED,
            Intent.ACTION_TIME_CHANGED,
            Intent.ACTION_TIMEZONE_CHANGED,
            "android.app.action.SCHEDULE_EXACT_ALARM_PERMISSION_STATE_CHANGED",
        )
    }
}
