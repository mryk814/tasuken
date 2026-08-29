package jp.personal.tasken.companion

import android.content.Context
import androidx.room.Dao
import androidx.room.Database
import androidx.room.Embedded
import androidx.room.Entity
import androidx.room.Insert
import androidx.room.Index
import androidx.room.OnConflictStrategy
import androidx.room.PrimaryKey
import androidx.room.Query
import androidx.room.Relation
import androidx.room.Room
import androidx.room.RoomDatabase
import androidx.room.Transaction
import androidx.room.migration.Migration
import androidx.sqlite.db.SupportSQLiteDatabase
import kotlinx.coroutines.flow.Flow
import kotlinx.serialization.decodeFromString
import kotlinx.serialization.encodeToString
import kotlinx.serialization.json.Json

private val mobileChecklistJson = Json {
    ignoreUnknownKeys = false
    encodeDefaults = true
    explicitNulls = true
}

internal fun encodeMobileChecklist(items: List<MobileChecklistItem>): String = mobileChecklistJson.encodeToString(items)

internal fun decodeMobileChecklist(value: String): List<MobileChecklistItem> = mobileChecklistJson.decodeFromString(value)

@Entity(tableName = "task_cache")
data class TaskCacheEntity(
    @PrimaryKey val id: String,
    val serverVersion: Int?,
    val title: String,
    val themeId: String?,
    val state: String,
    val workState: String?,
    val todayDate: String?,
    val updatedAt: String,
    val optimisticCommandId: String?,
    val conflictCommandId: String? = null,
    val scheduleId: String? = null,
    val scheduleVersion: Int? = null,
    val scheduleStartDate: String? = null,
    val scheduleEndDate: String? = null,
    val scheduleDateKind: String? = null,
    val scheduleRangeSemantics: String? = null,
    val scheduleConfidence: String? = null,
    val scheduleGranularity: String? = null,
    val plannedStartTime: String? = null,
    val plannedDurationMinutes: Int? = null,
    val latestReceiptId: String? = null,
    val latestReceiptReportedAt: String? = null,
    val latestReceiptExecutorLabel: String? = null,
    val latestReceiptSummary: String? = null,
    val checklistJson: String = "[]",
)

@Entity(tableName = "capture_receipt")
data class CaptureReceiptEntity(
    @PrimaryKey val id: String,
    val serverVersion: Int?,
    val capturedAt: String,
    val optimisticCommandId: String?,
)

@Entity(
    tableName = "work_receipt_cache",
    indices = [Index(value = ["taskId"])],
)
data class WorkReceiptCacheEntity(
    @PrimaryKey val id: String,
    val taskId: String,
    val executorKind: String,
    val executorLabel: String,
    val startedAt: String?,
    val reportedAt: String,
    val reportKind: String,
    val summary: String,
    val payloadJson: String,
    val truncated: Boolean,
    val serverId: String,
    val serverRevision: Int,
    val fetchedAt: String,
)

@Entity(
    tableName = "task_work_proposal_cache",
    indices = [Index(value = ["taskId"])],
)
data class TaskWorkProposalCacheEntity(
    @PrimaryKey val id: String,
    val taskId: String,
    val receivedAt: String,
    val payloadJson: String,
    val truncated: Boolean,
    val serverId: String,
    val serverRevision: Int,
    val fetchedAt: String,
)

@Entity(tableName = "theme_cache")
data class ThemeCacheEntity(
    @PrimaryKey val id: String,
    val title: String,
    val catalogId: Int = ThemeCatalogStateEntity.SINGLETON_ID,
)

object ThemeCatalogStatus {
    const val Loading = "loading"
    const val Available = "available"
    const val Stale = "stale"
    const val Unsupported = "unsupported"
    const val Error = "error"
}

@Entity(tableName = "theme_catalog_state")
data class ThemeCatalogStateEntity(
    @PrimaryKey val id: Int = SINGLETON_ID,
    val serverId: String,
    val serverRevision: Int?,
    val status: String,
    val generatedAt: String?,
    val lastAttemptAt: String,
    val lastError: String?,
    val activeRefreshId: String?,
) {
    companion object {
        const val SINGLETON_ID = 1
    }
}

@Entity(tableName = "outbox_command")
data class OutboxCommandEntity(
    @PrimaryKey val commandId: String,
    val idempotencyKey: String,
    val requestId: String,
    val clientDeviceId: String,
    val issuedAt: String,
    val commandName: String,
    val envelopeJson: String,
    val serverId: String,
    val state: String,
    val attemptCount: Int,
    val createdAt: String,
    val lastAttemptAt: String?,
    val lastError: String?,
    val taskId: String? = null,
    val captureId: String? = null,
    val dependsOnCommandId: String? = null,
)

@Entity(tableName = "pending_human_review")
data class PendingHumanReviewEntity(
    @PrimaryKey val commandId: String,
    val serverId: String,
    val taskId: String,
    val envelopeJson: String,
    val createdAt: String,
)

@Entity(tableName = "sync_state")
data class SyncStateEntity(
    @PrimaryKey val id: Int = SINGLETON_ID,
    val serverId: String?,
    val apiVersion: Int,
    val schemaVersion: Int,
    val cursor: String?,
    val lastSuccessfulSyncAt: String?,
    val lastAttemptAt: String?,
    val lastError: String?,
) {
    companion object {
        const val SINGLETON_ID = 1
    }
}

@Entity(tableName = "task_conflict")
data class TaskConflictEntity(
    @PrimaryKey val commandId: String,
    val taskId: String,
    val intendedAction: String,
    val expectedVersion: Int,
    val serverVersion: Int,
    val serverState: String,
    val serverTitle: String,
    val localTitle: String? = null,
    val serverTodayDate: String? = null,
    val localTodayDate: String? = null,
    val localTodayDateChanged: Boolean = false,
    val serverThemeId: String?,
    val localThemeId: String? = null,
    val localThemeIdChanged: Boolean = false,
    val localChecklistJson: String? = null,
    val localChecklistChanged: Boolean = false,
    val serverWorkState: String?,
    val serverUpdatedAt: String,
    val detectedAt: String,
    val localScheduleStartDate: String? = null,
    val localScheduleEndDate: String? = null,
    val localScheduleRangeSemantics: String? = null,
    val localScheduleChanged: Boolean = false,
    val localPlannedStartTime: String? = null,
    val localPlannedDurationMinutes: Int? = null,
    val localPlannedScheduleChanged: Boolean = false,
)

data class TaskCacheWithConflict(
    @Embedded val task: TaskCacheEntity,
    @Relation(parentColumn = "conflictCommandId", entityColumn = "commandId")
    val conflict: TaskConflictEntity?,
    @Relation(parentColumn = "optimisticCommandId", entityColumn = "commandId")
    val optimisticCommand: OutboxCommandEntity?,
    @Relation(parentColumn = "id", entityColumn = "taskId")
    val relatedCommands: List<OutboxCommandEntity>,
)

data class ThemeCatalogSnapshot(
    @Embedded val state: ThemeCatalogStateEntity,
    @Relation(parentColumn = "id", entityColumn = "catalogId")
    val themes: List<ThemeCacheEntity>,
)

object OutboxState {
    const val Pending = "pending"
    const val Sending = "sending"
    const val Rejected = "rejected"
    const val RetryWait = "retry_wait"
    const val Conflict = "conflict"
}

@Dao
abstract class MobileLocalDao {
    @Query("SELECT * FROM task_cache WHERE todayDate = :date ORDER BY updatedAt DESC, id ASC")
    @Transaction
    abstract fun observeTasks(date: String): Flow<List<TaskCacheWithConflict>>

