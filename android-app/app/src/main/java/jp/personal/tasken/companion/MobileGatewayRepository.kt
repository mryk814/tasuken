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
import kotlinx.serialization.json.jsonArray
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
private const val KEY_SCOPES = "scopes"
private const val KEYSTORE_ALIAS = "tasken_mobile_gateway_token"
private const val MAX_RESPONSE_BYTES = 256 * 1024
private const val REQUEST_TIMEOUT_MS = 5_000
private const val MOBILE_GATEWAY_LOG_TAG = "TaskenMobileGateway"
private val MOBILE_PROCESS_INSTANCE_ID = UUID.randomUUID().toString()
private const val MOBILE_HUMAN_REVIEW_SCOPE = "mobile:human-review"
private val SUPPORTED_MOBILE_SCOPES = setOf(
    "mobile:read",
    "mobile:task-write",
    "mobile:capture-write",
    "mobile:proposal-review",
    MOBILE_HUMAN_REVIEW_SCOPE,
)

data class MobileGatewayConfiguration(
    val origin: String,
    val paired: Boolean,
    val scopes: Set<String> = emptySet(),
)

fun MobileGatewayConfiguration.canReviewWorkReceipts(): Boolean =
    paired && MOBILE_HUMAN_REVIEW_SCOPE in scopes

data class GatewayHttpResponse(val status: Int, val body: String)

