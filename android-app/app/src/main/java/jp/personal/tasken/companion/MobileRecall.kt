package jp.personal.tasken.companion

import androidx.room.Entity
import java.time.LocalDate
import java.time.OffsetDateTime
import java.time.ZoneId
import kotlinx.coroutines.flow.Flow
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.Json

@Serializable
data class MobileRecallSource(val type: String, val id: String, val status: String, val reason: String? = null)
@Serializable
data class MobileRecallClassification(val stage: String, val date_basis: String? = null)
@Serializable
data class MobileRecallEvent(
    val id: String,
    val event_kind: String,
    val entity_title: String,
    val summary: String,
    val local_date: String,
    val local_time: String,
    val recall: MobileRecallClassification,
    val mobile_source: MobileRecallSource,
)
@Serializable
data class MobileRecallPeriod(val date: String?, val timezone: String)
@Serializable
data class MobileRecallPage(
    val status: String,
    val period: MobileRecallPeriod,
    val limit: Int,
    val returned_count: Int,
    val offset: Int?,
    val next_cursor: String?,
    val revision: String,
    val generated_at: String,
)
@Serializable
data class MobileRecallData(val events: List<MobileRecallEvent>, val truncated: Boolean, val page: MobileRecallPage)
@Serializable
data class MobileRecallResponse(val ok: Boolean, val meta: MobileResponseMetaDto, val data: MobileRecallData)

/** This is a read cache, scoped to the paired server and the requested civil day. */
@Entity(tableName = "recall_day_cache", primaryKeys = ["serverId", "date", "timezone"])
data class RecallDayCacheEntity(
    val serverId: String,
    val date: String,
    val timezone: String,
    val eventsJson: String,
    val lastFetchedAt: String?,
    val nextCursor: String?,
    val revision: String?,
    val error: String?,
    val partial: Boolean,
    val stagedEventsJson: String? = null,
    val lastPageFetchedAt: String? = null,
)

@Entity(tableName = "recall_seen_source", primaryKeys = ["serverId", "type", "sourceId"])
data class RecallSeenSourceEntity(val serverId: String, val type: String, val sourceId: String, val observedAt: String)

/** Keep locally submitted Capture text through receipt application and process death. */
@Entity(tableName = "recall_capture_cache", primaryKeys = ["serverId", "id"])
data class RecallCaptureCacheEntity(
    val serverId: String,
    val id: String,
    val commandId: String,
    val body: String,
    val capturedAt: String,
)

data class MobileRecallRow(
    val id: String,
    val source: MobileRecallSource,
    val title: String,
    val summary: String,
    val stage: String,
    val date: String,
    val time: String,
    val localStatus: String? = null,
    val capture: MobilePendingCapture? = null,
)

data class MobileRecallDay(
    val date: String,
    val timezone: String,
    val rows: List<MobileRecallRow> = emptyList(),
    val lastFetchedAt: String? = null,
    val partial: Boolean = false,
    val hasNextPage: Boolean = false,
    val error: String? = null,
    val showingPreviousSnapshot: Boolean = false,
)

interface MobileRecallRepository {
    fun observeRecallDay(date: LocalDate, timezone: ZoneId): Flow<MobileRecallDay>
    suspend fun refreshRecallDay(date: LocalDate, timezone: ZoneId, nextPage: Boolean = false)
    suspend fun loadRecallWorkLog(id: String)
}

internal class MobileRecallSourceUnavailable(message: String) : IllegalStateException(message)

internal object MobileRecallContract {
    // The shared projection owns additional history/authority metadata that this UI does not render.
    val json = Json { ignoreUnknownKeys = true; encodeDefaults = true }

    fun decode(body: String, serverId: String, date: LocalDate, timezone: ZoneId): MobileRecallResponse =
        json.decodeFromString<MobileRecallResponse>(body).also { response ->
            require(response.ok && response.meta.serverId == serverId &&
                response.meta.apiVersion == TASKEN_MOBILE_API_VERSION && response.meta.schemaVersion == TASKEN_MOBILE_SCHEMA_VERSION)
            val page = response.data.page
            require(page.period.date == date.toString() && page.period.timezone == timezone.id)
            require(page.status in setOf("ok", "invalid_cursor", "resync_required"))
            require(page.limit in 1..500 && response.data.events.size <= page.limit && page.returned_count == response.data.events.size)
            require(response.data.events.map { it.id }.distinct().size == response.data.events.size)
            response.data.events.forEach {
                require(it.id.isNotBlank() && it.local_date == date.toString() && it.mobile_source.id.isNotBlank())
                require(it.mobile_source.status in setOf("available", "unavailable"))
            }
            require(page.status != "ok" || response.data.truncated == (page.next_cursor != null))
        }

    fun captureDate(timestamp: String, timezone: ZoneId): String =
        OffsetDateTime.parse(timestamp).atZoneSameInstant(timezone).toLocalDate().toString()

    fun stageLabel(stage: String, kind: String = ""): String = when (stage) {
        "input" -> "未整理Capture"
        "planned" -> "計画・Task作成"
        "work_recorded" -> if (kind == "task_completed") "Task完了" else "作業記録"
        "ai_reported" -> "AIの報告"
        "human_accepted" -> "人間が採用"
        "organized" -> "Captureを整理"
        else -> "変更の記録"
    }
}
