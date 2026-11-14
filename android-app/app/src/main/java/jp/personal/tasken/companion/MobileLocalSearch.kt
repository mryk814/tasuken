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

/**
 * 共通の辞書。build の時に写し（src/shared/searchdict/kotoba）の dict の各 tsv が Java の資源として入る
 * （app/build.gradle.kts の kotobaDictionaryResources）。初めて検索する時に一度だけ読む。
 */
internal object LocalSearchDictionary {
    private const val DIRECTORY = "kotoba"

    /** 読めなければ辞書なし（書いたままの語だけ）で検索する。読めることは KotobaTest が見張る。 */
    val shared: KotobaDictionary? by lazy { runCatching { load() }.getOrNull() }

    fun load(): KotobaDictionary {
        fun read(name: String): String = requireNotNull(LocalSearchDictionary::class.java.getResourceAsStream("$DIRECTORY/$name")) {
            "辞書の資源 $DIRECTORY/$name がありません"
        }.use { it.readBytes().toString(Charsets.UTF_8) }
        val names = read("files.txt").lines().filter { it.isNotBlank() }
        return KotobaDictionary.load(names.associateWith(::read))
    }
}

/**
 * 問いの一語を、ほかにどう書くか（その語自身は含めない）。語が辞書の書き方そのものなら丸ごと広げ（expand）、
 * 語が文（引越しの段取り）なら、文の中の書き方の所だけを書き換える（locate）。
 * Desktop の src/shared/searchdict/searchSpellings.ts の termSpellings と同じ。
 */
internal fun localSearchSpellings(term: String, dictionary: KotobaDictionary): List<String> {
    val whole = dictionary.expand(term)
    if (whole.isNotEmpty()) return whole
    val points = kotobaKey(term).codePoints().toArray()
    val seen = mutableSetOf(kotobaKey(term))
    val result = mutableListOf<String>()
    for (found in dictionary.locate(term)) {
        for (spelling in dictionary.expand(found.form)) {
            val variant = String(points, 0, found.at) + spelling +
                String(points, found.at + found.length, points.size - found.at - found.length)
            if (seen.add(kotobaKey(variant))) result += variant
        }
    }
    return result
}

/** 問いの語と、語ごとのほかの書き方（照合のキー）。 */
internal class LocalSearchQuery(val terms: List<String>, dictionary: KotobaDictionary?) {
    private val keys = terms.map { term ->
        (listOf(term) + dictionary?.let { localSearchSpellings(term, it) }.orEmpty()).map(::kotobaKey).distinct()
    }
    private val widened = keys.zip(terms).any { (forms, term) -> forms.size > 1 || forms[0] != term.lowercase() }

    /** 抜粋の位置を探す語（書いたままの語を先に、ほかの書き方を後に）。 */
    val excerptTerms: List<String> = terms + keys.flatMap { it.drop(1) }

    /**
     * 書いたままの語がどれも入っていれば [LocalSearchMatch.Direct]（全角と半角の違いは照合のキーで吸収する）、
     * ほかの書き方を含めてどれも入っていれば [LocalSearchMatch.Alias]、そうでなければ null。
     */
    fun match(text: String): LocalSearchMatch? {
        if (matchesLocalSearch(text, terms)) return LocalSearchMatch.Direct
        if (!widened) return null
        val key = kotobaKey(text)
        if (keys.all { forms -> key.contains(forms[0]) }) return LocalSearchMatch.Direct
        return if (keys.all { forms -> forms.any { key.contains(it) } }) LocalSearchMatch.Alias else null
    }
}

/** 並べる順でもある: 書いたままの語で当たった記録を、ほかの書き方でだけ当たった記録より先にする。 */
internal enum class LocalSearchMatch { Direct, Alias }

internal fun localSearchQuery(query: String, dictionary: KotobaDictionary? = LocalSearchDictionary.shared) =
    LocalSearchQuery(localSearchTerms(query), dictionary)

internal fun localSearchExcerpt(text: String, terms: List<String>, limit: Int = 180): String {
    val flattened = text.replace(Regex("\\s+"), " ").trim()
    val match = terms.map { flattened.indexOf(it, ignoreCase = true) }.filter { it >= 0 }.minOrNull() ?: 0
    var start = (match - 35).coerceAtLeast(0)
    if (start > 0 && flattened[start].isLowSurrogate()) start--
    var end = (start + limit).coerceAtMost(flattened.length)
    if (end > start && end < flattened.length && flattened[end - 1].isHighSurrogate()) end--
    return (if (start > 0) "…" else "") + flattened.substring(start, end) + if (end < flattened.length) "…" else ""
}
