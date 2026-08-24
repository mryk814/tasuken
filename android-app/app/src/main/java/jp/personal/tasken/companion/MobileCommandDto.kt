package jp.personal.tasken.companion

import java.time.LocalDate
import java.time.OffsetDateTime
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
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
    val provenance: MobileTaskCreationProvenanceDto? = null,
)

@Serializable
data class MobileTaskCreationProvenanceDto(
    val reportedVia: String,
    val capturedAt: String,
    val captureMethod: String? = null,
    val recognitionMode: String? = null,
    val language: String? = null,
    val confidence: Float? = null,
    val sourceAudioAvailable: Boolean? = null,
    val sharedMimeType: String? = null,
)

internal fun MobileCaptureDraft.toTaskCreationProvenanceDto(): MobileTaskCreationProvenanceDto =
    MobileTaskCreationProvenanceDto(
        reportedVia = source.wireValue,
        capturedAt = createdAt,
        captureMethod = speech?.let { "android_speech" },
        recognitionMode = speech?.recognitionMode?.wireValue,
        language = speech?.language,
        confidence = speech?.confidence,
        sourceAudioAvailable = speech?.sourceAudioAvailable,
        sharedMimeType = share?.mimeType,
    )

internal fun MobileCaptureDraft.toCaptureCreationProvenanceDto(): MobileTaskCreationProvenanceDto =
    toTaskCreationProvenanceDto()

@Serializable
data class MobileCreateCaptureEnvelopeDto(
    val apiVersion: Int,
    val schemaVersion: Int,
    val requestId: String,
    val commandId: String,
    val idempotencyKey: String,
    val clientDeviceId: String,
    val issuedAt: String,
    val command: MobileCreateCaptureCommandDto,
)

@Serializable
data class MobileCreateCaptureCommandDto(
    val name: String,
    val capture: MobileCreateCaptureCandidateDto,
    val provenance: MobileTaskCreationProvenanceDto? = null,
)

@Serializable
data class MobileCreateCaptureCandidateDto(
    val id: String,
    val text: String,
    val projectId: String? = null,
    val capturedAt: String,
)

@Serializable
data class MobileDeleteCaptureEnvelopeDto(
    val apiVersion: Int,
    val schemaVersion: Int,
    val requestId: String,
    val commandId: String,
    val idempotencyKey: String,
    val clientDeviceId: String,
    val issuedAt: String,
    val command: MobileDeleteCaptureCommandDto,
)

@Serializable
data class MobileDeleteCaptureCommandDto(
    val name: String,
    val captureId: String,
    val expectedVersion: Int,
)

@Serializable
data class MobileCaptureCommandResponseDto(
    val ok: Boolean,
    val meta: MobileResponseMetaDto,
    val data: MobileCaptureCommandReceiptDto,
)

@Serializable
data class MobileCaptureCommandReceiptDto(
    val commandId: String,
    val status: String,
    val capture: MobileCaptureReceiptDto,
)

