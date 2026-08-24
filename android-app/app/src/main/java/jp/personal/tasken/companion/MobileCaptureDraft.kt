package jp.personal.tasken.companion

import java.time.Instant
import java.util.UUID

enum class MobileCaptureKind(val wireValue: String) {
    Task("task"),
    Capture("capture"),
    ;

    companion object {
        fun fromWireValue(value: String?): MobileCaptureKind = entries.firstOrNull { it.wireValue == value } ?: Task
    }
}

enum class MobileCaptureSource(val wireValue: String) {
    AndroidApp("android_app"),
    Widget("widget"),
    AppShortcut("app_shortcut"),
    ShareTarget("share_target"),
    AndroidSpeech("android_speech"),
    ;

    companion object {
        fun fromWireValue(value: String?): MobileCaptureSource =
            entries.firstOrNull { it.wireValue == value } ?: AndroidApp
    }
}

enum class MobileSpeechRecognitionMode(val wireValue: String) {
    OnDevice("on_device"),
    SystemService("system_service"),
    Unknown("unknown"),
    ;

    companion object {
        fun fromWireValue(value: String?): MobileSpeechRecognitionMode =
            entries.firstOrNull { it.wireValue == value } ?: Unknown
    }
}

data class MobileSpeechProvenance(
    val recognitionMode: MobileSpeechRecognitionMode,
    val language: String,
    val confidence: Float? = null,
    val sourceAudioAvailable: Boolean = false,
)

data class MobileShareProvenance(
    val mimeType: String,
) {
    init {
        require(mimeType == "text/plain")
    }
}

data class MobileCaptureDraft(
    val draftId: String,
    val text: String,
    val kind: MobileCaptureKind,
    val projectId: String?,
    val source: MobileCaptureSource,
    val speech: MobileSpeechProvenance?,
    val share: MobileShareProvenance?,
    val createdAt: String,
) {
    init {
        require(speech == null || source == MobileCaptureSource.AndroidSpeech)
        require((source == MobileCaptureSource.ShareTarget) == (share != null))
    }

    fun withText(value: String): MobileCaptureDraft = copy(text = value.take(500))

    fun withKind(value: MobileCaptureKind): MobileCaptureDraft = copy(kind = value)

    fun withThemeId(value: String?): MobileCaptureDraft = copy(
        projectId = value?.trim()?.takeIf(String::isNotEmpty),
    )

    fun withSpeechResult(result: ShortSpeechRecognitionResult): MobileCaptureDraft = copy(
        text = result.text.take(500),
        source = MobileCaptureSource.AndroidSpeech,
        speech = MobileSpeechProvenance(
            recognitionMode = result.mode,
            language = result.language,
            confidence = result.confidence,
            sourceAudioAvailable = false,
        ),
        share = null,
    )

    companion object {
        fun fresh(
            text: String = "",
            source: MobileCaptureSource = MobileCaptureSource.AndroidApp,
            kind: MobileCaptureKind = MobileCaptureKind.Task,
            projectId: String? = null,
            share: MobileShareProvenance? = null,
            now: () -> Instant = Instant::now,
            newId: () -> String = { UUID.randomUUID().toString() },
        ): MobileCaptureDraft = MobileCaptureDraft(
            draftId = newId(),
            text = text.take(500),
            kind = kind,
            projectId = projectId,
            source = source,
            speech = null,
            share = share,
            createdAt = now().toString(),
        )
    }
}
