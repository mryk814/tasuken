package jp.personal.tasken.companion

import android.content.Context
import android.content.SharedPreferences
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import android.util.Base64
import java.io.ByteArrayOutputStream
import java.security.KeyStore
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec
import javax.net.ssl.HttpsURLConnection
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext

/** Credentials are separate from the pairing token, Room, Drafts, sync and export. */
internal class DirectCaptureSettingsStore(
    context: Context,
    private val preferences: SharedPreferences = context.getSharedPreferences("tasken_direct_capture_ai", Context.MODE_PRIVATE),
) {

    @Synchronized
    fun settings(): DirectCaptureSettings {
        val providerId = preferences.getString("provider", null)
        val provider = CaptureAiProvider.entries.firstOrNull { it.id == providerId }
        return DirectCaptureSettings(
            enabled = preferences.getBoolean("enabled", false),
            provider = provider ?: CaptureAiProvider.OpenAi,
            // A damaged provider never silently routes the old key to the default service.
            model = if (providerId != null && provider == null) "" else preferences.getString("model", "").orEmpty(),
            endpoint = preferences.getString("endpoint", "").orEmpty(),
            vocabulary = preferences.getString("vocabulary", "").orEmpty(),
            hasApiKey = provider != null && preferences.contains("ciphertext") && preferences.contains("iv"),
        )
    }

    @Synchronized
    fun save(settings: DirectCaptureSettings, enteredApiKey: String) {
        settings.destination()
        val previous = settings()
        val key = enteredApiKey.trim().ifEmpty {
            require(previous.hasApiKey && previous.provider == settings.provider && previous.endpoint == settings.endpoint) {
                "サービスまたは接続先を変える場合はAPIキーを再入力してください。"
            }
            apiKey()
        }
        require(key.isNotBlank() && key.length <= 8192 && key.none { it.code < 32 || it.code == 127 }) {
            "APIキーを確認してください。"
        }
        val cipher = Cipher.getInstance("AES/GCM/NoPadding")
        cipher.init(Cipher.ENCRYPT_MODE, secretKey())
        cipher.updateAAD(keyBinding(settings.provider.id, settings.endpoint))
        val encrypted = cipher.doFinal(key.toByteArray(Charsets.UTF_8))
        commit(preferences.edit()
            .putBoolean("enabled", settings.enabled)
            .putString("provider", settings.provider.id).putString("model", settings.model)
            .putString("endpoint", settings.endpoint).putString("vocabulary", settings.vocabulary)
            .putString("ciphertext", Base64.encodeToString(encrypted, Base64.NO_WRAP))
            .putString("iv", Base64.encodeToString(cipher.iv, Base64.NO_WRAP)))
    }

    @Synchronized
    fun disable() {
        commit(preferences.edit().putBoolean("enabled", false))
    }

    @Synchronized
    fun clear() {
        commit(preferences.edit().clear())
    }

    private fun commit(editor: SharedPreferences.Editor) {
        val previous = preferences.all
        if (editor.commit()) return
        // SharedPreferences updates its in-memory map even when the disk commit fails.
        // Restore that map before reporting failure so failed opt-in never enables sending.
        val restore = preferences.edit().clear()
        previous.forEach { (key, value) -> when (value) {
            is String -> restore.putString(key, value)
            is Boolean -> restore.putBoolean(key, value)
        } }
        restore.commit()
        error("AI設定を保存できませんでした。入力は保持しています。")
    }

    @Synchronized
    fun apiKey(expected: DirectCaptureSettings? = null): String {
        if (expected != null) require(settings() == expected) { "整理中にAI設定が変更されました。再試行してください。" }
        val ciphertext = requireNotNull(preferences.getString("ciphertext", null))
        val iv = requireNotNull(preferences.getString("iv", null))
        val cipher = Cipher.getInstance("AES/GCM/NoPadding")
        cipher.init(Cipher.DECRYPT_MODE, secretKey(), GCMParameterSpec(128, Base64.decode(iv, Base64.NO_WRAP)))
        cipher.updateAAD(keyBinding(requireNotNull(preferences.getString("provider", null)), preferences.getString("endpoint", "").orEmpty()))
        return String(cipher.doFinal(Base64.decode(ciphertext, Base64.NO_WRAP)), Charsets.UTF_8)
    }

    private fun keyBinding(provider: String, endpoint: String) = "$provider\n$endpoint".toByteArray(Charsets.UTF_8)

    private fun secretKey(): SecretKey {
        val keyStore = KeyStore.getInstance("AndroidKeyStore").apply { load(null) }
        (keyStore.getKey(KEY_ALIAS, null) as? SecretKey)?.let { return it }
        return KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore").run {
            init(KeyGenParameterSpec.Builder(KEY_ALIAS, KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT)
                .setBlockModes(KeyProperties.BLOCK_MODE_GCM).setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE).build())
            generateKey()
        }
    }

    private companion object { const val KEY_ALIAS = "tasken_direct_capture_ai_key" }
}

