package jp.personal.tasken.companion

import java.net.URI
import java.time.OffsetDateTime
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.Json

@Serializable
data class MobileTaskWorkProposalsResponseDto(
    val ok: Boolean,
    val meta: MobileResponseMetaDto,
    val data: MobileTaskWorkProposalsDataDto,
)

@Serializable
data class MobileTaskWorkProposalsDataDto(
    val proposals: List<MobileTaskWorkProposalDto>,
)

@Serializable
data class MobileTaskWorkProposalDto(
    val id: String,
    val version: Int,
    val status: String,
    val task: MobileTaskWorkProposalTaskDto,
    val action: String,
    val caller: String,
    val sourceApp: String,
    val receivedAt: String,
    val expectedTaskVersion: Int,
    val stale: Boolean,
    val executorLabel: String? = null,
    val startedAt: String? = null,
    val reportedAt: String? = null,
    val summary: String? = null,
    val completedItems: List<String> = emptyList(),
    val changedOrCreatedItems: List<String> = emptyList(),
    val verification: List<String> = emptyList(),
    val remainingWork: List<String> = emptyList(),
    val externalReferences: List<MobileWorkReceiptExternalReferenceDto> = emptyList(),
)

@Serializable
data class MobileTaskWorkProposalTaskDto(
    val id: String,
    val version: Int,
    val title: String,
    val themeId: String? = null,
    val workState: String? = null,
)

@Serializable
data class MobileTaskWorkProposalDecisionEnvelopeDto(
    val apiVersion: Int,
    val schemaVersion: Int,
    val requestId: String,
    val commandId: String,
    val idempotencyKey: String,
    val clientDeviceId: String,
    val issuedAt: String,
    val proposalId: String,
    val taskId: String,
    val expectedProposalVersion: Int,
    val expectedTaskVersion: Int,
    val decision: String,
)

@Serializable
data class MobileTaskWorkProposalDecisionResponseDto(
    val ok: Boolean,
    val meta: MobileResponseMetaDto,
    val data: MobileTaskWorkProposalDecisionDataDto,
)

@Serializable
data class MobileTaskWorkProposalDecisionDataDto(
    val commandId: String,
    val commandStatus: String,
    val proposalId: String,
    val proposalStatus: String,
    val decision: String,
    val taskId: String,
    val taskVersion: Int,
)

class MobileProposalContractException(message: String, cause: Throwable? = null) :
    IllegalArgumentException(message, cause)

object MobileProposalContract {
    private val json = Json {
        ignoreUnknownKeys = false
        isLenient = false
        coerceInputValues = false
        encodeDefaults = true
        explicitNulls = true
    }

    fun decodeList(payload: String): MobileTaskWorkProposalsResponseDto = try {
        json.decodeFromString<MobileTaskWorkProposalsResponseDto>(payload).also(::validateList)
    } catch (error: MobileProposalContractException) {
        throw error
    } catch (error: Exception) {
        throw MobileProposalContractException("Proposal一覧の応答が不正です。", error)
    }

    fun encodeDecision(envelope: MobileTaskWorkProposalDecisionEnvelopeDto): String {
        validateDecisionEnvelope(envelope)
        return json.encodeToString(envelope)
    }

    fun decodeDecision(payload: String): MobileTaskWorkProposalDecisionResponseDto = try {
        json.decodeFromString<MobileTaskWorkProposalDecisionResponseDto>(payload).also(::validateDecisionResponse)
    } catch (error: MobileProposalContractException) {
        throw error
    } catch (error: Exception) {
        throw MobileProposalContractException("Proposal判断の応答が不正です。", error)
    }

    internal fun encodeCachedProposal(proposal: MobileTaskWorkProposalDto): String {
        validateProposal(proposal)
        return json.encodeToString(proposal)
    }

    internal fun decodeCachedProposal(payload: String): MobileTaskWorkProposalDto = try {
        json.decodeFromString<MobileTaskWorkProposalDto>(payload).also(::validateProposal)
    } catch (error: Exception) {
        throw MobileProposalContractException("保存済みProposalが不正です。", error)
    }

