package jp.personal.tasken.companion

import java.time.OffsetDateTime
import java.util.UUID
import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.Json

/**
 * Agent Deskの要対応read model（#601）。
 *
 * Androidは状態を導出しない。Desktopの `buildAttentionQueue` が返した結果を
 * このDTOで受け取り、表示と短い返答だけを行う。
 * 未知fieldを黙って捨てない（契約が変わったら気づけるようにする）。
 */
@Serializable
data class MobileAttentionMetaDto(
    val apiVersion: Int,
    val schemaVersion: Int,
    val serverId: String,
    val serverRevision: Long,
    val generatedAt: String,
    val truncated: Boolean,
)

@Serializable
data class MobileAttentionCountsDto(
    /** 未処理のhuman attentionの数。Desktopのbadgeと同じ意味。 */
    val needsYou: Int,
    val working: Int,
    val queued: Int,
)

@Serializable
data class MobileAttentionItemDto(
    val attentionId: String,
    val kind: String,
    val taskId: String? = null,
    val taskTitle: String? = null,
    /** 回答や採用の競合検出に使う。TaskなしのProposalでは null。 */
    val taskVersion: Long? = null,
    val themeId: String? = null,
    val themeName: String? = null,
    val agentLabel: String? = null,
    val headline: String,
    val summary: String,
    val questionOrAction: String,
    val createdAt: String? = null,
    val updatedAt: String? = null,
    val sourceType: String,
    val sourceId: String,
    val sourceVersion: Long? = null,
    val workAttemptId: String? = null,
    /** 回答対象の質問ID。 */
    val requestId: String? = null,
    val availableActions: List<String> = emptyList(),
)

@Serializable
data class MobileAttentionDataDto(
    val attention: List<MobileAttentionItemDto> = emptyList(),
    val counts: MobileAttentionCountsDto,
    val truncated: Boolean,
)

@Serializable
data class MobileAttentionResponseDto(
    val ok: Boolean,
    val meta: MobileAttentionMetaDto,
    val data: MobileAttentionDataDto,
)

/** 一覧の1行。表示に必要な意味だけを持つ。 */
data class AttentionRow(
    val attentionId: String,
    val kind: AttentionKind,
    val taskId: String?,
    val taskTitle: String?,
    val taskVersion: Long?,
    val headline: String,
    val summary: String,
    val questionOrAction: String,
    val agentLabel: String?,
    val requestId: String?,
    /** この端末から短い返答を送れるか。 */
    val canReply: Boolean,
)

/**
 * 表示上の種類。Desktopの `kind` と同じ意味で、Android独自の状態は増やさない。
 * `WORKING` / `QUEUED` は要対応ではなく、件数だけを別枠で持つ。
 */
enum class AttentionKind {
    AnswerRequest,
    DecisionRequest,
    ReviewReport,
    ProposalPending,
    Unknown,
    ;

    companion object {
        fun from(raw: String): AttentionKind =
            when (raw) {
                "answer_request" -> AnswerRequest
                "decision_request" -> DecisionRequest
                "review_report" -> ReviewReport
                "proposal_pending" -> ProposalPending
                // 未知の種類は落とさず保持する。黙って要対応から消さない。
                else -> Unknown
            }
    }
}

object MobileAttentionContract {
    private val json = Json {
        ignoreUnknownKeys = false
        isLenient = false
        coerceInputValues = false
        encodeDefaults = true
        explicitNulls = false
    }

    fun decode(body: String): MobileAttentionResponseDto = json.decodeFromString(body)

    fun encode(response: MobileAttentionResponseDto): String = json.encodeToString(response)

    /** 保存済みの1件を復号する。未知fieldは契約違反として拒否する。 */
    fun decodeItem(payload: String): MobileAttentionItemDto = json.decodeFromString(payload)

    internal fun encodeItem(item: MobileAttentionItemDto): String = json.encodeToString(item)

