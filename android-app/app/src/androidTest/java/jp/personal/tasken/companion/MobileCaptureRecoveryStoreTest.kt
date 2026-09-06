package jp.personal.tasken.companion

import android.content.Context
import android.content.ContextWrapper
import android.content.SharedPreferences
import androidx.test.core.app.ApplicationProvider
import androidx.test.ext.junit.runners.AndroidJUnit4
import java.io.File
import java.time.Instant
import java.util.UUID
import java.util.concurrent.CountDownLatch
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit
import java.util.concurrent.TimeoutException
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.jsonObject
import org.junit.After
import org.junit.Assert.*
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith

@RunWith(AndroidJUnit4::class)
class MobileCaptureRecoveryStoreTest {
    private lateinit var context: Context
    private lateinit var directory: File
    private val savedAt = Instant.parse("2026-08-01T10:00:00Z")
    private val expiredAt = Instant.parse("2026-08-09T10:00:00Z")
    private val preferences get() = context.getSharedPreferences("tasken-mobile-input-recovery", Context.MODE_PRIVATE)

    @Before
    fun setUp() {
        context = ApplicationProvider.getApplicationContext()
        directory = File(context.cacheDir, "recovery-test-${UUID.randomUUID()}")
        preferences.edit().clear().commit()
    }

    @After
    fun tearDown() {
        preferences.edit().clear().commit()
        directory.deleteRecursively()
    }

    private fun store(time: Instant = savedAt) = MobileCaptureDraftStore(context, { time }, directory)
    private fun snapshot(text: String = "研究メモ\n改行と長文を保持") = MobileCaptureDraftSnapshot(
        MobileCaptureDraft.fresh(text = text, now = { savedAt }), true,
    )
    private fun raw() = requireNotNull(preferences.getString("capture-draft-v1", null))
    private fun putRaw(raw: String) { assertTrue(preferences.edit().putString("capture-draft-v1", raw).commit()) }

    @Test
    fun recreatingStoreCannotRemoveInputSavedByAnotherInstance() {
        val original = snapshot("古い入力")
        assertTrue(store().save(original))
        val removing = CountDownLatch(1)
        val releaseRemoval = CountDownLatch(1)
        val saving = CountDownLatch(1)
        val sourcePreferences = preferences
        val delayedContext = object : ContextWrapper(context) {
            override fun getApplicationContext(): Context = this
            override fun getSharedPreferences(name: String, mode: Int): SharedPreferences =
                object : SharedPreferences by sourcePreferences {
                    override fun edit(): SharedPreferences.Editor {
                        val editor = sourcePreferences.edit()
                        return object : SharedPreferences.Editor by editor {
                            override fun remove(key: String?): SharedPreferences.Editor {
                                if (key == "capture-draft-v1") {
                                    removing.countDown()
                                    check(releaseRemoval.await(5, TimeUnit.SECONDS))
                                }
                                editor.remove(key)
                                return this
                            }
                        }
                    }
                }
        }
        val workers = Executors.newFixedThreadPool(2)
        try {
            val loading = workers.submit(java.util.concurrent.Callable {
                MobileCaptureDraftStore(delayedContext, { expiredAt }, directory).load()
            })
            assertTrue(removing.await(5, TimeUnit.SECONDS))
            val replacement = snapshot("別の画面で保存した入力")
            val save = workers.submit(java.util.concurrent.Callable {
                saving.countDown()
                store(expiredAt).save(replacement)
            })
            assertTrue(saving.await(5, TimeUnit.SECONDS))
            assertThrows(TimeoutException::class.java) { save.get(150, TimeUnit.MILLISECONDS) }
            releaseRemoval.countDown()
            assertNull(loading.get(5, TimeUnit.SECONDS))
            assertTrue(save.get(5, TimeUnit.SECONDS))
            assertEquals(replacement, store(expiredAt).load())
            assertEquals(original, store(expiredAt).recoveredInputs().single().snapshot)
        } finally {
            releaseRemoval.countDown()
            workers.shutdownNow()
        }
    }