internal fun isConfirmedGatewayUnauthorized(
    response: GatewayHttpResponse,
    expectedServerId: String? = null,
): Boolean {
    if (response.status != 401) return false
    val decoded = runCatching { MobileTaskCommandContract.decodeError(response.body) }.getOrNull()
        ?: return false
    if (decoded.error.code != "unauthorized") return false
    return expectedServerId == null || decoded.meta.serverId == expectedServerId
}

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
        scopes = if (readToken() == null) {
            emptySet()
        } else {
            preferences.getStringSet(KEY_SCOPES, emptySet()).orEmpty().toSet()
        },
    )

    fun deviceId(): String {
        val current = preferences.getString(KEY_DEVICE_ID, "").orEmpty()
        if (current.isNotBlank()) return current
        val generated = UUID.randomUUID().toString()
        preferences.edit().putString(KEY_DEVICE_ID, generated).apply()
        return generated
    }

    @Synchronized
    fun save(origin: String, token: String, scopes: Set<String> = emptySet()) {
        require(token.matches(Regex("^[A-Za-z0-9_-]{43}$"))) { "Access token is invalid" }
        require(scopes.all { it in SUPPORTED_MOBILE_SCOPES }) { "Pairing scopes are invalid" }
        val cipher = Cipher.getInstance("AES/GCM/NoPadding")
        cipher.init(Cipher.ENCRYPT_MODE, secretKey())
        val encrypted = cipher.doFinal(token.toByteArray(Charsets.UTF_8))
        preferences.edit()
            .putString(KEY_ORIGIN, origin)
            .putString(KEY_TOKEN_CIPHERTEXT, Base64.encodeToString(encrypted, Base64.NO_WRAP))
            .putString(KEY_TOKEN_IV, Base64.encodeToString(cipher.iv, Base64.NO_WRAP))
            .putStringSet(KEY_SCOPES, scopes)
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
            .remove(KEY_SCOPES)
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

    override fun observeCachedTaskWorkProposals(): Flow<List<MobileTaskWorkProposal>> =
        combine(dao.observeTaskWorkProposals(), dao.observeSyncState()) { proposals, syncState ->
            proposals
                .filter { it.serverId == syncState?.serverId }
                .mapNotNull { cached ->
                    runCatching { cached.toProposal() }
                        .onFailure { error ->
                            Log.w(MOBILE_GATEWAY_LOG_TAG, "Discarding an invalid cached Task Work Proposal", error)
                        }
                        .getOrNull()
                }
        }

    override fun observePendingCount(): Flow<Int> = outbox.observePendingCount()

    override fun observeConflictCount(): Flow<Int> = outbox.observeConflictCount()

    override suspend fun enqueueCreateTask(draft: MobileCaptureDraft, todayDate: LocalDate?): String =
        outbox.enqueueCreate(
            title = draft.text,
            todayDate = todayDate,
            projectId = draft.projectId,
            draftId = draft.draftId,
            createdAt = draft.createdAt,
            provenance = draft.toTaskCreationProvenanceDto(),
        )

    override suspend fun undoCreateTask(taskId: String): MobileUndoCreateResult = outbox.undoCreate(taskId)

    override suspend fun enqueueCreateCapture(draft: MobileCaptureDraft): String =
        outbox.enqueueCapture(
            text = draft.text,
            projectId = draft.projectId,
            draftId = draft.draftId,
            createdAt = draft.createdAt,
            provenance = draft.toCaptureCreationProvenanceDto(),
        )

    override suspend fun undoCreateCapture(captureId: String): MobileUndoCreateResult =
        outbox.undoCapture(captureId)

    override suspend fun enqueueUpdateTaskTitle(taskId: String, title: String): String =
        outbox.enqueueUpdateTitle(taskId, title)

    override suspend fun enqueueUpdateTaskTodayDate(taskId: String, todayDate: LocalDate?): String =
        outbox.enqueueUpdateTodayDate(taskId, todayDate)

    override suspend fun enqueueUpdateTaskSchedule(taskId: String, schedule: MobileTaskScheduleDraft): String =
        outbox.enqueueUpdateSchedule(taskId, schedule)

    override suspend fun enqueueUpdateTaskTheme(taskId: String, themeId: String): String =
        outbox.enqueueUpdateTheme(taskId, themeId)

    override suspend fun enqueueUpdateTaskChecklist(taskId: String, items: List<MobileChecklistItem>): String =
        outbox.enqueueUpdateChecklist(taskId, items)

    override suspend fun discardRejectedThemeUpdate(taskId: String, commandId: String) =
        outbox.discardRejectedThemeUpdate(taskId, commandId)

    override suspend fun enqueueCompleteTask(taskId: String): MobileStateActionResult = outbox.enqueueComplete(taskId)

    override suspend fun enqueueReopenTask(taskId: String): MobileStateActionResult = outbox.enqueueReopen(taskId)

    override suspend fun acceptServerConflict(commandId: String) = outbox.acceptServer(commandId)

    override suspend fun keepLocalConflict(commandId: String): String = outbox.keepLocal(commandId)

    override suspend fun loadWorkReceipt(taskId: String, receiptId: String): MobileWorkReceiptLoadResult {
        val expectedServerId = dao.syncState()?.serverId
            ?: return MobileWorkReceiptLoadResult.Unavailable(
                receiptId,
                "Taskを同期してからWork Receiptを開いてください。",
            )
        val cached = runCatching { dao.workReceipt(receiptId, expectedServerId)?.toDetail() }
            .getOrNull()
            ?.takeIf { it.taskId == taskId }
        val configuration = store.configuration()
        val token = store.readToken()
        if (configuration.origin.isBlank() || token == null) {
            return cached?.let {
                MobileWorkReceiptLoadResult.Available(
                    detail = it,
                    fromCache = true,
                    warning = "保存済みのWork Receiptを表示しています。",
                )
            } ?: MobileWorkReceiptLoadResult.Unavailable(
                receiptId,
                "Desktopへ接続するとWork Receiptの詳細を読めます。",
            )
        }
        return try {
            val requestId = URLEncoder.encode(UUID.randomUUID().toString(), Charsets.UTF_8.name())
            val encodedTaskId = URLEncoder.encode(taskId, Charsets.UTF_8.name())
            val encodedReceiptId = URLEncoder.encode(receiptId, Charsets.UTF_8.name())
            val response = gatewayRequest(
                origin = configuration.origin,
                path = "/v1/work-receipt?apiVersion=$TASKEN_MOBILE_API_VERSION" +
                    "&schemaVersion=$TASKEN_MOBILE_SCHEMA_VERSION&requestId=$requestId" +
                    "&taskId=$encodedTaskId&receiptId=$encodedReceiptId",
                method = "GET",
                body = null,
                accessToken = token,
            )
            if (response.status == 401) {
                if (isConfirmedGatewayUnauthorized(response, dao.syncState()?.serverId)) {
                    store.clearTokenIfMatches(token)
                }
                error("Mobile Gateway token expired")
            }
            if (response.status == 404) {
                return cached?.let {
                    MobileWorkReceiptLoadResult.Available(
                        detail = it,
                        fromCache = true,
                        warning = "Desktop側のWork Receipt詳細を確認できないため、保存済み内容を表示しています。",
                    )
                } ?: MobileWorkReceiptLoadResult.Unavailable(
                    receiptId,
                    "Work Receiptが見つかりません。Desktopを最新版へ更新して再読み込みしてください。",
                )
            }
            require(response.status == 200) { "Work Receipt request failed with HTTP ${response.status}" }
            val decoded = MobileWorkReceiptContract.decodeSuccess(response.body)
            if (decoded.meta.serverId != expectedServerId) throw MobileOutboxServerMismatchException()
            val detail = decoded.toDetail()
            require(detail.id == receiptId && detail.taskId == taskId) {
                "Work Receipt response identity does not match the request"
            }
            dao.upsertWorkReceipt(
                detail.toCache(
                    serverId = decoded.meta.serverId,
                    serverRevision = decoded.meta.serverRevision,
                    fetchedAt = decoded.meta.generatedAt,
                ),
            )
            MobileWorkReceiptLoadResult.Available(detail = detail, fromCache = false)
        } catch (error: CancellationException) {
            throw error
        } catch (error: Exception) {
            Log.w(MOBILE_GATEWAY_LOG_TAG, "Mobile Work Receipt request failed", error)
            cached?.let {
                MobileWorkReceiptLoadResult.Available(
                    detail = it,
                    fromCache = true,
                    warning = "Desktopへ接続できないため、保存済みのWork Receiptを表示しています。",
                )
            } ?: MobileWorkReceiptLoadResult.Unavailable(
                receiptId,
                "Work Receiptを読み込めませんでした。DesktopとTailscale接続を確認してください。",
            )
        }
    }

    override suspend fun refreshTaskWorkProposals(): Boolean {
        val configuration = store.configuration()
        val token = store.readToken()
        if (configuration.origin.isBlank() || token == null) return false
        return refreshTaskWorkProposals(configuration.origin, token)
    }

    private suspend fun refreshTaskWorkProposals(origin: String, accessToken: String): Boolean {
        val expectedServerId = dao.syncState()?.serverId ?: return false
        return try {
            val requestId = URLEncoder.encode(UUID.randomUUID().toString(), Charsets.UTF_8.name())
            val response = gatewayRequest(
                origin = origin,
                path = "/v1/proposals?apiVersion=$TASKEN_MOBILE_API_VERSION" +
                    "&schemaVersion=$TASKEN_MOBILE_SCHEMA_VERSION&requestId=$requestId&limit=50",
                method = "GET",
                body = null,
                accessToken = accessToken,
            )
            if (response.status == 401) {
                if (isConfirmedGatewayUnauthorized(response, expectedServerId)) {
                    store.clearTokenIfMatches(accessToken)
                }
                return false
            }
            require(response.status == 200) { "Task Work Proposal request failed with HTTP ${response.status}" }
            val decoded = MobileProposalContract.decodeList(response.body)
            if (decoded.meta.serverId != expectedServerId) throw MobileOutboxServerMismatchException()
            dao.replaceTaskWorkProposals(decoded.data.proposals.map { it.toCache(decoded.meta) })
            true
        } catch (error: CancellationException) {
            throw error
        } catch (error: Exception) {
            Log.w(MOBILE_GATEWAY_LOG_TAG, "Mobile Task Work Proposal refresh failed", error)
            false
        }
    }

    override suspend fun reviewTaskWorkProposal(
        proposal: MobileTaskWorkProposal,
        decision: String,
    ): MobileProposalReviewResult {
        require(decision in setOf("accept", "reject"))
        val expectedServerId = dao.syncState()?.serverId
            ?: return MobileProposalReviewResult.Unavailable(
                proposal.id,
                "Taskを同期してからProposalを判断してください。",
            )
        val cached = dao.taskWorkProposal(proposal.id, expectedServerId)?.toProposal()
            ?: return MobileProposalReviewResult.Conflict(
                proposal.id,
                "Proposalが更新されています。再読み込みしてください。",
            )
        if (
            cached.taskId != proposal.taskId ||
            cached.version != proposal.version ||
            cached.taskVersion != proposal.taskVersion
        ) {
            return MobileProposalReviewResult.Conflict(
                proposal.id,
                "Proposalが更新されています。再読み込みしてください。",
            )
        }
        if (decision == "accept" && cached.stale) {
            return MobileProposalReviewResult.Conflict(
                proposal.id,
                "Taskが更新されています。AIへ再報告を依頼してください。",
            )
        }
        val configuration = store.configuration()
        val token = store.readToken()
        if (configuration.origin.isBlank() || token == null) {
            return MobileProposalReviewResult.Unavailable(
                proposal.id,
                "Desktopへ接続してからProposalを判断してください。",
            )
        }
        return try {
            val commandId = UUID.randomUUID().toString()
            val envelope = MobileTaskWorkProposalDecisionEnvelopeDto(
                apiVersion = TASKEN_MOBILE_API_VERSION,
                schemaVersion = TASKEN_MOBILE_SCHEMA_VERSION,
                requestId = UUID.randomUUID().toString(),
                commandId = commandId,
                idempotencyKey = commandId,
                clientDeviceId = store.deviceId(),
                issuedAt = Instant.now().toString(),
                proposalId = cached.id,
                taskId = cached.taskId,
                expectedProposalVersion = cached.version,
                expectedTaskVersion = cached.taskVersion,
                decision = decision,
            )
            val response = gatewayRequest(
                origin = configuration.origin,
                path = "/v1/proposal-decisions",
                method = "POST",
                body = MobileProposalContract.encodeDecision(envelope),
                accessToken = token,
            )
            if (response.status == 401) {
                val confirmed = isConfirmedGatewayUnauthorized(response, expectedServerId)
                if (confirmed) store.clearTokenIfMatches(token)
                return MobileProposalReviewResult.Unavailable(
                    proposal.id,
                    if (confirmed) {
                        "接続が失効しました。新しいコードで再接続してください。"
                    } else {
                        "Desktopへ接続できませんでした。接続を確認して再試行してください。"
                    },
                )
            }
            if (response.status == 409) {
                val error = MobileTaskCommandContract.decodeError(response.body)
                if (error.meta.serverId != expectedServerId) throw MobileOutboxServerMismatchException()
                refreshTaskWorkProposals(configuration.origin, token)
                return MobileProposalReviewResult.Conflict(
                    proposal.id,
                    error.error.message,
                )
            }
            require(response.status == 200) { "Task Work Proposal decision failed with HTTP ${response.status}" }
            val decoded = MobileProposalContract.decodeDecision(response.body)
            if (decoded.meta.serverId != expectedServerId) throw MobileOutboxServerMismatchException()
            require(
                decoded.data.commandId == commandId &&
                    decoded.data.proposalId == cached.id &&
                    decoded.data.taskId == cached.taskId &&
                    decoded.data.decision == decision
            ) { "Task Work Proposal decision identity does not match the request" }
            dao.deleteTaskWorkProposal(cached.id, expectedServerId)
            runCatching { synchronize(configuration.origin, token, expectedServerId) }
                .onFailure { error ->
                    Log.w(MOBILE_GATEWAY_LOG_TAG, "Task sync after Proposal decision failed", error)
                }
            refreshTaskWorkProposals(configuration.origin, token)
            MobileProposalReviewResult.Applied(cached.id, decision)
        } catch (error: CancellationException) {
            throw error
        } catch (error: MobileOutboxServerMismatchException) {
            MobileProposalReviewResult.Unavailable(
                proposal.id,
                "接続先Desktopが変わりました。再接続してください。",
            )
        } catch (error: Exception) {
            Log.w(MOBILE_GATEWAY_LOG_TAG, "Mobile Task Work Proposal decision failed", error)
            MobileProposalReviewResult.Unavailable(
                proposal.id,
                "Proposalを判断できませんでした。DesktopとTailscale接続を確認してください。",
            )
        }
    }

    override suspend fun reviewTaskWork(
        task: MobileTask,
        action: String,
        reviewNote: String?,
    ): MobileHumanReviewResult {
        require(action in setOf("accept", "return"))
        val receipt = task.latestWorkReceipt
            ?: return MobileHumanReviewResult.Conflict(task.id, "最新のWork Receiptを同期してから判断してください。")
        if (task.version <= 0) {
            return MobileHumanReviewResult.Conflict(task.id, "最新のTaskを同期してから判断してください。")
        }
        val normalizedNote = reviewNote?.trim()
        if (action == "return" && normalizedNote.isNullOrEmpty()) {
            return MobileHumanReviewResult.Conflict(task.id, "差し戻しまたは返信の内容を入力してください。")
        }
        val expectedServerId = dao.syncState()?.serverId
            ?: return MobileHumanReviewResult.Unavailable(task.id, "Taskを同期してからWork Receiptを判断してください。")
        val configuration = store.configuration()
        val token = store.readToken()
        if (configuration.origin.isBlank() || token == null) {
            return MobileHumanReviewResult.Unavailable(task.id, "Desktopへ接続してからWork Receiptを判断してください。")
        }
        if (!configuration.canReviewWorkReceipts()) {
            return MobileHumanReviewResult.Unavailable(
                task.id,
                "この権限ではWork Receiptを判断できません。Desktopで新しいコードを発行して再ペアリングしてください。",
            )
        }
        return try {
            val clientDeviceId = store.deviceId()
            val commandId = humanReviewCommandId(
                clientDeviceId = clientDeviceId,
                serverId = expectedServerId,
                taskId = task.id,
                expectedTaskVersion = task.version,
                receiptId = receipt.id,
                action = action,
                normalizedReviewNote = if (action == "return") normalizedNote else null,
            )
            val createdEnvelope = MobileTaskWorkReviewEnvelopeDto(
                apiVersion = TASKEN_MOBILE_API_VERSION,
                schemaVersion = TASKEN_MOBILE_SCHEMA_VERSION,
                requestId = UUID.randomUUID().toString(),
                commandId = commandId,
                idempotencyKey = commandId,
                clientDeviceId = clientDeviceId,
                issuedAt = Instant.now().toString(),
                taskId = task.id,
                expectedTaskVersion = task.version,
                receiptId = receipt.id,
                action = action,
                reviewNote = if (action == "return") normalizedNote else null,
            )
            val pending = dao.pendingHumanReviewOrInsert(
                PendingHumanReviewEntity(
                    commandId = commandId,
                    serverId = expectedServerId,
                    taskId = task.id,
                    envelopeJson = MobileHumanReviewContract.encode(createdEnvelope),
                    createdAt = Instant.now().toString(),
                ),
            )
            require(pending.serverId == expectedServerId && pending.taskId == task.id) {
                "Pending Work Receipt review belongs to another Desktop or Task"
            }
            val envelope = MobileHumanReviewContract.decodeEnvelope(pending.envelopeJson)
            require(
                envelope.commandId == commandId &&
                    envelope.idempotencyKey == commandId &&
                    envelope.clientDeviceId == clientDeviceId &&
                    envelope.taskId == task.id &&
                    envelope.expectedTaskVersion == task.version &&
                    envelope.receiptId == receipt.id &&
                    envelope.action == action &&
                    envelope.reviewNote == if (action == "return") normalizedNote else null
            ) { "Pending Work Receipt review identity does not match the request" }
            val response = gatewayRequest(
                origin = configuration.origin,
                path = "/v1/work-reviews",
                method = "POST",
                body = pending.envelopeJson,
                accessToken = token,
            )
            if (response.status == 401) {
                val confirmed = isConfirmedGatewayUnauthorized(response, expectedServerId)
                if (confirmed) store.clearTokenIfMatches(token)
                return MobileHumanReviewResult.Unavailable(
                    task.id,
                    if (confirmed) {
                        "接続が失効しました。新しいコードで再接続してください。"
                    } else {
                        "Desktopへ接続できませんでした。接続を確認して再試行してください。"
                    },
                )
            }
            if (response.status == 409) {
                val error = MobileTaskCommandContract.decodeError(response.body)
                if (error.meta.serverId != expectedServerId) throw MobileOutboxServerMismatchException()
                require(error.error.code in setOf("work_review_task_conflict", "work_review_receipt_conflict")) {
                    "Unexpected Work Receipt review conflict code: ${error.error.code}"
                }
                dao.deletePendingHumanReview(commandId)
                runCatching { synchronize(configuration.origin, token, expectedServerId) }
                return MobileHumanReviewResult.Conflict(task.id, error.error.message)
            }
            if (response.status == 403 || response.status == 400 || response.status == 404) {
                val error = MobileTaskCommandContract.decodeError(response.body)
                if (error.meta.serverId != expectedServerId) throw MobileOutboxServerMismatchException()
                dao.deletePendingHumanReview(commandId)
                return MobileHumanReviewResult.Rejected(task.id, error.error.message)
            }
            require(response.status == 200) { "Task work review failed with HTTP ${response.status}" }
            val decoded = MobileHumanReviewContract.decode(response.body)
            if (decoded.meta.serverId != expectedServerId) throw MobileOutboxServerMismatchException()
            require(
                decoded.data.commandId == commandId &&
                    decoded.data.task.id == task.id &&
                    decoded.data.receiptId == receipt.id &&
                    decoded.data.action == action
            ) { "Task work review identity does not match the request" }
            dao.applyHumanReviewSuccess(commandId, decoded.data.task.toCache())
            runCatching { synchronize(configuration.origin, token, expectedServerId) }
                .onFailure { error -> Log.w(MOBILE_GATEWAY_LOG_TAG, "Task sync after Work Receipt review failed", error) }
            MobileHumanReviewResult.Applied(task.id, action)
        } catch (error: CancellationException) {
            throw error
        } catch (error: MobileOutboxServerMismatchException) {
            MobileHumanReviewResult.Unavailable(task.id, "接続先Desktopが変わりました。再接続してください。")
        } catch (error: Exception) {
            Log.w(MOBILE_GATEWAY_LOG_TAG, "Mobile Work Receipt review failed", error)
            MobileHumanReviewResult.Unavailable(
                task.id,
                "Work Receiptを判断できませんでした。DesktopとTailscale接続を確認してください。",
            )
        }
    }

    internal suspend fun recoverInterruptedOutbox(): Int = outbox.recoverInterruptedSending()

    internal suspend fun synchronizeIfPaired(): Boolean {
        val configuration = store.configuration()
        val token = store.readToken()
        if (configuration.origin.isBlank() || token == null) return true
        return try {
            val serverId = confirmRemoteAndApplyBootstrap(configuration.origin, token)
            if (outbox.drain(serverId) { envelope ->
                    sendMobileCommand(configuration.origin, token, serverId, envelope)
                }
            ) return false
            synchronize(configuration.origin, token, serverId)
            refreshTaskWorkProposals(configuration.origin, token)
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
            ?: return MobileTodayResult.PairingRequired(
                origin,
                "Gateway URLが不正です。Tailscale Serveの https:// で始まるURLを入力してください。",
            )
        if (!pairingCode.matches(Regex("^\\d{8}$"))) {
            return MobileTodayResult.PairingRequired(
                normalizedOrigin,
                "ペアリングコードが不正です。Desktopで8桁のコードを発行して入力してください。",
            )
        }
        return try {
            val payload = buildJsonObject {
                put("apiVersion", TASKEN_MOBILE_API_VERSION)
                put("schemaVersion", TASKEN_MOBILE_SCHEMA_VERSION)
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
                return MobileTodayResult.PairingRequired(
                    normalizedOrigin,
                    if (response.status == 401) {
                        "ペアリングできませんでした。Desktopで新しいコードを発行してください。"
                    } else {
                        "ペアリングできませんでした。DesktopとTailscale接続を確認してください。"
                    },
                )
            }
            val root = json.parseToJsonElement(response.body).jsonObject
            val serverId = root["meta"]?.jsonObject?.get("serverId")?.jsonPrimitive?.content.orEmpty()
            require(serverId.isNotBlank()) { "Pairing response serverId is missing" }
            val data = root["data"]?.jsonObject ?: error("Pairing response data is missing")
            val token = data["accessToken"]?.jsonPrimitive?.content.orEmpty()
            val scopeList = data["scopes"]?.jsonArray?.map { scope ->
                val primitive = scope.jsonPrimitive
                require(primitive.isString) { "Pairing response scope is not a string" }
                primitive.content.also {
                    require(it in SUPPORTED_MOBILE_SCOPES) { "Pairing response scope is unsupported" }
                }
            } ?: error("Pairing response scopes are missing")
            require(scopeList.isNotEmpty()) { "Pairing response scopes are empty" }
            require(scopeList.size == scopeList.toSet().size) { "Pairing response scopes contain duplicates" }
            runBlocking {
                if (dao.incompatibleOutboxCount(serverId) != 0) throw MobileOutboxServerMismatchException()
            }
            store.save(normalizedOrigin, token, scopeList.toSet())
            loadToday()
        } catch (error: MobileOutboxServerMismatchException) {
            MobileTodayResult.Unavailable(
                "未解決の変更は別のDesktopに属しています。",
                "元のDesktopへ再接続して送信するか、却下されたTheme変更を取り下げてから再接続してください。",
            )
        } catch (error: Exception) {
            Log.w(MOBILE_GATEWAY_LOG_TAG, "Mobile Gateway pairing request failed", error)
            MobileTodayResult.PairingRequired(
                normalizedOrigin,
                "Mobile Gatewayに接続できません。Desktopが起動中で、Tailscale Serveが有効か確認してください。",
            )
        }
    }

    override fun retryPairing(): MobileTodayResult {
        store.clearToken()
        return MobileTodayResult.PairingRequired(store.configuration().origin)
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
                    sendMobileCommand(configuration.origin, token, serverId, envelope)
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
            val (cached, syncState) = runBlocking {
                dao.tasksForDate(LocalDate.now().toString()).map(TaskCacheEntity::toMobileTask) to dao.syncState()
            }
            if (syncState != null) {
                MobileTodayResult.Available(cached, syncState.lastSuccessfulSyncAt.orEmpty())
            } else {
                MobileTodayResult.Unavailable(
                    "Mobile Gatewayに接続できません。",
                    "DesktopとTailscale接続を確認して再読み込みするか、やり直してURLとコードを入力し直してください。",
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
                path = "/v1/sync?apiVersion=$TASKEN_MOBILE_API_VERSION" +
                    "&schemaVersion=$TASKEN_MOBILE_SCHEMA_VERSION&requestId=$encodedRequestId" +
                    "&cursor=$encodedCursor&limit=50",
                method = "GET",
                body = null,
                accessToken = accessToken,
            )
            if (response.status == 401) {
                if (isConfirmedGatewayUnauthorized(response, expectedServerId)) {
                    store.clearTokenIfMatches(accessToken)
                }
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
            path = "/v1/bootstrap?apiVersion=$TASKEN_MOBILE_API_VERSION" +
                "&schemaVersion=$TASKEN_MOBILE_SCHEMA_VERSION&requestId=$requestId&limit=50",
            method = "GET",
            body = null,
            accessToken = accessToken,
        )
        if (response.status == 401) {
            if (isConfirmedGatewayUnauthorized(response, dao.syncState()?.serverId)) {
                store.clearTokenIfMatches(accessToken)
            }
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
                    path = "/v1/themes?apiVersion=$TASKEN_MOBILE_API_VERSION" +
                        "&schemaVersion=$TASKEN_MOBILE_SCHEMA_VERSION&requestId=$requestId" +
                        "&limit=50$cursorQuery",
                    method = "GET",
                    body = null,
                    accessToken = accessToken,
                )
                if (isConfirmedGatewayUnauthorized(response, expectedServerId)) {
                    store.clearTokenIfMatches(accessToken)
                }
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
        plannedStartTime = plannedStartTime,
        plannedDurationMinutes = plannedDurationMinutes,
        latestReceiptId = latestWorkReceipt?.id,
        latestReceiptReportedAt = latestWorkReceipt?.reportedAt,
        latestReceiptExecutorLabel = latestWorkReceipt?.executorLabel,
        latestReceiptSummary = latestWorkReceipt?.summary,
        checklistJson = encodeMobileChecklist(checklistItems),
        scheduleId = schedule?.id,
        scheduleVersion = schedule?.version,
        scheduleStartDate = schedule?.startDate,
        scheduleEndDate = schedule?.endDate,
        scheduleDateKind = schedule?.dateKind,
        scheduleRangeSemantics = schedule?.rangeSemantics,
        scheduleConfidence = schedule?.confidence,
        scheduleGranularity = schedule?.granularity,
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

    private fun sendMobileCommand(
        origin: String,
        accessToken: String,
        expectedServerId: String,
        envelopeJson: String,
    ): MobileCommandSendResult {
        return try {
            val commandName = Json.parseToJsonElement(envelopeJson)
                .jsonObject.getValue("command").jsonObject.getValue("name").jsonPrimitive.content
            val captureCommand = commandName in setOf("CreateCapture", "DeleteCapture")
            val response = gatewayRequest(
                origin = origin,
                path = "/v1/commands",
                method = "POST",
                body = envelopeJson,
                accessToken = accessToken,
            )
            when {
                response.status == 200 -> {
                    if (captureCommand) {
                        val receipt = MobileCaptureCommandContract.decodeReceipt(response.body)
                        if (receipt.meta.serverId != expectedServerId) {
                            MobileCommandSendResult.Retry("Desktopの識別情報が送信前と一致しません。再接続してください。")
                        } else {
                            MobileCommandSendResult.CaptureApplied(receipt)
                        }
                    } else {
                        val receipt = MobileTaskCommandContract.decodeReceipt(response.body)
                        if (receipt.meta.serverId != expectedServerId) {
                            MobileCommandSendResult.Retry("Desktopの識別情報が送信前と一致しません。再接続してください。")
                        } else {
                            MobileCommandSendResult.Applied(receipt)
                        }
                    }
                }
                response.status == 401 -> {
                    val confirmed = isConfirmedGatewayUnauthorized(response, expectedServerId)
                    if (confirmed) store.clearTokenIfMatches(accessToken)
                    MobileCommandSendResult.Retry(
                        if (confirmed) {
                            "接続が失効しました。新しいコードで再接続してください。"
                        } else {
                            "Desktopへ送信できませんでした。自動で再送します。"
                        },
                    )
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
                            message = error?.error?.message ?: "Desktopが操作を受理しませんでした。",
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
