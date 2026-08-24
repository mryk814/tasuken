package jp.personal.tasken.companion

import android.content.Context
import android.util.Log
import java.time.Duration
import java.time.Instant
import kotlinx.serialization.Serializable
import kotlinx.serialization.decodeFromString
import kotlinx.serialization.encodeToString
import kotlinx.serialization.json.Json

data class MobileCaptureDraftSnapshot(
    val draft: MobileCaptureDraft,
    val captureOpen: Boolean,
)

data class MobileCaptureUndoTarget(
    val entityId: String,
    val kind: MobileCaptureKind,
) {
    init {
        require(entityId.isNotBlank())
    }
}

class MobileCaptureDraftStore(
    context: Context,
    private val now: () -> Instant = Instant::now,
) {
    private val preferences = context.applicationContext.getSharedPreferences(
        PreferencesName,
        Context.MODE_PRIVATE,
    )
    private val json = Json {
        ignoreUnknownKeys = false
        encodeDefaults = true
        explicitNulls = true
    }

    @Synchronized
    fun load(): MobileCaptureDraftSnapshot? {
        val encoded = preferences.getString(SnapshotKey, null) ?: return null
        val stored = runCatching { json.decodeFromString<StoredCaptureDraftSnapshot>(encoded) }
            .getOrElse {
                Log.w(LogTag, "Discarding an invalid saved Capture Draft", it)
                clear()
                return null
            }
        val savedAt = runCatching { Instant.parse(stored.savedAt) }.getOrNull()
        if (stored.schemaVersion != SchemaVersion || savedAt == null || isExpired(savedAt)) {
            clear()
            return null
        }
        return runCatching { stored.toSnapshot() }
            .getOrElse {
                Log.w(LogTag, "Discarding an inconsistent saved Capture Draft", it)
                clear()
                null
            }
    }

    @Synchronized
    fun loadUndoTarget(): MobileCaptureUndoTarget? {
        val encoded = preferences.getString(UndoTargetKey, null) ?: return null
        val stored = runCatching { json.decodeFromString<StoredCaptureUndoTarget>(encoded) }
            .getOrElse {
                Log.w(LogTag, "Discarding an invalid saved Capture Undo target", it)
                clearUndoTarget()
                return null
            }
        val savedAt = runCatching { Instant.parse(stored.savedAt) }.getOrNull()
        if (stored.schemaVersion != SchemaVersion || savedAt == null || isUndoTargetExpired(savedAt)) {
            clearUndoTarget()
            return null
        }
        return runCatching {
            MobileCaptureUndoTarget(
                entityId = stored.entityId,
                kind = MobileCaptureKind.entries.single { it.wireValue == stored.kind },
            )
        }.getOrElse {
            Log.w(LogTag, "Discarding an inconsistent saved Capture Undo target", it)
            clearUndoTarget()
            null
        }
    }

    @Synchronized
    fun save(snapshot: MobileCaptureDraftSnapshot): Boolean {
        if (!snapshot.captureOpen && snapshot.draft.text.isBlank()) {
            return clear()
        }
        return runCatching {
            val stored = StoredCaptureDraftSnapshot.from(snapshot, now().toString())
            preferences.edit().putString(SnapshotKey, json.encodeToString(stored)).commit()
        }.onFailure { error ->
            Log.e(LogTag, "Failed to persist a Capture Draft", error)
        }.getOrDefault(false)
    }

    @Synchronized
    fun saveUndoTarget(target: MobileCaptureUndoTarget): Boolean = runCatching {
        val stored = StoredCaptureUndoTarget(
            schemaVersion = SchemaVersion,
            savedAt = now().toString(),
            entityId = target.entityId,
            kind = target.kind.wireValue,
        )
        preferences.edit().putString(UndoTargetKey, json.encodeToString(stored)).commit()
    }.onFailure { error ->
        Log.e(LogTag, "Failed to persist a Capture Undo target", error)
    }.getOrDefault(false)

    @Synchronized
    fun clear(): Boolean = preferences.edit().remove(SnapshotKey).commit().also { cleared ->
        if (!cleared) Log.e(LogTag, "Failed to clear a saved Capture Draft")
    }

    @Synchronized
    fun clearUndoTarget(): Boolean = preferences.edit().remove(UndoTargetKey).commit().also { cleared ->
        if (!cleared) Log.e(LogTag, "Failed to clear a saved Capture Undo target")
    }

    private fun isExpired(savedAt: Instant): Boolean {
        val age = Duration.between(savedAt, now())
        return age > DraftRetention
    }

    private fun isUndoTargetExpired(savedAt: Instant): Boolean {
        val age = Duration.between(savedAt, now())
        return age > UndoTargetRetention
    }

    private companion object {
        const val PreferencesName = "tasken-mobile-input-recovery"
        const val SnapshotKey = "capture-draft-v1"
        const val UndoTargetKey = "capture-undo-target-v1"
        const val SchemaVersion = 1
        const val LogTag = "TaskenInputRecovery"
        val DraftRetention: Duration = Duration.ofDays(7)
        val UndoTargetRetention: Duration = Duration.ofDays(1)
    }
}

@Serializable
private data class StoredCaptureUndoTarget(
    val schemaVersion: Int,
    val savedAt: String,
    val entityId: String,
    val kind: String,
)

@Serializable
private data class StoredCaptureDraftSnapshot(
    val schemaVersion: Int,
    val savedAt: String,
    val captureOpen: Boolean,
    val draftId: String,
    val text: String,
    val kind: String,
    val projectId: String?,
    val source: String,
    val speechRecognitionMode: String?,
    val speechLanguage: String?,
    val speechConfidence: Float?,
    val speechSourceAudioAvailable: Boolean,
    val sharedMimeType: String?,
    val createdAt: String,
) {
    fun toSnapshot(): MobileCaptureDraftSnapshot {
        val captureKind = MobileCaptureKind.entries.single { it.wireValue == kind }
        val captureSource = MobileCaptureSource.entries.single { it.wireValue == source }
        return MobileCaptureDraftSnapshot(
            draft = MobileCaptureDraft(
                draftId = draftId,
                text = text,
                kind = captureKind,
                projectId = projectId,
                source = captureSource,
                speech = speechRecognitionMode?.let { recognitionMode ->
                    MobileSpeechProvenance(
                        recognitionMode = MobileSpeechRecognitionMode.entries.single {
                            it.wireValue == recognitionMode
                        },
                        language = requireNotNull(speechLanguage),
                        confidence = speechConfidence,
                        sourceAudioAvailable = speechSourceAudioAvailable,
                    )
                },
                share = sharedMimeType?.let(::MobileShareProvenance),
                createdAt = createdAt,
            ),
            captureOpen = captureOpen,
        )
    }

    companion object {
        fun from(snapshot: MobileCaptureDraftSnapshot, savedAt: String): StoredCaptureDraftSnapshot {
            val draft = snapshot.draft
            return StoredCaptureDraftSnapshot(
                schemaVersion = 1,
                savedAt = savedAt,
                captureOpen = snapshot.captureOpen,
                draftId = draft.draftId,
                text = draft.text,
                kind = draft.kind.wireValue,
                projectId = draft.projectId,
                source = draft.source.wireValue,
                speechRecognitionMode = draft.speech?.recognitionMode?.wireValue,
                speechLanguage = draft.speech?.language,
                speechConfidence = draft.speech?.confidence,
                speechSourceAudioAvailable = draft.speech?.sourceAudioAvailable ?: false,
                sharedMimeType = draft.share?.mimeType,
                createdAt = draft.createdAt,
            )
        }
    }
}