    @Query("SELECT * FROM task_cache ORDER BY updatedAt DESC, id ASC")
    @Transaction
    abstract fun observeAllTasks(): Flow<List<TaskCacheWithConflict>>

    @Query("SELECT * FROM task_cache WHERE todayDate = :date ORDER BY updatedAt DESC, id ASC")
    abstract suspend fun tasksForDate(date: String): List<TaskCacheEntity>

    @Query("SELECT * FROM task_cache ORDER BY updatedAt DESC, id ASC")
    abstract suspend fun tasks(): List<TaskCacheEntity>

    @Query("SELECT * FROM task_cache WHERE id = :taskId")
    abstract suspend fun task(taskId: String): TaskCacheEntity?

    @Query("SELECT * FROM capture_receipt WHERE id = :captureId")
    abstract suspend fun captureReceipt(captureId: String): CaptureReceiptEntity?

    @Query("SELECT * FROM theme_cache ORDER BY title COLLATE NOCASE ASC, id ASC")
    abstract fun observeThemes(): Flow<List<ThemeCacheEntity>>

    @Query("SELECT * FROM theme_cache ORDER BY title COLLATE NOCASE ASC, id ASC")
    abstract suspend fun themes(): List<ThemeCacheEntity>

    @Query("SELECT * FROM theme_catalog_state WHERE id = 1")
    abstract suspend fun themeCatalogState(): ThemeCatalogStateEntity?

    @Query("SELECT * FROM theme_catalog_state WHERE id = 1")
    @Transaction
    abstract fun observeThemeCatalog(): Flow<ThemeCatalogSnapshot?>

    @Query("SELECT * FROM theme_catalog_state WHERE id = 1")
    @Transaction
    abstract suspend fun themeCatalog(): ThemeCatalogSnapshot?

    @Query("SELECT * FROM sync_state WHERE id = 1")
    abstract suspend fun syncState(): SyncStateEntity?

    @Query("SELECT * FROM sync_state WHERE id = 1")
    abstract fun observeSyncState(): Flow<SyncStateEntity?>

    @Query("SELECT * FROM work_receipt_cache WHERE id = :receiptId AND serverId = :serverId")
    abstract suspend fun workReceipt(receiptId: String, serverId: String): WorkReceiptCacheEntity?

    @Query("SELECT * FROM task_work_proposal_cache ORDER BY receivedAt DESC, id ASC")
    abstract fun observeTaskWorkProposals(): Flow<List<TaskWorkProposalCacheEntity>>

    @Query("SELECT * FROM task_work_proposal_cache WHERE id = :proposalId AND serverId = :serverId")
    abstract suspend fun taskWorkProposal(proposalId: String, serverId: String): TaskWorkProposalCacheEntity?

    @Query("SELECT * FROM outbox_command WHERE commandId = :commandId")
    abstract suspend fun outbox(commandId: String): OutboxCommandEntity?

    @Query("SELECT * FROM pending_human_review WHERE commandId = :commandId")
    abstract suspend fun pendingHumanReview(commandId: String): PendingHumanReviewEntity?

    @Query("SELECT * FROM outbox_command WHERE taskId = :taskId ORDER BY createdAt, commandId")
    abstract suspend fun outboxForTask(taskId: String): List<OutboxCommandEntity>

    @Query("SELECT * FROM outbox_command WHERE captureId = :captureId ORDER BY createdAt, commandId")
    abstract suspend fun outboxForCapture(captureId: String): List<OutboxCommandEntity>

    @Query("SELECT * FROM outbox_command WHERE dependsOnCommandId = :commandId ORDER BY createdAt, commandId")
    abstract suspend fun dependents(commandId: String): List<OutboxCommandEntity>

    @Query("SELECT COUNT(*) FROM outbox_command")
    abstract suspend fun outboxCount(): Int

    @Query("SELECT COUNT(*) FROM outbox_command WHERE serverId = '' OR serverId != :serverId")
    abstract suspend fun incompatibleOutboxCount(serverId: String): Int

    @Query("SELECT COUNT(*) FROM outbox_command WHERE state IN ('pending', 'sending', 'retry_wait')")
    abstract fun observePendingCount(): Flow<Int>

    @Query("SELECT COUNT(*) FROM outbox_command WHERE state IN ('pending', 'sending', 'retry_wait')")
    abstract suspend fun pendingCount(): Int

    @Query("SELECT COUNT(*) FROM task_conflict")
    abstract fun observeConflictCount(): Flow<Int>

    @Query("SELECT COUNT(*) FROM task_conflict")
    abstract suspend fun conflictCount(): Int

    @Query("SELECT * FROM task_conflict WHERE commandId = :commandId")
    abstract suspend fun conflict(commandId: String): TaskConflictEntity?

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    abstract suspend fun upsertTask(task: TaskCacheEntity)

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    abstract suspend fun upsertCaptureReceipt(receipt: CaptureReceiptEntity)

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    abstract suspend fun upsertThemes(themes: List<ThemeCacheEntity>)

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    abstract suspend fun upsertThemeCatalogState(state: ThemeCatalogStateEntity)

    @Insert(onConflict = OnConflictStrategy.ABORT)
    abstract suspend fun insertOutbox(command: OutboxCommandEntity)

    @Insert(onConflict = OnConflictStrategy.ABORT)
    abstract suspend fun insertPendingHumanReview(review: PendingHumanReviewEntity)

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    abstract suspend fun upsertSyncState(state: SyncStateEntity)

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    abstract suspend fun upsertWorkReceipt(receipt: WorkReceiptCacheEntity)

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    abstract suspend fun upsertTaskWorkProposals(proposals: List<TaskWorkProposalCacheEntity>)

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    abstract suspend fun upsertConflict(conflict: TaskConflictEntity)

    @Query("DELETE FROM task_cache WHERE todayDate = :date AND optimisticCommandId IS NULL AND conflictCommandId IS NULL")
    abstract suspend fun deleteCanonicalToday(date: String)

    @Query("DELETE FROM task_cache WHERE optimisticCommandId IS NULL AND conflictCommandId IS NULL")
    abstract suspend fun deleteCanonicalTasks()

    @Query("DELETE FROM task_cache WHERE id = :taskId AND optimisticCommandId IS NULL AND conflictCommandId IS NULL")
    abstract suspend fun deleteCanonicalTask(taskId: String)

    @Query("DELETE FROM task_cache WHERE id = :taskId")
    abstract suspend fun deleteTask(taskId: String)

    @Query("DELETE FROM capture_receipt WHERE id = :captureId")
    abstract suspend fun deleteCaptureReceipt(captureId: String)

    @Query("DELETE FROM theme_cache")
    abstract suspend fun deleteThemes()

    @Query("DELETE FROM task_work_proposal_cache")
    abstract suspend fun deleteTaskWorkProposals()

    @Query("DELETE FROM task_work_proposal_cache WHERE id = :proposalId AND serverId = :serverId")
    abstract suspend fun deleteTaskWorkProposal(proposalId: String, serverId: String)

    @Transaction
    open suspend fun replaceTaskWorkProposals(proposals: List<TaskWorkProposalCacheEntity>) {
        deleteTaskWorkProposals()
        if (proposals.isNotEmpty()) upsertTaskWorkProposals(proposals)
    }

    @Query(
        "SELECT * FROM outbox_command " +
            "WHERE serverId = :serverId AND state IN ('pending', 'retry_wait') AND dependsOnCommandId IS NULL " +
            "ORDER BY createdAt ASC, commandId ASC LIMIT 1",
    )
    abstract suspend fun nextSendable(serverId: String): OutboxCommandEntity?

