package jp.personal.tasken.companion

import java.time.Instant
import java.util.UUID
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock

/** 送信の列に積む、続けることの1回記録の命令名。Gatewayの受け口（/v1/routine-actions）の action.name と同じ。 */
internal const val ROUTINE_RECORD_COMMAND = "RecordHabitEntry"

/** Desktopの1日の上限（habitEntryId の sequence 1〜50）。 */
private const val ROUTINE_MAX_SEQUENCE = 50

/** まだDesktopに届いていない（か、断られた）続けることの1回記録。送信の列の1行から読む。 */
data class MobilePendingRoutineRecord(
    val commandId: String,
    val habitId: String,
    val performedOn: String,
    val sequence: Int,
    val state: String,
    /** 最後に送れなかった・断られた理由（画面に出す文）。 */
    val reason: String?,
) {
    val rejected: Boolean get() = state == OutboxState.Rejected
}

internal fun OutboxCommandEntity.toPendingRoutineRecord(): MobilePendingRoutineRecord? {
    if (commandName != ROUTINE_RECORD_COMMAND) return null
    val envelope = runCatching { MobileRoutineContract.decodeEnvelope(envelopeJson) }.getOrNull() ?: return null
    val action = envelope.action
    return MobilePendingRoutineRecord(
        commandId = commandId,
        habitId = action.habitId ?: return null,
        performedOn = action.performedOn,
        sequence = action.sequence ?: return null,
        state = state,
        reason = outboxReasonText(lastError),
    )
}

/** Todayに出す1件。[unsent] はまだ届いていない記録の数（数は既に足してある）、[returned] は断られた記録の数。 */
internal data class TodayRoutineHabit(
    val habit: MobileRoutineHabitDto,
    val unsent: Int = 0,
    val returned: Int = 0,
)

internal data class TodayRoutines(val date: String, val habits: List<TodayRoutineHabit>) {
    val isEmpty: Boolean get() = habits.isEmpty()
}

/**
 * Desktopが返した続けることに、端末にだけある記録を重ねる。押した時点で記録済みに見せ、届くまでは割印で分ける。
 *
 * 数え方: その日の記録で、Desktopの次の番号（nextSequence）以上の物だけ足す。番号がそれより小さい記録は、
 * Desktopが既に数えている（応答を失って列に残った再送など）ので、二重に足さない。
 * 次の番号は、列にある同じ日の記録（断られた物も）より後にする。断られた物を送り直した時に番号がぶつかると、
 * Desktopは同じ回として no_change を返し、1回分が消えるため。
 * 字の形（今日N回・今週n/m回）はDesktopの導出（habit/progress.ts）と同じ。足す物が無い時はDesktopの字をそのまま使う。
 */
internal fun overlayPendingRoutines(
    server: MobileRoutinesDataDto,
    pending: List<MobilePendingRoutineRecord>,
): TodayRoutines = TodayRoutines(
    date = server.date,
    habits = server.habits.map { habit ->
        val mine = pending.filter { it.habitId == habit.habitId }
        val sameDay = mine.filter { it.performedOn == server.date }
        val serverNext = habit.nextSequence ?: (ROUTINE_MAX_SEQUENCE + 1)
        val added = sameDay.count { !it.rejected && it.sequence >= serverNext }
        val next = maxOf(serverNext, (sameDay.maxOfOrNull { it.sequence } ?: 0) + 1)
        val shown = if (added == 0) {
            habit.copy(nextSequence = next.takeIf { it <= ROUTINE_MAX_SEQUENCE })
        } else {
            val today = habit.todayCount + added
            val week = habit.weekCount + added
            habit.copy(
                todayCount = today,
                weekCount = week,
                todayLabel = "今日${today}回",
                weekLabel = "今週$week/${habit.weekTarget}回",
                met = week >= habit.weekTarget,
                nextSequence = next.takeIf { it <= ROUTINE_MAX_SEQUENCE },
            )
        }
        TodayRoutineHabit(shown, unsent = added, returned = mine.count { it.rejected })
    },
)

/**
 * 続けることの記録を、Task・Capture・作業記録と同じ送信の列（outbox_command）に先に書く。
 * 送るのは列の送り手（MobileOutbox.send）で、つながらない間は残り、つながったら同じ commandId のまま送り直す。
 * Desktopは同じ日・同じ回を同じIDで保存するので、応答を失った再送でも記録は増えない。
 */
internal class MobileRoutineOutbox(
    private val dao: MobileLocalDao,
    private val deviceId: () -> String,
    private val schedule: () -> Unit,
    private val now: () -> Instant = Instant::now,
) {
    private val mutex = Mutex()

    /**
     * この端末が積んだ一番大きい番号（Habitと日ごと）。届いて列から消えた記録の番号を、
     * Desktopから読み直すまでの間に使い回さないための下限。プロセスが終われば読み直すので、覚えるのはこの間だけ。
     */
    private val queuedFloor = mutableMapOf<String, Int>()

    /** 記録を列に積み、積んだ commandId を返す。番号は [action] の番号と、列にある同じ日の記録より後にする。 */
    suspend fun record(action: MobileRoutineActionDto): String = mutex.withLock {
        require(action.name == ROUTINE_RECORD_COMMAND)
        val habitId = requireNotNull(action.habitId)
        val serverId = requireNotNull(dao.syncState()?.serverId) { "Taskを同期してから記録できます。" }
        val key = "$habitId|${action.performedOn}"
        val queued = dao.routineRecords().mapNotNull { it.toPendingRoutineRecord() }
            .filter { it.habitId == habitId && it.performedOn == action.performedOn }
            .maxOfOrNull { it.sequence } ?: 0
        val sequence = maxOf(requireNotNull(action.sequence), queued + 1, (queuedFloor[key] ?: 0) + 1)
        require(sequence <= ROUTINE_MAX_SEQUENCE) { "今日はこれ以上記録できません。" }
        val commandId = UUID.randomUUID().toString()
        val issuedAt = now().toString()
        val envelope = MobileRoutineActionEnvelopeDto(
            apiVersion = TASKEN_MOBILE_API_VERSION,
            schemaVersion = TASKEN_MOBILE_SCHEMA_VERSION,
            requestId = UUID.randomUUID().toString(),
            commandId = commandId,
            idempotencyKey = commandId,
            clientDeviceId = deviceId(),
            issuedAt = issuedAt,
            action = action.copy(sequence = sequence),
        )
        dao.insertOutbox(
            OutboxCommandEntity(
                commandId = commandId,
                idempotencyKey = commandId,
                requestId = envelope.requestId,
                clientDeviceId = envelope.clientDeviceId,
                issuedAt = issuedAt,
                commandName = ROUTINE_RECORD_COMMAND,
                envelopeJson = MobileRoutineContract.encode(envelope),
                serverId = serverId,
                state = OutboxState.Pending,
                attemptCount = 0,
                createdAt = issuedAt,
                lastAttemptAt = null,
                lastError = null,
            ),
        )
        queuedFloor[key] = sequence
        schedule()
        commandId
    }

    /** 断られた記録を、同じ commandId・同じ番号のまま列へ戻す。 */
    suspend fun retry(commandId: String) {
        check(dao.retryRejectedRoutineRecord(commandId) == 1) { "送り直せる記録が見つかりませんでした。" }
        schedule()
    }

    /** 断られた記録を、本人が選んで消す。送っている途中・送る前の物は消さない。 */
    suspend fun discard(commandId: String) {
        check(dao.discardRejectedRoutineRecord(commandId) == 1) { "消せる記録が見つかりませんでした。" }
    }
}
