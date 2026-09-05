package jp.personal.tasken.companion

import java.time.LocalDate
import java.util.UUID
import kotlinx.serialization.Serializable

@Serializable
data class MobileCaptureOrganization(
    val title: String,
    val themeId: String? = null,
    val startDate: String? = null,
    val endDate: String? = null,
    val rangeSemantics: String? = null,
    val checklist: List<String> = emptyList(),
    val supplement: String = "",
    val warnings: List<String> = emptyList(),
)

internal fun MobileCaptureOrganization.validate() {
    require(title.isNotBlank() && title.length <= 500)
    require(themeId == null || themeId.isNotBlank())
    require(checklist.size <= 20 && checklist.all { it.isNotBlank() && it.length <= 200 })
    require(supplement.length <= 12000)
    require(warnings.size <= 10 && warnings.all { it.length <= 500 })
    val start = startDate?.let(LocalDate::parse)
    val end = endDate?.let(LocalDate::parse)
    require(start == null || end == null || !end.isBefore(start))
    require(rangeSemantics == null || rangeSemantics in setOf("once_within_window", "ongoing"))
    require(rangeSemantics == null || (start != null && end != null && end.isAfter(start)))
}

internal fun MobileCaptureDraft.organizationDescription(): String? = organization?.let { organized ->
    val original = requireNotNull(originalText)
    buildString {
        if (organized.supplement.isNotBlank()) append("# 補足\n${organized.supplement}\n\n")
        append("# 元の入力\n$original")
    }.also { require(it.length <= 50000) }
}

internal fun MobileCaptureDraft.organizationChecklistItems(): List<MobileChecklistItem>? = organization?.let { organized ->
    organized.checklist.mapIndexed { index, title ->
        MobileChecklistItem(
            id = UUID.nameUUIDFromBytes("tasken:$draftId:checklist:$index".toByteArray(Charsets.UTF_8)).toString(),
            title = title,
            done = false,
            sortOrder = index.toDouble(),
        )
    }
}

internal fun MobileCaptureDraft.organizationSchedule(): MobileCreateTaskScheduleDto? = organization?.let {
    if (it.startDate == null && it.endDate == null) null
    else MobileCreateTaskScheduleDto(it.startDate, it.endDate, it.rangeSemantics)
}
