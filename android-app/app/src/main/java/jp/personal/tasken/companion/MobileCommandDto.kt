package jp.personal.tasken.companion

import java.time.LocalDate
import java.time.OffsetDateTime
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive

internal val PLANNED_START_TIME_PATTERN = Regex("^([01]\\d|2[0-3]):[0-5]\\d$")
internal const val PLANNED_DURATION_MINUTES_MAX = 10080

internal fun isPlannedStartTime(value: String): Boolean = PLANNED_START_TIME_PATTERN.matches(value)

internal fun isPlannedDurationMinutes(value: Int): Boolean = value in 1..PLANNED_DURATION_MINUTES_MAX

@Serializable
data class MobileCreateTaskEnvelopeDto(
    val apiVersion: Int,
    val schemaVersion: Int,
    val requestId: String,
    val commandId: String,
    val idempotencyKey: String,
    val clientDeviceId: String,
    val issuedAt: String,
    val command: MobileCreateTaskCommandDto,
)

@Serializable
data class MobileCreateTaskCommandDto(
    val name: String,
    val task: MobileCreateTaskCandidateDto,
)

@Serializable
data class MobileCreateTaskCandidateDto(
    val id: String,
    val title: String,
    val projectId: String? = null,
    val state: String = "todo",
    val priority: String = "normal",
    val requester: String = "self",
    val intendedExecutor: String = "self",
    val todayDate: String? = null,
)

@Serializable
data class MobileTaskStateEnvelopeDto(
    val apiVersion: Int,
    val schemaVersion: Int,
    val requestId: String,
    val commandId: String,
    val idempotencyKey: String,
    val clientDeviceId: String,
    val issuedAt: String,
    val command: MobileTaskStateCommandDto,
)

@Serializable
data class MobileTaskStateCommandDto(
    val name: String,
    val taskId: String,
    val expectedVersion: Int,
)

@Serializable
data class MobileTaskUpdateEnvelopeDto(
    val apiVersion: Int,
    val schemaVersion: Int,
    val requestId: String,
    val commandId: String,
    val idempotencyKey: String,
    val clientDeviceId: String,
    val issuedAt: String,
    val command: MobileTaskUpdateCommandDto,
)

@Serializable
data class MobileTaskUpdateCommandDto(
    val name: String,
    val taskId: String,
    val expectedVersion: Int,
    val expectedScheduleVersion: Int? = null,
    val changes: JsonObject,
    val base: JsonObject,
)

@Serializable
data class MobileTaskCommandResponseDto(
    val ok: Boolean,
    val meta: MobileResponseMetaDto,
    val data: MobileTaskCommandReceiptDto,
)

@Serializable
data class MobileTaskCommandReceiptDto(
    val commandId: String,
    val status: String,
    val task: MobileTaskSummaryDto,
)

@Serializable
data class MobileTaskCommandErrorResponseDto(
    val ok: Boolean,
    val meta: MobileResponseMetaDto,
    val error: MobileTaskCommandErrorDto,
)

@Serializable
data class MobileTaskCommandErrorDto(
    val code: String,
    val message: String,
    val retryable: Boolean,
    val conflict: MobileVersionConflictDto? = null,
)

@Serializable
data class MobileVersionConflictDto(
    val currentTask: MobileTaskSummaryDto,
    val intendedAction: String,
    val expectedVersion: Int,
)

object MobileTaskCommandContract {
    private val json = Json {
        ignoreUnknownKeys = false
        isLenient = false
        coerceInputValues = false
        encodeDefaults = true
        explicitNulls = true
    }

    fun encode(envelope: MobileCreateTaskEnvelopeDto): String {
        validateCreateEnvelope(envelope)
        return json.encodeToString(envelope)
    }

    fun encode(envelope: MobileTaskStateEnvelopeDto): String {
        validateStateEnvelope(envelope)
        return json.encodeToString(envelope)
    }

    fun encode(envelope: MobileTaskUpdateEnvelopeDto): String {
        validateUpdateEnvelope(envelope)
        return json.encodeToString(envelope)
    }

    fun decodeCreateEnvelope(payload: String): MobileCreateTaskEnvelopeDto =
        json.decodeFromString<MobileCreateTaskEnvelopeDto>(payload).also(::validateCreateEnvelope)

    fun decodeStateEnvelope(payload: String): MobileTaskStateEnvelopeDto =
        json.decodeFromString<MobileTaskStateEnvelopeDto>(payload).also(::validateStateEnvelope)