    @Query(
        "UPDATE outbox_command SET state = 'sending', attemptCount = attemptCount + 1, " +
            "lastAttemptAt = :attemptedAt, lastError = NULL " +
            "WHERE commandId = :commandId AND serverId = :serverId AND state IN ('pending', 'retry_wait')",
    )
    abstract suspend fun markSending(commandId: String, serverId: String, attemptedAt: String): Int

    @Query(
        "UPDATE outbox_command SET state = 'retry_wait', lastError = :reason " +
            "WHERE state = 'sending'",
    )
    abstract suspend fun recoverInterruptedSending(reason: String): Int

    @Query("UPDATE outbox_command SET state = 'retry_wait', lastError = :reason WHERE commandId = :commandId")
    abstract suspend fun markRetry(commandId: String, reason: String)

    @Query("UPDATE outbox_command SET state = 'rejected', lastError = :reason WHERE commandId = :commandId")
    abstract suspend fun markRejected(commandId: String, reason: String)

    @Query("UPDATE outbox_command SET state = 'conflict', lastError = :reason WHERE commandId = :commandId")
    abstract suspend fun markConflict(commandId: String, reason: String)

    @Query("DELETE FROM outbox_command WHERE commandId = :commandId")
    abstract suspend fun deleteOutbox(commandId: String)

    @Query("DELETE FROM pending_human_review WHERE commandId = :commandId")
    abstract suspend fun deletePendingHumanReview(commandId: String)

    @Transaction
    open suspend fun pendingHumanReviewOrInsert(review: PendingHumanReviewEntity): PendingHumanReviewEntity {
        val existing = pendingHumanReview(review.commandId)
        if (existing != null) return existing
        insertPendingHumanReview(review)
        return review
    }

    @Transaction
    open suspend fun applyHumanReviewSuccess(commandId: String, canonicalTask: TaskCacheEntity) {
        val current = task(canonicalTask.id)
        if (current?.serverVersion == null || canonicalTask.serverVersion!! >= current.serverVersion) {
            upsertTask(canonicalTask)
        }
        deletePendingHumanReview(commandId)
    }

    @Query("DELETE FROM task_conflict WHERE commandId = :commandId")
    abstract suspend fun deleteConflict(commandId: String)

    @Query("UPDATE task_cache SET conflictCommandId = NULL WHERE conflictCommandId = :commandId")
    abstract suspend fun clearTaskConflict(commandId: String)

    @Query(
        "UPDATE outbox_command SET envelopeJson = :envelopeJson, dependsOnCommandId = NULL " +
            "WHERE commandId = :commandId AND dependsOnCommandId = :parentCommandId " +
            "AND state = 'pending' AND attemptCount = 0",
    )
    abstract suspend fun materializeDependent(
        commandId: String,
        parentCommandId: String,
        envelopeJson: String,
    ): Int

    @Query(
        "DELETE FROM outbox_command WHERE commandId = :commandId AND state = 'pending' AND attemptCount = 0",
    )
    abstract suspend fun deleteUnsent(commandId: String): Int

    @Query(
        "UPDATE outbox_command SET envelopeJson = :envelopeJson " +
            "WHERE commandId = :commandId AND state = 'pending' AND attemptCount = 0",
    )
    abstract suspend fun replaceUnsentEnvelope(commandId: String, envelopeJson: String): Int

    @Transaction
    open suspend fun enqueueCreate(task: TaskCacheEntity, command: OutboxCommandEntity) {
        require(task.optimisticCommandId == command.commandId)
        require(command.commandId == command.idempotencyKey)
        require(command.serverId.isNotBlank())
        require(syncState()?.serverId == command.serverId)
        upsertTask(task)
        insertOutbox(command)
    }

    @Transaction
    open suspend fun enqueueCaptureCreate(receipt: CaptureReceiptEntity, command: OutboxCommandEntity) {
        require(receipt.optimisticCommandId == command.commandId)
        require(command.captureId == receipt.id && command.commandName == "CreateCapture")
        require(command.commandId == command.idempotencyKey)
        require(command.serverId.isNotBlank())
        require(syncState()?.serverId == command.serverId)
        upsertCaptureReceipt(receipt)
        insertOutbox(command)
    }

    @Transaction
    open suspend fun enqueueCaptureDelete(receipt: CaptureReceiptEntity, command: OutboxCommandEntity) {
        require(receipt.optimisticCommandId == command.commandId)
        require(command.captureId == receipt.id && command.commandName == "DeleteCapture")
        require(command.commandId == command.idempotencyKey)
        require(command.serverId.isNotBlank())
        require(syncState()?.serverId == command.serverId)
        command.dependsOnCommandId?.let { parentId ->
            val parent = requireNotNull(outbox(parentId))
            require(parent.captureId == receipt.id && parent.commandName == "CreateCapture")
            require(parent.serverId == command.serverId)
        }
        upsertCaptureReceipt(receipt)
        insertOutbox(command)
    }

    @Transaction
    open suspend fun enqueueStateAction(task: TaskCacheEntity, command: OutboxCommandEntity) {
        require(task.optimisticCommandId == command.commandId)
        require(task.serverVersion != null)
        require(command.commandName in setOf("UpdateTask", "CompleteTask", "ReopenTask", "DeleteTask"))
        require(command.serverId.isNotBlank())
        require(syncState()?.serverId == command.serverId)
        upsertTask(task)
        insertOutbox(command)
    }

    @Transaction
    open suspend fun enqueueDependentStateAction(task: TaskCacheEntity, command: OutboxCommandEntity) {
        require(task.optimisticCommandId == command.commandId)
        require(command.dependsOnCommandId != null)
        require(command.commandName in setOf("CompleteTask", "ReopenTask", "DeleteTask"))
        require(command.serverId.isNotBlank())
        require(syncState()?.serverId == command.serverId)
        require(outbox(requireNotNull(command.dependsOnCommandId))?.serverId == command.serverId)
        upsertTask(task)
        insertOutbox(command)
    }

    @Transaction
    open suspend fun enqueueThemeUpdate(
        task: TaskCacheEntity,
        command: OutboxCommandEntity,
        replacedRejectedCommandIds: List<String>,
    ) {
        require(task.optimisticCommandId == command.commandId)
        require(task.serverVersion != null)
        require(command.commandName == "UpdateTask" && command.serverId.isNotBlank())
        require(syncState()?.serverId == command.serverId)
        replacedRejectedCommandIds.forEach { rejectedId ->
            val rejected = requireNotNull(outbox(rejectedId))
            require(
                rejected.taskId == task.id &&
                    rejected.commandName == "UpdateTask" &&
                    rejected.state == OutboxState.Rejected &&
                    rejected.serverId == command.serverId,
            )
        }
        upsertTask(task)
        insertOutbox(command)
        replacedRejectedCommandIds.forEach { deleteOutbox(it) }
    }

    @Transaction
    open suspend fun discardRejectedThemeUpdate(commandId: String, taskId: String) {
        val command = requireNotNull(outbox(commandId))
        require(
            command.taskId == taskId &&
                command.commandName == "UpdateTask" &&
                command.state == OutboxState.Rejected,
        )
        require(syncState()?.serverId == command.serverId)
        val current = requireNotNull(task(taskId))
        require(current.optimisticCommandId != commandId && current.conflictCommandId != commandId)
        deleteOutbox(commandId)
    }

    @Transaction
    open suspend fun cancelUnsentStateAction(
        commandId: String,
        task: TaskCacheEntity,
    ) {
        require(deleteUnsent(commandId) == 1)
        upsertTask(task)
    }

    @Transaction
    open suspend fun replaceUnsentChecklistUpdate(
        commandId: String,
        task: TaskCacheEntity,
        envelopeJson: String,
    ) {
        val command = requireNotNull(outbox(commandId))
        require(command.taskId == task.id && command.commandName == "UpdateTask")
        require(task.optimisticCommandId == commandId && task.conflictCommandId == null)
        require(syncState()?.serverId == command.serverId)
        require(replaceUnsentEnvelope(commandId, envelopeJson) == 1)
        upsertTask(task)
    }

