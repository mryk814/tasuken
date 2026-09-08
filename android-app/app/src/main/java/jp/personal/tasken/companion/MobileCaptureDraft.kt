package jp.personal.tasken.companion

import java.time.Instant
import java.util.UUID

// Kotlin and the TypeScript wire contract count UTF-16 code units (String.length).
internal const val MOBILE_CAPTURE_TEXT_MAX_LENGTH = 12000
internal const val MOBILE_TASK_TITLE_MAX_LENGTH = 500
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
    val additionalOrganizations: List<MobileCaptureOrganization> = emptyList(),
    val originalText: String? = null,
    val originalThemeId: String? = null,
) {
    init {
        require(speech == null || source == MobileCaptureSource.AndroidSpeech)
        require((source == MobileCaptureSource.ShareTarget) == (share != null))
        require(additionalOrganizations.size <= 7)
    }

    // Drafts retain all input, including over-limit text; limits apply only at the command boundary.
    fun withText(value: String): MobileCaptureDraft = copy(text = value, organization = organization?.copy(title = value))

    fun withKind(value: MobileCaptureKind): MobileCaptureDraft =
        if (value == kind) this else withoutOrganization().copy(kind = value)

    fun withoutOrganization(): MobileCaptureDraft = copy(
        text = originalText ?: text,
        projectId = if (organization != null) originalThemeId else projectId,
        organization = null, additionalOrganizations = emptyList(), originalText = null, originalThemeId = null,
    )

    fun withThemeId(value: String?): MobileCaptureDraft = copy(
        projectId = value?.trim()?.takeIf(String::isNotEmpty),
        organization = organization?.copy(themeId = value?.trim()?.takeIf(String::isNotEmpty)),
    )

    fun withOrganization(value: MobileCaptureOrganization): MobileCaptureDraft {
        return withOrganizations(listOf(value))
    }

    fun withOrganizations(values: List<MobileCaptureOrganization>): MobileCaptureDraft {
        require(values.isNotEmpty() && values.size <= 8)
        values.forEach(MobileCaptureOrganization::validate)
        return withEditedOrganizations(values)
    }

    // Editing may temporarily leave a title/date incomplete; validate at inference and save boundaries.
    fun withEditedOrganizations(values: List<MobileCaptureOrganization>): MobileCaptureDraft {
        require(values.isNotEmpty() && values.size <= 8)
        val value = values.first()
        val original = originalText ?: text
        require(original.isNotBlank() && original.length <= 12000)
        return copy(text = value.title, projectId = value.themeId, kind = MobileCaptureKind.Task,
            organization = value, additionalOrganizations = values.drop(1), originalText = original,
            originalThemeId = if (organization == null) projectId else originalThemeId)
    }

    fun allOrganizations(): List<MobileCaptureOrganization> =
        listOfNotNull(organization) + additionalOrganizations

    fun organizedTaskDrafts(): List<MobileCaptureDraft> {
        val proposals = allOrganizations()
        if (proposals.isEmpty()) return listOf(this)
        return proposals.mapIndexedNotNull { index, proposal ->
            if (proposal.excluded) return@mapIndexedNotNull null
            copy(
                draftId = if (index == 0) draftId else "$draftId:task:$index",
                text = proposal.title,
                projectId = proposal.themeId,
                kind = MobileCaptureKind.Task,
                organization = proposal,
                additionalOrganizations = emptyList(),
            )
        }
    }

    fun withSpeechResult(
        result: ShortSpeechRecognitionResult,
        append: Boolean = false,
        capturedAt: String = Instant.now().toString(),
        timeZone: String = java.time.ZoneId.systemDefault().id,
    ): MobileCaptureDraft = copy(
        text = if (append && (originalText ?: text).isNotBlank()) "${originalText ?: text} ${result.text}" else result.text,
        organization = null,
        additionalOrganizations = emptyList(),
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