    fun toRows(response: MobileAttentionResponseDto): List<AttentionRow> =
        response.data.attention.map { item -> item.toRow() }

    /** 1件の射影。一覧と同じ意味を1行にも使う。 */
    fun toRow(item: MobileAttentionItemDto): AttentionRow {
        val kind = AttentionKind.from(item.kind)
        return AttentionRow(
            attentionId = item.attentionId,
            kind = kind,
            taskId = item.taskId,
            taskTitle = item.taskTitle,
            taskVersion = item.taskVersion,
            headline = item.headline,
            summary = item.summary,
            questionOrAction = item.questionOrAction,
            agentLabel = item.agentLabel,
            requestId = item.requestId,
            canReply =
                (kind == AttentionKind.AnswerRequest || kind == AttentionKind.DecisionRequest) &&
                    item.requestId != null &&
                    item.taskId != null &&
                    item.taskVersion != null &&
                    item.availableActions.contains("answer_request"),
        )
    }
}

private fun MobileAttentionItemDto.toRow(): AttentionRow = MobileAttentionContract.toRow(this)

/**
 * 一覧の1件を保存する。表示に使う列だけを写し、元のitemは `payloadJson` に残す。
 * 列を増やしても、保存済みの一覧を取り直さずに表示できる。
 */
internal fun MobileAttentionItemDto.toCacheEntity(
    serverId: String,
    position: Int,
    fetchedAt: String,
): AttentionCacheEntity {
    val row = MobileAttentionContract.toRow(this)
    return AttentionCacheEntity(
        attentionId = row.attentionId,
        serverId = serverId,
        position = position,
        // 未知の種類も落とさず保存する。
        kind = kind,
        taskId = row.taskId,
        taskTitle = row.taskTitle,
        taskVersion = row.taskVersion,
        headline = row.headline,
        summary = row.summary,
        questionOrAction = row.questionOrAction,
        agentLabel = row.agentLabel,
        requestId = row.requestId,
        canReply = row.canReply,
        payloadJson = MobileAttentionContract.encodeItem(this),
        fetchedAt = fetchedAt,
    )
}

internal fun AttentionCacheEntity.toRow(): AttentionRow =
    MobileAttentionContract.toRow(MobileAttentionContract.decodeItem(payloadJson))

/**
 * agentの質問への短い返答（#601）。
 *
 * Taskは変えない。回答は質問IDへ紐づくWork ReceiptとしてDesktopへ保存される。
 * 同じ質問への二度目の回答はDesktopが競合として拒否する。
 */
@Serializable
data class MobileAgentReplyEnvelopeDto(
    val apiVersion: Int,
    val schemaVersion: Int,
    val requestId: String,
    val commandId: String,
    val idempotencyKey: String,
    val clientDeviceId: String,
    val issuedAt: String,
    val taskId: String,
    /** 回答対象の質問ID。要対応itemの `requestId` をそのまま渡す。 */
    val questionId: String,
    val body: String,
    val choiceId: String? = null,
    val expectedTaskVersion: Long,
)

@Serializable
data class MobileAgentReplyDataDto(
    val commandId: String,
    val commandStatus: String,
    val taskId: String,
    val taskVersion: Long,
    val questionId: String,
    /** 返答直後の表示状態。Desktopと同じ導出結果をそのまま受け取る。 */
    val displayState: String,
)

@Serializable
data class MobileAgentReplyResponseDto(
    val ok: Boolean,
    val meta: MobileResponseMetaDto,
    val data: MobileAgentReplyDataDto,
)

/**
 * 同じ質問・同じ内容の返答は同じcommandIdになる。
 * 応答を失った再送で回答を二重に増やさない。
 */
