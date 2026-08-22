package jp.personal.tasken.companion

import java.time.OffsetDateTime
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.Json

@Serializable
data class MobileThemesResponseDto(
    val ok: Boolean,
    val meta: MobileResponseMetaDto,
    val data: MobileThemesDataDto,
)

@Serializable
data class MobileThemesDataDto(
    val themes: List<MobileThemeSummaryDto>,
    val nextCursor: String?,
)

@Serializable
data class MobileThemeSummaryDto(
    val id: String,
    val title: String,
)

class MobileThemeContractException(message: String, cause: Throwable? = null) :
    IllegalArgumentException(message, cause)

object MobileThemeContract {
    private const val MaxItems = 50
    private val json = Json {
        ignoreUnknownKeys = false
        isLenient = false
        coerceInputValues = false
    }

    fun decodePage(payload: String): MobileThemesResponseDto = try {
        json.decodeFromString<MobileThemesResponseDto>(payload)
            .normalized()
            .also(::validate)
    } catch (error: MobileThemeContractException) {
        throw error
    } catch (error: Exception) {
        throw MobileThemeContractException("Theme response does not match the strict JSON shape.", error)
    }

    private fun validate(response: MobileThemesResponseDto) {
        requireContract(response.ok, "Theme success response requires ok=true.")
        requireContract(
            response.meta.apiVersion == 1 && response.meta.schemaVersion == 2,
            "Unsupported mobile Theme version.",
        )
        requireContract(isEntityId(response.meta.serverId), "Invalid serverId.")
        requireContract(response.meta.serverRevision >= 0, "serverRevision must be non-negative.")
        requireContract(isTimestamp(response.meta.generatedAt), "Invalid generatedAt timestamp.")
        requireContract(response.data.themes.size <= MaxItems, "Theme response exceeds the item limit.")
        requireContract(
            response.data.nextCursor == null || isEntityId(response.data.nextCursor),
            "Invalid Theme cursor.",
        )
        requireContract(
            response.meta.truncated == (response.data.nextCursor != null),
            "Theme pagination metadata is inconsistent.",
        )
        response.data.themes.forEach { theme ->
            requireContract(isEntityId(theme.id), "Invalid Theme ID.")
            requireContract(theme.title.isNotEmpty() && theme.title.length <= 500, "Invalid Theme title.")
        }
        requireContract(
            response.data.themes.map { it.id }.distinct().size == response.data.themes.size,
            "Theme response contains duplicate IDs.",
        )
    }

    private fun MobileThemesResponseDto.normalized(): MobileThemesResponseDto = copy(
        meta = meta.copy(serverId = meta.serverId.trim()),
        data = data.copy(
            nextCursor = data.nextCursor?.trim(),
            themes = data.themes.map { theme ->
                theme.copy(id = theme.id.trim(), title = theme.title.trim())
            },
        ),
    )

    private fun isEntityId(value: String): Boolean = value.isNotEmpty() && value.length <= 200

    private fun isTimestamp(value: String): Boolean = runCatching { OffsetDateTime.parse(value) }.isSuccess

    private fun requireContract(condition: Boolean, message: String) {
        if (!condition) throw MobileThemeContractException(message)
    }
}
