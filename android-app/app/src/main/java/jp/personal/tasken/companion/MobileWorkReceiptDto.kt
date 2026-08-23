package jp.personal.tasken.companion

import java.net.URI
import java.time.OffsetDateTime
import kotlinx.serialization.Serializable
import kotlinx.serialization.decodeFromString
import kotlinx.serialization.encodeToString
import kotlinx.serialization.json.Json

@Serializable
data class MobileWorkReceiptResponseDto(
    val ok: Boolean,
    val meta: MobileResponseMetaDto,
    val data: MobileWorkReceiptDataDto,
)

@Serializable
data class MobileWorkReceiptDataDto(
    val receipt: MobileWorkReceiptDetailDto,
)

@Serializable
data class MobileWorkReceiptDetailDto(
    val id: String,
    val taskId: String,
    val executorKind: String,
    val executorLabel: String,
    val startedAt: String?,
    val reportedAt: String,
    val reportKind: String,
    val summary: String,
    val completedItems: List<String>,
    val changedOrCreatedItems: List<String>,
    val verification: List<String>,
    val remainingWork: List<String>,
    val externalReferences: List<MobileWorkReceiptExternalReferenceDto>,
)

@Serializable
data class MobileWorkReceiptExternalReferenceDto(
    val kind: String,
    val provider: String?,
    val displayLabel: String,
    val url: String,
    val externalId: String?,
)

class MobileWorkReceiptContractException(message: String, cause: Throwable? = null) :
    IllegalArgumentException(message, cause)

object MobileWorkReceiptContract {
    private const val MaxListItems = 20
    private const val MaxItemLength = 400
    private const val MaxExternalReferences = 10
    private const val MaxExternalUrlLength = 2000
    private val executorKinds = setOf("self", "human", "ai_agent", "external", "unknown")
    private val reportKinds = setOf("report", "blocked")
    private val externalKinds = setOf(
        "issue",
        "pull_request",
        "merge_request",
        "commit",
        "branch",
        "file",
        "pipeline",
        "other",
    )
    private val json = Json {
        ignoreUnknownKeys = false
        isLenient = false
        coerceInputValues = false
    }

    fun decodeSuccess(payload: String): MobileWorkReceiptResponseDto {
        val response = try {
            json.decodeFromString<MobileWorkReceiptResponseDto>(payload)
        } catch (error: Exception) {
            throw MobileWorkReceiptContractException(
                "Work Receipt response does not match the strict JSON shape.",
                error,
            )
        }
        validate(response)
        return response.normalized()
    }

    private fun validate(response: MobileWorkReceiptResponseDto) {
        requireContract(response.ok, "Work Receipt success response requires ok=true.")
        requireContract(
            response.meta.apiVersion == 1 && response.meta.schemaVersion == 4,
            "Unsupported mobile Work Receipt version.",
        )
        requireContract(isEntityId(response.meta.serverId), "Invalid serverId.")
        requireContract(response.meta.serverRevision >= 0, "serverRevision must be non-negative.")
        requireContract(isTimestamp(response.meta.generatedAt), "Invalid generatedAt timestamp.")
        val receipt = response.data.receipt
        requireContract(isEntityId(receipt.id), "Invalid Work Receipt ID.")
        requireContract(isEntityId(receipt.taskId), "Invalid Work Receipt Task ID.")
        requireContract(receipt.executorKind in executorKinds, "Invalid Work Receipt executorKind.")
        requireContract(
            receipt.executorLabel.trim().isNotEmpty() && receipt.executorLabel.length <= 200,
            "Invalid Work Receipt executorLabel.",
        )
        requireContract(receipt.startedAt == null || isTimestamp(receipt.startedAt), "Invalid startedAt.")
        requireContract(isTimestamp(receipt.reportedAt), "Invalid reportedAt.")
        requireContract(receipt.reportKind in reportKinds, "Invalid reportKind.")
        requireContract(
            receipt.summary.trim().isNotEmpty() && receipt.summary.length <= 10_000,
            "Invalid Work Receipt summary.",
        )
        validateItems(receipt.completedItems, "completedItems")
        validateItems(receipt.changedOrCreatedItems, "changedOrCreatedItems")
        validateItems(receipt.verification, "verification")
        validateItems(receipt.remainingWork, "remainingWork")
        requireContract(
            receipt.externalReferences.size <= MaxExternalReferences,
            "Work Receipt externalReferences exceeds the item limit.",
        )
        receipt.externalReferences.forEach(::validateExternalReference)
    }

    private fun validateItems(items: List<String>, field: String) {
        requireContract(items.size <= MaxListItems, "$field exceeds the item limit.")
        requireContract(
            items.all { it.trim().isNotEmpty() && it.length <= MaxItemLength },
            "$field contains an invalid item.",
        )
    }

    private fun validateExternalReference(reference: MobileWorkReceiptExternalReferenceDto) {
        requireContract(reference.kind in externalKinds, "Invalid external reference kind.")
        requireContract(reference.provider == null || reference.provider.length <= 120, "Invalid external provider.")
        requireContract(
            reference.displayLabel.trim().isNotEmpty() && reference.displayLabel.length <= 200,
            "Invalid external displayLabel.",
        )
        requireContract(reference.externalId == null || reference.externalId.length <= 200, "Invalid externalId.")
        requireContract(reference.url.length <= MaxExternalUrlLength, "External reference URL is too long.")
        val uri = runCatching { URI(reference.url) }.getOrNull()
        requireContract(
            uri?.scheme == "https" && uri.host != null && uri.userInfo == null,
            "External reference requires a credential-free HTTPS URL.",
        )
    }

