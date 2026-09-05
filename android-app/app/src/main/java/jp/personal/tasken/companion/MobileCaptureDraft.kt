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
    val capturedAt: String? = null,
    val timeZone: String? = null,
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
    val organization: MobileCaptureOrganization? = null,
    val originalText: String? = null,
    val originalThemeId: String? = null,
) {
    init {
        require(speech == null || source == MobileCaptureSource.AndroidSpeech)
        require((source == MobileCaptureSource.ShareTarget) == (share != null))
    }

    // Drafts retain the original input; the command boundary enforces the 500-character save limit.
    fun withText(value: String): MobileCaptureDraft = copy(text = value, organization = organization?.copy(title = value))

    fun withKind(value: MobileCaptureKind): MobileCaptureDraft =
        if (value == kind) this else withoutOrganization().copy(kind = value)

    fun withoutOrganization(): MobileCaptureDraft = copy(
        text = originalText ?: text,
        projectId = if (organization != null) originalThemeId else projectId,
        organization = null, originalText = null, originalThemeId = null,
    )

    fun withThemeId(value: String?): MobileCaptureDraft = copy(
        projectId = value?.trim()?.takeIf(String::isNotEmpty),
        organization = organization?.copy(themeId = value?.trim()?.takeIf(String::isNotEmpty)),
    )

    fun withOrganization(value: MobileCaptureOrganization): MobileCaptureDraft {
        value.validate()
        val original = originalText ?: text
        require(original.isNotBlank() && original.length <= 12000)
        return copy(text = value.title, projectId = value.themeId, kind = MobileCaptureKind.Task,
            organization = value, originalText = original,
            originalThemeId = if (organization == null) projectId else originalThemeId)
    }

    fun withSpeechResult(
        result: ShortSpeechRecognitionResult,
        append: Boolean = false,
        capturedAt: String = Instant.now().toString(),
        timeZone: String = java.time.ZoneId.systemDefault().id,
    ): MobileCaptureDraft = copy(
        text = if (append && (originalText ?: text).isNotBlank()) "${originalText ?: text} ${result.text}" else result.text,
        organization = null,
        originalText = null,
        projectId = if (organization != null) originalThemeId else projectId,
        originalThemeId = null,
        source = MobileCaptureSource.AndroidSpeech,
        speech = MobileSpeechProvenance(
            recognitionMode = result.mode,
            language = result.language,
            confidence = result.confidence,
            sourceAudioAvailable = false,
            capturedAt = capturedAt,
            timeZone = timeZone,
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
            text = text,
            kind = kind,
            projectId = projectId,
            source = source,
            speech = null,
            share = share,
            createdAt = now().toString(),
        )
    }
}
