package jp.personal.tasken.companion

import android.content.Context
import java.time.Instant
import java.time.LocalDate
import java.time.OffsetDateTime
import java.util.UUID
import kotlinx.coroutines.flow.Flow
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive

internal const val MOBILE_WORK_LOG_SCOPE = "mobile:work-log-write"
internal const val MOBILE_WORK_LOG_BODY_LIMIT = 12_000

@Serializable
data class MobileWorkLogDraft(
    val id: String = UUID.randomUUID().toString(),
    val body: String = "",
    val performedDate: String = LocalDate.now().toString(),
    val enteredAt: String = Instant.now().toString(),
    val themeId: String? = null,
    val taskId: String? = null,
)

@Serializable
data class MobileWorkLogDto(
    val id: String,
    val version: Int,
    val body: String,
    val performedDate: String,
    val enteredAt: String,
    val themeId: String?,
    val taskId: String?,
    val taskMissing: Boolean,
    val deleted: Boolean,
)

@Serializable
data class MobileWorkLogEnvelope(
    val apiVersion: Int = TASKEN_MOBILE_API_VERSION,
    val schemaVersion: Int = TASKEN_MOBILE_SCHEMA_VERSION,
    val requestId: String,
    val commandId: String,
    val idempotencyKey: String,
    val clientDeviceId: String,
    val issuedAt: String,
    val command: JsonObject,
)

@Serializable
data class MobileWorkLogResponse(val ok: Boolean, val meta: MobileResponseMetaDto, val data: MobileWorkLogResponseData)
@Serializable
data class MobileWorkLogResponseData(val commandId: String, val status: String, val workLog: MobileWorkLogDto)
@Serializable
data class MobileWorkLogReadResponse(val ok: Boolean, val meta: MobileResponseMetaDto, val data: MobileWorkLogReadData)
@Serializable
data class MobileWorkLogReadData(val workLog: MobileWorkLogDto?)

internal object MobileWorkLogContract {
    val json = Json { encodeDefaults = true; ignoreUnknownKeys = false }

    fun validateDraft(draft: MobileWorkLogDraft) {
        require(draft.id.isNotBlank())
        require(draft.body.isNotBlank() && draft.body.length <= MOBILE_WORK_LOG_BODY_LIMIT) { "本文は1〜12,000文字で入力してください。" }
        // UTF-8 transport must never silently replace an unpaired UTF-16 surrogate.
        require(draft.body.toByteArray(Charsets.UTF_8).toString(Charsets.UTF_8) == draft.body) { "本文に送信できない文字が含まれています。入力は保持しています。" }
        require(LocalDate.parse(draft.performedDate).toString() == draft.performedDate)
        OffsetDateTime.parse(draft.enteredAt)
    }

    fun record(draft: MobileWorkLogDraft, deviceId: String): MobileWorkLogEnvelope {
        validateDraft(draft)
        return MobileWorkLogEnvelope(
            requestId = "work-log-${draft.id}", commandId = draft.id, idempotencyKey = draft.id,
            clientDeviceId = deviceId, issuedAt = draft.enteredAt,
            command = buildJsonObject {
                put("name", "RecordWorkLog"); put("body", draft.body); put("performedDate", draft.performedDate)
                put("themeId", draft.themeId); put("taskId", draft.taskId)
            },
        )
    }

    fun decodeReceipt(body: String): MobileWorkLogResponse = json.decodeFromString<MobileWorkLogResponse>(body).also {
        require(it.ok && it.meta.apiVersion == TASKEN_MOBILE_API_VERSION && it.meta.schemaVersion == TASKEN_MOBILE_SCHEMA_VERSION)
        require(it.data.status in setOf("applied", "no_change"))
        validateProjection(it.data.workLog)
    }

    fun validateProjection(value: MobileWorkLogDto) {
        require(value.id.isNotBlank() && value.version > 0)
        // A Note edited on Desktop may be empty or longer than the mobile input limit.
        require(value.body.toByteArray(Charsets.UTF_8).toString(Charsets.UTF_8) == value.body)
        require(LocalDate.parse(value.performedDate).toString() == value.performedDate)
        OffsetDateTime.parse(value.enteredAt)
    }
}

/** A display cache of the Desktop Note, including the locally accepted input before sync. */
data class MobileWorkLog(val record: WorkLogCacheEntity, val pending: OutboxCommandEntity?, val organization: WorkLogOrganizationEntity? = null) {
    val status: String get() = when (pending?.state) {
        OutboxState.Rejected -> "端末に保存済み・送信を確認してください"
        OutboxState.Sending -> "端末に保存済み・送信中"
        null -> if (record.deleted) "削除済み" else if (record.serverVersion == null) "端末に保存済み" else "Desktopに保存済み"
        else -> when (pending.commandName) {
            "DeleteWorkLog" -> "本文を保持しています・削除の送信待ち"
            "RestoreWorkLog" -> "本文を保持しています・復元の送信待ち"
            else -> "端末に保存済み・送信待ち"
        }
    }
    val errorMessage: String? get() = pending?.lastError?.let { encoded ->
        runCatching { Json.parseToJsonElement(encoded).jsonObject["message"]?.jsonPrimitive?.content }.getOrNull()
            ?: encoded
    }
}

interface MobileWorkLogRepository {
    fun observeWorkLogs(): Flow<List<MobileWorkLog>>
    suspend fun recordWorkLog(draft: MobileWorkLogDraft): String
    suspend fun deleteWorkLog(id: String)
    suspend fun restoreWorkLog(id: String)
    suspend fun retryWorkLog(id: String)
    suspend fun refreshWorkLog(id: String)
}

/** A separate draft key prevents a work log from replacing an unfinished Capture. */
internal class MobileWorkLogDraftStore(context: Context) {
    private val preferences = context.getSharedPreferences("tasken_mobile_work_log_draft", Context.MODE_PRIVATE)
    fun load(): MobileWorkLogDraft? = preferences.getString("draft", null)?.let {
        MobileWorkLogContract.json.decodeFromString<MobileWorkLogDraft>(it)
    }
    fun save(draft: MobileWorkLogDraft): Boolean = preferences.edit()
        .putString("draft", MobileWorkLogContract.json.encodeToString(draft)).commit()
    fun clear(): Boolean = preferences.edit().remove("draft").commit()
}