fun interface DirectCaptureHttpClient {
    fun post(destination: String, keyHeader: String, apiKey: String, body: String): String
}

/** No redirect, retry, provider fallback or provider error-body disclosure. */
internal class AndroidDirectCaptureHttpClient : DirectCaptureHttpClient {
    override fun post(destination: String, keyHeader: String, apiKey: String, body: String): String {
        val connection = java.net.URL(destination).openConnection() as HttpsURLConnection
        val deadline = Executors.newSingleThreadScheduledExecutor { runnable ->
            Thread(runnable, "tasken-capture-ai-deadline").apply { isDaemon = true }
        }
        val timeout = deadline.schedule({ connection.disconnect() }, 30, TimeUnit.SECONDS)
        try {
            connection.instanceFollowRedirects = false
            connection.connectTimeout = 30_000
            connection.readTimeout = 30_000
            connection.requestMethod = "POST"
            connection.doOutput = true
            connection.setRequestProperty("Content-Type", "application/json")
            connection.setRequestProperty("Accept-Encoding", "identity")
            connection.setRequestProperty(keyHeader, if (keyHeader == "Authorization") "Bearer $apiKey" else apiKey)
            val bytes = body.toByteArray(Charsets.UTF_8)
            connection.setFixedLengthStreamingMode(bytes.size)
            connection.outputStream.use { it.write(bytes) }
            val status = connection.responseCode
            if (status !in 200..299) {
                val errorBody = runCatching {
                    connection.errorStream?.use { readCapped(it, PROVIDER_ERROR_BODY_LIMIT) }.orEmpty()
                }.getOrDefault("")
                throw DirectCaptureHttpException(status, sanitizedProviderCode(errorBody))
            }
            require(connection.contentEncoding == null || connection.contentEncoding.equals("identity", ignoreCase = true))
            require(connection.contentLengthLong <= DIRECT_CAPTURE_RESPONSE_LIMIT)
            return connection.inputStream.use { input ->
                val output = ByteArrayOutputStream()
                val buffer = ByteArray(8192)
                while (true) {
                    val read = input.read(buffer)
                    if (read == -1) break
                    require(output.size() + read <= DIRECT_CAPTURE_RESPONSE_LIMIT)
                    output.write(buffer, 0, read)
                }
                output.toString(Charsets.UTF_8.name())
            }
        } finally {
            timeout.cancel(false)
            deadline.shutdownNow()
            connection.disconnect()
        }
    }

    private fun readCapped(input: java.io.InputStream, limit: Int): String {
        val output = ByteArrayOutputStream()
        val buffer = ByteArray(2048)
        while (output.size() < limit) {
            val read = input.read(buffer, 0, minOf(buffer.size, limit - output.size()))
            if (read == -1) break
            output.write(buffer, 0, read)
        }
        return output.toString(Charsets.UTF_8.name())
    }

    private companion object { const val PROVIDER_ERROR_BODY_LIMIT = 8192 }
}

internal suspend fun organizeCaptureDirectly(
    settings: DirectCaptureSettings,
    apiKey: () -> String,
    draft: MobileCaptureDraft,
    themes: List<MobileTheme>,
    photos: List<MobileCaptureImageDto>,
    client: DirectCaptureHttpClient = AndroidDirectCaptureHttpClient(),
): List<MobileCaptureOrganization> = withContext(Dispatchers.IO) {
    val prepared = try {
        require(settings.enabled)
        val destination = settings.destination()
        val body = directCaptureRequest(settings, draft, themes, photos)
        val key = apiKey()
        require(key.isNotBlank() && key.length <= 8192 && key.none { it.code < 32 || it.code == 127 })
        Triple(destination, body, key)
    } catch (cancelled: CancellationException) {
        throw cancelled
    } catch (_: Exception) {
        throw IllegalStateException(DIRECT_CAPTURE_FAILURE)
    }
    val response = try {
        client.post(
            prepared.first,
            if (settings.provider == CaptureAiProvider.Gemini) "x-goog-api-key" else "Authorization",
            prepared.third,
            prepared.second,
        )
    } catch (cancelled: CancellationException) {
        throw cancelled
    } catch (http: DirectCaptureHttpException) {
        throw IllegalStateException(
            directCaptureHttpMessage(settings.provider, settings.model, http.status, http.providerCode),
        )
    } catch (_: Exception) {
        throw IllegalStateException(DIRECT_CAPTURE_NETWORK_FAILURE)
    }
    try {
        decodeDirectCaptureResponse(settings.provider, response, themes.map { it.id }.toSet())
    } catch (cancelled: CancellationException) {
        throw cancelled
    } catch (_: Exception) {
        throw IllegalStateException(DIRECT_CAPTURE_RESPONSE_MISMATCH)
    }
}
