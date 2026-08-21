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
    data class Applied(val response: MobileTaskCommandResponseDto) : MobileCommandSendResult
    data class Conflict(val response: MobileTaskCommandErrorResponseDto) : MobileCommandSendResult
    data class Retry(val reason: String) : MobileCommandSendResult
    data class Rejected(val reason: String) : MobileCommandSendResult
}

data class MobileStateActionResult(
    val commandId: String?,
    val requiresSync: Boolean,
)

class MobileOutbox(
    private val context: Context,
    private val dao: MobileLocalDao,
    private val deviceId: () -> String,
    private val now: () -> Instant = Instant::now,
    private val schedule: () -> Unit = { MobileOutboxScheduler.enqueue(context) },
) {
    fun observeTasks(date: LocalDate = LocalDate.now()): Flow<List<TaskCacheWithConflict>> =
        dao.observeTasks(date.toString())

    fun observePendingCount(): Flow<Int> = dao.observePendingCount()

    fun observeConflictCount(): Flow<Int> = dao.observeConflictCount()

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
                serverVersion = null,
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
                envelopeJson = MobileTaskCommandContract.encode(envelope),
                state = OutboxState.Pending,
                attemptCount = 0,
                createdAt = issuedAt,
                lastAttemptAt = null,
                lastError = null,
                taskId = taskId,
            ),
        )
        schedule()
        return taskId
    }

    suspend fun enqueueComplete(taskId: String): MobileStateActionResult = enqueueState(taskId, "CompleteTask", "done")

    suspend fun enqueueReopen(taskId: String): MobileStateActionResult = enqueueState(taskId, "ReopenTask", "todo")

    suspend fun enqueueUpdateTitle(taskId: String, title: String): String {
        val normalized = title.trim()
        require(normalized.isNotEmpty() && normalized.length <= 500)
        val task = requireNotNull(dao.task(taskId)) { "Taskがcacheにありません。再読み込みしてください。" }
        require(task.optimisticCommandId == null && task.conflictCommandId == null) { "Taskの同期を解決してから編集してください。" }
        val expectedVersion = requireNotNull(task.serverVersion) { "Task作成の同期完了を待って編集してください。" }
        require(task.title != normalized)
        val commandId = UUID.randomUUID().toString()
        val requestId = UUID.randomUUID().toString()
        val issuedAt = now().toString()
        val envelope = MobileTaskUpdateEnvelopeDto(
            apiVersion = 1,
            schemaVersion = 1,
            requestId = requestId,
            commandId = commandId,
            idempotencyKey = commandId,
            clientDeviceId = deviceId(),
            issuedAt = issuedAt,
            command = MobileTaskUpdateCommandDto(
                name = "UpdateTask",
                taskId = taskId,
                expectedVersion = expectedVersion,
                changes = MobileTaskTitlePatchDto(normalized),
                base = MobileTaskTitlePatchDto(task.title),
            ),
        )
        dao.enqueueStateAction(
            task = task.copy(title = normalized, updatedAt = issuedAt, optimisticCommandId = commandId),
            command = OutboxCommandEntity(
                commandId = commandId,
                idempotencyKey = commandId,
                requestId = requestId,
                clientDeviceId = envelope.clientDeviceId,
                issuedAt = issuedAt,
                commandName = "UpdateTask",
                envelopeJson = MobileTaskCommandContract.encode(envelope),
                state = OutboxState.Pending,
                attemptCount = 0,
                createdAt = issuedAt,
                lastAttemptAt = null,
                lastError = null,
                taskId = taskId,
            ),
        )
        schedule()
        return commandId
    }

    suspend fun acceptServer(commandId: String) {
        val conflict = requireNotNull(dao.conflict(commandId)) { "競合情報が見つかりません。再読み込みしてください。" }
        require(dao.task(conflict.taskId)?.conflictCommandId == commandId)
        dao.acceptServer(commandId)
    }

    suspend fun keepLocal(commandId: String): String {
        val conflict = requireNotNull(dao.conflict(commandId)) { "競合情報が見つかりません。再読み込みしてください。" }
        val task = requireNotNull(dao.task(conflict.taskId)) { "Taskがcacheにありません。再読み込みしてください。" }
        require(task.conflictCommandId == commandId)
        val replacementId = UUID.randomUUID().toString()
        val requestId = UUID.randomUUID().toString()
        val issuedAt = now().toString()
        val clientDeviceId = deviceId()
        val isUpdate = conflict.intendedAction == "UpdateTask"
        val envelopeJson = if (isUpdate) {
            MobileTaskCommandContract.encode(
                MobileTaskUpdateEnvelopeDto(
                    apiVersion = 1,
                    schemaVersion = 1,
                    requestId = requestId,
                    commandId = replacementId,
                    idempotencyKey = replacementId,
                    clientDeviceId = clientDeviceId,
                    issuedAt = issuedAt,
                    command = MobileTaskUpdateCommandDto(
                        name = "UpdateTask",
                        taskId = conflict.taskId,
                        expectedVersion = conflict.serverVersion,
                        changes = MobileTaskTitlePatchDto(requireNotNull(conflict.localTitle)),
                        base = MobileTaskTitlePatchDto(conflict.serverTitle),
                    ),
                ),
            )
        } else {
            MobileTaskCommandContract.encode(
                MobileTaskStateEnvelopeDto(
                    apiVersion = 1,
                    schemaVersion = 1,
                    requestId = requestId,
                    commandId = replacementId,
                    idempotencyKey = replacementId,
                    clientDeviceId = clientDeviceId,
                    issuedAt = issuedAt,
                    command = MobileTaskStateCommandDto(
                        name = conflict.intendedAction,
                        taskId = conflict.taskId,
                        expectedVersion = conflict.serverVersion,
                    ),
                ),
            )
        }
        val optimisticState = when (conflict.intendedAction) {
            "CompleteTask" -> "done"
            "ReopenTask" -> "todo"
            else -> task.state
        }
        dao.replaceConflictWithCommand(
            oldCommandId = commandId,
            task = task.copy(
                serverVersion = conflict.serverVersion,
                title = conflict.localTitle ?: task.title,
                state = optimisticState,
                updatedAt = issuedAt,
                optimisticCommandId = replacementId,
                conflictCommandId = null,
            ),
            command = OutboxCommandEntity(
                commandId = replacementId,
                idempotencyKey = replacementId,
                requestId = requestId,
                clientDeviceId = clientDeviceId,
                issuedAt = issuedAt,
                commandName = conflict.intendedAction,
                envelopeJson = envelopeJson,
                state = OutboxState.Pending,
                attemptCount = 0,
                createdAt = issuedAt,
                lastAttemptAt = null,
                lastError = null,
                taskId = conflict.taskId,
            ),
        )
        schedule()
        return replacementId
    }

    private suspend fun enqueueState(
        taskId: String,
        commandName: String,
        optimisticState: String,
    ): MobileStateActionResult {
        require(commandName in setOf("CompleteTask", "ReopenTask"))
        val task = requireNotNull(dao.task(taskId)) { "Taskがcacheにありません。再読み込みしてください。" }
        val pending = task.optimisticCommandId?.let { dao.outbox(it) }
        if (pending != null && pending.commandName in setOf("CompleteTask", "ReopenTask")) {
            require(pending.state == OutboxState.Pending && pending.attemptCount == 0) {
                "送信結果を確認してから再試行してください。"
            }
            if (pending.commandName == commandName) {
                return MobileStateActionResult(pending.commandId, requiresSync = true)
            }
            dao.cancelUnsentStateAction(
                commandId = pending.commandId,
                task = task.copy(
                    state = optimisticState,
                    updatedAt = now().toString(),
                    optimisticCommandId = pending.dependsOnCommandId,
                ),
            )
            return MobileStateActionResult(pending.dependsOnCommandId, requiresSync = pending.dependsOnCommandId != null)
        }
        require(pending == null || pending.commandName == "CreateTask") { "Taskの同期完了を待って再試行してください。" }
        if (pending != null) {
            require(pending.state == OutboxState.Pending && pending.attemptCount == 0) {
                "Task作成の送信結果を確認してから再試行してください。"
            }
        }
        val expectedVersion = task.serverVersion ?: 1
        val commandId = UUID.randomUUID().toString()
        val requestId = UUID.randomUUID().toString()
        val issuedAt = now().toString()
        val envelope = MobileTaskStateEnvelopeDto(
            apiVersion = 1,
            schemaVersion = 1,
            requestId = requestId,
            commandId = commandId,
            idempotencyKey = commandId,
            clientDeviceId = deviceId(),
            issuedAt = issuedAt,
            command = MobileTaskStateCommandDto(
                name = commandName,
                taskId = taskId,
                expectedVersion = expectedVersion,
            ),
        )
        val command = OutboxCommandEntity(
            commandId = commandId,
            idempotencyKey = commandId,
            requestId = requestId,
            clientDeviceId = envelope.clientDeviceId,
            issuedAt = issuedAt,
            commandName = commandName,
            envelopeJson = MobileTaskCommandContract.encode(envelope),
            state = OutboxState.Pending,
            attemptCount = 0,
            createdAt = issuedAt,
            lastAttemptAt = null,
            lastError = null,
            taskId = taskId,
            dependsOnCommandId = pending?.commandId,
        )
        val optimisticTask = task.copy(
            state = optimisticState,
            updatedAt = issuedAt,
            optimisticCommandId = commandId,
        )
        if (pending == null) dao.enqueueStateAction(
            task = optimisticTask,
            command = command,
        ) else dao.enqueueDependentStateAction(
            task = optimisticTask,
            command = command,
        )
        schedule()
        return MobileStateActionResult(commandId, requiresSync = true)
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
                    val cached = dao.task(task.id)
                    val dependents = dao.dependents(command.commandId)
                    require(dependents.size <= 1)
                    val dependent = dependents.singleOrNull()
                    val dependentEnvelope = dependent?.let {
                        val stored = MobileTaskCommandContract.decodeStateEnvelope(it.envelopeJson)
                        MobileTaskCommandContract.encode(
                            stored.copy(command = stored.command.copy(expectedVersion = task.version)),
                        )
                    }
                    dao.applyCommandReceipt(
                        commandId = command.commandId,
                        canonicalTask = TaskCacheEntity(
                            id = task.id,
                            serverVersion = task.version,
                            title = task.title,
                            themeId = task.themeId,
                            state = task.state,
                            workState = task.workState,
                            todayDate = cached?.todayDate,
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
                        dependentCommandId = dependent?.commandId,
                        dependentEnvelopeJson = dependentEnvelope,
                        optimisticState = dependent?.let { if (it.commandName == "CompleteTask") "done" else "todo" },
                    )
                }
                is MobileCommandSendResult.Conflict -> {
                    val response = result.response
                    val conflict = requireNotNull(response.error.conflict)
                    val current = conflict.currentTask
                    val cached = dao.task(current.id)
                    require(command.commandName == conflict.intendedAction)
                    val localTitle = if (command.commandName == "UpdateTask") {
                        val envelope = MobileTaskCommandContract.decodeUpdateEnvelope(command.envelopeJson)
                        require(envelope.command.taskId == current.id)
                        require(envelope.command.expectedVersion == conflict.expectedVersion)
                        envelope.command.changes.title
                    } else {
                        val envelope = MobileTaskCommandContract.decodeStateEnvelope(command.envelopeJson)
                        require(envelope.command.taskId == current.id)
                        require(envelope.command.expectedVersion == conflict.expectedVersion)
                        null
                    }
                    dao.recordConflict(
                        commandId = command.commandId,
                        canonicalTask = TaskCacheEntity(
                            id = current.id,
                            serverVersion = current.version,
                            title = current.title,
                            themeId = current.themeId,
                            state = current.state,
                            workState = current.workState,
                            todayDate = cached?.todayDate,
                            updatedAt = current.updatedAt,
                            optimisticCommandId = null,
                            conflictCommandId = command.commandId,
                        ),
                        conflict = TaskConflictEntity(
                            commandId = command.commandId,
                            taskId = current.id,
                            intendedAction = conflict.intendedAction,
                            expectedVersion = conflict.expectedVersion,
                            serverVersion = current.version,
                            serverState = current.state,
                            serverTitle = current.title,
                            localTitle = localTitle,
                            serverThemeId = current.themeId,
                            serverWorkState = current.workState,
                            serverUpdatedAt = current.updatedAt,
                            detectedAt = response.meta.generatedAt,
                        ),
                        syncState = SyncStateEntity(
                            serverId = response.meta.serverId,
                            apiVersion = response.meta.apiVersion,
                            schemaVersion = response.meta.schemaVersion,
                            cursor = null,
                            lastSuccessfulSyncAt = response.meta.generatedAt,
                            lastAttemptAt = attemptedAt,
                            lastError = response.error.message,
                        ),
                        reason = response.error.message,
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
