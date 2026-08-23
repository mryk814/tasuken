package jp.personal.tasken.companion

import android.content.Intent
import java.net.URI

enum class MobileEntrySource {
    App,
    AppShortcut,
    ShareTarget,
    Widget,
    AndroidSpeech,
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
        val startVoice: Boolean = false,
        val sharedMimeType: String? = null,
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
            if (text.isNotEmpty()) return MobileEntryRequest.Capture(
                token = token,
                source = MobileEntrySource.ShareTarget,
                draft = text,
                sharedMimeType = mimeType,
            )
        }
        val uri = data?.let { runCatching { URI(it) }.getOrNull() } ?: return MobileEntryRequest.None
        if (uri.scheme != "tasken") return MobileEntryRequest.None
        val source = when (queryParameter(uri.rawQuery, "source")) {
            "app_shortcut" -> MobileEntrySource.AppShortcut
            "widget" -> MobileEntrySource.Widget
            "android_speech" -> MobileEntrySource.AndroidSpeech
            else -> MobileEntrySource.DeepLink
        }
        val path = uri.path.trim('/')
        return when {
            uri.host == "today" && path.isEmpty() -> MobileEntryRequest.Today(token, source)
            uri.host == "capture" && path == "new" -> MobileEntryRequest.Capture(
                token = token,
                source = source,
                startVoice = source == MobileEntrySource.AndroidSpeech || queryParameter(uri.rawQuery, "voice") == "1",
            )
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

internal fun MobileEntrySource.toCaptureSource(): MobileCaptureSource = when (this) {
    MobileEntrySource.App -> MobileCaptureSource.AndroidApp
    MobileEntrySource.AppShortcut -> MobileCaptureSource.AppShortcut
    MobileEntrySource.ShareTarget -> MobileCaptureSource.ShareTarget
    MobileEntrySource.Widget -> MobileCaptureSource.Widget
    MobileEntrySource.AndroidSpeech -> MobileCaptureSource.AndroidSpeech
    MobileEntrySource.DeepLink -> MobileCaptureSource.AndroidApp
}