    @Transaction
    open suspend fun cancelUnsentCreate(commandId: String, taskId: String): Boolean {
        val command = outbox(commandId) ?: return false
        val current = task(taskId) ?: return false
        if (
            command.commandName != "CreateTask" ||
            command.taskId != taskId ||
            current.serverVersion != null ||
            current.optimisticCommandId != commandId ||
            dependents(commandId).isNotEmpty()
        ) return false
        if (deleteUnsent(commandId) != 1) return false
        deleteTask(taskId)
        return true
    }

    @Transaction
    open suspend fun cancelUnsentCaptureCreate(commandId: String, captureId: String): Boolean {
        val command = outbox(commandId) ?: return false
        val receipt = captureReceipt(captureId) ?: return false
        if (
            command.commandName != "CreateCapture" ||
            command.captureId != captureId ||
            receipt.serverVersion != null ||
            receipt.optimisticCommandId != commandId ||
            dependents(commandId).isNotEmpty()
        ) return false
        if (command.state == OutboxState.Rejected) {
            deleteOutbox(commandId)
            deleteCaptureReceipt(captureId)
            return true
        }
        if (deleteUnsent(commandId) != 1) return false
        deleteCaptureReceipt(captureId)
        return true
    }

    @Transaction
    open suspend fun acceptMissingCaptureDelete(commandId: String, captureId: String) {
        val command = requireNotNull(outbox(commandId))
        require(
            command.captureId == captureId &&
                command.commandName == "DeleteCapture" &&
                command.state == OutboxState.Sending,
        )
        require(syncState()?.serverId == command.serverId)
        require(captureReceipt(captureId)?.optimisticCommandId == commandId)
        deleteCaptureReceipt(captureId)
        deleteOutbox(commandId)
    }

    @Transaction
    open suspend fun rejectCaptureDeleteAndRestore(commandId: String, captureId: String, reason: String) {
        val command = requireNotNull(outbox(commandId))
        require(
            command.captureId == captureId &&
                command.commandName == "DeleteCapture" &&
                command.state == OutboxState.Sending,
        )
        require(syncState()?.serverId == command.serverId)
        val receipt = requireNotNull(captureReceipt(captureId))
        require(receipt.optimisticCommandId == commandId)
        upsertCaptureReceipt(receipt.copy(optimisticCommandId = null))
        markRejected(commandId, reason)
    }

    @Transaction
    open suspend fun replaceToday(date: String, tasks: List<TaskCacheEntity>, syncState: SyncStateEntity) {
        deleteCanonicalToday(date)
        tasks.forEach { upsertTask(it) }
        upsertSyncState(syncState)
    }

    @Transaction
    open suspend fun applyBootstrap(tasks: List<TaskCacheEntity>, syncState: SyncStateEntity) {
        deleteCanonicalTasks()
        tasks.forEach { incoming ->
            val current = task(incoming.id)
            if (current == null || (current.optimisticCommandId == null && current.conflictCommandId == null)) {
                upsertTask(incoming)
            }
        }
        upsertSyncState(syncState)
    }

    @Transaction
    open suspend fun applyVerifiedBootstrap(tasks: List<TaskCacheEntity>, syncState: SyncStateEntity): Boolean {
        val serverId = requireNotNull(syncState.serverId)
        require(serverId.isNotBlank())
        if (incompatibleOutboxCount(serverId) != 0) return false
        invalidateThemeCatalogForServer(serverId, syncState.lastAttemptAt ?: syncState.lastSuccessfulSyncAt.orEmpty())
        applyBootstrap(tasks, syncState)
        return true
    }

    @Transaction
    open suspend fun applySyncPage(
        upserts: List<TaskCacheEntity>,
        tombstoneIds: List<String>,
        syncState: SyncStateEntity,
    ) {
        val serverId = requireNotNull(syncState.serverId)
        require(serverId.isNotBlank() && this.syncState()?.serverId == serverId)
        require(incompatibleOutboxCount(serverId) == 0)
        tombstoneIds.forEach { deleteCanonicalTask(it) }
        upserts.forEach { incoming ->
            val current = task(incoming.id)
            if (current == null || (current.optimisticCommandId == null && current.conflictCommandId == null)) {
                upsertTask(incoming)
            }
        }
        upsertSyncState(syncState)
    }

    @Transaction
    open suspend fun invalidateThemeCatalogForServer(serverId: String, attemptedAt: String) {
        require(serverId.isNotBlank())
        val current = themeCatalogState()
        if (current != null && current.serverId == serverId) return
        deleteThemes()
        upsertThemeCatalogState(
            ThemeCatalogStateEntity(
                serverId = serverId,
                serverRevision = null,
                status = ThemeCatalogStatus.Loading,
                generatedAt = null,
                lastAttemptAt = attemptedAt,
                lastError = null,
                activeRefreshId = null,
            ),
        )
    }

    @Transaction
    open suspend fun prepareThemeRefresh(serverId: String, refreshId: String, attemptedAt: String) {
        require(serverId.isNotBlank() && refreshId.isNotBlank())
        val current = themeCatalogState()
        if (current == null || current.serverId != serverId) {
            deleteThemes()
            upsertThemeCatalogState(
                ThemeCatalogStateEntity(
                    serverId = serverId,
                    serverRevision = null,
                    status = ThemeCatalogStatus.Loading,
                    generatedAt = null,
                    lastAttemptAt = attemptedAt,
                    lastError = null,
                    activeRefreshId = refreshId,
                ),
            )
            return
        }
        upsertThemeCatalogState(
            current.copy(
                status = ThemeCatalogStatus.Loading,
                lastAttemptAt = attemptedAt,
                activeRefreshId = refreshId,
            ),
        )
    }

    @Transaction
    open suspend fun completeThemeRefresh(
        serverId: String,
        serverRevision: Int,
        generatedAt: String,
        attemptedAt: String,
        refreshId: String,
        themes: List<ThemeCacheEntity>,
    ): Boolean {
        require(serverId.isNotBlank() && refreshId.isNotBlank() && serverRevision >= 0)
        require(themes.map { it.id }.distinct().size == themes.size)
        require(themes.all { it.catalogId == ThemeCatalogStateEntity.SINGLETON_ID })
        val current = themeCatalogState() ?: return false
        if (current.serverId != serverId || current.activeRefreshId != refreshId) return false
        val currentRevision = current.serverRevision
        if (currentRevision != null && serverRevision < currentRevision) {
            upsertThemeCatalogState(
                current.copy(
                    status = if (current.lastError == null) {
                        ThemeCatalogStatus.Available
                    } else {
                        ThemeCatalogStatus.Stale
                    },
                    activeRefreshId = null,
                ),
            )
            return false
        }
        deleteThemes()
        upsertThemes(themes)
        upsertThemeCatalogState(
            current.copy(
                serverRevision = serverRevision,
                status = ThemeCatalogStatus.Available,
                generatedAt = generatedAt,
                lastAttemptAt = maxOf(current.lastAttemptAt, attemptedAt),
                lastError = null,
                activeRefreshId = null,
            ),
        )
        return true
    }

