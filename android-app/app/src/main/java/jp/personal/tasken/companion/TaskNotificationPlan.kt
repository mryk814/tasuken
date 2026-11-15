package jp.personal.tasken.companion

import java.time.Duration
import java.time.LocalDate
import java.time.LocalDateTime
import java.time.LocalTime
import java.time.OffsetDateTime
import java.time.ZoneId
import java.time.format.DateTimeFormatter
import java.time.temporal.ChronoUnit
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive

/**
 * Task の時刻と期限の知らせの決まり（#753）。Desktop と同じにする（Desktop 側は src/shared/taskNotifications.ts）。
 *
 * - 時刻を付けた Task（reminderAt）は、その時刻に知らせる。逃した時刻は 24 時間まで後から出す。
 * - 期限の日は、本人が決めた時刻（既定 09:00、2 回目を足せる）に知らせる。期限の日のうちだけ出す。
 * - 完了・中止した Task は知らせない。
 *
 * 通知は端末に落としてある写しだけから組む（つながらなくても鳴る）。
 */
internal enum class TaskNoticeKind { Time, Due }

internal data class TaskNotice(
    /** 同じ知らせを 2 度出さないための鍵。時刻や期限を変えると鍵も変わり、もう一度知らせる。 */
    val key: String,
    val kind: TaskNoticeKind,
    val taskId: String,
    val title: String,
    val at: LocalDateTime,
)

/** 知らせを決めるのに要る Task の欄だけ。 */
internal data class NotifiableTask(
    val id: String,
    val title: String,
    val state: String,
    val reminderAt: String?,
    val dueDate: LocalDate?,
)

internal enum class SnoozeChoice { Hour, Tomorrow }

internal object TaskNotificationPlan {
    val DefaultDueTimes: List<LocalTime> = listOf(LocalTime.of(9, 0))
    const val MaxDueTimes = 2
    private val MissedWindow: Duration = Duration.ofHours(24)
    private val floatingPattern = Regex("""^\d{4}-\d{2}-\d{2}T([01]\d|2[0-3]):[0-5]\d$""")
    private val timePattern = Regex("""^([01]\d|2[0-3]):[0-5]\d$""")
    private val minute: DateTimeFormatter = DateTimeFormatter.ofPattern("yyyy-MM-dd'T'HH:mm")

    fun isOpen(state: String): Boolean = state != "done" && state != "cancelled"

    /**
     * reminderAt を、この端末の現地時刻にそろえる。読めなければ null。
     * 時差つき（Z・+09:00）はその瞬間として読んで現地に直し、時差なし（Desktop の画面が書く形）は
     * この端末の現地の時刻として読む。
     */
    fun parseReminderAt(value: String?, zone: ZoneId): LocalDateTime? {
        val text = value?.trim().orEmpty()
        if (text.isEmpty()) return null
        if (floatingPattern.matches(text)) return runCatching { LocalDateTime.parse(text) }.getOrNull()
        return runCatching {
            OffsetDateTime.parse(text).atZoneSameInstant(zone).toLocalDateTime().truncatedTo(ChronoUnit.MINUTES)
        }.getOrNull()
    }

    /** 期限の日の知らせの時刻。読める HH:mm を重複なしで 2 つまで。1 つも無ければ既定（09:00）。 */
    fun normalizeDueTimes(raw: List<String>): List<LocalTime> {
        val times = raw.filter(timePattern::matches).map(LocalTime::parse).distinct().take(MaxDueTimes)
        return times.ifEmpty { DefaultDueTimes }
    }

    /**
     * 「2 回目を足す」の最初の時刻。1 回目より後で、重ならない時刻（15:00、21:00、23:59 の順）。
     * 1 回目が 23:59 で後ろが無い時は null（足せない）。
     */
    fun suggestedSecondDueTime(first: LocalTime): LocalTime? =
        listOf(LocalTime.of(15, 0), LocalTime.of(21, 0), LocalTime.of(23, 59)).firstOrNull { it.isAfter(first) }