    private fun validateList(response: MobileTaskWorkProposalsResponseDto) {
        requireProposal(response.ok, "Proposal一覧は成功応答である必要があります。")
        requireProposal(
            response.meta.apiVersion == TASKEN_MOBILE_API_VERSION &&
                response.meta.schemaVersion == TASKEN_MOBILE_SCHEMA_VERSION,
            "未対応のProposal contractです。",
        )
        requireTimestamp(response.meta.generatedAt, "Proposal generatedAt")
        requireProposal(response.meta.serverId.isNotBlank(), "Proposal serverIdがありません。")
        requireProposal(response.data.proposals.size <= 50, "Proposal一覧が上限を超えています。")
        requireProposal(
            response.data.proposals.map { it.id }.distinct().size == response.data.proposals.size,
            "Proposal IDが重複しています。",
        )
        response.data.proposals.forEach(::validateProposal)
    }

    private fun validateProposal(proposal: MobileTaskWorkProposalDto) {
        requireText(proposal.id, 200, "Proposal ID")
        requireProposal(proposal.version >= 0, "Proposal versionが不正です。")
        requireProposal(proposal.status == "pending", "Pending以外のProposalは表示できません。")
        requireText(proposal.task.id, 200, "Proposal task ID")
        requireProposal(proposal.task.version >= 0, "Proposal task versionが不正です。")
        requireText(proposal.task.title, 500, "Proposal task title")
        proposal.task.themeId?.let { requireText(it, 200, "Proposal Theme ID") }
        requireProposal(
            proposal.task.workState == null || proposal.task.workState in setOf(
                "not_delegated",
                "ready_for_agent",
                "in_progress",
                "reported_done",
                "needs_human_review",
                "accepted",
                "blocked",
                "failed",
            ),
            "Proposal work stateが不正です。",
        )
        requireProposal(
            proposal.action in setOf("start", "append_receipt", "report_done", "report_blocked"),
            "Proposal actionが不正です。",
        )
        requireText(proposal.caller, 200, "Proposal caller")
        requireText(proposal.sourceApp, 120, "Proposal source app")
        requireTimestamp(proposal.receivedAt, "Proposal receivedAt")
        requireProposal(proposal.expectedTaskVersion >= 0, "Proposal expected Task versionが不正です。")
        proposal.executorLabel?.let { requireText(it, 200, "Proposal executor label") }
        proposal.startedAt?.let { requireTimestamp(it, "Proposal startedAt") }
        proposal.reportedAt?.let { requireTimestamp(it, "Proposal reportedAt") }
        proposal.summary?.let { requireText(it, 10_000, "Proposal summary") }
        listOf(
            proposal.completedItems,
            proposal.changedOrCreatedItems,
            proposal.verification,
            proposal.remainingWork,
        ).forEach { items ->
            requireProposal(items.size <= 20, "Proposalの項目数が上限を超えています。")
            items.forEach { requireText(it, 400, "Proposal item") }
        }
        requireProposal(proposal.externalReferences.size <= 10, "Proposalの参照数が上限を超えています。")
        proposal.externalReferences.forEach(::validateExternalReference)
    }

    private fun validateDecisionEnvelope(envelope: MobileTaskWorkProposalDecisionEnvelopeDto) {
        requireProposal(
            envelope.apiVersion == TASKEN_MOBILE_API_VERSION &&
                envelope.schemaVersion == TASKEN_MOBILE_SCHEMA_VERSION,
            "未対応のProposal判断contractです。",
        )
        requireText(envelope.requestId, 200, "Proposal request ID")
        requireText(envelope.commandId, 200, "Proposal command ID")
        requireProposal(envelope.commandId == envelope.idempotencyKey, "Proposal command IDが一致しません。")
        requireText(envelope.clientDeviceId, 200, "Proposal device ID")
        requireTimestamp(envelope.issuedAt, "Proposal issuedAt")
        requireText(envelope.proposalId, 200, "Proposal ID")
        requireText(envelope.taskId, 200, "Proposal task ID")
        requireProposal(envelope.expectedProposalVersion >= 0, "Proposal versionが不正です。")
        requireProposal(envelope.expectedTaskVersion >= 0, "Proposal task versionが不正です。")
        requireProposal(envelope.decision in setOf("accept", "reject"), "Proposal判断が不正です。")
    }

