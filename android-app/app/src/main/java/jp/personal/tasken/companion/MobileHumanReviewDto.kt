package jp.personal.tasken.companion

import java.time.OffsetDateTime
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.Json

@Serializable
data class MobileTaskWorkReviewEnvelopeDto(
    val apiVersion: Int,
    val schemaVersion: Int,
    val requestId: String,
    val commandId: String,
    val idempotencyKey: String,
    val clientDeviceId: String,
    val issuedAt: String,
    val taskId: String,
    val expectedTaskVersion: Int,
    val receiptId: String,
    val action: String,
    val reviewNote: String?,
)

@Serializable
data class MobileTaskWorkReviewResponseDto(
    val ok: Boolean,
    val meta: MobileResponseMetaDto,
    val data: MobileTaskWorkReviewDataDto,
)

@Serializable
data class MobileTaskWorkReviewDataDto(
    val commandId: String,
    val commandStatus: String,
    val action: String,
    val receiptId: String,
    val task: MobileTaskSummaryDto,
)

class MobileHumanReviewContractException(message: String, cause: Throwable? = null) :
    IllegalArgumentException(message, cause)

object MobileHumanReviewContract {
    private val json = Json {
        ignoreUnknownKeys = false
        isLenient = false
        coerceInputValues = false
        encodeDefaults = true
        explicitNulls = true
    }

    fun encode(envelope: MobileTaskWorkReviewEnvelopeDto): String {
        validateEnvelope(envelope)
        return json.encodeToString(envelope)
    }

    fun decode(payload: String): MobileTaskWorkReviewResponseDto = try {
        json.decodeFromString<MobileTaskWorkReviewResponseDto>(payload).also(::validateResponse)
    } catch (error: MobileHumanReviewContractException) {
        throw error
    } catch (error: Exception) {
        throw MobileHumanReviewContractException("Work Receipt判断の応答が不正です。", error)
    }

    private fun validateEnvelope(envelope: MobileTaskWorkReviewEnvelopeDto) {
        requireReview(
            envelope.apiVersion == TASKEN_MOBILE_API_VERSION &&
                envelope.schemaVersion == TASKEN_MOBILE_SCHEMA_VERSION,
            "未対応のWork Receipt判断contractです。",
        )
        requireText(envelope.requestId, "request ID")
        requireText(envelope.commandId, "command ID")
        requireReview(envelope.commandId == envelope.idempotencyKey, "command IDが一致しません。")
        requireText(envelope.clientDeviceId, "device ID")
        requireReview(runCatching { OffsetDateTime.parse(envelope.issuedAt) }.isSuccess, "issuedAtが不正です。")
        requireText(envelope.taskId, "Task ID")
        requireReview(envelope.expectedTaskVersion >= 0, "Task versionが不正です。")
        requireText(envelope.receiptId, "Work Receipt ID")
        requireReview(envelope.action in setOf("accept", "return"), "判断が不正です。")
        if (envelope.action == "return") {
            requireReview(!envelope.reviewNote.isNullOrBlank() && envelope.reviewNote.length <= 2_000, "返信を1〜2000文字で入力してください。")
        } else {
            requireReview(envelope.reviewNote == null, "承認時に返信を送信できません。")
        }
    }

    private fun validateResponse(response: MobileTaskWorkReviewResponseDto) {
        requireReview(response.ok, "Work Receipt判断は成功応答である必要があります。")
        requireReview(
            response.meta.apiVersion == TASKEN_MOBILE_API_VERSION &&
                response.meta.schemaVersion == TASKEN_MOBILE_SCHEMA_VERSION,
            "未対応のWork Receipt判断contractです。",
        )
        requireReview(runCatching { OffsetDateTime.parse(response.meta.generatedAt) }.isSuccess, "generatedAtが不正です。")
        requireText(response.meta.serverId, "server ID")
        requireText(response.data.commandId, "command ID")
        requireReview(response.data.commandStatus in setOf("applied", "no_change"), "command statusが不正です。")
        requireReview(response.data.action in setOf("accept", "return"), "判断が不正です。")
        requireText(response.data.receiptId, "Work Receipt ID")
        requireText(response.data.task.id, "Task ID")
        requireReview(response.data.task.version >= 0, "Task versionが不正です。")
    }

    private fun requireText(value: String, label: String) {
        requireReview(value.isNotBlank() && value.length <= 200, "$label が不正です。")
    }

    private fun requireReview(condition: Boolean, message: String) {
        if (!condition) throw MobileHumanReviewContractException(message)
    }
}
