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
data class MobileCreateTaskResponseDto(
    val ok: Boolean,
    val meta: MobileResponseMetaDto,
    val data: MobileCreateTaskReceiptDto,
)

@Serializable
data class MobileCreateTaskReceiptDto(
    val commandId: String,
    val status: String,
    val task: MobileTaskSummaryDto,
)

object MobileCreateTaskContract {
    private val json = Json {
        ignoreUnknownKeys = false
        isLenient = false
        coerceInputValues = false
        encodeDefaults = true
        explicitNulls = true
    }

    fun encode(envelope: MobileCreateTaskEnvelopeDto): String {
        validateEnvelope(envelope)
        return json.encodeToString(envelope)
    }

    fun decodeEnvelope(payload: String): MobileCreateTaskEnvelopeDto =
        json.decodeFromString<MobileCreateTaskEnvelopeDto>(payload).also(::validateEnvelope)

    fun decodeReceipt(payload: String): MobileCreateTaskResponseDto =
        json.decodeFromString<MobileCreateTaskResponseDto>(payload).also { response ->
            require(response.ok)
            require(response.meta.apiVersion == 1 && response.meta.schemaVersion == 1)
            require(response.data.status in setOf("applied", "no_change"))
            require(response.data.commandId.isNotBlank())
            require(runCatching { OffsetDateTime.parse(response.meta.generatedAt) }.isSuccess)
        }

    private fun validateEnvelope(envelope: MobileCreateTaskEnvelopeDto) {
        require(envelope.apiVersion == 1 && envelope.schemaVersion == 1)
        require(envelope.commandId == envelope.idempotencyKey)
        require(envelope.command.name == "CreateTask")
        require(envelope.command.task.id.isNotBlank())
        require(envelope.command.task.title.isNotBlank() && envelope.command.task.title.length <= 500)
        require(runCatching { OffsetDateTime.parse(envelope.issuedAt) }.isSuccess)
    }
}
