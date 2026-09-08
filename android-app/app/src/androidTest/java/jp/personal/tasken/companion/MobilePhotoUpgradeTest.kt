package jp.personal.tasken.companion

import android.content.Context
import android.graphics.Bitmap
import androidx.room.Room
import androidx.room.testing.MigrationTestHelper
import androidx.test.core.app.ApplicationProvider
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import java.io.File
import java.time.Instant
import java.util.UUID
import kotlinx.coroutines.runBlocking
import kotlinx.serialization.json.jsonPrimitive
import org.junit.Assert.*
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith

/** Fixed v0.1.53 (072aea9f) storage shapes, independent of the current encoders. */
@RunWith(AndroidJUnit4::class)
class MobilePhotoUpgradeTest {
    @get:Rule
    val migrations = MigrationTestHelper(InstrumentationRegistry.getInstrumentation(), MobileLocalDatabase::class.java)
    private val context: Context get() = ApplicationProvider.getApplicationContext()
    private val at = "2026-09-08T01:00:00Z"

    private fun oldDraft(photos: String) = """{"schemaVersion":1,"savedAt":"$at","captureOpen":true,"draftId":"old-53-draft","text":"写真も原文も残す","kind":"capture","projectId":null,"source":"android_app","speechRecognitionMode":null,"speechLanguage":null,"speechConfidence":null,"speechSourceAudioAvailable":false,"sharedMimeType":null,"createdAt":"$at","organization":null,"additionalOrganizations":[],"originalText":null,"speechCapturedAt":null,"speechTimeZone":null,"originalThemeId":null,"photoFileNames":$photos}"""

    @Test
    fun oldDraftWithEmptyOrPopulatedPhotoNamesRestoresNormally() {
        val preferences = context.getSharedPreferences("tasken-mobile-input-recovery", Context.MODE_PRIVATE)
        val recovery = File(context.cacheDir, "photo-upgrade-${UUID.randomUUID()}")
        try {
            for (names in listOf("[]", "[\"capture-old53.jpg\"]")) {
                val raw = oldDraft(names)
                assertTrue(preferences.edit().putString("capture-draft-v1", raw).commit())
                val store = MobileCaptureDraftStore(context, { Instant.parse(at).plusSeconds(60) }, recovery)
                val loaded = requireNotNull(store.load())
                assertTrue(loaded.captureOpen)
                assertEquals("old-53-draft", loaded.draft.draftId)
                assertEquals("写真も原文も残す", loaded.draft.text)
                assertEquals(MobileCaptureKind.Capture, loaded.draft.kind)
                assertEquals(if (names == "[]") emptyList() else listOf(MobileCapturePhoto("capture-old53.jpg")), loaded.draft.photos)
                assertTrue(store.recoveredInputs().isEmpty())
                assertEquals(raw, preferences.getString("capture-draft-v1", null))
                assertTrue(store.save(loaded))
                assertEquals(loaded, MobileCaptureDraftStore(context, { Instant.parse(at).plusSeconds(120) }, recovery).load())
            }
        } finally {
            preferences.edit().remove("capture-draft-v1").commit()
            recovery.deleteRecursively()
        }
    }

    @Test
    fun expiredDraftRecoveryKeepsItsPhotoBytesAcrossStoreRecreation() {
        val preferences = context.getSharedPreferences("tasken-mobile-input-recovery", Context.MODE_PRIVATE)
        val recovery = File(context.cacheDir, "photo-upgrade-${UUID.randomUUID()}")
        val photos = MobileCapturePhotoStore(context)
        val name = photos.createPhotoFile()
        val file = File(context.filesDir, "capture-photos/$name")
        try {
            val bitmap = Bitmap.createBitmap(2, 2, Bitmap.Config.ARGB_8888)
            try { file.outputStream().use { assertTrue(bitmap.compress(Bitmap.CompressFormat.JPEG, 80, it)) } }
            finally { bitmap.recycle() }
            val bytes = file.readBytes()
            assertTrue(file.setLastModified(Instant.now().minusSeconds(9 * 86400).toEpochMilli()))
            val raw = oldDraft("[\"$name\"]")
            assertTrue(preferences.edit().putString("capture-draft-v1", raw).commit())
            val expiredAt = Instant.parse(at).plusSeconds(8 * 86400)
            val store = MobileCaptureDraftStore(context, { expiredAt }, recovery)
            assertNull(store.load())
            val entry = store.recoveredInputs().single()
            assertEquals(raw, entry.raw)
            val recreatedPhotos = MobileCapturePhotoStore(context)
            assertTrue(recreatedPhotos.hasPhoto(name))
            assertArrayEquals(bytes, file.readBytes())
            val reopened = MobileCaptureDraftStore(context, { expiredAt }, recovery)
            val restored = requireNotNull(reopened.restoreRecoveredInput(entry.id))
            assertEquals(listOf(MobileCapturePhoto(name)), restored.draft.photos)
            assertEquals("写真も原文も残す", restored.draft.text)
            assertEquals(restored, MobileCaptureDraftStore(context, { expiredAt }, recovery).load())
            assertTrue(recreatedPhotos.encodePhotos(listOf(name)).single().dataBase64.isNotEmpty())
            assertEquals(raw, reopened.recoveredInputs().single().raw)
        } finally {
            preferences.edit().remove("capture-draft-v1").commit()
            photos.deletePhotos(listOf(name))
            recovery.deleteRecursively()
        }
    }

