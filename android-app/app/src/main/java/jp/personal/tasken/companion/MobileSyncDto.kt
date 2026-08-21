package jp.personal.tasken.companion

import java.time.LocalDate
import java.time.OffsetDateTime
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.Json

@Serializable
data class MobileBootstrapResponseDto(
    val ok: Boolean,
    val meta: MobileResponseMetaDto,
    val data: MobileBootstrapDataDto,
)

@Serializable
data class MobileBootstrapDataDto(
    val tasks: List<MobileTaskSummaryDto>,
    val nextCursor: String?,
    val hasMore: Boolean,
)

@Serializable
data class MobileSyncResponseDto(
    val ok: Boolean,
    val meta: MobileResponseMetaDto,
    val data: MobileSyncDataDto,
)

@Serializable
data class MobileSyncDataDto(
    val changes: List<MobileSyncChangeDto>,
    val nextCursor: String,
    val hasMore: Boolean,
)

@Serializable
data class MobileSyncChangeDto(
    val kind: String,
    val task: MobileTaskSummaryDto? = null,
    val entityType: String? = null,
    val id: String? = null,
    val version: Int? = null,
    val updatedAt: String? = null,
)

class MobileSyncContractException(message: String, cause: Throwable? = null) :
    IllegalArgumentException(message, cause)

object MobileSyncContract {
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

    fun decodeBootstrap(payload: String): MobileBootstrapResponseDto = try {
        json.decodeFromString<MobileBootstrapResponseDto>(payload).also(::validateBootstrap)
    } catch (error: MobileSyncContractException) {
        throw error
    } catch (error: Exception) {
        throw MobileSyncContractException("Bootstrap response does not match the strict JSON shape.", error)
    }

    fun decodeSync(payload: String): MobileSyncResponseDto = try {
        json.decodeFromString<MobileSyncResponseDto>(payload).also(::validateSync)
    } catch (error: MobileSyncContractException) {
        throw error
    } catch (error: Exception) {
        throw MobileSyncContractException("Sync response does not match the strict JSON shape.", error)
    }

    private fun validateBootstrap(response: MobileBootstrapResponseDto) {
        validateMeta(response.ok, response.meta)
        requireContract(response.data.tasks.size <= MaxItems, "Bootstrap response exceeds the item limit.")
        requireContract(!response.data.hasMore, "Bootstrap must return a complete bounded snapshot.")
        requireContract(response.data.nextCursor == null || response.data.nextCursor.length <= 1000, "Invalid bootstrap cursor.")
        response.data.tasks.forEach(::validateTask)
    }

    private fun validateSync(response: MobileSyncResponseDto) {
        validateMeta(response.ok, response.meta)
        requireContract(response.data.changes.size <= MaxItems, "Sync response exceeds the item limit.")
        requireContract(response.data.nextCursor.length <= 1000, "Invalid sync cursor.")
        response.data.changes.forEach { change ->
            when (change.kind) {
                "upsert" -> {
                    requireContract(change.task != null, "Upsert requires a Task.")
                    requireContract(change.entityType == null && change.id == null && change.version == null && change.updatedAt == null, "Upsert contains tombstone fields.")
                    validateTask(change.task!!)
                }
                "tombstone" -> {
                    requireContract(change.task == null, "Tombstone cannot contain a Task.")
                    requireContract(change.entityType == "task", "Unsupported tombstone entity type.")
                    requireContract(isEntityId(change.id), "Invalid tombstone Task ID.")
                    requireContract((change.version ?: 0) > 0, "Invalid tombstone version.")
                    requireContract(isTimestamp(change.updatedAt), "Invalid tombstone timestamp.")
                }
                else -> throw MobileSyncContractException("Unsupported sync change kind.")
            }
        }
    }

    private fun validateMeta(ok: Boolean, meta: MobileResponseMetaDto) {
        requireContract(ok, "Sync success response requires ok=true.")
        requireContract(meta.apiVersion == 1 && meta.schemaVersion == 1, "Unsupported mobile sync version.")
        requireContract(isEntityId(meta.serverId), "Invalid serverId.")
        requireContract(meta.serverRevision >= 0, "serverRevision must be non-negative.")
        requireContract(isTimestamp(meta.generatedAt), "Invalid generatedAt timestamp.")
    }

    private fun validateTask(task: MobileTaskSummaryDto) {
        requireContract(isEntityId(task.id), "Invalid Task ID.")
        requireContract(task.version > 0, "Invalid Task version.")
        requireContract(task.title.trim().isNotEmpty() && task.title.length <= 500, "Invalid Task title.")
        requireContract(task.themeId == null || isEntityId(task.themeId), "Invalid Theme ID.")
        requireContract(task.state in taskStates, "Invalid Task state.")
        requireContract(task.workState == null || task.workState in workStates, "Invalid work state.")
        requireContract(task.todayDate == null || runCatching { LocalDate.parse(task.todayDate) }.isSuccess, "Invalid todayDate.")
        requireContract(isTimestamp(task.updatedAt), "Invalid Task timestamp.")
    }

    private fun isEntityId(value: String?): Boolean = !value.isNullOrBlank() && value.length <= 200

    private fun isTimestamp(value: String?): Boolean = value != null && runCatching { OffsetDateTime.parse(value) }.isSuccess

    private fun requireContract(condition: Boolean, message: String) {
        if (!condition) throw MobileSyncContractException(message)
    }
}
