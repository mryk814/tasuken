package jp.personal.tasken.companion

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

    fun toRows(response: MobileAttentionResponseDto): List<AttentionRow> =
        response.data.attention.map { item ->
            val kind = AttentionKind.from(item.kind)
            AttentionRow(
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
                        item.availableActions.contains("answer_request"),
            )
        }
}