    private fun validateDecisionResponse(response: MobileTaskWorkProposalDecisionResponseDto) {
        requireProposal(response.ok, "Proposal判断は成功応答である必要があります。")
        requireProposal(
            response.meta.apiVersion == TASKEN_MOBILE_API_VERSION &&
                response.meta.schemaVersion == TASKEN_MOBILE_SCHEMA_VERSION,
            "未対応のProposal判断contractです。",
        )
        requireTimestamp(response.meta.generatedAt, "Proposal decision generatedAt")
        requireText(response.data.commandId, 200, "Proposal command ID")
        requireProposal(response.data.commandStatus in setOf("applied", "no_change"), "Proposal command statusが不正です。")
        requireText(response.data.proposalId, 200, "Proposal ID")
        requireProposal(response.data.proposalStatus in setOf("accepted", "rejected"), "Proposal statusが不正です。")
        requireProposal(response.data.decision in setOf("accept", "reject"), "Proposal判断が不正です。")
        requireProposal(
            (response.data.decision == "accept") == (response.data.proposalStatus == "accepted"),
            "Proposal判断とstatusが一致しません。",
        )
        requireText(response.data.taskId, 200, "Proposal task ID")
        requireProposal(response.data.taskVersion >= 0, "Proposal task versionが不正です。")
    }

    private fun validateExternalReference(reference: MobileWorkReceiptExternalReferenceDto) {
        requireProposal(
            reference.kind in setOf("issue", "pull_request", "merge_request", "commit", "branch", "file", "pipeline", "other"),
            "Proposal external reference kindが不正です。",
        )
        reference.provider?.let { requireProposal(it.length <= 120, "Proposal providerが長すぎます。") }
        requireText(reference.displayLabel, 200, "Proposal external reference label")
        requireProposal(reference.externalId == null || reference.externalId.length <= 200, "Proposal external IDが長すぎます。")
        val uri = runCatching { URI(reference.url) }.getOrNull()
        requireProposal(
            uri?.scheme == "https" && uri.host?.isNotBlank() == true && uri.userInfo == null &&
                uri.query == null && uri.fragment == null && reference.url.length <= 2_000,
            "Proposal external reference URLが不正です。",
        )
    }

    private fun requireTimestamp(value: String, label: String) {
        requireProposal(runCatching { OffsetDateTime.parse(value) }.isSuccess, "$label が不正です。")
    }

    private fun requireText(value: String, max: Int, label: String) {
        requireProposal(value.isNotBlank() && value.length <= max, "$label が不正です。")
    }

    private fun requireProposal(condition: Boolean, message: String) {
        if (!condition) throw MobileProposalContractException(message)
    }
}

internal fun MobileTaskWorkProposalDto.toProposal(truncated: Boolean): MobileTaskWorkProposal =
    MobileTaskWorkProposal(
        id = id,
        version = version,
        taskId = task.id,
        taskVersion = task.version,
        taskTitle = task.title,
        themeId = task.themeId,
        workState = task.workState,
        action = action,
        caller = caller,
        sourceApp = sourceApp,
        receivedAt = receivedAt,
        expectedTaskVersion = expectedTaskVersion,
        stale = stale,
        executorLabel = executorLabel,
        startedAt = startedAt,
        reportedAt = reportedAt,
        summary = summary,
        completedItems = completedItems,
        changedOrCreatedItems = changedOrCreatedItems,
        verification = verification,
        remainingWork = remainingWork,
        externalReferences = externalReferences.map {
            MobileWorkReceiptExternalReference(it.kind, it.provider, it.displayLabel, it.url, it.externalId)
        },
        truncated = truncated,
    )

internal fun MobileTaskWorkProposalDto.toCache(
    meta: MobileResponseMetaDto,
): TaskWorkProposalCacheEntity = TaskWorkProposalCacheEntity(
    id = id,
    taskId = task.id,
    receivedAt = receivedAt,
    payloadJson = MobileProposalContract.encodeCachedProposal(this),
    truncated = meta.truncated,
    serverId = meta.serverId,
    serverRevision = meta.serverRevision,
    fetchedAt = meta.generatedAt,
)

internal fun TaskWorkProposalCacheEntity.toProposal(): MobileTaskWorkProposal =
    MobileProposalContract.decodeCachedProposal(payloadJson).toProposal(truncated)
