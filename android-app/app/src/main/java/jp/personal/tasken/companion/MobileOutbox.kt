package jp.personal.tasken.companion

import android.content.Context
import android.util.Log
import androidx.work.BackoffPolicy
import androidx.work.Constraints
import androidx.work.CoroutineWorker
import androidx.work.ExistingWorkPolicy
import androidx.work.ExistingPeriodicWorkPolicy
import androidx.work.NetworkType
import androidx.work.OneTimeWorkRequestBuilder
import androidx.work.PeriodicWorkRequestBuilder
import androidx.work.WorkManager
import androidx.work.WorkerParameters
import java.time.Duration
import java.time.Instant
import java.time.LocalDate
import java.time.OffsetDateTime
import java.nio.charset.StandardCharsets
import java.util.UUID
import java.util.concurrent.TimeUnit
import kotlinx.coroutines.flow.Flow
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonArray
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive

private fun titlePatch(title: String): JsonObject = buildJsonObject { put("title", JsonPrimitive(title)) }

private fun todayDatePatch(todayDate: String?): JsonObject = buildJsonObject {
    put("todayDate", todayDate?.let(::JsonPrimitive) ?: JsonNull)
}

private fun themeIdPatch(themeId: String?): JsonObject = buildJsonObject {
    put("themeId", themeId?.let(::JsonPrimitive) ?: JsonNull)
}

private fun checklistValue(items: List<MobileChecklistItem>) = buildJsonArray {
    items.forEach { item ->
        add(
            buildJsonObject {
                put("id", JsonPrimitive(item.id))
                put("title", JsonPrimitive(item.title))
                put("done", JsonPrimitive(item.done))
                put("sortOrder", JsonPrimitive(item.sortOrder))
                put("completedAt", item.completedAt?.let(::JsonPrimitive) ?: JsonNull)
            },
        )
    }
}

private fun checklistPatch(items: List<MobileChecklistItem>): JsonObject = buildJsonObject {
    put("checklistItems", checklistValue(items))
}

private fun checklistItems(value: Any?): List<MobileChecklistItem> {
    require(value is kotlinx.serialization.json.JsonArray)
    return value.map { element ->
        require(element is JsonObject)
        MobileChecklistItem(
            id = element.getValue("id").jsonPrimitive.content,
            title = element.getValue("title").jsonPrimitive.content,
            done = element.getValue("done").jsonPrimitive.content.toBooleanStrict(),
            sortOrder = element.getValue("sortOrder").jsonPrimitive.content.toDouble(),
            completedAt = element.getValue("completedAt").let {
                if (it == JsonNull) null else it.jsonPrimitive.content
            },
        )
    }
}

private data class LeftoverPlannedScheduleDraft(
    val startTime: String?,
    val durationMinutes: Int?,
)

private fun scheduleValue(schedule: MobileTaskScheduleDraft): JsonObject = buildJsonObject {
    put("startDate", schedule.startDate?.let(::JsonPrimitive) ?: JsonNull)
    put("endDate", schedule.endDate?.let(::JsonPrimitive) ?: JsonNull)
    put("rangeSemantics", schedule.rangeSemantics?.let(::JsonPrimitive) ?: JsonNull)
}

private fun schedulePatch(schedule: MobileTaskScheduleDraft?): JsonObject = buildJsonObject {
    put("schedule", schedule?.let(::scheduleValue) ?: JsonNull)
}

private fun TaskCacheEntity.scheduleDraftOrNull(): MobileTaskScheduleDraft? {
    if (scheduleId == null && scheduleDateKind == null) return null
    return MobileTaskScheduleDraft(scheduleStartDate, scheduleEndDate, scheduleRangeSemantics)
}

private fun TaskCacheEntity.withOptimisticSchedule(
    schedule: MobileTaskScheduleDraft,
    commandId: String,
    updatedAt: String,
): TaskCacheEntity = copy(
    scheduleStartDate = schedule.startDate,
    scheduleEndDate = schedule.endDate,
    scheduleDateKind = deriveScheduleDateKind(schedule.startDate, schedule.endDate),
    scheduleRangeSemantics = schedule.rangeSemantics,
    scheduleConfidence = scheduleConfidence ?: "fixed",
    scheduleGranularity = scheduleGranularity ?: "day",
    updatedAt = updatedAt,
    optimisticCommandId = commandId,
)

private fun structuredCommandError(code: String, message: String, retryable: Boolean): String =
    buildJsonObject {
        put("code", JsonPrimitive(code.trim()))
        put("message", JsonPrimitive(message.trim()))
        put("retryable", JsonPrimitive(retryable))
    }.toString()

internal fun OutboxCommandEntity.toRejectedThemeUpdateOrNull(): MobileRejectedThemeUpdate? {
    if (state != OutboxState.Rejected || commandName != "UpdateTask") return null
    val envelope = runCatching { MobileTaskCommandContract.decodeUpdateEnvelope(envelopeJson) }.getOrNull()
        ?: return null
    if (envelope.command.taskId != taskId || envelope.command.changes.keys != setOf("themeId")) return null
    val attemptedThemeId = envelope.command.changes.getValue("themeId").let {
        if (it == JsonNull) null else it.jsonPrimitive.content
    }
    val error = runCatching { Json.parseToJsonElement(requireNotNull(lastError)).jsonObject }.getOrNull()
    val code = (error?.get("code") as? JsonPrimitive)?.content?.takeIf(String::isNotBlank)
    val message = (error?.get("message") as? JsonPrimitive)?.content?.takeIf(String::isNotBlank)
    return MobileRejectedThemeUpdate(
        commandId = commandId,
        attemptedThemeId = attemptedThemeId,
        code = code ?: "command_rejected",
        message = message ?: "DesktopがTheme変更を受理しませんでした。",
        rejectedAt = lastAttemptAt ?: createdAt,
    )
}

internal fun OutboxCommandEntity.isUnsentChecklistUpdate(): Boolean {
    if (state != OutboxState.Pending || attemptCount != 0 || commandName != "UpdateTask") return false
    val envelope = runCatching { MobileTaskCommandContract.decodeUpdateEnvelope(envelopeJson) }.getOrNull()
        ?: return false
    return envelope.command.taskId == taskId && envelope.command.changes.keys == setOf("checklistItems")
}

