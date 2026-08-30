package jp.personal.tasken.companion

import java.time.OffsetDateTime
import java.util.UUID
import kotlinx.serialization.Serializable
import kotlinx.serialization.encodeToString
import kotlinx.serialization.json.Json

@Serializable
data class MobileTaskContextPreviewResponseDto(
    val ok: Boolean,
    val meta: MobileResponseMetaDto,
    val data: MobileTaskContextPreviewDataDto,
)

/** The preview is intentionally in-memory only. Do not add it to Room or saved state. */
@Serializable
data class MobileTaskContextPreviewDataDto(
    val contextFingerprint: String,
    val task: MobileTaskContextPreviewTaskDto,
    val theme: MobileTaskContextEntityDto? = null,
    val repositoryContexts: List<MobileRepositoryContextDto> = emptyList(),
    val related: MobileTaskContextPreviewRelatedDto,
    val contextSelection: MobileTaskContextSelectionDto,
    val warnings: List<MobileTaskContextWarningDto> = emptyList(),
    val truncation: List<MobileTaskContextTruncationDto> = emptyList(),
)

@Serializable
data class MobileTaskContextPreviewTaskDto(
    val id: String,
    val version: Int,
    val title: String,
    val description: String?,
    val state: String,
    val workState: String,
    val updatedAt: String?,
    val ai: MobileTaskContextPreviewAiDto? = null,
)

@Serializable
data class MobileTaskContextPreviewAiDto(
    val visibility: List<String>,
    val visibilitySource: String?,
    val authority: String? = null,
    val freshness: String,
    val summaryAuthority: String?,
)

@Serializable
data class MobileTaskContextPreviewRefDto(
    val id: String,
    val type: String,
)

@Serializable
data class MobileTaskContextRelationStepDto(
    val from: MobileTaskContextPreviewRefDto,
    val predicate: String?,
    val to: MobileTaskContextPreviewRefDto,
    val status: String?,
    val reason: String?,
)

@Serializable
data class MobileTaskContextEntityDto(
    val ref: MobileTaskContextPreviewRefDto,
    val version: Int,
    val title: String?,
    val summary: String?,
    val includedBecause: String?,
    val ai: MobileTaskContextPreviewAiDto?,
    val relationPath: List<MobileTaskContextRelationStepDto>,
    val artifact: MobileTaskContextArtifactDto?,
)

@Serializable
data class MobileTaskContextArtifactDto(
    val filename: String?,
    val fileType: String?,
    val mimeType: String?,
    val fileSize: Double?,
)

@Serializable
data class MobileRepositoryContextDto(
    val id: String,
    val label: String,
    val provider: String,
    val repositorySlug: String?,
    val defaultBranch: String?,
)

@Serializable
data class MobileTaskContextPreviewRelatedDto(
    val notes: List<MobileTaskContextEntityDto> = emptyList(),
    val conversations: List<MobileTaskContextEntityDto> = emptyList(),
    val artifacts: List<MobileTaskContextEntityDto> = emptyList(),
    val resources: List<MobileTaskContextEntityDto> = emptyList(),
    val activity: List<MobileTaskContextActivityDto> = emptyList(),
)

@Serializable
data class MobileTaskContextActivityDto(
    val id: String,
    val eventKind: String,
    val occurredAt: String,
    val summary: String,
    val includedBecause: String,
)

@Serializable
data class MobileTaskContextSelectionDto(
    val schema: String,
    val included: List<MobileTaskContextSelectionIncludedDto> = emptyList(),
    val excluded: List<MobileTaskContextSelectionExcludedDto> = emptyList(),
    val truncated: Boolean,
)

@Serializable
data class MobileTaskContextSelectionIncludedDto(
    val ref: MobileTaskContextPreviewRefDto,
    val reason: String?,
    val title: String?,
    val ai: MobileTaskContextPreviewAiDto?,
    val relationPath: List<MobileTaskContextRelationStepDto> = emptyList(),
)

