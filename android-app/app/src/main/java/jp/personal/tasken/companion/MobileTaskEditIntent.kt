package jp.personal.tasken.companion

import kotlinx.serialization.Serializable
import kotlinx.serialization.encodeToString
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.jsonObject

/** Local Task input. A dependent command has no sendable envelope until its parent's receipt. */
@Serializable
internal data class MobileTaskEditIntent(val changes: JsonObject, val base: JsonObject) {
    fun encode(): String = Json.encodeToString(this)

    fun project(task: TaskCacheEntity, commandId: String, issuedAt: String): TaskCacheEntity {
        fun string(key: String, previous: String?): String? = if (changes.containsKey(key)) {
            changes.getValue(key).let { if (it == JsonNull) null else it.jsonPrimitive.content }
        } else previous
        val planned = changes["plannedSchedule"] as? JsonObject
        val projected = task.copy(
            title = requireNotNull(string("title", task.title)),
            themeId = string("themeId", task.themeId),
            todayDate = string("todayDate", task.todayDate),
            state = requireNotNull(string("state", task.state)),
            checklistJson = changes["checklistItems"]?.toString() ?: task.checklistJson,
            plannedStartTime = if (planned != null) planned["startTime"]?.takeUnless { it == JsonNull }?.jsonPrimitive?.content else task.plannedStartTime,
            plannedDurationMinutes = if (planned != null) planned["durationMinutes"]?.takeUnless { it == JsonNull }?.jsonPrimitive?.content?.toInt() else task.plannedDurationMinutes,
            updatedAt = issuedAt,
            optimisticCommandId = commandId,
        )
        return if (changes.containsKey("schedule")) {
            val schedule = changes.getValue("schedule")
            val fields = (schedule as? JsonObject) ?: JsonObject(emptyMap())
            fun date(key: String): String? = fields[key]?.takeUnless { it == JsonNull }?.jsonPrimitive?.content
            projected.copy(
                scheduleStartDate = date("startDate"), scheduleEndDate = date("endDate"),
                scheduleRangeSemantics = date("rangeSemantics"),
                scheduleDateKind = deriveScheduleDateKind(date("startDate"), date("endDate")),
                scheduleConfidence = task.scheduleConfidence ?: "fixed",
                scheduleGranularity = task.scheduleGranularity ?: "day",
            )
        } else projected
    }
}

internal fun OutboxCommandEntity.taskEditIntent(): MobileTaskEditIntent = taskIntentJson?.let {
    Json.decodeFromString<MobileTaskEditIntent>(it)
} ?: when (commandName) {
    "UpdateTask" -> MobileTaskCommandContract.decodeUpdateEnvelope(envelopeJson).command.let {
        MobileTaskEditIntent(it.changes, it.base)
    }
    "CompleteTask", "ReopenTask", "DeleteTask" -> MobileTaskEditIntent(
        Json.parseToJsonElement(if (commandName == "CompleteTask") "{\"state\":\"done\"}" else if (commandName == "ReopenTask") "{\"state\":\"todo\"}" else "{}").let { it as JsonObject },
        JsonObject(emptyMap()),
    )
    else -> error("Unsupported Task edit")
}

internal fun OutboxCommandEntity.materializedTaskEnvelope(version: Int, scheduleVersion: Int? = null): String {
    require(attemptCount == 0 && state == OutboxState.Pending)
    return if (commandName == "UpdateTask") {
        val intent = taskEditIntent()
        MobileTaskCommandContract.encode(MobileTaskUpdateEnvelopeDto(
            apiVersion = 1, schemaVersion = TASKEN_MOBILE_SCHEMA_VERSION,
            requestId = requestId, commandId = commandId, idempotencyKey = idempotencyKey,
            clientDeviceId = clientDeviceId, issuedAt = issuedAt,
            command = MobileTaskUpdateCommandDto(name = commandName, taskId = requireNotNull(taskId),
                expectedVersion = version, expectedScheduleVersion = if (intent.changes.containsKey("schedule")) scheduleVersion else null,
                changes = intent.changes, base = intent.base),
        ))
    } else {
        MobileTaskCommandContract.encode(MobileTaskStateEnvelopeDto(
            apiVersion = 1, schemaVersion = TASKEN_MOBILE_SCHEMA_VERSION,
            requestId = requestId, commandId = commandId, idempotencyKey = idempotencyKey,
            clientDeviceId = clientDeviceId, issuedAt = issuedAt,
            command = MobileTaskStateCommandDto(name = commandName, taskId = requireNotNull(taskId), expectedVersion = version),
        ))
    }
}

data class MobileHeldTaskChange(val commandId: String, val description: String, val reason: String, val rejected: Boolean)

internal fun OutboxCommandEntity.heldTaskChange(): MobileHeldTaskChange? {
    if (taskId == null || state !in setOf(OutboxState.Blocked, OutboxState.Rejected)) return null
    val description = when (commandName) {
        "CreateTask" -> runCatching { MobileTaskCommandContract.decodeCreateEnvelope(envelopeJson).command.task.title }.getOrDefault("Task作成")
        "CompleteTask" -> "完了にする"
        "ReopenTask" -> "未完了に戻す"
        "DeleteTask" -> "Taskを削除"
        else -> runCatching {
            taskEditIntent().changes.entries.joinToString("\n") { (field, value) ->
                when (field) {
                    "checklistItems" -> "Checklist:\n" + decodeMobileChecklist(value.toString()).joinToString("\n") {
                        "${if (it.done) "☑" else "☐"} ${it.title}"
                    }.ifEmpty { "項目なし" }
                    "schedule" -> (value as? JsonObject)?.let { fields ->
                        fun label(key: String) = fields[key]?.takeUnless { it == JsonNull }?.jsonPrimitive?.content ?: "未指定"
                        "予定: 開始 ${label("startDate")}・期限 ${label("endDate")}" +
                            when (label("rangeSemantics")) { "ongoing" -> "（期間中継続）"; "once_within_window" -> "（期間内に一度）"; else -> "" }
                    } ?: "予定: 未指定"
                    "plannedSchedule" -> value.jsonObject.let { fields ->
                        val time = fields["startTime"]?.takeUnless { it == JsonNull }?.jsonPrimitive?.content ?: "未指定"
                        val duration = fields["durationMinutes"]?.takeUnless { it == JsonNull }?.jsonPrimitive?.content?.let { "${it}分" } ?: "未指定"
                        "時刻: $time・所要時間: $duration"
                    }
                    else -> {
                        val label = when (field) { "title" -> "名前"; "themeId" -> "Theme"; "todayDate" -> "今日の割当"; else -> field }
                        "$label: ${if (value == JsonNull) "未指定" else (value as? JsonPrimitive)?.content ?: value}"
                    }
                }
            }
        }.getOrDefault("保持している変更")
    }
    val reason = if (state == OutboxState.Rejected) runCatching {
        Json.parseToJsonElement(requireNotNull(lastError)).jsonObject.getValue("message").jsonPrimitive.content
    }.getOrDefault("PCが変更を受理しませんでした。") else "先行変更を確認してください。"
    return MobileHeldTaskChange(commandId, description, reason, state == OutboxState.Rejected)
}