    /**
     * 期限の通知の「後で」で、Task の時刻を書いてよいか。本人が付けた、今より先の時刻がある時は書き替えない
     * （その時刻がそのまま鳴る）。時刻の通知の「後で」は、その時刻を先へ送るので、いつも書く。
     */
    fun snoozeWritesReminder(kind: TaskNoticeKind?, reminderAt: String?, now: LocalDateTime, zone: ZoneId): Boolean {
        if (kind != TaskNoticeKind.Due) return true
        val current = parseReminderAt(reminderAt, zone) ?: return true
        return !current.isAfter(now.truncatedTo(ChronoUnit.MINUTES))
    }

    /** 日程の「期限の日」。終了日、無ければ開始日（一日だけの予定）。 */
    fun dueDate(startDate: String?, endDate: String?): LocalDate? =
        (endDate ?: startDate)?.let { runCatching { LocalDate.parse(it) }.getOrNull() }

    private fun key(kind: TaskNoticeKind, taskId: String, at: LocalDateTime): String =
        "${if (kind == TaskNoticeKind.Time) "time" else "due"}:$taskId:${at.format(minute)}"

    /** Task ごとの、知らせる時刻の全部（過ぎたものも先のものも）。 */
    private fun triggers(task: NotifiableTask, dueTimes: List<LocalTime>, zone: ZoneId): List<TaskNotice> {
        if (!isOpen(task.state)) return emptyList()
        val title = task.title.ifBlank { "無題のタスク" }
        val notices = mutableListOf<TaskNotice>()
        parseReminderAt(task.reminderAt, zone)?.let {
            notices += TaskNotice(key(TaskNoticeKind.Time, task.id, it), TaskNoticeKind.Time, task.id, title, it)
        }
        task.dueDate?.let { date ->
            dueTimes.ifEmpty { DefaultDueTimes }.forEach { time ->
                val at = date.atTime(time)
                notices += TaskNotice(key(TaskNoticeKind.Due, task.id, at), TaskNoticeKind.Due, task.id, title, at)
            }
        }
        return notices
    }

    /** いま出すべき知らせ（もう出したかどうかは見ない）。時刻の古い順。 */
    fun dueNotices(
        tasks: List<NotifiableTask>,
        dueTimes: List<LocalTime>,
        now: LocalDateTime,
        zone: ZoneId,
    ): List<TaskNotice> {
        val current = now.truncatedTo(ChronoUnit.MINUTES)
        return tasks.flatMap { triggers(it, dueTimes, zone) }.filter { notice ->
            !notice.at.isAfter(current) && when (notice.kind) {
                TaskNoticeKind.Time -> notice.at.isAfter(current.minus(MissedWindow))
                TaskNoticeKind.Due -> notice.at.toLocalDate() == current.toLocalDate()
            }
        }.sortedBy { it.at }
    }

    /** 次にアラームを掛ける時刻（now より後の、いちばん近い知らせ）。無ければ null。 */
    fun nextTriggerAt(
        tasks: List<NotifiableTask>,
        dueTimes: List<LocalTime>,
        now: LocalDateTime,
        zone: ZoneId,
    ): LocalDateTime? {
        val current = now.truncatedTo(ChronoUnit.MINUTES)
        return tasks.flatMap { triggers(it, dueTimes, zone) }.map { it.at }.filter { it.isAfter(current) }.minOrNull()
    }

    /**
     * 「後で」の先の時刻。1 時間後は今から 60 分後、明日は明日の期限の知らせの最初の時刻（既定 09:00）。
     * Task に書くので時差つきで返す（どの端末で読んでも同じ瞬間になる）。
     */
    fun snoozedReminderAt(choice: SnoozeChoice, now: LocalDateTime, dueTimes: List<LocalTime>, zone: ZoneId): String {
        val current = now.truncatedTo(ChronoUnit.MINUTES)
        val local = when (choice) {
            SnoozeChoice.Hour -> current.plusHours(1)
            SnoozeChoice.Tomorrow -> current.toLocalDate().plusDays(1).atTime(dueTimes.ifEmpty { DefaultDueTimes }.min())
        }
        return local.atZone(zone).toOffsetDateTime().format(DateTimeFormatter.ISO_OFFSET_DATE_TIME)
    }

