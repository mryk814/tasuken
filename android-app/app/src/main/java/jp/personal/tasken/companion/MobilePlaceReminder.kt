package jp.personal.tasken.companion

import java.time.LocalDate
import java.time.LocalDateTime
import java.time.LocalTime
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.Serializable
import kotlinx.serialization.encodeToString
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject

/**
 * Task の場所のリマインダー（#727）。Gateway の要約の `placeReminder` と、UpdateTask の patch の値で同じ形を使う。
 * 欄は X-Tasken-Place-Reminder: 1 を付けた要求にだけ返る（古い APK が未知の欄で落ちないため）。
 */
@Serializable
data class MobilePlaceReminder(
    val name: String,
    val latitude: Double,
    val longitude: Double,
    val radiusMeters: Int = PLACE_REMINDER_DEFAULT_RADIUS_M,
    /** 0=日〜6=土。空は毎日。 */
    val days: List<Int> = emptyList(),
    val timeFrom: String? = null,
    val timeTo: String? = null,
)

const val PLACE_REMINDER_DEFAULT_RADIUS_M = 300
const val PLACE_REMINDER_MIN_RADIUS_M = 100
const val PLACE_REMINDER_MAX_RADIUS_M = 2000
/** Geofence は端末ごとに 100 件まで。 */
const val PLACE_REMINDER_GEOFENCE_LIMIT = 100

private val placeReminderTimePattern = Regex("^([01]\\d|2[0-3]):[0-5]\\d$")
private val placeReminderJson = Json {
    ignoreUnknownKeys = false
    encodeDefaults = true
    explicitNulls = true
}

/** サーバの検査と同じ範囲。違えば例外（契約違反）。 */
internal fun validateMobilePlaceReminder(place: MobilePlaceReminder?) {
    if (place == null) return
    require(place.name == place.name.trim() && place.name.length in 1..80) { "Invalid place reminder name." }
    require(place.latitude.isFinite() && place.latitude in -90.0..90.0) { "Invalid place reminder latitude." }
    require(place.longitude.isFinite() && place.longitude in -180.0..180.0) { "Invalid place reminder longitude." }
    require(place.radiusMeters in PLACE_REMINDER_MIN_RADIUS_M..PLACE_REMINDER_MAX_RADIUS_M) { "Invalid place reminder radius." }
    require(place.days.all { it in 0..6 } && place.days.zipWithNext().all { (a, b) -> a < b }) { "Invalid place reminder days." }
    require((place.timeFrom == null) == (place.timeTo == null)) { "Place reminder time window needs both ends." }
    place.timeFrom?.let { require(placeReminderTimePattern.matches(it)) { "Invalid place reminder timeFrom." } }
    place.timeTo?.let { require(placeReminderTimePattern.matches(it)) { "Invalid place reminder timeTo." } }
}

internal fun encodeMobilePlaceReminder(value: MobilePlaceReminder?): String? =
    value?.let { placeReminderJson.encodeToString(it) }

internal fun decodeMobilePlaceReminder(value: String?): MobilePlaceReminder? =
    value?.let { placeReminderJson.decodeFromString<MobilePlaceReminder>(it) }

/** UpdateTask の patch / base の値。外すときは JsonNull。 */
internal fun placeReminderPatchValue(value: MobilePlaceReminder?): JsonElement =
    value?.let { placeReminderJson.encodeToJsonElement(MobilePlaceReminder.serializer(), it) } ?: JsonNull

/** patch の値を検査して読む。7 つの欄がそろった object か null だけを受ける。 */
internal fun decodePlaceReminderPatchValue(value: JsonElement?): MobilePlaceReminder? {
    if (value == JsonNull) return null
    require(value is JsonObject && value.keys == setOf("name", "latitude", "longitude", "radiusMeters", "days", "timeFrom", "timeTo")) {
        "Invalid placeReminder patch."
    }
    return placeReminderJson.decodeFromJsonElement(MobilePlaceReminder.serializer(), value).also(::validateMobilePlaceReminder)
}

