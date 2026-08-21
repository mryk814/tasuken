package jp.personal.tasken.companion

import java.time.LocalDate
import java.time.OffsetDateTime
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.Json

@Serializable
data class MobileTodayResponseDto(
    val ok: Boolean,
    val meta: MobileResponseMetaDto,
    val data: MobileTodayDataDto,
)

@Serializable
data class MobileResponseMetaDto(
    val apiVersion: Int,
    val schemaVersion: Int,
    val serverId: String,
    val serverRevision: Int,
    val generatedAt: String,
    val truncated: Boolean,
)

@Serializable
data class MobileTodayDataDto(
    val date: String,
    val items: List<MobileTaskSummaryDto>,
    val nextCursor: String?,
)

@Serializable
data class MobileTaskSummaryDto(
    val id: String,
    val version: Int,
    val title: String,
    val themeId: String?,
    val state: String,
    val workState: String?,
    val updatedAt: String,
)

class MobileTodayContractException(message: String, cause: Throwable? = null) :
    IllegalArgumentException(message, cause)

object MobileTodayContract {
    private const val ApiVersion = 1
    private const val SchemaVersion = 1
    private const val MaxItems = 50
    private val taskStates = setOf("todo", "doing", "waiting", "review", "done", "cancelled")
    private val workStates = setOf(
        "not_delegated",
        "ready_for_agent",
        "in_progress",
        "reported_done",
        "needs_human_review",
        "accepted",
        "blocked",
        "failed",
    )
    private val json = Json {
        ignoreUnknownKeys = false
        isLenient = false
        coerceInputValues = false
    }

    fun decodeSuccess(payload: String): MobileTodayResponseDto {
        val response = try {
            json.decodeFromString<MobileTodayResponseDto>(payload)
        } catch (error: Exception) {
            throw MobileTodayContractException("Today response does not match the strict JSON shape.", error)
        }
        val normalized = response.normalized()
        validate(normalized)
        return normalized
    }

    private fun validate(response: MobileTodayResponseDto) {
        requireContract(response.ok, "Today success response requires ok=true.")
        requireContract(response.meta.apiVersion == ApiVersion, "Unsupported mobile API version.")
        requireContract(response.meta.schemaVersion == SchemaVersion, "Unsupported mobile schema version.")
        requireContract(isEntityId(response.meta.serverId), "Invalid serverId.")
        requireContract(response.meta.serverRevision >= 0, "serverRevision must be non-negative.")
        requireContract(isTimestamp(response.meta.generatedAt), "Invalid generatedAt timestamp.")
        requireContract(isDate(response.data.date), "Invalid Today date.")
        requireContract(response.data.items.size <= MaxItems, "Today response exceeds the item limit.")
        requireContract(
            response.data.nextCursor == null || response.data.nextCursor.length <= 1000,
            "nextCursor exceeds the contract limit.",
        )
        response.data.items.forEach { item ->
            requireContract(isEntityId(item.id), "Invalid Task ID.")
            requireContract(item.version > 0, "Invalid Task version.")
            requireContract(item.title.trim().isNotEmpty() && item.title.length <= 500, "Invalid Task title.")
            requireContract(item.themeId == null || isEntityId(item.themeId), "Invalid Theme ID.")
            requireContract(item.state in taskStates, "Invalid Task state.")
            requireContract(item.workState == null || item.workState in workStates, "Invalid work state.")
            requireContract(isTimestamp(item.updatedAt), "Invalid Task updatedAt timestamp.")
        }
    }

    private fun isEntityId(value: String): Boolean = value.trim().isNotEmpty() && value.length <= 200

    private fun isDate(value: String): Boolean = runCatching { LocalDate.parse(value) }.isSuccess

    private fun isTimestamp(value: String): Boolean = runCatching { OffsetDateTime.parse(value) }.isSuccess

    private fun requireContract(condition: Boolean, message: String) {
        if (!condition) throw MobileTodayContractException(message)
    }

    private fun MobileTodayResponseDto.normalized(): MobileTodayResponseDto = copy(
        meta = meta.copy(serverId = meta.serverId.trim()),
        data = data.copy(
            items = data.items.map { item ->
                item.copy(
                    id = item.id.trim(),
                    title = item.title.trim(),
                    themeId = item.themeId?.trim(),
                )
            },
        ),
    )
}

fun MobileTodayResponseDto.toResult(): MobileTodayResult.Available = MobileTodayResult.Available(
    tasks = data.items.map {
        MobileTask(it.id.trim(), it.title.trim(), it.themeId?.trim(), it.state, it.workState, it.updatedAt)
    },
    generatedAt = meta.generatedAt,
)