@Serializable
data class MobileTaskContextSelectionExcludedDto(
    val ref: MobileTaskContextPreviewRefDto,
    val reason: String,
    val count: Int,
)

@Serializable
data class MobileTaskContextWarningDto(val code: String, val message: String)

@Serializable
data class MobileTaskContextTruncationDto(
    val section: String,
    val reason: String,
    val omittedCount: Int?,
    val used: Int?,
    val limit: Int?,
)

@Serializable
data class MobileTaskDelegationEnvelopeDto(
    val apiVersion: Int,
    val schemaVersion: Int,
    val requestId: String,
    val commandId: String,
    val taskId: String,
    val expectedTaskVersion: Int,
    val agent: String,
    val expectedResult: String? = null,
    val instruction: String? = null,
    val issuedAt: String,
    val actorId: String,
    val contextFingerprint: String,
)

@Serializable
data class MobileTaskDelegationResponseDto(
    val ok: Boolean,
    val meta: MobileResponseMetaDto,
    val data: MobileTaskDelegationDataDto,
)

@Serializable
data class MobileTaskDelegationDataDto(
    val commandId: String,
    val status: String,
    val task: MobileTaskSummaryDto,
    val safeShare: MobileSafeShareDto,
)

/** The Android share adapter may receive only this projection. */
@Serializable
data class MobileSafeShareDto(
    val mimeType: String,
    val title: String,
    val taskId: String,
    val taskLocator: String,
    val instruction: String? = null,
    val text: String,
)

data class MobileTaskContextPreview(
    val taskId: String,
    val taskVersion: Int,
    val fingerprint: String,
    val title: String,
    val includedCount: Int,
    val excludedCount: Int,
    val truncated: Boolean,
    val warnings: List<String>,
    val data: MobileTaskContextPreviewDataDto,
)

internal fun normalizeDelegationInput(value: String?): String? = value
    ?.replace(Regex("[\\u0000-\\u001F\\u007F]+"), " ")
    ?.replace(Regex("\\s+"), " ")
    ?.replace("@everyone", "@\u200beveryone")
    ?.replace("@here", "@\u200bhere")
    ?.replace("<@", "<@\u200b")
    ?.trim()
    ?.takeIf(String::isNotEmpty)

sealed interface MobileTaskContextPreviewResult {
    data class Available(val preview: MobileTaskContextPreview) : MobileTaskContextPreviewResult
    data class Unavailable(val taskId: String, val message: String) : MobileTaskContextPreviewResult
}

sealed interface MobileTaskDelegationResult {
    data class Applied(val taskId: String, val safeShare: MobileSafeShareDto) : MobileTaskDelegationResult
    data class Conflict(val taskId: String, val message: String) : MobileTaskDelegationResult
    data class Rejected(val taskId: String, val message: String) : MobileTaskDelegationResult
    data class Unavailable(val taskId: String, val message: String) : MobileTaskDelegationResult
}

internal fun taskDelegationCommandId(
    clientDeviceId: String,
    serverId: String,
    taskId: String,
    expectedTaskVersion: Int,
    fingerprint: String,
    expectedResult: String?,
    instruction: String?,
): String = UUID.nameUUIDFromBytes(
    listOf(
        "tasken-mobile-task-delegation-v1",
        clientDeviceId,
        serverId,
        taskId,
        expectedTaskVersion.toString(),
        fingerprint,
        expectedResult.orEmpty(),
        instruction.orEmpty(),
    ).joinToString("") { "${it.toByteArray(Charsets.UTF_8).size}:$it" }.toByteArray(Charsets.UTF_8),
).toString()

object MobileTaskDelegationContract {
    private val json = Json {
        ignoreUnknownKeys = false
        isLenient = false
        coerceInputValues = false
        encodeDefaults = true
        // The request schema makes expectedResult/instruction optional rather than nullable.
        // Omitting nulls preserves that exact wire contract for durable replay.
        explicitNulls = false
    }

    fun encode(envelope: MobileTaskDelegationEnvelopeDto): String {
        validateEnvelope(envelope)
        return json.encodeToString(envelope)
    }

