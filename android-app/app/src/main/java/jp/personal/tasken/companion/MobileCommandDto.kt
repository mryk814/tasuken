package jp.personal.tasken.companion

import java.time.OffsetDateTime
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.Json

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
    val changes: MobileTaskTitlePatchDto,
    val base: MobileTaskTitlePatchDto,
)

@Serializable
data class MobileTaskTitlePatchDto(val title: String)

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

    fun decodeReceipt(payload: String): MobileTaskCommandResponseDto =
        json.decodeFromString<MobileTaskCommandResponseDto>(payload).also { response ->
            require(response.ok)
            require(response.meta.apiVersion == 1 && response.meta.schemaVersion == 1)
            require(response.data.status in setOf("applied", "no_change"))
            require(response.data.commandId.isNotBlank())
            require(response.data.task.version > 0)
            require(runCatching { OffsetDateTime.parse(response.meta.generatedAt) }.isSuccess)
        }

    fun decodeError(payload: String): MobileTaskCommandErrorResponseDto =
        json.decodeFromString<MobileTaskCommandErrorResponseDto>(payload).also { response ->
            require(!response.ok)
            require(response.meta.apiVersion == 1 && response.meta.schemaVersion == 1)
            require(response.error.code.isNotBlank() && response.error.message.isNotBlank())
            if (response.error.code == "version_conflict") {
                val conflict = requireNotNull(response.error.conflict)
                require(conflict.intendedAction in setOf("UpdateTask", "CompleteTask", "ReopenTask"))
                require(conflict.expectedVersion > 0)
                require(conflict.currentTask.version > conflict.expectedVersion)
            } else {
                require(response.error.conflict == null)
            }
        }

    private fun validateCreateEnvelope(envelope: MobileCreateTaskEnvelopeDto) {
        require(envelope.apiVersion == 1 && envelope.schemaVersion == 1)
        require(envelope.commandId == envelope.idempotencyKey)
        require(envelope.command.name == "CreateTask")
        require(envelope.command.task.id.isNotBlank())
        require(envelope.command.task.title.isNotBlank() && envelope.command.task.title.length <= 500)
        require(runCatching { OffsetDateTime.parse(envelope.issuedAt) }.isSuccess)
    }

    private fun validateStateEnvelope(envelope: MobileTaskStateEnvelopeDto) {
        require(envelope.apiVersion == 1 && envelope.schemaVersion == 1)
        require(envelope.commandId == envelope.idempotencyKey)
        require(envelope.command.name in setOf("CompleteTask", "ReopenTask"))
        require(envelope.command.taskId.isNotBlank())
        require(envelope.command.expectedVersion > 0)
        require(runCatching { OffsetDateTime.parse(envelope.issuedAt) }.isSuccess)
    }

    private fun validateUpdateEnvelope(envelope: MobileTaskUpdateEnvelopeDto) {
        require(envelope.apiVersion == 1 && envelope.schemaVersion == 1)
        require(envelope.commandId == envelope.idempotencyKey)
        require(envelope.command.name == "UpdateTask")
        require(envelope.command.taskId.isNotBlank())
        require(envelope.command.expectedVersion > 0)
        require(envelope.command.changes.title.isNotBlank() && envelope.command.changes.title.length <= 500)
        require(envelope.command.base.title.isNotBlank() && envelope.command.base.title.length <= 500)
        require(runCatching { OffsetDateTime.parse(envelope.issuedAt) }.isSuccess)
    }
}
