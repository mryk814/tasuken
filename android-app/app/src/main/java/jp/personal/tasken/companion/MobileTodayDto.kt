package jp.personal.tasken.companion

import java.time.LocalDate
import java.time.OffsetDateTime
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.Json

internal const val TASKEN_MOBILE_API_VERSION = 1
internal const val TASKEN_MOBILE_SCHEMA_VERSION = 5

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
    val todayDate: String? = null,
    val plannedStartTime: String? = null,
    val plannedDurationMinutes: Int? = null,
    val latestWorkReceipt: MobileWorkReceiptSummaryDto? = null,
    val checklistItems: List<MobileChecklistItem> = emptyList(),
    val schedule: MobileTaskScheduleDto?,
    val updatedAt: String,
)

@Serializable
data class MobileWorkReceiptSummaryDto(
    val id: String,
    val reportedAt: String,
    val executorLabel: String,
    val summary: String,
)

@Serializable
data class MobileTaskScheduleDto(
    val id: String,
    val version: Int,
    val startDate: String?,
    val endDate: String?,
    val dateKind: String,
    val rangeSemantics: String?,
    val confidence: String,
    val granularity: String,
)

class MobileTodayContractException(message: String, cause: Throwable? = null) :
    IllegalArgumentException(message, cause)

object MobileTodayContract {
    private const val ApiVersion = TASKEN_MOBILE_API_VERSION
    private const val SchemaVersion = TASKEN_MOBILE_SCHEMA_VERSION
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
            requireContract(item.todayDate == null || isDate(item.todayDate), "Invalid Task todayDate.")
            requireContract(item.plannedStartTime == null || isPlannedStartTime(item.plannedStartTime), "Invalid Task plannedStartTime.")
            requireContract(
                item.plannedDurationMinutes == null || isPlannedDurationMinutes(item.plannedDurationMinutes),
                "Invalid Task plannedDurationMinutes.",
            )
            item.latestWorkReceipt?.let(::validateWorkReceipt)
            validateChecklist(item.checklistItems)
            item.schedule?.let(::validateSchedule)
            requireContract(isTimestamp(item.updatedAt), "Invalid Task updatedAt timestamp.")
        }
    }

    private fun validateSchedule(schedule: MobileTaskScheduleDto) {
        requireContract(isEntityId(schedule.id), "Invalid Schedule ID.")
        requireContract(schedule.version > 0, "Invalid Schedule version.")
        requireContract(schedule.startDate == null || isDate(schedule.startDate), "Invalid Schedule startDate.")
        requireContract(schedule.endDate == null || isDate(schedule.endDate), "Invalid Schedule endDate.")
        val start = schedule.startDate?.let(LocalDate::parse)
        val end = schedule.endDate?.let(LocalDate::parse)
        requireContract(start == null || end == null || !end.isBefore(start), "Schedule endDate precedes startDate.")
        val expectedKind = when {
            start == null && end == null -> "unknown"
            start == null -> "deadline"
            end == null || start == end -> "point"
            else -> "range"
        }
        requireContract(schedule.dateKind == expectedKind, "Schedule dateKind does not match its dates.")
        requireContract(
            schedule.rangeSemantics == null || schedule.rangeSemantics in setOf("once_within_window", "ongoing"),
            "Invalid Schedule rangeSemantics.",
        )
        requireContract(
            schedule.rangeSemantics == null || (start != null && end != null && end.isAfter(start)),
            "Schedule rangeSemantics requires a true date range.",
        )
        requireContract(schedule.confidence in setOf("rough", "tentative", "fixed"), "Invalid Schedule confidence.")
        requireContract(schedule.granularity in setOf("day", "week", "month"), "Invalid Schedule granularity.")
    }

    private fun validateWorkReceipt(receipt: MobileWorkReceiptSummaryDto) {
        requireContract(isEntityId(receipt.id), "Invalid Work Receipt ID.")
        requireContract(isTimestamp(receipt.reportedAt), "Invalid Work Receipt reportedAt.")
        requireContract(receipt.executorLabel.trim().isNotEmpty() && receipt.executorLabel.length <= 200, "Invalid Work Receipt executorLabel.")
        requireContract(receipt.summary.trim().isNotEmpty() && receipt.summary.length <= 2000, "Invalid Work Receipt summary.")
    }

    private fun validateChecklist(items: List<MobileChecklistItem>) {
        requireContract(items.size <= 100, "Checklist exceeds the item limit.")
        requireContract(items.map { it.id }.distinct().size == items.size, "Checklist item IDs must be unique.")
        items.forEach { item ->
            requireContract(isEntityId(item.id), "Invalid Checklist item ID.")
            requireContract(item.title.trim().isNotEmpty() && item.title.length <= 200, "Invalid Checklist title.")
            requireContract(item.sortOrder.isFinite(), "Invalid Checklist sortOrder.")
            requireContract(item.completedAt == null || isTimestamp(item.completedAt), "Invalid Checklist completedAt.")
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
                    checklistItems = item.checklistItems
                        .map { checklistItem -> checklistItem.copy(id = checklistItem.id.trim(), title = checklistItem.title.trim()) }
                        .sortedWith(compareBy<MobileChecklistItem> { it.sortOrder }.thenBy { it.id }),
                    schedule = item.schedule?.copy(id = item.schedule.id.trim()),
                )
            },
        ),
    )
}

fun MobileTodayResponseDto.toResult(): MobileTodayResult.Available = MobileTodayResult.Available(
    tasks = data.items.map {
        MobileTask(
            id = it.id.trim(),
            title = it.title.trim(),
            themeId = it.themeId?.trim(),
            state = it.state,
            workState = it.workState,
            updatedAt = it.updatedAt,
            todayDate = it.todayDate,
            plannedStartTime = it.plannedStartTime,
            plannedDurationMinutes = it.plannedDurationMinutes,
            latestWorkReceipt = it.latestWorkReceipt?.toSummary(),
            checklistItems = it.checklistItems,
            schedule = it.schedule?.toMobileTaskSchedule(),
        )
    },
    generatedAt = meta.generatedAt,
)

fun MobileWorkReceiptSummaryDto.toSummary(): MobileWorkReceiptSummary = MobileWorkReceiptSummary(
    id = id.trim(),
    reportedAt = reportedAt,
    executorLabel = executorLabel.trim(),
    summary = summary.trim(),
)

fun MobileTaskScheduleDto.toMobileTaskSchedule(): MobileTaskSchedule = MobileTaskSchedule(
    id = id,
    version = version,
    startDate = startDate,
    endDate = endDate,
    dateKind = dateKind,
    rangeSemantics = rangeSemantics,
    confidence = confidence,
    granularity = granularity,
)