    fun decodeEnvelope(value: String): MobileTaskDelegationEnvelopeDto =
        json.decodeFromString<MobileTaskDelegationEnvelopeDto>(value).also(::validateEnvelope)

    fun decodePreview(value: String): MobileTaskContextPreviewResponseDto =
        json.decodeFromString<MobileTaskContextPreviewResponseDto>(value).also(::validatePreview)

    fun decodeDelegation(value: String): MobileTaskDelegationResponseDto =
        json.decodeFromString<MobileTaskDelegationResponseDto>(value).also(::validateDelegation)

    fun toPreview(value: MobileTaskContextPreviewResponseDto): MobileTaskContextPreview =
        MobileTaskContextPreview(
            taskId = value.data.task.id,
            taskVersion = value.data.task.version,
            fingerprint = value.data.contextFingerprint,
            title = value.data.task.title,
            includedCount = value.data.contextSelection.included.size,
            excludedCount = value.data.contextSelection.excluded.sumOf { it.count },
            truncated = value.data.contextSelection.truncated || value.meta.truncated,
            warnings = value.data.warnings.map(MobileTaskContextWarningDto::message),
            data = value.data,
        )

    private fun validateMeta(meta: MobileResponseMetaDto) {
        require(meta.apiVersion == TASKEN_MOBILE_API_VERSION && meta.schemaVersion == TASKEN_MOBILE_SCHEMA_VERSION)
        require(meta.serverId.isNotBlank() && meta.serverId.length <= 200)
        require(OffsetDateTime.parse(meta.generatedAt) != null)
    }

    private fun validatePreview(response: MobileTaskContextPreviewResponseDto) {
        require(response.ok)
        validateMeta(response.meta)
        require(response.data.contextFingerprint.matches(Regex("sha256:[0-9a-f]{64}")))
        require(MobileTaskLocator.isCanonicalTaskId(response.data.task.id))
        require(response.data.task.version >= 0)
        require(response.data.task.title.isNotBlank() && response.data.task.title.length <= 500)
        require(response.data.task.description?.length ?: 0 <= 4_000)
        require(response.data.contextSelection.schema == "tasken-context-selection/v1")
        require(response.data.contextSelection.excluded.all { it.count > 0 })
    }

    private fun validateEnvelope(envelope: MobileTaskDelegationEnvelopeDto) {
        require(envelope.apiVersion == TASKEN_MOBILE_API_VERSION && envelope.schemaVersion == TASKEN_MOBILE_SCHEMA_VERSION)
        require(envelope.requestId.isNotBlank() && envelope.requestId.length <= 200)
        require(envelope.commandId.isNotBlank() && envelope.commandId.length <= 200)
        require(MobileTaskLocator.isCanonicalTaskId(envelope.taskId))
        require(envelope.expectedTaskVersion >= 0 && envelope.agent == "hermes")
        require(envelope.expectedResult?.length ?: 0 <= 2_000)
        require(envelope.instruction?.length ?: 0 <= 2_000)
        require(envelope.actorId.isNotBlank() && envelope.actorId.length <= 200)
        require(envelope.contextFingerprint.isNotBlank() && envelope.contextFingerprint.length <= 200)
        require(OffsetDateTime.parse(envelope.issuedAt) != null)
    }

    private fun validateDelegation(response: MobileTaskDelegationResponseDto) {
        require(response.ok)
        validateMeta(response.meta)
        require(response.data.commandId.isNotBlank() && response.data.status in setOf("applied", "no_change"))
        require(MobileTaskLocator.isCanonicalTaskId(response.data.task.id) && response.data.task.version >= 0)
        val share = response.data.safeShare
        require(share.mimeType == "text/plain" && share.taskId == response.data.task.id)
        require(share.title.isNotBlank() && share.title.length <= 500)
        require(share.text.isNotBlank() && share.text.length <= 8_000)
        require(share.taskLocator == MobileTaskLocator.format(share.taskId))
    }
}