    fun decodeUpdateEnvelope(payload: String): MobileTaskUpdateEnvelopeDto =
        json.decodeFromString<MobileTaskUpdateEnvelopeDto>(payload).also(::validateUpdateEnvelope)

    fun decodeReceipt(payload: String): MobileTaskCommandResponseDto {
        val response = json.decodeFromString<MobileTaskCommandResponseDto>(payload)
        require(response.ok)
        require(response.meta.apiVersion == 1 && response.meta.schemaVersion == 2)
        require(response.data.status in setOf("applied", "no_change"))
        require(response.data.commandId.isNotBlank())
        validateTaskSummary(response.data.task)
        require(runCatching { OffsetDateTime.parse(response.meta.generatedAt) }.isSuccess)
        return response.copy(
            data = response.data.copy(
                task = normalizeTaskSummary(response.data.task),
            ),
        )
    }

    fun decodeError(payload: String): MobileTaskCommandErrorResponseDto {
        val response = json.decodeFromString<MobileTaskCommandErrorResponseDto>(payload)
        require(!response.ok)
        require(response.meta.apiVersion == 1 && response.meta.schemaVersion == 2)
        require(response.error.code.isNotBlank() && response.error.message.isNotBlank())
        if (response.error.code != "version_conflict") {
            require(response.error.conflict == null)
            return response
        }

        val conflict = requireNotNull(response.error.conflict)
        require(conflict.intendedAction in setOf("UpdateTask", "CompleteTask", "ReopenTask"))
        require(conflict.expectedVersion > 0)
        require(conflict.currentTask.version > conflict.expectedVersion)
        validateTaskSummary(conflict.currentTask)
        return response.copy(
            error = response.error.copy(
                conflict = conflict.copy(
                    currentTask = normalizeTaskSummary(conflict.currentTask),
                ),
            ),
        )
    }

    private fun validateCreateEnvelope(envelope: MobileCreateTaskEnvelopeDto) {
        require(envelope.apiVersion == 1 && envelope.schemaVersion == 2)
        require(envelope.commandId == envelope.idempotencyKey)
        require(envelope.command.name == "CreateTask")
        require(envelope.command.task.id.isNotBlank())
        require(envelope.command.task.title.isNotBlank() && envelope.command.task.title.length <= 500)
        require(runCatching { OffsetDateTime.parse(envelope.issuedAt) }.isSuccess)
    }

    private fun validateStateEnvelope(envelope: MobileTaskStateEnvelopeDto) {
        require(envelope.apiVersion == 1 && envelope.schemaVersion == 2)
        require(envelope.commandId == envelope.idempotencyKey)
        require(envelope.command.name in setOf("CompleteTask", "ReopenTask"))
        require(envelope.command.taskId.isNotBlank())
        require(envelope.command.expectedVersion > 0)
        require(runCatching { OffsetDateTime.parse(envelope.issuedAt) }.isSuccess)
    }

    private fun validateUpdateEnvelope(envelope: MobileTaskUpdateEnvelopeDto) {
        require(envelope.apiVersion == 1 && envelope.schemaVersion == 2)
        require(envelope.commandId == envelope.idempotencyKey)
        require(envelope.command.name == "UpdateTask")
        require(envelope.command.taskId.isNotBlank())
        require(envelope.command.expectedVersion > 0)
        require(envelope.command.changes.keys == envelope.command.base.keys)
        val field = envelope.command.changes.keys.singleOrNull()
            ?: error("UpdateTask must change exactly one field")
        validateTaskPatch(envelope.command.changes, allowNullSchedule = false)
        validateTaskPatch(envelope.command.base, allowNullSchedule = true)
        if (field == "schedule") {
            val baseSchedule = envelope.command.base.getValue("schedule")
            if (baseSchedule == JsonNull) {
                require(envelope.command.expectedScheduleVersion == null)
                val changes = envelope.command.changes.getValue("schedule") as JsonObject
                require(changes.getValue("startDate") != JsonNull || changes.getValue("endDate") != JsonNull)
            } else {
                require((envelope.command.expectedScheduleVersion ?: 0) > 0)
            }
        } else {
            require(envelope.command.expectedScheduleVersion == null)
        }
        require(runCatching { OffsetDateTime.parse(envelope.issuedAt) }.isSuccess)
    }

