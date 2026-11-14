package jp.personal.tasken.companion

import java.time.Instant
import java.util.UUID
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put

/** Work logs use the same durable sender as Tasks, but never mutate a Task projection. */
internal class MobileWorkLogOutbox(
    private val dao: MobileLocalDao,
    private val deviceId: () -> String,
    private val schedule: () -> Unit,
    private val now: () -> Instant = Instant::now,
) {
    suspend fun record(draft: MobileWorkLogDraft): String {
        val serverId = requireNotNull(dao.syncState()?.serverId) { "最初にDesktopへ接続してください。入力は保持しています。" }
        val envelope = MobileWorkLogContract.record(draft, deviceId())
        dao.enqueueWorkLog(
            WorkLogCacheEntity(draft.id, serverId, null, draft.body, draft.performedDate, draft.enteredAt,
                draft.themeId, draft.taskId, false, false, draft.id, MobileWorkLogContract.json.encodeToString(envelope)),
            pending(envelope, serverId, draft.id, "RecordWorkLog"),
        )
        schedule()
        return draft.id
    }

    suspend fun delete(id: String) {
        val record = requireNotNull(dao.workLog(id))
        val pending = record.optimisticCommandId?.let { dao.outbox(it) }
        if (record.serverVersion == null && pending?.state == OutboxState.Pending && pending.attemptCount == 0) {
            dao.changeWorkLogDeletion(id, null, true)
        } else {
            require(pending == null) { "送信結果を確認してから削除できます。本文は保持しています。" }
            changeDeletion(record, "DeleteWorkLog", true)
        }
        schedule()
    }

    suspend fun restore(id: String) {
        val record = requireNotNull(dao.workLog(id))
        require(record.deleted && record.optimisticCommandId == null) { "削除の送信結果を確認してから元に戻せます。" }
        if (record.serverVersion == null) {
            val draft = MobileWorkLogDraft(record.id, record.body, record.performedDate, record.enteredAt, record.themeId, record.taskId)
            val envelope = MobileWorkLogContract.record(draft, deviceId())
            dao.changeWorkLogDeletion(id, pending(envelope, record.serverId, id, "RecordWorkLog"), false)
        } else {
            changeDeletion(record, "RestoreWorkLog", false)
        }
        schedule()
    }

    suspend fun retry(id: String) {
        dao.retryWorkLog(id)
        schedule()
    }

    private suspend fun changeDeletion(record: WorkLogCacheEntity, name: String, deleted: Boolean) {
        val id = UUID.randomUUID().toString()
        val envelope = MobileWorkLogEnvelope(
            requestId = UUID.randomUUID().toString(), commandId = id, idempotencyKey = id,
            clientDeviceId = deviceId(), issuedAt = now().toString(),
            command = buildJsonObject {
                put("name", name); put("noteId", record.id); put("expectedVersion", requireNotNull(record.serverVersion))
            },
        )
        dao.changeWorkLogDeletion(record.id, pending(envelope, record.serverId, record.id, name), deleted)
    }

    private fun pending(envelope: MobileWorkLogEnvelope, serverId: String, noteId: String, name: String) = OutboxCommandEntity(
        commandId = envelope.commandId, idempotencyKey = envelope.idempotencyKey, requestId = envelope.requestId,
        clientDeviceId = envelope.clientDeviceId, issuedAt = envelope.issuedAt, commandName = name,
        envelopeJson = MobileWorkLogContract.json.encodeToString(envelope), serverId = serverId,
        state = OutboxState.Pending, attemptCount = 0, createdAt = envelope.issuedAt,
        lastAttemptAt = null, lastError = null, workLogId = noteId,
    )
}
