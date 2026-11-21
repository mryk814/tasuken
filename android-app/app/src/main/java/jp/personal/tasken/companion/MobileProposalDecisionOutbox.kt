package jp.personal.tasken.companion

import java.time.Instant
import java.util.UUID
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock

/**
 * 送信の列に積む、AI の提案への答え（採る・見送る）の命令名。Desktop の受け口（/v1/proposal-decisions）が
 * Core に渡す命令と同じ名前。MobileLocalDao の問い合わせは、この名前を文字のまま持つ。
 */
internal const val PROPOSAL_DECISION_COMMAND = "ApplyTaskWorkProposal"

/** 先に決まっていた・変わっていた提案への答えに添える文（Desktop が proposal_conflict を返した時）。 */
internal const val PROPOSAL_DECISION_CONFLICT = "PC で先に決まったか、提案か Task が変わっていました。"

/**
 * PC で提案か Task が無くなっていた時（not_found）に添える文。PC が答えを使った後に応答だけ失い、その後で Task が
 * 消された時も同じ答えが返るので、届かなかったとは言わない。
 */
internal const val PROPOSAL_DECISION_GONE = "PC で提案か Task が無くなっていました。"

/** 列にある（まだ届いていないか、受け取られなかった）提案への答え。送信の列の 1 行から読む。 */
data class MobileProposalDecision(
    val commandId: String,
    val proposalId: String,
    val taskId: String,
    /** accept か reject。 */
    val decision: String,
    val state: String,
    /** 受け取られなかった理由（画面に出す文）。 */
    val reason: String?,
    /** 受け取られなかった時の Desktop の答えの種類（proposal_conflict・not_found など）。 */
    val code: String? = null,
) {
    val returned: Boolean get() = state == OutboxState.Rejected

    /** 受け取られなかった答えの見出し。無くなっていた時は、届いたかが分からないので「確かめられませんでした」。 */
    fun returnedTitle(): String {
        val label = if (decision == "accept") "採る" else "見送る"
        return if (code == "not_found") "「$label」を確かめられませんでした" else "「$label」は届きませんでした"
    }
}

internal fun OutboxCommandEntity.toProposalDecision(): MobileProposalDecision? {
    if (commandName != PROPOSAL_DECISION_COMMAND) return null
    val envelope = runCatching { MobileProposalContract.decodeDecisionEnvelope(envelopeJson) }.getOrNull() ?: return null
    return MobileProposalDecision(
        commandId = commandId,
        proposalId = envelope.proposalId,
        taskId = envelope.taskId,
        decision = envelope.decision,
        state = state,
        reason = outboxReasonText(lastError),
        code = outboxReasonCode(lastError),
    )
}

/**
 * 提案への答えを、Task・Capture・続けることと同じ送信の列（outbox_command）に先に書く。圏外でも押せて、
 * 送るのは列の送り手（MobileOutbox.send）。つながらない間は残り、つながったら同じ commandId のまま送り直す。
 * Desktop は commandId で送り直しを見分ける（同じ命令には前の受領を返す）ので、応答を失った再送でも二度は決まらない。
 *
 * 答えは押した時の提案と Task の版を持って送り、Desktop が突き合わせる。その間に PC で先に決まった・提案か Task が
 * 変わった時は proposal_conflict が返り、答えは「受け取られなかった」として列に残す（黙って消さない）。版が古いので
 * 自動では送り直さない。提案がまだ答えを待っていれば、読み直した提案にもう一度答えられ、その時に前の答えを置き換える。
 * 提案がもう無ければ、Task の詳細に残り、本人が閉じるまで見える。
 */
internal class MobileProposalDecisionOutbox(
    private val dao: MobileLocalDao,
    private val deviceId: () -> String,
    private val schedule: () -> Unit,
    private val now: () -> Instant = Instant::now,
) {
    private val mutex = Mutex()

    suspend fun decide(proposal: MobileTaskWorkProposal, decision: String): MobileProposalReviewResult = mutex.withLock {
        require(decision in setOf("accept", "reject"))
        val serverId = dao.syncState()?.serverId
            ?: return MobileProposalReviewResult.Unavailable(proposal.id, "Taskを同期してから提案に答えられます。")
        val cached = dao.taskWorkProposal(proposal.id, serverId)?.toProposal()
            ?: return MobileProposalReviewResult.Conflict(proposal.id, "提案が更新されています。読み直してください。")
        if (cached.taskId != proposal.taskId || cached.version != proposal.version || cached.taskVersion != proposal.taskVersion) {
            return MobileProposalReviewResult.Conflict(proposal.id, "提案が更新されています。読み直してください。")
        }
        if (decision == "accept" && cached.stale) {
            return MobileProposalReviewResult.Conflict(proposal.id, "Taskが更新されています。AIへ再報告を依頼してください。")
        }
        val earlier = dao.proposalDecisions().mapNotNull { row -> row.toProposalDecision()?.takeIf { it.proposalId == cached.id } }
        // 送る途中の答えがあれば、もう一つは積まない（画面は送る途中の間は答えのボタンを出さない）。
        earlier.firstOrNull { !it.returned }?.let { pending ->
            return if (pending.decision == decision) {
                MobileProposalReviewResult.Queued(cached.id, decision)
            } else {
                MobileProposalReviewResult.Conflict(cached.id, "この提案への答えを送る途中です。")
            }
        }
        val commandId = UUID.randomUUID().toString()
        val issuedAt = now().toString()
        val envelope = MobileTaskWorkProposalDecisionEnvelopeDto(
            apiVersion = TASKEN_MOBILE_API_VERSION,
            schemaVersion = TASKEN_MOBILE_SCHEMA_VERSION,
            requestId = UUID.randomUUID().toString(),
            commandId = commandId,
            idempotencyKey = commandId,
            clientDeviceId = deviceId(),
            issuedAt = issuedAt,
            proposalId = cached.id,
            taskId = cached.taskId,
            expectedProposalVersion = cached.version,
            expectedTaskVersion = cached.taskVersion,
            decision = decision,
        )
        dao.enqueueProposalDecision(
            OutboxCommandEntity(
                commandId = commandId,
                idempotencyKey = commandId,
                requestId = envelope.requestId,
                clientDeviceId = envelope.clientDeviceId,
                issuedAt = issuedAt,
                commandName = PROPOSAL_DECISION_COMMAND,
                envelopeJson = MobileProposalContract.encodeDecision(envelope),
                serverId = serverId,
                state = OutboxState.Pending,
                attemptCount = 0,
                createdAt = issuedAt,
                lastAttemptAt = null,
                lastError = null,
            ),
            replacing = earlier.map { it.commandId },
        )
        schedule()
        MobileProposalReviewResult.Queued(cached.id, decision)
    }

    /** 受け取られなかった答えを、本人が閉じる。送る途中・送る前の答えは消さない。 */
    suspend fun discard(commandId: String): Boolean = dao.discardReturnedProposalDecision(commandId) == 1
}
