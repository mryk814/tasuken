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
    // アプリ内の音声入力は #808 で外した（音声入力は別のアプリ yamabiko が受け持つ）。新しいコードはこの値を作らないが、
    // 更新前に音声で作った下書きと未送信の命令が、元の出どころのまま読めて Desktop/NAS へ届くように残す。
    AndroidSpeech("android_speech"),
    ;

    companion object {
        fun fromWireValue(value: String?): MobileCaptureSource =
            entries.firstOrNull { it.wireValue == value } ?: AndroidApp
    }
}

// 音声の出どころ（認識の方式・言語など）。#808 で音声入力を外した後も、更新前に音声で作った下書きと
// 未送信の命令を読み込み、元の出どころ（captureMethod = "android_speech"）のまま送り届けるために残す。
// 新しいコードはこれを作らない。
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
    // 更新前に音声で作った下書きだけが持つ。#808 の後は読み込んで送るだけで、新しく付けない。
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
