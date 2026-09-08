package jp.personal.tasken.companion

import java.time.LocalDate
import java.time.ZoneId
import kotlinx.coroutines.flow.Flow

internal const val LOCAL_SEARCH_PAGE_SIZE = 50
internal const val LOCAL_SEARCH_QUERY_LIMIT = 200

data class MobileLocalSearchRequest(
    val query: String = "",
    val themeId: String? = null,
    val fromDate: String = "",
    val toDate: String = "",
    val page: Int = 0,
    val timezone: String = ZoneId.systemDefault().id,
) {
    fun validationError(): String? = when {
        query.length > LOCAL_SEARCH_QUERY_LIMIT -> "検索語は200文字以内にしてください。"
        fromDate.isNotEmpty() && runCatching { LocalDate.parse(fromDate) }.isFailure -> "開始日はYYYY-MM-DDで入力してください。"
        toDate.isNotEmpty() && runCatching { LocalDate.parse(toDate) }.isFailure -> "終了日はYYYY-MM-DDで入力してください。"
        fromDate.isNotEmpty() && toDate.isNotEmpty() && fromDate > toDate -> "終了日は開始日以降にしてください。"
        else -> null
    }
}

enum class MobileLocalSearchKind(val label: String, val sourceType: String) {
    Task("Task", "task"), Capture("Capture", "capture_entry"), WorkLog("作業記録", "work_log"), Note("Note", "note"),
}

data class MobileLocalSearchHit(
    val kind: MobileLocalSearchKind,
    val sourceId: String,
    val title: String,
    val excerpt: String,
    val date: String,
    val dateMeaning: String,
    val themeIds: List<String?>,
    val themeFromRelatedTask: Boolean = false,
    val coverage: String,
    val relatedTaskId: String? = null,
) {
    val key get() = "${kind.sourceType}:$sourceId"
}

data class MobileLocalSearchCoverage(
    val tasks: Int = 0,
    val captures: Int = 0,
    val workLogs: Int = 0,
    val notes: Int = 0,
    val unfetchedNotes: Int = 0,
    val recallDays: Int = 0,
    val partialRecallDays: Int = 0,
) {
    val description get() = "端末保存: Task ${tasks}件・Capture ${captures}件・作業記録 ${workLogs}件・Note本文 ${notes}件"
    val missingDescription get() = "Note本文未取得 $unfetchedNotes 件。日別記録は取得済み $recallDays 日（部分取得 $partialRecallDays 日）。このほかのDesktopの記録や未取得本文は検索していません。"
}

data class MobileLocalSearchPage(
    val request: MobileLocalSearchRequest,
    val hits: List<MobileLocalSearchHit> = emptyList(),
    val total: Int = 0,
    val coverage: MobileLocalSearchCoverage = MobileLocalSearchCoverage(),
    val error: String? = null,
) {
    val hasNext get() = (request.page.toLong() + 1) * LOCAL_SEARCH_PAGE_SIZE < total
}

interface MobileLocalSearchRepository {
    fun observeLocalSearch(request: MobileLocalSearchRequest): Flow<MobileLocalSearchPage>
    suspend fun localSearchCapture(id: String): MobilePendingCapture?
}

internal fun localSearchTerms(query: String): List<String> = query.trim().split(Regex("\\s+")).filter { it.isNotEmpty() }.distinct()

/** Literal substrings: %, _, quotes and SQL-looking input have no operator meaning. */
internal fun matchesLocalSearch(text: String, terms: List<String>): Boolean = terms.all { text.contains(it, ignoreCase = true) }

internal fun localSearchExcerpt(text: String, terms: List<String>, limit: Int = 180): String {
    val flattened = text.replace(Regex("\\s+"), " ").trim()
    val match = terms.map { flattened.indexOf(it, ignoreCase = true) }.filter { it >= 0 }.minOrNull() ?: 0
    var start = (match - 35).coerceAtLeast(0)
    if (start > 0 && flattened[start].isLowSurrogate()) start--
    var end = (start + limit).coerceAtMost(flattened.length)
    if (end > start && end < flattened.length && flattened[end - 1].isHighSurrogate()) end--
    return (if (start > 0) "…" else "") + flattened.substring(start, end) + if (end < flattened.length) "…" else ""
}
