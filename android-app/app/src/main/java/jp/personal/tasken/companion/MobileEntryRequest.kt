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
        val taskId = MobileTaskLocator.parse(uri)
        val source = when (queryParameter(uri.rawQuery, "source")) {
            "app_shortcut" -> MobileEntrySource.AppShortcut
            "widget" -> MobileEntrySource.Widget
            // 更新前にホーム画面へ置いた「音声で追加」のショートカットが送ってくる。音声入力は #808 で外したので、
            // ふつうの文字入力を開く。音声を使っていない入力に音声の出どころを付けないよう、ショートカット扱いにする。
            "android_speech" -> MobileEntrySource.AppShortcut
            else -> MobileEntrySource.DeepLink
        }
        return when {
            uri.host == "today" && uri.path.trim('/') == "" -> MobileEntryRequest.Today(token, source)
            uri.host == "capture" && uri.path.trim('/') == "new" -> MobileEntryRequest.Capture(
                token = token,
                source = source,
            )
            taskId != null -> MobileEntryRequest.Task(
                token,
                source,
                taskId,
            )
            else -> MobileEntryRequest.None
        }
    }

    private fun queryParameter(query: String?, name: String): String? = query
        ?.split('&')
        ?.mapNotNull { part -> part.split('=', limit = 2).takeIf { it.size == 2 } }
        ?.firstOrNull { it[0] == name }
        ?.get(1)

}

internal fun MobileEntrySource.toCaptureSource(): MobileCaptureSource = when (this) {
    MobileEntrySource.App -> MobileCaptureSource.AndroidApp
    MobileEntrySource.AppShortcut -> MobileCaptureSource.AppShortcut
    MobileEntrySource.ShareTarget -> MobileCaptureSource.ShareTarget
    MobileEntrySource.Widget -> MobileCaptureSource.Widget
    MobileEntrySource.DeepLink -> MobileCaptureSource.AndroidApp
}