    private fun isEntityId(value: String): Boolean = value.trim().isNotEmpty() && value.length <= 200

    private fun isTimestamp(value: String): Boolean = runCatching { OffsetDateTime.parse(value) }.isSuccess

    private fun requireContract(condition: Boolean, message: String) {
        if (!condition) throw MobileWorkReceiptContractException(message)
    }

    private fun MobileWorkReceiptResponseDto.normalized(): MobileWorkReceiptResponseDto = copy(
        meta = meta.copy(serverId = meta.serverId.trim()),
        data = data.copy(
            receipt = data.receipt.copy(
                id = data.receipt.id.trim(),
                taskId = data.receipt.taskId.trim(),
                executorLabel = data.receipt.executorLabel.trim(),
                summary = data.receipt.summary.trim(),
                completedItems = data.receipt.completedItems.map(String::trim),
                changedOrCreatedItems = data.receipt.changedOrCreatedItems.map(String::trim),
                verification = data.receipt.verification.map(String::trim),
                remainingWork = data.receipt.remainingWork.map(String::trim),
                externalReferences = data.receipt.externalReferences.map { reference ->
                    reference.copy(
                        provider = reference.provider?.trim(),
                        displayLabel = reference.displayLabel.trim(),
                        externalId = reference.externalId?.trim(),
                    )
                },
            ),
        ),
    )
}

fun MobileWorkReceiptResponseDto.toDetail(): MobileWorkReceiptDetail = data.receipt.let { receipt ->
    MobileWorkReceiptDetail(
        id = receipt.id,
        taskId = receipt.taskId,
        executorKind = receipt.executorKind,
        executorLabel = receipt.executorLabel,
        startedAt = receipt.startedAt,
        reportedAt = receipt.reportedAt,
        reportKind = receipt.reportKind,
        summary = receipt.summary,
        completedItems = receipt.completedItems,
        changedOrCreatedItems = receipt.changedOrCreatedItems,
        verification = receipt.verification,
        remainingWork = receipt.remainingWork,
        externalReferences = receipt.externalReferences.map { reference ->
            MobileWorkReceiptExternalReference(
                kind = reference.kind,
                provider = reference.provider,
                displayLabel = reference.displayLabel,
                url = reference.url,
                externalId = reference.externalId,
            )
        },
        truncated = meta.truncated,
    )
}

@Serializable
private data class MobileWorkReceiptCachePayload(
    val completedItems: List<String>,
    val changedOrCreatedItems: List<String>,
    val verification: List<String>,
    val remainingWork: List<String>,
    val externalReferences: List<MobileWorkReceiptExternalReferenceDto>,
)

private val mobileWorkReceiptCacheJson = Json {
    ignoreUnknownKeys = false
    isLenient = false
    coerceInputValues = false
}

fun MobileWorkReceiptDetail.toCache(
    serverId: String,
    serverRevision: Int,
    fetchedAt: String,
): WorkReceiptCacheEntity = WorkReceiptCacheEntity(
    id = id,
    taskId = taskId,
    executorKind = executorKind,
    executorLabel = executorLabel,
    startedAt = startedAt,
    reportedAt = reportedAt,
    reportKind = reportKind,
    summary = summary,
    payloadJson = mobileWorkReceiptCacheJson.encodeToString(
        MobileWorkReceiptCachePayload(
            completedItems = completedItems,
            changedOrCreatedItems = changedOrCreatedItems,
            verification = verification,
            remainingWork = remainingWork,
            externalReferences = externalReferences.map { reference ->
                MobileWorkReceiptExternalReferenceDto(
                    kind = reference.kind,
                    provider = reference.provider,
                    displayLabel = reference.displayLabel,
                    url = reference.url,
                    externalId = reference.externalId,
                )
            },
        ),
    ),
    truncated = truncated,
    serverId = serverId,
    serverRevision = serverRevision,
    fetchedAt = fetchedAt,
)

fun WorkReceiptCacheEntity.toDetail(): MobileWorkReceiptDetail {
    val payload = mobileWorkReceiptCacheJson.decodeFromString<MobileWorkReceiptCachePayload>(payloadJson)
    return MobileWorkReceiptDetail(
        id = id,
        taskId = taskId,
        executorKind = executorKind,
        executorLabel = executorLabel,
        startedAt = startedAt,
        reportedAt = reportedAt,
        reportKind = reportKind,
        summary = summary,
        completedItems = payload.completedItems,
        changedOrCreatedItems = payload.changedOrCreatedItems,
        verification = payload.verification,
        remainingWork = payload.remainingWork,
        externalReferences = payload.externalReferences.map { reference ->
            MobileWorkReceiptExternalReference(
                kind = reference.kind,
                provider = reference.provider,
                displayLabel = reference.displayLabel,
                url = reference.url,
                externalId = reference.externalId,
            )
        },
        truncated = truncated,
    )
}