sealed interface MobileCommandSendResult {
    data class Applied(val response: MobileTaskCommandResponseDto) : MobileCommandSendResult
    data class Conflict(val response: MobileTaskCommandErrorResponseDto) : MobileCommandSendResult
    data class Retry(val reason: String) : MobileCommandSendResult
    data class Rejected(
        val code: String,
        val message: String,
        val retryable: Boolean = false,
    ) : MobileCommandSendResult {
        init {
            require(code.isNotBlank() && message.isNotBlank())
        }
    }
}

data class MobileStateActionResult(
    val commandId: String?,
    val requiresSync: Boolean,
)

data class MobileUndoCreateResult(
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
    private suspend fun currentServerId(): String = requireNotNull(dao.syncState()?.serverId)
        .also { require(it.isNotBlank()) { "Desktopとの同期を完了してから変更してください。" } }

    fun observeTasks(date: LocalDate = LocalDate.now()): Flow<List<TaskCacheWithConflict>> =
        dao.observeTasks(date.toString())

    fun observeAllTasks(): Flow<List<TaskCacheWithConflict>> = dao.observeAllTasks()

    fun observePendingCount(): Flow<Int> = dao.observePendingCount()

    fun observeConflictCount(): Flow<Int> = dao.observeConflictCount()

    suspend fun enqueueCreate(
        title: String,
        todayDate: LocalDate? = LocalDate.now(),
        projectId: String? = null,
        draftId: String = UUID.randomUUID().toString(),
        createdAt: String = now().toString(),
        provenance: MobileTaskCreationProvenanceDto = MobileTaskCreationProvenanceDto(
            reportedVia = MobileCaptureSource.AndroidApp.wireValue,
            capturedAt = createdAt,
        ),
    ): String {
        val normalizedTitle = title.trim()
        require(normalizedTitle.isNotEmpty() && normalizedTitle.length <= 500)
        require(projectId == null || projectId.isNotBlank())
        require(draftId.isNotBlank())
        val taskId = stableDraftId("task", draftId)
        val commandId = stableDraftId("command", draftId)
        val requestId = stableDraftId("request", draftId)
        val issuedAt = createdAt
        val serverId = currentServerId()
        dao.outbox(commandId)?.let { existing ->
            val existingEnvelope = MobileTaskCommandContract.decodeCreateEnvelope(existing.envelopeJson)
            require(
                existing.serverId == serverId &&
                    existing.taskId == taskId &&
                    existingEnvelope.command.task.id == taskId &&
                    existingEnvelope.command.task.title == normalizedTitle &&
                    existingEnvelope.command.task.projectId == projectId &&
                    existingEnvelope.command.task.todayDate == todayDate?.toString() &&
                    existingEnvelope.command.provenance == provenance,
            ) { "同じDraft IDが別のTask作成に使われています。" }
            return taskId
        }
        dao.task(taskId)?.let { existing ->
            if (existing.serverVersion != null) return taskId
        }
        val envelope = MobileCreateTaskEnvelopeDto(
            apiVersion = 1,
            schemaVersion = 4,
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
                    projectId = projectId,
                    todayDate = todayDate?.toString(),
                ),
                provenance = provenance,
            ),
        )
        dao.enqueueCreate(
            task = TaskCacheEntity(
                id = taskId,
                serverVersion = null,
                title = normalizedTitle,
                themeId = projectId,
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
                serverId = serverId,
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

    private fun stableDraftId(kind: String, draftId: String): String = UUID.nameUUIDFromBytes(
        "tasken-mobile-$kind:$draftId".toByteArray(StandardCharsets.UTF_8),
    ).toString()

    suspend fun undoCreate(taskId: String): MobileUndoCreateResult {
        val serverId = currentServerId()
        requireNotNull(dao.task(taskId)) { "追加したTaskがcacheにありません。再読み込みしてください。" }
        val initialCommands = dao.outboxForTask(taskId)
        initialCommands.firstOrNull { it.commandName == "DeleteTask" }?.let { existing ->
            require(existing.serverId == serverId) { "接続先が変わったため、追加を元に戻せません。" }
            return MobileUndoCreateResult(existing.commandId, requiresSync = true)
        }
        val create = initialCommands.firstOrNull { it.commandName == "CreateTask" }
        if (create != null && dao.cancelUnsentCreate(create.commandId, taskId)) {
            return MobileUndoCreateResult(commandId = null, requiresSync = false)
        }

        val task = requireNotNull(dao.task(taskId)) { "追加したTaskは既に取り消されています。" }
        require(task.conflictCommandId == null) { "同期競合を解決してから追加を元に戻してください。" }
        val parent = task.optimisticCommandId?.let { commandId ->
            requireNotNull(dao.outbox(commandId)) { "送信待ちTaskのcommandが見つかりません。" }
        }
        if (parent != null) {
            require(
                parent.commandName == "CreateTask" &&
                    parent.serverId == serverId &&
                    parent.state in setOf(OutboxState.Pending, OutboxState.Sending, OutboxState.RetryWait),
            ) { "Task作成の同期結果を待ってから追加を元に戻してください。" }
        }
        val expectedVersion = task.serverVersion ?: 1
        val commandId = UUID.randomUUID().toString()
        val requestId = UUID.randomUUID().toString()
        val issuedAt = now().toString()
        val envelope = MobileTaskStateEnvelopeDto(
            apiVersion = 1,
            schemaVersion = 4,
            requestId = requestId,
            commandId = commandId,
            idempotencyKey = commandId,
            clientDeviceId = deviceId(),
            issuedAt = issuedAt,
            command = MobileTaskStateCommandDto(
                name = "DeleteTask",
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
            commandName = "DeleteTask",
            envelopeJson = MobileTaskCommandContract.encode(envelope),
            serverId = serverId,
            state = OutboxState.Pending,
            attemptCount = 0,
            createdAt = issuedAt,
            lastAttemptAt = null,
            lastError = null,
            taskId = taskId,
            dependsOnCommandId = parent?.commandId,
        )
        val optimisticTask = task.copy(
            updatedAt = issuedAt,
            optimisticCommandId = commandId,
        )
        if (parent == null) {
            dao.enqueueStateAction(optimisticTask, command)
        } else {
            dao.enqueueDependentStateAction(optimisticTask, command)
        }
        schedule()
        return MobileUndoCreateResult(commandId, requiresSync = true)
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
        val serverId = currentServerId()
        val envelope = MobileTaskUpdateEnvelopeDto(
            apiVersion = 1,
            schemaVersion = 4,
            requestId = requestId,
            commandId = commandId,
            idempotencyKey = commandId,
            clientDeviceId = deviceId(),
            issuedAt = issuedAt,
            command = MobileTaskUpdateCommandDto(
                name = "UpdateTask",
                taskId = taskId,
                expectedVersion = expectedVersion,
                changes = titlePatch(normalized),
                base = titlePatch(task.title),
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
                serverId = serverId,
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

    suspend fun enqueueUpdateChecklist(taskId: String, items: List<MobileChecklistItem>): String {
        val normalized = normalizeChecklist(items)
        val task = requireNotNull(dao.task(taskId)) { "Taskがcacheにありません。再読み込みしてください。" }
        require(task.conflictCommandId == null) { "Taskの同期競合を解決してから編集してください。" }
        val serverId = currentServerId()
        val issuedAt = now().toString()
        val pending = task.optimisticCommandId?.let { dao.outbox(it) }
        if (pending != null) {
            require(pending.serverId == serverId && pending.isUnsentChecklistUpdate()) {
                "このTaskの同期完了を待ってからChecklistを編集してください。"
            }
            val envelope = MobileTaskCommandContract.decodeUpdateEnvelope(pending.envelopeJson)
            val base = checklistItems(envelope.command.base.getValue("checklistItems"))
            if (normalized == base) {
                dao.cancelUnsentStateAction(
                    commandId = pending.commandId,
                    task = task.copy(
                        checklistJson = encodeMobileChecklist(base),
                        updatedAt = issuedAt,
                        optimisticCommandId = null,
                    ),
                )
            } else {
                val replacement = envelope.copy(
                    command = envelope.command.copy(changes = checklistPatch(normalized)),
                )
                dao.replaceUnsentChecklistUpdate(
                    commandId = pending.commandId,
                    task = task.copy(
                        checklistJson = encodeMobileChecklist(normalized),
                        updatedAt = issuedAt,
                    ),
                    envelopeJson = MobileTaskCommandContract.encode(replacement),
                )
            }
            schedule()
            return pending.commandId
        }

        val expectedVersion = requireNotNull(task.serverVersion) { "Task作成の同期完了を待って編集してください。" }
        val base = normalizeChecklist(decodeMobileChecklist(task.checklistJson))
        require(base != normalized) { "Checklistは変更されていません。" }
        val commandId = UUID.randomUUID().toString()
        val requestId = UUID.randomUUID().toString()
        val envelope = MobileTaskUpdateEnvelopeDto(
            apiVersion = 1,
            schemaVersion = 4,
            requestId = requestId,
            commandId = commandId,
            idempotencyKey = commandId,
            clientDeviceId = deviceId(),
            issuedAt = issuedAt,
            command = MobileTaskUpdateCommandDto(
                name = "UpdateTask",
                taskId = taskId,
                expectedVersion = expectedVersion,
                changes = checklistPatch(normalized),
                base = checklistPatch(base),
            ),
        )
        dao.enqueueStateAction(
            task = task.copy(
                checklistJson = encodeMobileChecklist(normalized),
                updatedAt = issuedAt,
                optimisticCommandId = commandId,
            ),
            command = OutboxCommandEntity(
                commandId = commandId,
                idempotencyKey = commandId,
                requestId = requestId,
                clientDeviceId = envelope.clientDeviceId,
                issuedAt = issuedAt,
                commandName = "UpdateTask",
                envelopeJson = MobileTaskCommandContract.encode(envelope),
                serverId = serverId,
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

    private fun normalizeChecklist(items: List<MobileChecklistItem>): List<MobileChecklistItem> {
        require(items.size <= 100) { "Checklistは100件以内にしてください。" }
        require(items.map { it.id.trim() }.distinct().size == items.size) { "Checklist itemが重複しています。" }
        return items.mapIndexed { index, item ->
            val id = item.id.trim()
            val title = item.title.trim()
            require(id.isNotEmpty() && id.length <= 200) { "Checklist itemを作り直してください。" }
            require(title.isNotEmpty() && title.length <= 200) { "Checklistは1〜200文字で入力してください。" }
            require(item.completedAt == null || runCatching { OffsetDateTime.parse(item.completedAt) }.isSuccess) {
                "Checklistの完了日時が不正です。"
            }
            item.copy(
                id = id,
                title = title,
                sortOrder = index.toDouble(),
                completedAt = if (item.done) item.completedAt else null,
            )
        }
    }

    suspend fun enqueueUpdateTodayDate(taskId: String, todayDate: LocalDate?): String {
        val normalized = todayDate?.toString()
        val task = requireNotNull(dao.task(taskId)) { "Taskがcacheにありません。再読み込みしてください。" }
        require(task.optimisticCommandId == null && task.conflictCommandId == null) { "Taskの同期を解決してから編集してください。" }
        val expectedVersion = requireNotNull(task.serverVersion) { "Task作成の同期完了を待って編集してください。" }
        require(task.todayDate != normalized)
        val commandId = UUID.randomUUID().toString()
        val requestId = UUID.randomUUID().toString()
        val issuedAt = now().toString()
        val serverId = currentServerId()
        val envelope = MobileTaskUpdateEnvelopeDto(
            apiVersion = 1,
            schemaVersion = 4,
            requestId = requestId,
            commandId = commandId,
            idempotencyKey = commandId,
            clientDeviceId = deviceId(),
            issuedAt = issuedAt,
            command = MobileTaskUpdateCommandDto(
                name = "UpdateTask",
                taskId = taskId,
                expectedVersion = expectedVersion,
                changes = todayDatePatch(normalized),
                base = todayDatePatch(task.todayDate),
            ),
        )
        dao.enqueueStateAction(
            task = task.copy(todayDate = normalized, updatedAt = issuedAt, optimisticCommandId = commandId),
            command = OutboxCommandEntity(
                commandId = commandId,
                idempotencyKey = commandId,
                requestId = requestId,
                clientDeviceId = envelope.clientDeviceId,
                issuedAt = issuedAt,
                commandName = "UpdateTask",
                envelopeJson = MobileTaskCommandContract.encode(envelope),
                serverId = serverId,
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

    suspend fun enqueueUpdateTheme(taskId: String, themeId: String?): String {
        require(themeId == null || (themeId.isNotBlank() && themeId.length <= 200))
        val task = requireNotNull(dao.task(taskId)) { "Taskがcacheにありません。再読み込みしてください。" }
        require(task.optimisticCommandId == null && task.conflictCommandId == null) { "Taskの同期を解決してから編集してください。" }
        val expectedVersion = requireNotNull(task.serverVersion) { "Task作成の同期完了を待って編集してください。" }
        require(task.themeId != themeId)
        if (themeId != null) {
            require(dao.themes().any { it.id == themeId }) { "Themeがcacheにありません。再読み込みしてください。" }
        }
        val commandId = UUID.randomUUID().toString()
        val requestId = UUID.randomUUID().toString()
        val issuedAt = now().toString()
        val serverId = currentServerId()
        val rejectedThemeCommandIds = dao.outboxForTask(taskId)
            .filter { it.serverId == serverId && it.toRejectedThemeUpdateOrNull() != null }
            .map(OutboxCommandEntity::commandId)
        val envelope = MobileTaskUpdateEnvelopeDto(
            apiVersion = 1,
            schemaVersion = 4,
            requestId = requestId,
            commandId = commandId,
            idempotencyKey = commandId,
            clientDeviceId = deviceId(),
            issuedAt = issuedAt,
            command = MobileTaskUpdateCommandDto(
                name = "UpdateTask",
                taskId = taskId,
                expectedVersion = expectedVersion,
                changes = themeIdPatch(themeId),
                base = themeIdPatch(task.themeId),
            ),
        )
        dao.enqueueThemeUpdate(
            task = task.copy(themeId = themeId, updatedAt = issuedAt, optimisticCommandId = commandId),
            command = OutboxCommandEntity(
                commandId = commandId,
                idempotencyKey = commandId,
                requestId = requestId,
                clientDeviceId = envelope.clientDeviceId,
                issuedAt = issuedAt,
                commandName = "UpdateTask",
                envelopeJson = MobileTaskCommandContract.encode(envelope),
                serverId = serverId,
                state = OutboxState.Pending,
                attemptCount = 0,
                createdAt = issuedAt,
                lastAttemptAt = null,
                lastError = null,
                taskId = taskId,
            ),
            replacedRejectedCommandIds = rejectedThemeCommandIds,
        )
        schedule()
        return commandId
    }

    suspend fun enqueueUpdateSchedule(taskId: String, schedule: MobileTaskScheduleDraft): String {
        val normalized = normalizeScheduleDraft(schedule)
        val task = requireNotNull(dao.task(taskId)) { "Taskがcacheにありません。再読み込みしてください。" }
        require(task.optimisticCommandId == null && task.conflictCommandId == null) { "Taskの同期を解決してから編集してください。" }
        val expectedVersion = requireNotNull(task.serverVersion) { "Task作成の同期完了を待って編集してください。" }
        val base = task.scheduleDraftOrNull()
        require(base != normalized) { "予定は変更されていません。" }
        require(base != null || normalized.startDate != null || normalized.endDate != null) {
            "未設定の予定はこれ以上消去できません。"
        }
        val expectedScheduleVersion = if (base == null) {
            null
        } else {
            requireNotNull(task.scheduleVersion) { "予定の同期情報がありません。再読み込みしてください。" }
        }
        val commandId = UUID.randomUUID().toString()
        val requestId = UUID.randomUUID().toString()
        val issuedAt = now().toString()
        val serverId = currentServerId()
        val envelope = MobileTaskUpdateEnvelopeDto(
            apiVersion = 1,
            schemaVersion = 4,
            requestId = requestId,
            commandId = commandId,
            idempotencyKey = commandId,
            clientDeviceId = deviceId(),
            issuedAt = issuedAt,
            command = MobileTaskUpdateCommandDto(
                name = "UpdateTask",
                taskId = taskId,
                expectedVersion = expectedVersion,
                expectedScheduleVersion = expectedScheduleVersion,
                changes = schedulePatch(normalized),
                base = schedulePatch(base),
            ),
        )
        dao.enqueueStateAction(
            task = task.withOptimisticSchedule(normalized, commandId, issuedAt),
            command = OutboxCommandEntity(
                commandId = commandId,
                idempotencyKey = commandId,
                requestId = requestId,
                clientDeviceId = envelope.clientDeviceId,
                issuedAt = issuedAt,
                commandName = "UpdateTask",
                envelopeJson = MobileTaskCommandContract.encode(envelope),
                serverId = serverId,
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

    private fun normalizeScheduleDraft(schedule: MobileTaskScheduleDraft): MobileTaskScheduleDraft {
        val start = schedule.startDate?.takeIf(String::isNotBlank)?.let(LocalDate::parse)
        val end = schedule.endDate?.takeIf(String::isNotBlank)?.let(LocalDate::parse)
        require(start == null || end == null || !end.isBefore(start)) { "終了日は開始日以降にしてください。" }
        require(schedule.rangeSemantics == null || schedule.rangeSemantics in setOf("once_within_window", "ongoing")) {
            "期間の意味を選び直してください。"
        }
        require(schedule.rangeSemantics == null || (start != null && end != null && end.isAfter(start))) {
            "期間の意味は開始日と終了日が異なるときだけ設定できます。"
        }
        return MobileTaskScheduleDraft(start?.toString(), end?.toString(), schedule.rangeSemantics)
    }

    suspend fun acceptServer(commandId: String) {
        val conflict = requireNotNull(dao.conflict(commandId)) { "競合情報が見つかりません。再読み込みしてください。" }
        require(dao.task(conflict.taskId)?.conflictCommandId == commandId)
        require(dao.outbox(commandId)?.serverId == currentServerId()) {
            "接続先が変わったため、この競合は解決できません。"
        }
        dao.acceptServer(commandId)
    }

    suspend fun discardRejectedThemeUpdate(taskId: String, commandId: String) {
        val command = requireNotNull(dao.outbox(commandId)) { "却下されたTheme変更が見つかりません。" }
        require(command.taskId == taskId && command.serverId == currentServerId())
        require(command.toRejectedThemeUpdateOrNull() != null) { "Theme変更の却下情報ではありません。" }
        dao.discardRejectedThemeUpdate(commandId, taskId)
    }

    suspend fun keepLocal(commandId: String): String {
        val conflict = requireNotNull(dao.conflict(commandId)) { "競合情報が見つかりません。再読み込みしてください。" }
        val task = requireNotNull(dao.task(conflict.taskId)) { "Taskがcacheにありません。再読み込みしてください。" }
        require(task.conflictCommandId == commandId)
        val previousCommand = requireNotNull(dao.outbox(commandId))
        val serverId = currentServerId()
        require(previousCommand.serverId == serverId) { "接続先が変わったため、この競合は再送できません。" }
        val replacementId = UUID.randomUUID().toString()
        val requestId = UUID.randomUUID().toString()
        val issuedAt = now().toString()
        val clientDeviceId = deviceId()
        val isUpdate = conflict.intendedAction == "UpdateTask"
        val localSchedule = if (conflict.localScheduleChanged) {
            MobileTaskScheduleDraft(
                conflict.localScheduleStartDate,
                conflict.localScheduleEndDate,
                conflict.localScheduleRangeSemantics,
            )
        } else {
            null
        }
        val localChecklist = if (conflict.localChecklistChanged) {
            decodeMobileChecklist(requireNotNull(conflict.localChecklistJson))
        } else {
            null
        }
        if (isUpdate && conflict.localPlannedScheduleChanged &&
            conflict.localTitle == null &&
            !conflict.localTodayDateChanged &&
            !conflict.localThemeIdChanged &&
            !conflict.localScheduleChanged
        ) {
            error("時刻の変更は使えません。Desktopを採用してください。")
        }
        val envelopeJson = if (isUpdate) {
            val changes = when {
                conflict.localTitle != null -> titlePatch(conflict.localTitle)
                conflict.localTodayDateChanged -> todayDatePatch(conflict.localTodayDate)
                conflict.localThemeIdChanged -> themeIdPatch(conflict.localThemeId)
                conflict.localChecklistChanged -> checklistPatch(requireNotNull(localChecklist))
                conflict.localScheduleChanged -> schedulePatch(requireNotNull(localSchedule))
                else -> error("端末側の更新内容が競合情報にありません。")
            }
            val base = when {
                conflict.localTitle != null -> titlePatch(conflict.serverTitle)
                conflict.localTodayDateChanged -> todayDatePatch(conflict.serverTodayDate)
                conflict.localThemeIdChanged -> themeIdPatch(conflict.serverThemeId)
                conflict.localChecklistChanged -> checklistPatch(decodeMobileChecklist(task.checklistJson))
                conflict.localScheduleChanged -> schedulePatch(task.scheduleDraftOrNull())
                else -> error("Desktop側の更新内容が競合情報にありません。")
            }
            MobileTaskCommandContract.encode(
                MobileTaskUpdateEnvelopeDto(
                    apiVersion = 1,
                    schemaVersion = 4,
                    requestId = requestId,
                    commandId = replacementId,
                    idempotencyKey = replacementId,
                    clientDeviceId = clientDeviceId,
                    issuedAt = issuedAt,
                    command = MobileTaskUpdateCommandDto(
                        name = "UpdateTask",
                        taskId = conflict.taskId,
                        expectedVersion = conflict.serverVersion,
                        expectedScheduleVersion = if (conflict.localScheduleChanged) task.scheduleVersion else null,
                        changes = changes,
                        base = base,
                    ),
                ),
            )
        } else {
            MobileTaskCommandContract.encode(
                MobileTaskStateEnvelopeDto(
                    apiVersion = 1,
                    schemaVersion = 4,
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
        val optimisticTask = task.copy(
            serverVersion = conflict.serverVersion,
            title = conflict.localTitle ?: task.title,
            todayDate = if (conflict.localTodayDateChanged) conflict.localTodayDate else task.todayDate,
            themeId = if (conflict.localThemeIdChanged) conflict.localThemeId else task.themeId,
            checklistJson = if (conflict.localChecklistChanged) {
                encodeMobileChecklist(requireNotNull(localChecklist))
            } else {
                task.checklistJson
            },
            state = optimisticState,
            updatedAt = issuedAt,
            optimisticCommandId = replacementId,
            conflictCommandId = null,
        ).let { current ->
            if (conflict.localScheduleChanged) {
                current.withOptimisticSchedule(requireNotNull(localSchedule), replacementId, issuedAt)
            } else {
                current
            }
        }
        dao.replaceConflictWithCommand(
            oldCommandId = commandId,
            task = optimisticTask,
            command = OutboxCommandEntity(
                commandId = replacementId,
                idempotencyKey = replacementId,
                requestId = requestId,
                clientDeviceId = clientDeviceId,
                issuedAt = issuedAt,
                commandName = conflict.intendedAction,
                envelopeJson = envelopeJson,
                serverId = serverId,
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
        val serverId = currentServerId()
        val task = requireNotNull(dao.task(taskId)) { "Taskがcacheにありません。再読み込みしてください。" }
        val pending = task.optimisticCommandId?.let { dao.outbox(it) }
        if (pending != null && pending.commandName in setOf("CompleteTask", "ReopenTask")) {
            require(pending.serverId == serverId) { "接続先が変わったため、この変更は操作できません。" }
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
            require(pending.serverId == serverId) { "接続先が変わったため、この変更は操作できません。" }
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
            schemaVersion = 4,
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
            serverId = serverId,
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

    private data class ReceiptExpectation(
        val taskId: String,
        val expectedVersion: Int?,
        val scheduleUpdate: Boolean = false,
        val expectedScheduleVersion: Int? = null,
    )

    private data class ThemeUpdateBase(val themeId: String?)
    private data class ScheduleUpdateBase(val schedule: MobileTaskScheduleDraft?)
    private data class ChecklistUpdateBase(val items: List<MobileChecklistItem>)

    private fun receiptExpectation(command: OutboxCommandEntity): ReceiptExpectation = when (command.commandName) {
        "CreateTask" -> {
            val envelope = MobileTaskCommandContract.decodeCreateEnvelope(command.envelopeJson)
            require(envelope.commandId == command.commandId)
            require(envelope.command.task.id == command.taskId)
            ReceiptExpectation(envelope.command.task.id, expectedVersion = null)
        }
        "UpdateTask" -> {
            val envelope = MobileTaskCommandContract.decodeUpdateEnvelope(command.envelopeJson)
            require(envelope.commandId == command.commandId)
            require(envelope.command.taskId == command.taskId)
            ReceiptExpectation(
                taskId = envelope.command.taskId,
                expectedVersion = envelope.command.expectedVersion,
                scheduleUpdate = envelope.command.changes.keys == setOf("schedule"),
                expectedScheduleVersion = envelope.command.expectedScheduleVersion,
            )
        }
        "CompleteTask", "ReopenTask", "DeleteTask" -> {
            val envelope = MobileTaskCommandContract.decodeStateEnvelope(command.envelopeJson)
            require(envelope.commandId == command.commandId)
            require(envelope.command.taskId == command.taskId)
            ReceiptExpectation(envelope.command.taskId, envelope.command.expectedVersion)
        }
        else -> error("Unsupported outbox command: ${command.commandName}")
    }

    private suspend fun invalidReceiptReason(
        command: OutboxCommandEntity,
        response: MobileTaskCommandResponseDto,
        expectedServerId: String,
    ): String? {
        return try {
            val expectation = receiptExpectation(command)
            val receipt = response.data
            require(command.serverId == expectedServerId) { "Outboxの接続先が確認済みDesktopと一致しません。" }
            require(response.meta.serverId == expectedServerId) { "GatewayのserverIdが送信先と一致しません。" }
            require(response.ok) { "Gatewayのreceiptが成功responseではありません。" }
            require(receipt.commandId == command.commandId) { "GatewayのcommandIdが送信内容と一致しません。" }
            require(receipt.task.id == expectation.taskId) { "GatewayのTask IDが送信内容と一致しません。" }
            require(receipt.status in setOf("applied", "no_change")) { "Gatewayのreceipt statusを解釈できません。" }
            require(receipt.task.version > 0) { "GatewayのTask versionが不正です。" }
            expectation.expectedVersion?.let { expectedVersion ->
                if (receipt.status == "applied") {
                    require(receipt.task.version > expectedVersion) { "適用済みTaskのversionが進んでいません。" }
                } else {
                    require(receipt.task.version >= expectedVersion) { "変更なしTaskのversionが後退しています。" }
                }
            }
            if (expectation.scheduleUpdate) {
                val schedule = requireNotNull(receipt.task.schedule) { "予定更新のreceiptにScheduleがありません。" }
                expectation.expectedScheduleVersion?.let { expectedVersion ->
                    if (receipt.status == "applied") {
                        require(schedule.version > expectedVersion) { "適用済みScheduleのversionが進んでいません。" }
                    } else {
                        require(schedule.version >= expectedVersion) { "変更なしScheduleのversionが後退しています。" }
                    }
                }
            }
            dao.task(expectation.taskId)?.serverVersion?.let { cachedVersion ->
                require(receipt.task.version >= cachedVersion) { "GatewayのTask versionがcacheより後退しています。" }
            }
            dao.task(expectation.taskId)?.scheduleVersion?.let { cachedVersion ->
                receipt.task.schedule?.let { schedule ->
                    require(schedule.version >= cachedVersion) { "GatewayのSchedule versionがcacheより後退しています。" }
                }
            }
            null
        } catch (error: Exception) {
            error.message ?: "Gatewayのreceiptを検証できません。"
        }
    }

    private fun themeUpdateBase(command: OutboxCommandEntity): ThemeUpdateBase? {
        if (command.commandName != "UpdateTask") return null
        val envelope = MobileTaskCommandContract.decodeUpdateEnvelope(command.envelopeJson)
        if (envelope.command.changes.keys != setOf("themeId")) return null
        val baseThemeId = envelope.command.base.getValue("themeId").let {
            if (it == JsonNull) null else it.jsonPrimitive.content
        }
        return ThemeUpdateBase(baseThemeId)
    }

    private fun scheduleUpdateBase(command: OutboxCommandEntity): ScheduleUpdateBase? {
        if (command.commandName != "UpdateTask") return null
        val envelope = MobileTaskCommandContract.decodeUpdateEnvelope(command.envelopeJson)
        if (envelope.command.changes.keys != setOf("schedule")) return null
        val value = envelope.command.base.getValue("schedule")
        if (value == JsonNull) return ScheduleUpdateBase(null)
        val schedule = value as JsonObject
        return ScheduleUpdateBase(
            MobileTaskScheduleDraft(
                startDate = schedule.getValue("startDate").let { if (it == JsonNull) null else it.jsonPrimitive.content },
                endDate = schedule.getValue("endDate").let { if (it == JsonNull) null else it.jsonPrimitive.content },
                rangeSemantics = schedule.getValue("rangeSemantics").let { if (it == JsonNull) null else it.jsonPrimitive.content },
            ),
        )
    }

    private fun checklistUpdateBase(command: OutboxCommandEntity): ChecklistUpdateBase? {
        if (command.commandName != "UpdateTask") return null
        val envelope = MobileTaskCommandContract.decodeUpdateEnvelope(command.envelopeJson)
        if (envelope.command.changes.keys != setOf("checklistItems")) return null
        return ChecklistUpdateBase(checklistItems(envelope.command.base.getValue("checklistItems")))
    }

    suspend fun drain(serverId: String, sender: (String) -> MobileCommandSendResult): Boolean {
        require(serverId.isNotBlank())
        var shouldRetry = false
        while (true) {
            require(dao.syncState()?.serverId == serverId) { "確認済みDesktopと同期状態が一致しません。" }
            val attemptedAt = now().toString()
            val command = dao.claimNext(serverId, attemptedAt) ?: return shouldRetry
            when (val result = sender(command.envelopeJson)) {
                is MobileCommandSendResult.Applied -> {
                    val response = result.response
                    val invalidReceipt = invalidReceiptReason(command, response, serverId)
                    if (invalidReceipt != null) {
                        dao.markRetry(
                            command.commandId,
                            structuredCommandError("invalid_command_receipt", invalidReceipt, retryable = true),
                        )
                        return true
                    }
                    val task = response.data.task
                    val dependents = dao.dependents(command.commandId)
                    require(dependents.size <= 1)
                    val dependent = dependents.singleOrNull()
                    val dependentEnvelope = dependent?.let {
                        val stored = MobileTaskCommandContract.decodeStateEnvelope(it.envelopeJson)
                        MobileTaskCommandContract.encode(
                            stored.copy(command = stored.command.copy(expectedVersion = task.version)),
                        )
                    }
                    val updatedSyncState = SyncStateEntity(
                        serverId = response.meta.serverId,
                        apiVersion = response.meta.apiVersion,
                        schemaVersion = response.meta.schemaVersion,
                        cursor = null,
                        lastSuccessfulSyncAt = response.meta.generatedAt,
                        lastAttemptAt = attemptedAt,
                        lastError = null,
                    )
                    val receiptApplied = if (command.commandName == "DeleteTask") {
                        require(dependent == null)
                        dao.applyDeleteReceipt(
                            commandId = command.commandId,
                            expectedServerId = serverId,
                            expectedTaskId = requireNotNull(command.taskId),
                            expectedAttemptCount = command.attemptCount,
                            canonicalVersion = task.version,
                            syncState = updatedSyncState,
                        )
                    } else {
                        dao.applyCommandReceipt(
                            commandId = command.commandId,
                            expectedServerId = serverId,
                            expectedTaskId = requireNotNull(command.taskId),
                            expectedAttemptCount = command.attemptCount,
                            canonicalTask = TaskCacheEntity(
                                id = task.id,
                                serverVersion = task.version,
                                title = task.title,
                                themeId = task.themeId,
                                state = task.state,
                                workState = task.workState,
                                todayDate = task.todayDate,
                                plannedStartTime = task.plannedStartTime,
                                plannedDurationMinutes = task.plannedDurationMinutes,
                                latestReceiptId = task.latestWorkReceipt?.id,
                                latestReceiptReportedAt = task.latestWorkReceipt?.reportedAt,
                                latestReceiptExecutorLabel = task.latestWorkReceipt?.executorLabel,
                                latestReceiptSummary = task.latestWorkReceipt?.summary,
                                checklistJson = encodeMobileChecklist(task.checklistItems),
                                scheduleId = task.schedule?.id,
                                scheduleVersion = task.schedule?.version,
                                scheduleStartDate = task.schedule?.startDate,
                                scheduleEndDate = task.schedule?.endDate,
                                scheduleDateKind = task.schedule?.dateKind,
                                scheduleRangeSemantics = task.schedule?.rangeSemantics,
                                scheduleConfidence = task.schedule?.confidence,
                                scheduleGranularity = task.schedule?.granularity,
                                updatedAt = task.updatedAt,
                                optimisticCommandId = null,
                            ),
                            syncState = updatedSyncState,
                            dependentCommandId = dependent?.commandId,
                            dependentEnvelopeJson = dependentEnvelope,
                            optimisticState = dependent?.let {
                                when (it.commandName) {
                                    "CompleteTask" -> "done"
                                    "ReopenTask" -> "todo"
                                    "DeleteTask" -> task.state
                                    else -> error("Unsupported dependent command: ${it.commandName}")
                                }
                            },
                        )
                    }
                    if (!receiptApplied) return shouldRetry
                }
                is MobileCommandSendResult.Conflict -> {
                    val response = result.response
                    if (response.meta.serverId != serverId || command.serverId != serverId) {
                        dao.markRetry(
                            command.commandId,
                            structuredCommandError(
                                "invalid_command_response",
                                "GatewayのserverIdが送信先と一致しません。",
                                retryable = true,
                            ),
                        )
                        return true
                    }
                    val conflict = requireNotNull(response.error.conflict)
                    val current = conflict.currentTask
                    require(command.commandName == conflict.intendedAction)
                    val localPatch = if (command.commandName == "UpdateTask") {
                        val envelope = MobileTaskCommandContract.decodeUpdateEnvelope(command.envelopeJson)
                        require(envelope.command.taskId == current.id)
                        require(envelope.command.expectedVersion == conflict.expectedVersion)
                        envelope.command.changes
                    } else {
                        val envelope = MobileTaskCommandContract.decodeStateEnvelope(command.envelopeJson)
                        require(envelope.command.taskId == current.id)
                        require(envelope.command.expectedVersion == conflict.expectedVersion)
                        null
                    }
                    val localTitle = localPatch?.get("title")?.jsonPrimitive?.content
                    val localTodayDateChanged = localPatch?.containsKey("todayDate") == true
                    val localTodayDate = localPatch?.get("todayDate")?.let {
                        if (it == JsonNull) null else it.jsonPrimitive.content
                    }
                    val localThemeIdChanged = localPatch?.containsKey("themeId") == true
                    val localThemeId = localPatch?.get("themeId")?.let {
                        if (it == JsonNull) null else it.jsonPrimitive.content
                    }
                    val localChecklistChanged = localPatch?.containsKey("checklistItems") == true
                    val localChecklist = localPatch?.get("checklistItems")?.let(::checklistItems)
                    val localScheduleChanged = localPatch?.containsKey("schedule") == true
                    val localSchedule = localPatch?.get("schedule")?.let { value ->
                        require(value is JsonObject)
                        MobileTaskScheduleDraft(
                            startDate = value.getValue("startDate").let {
                                if (it == JsonNull) null else it.jsonPrimitive.content
                            },
                            endDate = value.getValue("endDate").let {
                                if (it == JsonNull) null else it.jsonPrimitive.content
                            },
                            rangeSemantics = value.getValue("rangeSemantics").let {
                                if (it == JsonNull) null else it.jsonPrimitive.content
                            },
                        )
                    }
                    val localPlannedScheduleChanged = localPatch?.containsKey("plannedSchedule") == true
                    val localPlannedSchedule = localPatch?.get("plannedSchedule")?.let { value ->
                        require(value is JsonObject)
                        LeftoverPlannedScheduleDraft(
                            startTime = value.getValue("startTime").let {
                                if (it == JsonNull) null else it.jsonPrimitive.content
                            },
                            durationMinutes = value.getValue("durationMinutes").let {
                                if (it == JsonNull) null else it.jsonPrimitive.content.toInt()
                            },
                        )
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
                            todayDate = current.todayDate,
                            plannedStartTime = current.plannedStartTime,
                            plannedDurationMinutes = current.plannedDurationMinutes,
                            latestReceiptId = current.latestWorkReceipt?.id,
                            latestReceiptReportedAt = current.latestWorkReceipt?.reportedAt,
                            latestReceiptExecutorLabel = current.latestWorkReceipt?.executorLabel,
                            latestReceiptSummary = current.latestWorkReceipt?.summary,
                            checklistJson = encodeMobileChecklist(current.checklistItems),
                            scheduleId = current.schedule?.id,
                            scheduleVersion = current.schedule?.version,
                            scheduleStartDate = current.schedule?.startDate,
                            scheduleEndDate = current.schedule?.endDate,
                            scheduleDateKind = current.schedule?.dateKind,
                            scheduleRangeSemantics = current.schedule?.rangeSemantics,
                            scheduleConfidence = current.schedule?.confidence,
                            scheduleGranularity = current.schedule?.granularity,
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
                            serverTodayDate = current.todayDate,
                            localTodayDate = localTodayDate,
                            localTodayDateChanged = localTodayDateChanged,
                            serverThemeId = current.themeId,
                            localThemeId = localThemeId,
                            localThemeIdChanged = localThemeIdChanged,
                            localChecklistJson = localChecklist?.let(::encodeMobileChecklist),
                            localChecklistChanged = localChecklistChanged,
                            localScheduleStartDate = localSchedule?.startDate,
                            localScheduleEndDate = localSchedule?.endDate,
                            localScheduleRangeSemantics = localSchedule?.rangeSemantics,
                            localScheduleChanged = localScheduleChanged,
                            localPlannedStartTime = localPlannedSchedule?.startTime,
                            localPlannedDurationMinutes = localPlannedSchedule?.durationMinutes,
                            localPlannedScheduleChanged = localPlannedScheduleChanged,
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
                is MobileCommandSendResult.Rejected -> {
                    val reason = structuredCommandError(result.code, result.message, result.retryable)
                    if (result.retryable) {
                        dao.markRetry(command.commandId, reason)
                        return true
                    }
                    val themeBase = themeUpdateBase(command)
                    val scheduleBase = scheduleUpdateBase(command)
                    val checklistBase = checklistUpdateBase(command)
                    if (command.commandName == "DeleteTask" && result.code == "not_found") {
                        dao.acceptMissingDelete(
                            commandId = command.commandId,
                            taskId = requireNotNull(command.taskId),
                        )
                    } else if (command.commandName == "DeleteTask") {
                        dao.rejectDeleteAndRestore(
                            commandId = command.commandId,
                            taskId = requireNotNull(command.taskId),
                            reason = reason,
                        )
                    } else if (themeBase != null) {
                        dao.rejectUpdateAndRollback(
                            commandId = command.commandId,
                            taskId = requireNotNull(command.taskId),
                            baseThemeId = themeBase.themeId,
                            reason = reason,
                        )
                    } else if (scheduleBase != null) {
                        dao.rejectScheduleUpdateAndRollback(
                            commandId = command.commandId,
                            taskId = requireNotNull(command.taskId),
                            baseSchedule = scheduleBase.schedule,
                            reason = reason,
                        )
                    } else if (checklistBase != null) {
                        dao.rejectChecklistUpdateAndRollback(
                            commandId = command.commandId,
                            taskId = requireNotNull(command.taskId),
                            baseChecklistJson = encodeMobileChecklist(checklistBase.items),
                            reason = reason,
                        )
                    } else {
                        dao.markRejected(command.commandId, reason)
                    }
                }
            }
        }
    }

}

object MobileOutboxScheduler {
    private const val UniqueWorkName = "tasken-mobile-outbox"
    private const val PeriodicWorkName = "tasken-mobile-background-sync"

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

    fun ensurePeriodicSync(context: Context) {
        val request = PeriodicWorkRequestBuilder<MobileBackgroundSyncWorker>(15, TimeUnit.MINUTES)
            .setConstraints(Constraints.Builder().setRequiredNetworkType(NetworkType.CONNECTED).build())
            .setBackoffCriteria(BackoffPolicy.EXPONENTIAL, Duration.ofSeconds(30))
            .build()
        WorkManager.getInstance(context.applicationContext).enqueueUniquePeriodicWork(
            PeriodicWorkName,
            ExistingPeriodicWorkPolicy.KEEP,
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
        val result = try {
            if (repository.synchronizeIfPaired()) Result.success() else Result.retry()
        } catch (error: Exception) {
            Log.w("TaskenOutbox", "Outbox sync failed and will be retried", error)
            Result.retry()
        }
        TaskenTodayWidget.updateAllNow(applicationContext)
        return result
    }
}

class MobileBackgroundSyncWorker(
    appContext: Context,
    params: WorkerParameters,
) : CoroutineWorker(appContext, params) {
    override suspend fun doWork(): Result {
        val repository = AndroidMobileTaskRepository(applicationContext, scheduleOutboxOnStart = false)
        repository.recoverInterruptedOutbox()
        val result = try {
            if (repository.synchronizeIfPaired()) Result.success() else Result.retry()
        } catch (error: Exception) {
            Log.w("TaskenBackgroundSync", "Background sync failed and will be retried", error)
            Result.retry()
        }
        TaskenTodayWidget.updateAllNow(applicationContext)
        return result
    }
}