    /** 出した知らせの控え（鍵 → 出した日）から、2 日より前のものを落とす。 */
    fun pruneFired(fired: Map<String, String>, today: LocalDate): Map<String, String> {
        val keepFrom = today.minusDays(2).toString()
        return fired.filterValues { it >= keepFrom }
    }

    /** ウィジェットの「期限が近い」に入れる日数（今日を含めて 3 日先まで。過ぎた期限も入れる）。 */
    const val WidgetDueSoonDays = 3L

    /** 期限のラベル（ウィジェットの行）。過ぎた・今日・明日は言葉で、ほかは月/日。 */
    fun dueLabel(due: LocalDate, today: LocalDate): String = when (val days = ChronoUnit.DAYS.between(today, due)) {
        0L -> "今日"
        1L -> "明日"
        else -> if (days < 0) "${-days}日超過" else "${due.monthValue}/${due.dayOfMonth}"
    }
}

/**
 * 接続先から届いた reminderAt を、読める時だけ受ける。読めない値（先の版が広げた形・壊れた値）は、その欄だけ
 * 「時刻なし」として扱い、応答全体は断らない（1 件の読めない時刻で、今日と同期が丸ごと止まらないように。
 * Gateway が読めない値を null で返すのと同じ決まり）。
 */
internal fun readableReminderAt(value: String?): String? = value?.takeIf(::isMobileReminderAt)

/** reminderAt の形（時差つきの ISO か、時差なしの YYYY-MM-DDTHH:mm）。null は「時刻なし」で有効。 */
internal fun isMobileReminderAt(value: String?): Boolean =
    value == null || TaskNotificationPlan.parseReminderAt(value, ZoneId.of("UTC")) != null

internal fun decodeReminderAtPatchValue(value: JsonElement?): String? = when (value) {
    null, JsonNull -> null
    is JsonPrimitive -> value.content.also { require(value.isString) }
    else -> throw IllegalArgumentException("reminderAt must be a string or null")
}

/** 画面に出す時刻（M/d HH:mm）。無ければ「なし」。 */
internal fun reminderAtLabel(value: String?, zone: ZoneId = ZoneId.systemDefault()): String =
    TaskNotificationPlan.parseReminderAt(value, zone)?.format(DateTimeFormatter.ofPattern("M/d HH:mm")) ?: "なし"

internal const val REMINDER_AT_UPDATE_REQUIRED = "時刻の同期にはDesktopの更新が必要です。Desktopを更新してから再試行してください。"

/** 時刻の欄を知らない古い Desktop が UpdateTask の reminderAt を断ったとき。接続先の応答だけを信じる。 */
internal fun isUnsupportedReminderAt(
    envelopeJson: String,
    response: GatewayHttpResponse,
    expectedServerId: String,
): Boolean = runCatching {
    if (response.status !in setOf(400, 422)) return false
    val command = Json.parseToJsonElement(envelopeJson).jsonObject.getValue("command").jsonObject
    if (command["name"]?.jsonPrimitive?.content != "UpdateTask") return false
    if (!command.getValue("changes").jsonObject.containsKey("reminderAt")) return false
    val body = Json.parseToJsonElement(response.body).jsonObject
    body.getValue("meta").jsonObject.getValue("serverId").jsonPrimitive.content == expectedServerId &&
        body.getValue("error").jsonObject.getValue("code").jsonPrimitive.content in
        setOf("validation_failed", "capability_unavailable")
}.getOrDefault(false)

/**
 * 応答に reminderAt のキーがまったく無いのは、欄を知らない古い Desktop（新しい Desktop は時刻の無い Task にも null を返す）。
 * そのときは「分からない」として、写しの時刻を消さない（端末で「後で」にした時刻が同期のたびに消えないように）。
 */
internal fun serverReportsReminderAt(body: String): Boolean = body.contains("\"reminderAt\"")

internal fun TaskCacheEntity.toNotifiableTask(): NotifiableTask = NotifiableTask(
    id = id,
    title = title,
    state = state,
    reminderAt = reminderAt,
    dueDate = TaskNotificationPlan.dueDate(scheduleStartDate, scheduleEndDate),
)
