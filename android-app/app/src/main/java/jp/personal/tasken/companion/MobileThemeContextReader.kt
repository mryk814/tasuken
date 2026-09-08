package jp.personal.tasken.companion

import java.net.URLEncoder
import java.time.Instant
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.serialization.json.Json

internal class MobileThemeContextReader(
    private val dao: MobileLocalDao,
    private val request: suspend (String) -> GatewayHttpResponse,
) {
    private val json = Json { ignoreUnknownKeys = false }
    private val lock = Mutex()

    fun observe(themeId: String) = combine(dao.observeThemeContexts(themeId), dao.observeSyncState()) { rows, sync ->
        rows.firstOrNull { it.serverId == sync?.serverId }?.let { json.decodeFromString<ThemeContextState>(it.payload) }
            ?: ThemeContextState()
    }

    suspend fun refresh(themeId: String) = lock.withLock {
        val serverId = dao.syncState()?.serverId ?: return@withLock
        val generation = dao.ownerReadGeneration(serverId)
        val previous = dao.themeContext(serverId, themeId)?.let { json.decodeFromString<ThemeContextState>(it.payload) }
            ?: ThemeContextState()
        var accessRevoked = false
        val next = try {
            val encodedId = URLEncoder.encode(themeId, Charsets.UTF_8.name())
            val response = request("/v1/theme-context?apiVersion=$TASKEN_MOBILE_API_VERSION&schemaVersion=$TASKEN_MOBILE_SCHEMA_VERSION&themeId=$encodedId")
            val error = if (response.status != 200) runCatching { MobileTaskCommandContract.decodeError(response.body) }.getOrNull() else null
            if (error?.meta?.serverId == serverId && (
                    response.status == 401 && error.error.code == "unauthorized" ||
                    response.status == 403 && error.error.code == "forbidden"
                )) {
                dao.revokeOwnerReadCaches(serverId)
                accessRevoked = true
                ThemeContextState(failure = ThemeContextFailure.AccessDenied)
            } else if (response.status != 200) {
                previous.copy(failure = if (response.status == 404 ||
                    error?.error?.code in listOf("capability_unavailable", "unsupported_api_version", "unsupported_schema_version"))
                    ThemeContextFailure.Unsupported else ThemeContextFailure.Offline)
            } else {
                val decoded = runCatching {
                    MobileThemeContextContract.decode(response.body).also {
                        require(it.meta.serverId == serverId && it.data.themeId == themeId)
                    }
                }.getOrNull()
                if (decoded == null) previous.copy(failure = ThemeContextFailure.InvalidResponse)
                else ThemeContextState(
                    content = if (decoded.data.status == "available") ThemeContextContent.Available else ThemeContextContent.Missing,
                    theme = decoded.data.theme,
                    fetchedAt = Instant.now().toString(),
                )
            }
        } catch (cancel: CancellationException) {
            throw cancel
        } catch (_: Exception) {
            previous.copy(failure = ThemeContextFailure.Offline)
        }
        dao.saveThemeContext(
            ThemeContextCacheEntity(serverId, themeId, json.encodeToString(next)),
            if (accessRevoked) dao.ownerReadGeneration(serverId) else generation,
        )
    }
}
