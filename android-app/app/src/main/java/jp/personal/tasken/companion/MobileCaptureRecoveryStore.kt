package jp.personal.tasken.companion

import android.util.AtomicFile
import android.util.Log
import java.io.File
import java.security.MessageDigest
import java.time.Instant
import kotlinx.serialization.Serializable
import kotlinx.serialization.encodeToString
import kotlinx.serialization.json.Json

data class MobileRecoveredInput(
    val id: String,
    val recoveredAt: String,
    val reason: String,
    val raw: String,
    val snapshot: MobileCaptureDraftSnapshot? = null,
) {
    val text: String get() = snapshot?.draft?.originalText ?: snapshot?.draft?.text ?: raw
    val byteCount: Int get() = raw.toByteArray(Charsets.UTF_8).size
}

/** Original preference value bytes stay private and are never included in diagnostics. */
internal class MobileCaptureRecoveryStore(
    private val directory: File,
    private val now: () -> Instant,
) {
    fun archive(raw: String, reason: String): Boolean = synchronized(StorageLock) {
        runCatching {
            check(directory.isDirectory || directory.mkdirs())
            val bytes = raw.toByteArray(Charsets.UTF_8)
            val id = MessageDigest.getInstance("SHA-256").digest(bytes).joinToString("") { "%02x".format(it) }
            val original = AtomicFile(File(directory, "$id.draft"))
            if (!runCatching { original.readFully().contentEquals(bytes) }.getOrDefault(false)) {
                write(original, bytes)
            }
            check(original.readFully().contentEquals(bytes))
            val metadata = AtomicFile(File(directory, "$id.json"))
            if (!runCatching { Json.decodeFromString<RecoveryMetadata>(metadata.readFully().toString(Charsets.UTF_8)) }.isSuccess) {
                write(metadata, Json.encodeToString(RecoveryMetadata(now().toString(), reason)).toByteArray(Charsets.UTF_8))
            }
            Json.decodeFromString<RecoveryMetadata>(metadata.readFully().toString(Charsets.UTF_8))
            true
        }.getOrElse {
            Log.e("TaskenInputRecovery", "Failed to preserve a saved input")
            false
        }
    }

    fun list(): List<MobileRecoveredInput> = synchronized(StorageLock) {
        // AtomicFile may leave a .bak after an interrupted write; openRead restores it.
        return directory.listFiles().orEmpty().mapNotNull { file ->
            file.name.removeSuffix(".bak").takeIf { it.matches(Regex("[a-f0-9]{64}\\.draft")) }
        }.distinct().mapNotNull { name ->
            runCatching {
                val id = name.removeSuffix(".draft")
                val raw = AtomicFile(File(directory, name)).readFully().toString(Charsets.UTF_8)
                val metadata = runCatching {
                    Json.decodeFromString<RecoveryMetadata>(AtomicFile(File(directory, "$id.json")).readFully().toString(Charsets.UTF_8))
                }.getOrNull()
                MobileRecoveredInput(id, metadata?.recoveredAt.orEmpty(), metadata?.reason ?: "unreadable", raw)
            }.getOrElse {
                Log.e("TaskenInputRecovery", "Failed to read a recovered input")
                null
            }
        }.sortedByDescending { it.recoveredAt }
    }

    fun delete(id: String): Boolean = synchronized(StorageLock) {
        if (!id.matches(Regex("[a-f0-9]{64}"))) return false
        return runCatching {
            AtomicFile(File(directory, "$id.draft")).delete()
            check(!File(directory, "$id.draft").exists() && !File(directory, "$id.draft.bak").exists())
            AtomicFile(File(directory, "$id.json")).delete()
            true
        }.getOrDefault(false)
    }

    private fun write(file: AtomicFile, bytes: ByteArray) {
        val output = file.startWrite()
        try {
            output.write(bytes)
            file.finishWrite(output)
        } catch (error: Exception) {
            file.failWrite(output)
            throw error
        }
    }

    private companion object {
        val StorageLock = Any()
    }
}

@Serializable
private data class RecoveryMetadata(val recoveredAt: String, val reason: String)