    @Test
    fun oldPhotoOutboxMigratesRetriesAndAppliesReceiptsBeforeFollowingEdits() = runBlocking {
        val databaseName = "photo-upgrade-${UUID.randomUUID()}.db"
        // The image bytes are a fixed synthetic PNG; no user image or current encoder is used.
        val image = """{"reference_id":"photo-1","file_name":"capture-old53.jpg","media_type":"image/png","data_base64":"iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jY9sAAAAASUVORK5CYII="}"""
        fun oldEnvelope(kind: String) = """{"apiVersion":1,"schemaVersion":7,"requestId":"old-$kind-request","commandId":"old-$kind-command","idempotencyKey":"old-$kind-command","clientDeviceId":"old-53-device","issuedAt":"$at","command":{"name":"Create$kind","${kind.lowercase()}":${if (kind == "Task") """{"id":"old-task","title":"写真も原文も残す","projectId":null,"state":"todo","priority":"normal","requester":"self","intendedExecutor":"self","todayDate":null,"images":[$image]}""" else """{"id":"old-capture","text":"写真も原文も残す","projectId":null,"capturedAt":"$at","textContract":"verbatim-utf16-12000","images":[$image]}"""},"provenance":{"reportedVia":"android_app","capturedAt":"$at","captureMethod":null,"recognitionMode":null,"language":null,"confidence":null,"sourceAudioAvailable":null,"sharedMimeType":null}}}"""
        val rawTask = oldEnvelope("Task")
        val rawCapture = oldEnvelope("Capture")
        var database: MobileLocalDatabase? = null
        try {
            migrations.createDatabase(databaseName, 23).use { db ->
                db.execSQL("INSERT INTO sync_state(id,serverId,apiVersion,schemaVersion) VALUES (1,'server-1',1,7)")
                db.execSQL("INSERT INTO task_cache(id,title,state,updatedAt,optimisticCommandId,checklistJson) VALUES ('old-task','写真も原文も残す','todo',?,'old-Task-command','[]')", arrayOf(at))
                db.execSQL("INSERT INTO capture_receipt(id,capturedAt,optimisticCommandId) VALUES ('old-capture',?,'old-Capture-command')", arrayOf(at))
                for ((kind, raw) in listOf("Task" to rawTask, "Capture" to rawCapture)) {
                    db.execSQL("INSERT INTO outbox_command(commandId,idempotencyKey,requestId,clientDeviceId,issuedAt,commandName,envelopeJson,serverId,state,attemptCount,createdAt,${kind.lowercase()}Id) VALUES (?,?,?,'old-53-device',?,? ,?,'server-1','pending',0,?,?)",
                        arrayOf("old-$kind-command", "old-$kind-command", "old-$kind-request", at, "Create$kind", raw, at, "old-${kind.lowercase()}"))
                }
            }
            migrations.runMigrationsAndValidate(databaseName, 25, true, MIGRATION_23_24, MIGRATION_24_25).close()
            fun open() = Room.databaseBuilder(context, MobileLocalDatabase::class.java, databaseName).build()
            database = open()
            var dao = database.mobileDao()
            fun outbox() = MobileOutbox(context, dao, { "old-53-device" }, { Instant.parse(at).plusSeconds(2 * 86400) }, schedule = {})
            assertEquals(rawTask, dao.outbox("old-Task-command")?.envelopeJson)
            assertEquals(rawCapture, dao.outbox("old-Capture-command")?.envelopeJson)
            assertTrue(requireNotNull(dao.outbox("old-Task-command")).isUnsentCreate())
            assertEquals("old-Task-command", outbox().enqueueUpdateTitle("old-task", "送信前の修正"))
            val taskBeforeSend = requireNotNull(dao.outbox("old-Task-command")).envelopeJson
            val originalImages = MobileTaskCommandContract.decodeCreateEnvelope(rawTask).command.task.images
            assertEquals(originalImages, MobileTaskCommandContract.decodeCreateEnvelope(taskBeforeSend).command.task.images)
            val sentCreates = mutableListOf<String>()
            assertTrue(outbox().drain("server-1") { payload ->
                if (payload == rawCapture) {
                    assertEquals(originalImages, MobileCaptureCommandContract.decodeCreateEnvelope(payload).command.capture.images)
                    MobileCommandSendResult.CaptureApplied(captureReceipt())
                } else {
                    assertEquals(taskBeforeSend, payload)
                    sentCreates += payload
                    MobileCommandSendResult.Retry("応答喪失")
                }
            })
            val follow = outbox().enqueueUpdateTitle("old-task", "送信後の修正")
            assertEquals("old-Task-command", dao.outbox(follow)?.dependsOnCommandId)
            val complete = requireNotNull(outbox().enqueueComplete("old-task").commandId)
            database.close()
            database = open()
            dao = database.mobileDao()
            assertEquals(taskBeforeSend, dao.outbox("old-Task-command")?.envelopeJson)
            assertEquals("送信後の修正", dao.task("old-task")?.title)
            assertEquals("done", dao.task("old-task")?.state)
            assertFalse(outbox().drain("server-1") { payload ->
                when {
                    payload == rawCapture -> MobileCommandSendResult.CaptureApplied(captureReceipt())
                    payload == taskBeforeSend -> {
                        sentCreates += payload
                        MobileCommandSendResult.Applied(taskReceipt("old-Task-command", "送信前の修正", 1))
                    }
                    payload.contains("CompleteTask") -> {
                        val envelope = MobileTaskCommandContract.decodeStateEnvelope(payload)
                        assertEquals(complete, envelope.commandId)
                        assertEquals(2, envelope.command.expectedVersion)
                        MobileCommandSendResult.Applied(taskReceipt(complete, "送信後の修正", 3, "done"))
                    }
                    else -> {
                        val envelope = MobileTaskCommandContract.decodeUpdateEnvelope(payload)
                        assertEquals(follow, envelope.commandId)
                        assertEquals(1, envelope.command.expectedVersion)
                        assertEquals("送信後の修正", envelope.command.changes.getValue("title").jsonPrimitive.content)
                        MobileCommandSendResult.Applied(taskReceipt(follow, "送信後の修正", 2))
                    }
                }
            })
            assertEquals(listOf(taskBeforeSend, taskBeforeSend), sentCreates)
            assertEquals(0, dao.outboxCount())
            database.close()
            database = open()
            dao = database.mobileDao()
            assertEquals("送信後の修正", dao.task("old-task")?.title)
            assertEquals("done", dao.task("old-task")?.state)
            assertEquals(3, dao.task("old-task")?.serverVersion)
            assertEquals(1, dao.captureReceipt("old-capture")?.serverVersion)
            assertEquals(0, dao.outboxCount())
        } finally {
            database?.close()
            context.deleteDatabase(databaseName)
        }
    }

    private fun meta() = MobileResponseMetaDto(1, 7, "server-1", 10, at, false)
    private fun taskReceipt(command: String, title: String, version: Int, state: String = "todo") = MobileTaskCommandResponseDto(
        true, meta(), MobileTaskCommandReceiptDto(command, "applied", MobileTaskSummaryDto(
            id = "old-task", version = version, title = title, themeId = null, state = state, workState = null, todayDate = null, schedule = null, updatedAt = at,
        )),
    )
    private fun captureReceipt() = MobileCaptureCommandResponseDto(true, meta(), MobileCaptureCommandReceiptDto(
        "old-Capture-command", "applied", MobileCaptureReceiptDto("old-capture", 1, at, false),
    ))
}
