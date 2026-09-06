package jp.personal.tasken.companion

import android.content.Context
import android.util.Log
import java.io.File
import java.time.Duration
import java.time.Instant
import java.util.UUID
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
    recoveryDirectory: File = File(context.applicationContext.filesDir, "capture-draft-recovery"),
) {
    private val recovery = MobileCaptureRecoveryStore(recoveryDirectory, now)
    private val preferences = context.applicationContext.getSharedPreferences(
        PreferencesName,
        Context.MODE_PRIVATE,
    )
    private val json = Json {
        ignoreUnknownKeys = false
        encodeDefaults = true
        explicitNulls = true
    }

    fun load(): MobileCaptureDraftSnapshot? = synchronized(StorageLock) {
        val encoded = preferences.getString(SnapshotKey, null) ?: return null
        val stored = decode(encoded)
        if (stored == null || isExpired(Instant.parse(stored.savedAt))) {
            if (recovery.archive(encoded, if (stored == null) "unreadable" else "expired")) {
                if (!preferences.edit().remove(SnapshotKey).commit()) {
                    Log.e(LogTag, "Failed to remove a preserved input source")
                }
            }
            return null
        }
        return stored.toSnapshot()
    }

    fun recoveredInputs(): List<MobileRecoveredInput> = recovery.list().map { entry ->
        entry.copy(snapshot = decode(entry.raw)?.toSnapshot())
    }

    fun deleteRecoveredInput(id: String): Boolean = recovery.delete(id)

    fun restoreRecoveredInput(id: String): MobileCaptureDraftSnapshot? = synchronized(StorageLock) {
        val current = load()
        if (current != null && (current.draft.text.isNotEmpty() || !current.draft.originalText.isNullOrEmpty())) return null
        val entry = recoveredInputs().firstOrNull { it.id == id } ?: return null
        val draft = entry.snapshot?.draft?.copy(draftId = UUID.randomUUID().toString())
            ?: MobileCaptureDraft.fresh(text = entry.raw, now = now)
        val restored = MobileCaptureDraftSnapshot(draft, captureOpen = true)
        return restored.takeIf { save(it) }
    }

    private fun decode(encoded: String): StoredCaptureDraftSnapshot? = runCatching {
        json.decodeFromString<StoredCaptureDraftSnapshot>(encoded).also {
            require(it.schemaVersion == SchemaVersion)
            Instant.parse(it.savedAt)
            it.toSnapshot()
        }
    }.getOrNull()

    // A failed quarantine must also block subsequent autosave/clear from replacing the source.
    private fun preserveBeforeReplacing(): Boolean {
        val encoded = preferences.getString(SnapshotKey, null) ?: return true
        val stored = decode(encoded)
        if (stored != null && !isExpired(Instant.parse(stored.savedAt))) return true
        return recovery.archive(encoded, if (stored == null) "unreadable" else "expired")
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

    fun save(snapshot: MobileCaptureDraftSnapshot): Boolean = synchronized(StorageLock) {
        if (!preserveBeforeReplacing()) return false
        if (!snapshot.captureOpen && snapshot.draft.text.isEmpty() && snapshot.draft.originalText.isNullOrEmpty()) {
            return clear()
        }
        return runCatching {
            val stored = StoredCaptureDraftSnapshot.from(snapshot, now().toString())
            preferences.edit().putString(SnapshotKey, json.encodeToString(stored)).commit()
        }.onFailure {
            Log.e(LogTag, "Failed to persist a Capture Draft")
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

    fun clear(): Boolean = synchronized(StorageLock) {
        (preserveBeforeReplacing() && preferences.edit().remove(SnapshotKey).commit()).also { cleared ->
            if (!cleared) Log.e(LogTag, "Failed to clear a saved Capture Draft")
        }
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
        // Activity recreation can briefly leave two store instances alive.
        val StorageLock = Any()
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
    val projectId: String? = null,
    val source: String,
    val speechRecognitionMode: String? = null,
    val speechLanguage: String? = null,
    val speechConfidence: Float? = null,
    val speechSourceAudioAvailable: Boolean = false,
    val sharedMimeType: String? = null,
    val createdAt: String,
    val organization: MobileCaptureOrganization? = null,
    val additionalOrganizations: List<MobileCaptureOrganization> = emptyList(),
    val originalText: String? = null,
    val speechCapturedAt: String? = null,
    val speechTimeZone: String? = null,
    val originalThemeId: String? = null,
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
                        capturedAt = speechCapturedAt,
                        timeZone = speechTimeZone,
                    )
                },
                share = sharedMimeType?.let(::MobileShareProvenance),
                createdAt = createdAt,
                organization = organization,
                additionalOrganizations = additionalOrganizations,
                originalText = originalText,
                originalThemeId = originalThemeId,
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
                organization = draft.organization,
                additionalOrganizations = draft.additionalOrganizations,
                originalText = draft.originalText,
                originalThemeId = draft.originalThemeId,
                speechCapturedAt = draft.speech?.capturedAt,
                speechTimeZone = draft.speech?.timeZone,
            )
        }
    }
}
