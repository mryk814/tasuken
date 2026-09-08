package jp.personal.tasken.companion

import androidx.room.Entity
import java.time.OffsetDateTime
import kotlinx.coroutines.flow.Flow
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.Json

@Serializable
data class MobileThemeCharter(
    val schema: String,
    val purpose: String,
    val desired_outcome: String,
    val principles: List<String>,
    val scope: String,
    val non_goals: List<String>,
    val long_term_questions: List<String>,
    val learning_interests: List<String>,
)

@Serializable
data class MobileThemeCurrentState(
    val schema: String,
    val current_direction: String,
    val active_questions: List<String>,
    val current_bets: List<String>,
    val blockers: List<String>,
    val unresolved_decisions: List<String>,
    val next_frontier: String,
    val updated_at: String?,
)

@Serializable
data class MobileThemeContext(
    val id: String,
    val title: String,
    val version: Int,
    val updatedAt: String?,
    val charter: MobileThemeCharter?,
    val currentState: MobileThemeCurrentState?,
)

@Serializable
data class MobileThemeContextData(val themeId: String, val status: String, val theme: MobileThemeContext?)

@Serializable
data class MobileThemeContextResponse(val ok: Boolean, val meta: MobileResponseMetaDto, val data: MobileThemeContextData)

@Serializable enum class ThemeContextContent { Unfetched, Available, Missing }
@Serializable enum class ThemeContextFailure { Offline, Unsupported, InvalidResponse, AccessDenied }

@Serializable
data class ThemeContextState(
    val content: ThemeContextContent = ThemeContextContent.Unfetched,
    val theme: MobileThemeContext? = null,
    val fetchedAt: String? = null,
    val failure: ThemeContextFailure? = null,
)

@Entity(tableName = "theme_context_cache", primaryKeys = ["serverId", "themeId"])
data class ThemeContextCacheEntity(val serverId: String, val themeId: String, val payload: String)

interface MobileThemeContextRepository {
    fun observeThemeContext(themeId: String): Flow<ThemeContextState>
    suspend fun refreshThemeContext(themeId: String)
}

object MobileThemeContextContract {
    private val json = Json { ignoreUnknownKeys = false }

    fun decode(payload: String): MobileThemeContextResponse {
        val response = json.decodeFromString<MobileThemeContextResponse>(payload)
        require(response.ok && !response.meta.truncated)
        require(response.meta.apiVersion == TASKEN_MOBILE_API_VERSION && response.meta.schemaVersion == TASKEN_MOBILE_SCHEMA_VERSION)
        requireId(response.meta.serverId)
        require(response.meta.serverRevision >= 0)
        requireTimestamp(response.meta.generatedAt)
        requireId(response.data.themeId)
        when (response.data.status) {
            "not_found" -> require(response.data.theme == null)
            "available" -> {
                val theme = requireNotNull(response.data.theme)
                require(theme.id == response.data.themeId && theme.title.isNotEmpty() && theme.title.length <= 500 && theme.version > 0)
                theme.updatedAt?.let(::requireTimestamp)
                theme.charter?.let {
                    require(it.schema == "tasken-theme-charter/v1")
                    listOf(it.purpose, it.desired_outcome, it.scope).forEach(::requireText)
                    listOf(it.principles, it.non_goals, it.long_term_questions, it.learning_interests).forEach(::requireItems)
                }
                theme.currentState?.let {
                    require(it.schema == "tasken-theme-state/v1")
                    listOf(it.current_direction, it.next_frontier).forEach(::requireText)
                    listOf(it.active_questions, it.current_bets, it.blockers, it.unresolved_decisions).forEach(::requireItems)
                    it.updated_at?.let(::requireTimestamp)
                }
            }
            else -> error("Unknown Theme content state")
        }
        return response
    }

    private fun requireId(value: String) { require(value.isNotBlank() && value == value.trim() && value.length <= 200) }
    private fun requireText(value: String) { require(value.length <= 8000) }
    private fun requireItems(value: List<String>) { require(value.size <= 20 && value.all { it.length <= 1000 }) }
    private fun requireTimestamp(value: String) { OffsetDateTime.parse(value) }
}