    @Transaction
    open suspend fun failThemeRefresh(
        serverId: String,
        refreshId: String,
        attemptedAt: String,
        error: String,
        unsupported: Boolean,
    ): Boolean {
        val current = themeCatalogState() ?: return false
        if (current.serverId != serverId || current.activeRefreshId != refreshId) return false
        if (unsupported) {
            deleteThemes()
            upsertThemeCatalogState(
                current.copy(
                    serverRevision = null,
                    status = ThemeCatalogStatus.Unsupported,
                    generatedAt = null,
                    lastAttemptAt = attemptedAt,
                    lastError = error,
                    activeRefreshId = null,
                ),
            )
            return true
        }
        upsertThemeCatalogState(
            current.copy(
                status = if (current.serverRevision == null) ThemeCatalogStatus.Error else ThemeCatalogStatus.Stale,
                lastAttemptAt = attemptedAt,
                lastError = error,
                activeRefreshId = null,
            ),
        )
        return true
    }

    @Transaction
    open suspend fun recoverInterruptedThemeRefresh(
        currentProcessId: String,
        recoveredAt: String,
        reason: String,
    ): Boolean {
        require(currentProcessId.isNotBlank())
        val current = themeCatalogState() ?: return false
        val activeRefreshId = current.activeRefreshId ?: return false
        if (current.status != ThemeCatalogStatus.Loading || activeRefreshId.startsWith("$currentProcessId:")) {
            return false
        }
        upsertThemeCatalogState(
            current.copy(
                status = if (current.serverRevision == null) ThemeCatalogStatus.Error else ThemeCatalogStatus.Stale,
                lastAttemptAt = maxOf(current.lastAttemptAt, recoveredAt),
                lastError = reason,
                activeRefreshId = null,
            ),
        )
        return true
    }

    @Transaction
    open suspend fun rejectUpdateAndRollback(
        commandId: String,
        taskId: String,
        baseThemeId: String?,
        reason: String,
    ) {
        val command = requireNotNull(outbox(commandId)) { "Outbox command is missing" }
        require(
            command.taskId == taskId &&
                command.commandName == "UpdateTask" &&
                command.state == OutboxState.Sending,
        )
        require(syncState()?.serverId == command.serverId)
        val current = requireNotNull(task(taskId)) { "Optimistic task is missing" }
        require(current.optimisticCommandId == commandId)
        upsertTask(current.copy(themeId = baseThemeId, optimisticCommandId = null))
        markRejected(commandId, reason)
    }

    @Transaction
    open suspend fun rejectScheduleUpdateAndRollback(
        commandId: String,
        taskId: String,
        baseSchedule: MobileTaskScheduleDraft?,
        reason: String,
    ) {
        val command = requireNotNull(outbox(commandId)) { "Outbox command is missing" }
        require(
            command.taskId == taskId &&
                command.commandName == "UpdateTask" &&
                command.state == OutboxState.Sending,
        )
        require(syncState()?.serverId == command.serverId)
        val current = requireNotNull(task(taskId)) { "Optimistic task is missing" }
        require(current.optimisticCommandId == commandId)
        upsertTask(
            if (baseSchedule == null) {
                current.copy(
                    scheduleId = null,
                    scheduleVersion = null,
                    scheduleStartDate = null,
                    scheduleEndDate = null,
                    scheduleDateKind = null,
                    scheduleRangeSemantics = null,
                    scheduleConfidence = null,
                    scheduleGranularity = null,
                    optimisticCommandId = null,
                )
            } else {
                current.copy(
                    scheduleStartDate = baseSchedule.startDate,
                    scheduleEndDate = baseSchedule.endDate,
                    scheduleDateKind = deriveScheduleDateKind(baseSchedule.startDate, baseSchedule.endDate),
                    scheduleRangeSemantics = baseSchedule.rangeSemantics,
                    optimisticCommandId = null,
                )
            },
        )
        markRejected(commandId, reason)
    }

    @Transaction
    open suspend fun rejectDeleteAndRestore(commandId: String, taskId: String, reason: String) {
        val command = requireNotNull(outbox(commandId)) { "Outbox command is missing" }
        require(
            command.taskId == taskId &&
                command.commandName == "DeleteTask" &&
                command.state == OutboxState.Sending,
        )
        require(syncState()?.serverId == command.serverId)
        val current = requireNotNull(task(taskId)) { "Task cache is missing" }
        require(current.optimisticCommandId == commandId)
        upsertTask(current.copy(optimisticCommandId = null))
        markRejected(commandId, reason)
    }

    @Transaction
    open suspend fun rejectChecklistUpdateAndRollback(
        commandId: String,
        taskId: String,
        baseChecklistJson: String,
        reason: String,
    ) {
        val command = requireNotNull(outbox(commandId)) { "Outbox command is missing" }
        require(
            command.taskId == taskId &&
                command.commandName == "UpdateTask" &&
                command.state == OutboxState.Sending,
        )
        require(syncState()?.serverId == command.serverId)
        val current = requireNotNull(task(taskId)) { "Optimistic task is missing" }
        require(current.optimisticCommandId == commandId)
        upsertTask(current.copy(checklistJson = baseChecklistJson, optimisticCommandId = null))
        markRejected(commandId, reason)
    }

    @Transaction
    open suspend fun acceptMissingDelete(commandId: String, taskId: String) {
        val command = requireNotNull(outbox(commandId)) { "Outbox command is missing" }
        require(
            command.taskId == taskId &&
                command.commandName == "DeleteTask" &&
                command.state == OutboxState.Sending,
        )
        require(syncState()?.serverId == command.serverId)
        require(task(taskId)?.optimisticCommandId == commandId)
        deleteTask(taskId)
        deleteConflict(commandId)
        deleteOutbox(commandId)
    }

    @Transaction
    open suspend fun applyCommandReceipt(
        commandId: String,
        expectedServerId: String,
        expectedTaskId: String,
        expectedAttemptCount: Int,
        canonicalTask: TaskCacheEntity,
        syncState: SyncStateEntity,
        dependentCommandId: String? = null,
        dependentEnvelopeJson: String? = null,
        optimisticState: String? = null,
    ): Boolean {
        require(expectedServerId.isNotBlank() && expectedTaskId.isNotBlank() && expectedAttemptCount > 0)
        val command = outbox(commandId) ?: return false
        if (
            command.serverId != expectedServerId ||
            command.taskId != expectedTaskId ||
            command.state != OutboxState.Sending ||
            command.attemptCount != expectedAttemptCount ||
            syncState.serverId != expectedServerId ||
            this.syncState()?.serverId != expectedServerId ||
            canonicalTask.id != expectedTaskId
        ) {
            return false
        }
        val currentTask = task(expectedTaskId) ?: return false
        val canonicalVersion = canonicalTask.serverVersion ?: return false
        if (currentTask.serverVersion?.let { canonicalVersion < it } == true) return false
        if (dependentCommandId != null) {
            require(dependentEnvelopeJson != null && optimisticState != null)
            val dependent = outbox(dependentCommandId) ?: return false
            if (
                dependent.serverId != expectedServerId ||
                dependent.taskId != expectedTaskId ||
                dependent.dependsOnCommandId != commandId ||
                dependent.state != OutboxState.Pending ||
                dependent.attemptCount != 0 ||
                currentTask.optimisticCommandId != dependentCommandId
            ) {
                return false
            }
            if (materializeDependent(dependentCommandId, commandId, dependentEnvelopeJson) != 1) return false
        } else if (currentTask.optimisticCommandId != commandId) {
            return false
        }
        upsertTask(
            canonicalTask.copy(
                state = optimisticState ?: canonicalTask.state,
                optimisticCommandId = dependentCommandId,
                conflictCommandId = null,
            ),
        )
        upsertSyncState(syncState)
        deleteConflict(commandId)
        deleteOutbox(commandId)
        return true
    }

