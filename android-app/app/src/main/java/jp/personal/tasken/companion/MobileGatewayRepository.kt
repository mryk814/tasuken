package jp.personal.tasken.companion

import android.content.Context
import android.os.Build
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import android.util.Base64
import android.util.Log
import java.net.HttpURLConnection
import java.net.URI
import java.net.URLEncoder
import java.security.KeyStore
import java.time.LocalDate
import java.util.UUID
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.put
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.runBlocking

private const val PREFERENCES_NAME = "tasken_mobile_gateway"
private const val KEY_ORIGIN = "origin"
private const val KEY_DEVICE_ID = "device_id"
private const val KEY_TOKEN_CIPHERTEXT = "token_ciphertext"
private const val KEY_TOKEN_IV = "token_iv"
private const val KEYSTORE_ALIAS = "tasken_mobile_gateway_token"
private const val MAX_RESPONSE_BYTES = 256 * 1024
private const val REQUEST_TIMEOUT_MS = 5_000
private const val MOBILE_GATEWAY_LOG_TAG = "TaskenMobileGateway"

data class MobileGatewayConfiguration(
    val origin: String,
    val paired: Boolean,
)

class MobileGatewayConnectionStore(context: Context) {
    private val preferences = context.getSharedPreferences(PREFERENCES_NAME, Context.MODE_PRIVATE)

    fun configuration(): MobileGatewayConfiguration = MobileGatewayConfiguration(
        origin = preferences.getString(KEY_ORIGIN, "").orEmpty(),
        paired = readToken() != null,
    )

    fun deviceId(): String {
        val current = preferences.getString(KEY_DEVICE_ID, "").orEmpty()
        if (current.isNotBlank()) return current
        val generated = UUID.randomUUID().toString()
        preferences.edit().putString(KEY_DEVICE_ID, generated).apply()
        return generated
    }

    fun save(origin: String, token: String) {
        require(token.matches(Regex("^[A-Za-z0-9_-]{43}$"))) { "Access token is invalid" }
        val cipher = Cipher.getInstance("AES/GCM/NoPadding")
        cipher.init(Cipher.ENCRYPT_MODE, secretKey())
        val encrypted = cipher.doFinal(token.toByteArray(Charsets.UTF_8))
        preferences.edit()
            .putString(KEY_ORIGIN, origin)
            .putString(KEY_TOKEN_CIPHERTEXT, Base64.encodeToString(encrypted, Base64.NO_WRAP))
            .putString(KEY_TOKEN_IV, Base64.encodeToString(cipher.iv, Base64.NO_WRAP))
            .apply()
    }

    fun readToken(): String? {
        val ciphertext = preferences.getString(KEY_TOKEN_CIPHERTEXT, "").orEmpty()
        val iv = preferences.getString(KEY_TOKEN_IV, "").orEmpty()
        if (ciphertext.isBlank() || iv.isBlank()) return null
        return try {
            val cipher = Cipher.getInstance("AES/GCM/NoPadding")
            cipher.init(
                Cipher.DECRYPT_MODE,
                secretKey(),
                GCMParameterSpec(128, Base64.decode(iv, Base64.NO_WRAP)),
            )
            String(cipher.doFinal(Base64.decode(ciphertext, Base64.NO_WRAP)), Charsets.UTF_8)
        } catch (error: Exception) {
            Log.w(MOBILE_GATEWAY_LOG_TAG, "Failed to decrypt the paired-device token", error)
            clearToken()
            null
        }
    }

    fun clearToken() {
        preferences.edit()
            .remove(KEY_TOKEN_CIPHERTEXT)
            .remove(KEY_TOKEN_IV)
            .apply()
    }

    private fun secretKey(): SecretKey {
        val keyStore = KeyStore.getInstance("AndroidKeyStore").apply { load(null) }
        (keyStore.getKey(KEYSTORE_ALIAS, null) as? SecretKey)?.let { return it }
        return KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore").run {
            init(
                KeyGenParameterSpec.Builder(
                    KEYSTORE_ALIAS,
                    KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT,
                )
                    .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
                    .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
                    .build(),
            )
            generateKey()
        }
    }
}

