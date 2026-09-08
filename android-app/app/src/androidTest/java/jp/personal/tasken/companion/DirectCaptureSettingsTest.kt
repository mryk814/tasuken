package jp.personal.tasken.companion

import android.content.Context
import android.content.SharedPreferences
import androidx.room.Room
import androidx.test.core.app.ApplicationProvider
import kotlinx.coroutines.runBlocking
import org.junit.After
import org.junit.Assert.*
import org.junit.Before
import org.junit.Test

class DirectCaptureSettingsTest {
    private lateinit var context: Context
    private lateinit var store: DirectCaptureSettingsStore
    private val secret = "fixture-direct-ai-secret"
    private val settings = DirectCaptureSettings(enabled = true, model = "fixture-model")

    @Before fun setup() {
        context = ApplicationProvider.getApplicationContext()
        store = DirectCaptureSettingsStore(context)
        store.clear()
    }
    @After fun cleanup() { store.clear() }

    @Test fun storesEncryptedKeyReloadsAndRequiresNewKeyForChangedService() {
        assertFalse(store.settings().enabled)
        store.save(settings, secret)
        val restored = DirectCaptureSettingsStore(context)
        assertTrue(restored.settings().enabled)
        assertTrue(restored.settings().hasApiKey)
        assertEquals(secret, restored.apiKey())
        assertFalse(context.getSharedPreferences("tasken_direct_capture_ai", Context.MODE_PRIVATE).all.toString().contains(secret))
        restored.save(settings.copy(model = "another-model"), "")
        assertEquals(secret, restored.apiKey())
        assertThrows(Exception::class.java) { restored.save(settings.copy(provider = CaptureAiProvider.Gemini), "") }
        assertEquals(CaptureAiProvider.OpenAi, restored.settings().provider)
        assertEquals(secret, restored.apiKey())
        restored.disable()
        assertFalse(DirectCaptureSettingsStore(context).settings().enabled)
        assertTrue(restored.settings().hasApiKey)
        restored.clear()
        assertFalse(restored.settings().hasApiKey)
    }

    @Test fun corruptedCredentialDoesNotEnableFallbackOrDestroySettings() {
        store.save(settings, secret)
        context.getSharedPreferences("tasken_direct_capture_ai", Context.MODE_PRIVATE).edit().putString("ciphertext", "corrupt").commit()
        assertThrows(Exception::class.java) { store.apiKey() }
        assertTrue(store.settings().enabled)
        assertEquals(settings.model, store.settings().model)
        store.save(settings, "replacement-fixture-secret")
        assertEquals("replacement-fixture-secret", store.apiKey())
    }

    @Test fun credentialIsBoundToItsProviderAndSettingsChangesCancelOldRequests() {
        store.save(settings, secret)
        val original = store.settings()
        context.getSharedPreferences("tasken_direct_capture_ai", Context.MODE_PRIVATE).edit().putString("provider", "gemini").commit()
        assertThrows(Exception::class.java) { store.apiKey() }
        context.getSharedPreferences("tasken_direct_capture_ai", Context.MODE_PRIVATE).edit().putString("provider", "unrecognized").commit()
        assertEquals("", store.settings().model)
        assertFalse(store.settings().hasApiKey)
        assertThrows(Exception::class.java) { store.save(settings, "") }
        store.save(settings.copy(model = "updated-model"), secret)
        assertThrows(Exception::class.java) { store.apiKey(original) }
        assertEquals(secret, store.apiKey(store.settings()))
    }

    @Test fun failedPreferenceCommitCannotActivateOrReplaceAnExistingConfiguration() {
        store.save(settings.copy(enabled = false), secret)
        val previous = store.settings()
        val preferences = context.getSharedPreferences("tasken_direct_capture_ai", Context.MODE_PRIVATE)
        var failOnce = true
        val failingPreferences = object : SharedPreferences by preferences {
            override fun edit(): SharedPreferences.Editor {
                val editor = preferences.edit()
                return object : SharedPreferences.Editor by editor {
                    override fun commit(): Boolean {
                        val committed = editor.commit()
                        return if (failOnce) { failOnce = false; false } else committed
                    }
                    override fun putBoolean(key: String?, value: Boolean): SharedPreferences.Editor { editor.putBoolean(key, value); return this }
                    override fun putString(key: String?, value: String?): SharedPreferences.Editor { editor.putString(key, value); return this }
                    override fun clear(): SharedPreferences.Editor { editor.clear(); return this }
                }
            }
        }
        val failing = DirectCaptureSettingsStore(context, failingPreferences)
        assertThrows(Exception::class.java) { failing.save(settings.copy(model = "changed"), "changed-fixture-secret") }
        assertEquals(previous, store.settings())
        assertEquals(secret, store.apiKey())
    }

    @Test fun noPcPairingIsNeededAndNoTaskOrOutboxIsWrittenByDirectOrganization() = runBlocking {
        val database = Room.inMemoryDatabaseBuilder(context, MobileLocalDatabase::class.java).build()
        val connectionStore = MobileGatewayConnectionStore(context)
        connectionStore.clearToken()
        store.save(settings, secret)
        var calls = 0
        val repository = AndroidMobileTaskRepository(context, database = database, scheduleOutboxOnStart = false,
            httpClient = MobileGatewayHttpClient { _, _, _, _, _ -> error("Gateway must not be called") },
            directCaptureHttpClient = DirectCaptureHttpClient { destination, _, key, body ->
                calls++
                assertEquals("https://api.openai.com/v1/chat/completions", destination)
                assertEquals(secret, key)
                assertFalse(body.contains(secret))
                """{"choices":[{"finish_reason":"stop","message":{"content":"{\"tasks\":[{\"title\":\"牛乳を買う\",\"themeId\":null,\"startDate\":null,\"endDate\":null,\"rangeSemantics\":null,\"checklist\":[],\"supplement\":\"\",\"warnings\":[],\"plannedStartTime\":null,\"plannedDurationMinutes\":null}],\"warnings\":[]}"}}]}"""
            })
        try {
            val draft = MobileCaptureDraft.fresh(text = "牛乳を買う")
            assertEquals("牛乳を買う", repository.organizeCapture(draft).single().title)
            assertEquals(1, calls)
            assertTrue(database.mobileDao().tasks().isEmpty())
            assertEquals(0, database.mobileDao().outboxCount())
            assertEquals("牛乳を買う", draft.text)
            store.disable()
            assertTrue(runCatching { repository.organizeCapture(draft) }.isFailure)
            assertEquals(1, calls)
        } finally { database.close() }
    }
}