    @Transaction
    open suspend fun applyCaptureCreateReceipt(
        commandId: String,
        expectedServerId: String,
        expectedCaptureId: String,
        expectedAttemptCount: Int,
        canonicalReceipt: CaptureReceiptEntity,
        syncState: SyncStateEntity,
        dependentCommandId: String? = null,
        dependentEnvelopeJson: String? = null,
    ): Boolean {
        require(expectedServerId.isNotBlank() && expectedCaptureId.isNotBlank() && expectedAttemptCount > 0)
        val command = outbox(commandId) ?: return false
        if (
            command.serverId != expectedServerId ||
            command.captureId != expectedCaptureId ||
            command.commandName != "CreateCapture" ||
            command.state != OutboxState.Sending ||
            command.attemptCount != expectedAttemptCount ||
            syncState.serverId != expectedServerId ||
            this.syncState()?.serverId != expectedServerId ||
            canonicalReceipt.id != expectedCaptureId ||
            canonicalReceipt.serverVersion == null
        ) return false
        val current = captureReceipt(expectedCaptureId) ?: return false
        if (current.serverVersion?.let { canonicalReceipt.serverVersion < it } == true) return false
        if (dependentCommandId != null) {
            require(dependentEnvelopeJson != null)
            val dependent = outbox(dependentCommandId) ?: return false
            if (
                dependent.serverId != expectedServerId ||
                dependent.captureId != expectedCaptureId ||
                dependent.dependsOnCommandId != commandId ||
                dependent.commandName != "DeleteCapture" ||
                dependent.state != OutboxState.Pending ||
                dependent.attemptCount != 0 ||
                current.optimisticCommandId != dependentCommandId
            ) return false
            if (materializeDependent(dependentCommandId, commandId, dependentEnvelopeJson) != 1) return false
        } else if (current.optimisticCommandId != commandId) {
            return false
        }
        upsertCaptureReceipt(canonicalReceipt.copy(optimisticCommandId = dependentCommandId))
        upsertSyncState(syncState)
        deleteOutbox(commandId)
        return true
    }

    @Transaction
    open suspend fun applyCaptureDeleteReceipt(
        commandId: String,
        expectedServerId: String,
        expectedCaptureId: String,
        expectedAttemptCount: Int,
        canonicalVersion: Int,
        syncState: SyncStateEntity,
    ): Boolean {
        require(expectedServerId.isNotBlank() && expectedCaptureId.isNotBlank() && expectedAttemptCount > 0)
        val command = outbox(commandId) ?: return false
        if (
            command.serverId != expectedServerId ||
            command.captureId != expectedCaptureId ||
            command.commandName != "DeleteCapture" ||
            command.state != OutboxState.Sending ||
            command.attemptCount != expectedAttemptCount ||
            syncState.serverId != expectedServerId ||
            this.syncState()?.serverId != expectedServerId
        ) return false
        val current = captureReceipt(expectedCaptureId) ?: return false
        if (
            current.optimisticCommandId != commandId ||
            current.serverVersion?.let { canonicalVersion <= it } == true ||
            dependents(commandId).isNotEmpty()
        ) return false
        deleteCaptureReceipt(expectedCaptureId)
        upsertSyncState(syncState)
        deleteOutbox(commandId)
        return true
    }

    @Transaction
    open suspend fun applyDeleteReceipt(
        commandId: String,
        expectedServerId: String,
        expectedTaskId: String,
        expectedAttemptCount: Int,
        canonicalVersion: Int,
        syncState: SyncStateEntity,
    ): Boolean {
        require(expectedServerId.isNotBlank() && expectedTaskId.isNotBlank() && expectedAttemptCount > 0)
        val command = outbox(commandId) ?: return false
        if (
            command.serverId != expectedServerId ||
            command.taskId != expectedTaskId ||
            command.commandName != "DeleteTask" ||
            command.state != OutboxState.Sending ||
            command.attemptCount != expectedAttemptCount ||
            syncState.serverId != expectedServerId ||
            this.syncState()?.serverId != expectedServerId
        ) return false
        val currentTask = task(expectedTaskId) ?: return false
        if (
            currentTask.optimisticCommandId != commandId ||
            currentTask.serverVersion?.let { canonicalVersion <= it } == true ||
            dependents(commandId).isNotEmpty()
        ) return false
        deleteTask(expectedTaskId)
        upsertSyncState(syncState)
        deleteConflict(commandId)
        deleteOutbox(commandId)
        return true
    }

    @Transaction
    open suspend fun recordConflict(
        commandId: String,
        canonicalTask: TaskCacheEntity,
        conflict: TaskConflictEntity,
        syncState: SyncStateEntity,
        reason: String,
    ) {
        require(commandId == conflict.commandId)
        require(canonicalTask.id == conflict.taskId)
        require(outbox(commandId)?.serverId == syncState.serverId)
        upsertTask(canonicalTask.copy(optimisticCommandId = null, conflictCommandId = commandId))
        upsertConflict(conflict)
        upsertSyncState(syncState)
        markConflict(commandId, reason)
    }

    @Transaction
    open suspend fun acceptServer(commandId: String) {
        val command = requireNotNull(outbox(commandId))
        require(syncState()?.serverId == command.serverId)
        clearTaskConflict(commandId)
        deleteConflict(commandId)
        deleteOutbox(commandId)
    }

    @Transaction
    open suspend fun replaceConflictWithCommand(
        oldCommandId: String,
        task: TaskCacheEntity,
        command: OutboxCommandEntity,
    ) {
        require(task.optimisticCommandId == command.commandId)
        val previous = requireNotNull(outbox(oldCommandId))
        require(command.serverId.isNotBlank() && previous.serverId == command.serverId)
        require(syncState()?.serverId == command.serverId)
        clearTaskConflict(oldCommandId)
        deleteConflict(oldCommandId)
        deleteOutbox(oldCommandId)
        upsertTask(task.copy(conflictCommandId = null))
        insertOutbox(command)
    }

    @Transaction
    open suspend fun claimNext(serverId: String, attemptedAt: String): OutboxCommandEntity? {
        require(serverId.isNotBlank())
        val command = nextSendable(serverId) ?: return null
        return if (markSending(command.commandId, serverId, attemptedAt) == 1) {
            command.copy(
                state = OutboxState.Sending,
                attemptCount = command.attemptCount + 1,
                lastAttemptAt = attemptedAt,
                lastError = null,
            )
        } else {
            null
        }
    }
}

@Database(
    entities = [
        TaskCacheEntity::class,
        CaptureReceiptEntity::class,
        ThemeCacheEntity::class,
        ThemeCatalogStateEntity::class,
        OutboxCommandEntity::class,
        SyncStateEntity::class,
        TaskConflictEntity::class,
        WorkReceiptCacheEntity::class,
        TaskWorkProposalCacheEntity::class,
        PendingHumanReviewEntity::class,
    ],
    version = 15,
    exportSchema = true,
)
abstract class MobileLocalDatabase : RoomDatabase() {
    abstract fun mobileDao(): MobileLocalDao

    companion object {
        @Volatile private var instance: MobileLocalDatabase? = null

        fun open(context: Context): MobileLocalDatabase = instance ?: synchronized(this) {
            instance ?: Room.databaseBuilder(
                context.applicationContext,
                MobileLocalDatabase::class.java,
                "tasken-mobile-cache.db",
            ).addMigrations(
                MIGRATION_1_2,
                MIGRATION_2_3,
                MIGRATION_3_4,
                MIGRATION_4_5,
                MIGRATION_5_6,
                MIGRATION_6_7,
                MIGRATION_7_8,
                MIGRATION_8_9,
                MIGRATION_9_10,
                MIGRATION_10_11,
                MIGRATION_11_12,
                MIGRATION_12_13,
                MIGRATION_13_14,
                MIGRATION_14_15,
            ).build().also { instance = it }
        }
    }
}

internal val MIGRATION_1_2 = object : Migration(1, 2) {
    override fun migrate(db: SupportSQLiteDatabase) {
        db.execSQL("ALTER TABLE task_cache ADD COLUMN serverVersion INTEGER")
    }
}

