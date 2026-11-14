package jp.personal.tasken.companion

import android.content.Context
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import androidx.test.platform.app.InstrumentationRegistry
import java.security.KeyStore
import javax.crypto.KeyGenerator
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/** 束9a で外した直接の AI 設定と鍵だけを消し、ほかの設定と鍵は残す（#755）。 */
class RetiredDirectCaptureAiSettingsTest {
    private val context: Context = InstrumentationRegistry.getInstrumentation().targetContext
    private val otherPreferences = "tasken_retired_settings_test_other"
    private val otherAlias = "tasken_retired_settings_test_other_key"

    @After
    fun cleanup() {
        context.deleteSharedPreferences(otherPreferences)
        context.deleteSharedPreferences(RetiredDirectCaptureAiSettings.PreferencesName)
        keyStore().run {
            if (containsAlias(otherAlias)) deleteEntry(otherAlias)
            if (containsAlias(RetiredDirectCaptureAiSettings.KeystoreAlias)) {
                deleteEntry(RetiredDirectCaptureAiSettings.KeystoreAlias)
            }
        }
    }

    @Test
    fun retiresOnlyTheDirectAiSettingsAndKey() {
        // 前の版が残した形（設定と暗号文）を作る。
        assertTrue(
            context.getSharedPreferences(RetiredDirectCaptureAiSettings.PreferencesName, Context.MODE_PRIVATE).edit()
                .putBoolean("enabled", true).putString("provider", "openai")
                .putString("ciphertext", "fixture-ciphertext").putString("iv", "fixture-iv").commit(),
        )
        assertTrue(
            context.getSharedPreferences(otherPreferences, Context.MODE_PRIVATE).edit()
                .putString("kept", "value").commit(),
        )
        generateKey(RetiredDirectCaptureAiSettings.KeystoreAlias)
        generateKey(otherAlias)

        RetiredDirectCaptureAiSettings.retire(context)
        // 二度目の起動でも落ちない（もう無い物は何もしない）。
        RetiredDirectCaptureAiSettings.retire(context)

        val retiredFile = context.dataDir.resolve("shared_prefs/${RetiredDirectCaptureAiSettings.PreferencesName}.xml")
        assertFalse(retiredFile.exists())
        assertTrue(
            context.getSharedPreferences(RetiredDirectCaptureAiSettings.PreferencesName, Context.MODE_PRIVATE).all.isEmpty(),
        )
        assertFalse(keyStore().containsAlias(RetiredDirectCaptureAiSettings.KeystoreAlias))

        assertEquals("value", context.getSharedPreferences(otherPreferences, Context.MODE_PRIVATE).getString("kept", null))
        assertTrue(keyStore().containsAlias(otherAlias))
    }

    private fun keyStore(): KeyStore = KeyStore.getInstance("AndroidKeyStore").apply { load(null) }

    private fun generateKey(alias: String) {
        KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore").run {
            init(
                KeyGenParameterSpec.Builder(alias, KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT)
                    .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
                    .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
                    .build(),
            )
            generateKey()
        }
    }
}
