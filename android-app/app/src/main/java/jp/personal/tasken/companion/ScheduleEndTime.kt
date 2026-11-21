package jp.personal.tasken.companion

import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive

/**
 * 期限の時刻と「N 分前の知らせ」（#785）。Desktop の src/shared/scheduleSemantics.mjs の scheduleEnd と同じ決まりで読む。
 *
 * - 時刻は期限の日（終了日、無ければ開始日）の現地の HH:mm。日単位の日程にだけ意味がある。
 * - 知らせ（notifyBeforeMinutes）は時刻がある時だけ。0 = ちょうど、最大 7 日（10080 分）。
 * - Desktop へは、時刻と知らせが変える前も後も無い時は欄ごと送らない（欄を知らない古い Desktop でも日付の変更が通る）。
 *   省いた欄は Desktop では「保存済みの値のまま」、null は「外す」。
 */
internal const val SCHEDULE_NOTIFY_BEFORE_MAX_MINUTES = 10080

/** 時刻を初めて付けた時に選んでおく知らせ（Desktop の引き出しと同じ 30 分前）。 */
internal const val DEFAULT_NOTIFY_BEFORE_MINUTES = 30

internal const val SCHEDULE_TIME_UPDATE_REQUIRED = "時刻の同期にはDesktopの更新が必要です。Desktopを更新してから再試行してください。"

/** スマホで選べる知らせ（「ほか」は Desktop だけ）。null = なし。 */
internal val notifyBeforePresets: List<Int?> = listOf(null, 0, 10, 30, 60, 1440)

internal fun isScheduleEndTime(value: String?): Boolean = value != null && PLANNED_START_TIME_PATTERN.matches(value)

internal fun isNotifyBeforeMinutes(value: Int?): Boolean = value != null && value in 0..SCHEDULE_NOTIFY_BEFORE_MAX_MINUTES

/**
 * 読める時刻と知らせの組。日付の無い日程・日単位でない日程・読めない値は無いものにする
 * （1 件の読めない値で応答全体を断らない。Gateway が読めない保存値を null で返すのと同じ）。
 */
internal fun readableScheduleEnd(
    startDate: String?,
    endDate: String?,
    granularity: String?,
    endTime: String?,
    notifyBeforeMinutes: Int?,
): Pair<String?, Int?> {
    val hasDate = !startDate.isNullOrBlank() || !endDate.isNullOrBlank()
    val time = endTime.takeIf { hasDate && (granularity == null || granularity == "day") && isScheduleEndTime(it) }
    val lead = notifyBeforeMinutes.takeIf { time != null && isNotifyBeforeMinutes(it) }
    return time to lead
}

/** 写しの時刻と知らせ（読める組だけ）。 */
internal fun TaskCacheEntity.readableEnd(): Pair<String?, Int?> =
    readableScheduleEnd(scheduleStartDate, scheduleEndDate, scheduleGranularity, scheduleEndTime, scheduleNotifyBeforeMinutes)

/** 「なし」「ちょうど」「10分前」「1時間前」「前日」「45分前」「2日前」。 */
internal fun notifyBeforeLabel(minutes: Int?): String = when {
    minutes == null -> "なし"
    minutes == 0 -> "ちょうど"
    minutes == 1440 -> "前日"
    minutes % 1440 == 0 -> "${minutes / 1440}日前"
    else -> "${durationLabel(minutes)}前"
}

private val scheduleTimeKeys = setOf("endTime", "notifyBeforeMinutes")

private fun JsonObject.hasScheduleTime(): Boolean =
    scheduleTimeKeys.any { key -> this[key]?.let { it != JsonNull } == true }

private fun JsonObject.withScheduleTimeKeys(include: Boolean): JsonObject = JsonObject(
    if (include) {
        filterKeys { it !in scheduleTimeKeys } +
            mapOf("endTime" to (this["endTime"] ?: JsonNull), "notifyBeforeMinutes" to (this["notifyBeforeMinutes"] ?: JsonNull))
    } else {
        filterKeys { it !in scheduleTimeKeys }
    },
)

/**
 * UpdateTask の schedule の時刻の欄をそろえる。変える前（base）と後（changes）のどちらかに時刻か知らせがあれば、
 * 両方に 2 つの欄を必ず載せる（無い方は null）。どちらにも無ければ両方から外す
 * （日付だけの変更は、時刻を知らない古い Desktop にもそのまま通る）。schedule 以外の欄は変えない。
 */
internal fun alignScheduleTimeKeys(changes: JsonObject, base: JsonObject): Pair<JsonObject, JsonObject> {
    val change = changes["schedule"] as? JsonObject ?: return changes to base
    val before = base["schedule"] as? JsonObject
    val include = change.hasScheduleTime() || before?.hasScheduleTime() == true
    val alignedChanges = JsonObject(changes + ("schedule" to change.withScheduleTimeKeys(include)))
    val alignedBase = if (before == null) base else JsonObject(base + ("schedule" to before.withScheduleTimeKeys(include)))
    return alignedChanges to alignedBase
}

internal fun MobileTaskEditIntent.withAlignedScheduleTime(): MobileTaskEditIntent =
    alignScheduleTimeKeys(changes, base).let { (changes, base) -> MobileTaskEditIntent(changes, base) }

internal fun decodeScheduleEndTimeValue(value: JsonElement?): String? = when (value) {
    null, JsonNull -> null
    is JsonPrimitive -> value.content.also { require(value.isString && isScheduleEndTime(it)) }
    else -> throw IllegalArgumentException("endTime must be HH:mm or null")
}

internal fun decodeNotifyBeforeValue(value: JsonElement?): Int? = when (value) {
    null, JsonNull -> null
    is JsonPrimitive -> requireNotNull(value.content.toIntOrNull()).also { require(!value.isString && isNotifyBeforeMinutes(it)) }
    else -> throw IllegalArgumentException("notifyBeforeMinutes must be an integer or null")
}

/**
 * 応答に notifyBeforeMinutes のキーがまったく無いのは、欄を知らない古い Desktop（新しい Desktop は日程のある Task に
 * いつも null か値を返す）。そのときは「分からない」として、写しの時刻を消さない（serverReportsReminderAt と同じ）。
 */
internal fun serverReportsScheduleTime(body: String): Boolean = body.contains("\"notifyBeforeMinutes\"")

/**
 * 時刻を知らない古い Desktop が、時刻の欄を載せた UpdateTask・CreateTask を断ったとき。接続先の応答だけを信じる。
 * 命令は断られたまま列に残り（端末の入力は消さない）、本人が Desktop を更新してから送り直せる。
 */
internal fun isUnsupportedScheduleTime(
    envelopeJson: String,
    response: GatewayHttpResponse,
    expectedServerId: String,
): Boolean = runCatching {
    if (response.status !in setOf(400, 422)) return false
    val command = Json.parseToJsonElement(envelopeJson).jsonObject.getValue("command").jsonObject
    val schedule = when (command["name"]?.jsonPrimitive?.content) {
        "UpdateTask" -> command.getValue("changes").jsonObject["schedule"]
        "CreateTask" -> command["schedule"]
        else -> null
    } as? JsonObject ?: return false
    if (scheduleTimeKeys.none { it in schedule }) return false
    val body = Json.parseToJsonElement(response.body).jsonObject
    body.getValue("meta").jsonObject.getValue("serverId").jsonPrimitive.content == expectedServerId &&
        body.getValue("error").jsonObject.getValue("code").jsonPrimitive.content in
        setOf("validation_failed", "capability_unavailable")
}.getOrDefault(false)
