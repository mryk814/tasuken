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

    fun decodeCreateEnvelope(payload: String): MobileCreateTaskEnvelopeDto =
        json.decodeFromString<MobileCreateTaskEnvelopeDto>(payload).also(::validateCreateEnvelope)

    fun decodeStateEnvelope(payload: String): MobileTaskStateEnvelopeDto =
        json.decodeFromString<MobileTaskStateEnvelopeDto>(payload).also(::validateStateEnvelope)

    fun decodeReceipt(payload: String): MobileTaskCommandResponseDto =
        json.decodeFromString<MobileTaskCommandResponseDto>(payload).also { response ->
            require(response.ok)
            require(response.meta.apiVersion == 1 && response.meta.schemaVersion == 1)
            require(response.data.status in setOf("applied", "no_change"))
            require(response.data.commandId.isNotBlank())
            require(response.data.task.version > 0)
            require(runCatching { OffsetDateTime.parse(response.meta.generatedAt) }.isSuccess)
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
}