internal val MIGRATION_2_3 = object : Migration(2, 3) {
    override fun migrate(db: SupportSQLiteDatabase) {
        db.execSQL("ALTER TABLE task_cache ADD COLUMN conflictCommandId TEXT")
        db.execSQL(
            "CREATE TABLE IF NOT EXISTS task_conflict (" +
                "commandId TEXT NOT NULL PRIMARY KEY, taskId TEXT NOT NULL, intendedAction TEXT NOT NULL, " +
                "expectedVersion INTEGER NOT NULL, serverVersion INTEGER NOT NULL, serverState TEXT NOT NULL, " +
                "serverTitle TEXT NOT NULL, serverThemeId TEXT, serverWorkState TEXT, " +
                "serverUpdatedAt TEXT NOT NULL, detectedAt TEXT NOT NULL)",
        )
    }
}

internal val MIGRATION_3_4 = object : Migration(3, 4) {
    override fun migrate(db: SupportSQLiteDatabase) {
        db.execSQL("ALTER TABLE outbox_command ADD COLUMN taskId TEXT")
        db.execSQL("ALTER TABLE outbox_command ADD COLUMN dependsOnCommandId TEXT")
    }
}

internal val MIGRATION_4_5 = object : Migration(4, 5) {
    override fun migrate(db: SupportSQLiteDatabase) {
        db.execSQL("ALTER TABLE task_conflict ADD COLUMN localTitle TEXT")
    }
}

internal val MIGRATION_5_6 = object : Migration(5, 6) {
    override fun migrate(db: SupportSQLiteDatabase) {
        db.execSQL("ALTER TABLE task_conflict ADD COLUMN serverTodayDate TEXT")
        db.execSQL("ALTER TABLE task_conflict ADD COLUMN localTodayDate TEXT")
        db.execSQL("ALTER TABLE task_conflict ADD COLUMN localTodayDateChanged INTEGER NOT NULL DEFAULT 0")
    }
}

internal val MIGRATION_6_7 = object : Migration(6, 7) {
    override fun migrate(db: SupportSQLiteDatabase) {
        db.execSQL(
            "CREATE TABLE IF NOT EXISTS theme_cache (" +
                "id TEXT NOT NULL PRIMARY KEY, title TEXT NOT NULL, catalogId INTEGER NOT NULL)",
        )
        db.execSQL(
            "CREATE TABLE IF NOT EXISTS theme_catalog_state (" +
                "id INTEGER NOT NULL PRIMARY KEY, serverId TEXT NOT NULL, serverRevision INTEGER, " +
                "status TEXT NOT NULL, generatedAt TEXT, lastAttemptAt TEXT NOT NULL, " +
                "lastError TEXT, activeRefreshId TEXT)",
        )
        db.execSQL("ALTER TABLE task_conflict ADD COLUMN localThemeId TEXT")
        db.execSQL("ALTER TABLE task_conflict ADD COLUMN localThemeIdChanged INTEGER NOT NULL DEFAULT 0")
        db.execSQL("ALTER TABLE outbox_command ADD COLUMN serverId TEXT NOT NULL DEFAULT ''")
        db.execSQL(
            "UPDATE outbox_command SET serverId = COALESCE(" +
                "(SELECT serverId FROM sync_state WHERE id = 1), '')",
        )
    }
}

internal val MIGRATION_7_8 = object : Migration(7, 8) {
    override fun migrate(db: SupportSQLiteDatabase) {
        db.execSQL("ALTER TABLE task_cache ADD COLUMN scheduleId TEXT")
        db.execSQL("ALTER TABLE task_cache ADD COLUMN scheduleVersion INTEGER")
        db.execSQL("ALTER TABLE task_cache ADD COLUMN scheduleStartDate TEXT")
        db.execSQL("ALTER TABLE task_cache ADD COLUMN scheduleEndDate TEXT")
        db.execSQL("ALTER TABLE task_cache ADD COLUMN scheduleDateKind TEXT")
        db.execSQL("ALTER TABLE task_cache ADD COLUMN scheduleRangeSemantics TEXT")
        db.execSQL("ALTER TABLE task_cache ADD COLUMN scheduleConfidence TEXT")
        db.execSQL("ALTER TABLE task_cache ADD COLUMN scheduleGranularity TEXT")
        db.execSQL("ALTER TABLE task_conflict ADD COLUMN localScheduleStartDate TEXT")
        db.execSQL("ALTER TABLE task_conflict ADD COLUMN localScheduleEndDate TEXT")
        db.execSQL("ALTER TABLE task_conflict ADD COLUMN localScheduleRangeSemantics TEXT")
        db.execSQL("ALTER TABLE task_conflict ADD COLUMN localScheduleChanged INTEGER NOT NULL DEFAULT 0")
        db.execSQL(
            "UPDATE outbox_command SET envelopeJson = " +
                "REPLACE(envelopeJson, '\"schemaVersion\":1', '\"schemaVersion\":2') " +
                "WHERE envelopeJson LIKE '%\"schemaVersion\":1%'",
        )
        db.execSQL("UPDATE sync_state SET schemaVersion = 2 WHERE apiVersion = 1 AND schemaVersion = 1")
    }
}

internal val MIGRATION_8_9 = object : Migration(8, 9) {
    override fun migrate(db: SupportSQLiteDatabase) {
        db.execSQL("ALTER TABLE task_cache ADD COLUMN plannedStartTime TEXT")
        db.execSQL("ALTER TABLE task_cache ADD COLUMN plannedDurationMinutes INTEGER")
        db.execSQL("ALTER TABLE task_conflict ADD COLUMN localPlannedStartTime TEXT")
        db.execSQL("ALTER TABLE task_conflict ADD COLUMN localPlannedDurationMinutes INTEGER")
        db.execSQL("ALTER TABLE task_conflict ADD COLUMN localPlannedScheduleChanged INTEGER NOT NULL DEFAULT 0")
    }
}

internal val MIGRATION_9_10 = object : Migration(9, 10) {
    override fun migrate(db: SupportSQLiteDatabase) {
        db.execSQL("ALTER TABLE task_cache ADD COLUMN latestReceiptId TEXT")
        db.execSQL("ALTER TABLE task_cache ADD COLUMN latestReceiptReportedAt TEXT")
        db.execSQL("ALTER TABLE task_cache ADD COLUMN latestReceiptExecutorLabel TEXT")
        db.execSQL("ALTER TABLE task_cache ADD COLUMN latestReceiptSummary TEXT")
    }
}

internal val MIGRATION_10_11 = object : Migration(10, 11) {
    override fun migrate(db: SupportSQLiteDatabase) {
        db.execSQL("ALTER TABLE task_cache ADD COLUMN checklistJson TEXT NOT NULL DEFAULT '[]'")
        db.execSQL("ALTER TABLE task_conflict ADD COLUMN localChecklistJson TEXT")
        db.execSQL("ALTER TABLE task_conflict ADD COLUMN localChecklistChanged INTEGER NOT NULL DEFAULT 0")
        db.execSQL(
            "UPDATE outbox_command SET envelopeJson = " +
                "REPLACE(envelopeJson, '\"schemaVersion\":2', '\"schemaVersion\":3') " +
                "WHERE envelopeJson LIKE '%\"schemaVersion\":2%'",
        )
        db.execSQL("UPDATE sync_state SET schemaVersion = 3 WHERE apiVersion = 1 AND schemaVersion = 2")
    }
}

