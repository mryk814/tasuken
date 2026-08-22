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
import java.time.Instant
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
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.emitAll
import kotlinx.coroutines.flow.flow
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
private val MOBILE_PROCESS_INSTANCE_ID = UUID.randomUUID().toString()

data class MobileGatewayConfiguration(
    val origin: String,
    val paired: Boolean,
)

data class GatewayHttpResponse(val status: Int, val body: String)

fun interface MobileGatewayHttpClient {
    fun request(
        origin: String,
        path: String,
        method: String,
        body: String?,
        accessToken: String?,
    ): GatewayHttpResponse
}

internal sealed interface MobileThemeRefreshOutcome {
    data object Success : MobileThemeRefreshOutcome
    data object Unsupported : MobileThemeRefreshOutcome
    data class Failed(val retryable: Boolean, val message: String) : MobileThemeRefreshOutcome
}

private class MobileThemeHttpException(val status: Int) :
    IllegalStateException("Mobile Theme sync failed with HTTP $status")

private class MobileThemeProtocolException(
    message: String,
    val retryable: Boolean,
) : IllegalStateException(message)

private class MobileOutboxServerMismatchException : IllegalStateException(
    "未解決の変更が別のDesktopに属しています。",
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

    @Synchronized
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

    @Synchronized
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

    @Synchronized
    fun clearToken() {
        preferences.edit()
            .remove(KEY_TOKEN_CIPHERTEXT)
            .remove(KEY_TOKEN_IV)
            .apply()
    }

    @Synchronized
    fun clearTokenIfMatches(token: String) {
        if (readToken() == token) clearToken()
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
    private val httpClient: MobileGatewayHttpClient? = null,
    private val themeNow: () -> Instant = Instant::now,
    private val processInstanceId: String = MOBILE_PROCESS_INSTANCE_ID,
) : MobileGatewayRepository, MobileOfflineTaskRepository {
    private val json = Json { ignoreUnknownKeys = false }
    private val dao = database.mobileDao()
    private val outbox = MobileOutbox(context.applicationContext, dao, store::deviceId)

    init {
        if (scheduleOutboxOnStart) MobileOutboxScheduler.enqueue(context)
    }

    override fun configuration(): MobileGatewayConfiguration = store.configuration()

    override fun observeCachedTasks(): Flow<List<MobileTask>> =
        combine(outbox.observeTasks(), dao.observeSyncState()) { tasks, syncState ->
            tasks.map { it.toMobileTask(syncState?.serverId) }
        }

    override fun observeAllCachedTasks(): Flow<List<MobileTask>> =
        combine(outbox.observeAllTasks(), dao.observeSyncState()) { tasks, syncState ->
            tasks.map { it.toMobileTask(syncState?.serverId) }
        }

    override fun observeCachedThemes(): Flow<List<MobileTheme>> =
        observeThemeCatalogState().map { state: MobileThemeCatalogState -> state.themes }

    override fun observeThemeCatalogState(): Flow<MobileThemeCatalogState> = flow {
        dao.recoverInterruptedThemeRefresh(
            currentProcessId = processInstanceId,
            recoveredAt = themeNow().toString(),
            reason = "Theme一覧の更新中にAndroidプロセスが終了したため、保存済み一覧を使用します。",
        )
        emitAll(
            dao.observeThemeCatalog().map { snapshot: ThemeCatalogSnapshot? ->
                snapshot.toMobileThemeCatalogState()
            },
        )
    }

    override fun observePendingCount(): Flow<Int> = outbox.observePendingCount()

    override fun observeConflictCount(): Flow<Int> = outbox.observeConflictCount()

    override suspend fun enqueueCreateTask(title: String, todayDate: LocalDate?): String =
        outbox.enqueueCreate(title, todayDate)

    override suspend fun enqueueUpdateTaskTitle(taskId: String, title: String): String =
        outbox.enqueueUpdateTitle(taskId, title)

    override suspend fun enqueueUpdateTaskTodayDate(taskId: String, todayDate: LocalDate?): String =
        outbox.enqueueUpdateTodayDate(taskId, todayDate)

    override suspend fun enqueueUpdateTaskTheme(taskId: String, themeId: String): String =
        outbox.enqueueUpdateTheme(taskId, themeId)

    override suspend fun discardRejectedThemeUpdate(taskId: String, commandId: String) =
        outbox.discardRejectedThemeUpdate(taskId, commandId)

    override suspend fun enqueueCompleteTask(taskId: String): MobileStateActionResult = outbox.enqueueComplete(taskId)

    override suspend fun enqueueReopenTask(taskId: String): MobileStateActionResult = outbox.enqueueReopen(taskId)

    override suspend fun acceptServerConflict(commandId: String) = outbox.acceptServer(commandId)

    override suspend fun keepLocalConflict(commandId: String): String = outbox.keepLocal(commandId)

    internal suspend fun recoverInterruptedOutbox(): Int = outbox.recoverInterruptedSending()

    internal suspend fun synchronizeIfPaired(): Boolean {
        val configuration = store.configuration()
        val token = store.readToken()
        if (configuration.origin.isBlank() || token == null) return true
        return try {
            val serverId = confirmRemoteAndApplyBootstrap(configuration.origin, token)
            if (outbox.drain(serverId) { envelope ->
                    sendTaskCommand(configuration.origin, token, serverId, envelope)
                }
            ) return false
            synchronize(configuration.origin, token, serverId)
            when (val outcome = refreshThemes(configuration.origin, token)) {
                is MobileThemeRefreshOutcome.Failed -> !outcome.retryable
                MobileThemeRefreshOutcome.Success,
                MobileThemeRefreshOutcome.Unsupported -> true
            }
        } catch (error: MobileOutboxServerMismatchException) {
            Log.w(MOBILE_GATEWAY_LOG_TAG, "Background sync refused a different Desktop", error)
            true
        } catch (error: CancellationException) {
            throw error
        } catch (error: Exception) {
            Log.w(MOBILE_GATEWAY_LOG_TAG, "Mobile Theme background refresh failed", error)
            false
        }
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
            val response = gatewayRequest(
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
            val serverId = root["meta"]?.jsonObject?.get("serverId")?.jsonPrimitive?.content.orEmpty()
            require(serverId.isNotBlank()) { "Pairing response serverId is missing" }
            val data = root["data"]?.jsonObject ?: error("Pairing response data is missing")
            val token = data["accessToken"]?.jsonPrimitive?.content.orEmpty()
            runBlocking {
                if (dao.incompatibleOutboxCount(serverId) != 0) throw MobileOutboxServerMismatchException()
            }
            store.save(normalizedOrigin, token)
            loadToday()
        } catch (error: MobileOutboxServerMismatchException) {
            MobileTodayResult.Unavailable(
                "未解決の変更は別のDesktopに属しています。",
                "元のDesktopへ再接続して送信するか、却下されたTheme変更を取り下げてから再接続してください。",
            )
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
                val serverId = confirmRemoteAndApplyBootstrap(configuration.origin, token)
                outbox.drain(serverId) { envelope ->
                    sendTaskCommand(configuration.origin, token, serverId, envelope)
                }
                synchronize(configuration.origin, token, serverId)
                try {
                    refreshThemes(configuration.origin, token)
                } catch (error: Exception) {
                    Log.w(MOBILE_GATEWAY_LOG_TAG, "Mobile Theme refresh failed after Today sync", error)
                }
                val state = dao.syncState()
                dao.tasksForDate(LocalDate.now().toString()).map(TaskCacheEntity::toMobileTask) to
                    state?.lastSuccessfulSyncAt.orEmpty()
            }
            MobileTodayResult.Available(cached, syncedAt)
        } catch (error: MobileOutboxServerMismatchException) {
            MobileTodayResult.Unavailable(
                "未解決の変更は別のDesktopに属しています。",
                "元のDesktopへ再接続して送信するか、却下されたTheme変更を取り下げてから再読み込みしてください。",
            )
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

    private suspend fun synchronize(origin: String, accessToken: String, expectedServerId: String) {
        val current = dao.syncState()
        require(current?.serverId == expectedServerId) { "Confirmed Desktop does not match sync state" }
        if (current.cursor == null) {
            bootstrap(origin, accessToken, expectedServerId)
            return
        }
        var cursor = requireNotNull(current.cursor)
        repeat(100) {
            val encodedRequestId = URLEncoder.encode(UUID.randomUUID().toString(), Charsets.UTF_8.name())
            val encodedCursor = URLEncoder.encode(cursor, Charsets.UTF_8.name())
            val response = gatewayRequest(
                origin = origin,
                path = "/v1/sync?apiVersion=1&schemaVersion=1&requestId=$encodedRequestId&cursor=$encodedCursor&limit=50",
                method = "GET",
                body = null,
                accessToken = accessToken,
            )
            if (response.status == 401) {
                store.clearTokenIfMatches(accessToken)
                throw IllegalStateException("Mobile Gateway token expired")
            }
            require(response.status == 200) { "Mobile sync failed with HTTP ${response.status}" }
            val decoded = MobileSyncContract.decodeSync(response.body)
            if (decoded.meta.serverId != expectedServerId) throw MobileOutboxServerMismatchException()
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

    private suspend fun fetchBootstrap(origin: String, accessToken: String): MobileBootstrapResponseDto {
        val requestId = URLEncoder.encode(UUID.randomUUID().toString(), Charsets.UTF_8.name())
        val response = gatewayRequest(
            origin = origin,
            path = "/v1/bootstrap?apiVersion=1&schemaVersion=1&requestId=$requestId&limit=50",
            method = "GET",
            body = null,
            accessToken = accessToken,
        )
        if (response.status == 401) {
            store.clearTokenIfMatches(accessToken)
            throw IllegalStateException("Mobile Gateway token expired")
        }
        require(response.status == 200) { "Mobile bootstrap failed with HTTP ${response.status}" }
        return MobileSyncContract.decodeBootstrap(response.body)
    }

    private suspend fun confirmRemoteAndApplyBootstrap(origin: String, accessToken: String): String {
        val decoded = fetchBootstrap(origin, accessToken)
        val applied = dao.applyVerifiedBootstrap(
            tasks = decoded.data.tasks.map { it.toCache() },
            syncState = decoded.meta.toSyncState(decoded.data.nextCursor),
        )
        if (!applied) throw MobileOutboxServerMismatchException()
        return decoded.meta.serverId
    }

    private suspend fun bootstrap(origin: String, accessToken: String, expectedServerId: String) {
        val decoded = fetchBootstrap(origin, accessToken)
        if (decoded.meta.serverId != expectedServerId) throw MobileOutboxServerMismatchException()
        if (!dao.applyVerifiedBootstrap(
                tasks = decoded.data.tasks.map { it.toCache() },
                syncState = decoded.meta.toSyncState(decoded.data.nextCursor),
            )
        ) throw MobileOutboxServerMismatchException()
    }

    internal suspend fun refreshThemes(origin: String, accessToken: String): MobileThemeRefreshOutcome {
        val expectedServerId = dao.syncState()?.serverId
            ?: return MobileThemeRefreshOutcome.Failed(false, "Mobile sync state is missing")
        val refreshId = "$processInstanceId:${UUID.randomUUID()}"
        val attemptedAt = themeNow().toString()
        val themes = mutableListOf<ThemeCacheEntity>()
        val seenThemeIds = mutableSetOf<String>()
        val seenCursors = mutableSetOf<String>()
        var expectedRevision: Int? = null
        var generatedAt: String? = null
        var cursor: String? = null
        var prepared = false
        try {
            dao.prepareThemeRefresh(expectedServerId, refreshId, attemptedAt)
            prepared = true
            repeat(100) {
                val requestId = URLEncoder.encode(UUID.randomUUID().toString(), Charsets.UTF_8.name())
                val cursorQuery = cursor?.let {
                    "&cursor=${URLEncoder.encode(it, Charsets.UTF_8.name())}"
                }.orEmpty()
                val response = gatewayRequest(
                    origin = origin,
                    path = "/v1/themes?apiVersion=1&schemaVersion=1&requestId=$requestId&limit=50$cursorQuery",
                    method = "GET",
                    body = null,
                    accessToken = accessToken,
                )
                if (response.status == 401) store.clearTokenIfMatches(accessToken)
                if (response.status != 200) throw MobileThemeHttpException(response.status)
                val decoded = MobileThemeContract.decodePage(response.body)
                if (decoded.meta.serverId != expectedServerId) {
                    throw MobileThemeProtocolException("Mobile Theme server changed during sync", retryable = true)
                }
                if (expectedRevision == null) {
                    expectedRevision = decoded.meta.serverRevision
                    generatedAt = decoded.meta.generatedAt
                } else if (decoded.meta.serverRevision != expectedRevision) {
                    throw MobileThemeProtocolException("Mobile Theme revision changed between pages", retryable = true)
                }
                decoded.data.themes.forEach { theme ->
                    if (!seenThemeIds.add(theme.id)) {
                        throw MobileThemeProtocolException(
                            "Mobile Theme catalog contains duplicate IDs across pages",
                            retryable = false,
                        )
                    }
                    themes += ThemeCacheEntity(theme.id, theme.title)
                }
                val nextCursor = decoded.data.nextCursor
                if (nextCursor == null) {
                    dao.completeThemeRefresh(
                        serverId = expectedServerId,
                        serverRevision = requireNotNull(expectedRevision),
                        generatedAt = requireNotNull(generatedAt),
                        attemptedAt = attemptedAt,
                        refreshId = refreshId,
                        themes = themes,
                    )
                    return MobileThemeRefreshOutcome.Success
                }
                if (!seenCursors.add(nextCursor)) {
                    throw MobileThemeProtocolException("Mobile Theme cursor entered a cycle", retryable = true)
                }
                cursor = nextCursor
            }
            throw MobileThemeProtocolException("Mobile Theme sync exceeded the page limit", retryable = true)
        } catch (error: CancellationException) {
            if (prepared) {
                dao.failThemeRefresh(expectedServerId, refreshId, attemptedAt, "Theme refresh was cancelled", false)
            }
            throw error
        } catch (error: Exception) {
            val unsupported = error is MobileThemeHttpException && error.status in setOf(404, 405, 501)
            val retryable = when (error) {
                is MobileThemeHttpException -> error.status in setOf(408, 425, 429) ||
                    (error.status >= 500 && error.status != 501)
                is MobileThemeProtocolException -> error.retryable
                is MobileThemeContractException -> false
                else -> true
            }
            val message = if (unsupported) {
                "このDesktopはTheme catalogに対応していません。"
            } else {
                error.message ?: "Theme catalogを更新できませんでした。"
            }
            val recorded = if (prepared) {
                dao.failThemeRefresh(expectedServerId, refreshId, attemptedAt, message, unsupported)
            } else {
                false
            }
            if (prepared && !recorded) return MobileThemeRefreshOutcome.Success
            Log.w(MOBILE_GATEWAY_LOG_TAG, "Mobile Theme refresh did not complete", error)
            return if (unsupported) {
                MobileThemeRefreshOutcome.Unsupported
            } else {
                MobileThemeRefreshOutcome.Failed(retryable, message)
            }
        }
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

    private fun sendTaskCommand(
        origin: String,
        accessToken: String,
        expectedServerId: String,
        envelopeJson: String,
    ): MobileCommandSendResult {
        return try {
            val response = gatewayRequest(
                origin = origin,
                path = "/v1/commands",
                method = "POST",
                body = envelopeJson,
                accessToken = accessToken,
            )
            when {
                response.status == 200 -> {
                    val receipt = MobileTaskCommandContract.decodeReceipt(response.body)
                    if (receipt.meta.serverId != expectedServerId) {
                        MobileCommandSendResult.Retry("Desktopの識別情報が送信前と一致しません。再接続してください。")
                    } else {
                        MobileCommandSendResult.Applied(receipt)
                    }
                }
                response.status == 401 -> {
                    store.clearTokenIfMatches(accessToken)
                    MobileCommandSendResult.Retry("接続が失効しました。新しいコードで再接続してください。")
                }
                response.status == 409 -> {
                    val error = MobileTaskCommandContract.decodeError(response.body)
                    if (error.meta.serverId != expectedServerId) {
                        MobileCommandSendResult.Retry("Desktopの識別情報が送信前と一致しません。再接続してください。")
                    } else if (error.error.code == "version_conflict") {
                        MobileCommandSendResult.Conflict(error)
                    } else {
                        MobileCommandSendResult.Rejected(
                            code = error.error.code,
                            message = error.error.message,
                            retryable = error.error.retryable,
                        )
                    }
                }
                response.status == 408 || response.status == 429 || response.status >= 500 ->
                    MobileCommandSendResult.Retry("Desktopへ送信できませんでした。自動で再送します。")
                else -> {
                    val error = runCatching { MobileTaskCommandContract.decodeError(response.body) }.getOrNull()
                    if (error != null && error.meta.serverId != expectedServerId) {
                        MobileCommandSendResult.Retry("Desktopの識別情報が送信前と一致しません。再接続してください。")
                    } else {
                        MobileCommandSendResult.Rejected(
                            code = error?.error?.code ?: "http_${response.status}",
                            message = error?.error?.message ?: "DesktopがTask操作を受理しませんでした。",
                            retryable = error?.error?.retryable ?: false,
                        )
                    }
                }
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

    private fun gatewayRequest(
        origin: String,
        path: String,
        method: String,
        body: String?,
        accessToken: String?,
    ): GatewayHttpResponse = httpClient?.request(origin, path, method, body, accessToken)
        ?: request(origin, path, method, body, accessToken)

    private fun ThemeCatalogSnapshot?.toMobileThemeCatalogState(): MobileThemeCatalogState {
        if (this == null) return MobileThemeCatalogState.Loading()
        val mobileThemes = themes
            .sortedWith(compareBy<ThemeCacheEntity> { it.title }.thenBy { it.id })
            .map { MobileTheme(it.id, it.title) }
        return when (state.status) {
            ThemeCatalogStatus.Loading -> MobileThemeCatalogState.Loading(
                themes = mobileThemes,
                serverId = state.serverId,
                serverRevision = state.serverRevision,
            )
            ThemeCatalogStatus.Available -> {
                val revision = state.serverRevision
                val generatedAt = state.generatedAt
                if (revision == null || generatedAt == null) {
                    MobileThemeCatalogState.Error(state.serverId, "Theme catalog metadata is incomplete")
                } else {
                    MobileThemeCatalogState.Available(mobileThemes, state.serverId, revision, generatedAt)
                }
            }
            ThemeCatalogStatus.Stale -> {
                val revision = state.serverRevision
                val generatedAt = state.generatedAt
                if (revision == null || generatedAt == null) {
                    MobileThemeCatalogState.Error(state.serverId, "Theme catalog metadata is incomplete")
                } else {
                    MobileThemeCatalogState.Stale(
                        mobileThemes,
                        state.serverId,
                        revision,
                        generatedAt,
                        state.lastError ?: "Theme catalogを更新できませんでした。",
                    )
                }
            }
            ThemeCatalogStatus.Unsupported -> MobileThemeCatalogState.Unsupported(
                state.serverId,
                state.lastError ?: "このDesktopはTheme catalogに対応していません。",
            )
            else -> MobileThemeCatalogState.Error(
                state.serverId,
                state.lastError ?: "Theme catalogを読み込めませんでした。",
            )
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

}
