package jp.personal.tasken.companion

import java.time.Instant
import java.util.UUID

// Kotlin and the TypeScript wire contract count UTF-16 code units (String.length).
internal const val MOBILE_CAPTURE_TEXT_MAX_LENGTH = 12000
internal const val MOBILE_TASK_TITLE_MAX_LENGTH = 500
// An older Desktop's strict schema rejects this field, so even a short original text never falls into
// the old trim path.
internal const val MOBILE_CAPTURE_TEXT_CONTRACT = "verbatim-utf16-12000"

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

/**
 * A photo attached to a Capture draft. Only the app-private file name is kept
 * here; bytes are encoded at the command boundary so drafts stay small.
 */
data class MobileCapturePhoto(
    val fileName: String,
) {
    init {
        require(fileName.isNotBlank())
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
    val photos: List<MobileCapturePhoto> = emptyList(),
) {
    init {
        require(speech == null || source == MobileCaptureSource.AndroidSpeech)
        require((source == MobileCaptureSource.ShareTarget) == (share != null))
    }

    // Drafts retain all input, including over-limit text; limits apply only at the command boundary.
    fun withText(value: String): MobileCaptureDraft = copy(text = value)

    fun withPhoto(photo: MobileCapturePhoto): MobileCaptureDraft =
        if (photos.any { it.fileName == photo.fileName }) this else copy(photos = photos + photo)

    fun withoutPhoto(fileName: String): MobileCaptureDraft =
        copy(photos = photos.filterNot { it.fileName == fileName })

    fun withKind(value: MobileCaptureKind): MobileCaptureDraft = if (value == kind) this else copy(kind = value)

    fun withThemeId(value: String?): MobileCaptureDraft = copy(projectId = value?.trim()?.takeIf(String::isNotEmpty))

    fun withSpeechResult(
        result: ShortSpeechRecognitionResult,
        append: Boolean = false,
        capturedAt: String = Instant.now().toString(),
        timeZone: String = java.time.ZoneId.systemDefault().id,
    ): MobileCaptureDraft = copy(
        text = if (append && text.isNotBlank()) "$text ${result.text}" else result.text,
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
