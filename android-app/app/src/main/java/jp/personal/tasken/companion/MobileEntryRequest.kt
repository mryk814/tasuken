package jp.personal.tasken.companion

import android.content.Intent
import java.net.URI

enum class MobileEntrySource {
    App,
    AppShortcut,
    ShareTarget,
    Widget,
    DeepLink,
}

sealed interface MobileEntryRequest {
    val token: Long

    data class Today(
        override val token: Long,
        val source: MobileEntrySource,
    ) : MobileEntryRequest

    data class Capture(
        override val token: Long,
        val source: MobileEntrySource,
        val draft: String = "",
    ) : MobileEntryRequest

    data class Task(
        override val token: Long,
        val source: MobileEntrySource,
        val taskId: String,
    ) : MobileEntryRequest

    data object None : MobileEntryRequest {
        override val token: Long = 0
    }
}

object MobileEntryRequestResolver {
    fun fromIntent(intent: Intent?, token: Long = System.nanoTime()): MobileEntryRequest = resolve(
        action = intent?.action,
        data = intent?.dataString,
        mimeType = intent?.type,
        sharedText = intent?.getStringExtra(Intent.EXTRA_TEXT),
        token = token,
    )

    internal fun resolve(
        action: String?,
        data: String?,
        mimeType: String?,
        sharedText: String?,
        token: Long,
    ): MobileEntryRequest {
        if (action == Intent.ACTION_SEND && mimeType == "text/plain") {
            val text = sharedText?.trim().orEmpty()
            if (text.isNotEmpty()) return MobileEntryRequest.Capture(token, MobileEntrySource.ShareTarget, text)
        }
        val uri = data?.let { runCatching { URI(it) }.getOrNull() } ?: return MobileEntryRequest.None
        if (uri.scheme != "tasken") return MobileEntryRequest.None
        val source = when (queryParameter(uri.rawQuery, "source")) {
            "app_shortcut" -> MobileEntrySource.AppShortcut
            "widget" -> MobileEntrySource.Widget
            else -> MobileEntrySource.DeepLink
        }
        val path = uri.path.trim('/')
        return when {
            uri.host == "today" && path.isEmpty() -> MobileEntryRequest.Today(token, source)
            uri.host == "capture" && path == "new" -> MobileEntryRequest.Capture(token, source)
            uri.host == "task" && path.matches(ENTITY_ID) -> MobileEntryRequest.Task(token, source, path)
            else -> MobileEntryRequest.None
        }
    }

    private fun queryParameter(query: String?, name: String): String? = query
        ?.split('&')
        ?.mapNotNull { part -> part.split('=', limit = 2).takeIf { it.size == 2 } }
        ?.firstOrNull { it[0] == name }
        ?.get(1)

    private val ENTITY_ID = Regex("^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-5][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$")
}