/**
 * 通知してよいかの判定。ジオフェンスの DWELL が来たときに呼ぶ。
 * 駅の近くで GPS が揺れて同じ Task が何度も鳴った（仮運用）ので、
 * 「その Task を今日すでに通知した」を必ず見る。
 */
internal object PlaceReminderPolicy {
    fun shouldNotify(
        reminder: MobilePlaceReminder,
        taskState: String,
        now: LocalDateTime,
        lastNotifiedDate: LocalDate?,
    ): Boolean = isOpenTask(taskState) &&
        lastNotifiedDate != noticeDate(reminder, now) &&
        matchesSchedule(reminder, now)

    /**
     * 「1 日 1 回」を数える日付。日またぎの窓の続き（日付が変わった後）は、その窓が始まった日として数える。
     * 前日に始まった窓の中で通知済みなら、日付が変わっても同じ窓では鳴らさない。
     */
    fun noticeDate(reminder: MobilePlaceReminder, now: LocalDateTime): LocalDate {
        val from = reminder.timeFrom?.let(LocalTime::parse)
        val to = reminder.timeTo?.let(LocalTime::parse)
        val time = now.toLocalTime().withSecond(0).withNano(0)
        return if (from != null && to != null && from > to && time <= to) now.toLocalDate().minusDays(1) else now.toLocalDate()
    }

    fun isOpenTask(state: String): Boolean = state != "done" && state != "cancelled"

    /**
     * 曜日と時間帯。日またぎの窓（from > to）は、始まった日の曜日に属する。
     * 例: 金曜 22:00-02:00 は土曜 01:00 にも合う。
     */
    fun matchesSchedule(reminder: MobilePlaceReminder, now: LocalDateTime): Boolean {
        val from = reminder.timeFrom?.let(LocalTime::parse)
        val to = reminder.timeTo?.let(LocalTime::parse)
        val time = now.toLocalTime().withSecond(0).withNano(0)
        val windowDay = if (from != null && to != null && from > to && time <= to) now.minusDays(1) else now
        val weekday = windowDay.dayOfWeek.value % 7
        if (reminder.days.isNotEmpty() && weekday !in reminder.days) return false
        if (from == null || to == null) return true
        return if (from <= to) time >= from && time <= to else time >= from || time <= to
    }
}

/** 場所つきで、未完了のものだけがジオフェンスになる。 */
internal fun placeReminderGeofenceTargets(tasks: List<MobileTask>): List<Pair<String, MobilePlaceReminder>> =
    tasks.mapNotNull { task ->
        task.placeReminder?.takeIf { PlaceReminderPolicy.isOpenTask(task.state) }?.let { task.id to it }
    }.sortedBy { it.first }.take(PLACE_REMINDER_GEOFENCE_LIMIT)

/** 過去に使った場所。名前で重複を除き、新しく更新した Task のものを先にする。 */
internal fun previousPlaceReminders(tasks: List<MobileTask>): List<MobilePlaceReminder> =
    tasks.filter { it.placeReminder != null }
        .sortedByDescending { it.updatedAt }
        .mapNotNull { it.placeReminder }
        .distinctBy { it.name }

/**
 * 登録の要約。位置と半径は OS に渡る中身。曜日と時間帯は発火時に見るが、変えたときは付け直す
 * （まだ中にいれば INITIAL_TRIGGER_DWELL で、新しい条件のもとで滞在 3 分後に鳴る）。名前だけは付け直さない。
 */
internal fun geofenceSignature(place: MobilePlaceReminder): String =
    "${place.latitude}|${place.longitude}|${place.radiusMeters}|${place.days.joinToString(",")}|${place.timeFrom}|${place.timeTo}"

internal data class GeofencePlan(
    val removeIds: List<String>,
    val add: List<Pair<String, MobilePlaceReminder>>,
)