    private fun validateTaskPatch(patch: JsonObject, allowNullSchedule: Boolean) {
        require(patch.size == 1)
        when (val field = patch.keys.single()) {
            "title" -> {
                val value = patch[field]
                require(value is JsonPrimitive && value.isString)
                require(value.content.isNotBlank() && value.content.length <= 500)
            }
            "todayDate" -> {
                val value = patch[field]
                require(
                    value is JsonNull ||
                        (value is JsonPrimitive && value.isString &&
                            runCatching { LocalDate.parse(value.content) }.isSuccess),
                )
            }
            "themeId" -> {
                val value = patch[field]
                require(
                    value is JsonNull ||
                        (value is JsonPrimitive && value.isString && isThemeId(value.content)),
                )
            }
            "schedule" -> validateSchedulePatch(patch[field], allowNullSchedule)
            else -> error("Unsupported Task patch field: $field")
        }
    }

    private fun validateSchedulePatch(value: Any?, allowNullSchedule: Boolean) {
        if (value == JsonNull) {
            require(allowNullSchedule)
            return
        }
        require(value is JsonObject)
        require(value.keys == setOf("startDate", "endDate", "rangeSemantics"))
        val start = nullableDate(value.getValue("startDate"))
        val end = nullableDate(value.getValue("endDate"))
        require(start == null || end == null || !end.isBefore(start))
        val semantics = value.getValue("rangeSemantics").let {
            when (it) {
                JsonNull -> null
                is JsonPrimitive -> {
                    require(it.isString && it.content in setOf("once_within_window", "ongoing"))
                    it.content
                }
                else -> error("Invalid Schedule rangeSemantics")
            }
        }
        require(semantics == null || (start != null && end != null && end.isAfter(start)))
    }

    private fun nullableDate(value: Any?): LocalDate? = when (value) {
        JsonNull -> null
        is JsonPrimitive -> {
            require(value.isString)
            LocalDate.parse(value.content)
        }
        else -> error("Invalid Schedule date")
    }

    private fun validateTaskSummary(task: MobileTaskSummaryDto) {
        require(task.id.isNotBlank() && task.id.length <= 200)
        require(task.version > 0)
        require(task.title.isNotBlank() && task.title.length <= 500)
        require(task.themeId == null || isThemeId(task.themeId))
        require(task.state in setOf("todo", "doing", "waiting", "review", "done", "cancelled"))
        require(task.todayDate == null || runCatching { LocalDate.parse(task.todayDate) }.isSuccess)
        require(task.plannedStartTime == null || isPlannedStartTime(task.plannedStartTime))
        require(task.plannedDurationMinutes == null || isPlannedDurationMinutes(task.plannedDurationMinutes))
        task.latestWorkReceipt?.let { receipt ->
            require(receipt.id.isNotBlank() && receipt.id.length <= 200)
            require(receipt.executorLabel.isNotBlank() && receipt.executorLabel.length <= 200)
            require(receipt.summary.isNotBlank() && receipt.summary.length <= 2000)
        }
        task.schedule?.let { schedule ->
            require(schedule.id.isNotBlank() && schedule.id.length <= 200)
            require(schedule.version > 0)
            val start = schedule.startDate?.let(LocalDate::parse)
            val end = schedule.endDate?.let(LocalDate::parse)
            require(start == null || end == null || !end.isBefore(start))
            val expectedKind = when {
                start == null && end == null -> "unknown"
                start == null -> "deadline"
                end == null || start == end -> "point"
                else -> "range"
            }
            require(schedule.dateKind == expectedKind)
            require(schedule.rangeSemantics == null || schedule.rangeSemantics in setOf("once_within_window", "ongoing"))
            require(schedule.rangeSemantics == null || (start != null && end != null && end.isAfter(start)))
            require(schedule.confidence in setOf("rough", "tentative", "fixed"))
            require(schedule.granularity in setOf("day", "week", "month"))
        }
        require(runCatching { OffsetDateTime.parse(task.updatedAt) }.isSuccess)
    }

    private fun normalizeThemeId(value: String?): String? = value?.trim()?.also {
        require(it.isNotEmpty() && it.length <= 200)
    }

    private fun normalizeTaskSummary(task: MobileTaskSummaryDto): MobileTaskSummaryDto = task.copy(
        id = task.id.trim(),
        title = task.title.trim(),
        themeId = normalizeThemeId(task.themeId),
        schedule = task.schedule?.copy(id = task.schedule.id.trim()),
    )

    private fun isThemeId(value: String): Boolean = value.isNotBlank() && value.length <= 200
}
