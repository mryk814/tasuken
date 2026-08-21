package jp.personal.tasken.companion

import android.content.Context
import androidx.room.Dao
import androidx.room.Database
import androidx.room.Entity
import androidx.room.Insert
import androidx.room.OnConflictStrategy
import androidx.room.PrimaryKey
import androidx.room.Query
import androidx.room.Room
import androidx.room.RoomDatabase
import androidx.room.Transaction
import kotlinx.coroutines.flow.Flow

@Entity(tableName = "task_cache")
data class TaskCacheEntity(
    @PrimaryKey val id: String,
    val title: String,
    val themeId: String?,
    val state: String,
    val workState: String?,
    val todayDate: String?,
    val updatedAt: String,
    val optimisticCommandId: String?,
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

object OutboxState {
    const val Pending = "pending"
    const val Sending = "sending"
    const val Rejected = "rejected"
    const val RetryWait = "retry_wait"
}

@Dao
abstract class MobileLocalDao {
    @Query("SELECT * FROM task_cache WHERE todayDate = :date ORDER BY updatedAt DESC, id ASC")
    abstract fun observeTasks(date: String): Flow<List<TaskCacheEntity>>

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

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    abstract suspend fun upsertTask(task: TaskCacheEntity)

    @Insert(onConflict = OnConflictStrategy.ABORT)
    abstract suspend fun insertOutbox(command: OutboxCommandEntity)

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    abstract suspend fun upsertSyncState(state: SyncStateEntity)

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

    @Query("DELETE FROM outbox_command WHERE commandId = :commandId")
    abstract suspend fun deleteOutbox(commandId: String)

    @Transaction
    open suspend fun enqueueCreate(task: TaskCacheEntity, command: OutboxCommandEntity) {
        require(task.optimisticCommandId == command.commandId)
        require(command.commandId == command.idempotencyKey)
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
    open suspend fun applyCreateReceipt(commandId: String, canonicalTask: TaskCacheEntity, syncState: SyncStateEntity) {
        upsertTask(canonicalTask.copy(optimisticCommandId = null))
        upsertSyncState(syncState)
        deleteOutbox(commandId)
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
    entities = [TaskCacheEntity::class, OutboxCommandEntity::class, SyncStateEntity::class],
    version = 1,
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
            ).build().also { instance = it }
        }
    }
}

fun TaskCacheEntity.toMobileTask(): MobileTask = MobileTask(
    id = id,
    title = title,
    themeId = themeId,
    state = state,
    workState = workState,
    updatedAt = updatedAt,
    pending = optimisticCommandId != null,
)
