package jp.personal.tasken.companion

import android.content.Context
import androidx.work.BackoffPolicy
import androidx.work.Constraints
import androidx.work.CoroutineWorker
import androidx.work.ExistingWorkPolicy
import androidx.work.NetworkType
import androidx.work.OneTimeWorkRequestBuilder
import androidx.work.WorkManager
import androidx.work.WorkerParameters
import java.time.Duration
import java.time.Instant
import java.time.LocalDate
import java.util.UUID
import kotlinx.coroutines.flow.Flow

sealed interface MobileCommandSendResult {
    data class Applied(val response: MobileCreateTaskResponseDto) : MobileCommandSendResult
    data class Retry(val reason: String) : MobileCommandSendResult
    data class Rejected(val reason: String) : MobileCommandSendResult
}

class MobileOutbox(
    private val context: Context,
    private val dao: MobileLocalDao,
    private val deviceId: () -> String,
    private val now: () -> Instant = Instant::now,
    private val schedule: () -> Unit = { MobileOutboxScheduler.enqueue(context) },
) {
    fun observeTasks(date: LocalDate = LocalDate.now()): Flow<List<TaskCacheEntity>> =
        dao.observeTasks(date.toString())

    fun observePendingCount(): Flow<Int> = dao.observePendingCount()

    suspend fun enqueueCreate(title: String, todayDate: LocalDate? = LocalDate.now()): String {
        val normalizedTitle = title.trim()
        require(normalizedTitle.isNotEmpty() && normalizedTitle.length <= 500)
        val taskId = UUID.randomUUID().toString()
        val commandId = UUID.randomUUID().toString()
        val requestId = UUID.randomUUID().toString()
        val issuedAt = now().toString()
        val envelope = MobileCreateTaskEnvelopeDto(
            apiVersion = 1,
            schemaVersion = 1,
            requestId = requestId,
            commandId = commandId,
            idempotencyKey = commandId,
            clientDeviceId = deviceId(),
            issuedAt = issuedAt,
            command = MobileCreateTaskCommandDto(
                name = "CreateTask",
                task = MobileCreateTaskCandidateDto(
                    id = taskId,
                    title = normalizedTitle,
                    todayDate = todayDate?.toString(),
                ),
            ),
        )
        dao.enqueueCreate(
            task = TaskCacheEntity(
                id = taskId,
                title = normalizedTitle,
                themeId = null,
                state = "todo",
                workState = null,
                todayDate = todayDate?.toString(),
                updatedAt = issuedAt,
                optimisticCommandId = commandId,
            ),
            command = OutboxCommandEntity(
                commandId = commandId,
                idempotencyKey = commandId,
                requestId = requestId,
                clientDeviceId = envelope.clientDeviceId,
                issuedAt = issuedAt,
                commandName = "CreateTask",
                envelopeJson = MobileCreateTaskContract.encode(envelope),
                state = OutboxState.Pending,
                attemptCount = 0,
                createdAt = issuedAt,
                lastAttemptAt = null,
                lastError = null,
            ),
        )
        schedule()
        return taskId
    }

    suspend fun recoverInterruptedSending(): Int =
        dao.recoverInterruptedSending("送信中にAndroidプロセスが終了したため再送します。")

    suspend fun drain(sender: (String) -> MobileCommandSendResult): Boolean {
        var shouldRetry = false
        while (true) {
            val attemptedAt = now().toString()
            val command = dao.claimNext(attemptedAt) ?: return shouldRetry
            when (val result = sender(command.envelopeJson)) {
                is MobileCommandSendResult.Applied -> {
                    val response = result.response
                    if (response.data.commandId != command.commandId) {
                        dao.markRejected(command.commandId, "GatewayのcommandIdが送信内容と一致しません。")
                        continue
                    }
                    val task = response.data.task
                    dao.applyCreateReceipt(
                        commandId = command.commandId,
                        canonicalTask = TaskCacheEntity(
                            id = task.id,
                            title = task.title,
                            themeId = task.themeId,
                            state = task.state,
                            workState = task.workState,
                            todayDate = MobileCreateTaskContract.decodeEnvelope(command.envelopeJson).command.task.todayDate,
                            updatedAt = task.updatedAt,
                            optimisticCommandId = null,
                        ),
                        syncState = SyncStateEntity(
                            serverId = response.meta.serverId,
                            apiVersion = response.meta.apiVersion,
                            schemaVersion = response.meta.schemaVersion,
                            cursor = null,
                            lastSuccessfulSyncAt = response.meta.generatedAt,
                            lastAttemptAt = attemptedAt,
                            lastError = null,
                        ),
                    )
                }
                is MobileCommandSendResult.Retry -> {
                    dao.markRetry(command.commandId, result.reason)
                    shouldRetry = true
                    return shouldRetry
                }
                is MobileCommandSendResult.Rejected -> dao.markRejected(command.commandId, result.reason)
            }
        }
    }
}

object MobileOutboxScheduler {
    private const val UniqueWorkName = "tasken-mobile-outbox"

    fun enqueue(context: Context) {
        val request = OneTimeWorkRequestBuilder<MobileOutboxWorker>()
            .setConstraints(Constraints.Builder().setRequiredNetworkType(NetworkType.CONNECTED).build())
            .setBackoffCriteria(BackoffPolicy.EXPONENTIAL, Duration.ofSeconds(10))
            .build()
        WorkManager.getInstance(context.applicationContext).enqueueUniqueWork(
            UniqueWorkName,
            ExistingWorkPolicy.KEEP,
            request,
        )
    }
}

class MobileOutboxWorker(
    appContext: Context,
    params: WorkerParameters,
) : CoroutineWorker(appContext, params) {
    override suspend fun doWork(): Result {
        val repository = AndroidMobileTaskRepository(applicationContext, scheduleOutboxOnStart = false)
        repository.recoverInterruptedOutbox()
        return if (repository.drainOutbox()) Result.retry() else Result.success()
    }
}