    @Test
    fun expiredLongDraftRemainsReadableAcrossRestartWithoutDuplicateArchive() {
        val snapshot = snapshot("長文\n😀".repeat(12_000))
        assertTrue(store().save(snapshot))
        val original = raw()
        val expiredStore = store(expiredAt)
        assertNull(expiredStore.load())
        val entry = store(expiredAt).recoveredInputs().single()
        assertEquals(original, entry.raw)
        assertEquals(snapshot, entry.snapshot)
        assertEquals(snapshot.draft.text, entry.text)
        putRaw(original) // interruption after archive, before removing the source
        assertNull(store(expiredAt).load())
        assertEquals(1, store(expiredAt).recoveredInputs().size)
        assertNull(preferences.getString("capture-draft-v1", null))
        assertTrue(store(expiredAt).deleteRecoveredInput(entry.id))
        assertTrue(store(expiredAt).recoveredInputs().isEmpty())
    }

    @Test
    fun unknownSchemaAndBrokenJsonPreserveExactOriginalBytes() {
        store().save(snapshot())
        val unknown = JsonObject(Json.parseToJsonElement(raw()).jsonObject + ("schemaVersion" to JsonPrimitive(99))).toString()
        val broken = "{\"text\":\"原文😀\n切れたJSON"
        for (original in listOf(unknown, broken)) {
            putRaw(original)
            assertNull(store().load())
            val entry = store().recoveredInputs().single { it.raw == original }
            assertNull(entry.snapshot)
            assertEquals(original, entry.text)
            assertArrayEquals(original.toByteArray(Charsets.UTF_8), File(directory, "${entry.id}.draft").readBytes())
        }
        assertEquals(2, store().recoveredInputs().size)
    }

    @Test
    fun earlierV1DraftWithoutOrganizationFieldsStillLoads() {
        val snapshot = snapshot()
        store().save(snapshot)
        val optionalFields = setOf("organization", "additionalOrganizations", "originalText", "originalThemeId", "speechCapturedAt", "speechTimeZone")
        putRaw(JsonObject(Json.parseToJsonElement(raw()).jsonObject.filterKeys { it !in optionalFields }).toString())
        assertEquals(snapshot, store().load())
        assertTrue(store().recoveredInputs().isEmpty())
    }

    @Test
    fun failedArchiveBlocksAutosaveAndClearUntilOriginalIsSafe() {
        val original = "{broken input 原文"
        putRaw(original)
        directory.writeText("not a directory")
        assertNull(store().load())
        assertFalse(store().save(snapshot("新しい入力")))
        assertFalse(store().clear())
        assertEquals(original, raw())
        assertTrue(directory.delete())
        assertTrue(store().save(snapshot("新しい入力")))
        assertEquals(original, store().recoveredInputs().single().raw)
        assertEquals("新しい入力", store().load()?.draft?.text)
    }

    @Test
    fun interruptedAtomicWriteRetainsOriginalAndIsRecoveredOnce() {
        putRaw("{original")
        assertNull(store().load())
        val entry = store().recoveredInputs().single()
        val file = File(directory, "${entry.id}.draft")
        assertTrue(file.renameTo(File(directory, "${entry.id}.draft.bak")))
        file.writeText("interrupted replacement")
        assertEquals(entry.raw, store().recoveredInputs().single().raw)
        putRaw(entry.raw)
        assertNull(store().load())
        assertEquals(1, store().recoveredInputs().size)
    }

    @Test
    fun restorePersistsFreshDraftWithoutOverwritingCurrentInputOrDeletingArchive() {
        val original = snapshot("回復する原文")
        assertTrue(store().save(original))
        assertNull(store(expiredAt).load())
        val entry = store(expiredAt).recoveredInputs().single()
        val current = snapshot("編集中の原文")
        assertTrue(store(expiredAt).save(current))
        assertNull(store(expiredAt).restoreRecoveredInput(entry.id))
        assertEquals(current, store(expiredAt).load())
        assertTrue(store(expiredAt).clear())
        val restored = requireNotNull(store(expiredAt).restoreRecoveredInput(entry.id))
        assertEquals(original.draft.text, restored.draft.text)
        assertNotEquals(original.draft.draftId, restored.draft.draftId)
        assertTrue(restored.captureOpen)
        assertEquals(restored, store(expiredAt).load())
        assertEquals(1, store(expiredAt).recoveredInputs().size)
    }

    @Test
    fun whitespaceAndOrganizationOriginalAreNotClearedByClosedEditor() {
        val whitespace = snapshot("  \n").copy(captureOpen = false)
        assertTrue(store().save(whitespace))
        assertEquals(whitespace, store().load())
        val original = snapshot("").let { it.copy(draft = it.draft.copy(originalText = "原文"), captureOpen = false) }
        assertTrue(store().save(original))
        assertEquals(original, store().load())
    }
}