@Serializable
data class MobileCaptureReceiptDto(
    val id: String,
    val version: Int,
    val capturedAt: String,
    val deleted: Boolean,
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
    val conflictField: String,
    val expectedScheduleVersion: Int? = null,
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
        require(response.meta.apiVersion == TASKEN_MOBILE_API_VERSION &&
            response.meta.schemaVersion == TASKEN_MOBILE_SCHEMA_VERSION)
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
        require(response.meta.apiVersion == TASKEN_MOBILE_API_VERSION &&
            response.meta.schemaVersion == TASKEN_MOBILE_SCHEMA_VERSION)
        require(response.error.code.isNotBlank() && response.error.message.isNotBlank())
        if (response.error.code != "version_conflict") {
            require(response.error.conflict == null)
            return response
        }

        val conflict = requireNotNull(response.error.conflict)
        require(conflict.intendedAction in setOf("UpdateTask", "CompleteTask", "ReopenTask", "DeleteTask"))
        require(conflict.expectedVersion > 0)
        require(conflict.conflictField in setOf("task", "schedule"))
        if (conflict.conflictField == "task") {
            require(conflict.expectedScheduleVersion == null)
            require(conflict.currentTask.version > conflict.expectedVersion)
        } else {
            require(conflict.intendedAction == "UpdateTask")
            require(conflict.expectedScheduleVersion == null || conflict.expectedScheduleVersion > 0)
            require(
                conflict.expectedScheduleVersion == null ||
                    conflict.currentTask.schedule == null ||
                    conflict.currentTask.schedule.version != conflict.expectedScheduleVersion,
            )
        }
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
        require(envelope.apiVersion == TASKEN_MOBILE_API_VERSION &&
            envelope.schemaVersion == TASKEN_MOBILE_SCHEMA_VERSION)
        require(envelope.commandId == envelope.idempotencyKey)
        require(envelope.command.name == "CreateTask")
        require(envelope.command.task.id.isNotBlank())
        require(envelope.command.task.title.isNotBlank() && envelope.command.task.title.length <= 500)
        require(runCatching { OffsetDateTime.parse(envelope.issuedAt) }.isSuccess)
        envelope.command.provenance?.let(::validateCreationProvenance)
    }

    private fun validateCreationProvenance(provenance: MobileTaskCreationProvenanceDto) {
        require(provenance.reportedVia in setOf("android_app", "widget", "app_shortcut", "share_target", "android_speech"))
        require(runCatching { OffsetDateTime.parse(provenance.capturedAt) }.isSuccess)
        require(provenance.captureMethod == null || provenance.captureMethod == "android_speech")
        provenance.confidence?.let { require(it.isFinite() && it in 0f..1f) }
        val hasSpeech = provenance.captureMethod == "android_speech"
        if (hasSpeech) {
            require(provenance.reportedVia == "android_speech")
            require(provenance.recognitionMode in setOf("on_device", "system_service", "unknown"))
            require(provenance.language?.isNotBlank() == true && provenance.language.length <= 64)
            require(provenance.sourceAudioAvailable == false)
        } else {
            require(provenance.recognitionMode == null)
            require(provenance.language == null)
            require(provenance.confidence == null)
            require(provenance.sourceAudioAvailable == null)
        }
        require((provenance.reportedVia == "share_target") == (provenance.sharedMimeType != null))
        require(provenance.sharedMimeType == null || provenance.sharedMimeType == "text/plain")
    }

    private fun validateStateEnvelope(envelope: MobileTaskStateEnvelopeDto) {
        require(envelope.apiVersion == TASKEN_MOBILE_API_VERSION &&
            envelope.schemaVersion == TASKEN_MOBILE_SCHEMA_VERSION)
        require(envelope.commandId == envelope.idempotencyKey)
        require(envelope.command.name in setOf("CompleteTask", "ReopenTask", "DeleteTask"))
        require(envelope.command.taskId.isNotBlank())
        require(envelope.command.expectedVersion > 0)
        require(runCatching { OffsetDateTime.parse(envelope.issuedAt) }.isSuccess)
    }

    private fun validateUpdateEnvelope(envelope: MobileTaskUpdateEnvelopeDto) {
        require(envelope.apiVersion == TASKEN_MOBILE_API_VERSION &&
            envelope.schemaVersion == TASKEN_MOBILE_SCHEMA_VERSION)
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
            "checklistItems" -> validateChecklistPatch(patch[field])
            else -> error("Unsupported Task patch field: $field")
        }
    }

    private fun validateChecklistPatch(value: Any?) {
        require(value is JsonArray && value.size <= 100)
        val ids = mutableSetOf<String>()
        value.forEach { element ->
            require(element is JsonObject)
            require(element.keys == setOf("id", "title", "done", "sortOrder", "completedAt"))
            val id = element.getValue("id")
            val title = element.getValue("title")
            val done = element.getValue("done")
            val sortOrder = element.getValue("sortOrder")
            val completedAt = element.getValue("completedAt")
            require(id is JsonPrimitive && id.isString && id.content.isNotBlank() && id.content.length <= 200)
            require(ids.add(id.content))
            require(title is JsonPrimitive && title.isString && title.content.isNotBlank() && title.content.length <= 200)
            require(done is JsonPrimitive && !done.isString && done.content in setOf("true", "false"))
            require(sortOrder is JsonPrimitive && !sortOrder.isString && sortOrder.content.toDoubleOrNull()?.isFinite() == true)
            require(
                completedAt == JsonNull ||
                    (completedAt is JsonPrimitive && completedAt.isString &&
                        runCatching { OffsetDateTime.parse(completedAt.content) }.isSuccess),
            )
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
        require(task.checklistItems.size <= 100)
        require(task.checklistItems.map { it.id }.distinct().size == task.checklistItems.size)
        task.checklistItems.forEach { item ->
            require(item.id.isNotBlank() && item.id.length <= 200)
            require(item.title.isNotBlank() && item.title.length <= 200)
            require(item.sortOrder.isFinite())
            require(item.completedAt == null || runCatching { OffsetDateTime.parse(item.completedAt) }.isSuccess)
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
        checklistItems = task.checklistItems
            .map { it.copy(id = it.id.trim(), title = it.title.trim()) }
            .sortedWith(compareBy<MobileChecklistItem> { it.sortOrder }.thenBy { it.id }),
        schedule = task.schedule?.copy(id = task.schedule.id.trim()),
    )

    private fun isThemeId(value: String): Boolean = value.isNotBlank() && value.length <= 200
}

object MobileCaptureCommandContract {
    private val json = Json {
        ignoreUnknownKeys = false
        isLenient = false
        coerceInputValues = false
        encodeDefaults = true
        explicitNulls = true
    }

    fun encode(envelope: MobileCreateCaptureEnvelopeDto): String {
        validate(envelope)
        return json.encodeToString(envelope)
    }

    fun encode(envelope: MobileDeleteCaptureEnvelopeDto): String {
        validate(envelope)
        return json.encodeToString(envelope)
    }

    fun decodeCreateEnvelope(payload: String): MobileCreateCaptureEnvelopeDto =
        json.decodeFromString<MobileCreateCaptureEnvelopeDto>(payload).also(::validate)

    fun decodeDeleteEnvelope(payload: String): MobileDeleteCaptureEnvelopeDto =
        json.decodeFromString<MobileDeleteCaptureEnvelopeDto>(payload).also(::validate)

    fun decodeReceipt(payload: String): MobileCaptureCommandResponseDto {
        val response = json.decodeFromString<MobileCaptureCommandResponseDto>(payload)
        require(response.ok)
        require(response.meta.apiVersion == TASKEN_MOBILE_API_VERSION &&
            response.meta.schemaVersion == TASKEN_MOBILE_SCHEMA_VERSION)
        require(response.data.commandId.isNotBlank())
        require(response.data.status in setOf("applied", "no_change"))
        require(response.data.capture.id.isNotBlank())
        require(response.data.capture.version > 0)
        require(runCatching { OffsetDateTime.parse(response.data.capture.capturedAt) }.isSuccess)
        require(runCatching { OffsetDateTime.parse(response.meta.generatedAt) }.isSuccess)
        return response
    }

    private fun validate(envelope: MobileCreateCaptureEnvelopeDto) {
        require(envelope.apiVersion == TASKEN_MOBILE_API_VERSION &&
            envelope.schemaVersion == TASKEN_MOBILE_SCHEMA_VERSION)
        require(envelope.commandId == envelope.idempotencyKey)
        require(envelope.command.name == "CreateCapture")
        require(envelope.command.capture.id.isNotBlank())
        require(envelope.command.capture.text.isNotBlank() && envelope.command.capture.text.length <= 500)
        require(envelope.command.capture.projectId == null || envelope.command.capture.projectId.isNotBlank())
        require(runCatching { OffsetDateTime.parse(envelope.command.capture.capturedAt) }.isSuccess)
        require(envelope.command.capture.capturedAt == envelope.issuedAt)
        require(runCatching { OffsetDateTime.parse(envelope.issuedAt) }.isSuccess)
        envelope.command.provenance?.let {
            validateCreationProvenance(it)
            require(it.capturedAt == envelope.command.capture.capturedAt)
        }
    }

    private fun validate(envelope: MobileDeleteCaptureEnvelopeDto) {
        require(envelope.apiVersion == TASKEN_MOBILE_API_VERSION &&
            envelope.schemaVersion == TASKEN_MOBILE_SCHEMA_VERSION)
        require(envelope.commandId == envelope.idempotencyKey)
        require(envelope.command.name == "DeleteCapture")
        require(envelope.command.captureId.isNotBlank())
        require(envelope.command.expectedVersion > 0)
        require(runCatching { OffsetDateTime.parse(envelope.issuedAt) }.isSuccess)
    }

    private fun validateCreationProvenance(provenance: MobileTaskCreationProvenanceDto) {
        require(provenance.reportedVia in setOf("android_app", "widget", "app_shortcut", "share_target", "android_speech"))
        require(runCatching { OffsetDateTime.parse(provenance.capturedAt) }.isSuccess)
        require(provenance.captureMethod == null || provenance.captureMethod == "android_speech")
        provenance.confidence?.let { require(it.isFinite() && it in 0f..1f) }
        val hasSpeech = provenance.captureMethod == "android_speech"
        if (hasSpeech) {
            require(provenance.reportedVia == "android_speech")
            require(provenance.recognitionMode in setOf("on_device", "system_service", "unknown"))
            require(provenance.language?.isNotBlank() == true && provenance.language.length <= 64)
            require(provenance.sourceAudioAvailable == false)
        } else {
            require(provenance.recognitionMode == null)
            require(provenance.language == null)
            require(provenance.confidence == null)
            require(provenance.sourceAudioAvailable == null)
        }
        require((provenance.reportedVia == "share_target") == (provenance.sharedMimeType != null))
        require(provenance.sharedMimeType == null || provenance.sharedMimeType == "text/plain")
    }
}