class AndroidMobileTaskRepository(
    private val context: Context,
    private val store: MobileGatewayConnectionStore = MobileGatewayConnectionStore(context),
    database: MobileLocalDatabase = MobileLocalDatabase.open(context),
    scheduleOutboxOnStart: Boolean = true,
) : MobileGatewayRepository, MobileOfflineTaskRepository {
    private val json = Json { ignoreUnknownKeys = false }
    private val dao = database.mobileDao()
    private val outbox = MobileOutbox(context.applicationContext, dao, store::deviceId)

    init {
        if (scheduleOutboxOnStart) MobileOutboxScheduler.enqueue(context)
    }

    override fun configuration(): MobileGatewayConfiguration = store.configuration()

    override fun observeCachedTasks(): Flow<List<MobileTask>> =
        outbox.observeTasks().map { tasks -> tasks.map(TaskCacheWithConflict::toMobileTask) }

    override fun observeAllCachedTasks(): Flow<List<MobileTask>> =
        outbox.observeAllTasks().map { tasks -> tasks.map(TaskCacheWithConflict::toMobileTask) }

    override fun observePendingCount(): Flow<Int> = outbox.observePendingCount()

    override fun observeConflictCount(): Flow<Int> = outbox.observeConflictCount()

    override suspend fun enqueueCreateTask(title: String, todayDate: LocalDate?): String =
        outbox.enqueueCreate(title, todayDate)

    override suspend fun enqueueUpdateTaskTitle(taskId: String, title: String): String =
        outbox.enqueueUpdateTitle(taskId, title)

    override suspend fun enqueueCompleteTask(taskId: String): MobileStateActionResult = outbox.enqueueComplete(taskId)

    override suspend fun enqueueReopenTask(taskId: String): MobileStateActionResult = outbox.enqueueReopen(taskId)

    override suspend fun acceptServerConflict(commandId: String) = outbox.acceptServer(commandId)

    override suspend fun keepLocalConflict(commandId: String): String = outbox.keepLocal(commandId)

    internal suspend fun recoverInterruptedOutbox(): Int = outbox.recoverInterruptedSending()

    internal suspend fun drainOutbox(): Boolean = outbox.drain(::sendTaskCommand)

    internal suspend fun synchronizeIfPaired(): Boolean {
        val configuration = store.configuration()
        val token = store.readToken()
        if (configuration.origin.isBlank() || token == null) return true
        if (outbox.drain(::sendTaskCommand)) return false
        synchronize(configuration.origin, token)
        return true
    }

    override fun pair(origin: String, pairingCode: String): MobileTodayResult {
        val normalizedOrigin = normalizeHttpsOrigin(origin)
            ?: return MobileTodayResult.Unavailable(
                "Gateway URLが不正です。",
                "Tailscale Serveの https:// で始まるURLを入力してください。",
            )
        if (!pairingCode.matches(Regex("^\\d{8}$"))) {
            return MobileTodayResult.Unavailable(
                "ペアリングコードが不正です。",
                "Desktopで8桁のコードを発行して入力してください。",
            )
        }
        return try {
            val payload = buildJsonObject {
                put("apiVersion", 1)
                put("schemaVersion", 1)
                put("requestId", UUID.randomUUID().toString())
                put("pairingCode", pairingCode)
                put("clientDeviceId", store.deviceId())
                put("deviceLabel", Build.MODEL.ifBlank { "Android" })
            }.toString()
            val response = request(
                origin = normalizedOrigin,
                path = "/v1/pair",
                method = "POST",
                body = payload,
                accessToken = null,
            )
            if (response.status != 200) {
                return MobileTodayResult.Unavailable(
                    "ペアリングできませんでした。",
                    if (response.status == 401) "Desktopで新しいコードを発行してください。" else "DesktopとTailscale接続を確認してください。",
                )
            }
            val root = json.parseToJsonElement(response.body).jsonObject
            val data = root["data"]?.jsonObject ?: error("Pairing response data is missing")
            val token = data["accessToken"]?.jsonPrimitive?.content.orEmpty()
            store.save(normalizedOrigin, token)
            loadToday()
        } catch (error: Exception) {
            Log.w(MOBILE_GATEWAY_LOG_TAG, "Mobile Gateway pairing request failed", error)
            MobileTodayResult.Unavailable(
                "Mobile Gatewayに接続できません。",
                "Desktopが起動中で、Tailscale Serveが有効か確認してください。",
            )
        }
    }

    override fun loadToday(): MobileTodayResult {
        val configuration = store.configuration()
        val token = store.readToken()
        if (configuration.origin.isBlank() || token == null) {
            return MobileTodayResult.PairingRequired(configuration.origin)
        }
        return try {
            val (cached, syncedAt) = runBlocking {
                outbox.drain(::sendTaskCommand)
                synchronize(configuration.origin, token)
                val state = dao.syncState()
                dao.tasksForDate(LocalDate.now().toString()).map(TaskCacheEntity::toMobileTask) to
                    state?.lastSuccessfulSyncAt.orEmpty()
            }
            MobileTodayResult.Available(cached, syncedAt)
        } catch (error: Exception) {
            Log.w(MOBILE_GATEWAY_LOG_TAG, "Mobile Gateway Today sync failed", error)
            val cached = runBlocking { dao.tasksForDate(LocalDate.now().toString()).map(TaskCacheEntity::toMobileTask) }
            if (cached.isNotEmpty()) {
                MobileTodayResult.Available(cached, runBlocking { dao.syncState()?.lastSuccessfulSyncAt.orEmpty() })
            } else {
                MobileTodayResult.Unavailable(
                    "Mobile Gatewayに接続できません。",
                    "DesktopとTailscale接続を確認して再読み込みしてください。",
                )
            }
        }
    }

    private suspend fun synchronize(origin: String, accessToken: String) {
        val current = dao.syncState()
        if (current?.cursor == null || current.serverId == null) {
            bootstrap(origin, accessToken)
            return
        }
        var cursor = requireNotNull(current.cursor)
        repeat(100) {
            val encodedRequestId = URLEncoder.encode(UUID.randomUUID().toString(), Charsets.UTF_8.name())
            val encodedCursor = URLEncoder.encode(cursor, Charsets.UTF_8.name())
            val response = request(
                origin = origin,
                path = "/v1/sync?apiVersion=1&schemaVersion=1&requestId=$encodedRequestId&cursor=$encodedCursor&limit=50",
                method = "GET",
                body = null,
                accessToken = accessToken,
            )
            if (response.status == 401) {
                store.clearToken()
                throw IllegalStateException("Mobile Gateway token expired")
            }
            require(response.status == 200) { "Mobile sync failed with HTTP ${response.status}" }
            val decoded = MobileSyncContract.decodeSync(response.body)
            if (decoded.meta.serverId != current.serverId) {
                bootstrap(origin, accessToken)
                return
            }
            require(decoded.data.nextCursor != cursor || !decoded.data.hasMore) { "Mobile sync cursor did not advance" }
            dao.applySyncPage(
                upserts = decoded.data.changes.mapNotNull { it.task?.toCache() },
                tombstoneIds = decoded.data.changes.filter { it.kind == "tombstone" }.map { requireNotNull(it.id) },
                syncState = decoded.meta.toSyncState(decoded.data.nextCursor),
            )
            cursor = decoded.data.nextCursor
            if (!decoded.data.hasMore) return
        }
        error("Mobile sync exceeded the page limit")
    }

    private suspend fun bootstrap(origin: String, accessToken: String) {
        val requestId = URLEncoder.encode(UUID.randomUUID().toString(), Charsets.UTF_8.name())
        val response = request(
            origin = origin,
            path = "/v1/bootstrap?apiVersion=1&schemaVersion=1&requestId=$requestId&limit=50",
            method = "GET",
            body = null,
            accessToken = accessToken,
        )
        if (response.status == 401) {
            store.clearToken()
            throw IllegalStateException("Mobile Gateway token expired")
        }
        require(response.status == 200) { "Mobile bootstrap failed with HTTP ${response.status}" }
        val decoded = MobileSyncContract.decodeBootstrap(response.body)
        dao.applyBootstrap(
            tasks = decoded.data.tasks.map { it.toCache() },
            syncState = decoded.meta.toSyncState(decoded.data.nextCursor),
        )
    }

    private fun MobileTaskSummaryDto.toCache(): TaskCacheEntity = TaskCacheEntity(
        id = id,
        serverVersion = version,
        title = title,
        themeId = themeId,
        state = state,
        workState = workState,
        todayDate = todayDate,
        updatedAt = updatedAt,
        optimisticCommandId = null,
    )

    private fun MobileResponseMetaDto.toSyncState(cursor: String?): SyncStateEntity = SyncStateEntity(
        serverId = serverId,
        apiVersion = apiVersion,
        schemaVersion = schemaVersion,
        cursor = cursor,
        lastSuccessfulSyncAt = generatedAt,
        lastAttemptAt = generatedAt,
        lastError = null,
    )

    private fun sendTaskCommand(envelopeJson: String): MobileCommandSendResult {
        val configuration = store.configuration()
        val token = store.readToken()
        if (configuration.origin.isBlank() || token == null) {
            return MobileCommandSendResult.Retry("Mobile Gatewayとのペアリングが必要です。")
        }
        return try {
            val response = request(
                origin = configuration.origin,
                path = "/v1/commands",
                method = "POST",
                body = envelopeJson,
                accessToken = token,
            )
            when {
                response.status == 200 -> MobileCommandSendResult.Applied(
                    MobileTaskCommandContract.decodeReceipt(response.body),
                )
                response.status == 401 -> {
                    store.clearToken()
                    MobileCommandSendResult.Retry("接続が失効しました。新しいコードで再接続してください。")
                }
                response.status == 409 -> {
                    val error = MobileTaskCommandContract.decodeError(response.body)
                    if (error.error.code == "version_conflict") {
                        MobileCommandSendResult.Conflict(error)
                    } else {
                        MobileCommandSendResult.Rejected(error.error.message)
                    }
                }
                response.status == 408 || response.status == 429 || response.status >= 500 ->
                    MobileCommandSendResult.Retry("Desktopへ送信できませんでした。自動で再送します。")
                else -> MobileCommandSendResult.Rejected("DesktopがTask操作を受理しませんでした。")
            }
        } catch (error: Exception) {
            Log.w(MOBILE_GATEWAY_LOG_TAG, "Mobile Gateway command request failed", error)
            MobileCommandSendResult.Retry("Desktopへ接続できませんでした。自動で再送します。")
        }
    }

    private fun request(
        origin: String,
        path: String,
        method: String,
        body: String?,
        accessToken: String?,
    ): GatewayHttpResponse {
        val connection = URI(origin + path).toURL().openConnection() as HttpURLConnection
        try {
            connection.requestMethod = method
            connection.connectTimeout = REQUEST_TIMEOUT_MS
            connection.readTimeout = REQUEST_TIMEOUT_MS
            connection.instanceFollowRedirects = false
            connection.setRequestProperty("Accept", "application/json")
            if (accessToken != null) connection.setRequestProperty("Authorization", "Bearer $accessToken")
            if (body != null) {
                connection.doOutput = true
                connection.setRequestProperty("Content-Type", "application/json")
                connection.outputStream.use { it.write(body.toByteArray(Charsets.UTF_8)) }
            }
            val status = connection.responseCode
            val stream = if (status in 200..299) connection.inputStream else connection.errorStream
            val bytes = stream?.use { input ->
                val output = java.io.ByteArrayOutputStream()
                val buffer = ByteArray(8 * 1024)
                while (true) {
                    val read = input.read(buffer)
                    if (read < 0) break
                    if (output.size() + read > MAX_RESPONSE_BYTES) error("Gateway response is too large")
                    output.write(buffer, 0, read)
                }
                output.toByteArray()
            } ?: ByteArray(0)
            return GatewayHttpResponse(status, String(bytes, Charsets.UTF_8))
        } finally {
            connection.disconnect()
        }
    }

    private fun normalizeHttpsOrigin(value: String): String? {
        return try {
            val uri = URI(value.trim().removeSuffix("/"))
            if (
                uri.scheme != "https" ||
                uri.host.isNullOrBlank() ||
                !uri.userInfo.isNullOrBlank() ||
                !uri.query.isNullOrBlank() ||
                !uri.fragment.isNullOrBlank() ||
                (uri.path.isNotBlank() && uri.path != "/")
            ) null else "${uri.scheme}://${uri.authority}"
        } catch (_: Exception) {
            null
        }
    }

    private data class GatewayHttpResponse(val status: Int, val body: String)
}