internal val MIGRATION_11_12 = object : Migration(11, 12) {
    override fun migrate(db: SupportSQLiteDatabase) {
        db.execSQL(
            "CREATE TABLE IF NOT EXISTS work_receipt_cache (" +
                "id TEXT NOT NULL PRIMARY KEY, taskId TEXT NOT NULL, executorKind TEXT NOT NULL, " +
                "executorLabel TEXT NOT NULL, startedAt TEXT, reportedAt TEXT NOT NULL, " +
                "reportKind TEXT NOT NULL, summary TEXT NOT NULL, payloadJson TEXT NOT NULL, " +
                "truncated INTEGER NOT NULL, serverId TEXT NOT NULL, serverRevision INTEGER NOT NULL, " +
                "fetchedAt TEXT NOT NULL)",
        )
        db.execSQL(
            "CREATE INDEX IF NOT EXISTS index_work_receipt_cache_taskId " +
                "ON work_receipt_cache (taskId)",
        )
    }
}

internal val MIGRATION_12_13 = object : Migration(12, 13) {
    override fun migrate(db: SupportSQLiteDatabase) {
        db.execSQL(
            "CREATE TABLE IF NOT EXISTS task_work_proposal_cache (" +
                "id TEXT NOT NULL PRIMARY KEY, taskId TEXT NOT NULL, receivedAt TEXT NOT NULL, " +
                "payloadJson TEXT NOT NULL, truncated INTEGER NOT NULL, serverId TEXT NOT NULL, " +
                "serverRevision INTEGER NOT NULL, fetchedAt TEXT NOT NULL)",
        )
        db.execSQL(
            "CREATE INDEX IF NOT EXISTS index_task_work_proposal_cache_taskId " +
                "ON task_work_proposal_cache (taskId)",
        )
        db.execSQL(
            "UPDATE outbox_command SET envelopeJson = " +
                "REPLACE(envelopeJson, '\"schemaVersion\":3', '\"schemaVersion\":4') " +
                "WHERE envelopeJson LIKE '%\"schemaVersion\":3%'",
        )
        db.execSQL("UPDATE sync_state SET schemaVersion = 4 WHERE apiVersion = 1 AND schemaVersion = 3")
    }
}

internal val MIGRATION_13_14 = object : Migration(13, 14) {
    override fun migrate(db: SupportSQLiteDatabase) {
        db.execSQL("ALTER TABLE outbox_command ADD COLUMN captureId TEXT")
        db.execSQL(
            "CREATE TABLE IF NOT EXISTS capture_receipt (" +
                "id TEXT NOT NULL PRIMARY KEY, serverVersion INTEGER, capturedAt TEXT NOT NULL, " +
                "optimisticCommandId TEXT)",
        )
        db.execSQL(
            "UPDATE outbox_command SET envelopeJson = " +
                "REPLACE(envelopeJson, '\"schemaVersion\":4', '\"schemaVersion\":5') " +
                "WHERE envelopeJson LIKE '%\"schemaVersion\":4%'",
        )
        db.execSQL("UPDATE sync_state SET schemaVersion = 5 WHERE apiVersion = 1 AND schemaVersion = 4")
    }
}

internal val MIGRATION_14_15 = object : Migration(14, 15) {
    override fun migrate(db: SupportSQLiteDatabase) {
        db.execSQL(
            "CREATE TABLE IF NOT EXISTS pending_human_review (" +
                "commandId TEXT NOT NULL PRIMARY KEY, serverId TEXT NOT NULL, taskId TEXT NOT NULL, " +
                "envelopeJson TEXT NOT NULL, createdAt TEXT NOT NULL)",
        )
    }
}

fun TaskCacheEntity.toMobileTask(): MobileTask = MobileTask(
    id = id,
    version = serverVersion ?: 0,
    title = title,
    themeId = themeId,
    state = state,
    workState = workState,
    todayDate = todayDate,
    plannedStartTime = plannedStartTime,
    plannedDurationMinutes = plannedDurationMinutes,
    latestWorkReceipt = if (
        latestReceiptId != null &&
        latestReceiptReportedAt != null &&
        latestReceiptExecutorLabel != null &&
        latestReceiptSummary != null
    ) {
        MobileWorkReceiptSummary(
            id = latestReceiptId,
            reportedAt = latestReceiptReportedAt,
            executorLabel = latestReceiptExecutorLabel,
            summary = latestReceiptSummary,
        )
    } else {
        null
    },
    checklistItems = decodeMobileChecklist(checklistJson),
    schedule = toMobileTaskSchedule(),
    updatedAt = updatedAt,
    pending = optimisticCommandId != null,
)

fun TaskCacheWithConflict.toMobileTask(activeServerId: String? = null): MobileTask = task.toMobileTask().copy(
    conflict = conflict?.let {
        MobileTaskConflict(
            commandId = it.commandId,
            intendedAction = it.intendedAction,
            expectedVersion = it.expectedVersion,
            serverVersion = it.serverVersion,
            serverState = it.serverState,
            localTitle = it.localTitle,
            serverTodayDate = it.serverTodayDate,
            localTodayDate = it.localTodayDate,
            localTodayDateChanged = it.localTodayDateChanged,
            serverThemeId = it.serverThemeId,
            localThemeId = it.localThemeId,
            localThemeIdChanged = it.localThemeIdChanged,
            serverChecklistItems = decodeMobileChecklist(task.checklistJson),
            localChecklistItems = if (it.localChecklistChanged) {
                decodeMobileChecklist(requireNotNull(it.localChecklistJson))
            } else {
                emptyList()
            },
            localChecklistItemsChanged = it.localChecklistChanged,
            serverSchedule = task.toMobileTaskSchedule(),
            localSchedule = if (it.localScheduleChanged) {
                MobileTaskScheduleDraft(
                    startDate = it.localScheduleStartDate,
                    endDate = it.localScheduleEndDate,
                    rangeSemantics = it.localScheduleRangeSemantics,
                )
            } else {
                null
            },
            localScheduleChanged = it.localScheduleChanged,
            serverPlannedStartTime = task.plannedStartTime,
            serverPlannedDurationMinutes = task.plannedDurationMinutes,
            localPlannedStartTime = if (it.localPlannedScheduleChanged) it.localPlannedStartTime else null,
            localPlannedDurationMinutes = if (it.localPlannedScheduleChanged) it.localPlannedDurationMinutes else null,
            localPlannedScheduleChanged = it.localPlannedScheduleChanged,
            detectedAt = it.detectedAt,
        )
    },
    canChangePendingState = optimisticCommand?.let {
        it.state == OutboxState.Pending &&
            it.attemptCount == 0 &&
            it.commandName in setOf("CreateTask", "CompleteTask", "ReopenTask")
    } == true,
    canEditPendingChecklist = optimisticCommand?.isUnsentChecklistUpdate() == true,
    rejectedThemeUpdate = relatedCommands
        .filter { it.serverId == activeServerId }
        .mapNotNull(OutboxCommandEntity::toRejectedThemeUpdateOrNull)
        .maxByOrNull { it.rejectedAt },
)

fun TaskCacheEntity.toMobileTaskSchedule(): MobileTaskSchedule? {
    if (scheduleId == null && scheduleDateKind == null) return null
    return MobileTaskSchedule(
        id = scheduleId,
        version = scheduleVersion,
        startDate = scheduleStartDate,
        endDate = scheduleEndDate,
        dateKind = scheduleDateKind ?: deriveScheduleDateKind(scheduleStartDate, scheduleEndDate),
        rangeSemantics = scheduleRangeSemantics,
        confidence = scheduleConfidence ?: "fixed",
        granularity = scheduleGranularity ?: "day",
    )
}

internal fun deriveScheduleDateKind(startDate: String?, endDate: String?): String = when {
    startDate == null && endDate == null -> "unknown"
    startDate == null -> "deadline"
    endDate == null || startDate == endDate -> "point"
    else -> "range"
}