/**
 * 登録済み（id→要約）と、いま登録すべき対象との差分。
 * 全部を外して付け直すと、無関係な場所の滞在の待ち（3 分）までやり直しになるので、変わった分だけにする。
 * 要約が変わった Task は、同じ id で付け直せば置き換わる。
 */
internal fun planGeofenceChanges(
    registered: Map<String, String>,
    targets: List<Pair<String, MobilePlaceReminder>>,
): GeofencePlan {
    val wanted = targets.associate { it.first to geofenceSignature(it.second) }
    return GeofencePlan(
        removeIds = registered.keys.filter { it !in wanted }.sorted(),
        add = targets.filter { (id, place) -> registered[id] != geofenceSignature(place) },
    )
}

/**
 * 時間帯のある場所で DWELL を見送ったとき、その Task のジオフェンスを付け直す時刻（after より後の、次の窓の始まり）。
 * 曜日が合い、その窓の日（noticeDate）にまだ通知していないものだけ。まだ中にいれば INITIAL_TRIGGER_DWELL で滞在 3 分後に鳴る。
 * 時間帯の無い場所は null: 見送る理由は曜日違いか通知済みで、次に入り直したときに判定する
 * （0:00 に付け直すと、自宅のような場所で毎晩真夜中に鳴る）。完了・キャンセルの Task や、1 週間先まで無いときも null。
 */
internal fun nextEligibleAt(
    place: MobilePlaceReminder,
    taskState: String,
    after: LocalDateTime,
    lastNotifiedDate: LocalDate?,
): LocalDateTime? {
    if (!PlaceReminderPolicy.isOpenTask(taskState)) return null
    val from = place.timeFrom?.let(LocalTime::parse) ?: return null
    return (0..8).map { after.toLocalDate().plusDays(it.toLong()).atTime(from) }
        .firstOrNull { it > after && it.toLocalDate() != lastNotifiedDate && PlaceReminderPolicy.matchesSchedule(place, it) }
}

/** 一度の取得が取れずに lastLocation へ落ちたとき、古い（2 分より前）か粗い（100m より大きい）ものは使わない。 */
internal fun isUsableLastLocation(ageMillis: Long, accuracyMeters: Float?): Boolean =
    ageMillis in 0..120_000 && accuracyMeters != null && accuracyMeters <= 100f

internal const val PLACE_REMINDER_UPDATE_REQUIRED = "場所の同期にはDesktopの更新が必要です。Desktopを更新してから再試行してください。"

/** 場所の欄を知らない古い Desktop が UpdateTask の placeReminder を断ったとき。接続先の応答だけを信じる。 */
internal fun isUnsupportedPlaceReminder(
    envelopeJson: String,
    response: GatewayHttpResponse,
    expectedServerId: String,
): Boolean = runCatching {
    if (response.status !in setOf(400, 409, 422)) return false
    val command = Json.parseToJsonElement(envelopeJson).jsonObject.getValue("command").jsonObject
    if (command["name"]?.jsonPrimitive?.content != "UpdateTask") return false
    if (!command.getValue("changes").jsonObject.containsKey("placeReminder")) return false
    val body = Json.parseToJsonElement(response.body).jsonObject
    body.getValue("meta").jsonObject.getValue("serverId").jsonPrimitive.content == expectedServerId &&
        body.getValue("error").jsonObject.getValue("code").jsonPrimitive.content in
        setOf("validation_failed", "version_mismatch", "capability_unavailable")
}.getOrDefault(false)

/**
 * 応答に placeReminder のキーがまったく無いのは、欄を知らない古い Desktop（新しい Desktop は場所の無い Task にも null を返す）。
 * そのときは「分からない」として、キャッシュの場所を消さない。
 */
internal fun serverReportsPlaceReminder(body: String): Boolean = body.contains("\"placeReminder\"")