internal fun agentReplyCommandId(
    clientDeviceId: String,
    serverId: String,
    taskId: String,
    questionId: String,
    expectedTaskVersion: Long,
    normalizedBody: String,
    choiceId: String?,
): String = UUID.nameUUIDFromBytes(
    listOf(
        "tasken-mobile-agent-reply-v1",
        clientDeviceId,
        serverId,
        taskId,
        questionId,
        expectedTaskVersion.toString(),
        normalizedBody,
        choiceId.orEmpty(),
    )
        .joinToString(separator = "") { value ->
            "${value.toByteArray(Charsets.UTF_8).size}:$value"
        }
        .toByteArray(Charsets.UTF_8),
).toString()

class MobileAgentReplyContractException(message: String, cause: Throwable? = null) :
    IllegalArgumentException(message, cause)

object MobileAgentReplyContract {
    private val json = Json {
        ignoreUnknownKeys = false
        isLenient = false
        coerceInputValues = false
        encodeDefaults = true
        explicitNulls = false
    }

    fun encode(envelope: MobileAgentReplyEnvelopeDto): String {
        validateEnvelope(envelope)
        return json.encodeToString(envelope)
    }

    fun decodeEnvelope(payload: String): MobileAgentReplyEnvelopeDto = try {
        json.decodeFromString<MobileAgentReplyEnvelopeDto>(payload).also(::validateEnvelope)
    } catch (error: MobileAgentReplyContractException) {
        throw error
    } catch (error: Exception) {
        throw MobileAgentReplyContractException("回答の送信内容が不正です。", error)
    }

    fun decode(payload: String): MobileAgentReplyResponseDto = try {
        json.decodeFromString<MobileAgentReplyResponseDto>(payload).also(::validateResponse)
    } catch (error: MobileAgentReplyContractException) {
        throw error
    } catch (error: Exception) {
        throw MobileAgentReplyContractException("回答の応答が不正です。", error)
    }

    private fun validateEnvelope(envelope: MobileAgentReplyEnvelopeDto) {
        requireReply(
            envelope.apiVersion == TASKEN_MOBILE_API_VERSION &&
                envelope.schemaVersion == TASKEN_MOBILE_SCHEMA_VERSION,
            "未対応の回答contractです。",
        )
        requireText(envelope.requestId, "request ID")
        requireText(envelope.commandId, "command ID")
        requireReply(envelope.commandId == envelope.idempotencyKey, "command IDが一致しません。")
        requireText(envelope.clientDeviceId, "device ID")
        requireReply(
            runCatching { OffsetDateTime.parse(envelope.issuedAt) }.isSuccess,
            "issuedAtが不正です。",
        )
        requireText(envelope.taskId, "Task ID")
        requireText(envelope.questionId, "質問ID")
        requireReply(envelope.body.isNotBlank() && envelope.body.length <= 10_000, "回答を1〜10000文字で入力してください。")
        requireReply(envelope.choiceId == null || envelope.choiceId.length <= 200, "選択肢が不正です。")
        requireReply(envelope.expectedTaskVersion >= 0, "Task versionが不正です。")
    }

    private fun validateResponse(response: MobileAgentReplyResponseDto) {
        requireReply(response.ok, "回答は成功応答である必要があります。")
        requireReply(
            response.meta.apiVersion == TASKEN_MOBILE_API_VERSION &&
                response.meta.schemaVersion == TASKEN_MOBILE_SCHEMA_VERSION,
            "未対応の回答contractです。",
        )
        requireText(response.meta.serverId, "server ID")
        requireText(response.data.commandId, "command ID")
        requireReply(response.data.commandStatus in setOf("applied", "no_change"), "command statusが不正です。")
        requireText(response.data.taskId, "Task ID")
        requireText(response.data.questionId, "質問ID")
        requireReply(response.data.taskVersion >= 0, "Task versionが不正です。")
        // 表示状態はDesktopの導出結果。未知の値も落とさず保持する（表示側で判断する）。
        requireText(response.data.displayState, "表示状態")
    }

    private fun requireText(value: String, label: String) {
        requireReply(value.isNotBlank() && value.length <= 200, "$label が不正です。")
    }

    private fun requireReply(condition: Boolean, message: String) {
        if (!condition) throw MobileAgentReplyContractException(message)
    }
}
