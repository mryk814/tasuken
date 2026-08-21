package jp.personal.tasken.companion

import android.content.Context
import androidx.room.Dao
import androidx.room.Database
import androidx.room.Embedded
import androidx.room.Entity
import androidx.room.Insert
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
)

@Entity(tableName = "outbox_command")
data class OutboxCommandEntity(
    @PrimaryKey val commandId: String,
    val idempotencyKey: String,
    val requestId: String,
    val clientDeviceId: String,
    val issuedAt: String,
    val commandName: String,
    val envelopeJson: String,
    val state: String,
    val attemptCount: Int,
    val createdAt: String,
    val lastAttemptAt: String?,
    val lastError: String?,
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
    val serverThemeId: String?,
    val serverWorkState: String?,
    val serverUpdatedAt: String,
    val detectedAt: String,
)

data class TaskCacheWithConflict(
    @Embedded val task: TaskCacheEntity,
    @Relation(parentColumn = "conflictCommandId", entityColumn = "commandId")
    val conflict: TaskConflictEntity?,
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

    @Query("SELECT * FROM task_cache WHERE todayDate = :date ORDER BY updatedAt DESC, id ASC")
    abstract suspend fun tasksForDate(date: String): List<TaskCacheEntity>

    @Query("SELECT * FROM task_cache ORDER BY updatedAt DESC, id ASC")
    abstract suspend fun tasks(): List<TaskCacheEntity>

    @Query("SELECT * FROM task_cache WHERE id = :taskId")
    abstract suspend fun task(taskId: String): TaskCacheEntity?

    @Query("SELECT * FROM outbox_command WHERE commandId = :commandId")
    abstract suspend fun outbox(commandId: String): OutboxCommandEntity?

    @Query("SELECT COUNT(*) FROM outbox_command")
    abstract suspend fun outboxCount(): Int

    @Query("SELECT COUNT(*) FROM outbox_command WHERE state IN ('pending', 'sending', 'retry_wait')")
    abstract fun observePendingCount(): Flow<Int>

    @Query("SELECT COUNT(*) FROM task_conflict")
    abstract fun observeConflictCount(): Flow<Int>

    @Query("SELECT * FROM task_conflict WHERE commandId = :commandId")
    abstract suspend fun conflict(commandId: String): TaskConflictEntity?

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    abstract suspend fun upsertTask(task: TaskCacheEntity)

    @Insert(onConflict = OnConflictStrategy.ABORT)
    abstract suspend fun insertOutbox(command: OutboxCommandEntity)

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    abstract suspend fun upsertSyncState(state: SyncStateEntity)

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    abstract suspend fun upsertConflict(conflict: TaskConflictEntity)

    @Query("DELETE FROM task_cache WHERE todayDate = :date AND optimisticCommandId IS NULL")
    abstract suspend fun deleteCanonicalToday(date: String)

    @Query(
        "SELECT * FROM outbox_command " +
            "WHERE state IN ('pending', 'retry_wait') " +
            "ORDER BY createdAt ASC, commandId ASC LIMIT 1",
    )
    abstract suspend fun nextSendable(): OutboxCommandEntity?

    @Query(
        "UPDATE outbox_command SET state = 'sending', attemptCount = attemptCount + 1, " +
            "lastAttemptAt = :attemptedAt, lastError = NULL " +
            "WHERE commandId = :commandId AND state IN ('pending', 'retry_wait')",
    )
    abstract suspend fun markSending(commandId: String, attemptedAt: String): Int

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

    @Query("DELETE FROM task_conflict WHERE commandId = :commandId")
    abstract suspend fun deleteConflict(commandId: String)

    @Query("UPDATE task_cache SET conflictCommandId = NULL WHERE conflictCommandId = :commandId")
    abstract suspend fun clearTaskConflict(commandId: String)

    @Transaction
    open suspend fun enqueueCreate(task: TaskCacheEntity, command: OutboxCommandEntity) {
        require(task.optimisticCommandId == command.commandId)
        require(command.commandId == command.idempotencyKey)
        upsertTask(task)
        insertOutbox(command)
    }

    @Transaction
    open suspend fun enqueueStateAction(task: TaskCacheEntity, command: OutboxCommandEntity) {
        require(task.optimisticCommandId == command.commandId)
        require(task.serverVersion != null)
        require(command.commandName in setOf("CompleteTask", "ReopenTask"))
        upsertTask(task)
        insertOutbox(command)
    }

    @Transaction
    open suspend fun replaceToday(date: String, tasks: List<TaskCacheEntity>, syncState: SyncStateEntity) {
        deleteCanonicalToday(date)
        tasks.forEach { upsertTask(it) }
        upsertSyncState(syncState)
    }

    @Transaction
    open suspend fun applyCommandReceipt(commandId: String, canonicalTask: TaskCacheEntity, syncState: SyncStateEntity) {
        upsertTask(canonicalTask.copy(optimisticCommandId = null, conflictCommandId = null))
        upsertSyncState(syncState)
        deleteConflict(commandId)
        deleteOutbox(commandId)
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
        upsertTask(canonicalTask.copy(optimisticCommandId = null, conflictCommandId = commandId))
        upsertConflict(conflict)
        upsertSyncState(syncState)
        markConflict(commandId, reason)
    }

    @Transaction
    open suspend fun acceptServer(commandId: String) {
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
        clearTaskConflict(oldCommandId)
        deleteConflict(oldCommandId)
        deleteOutbox(oldCommandId)
        upsertTask(task.copy(conflictCommandId = null))
        insertOutbox(command)
    }

    @Transaction
    open suspend fun claimNext(attemptedAt: String): OutboxCommandEntity? {
        val command = nextSendable() ?: return null
        return if (markSending(command.commandId, attemptedAt) == 1) {
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
    entities = [TaskCacheEntity::class, OutboxCommandEntity::class, SyncStateEntity::class, TaskConflictEntity::class],
    version = 3,
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
            ).addMigrations(MIGRATION_1_2, MIGRATION_2_3).build().also { instance = it }
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

fun TaskCacheWithConflict.toMobileTask(): MobileTask = MobileTask(
    id = task.id,
    title = task.title,
    themeId = task.themeId,
    state = task.state,
    workState = task.workState,
    updatedAt = task.updatedAt,
    pending = task.optimisticCommandId != null,
    conflict = conflict?.let {
        MobileTaskConflict(
            commandId = it.commandId,
            intendedAction = it.intendedAction,
            expectedVersion = it.expectedVersion,
            serverVersion = it.serverVersion,
            serverState = it.serverState,
            detectedAt = it.detectedAt,
        )
    },
)
