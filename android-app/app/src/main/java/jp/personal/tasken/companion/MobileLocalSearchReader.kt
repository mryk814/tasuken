package jp.personal.tasken.companion

import androidx.room.withTransaction
import androidx.sqlite.db.SimpleSQLiteQuery
import java.time.Instant
import java.time.OffsetDateTime
import java.time.ZoneId
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.flow.mapLatest
import kotlinx.coroutines.withContext
import kotlinx.serialization.json.Json

@OptIn(ExperimentalCoroutinesApi::class)
internal class MobileLocalSearchReader(
    private val database: MobileLocalDatabase,
    private val readAccess: Flow<Boolean>,
) : MobileLocalSearchRepository {
    private val dao = database.localSearchDao()
    private val local = database.mobileDao()
    private val json = Json { ignoreUnknownKeys = false }

    override fun observeLocalSearch(request: MobileLocalSearchRequest): Flow<MobileLocalSearchPage> =
        combine(dao.observeChanges(SimpleSQLiteQuery("SELECT 1")), readAccess) { _, allowed -> allowed }
            .mapLatest { allowed ->
                when {
                    !allowed -> MobileLocalSearchPage(request, error = "Desktopの閲覧権限を確認してください。保存済みの入力は消していません。")
                    request.validationError() != null -> MobileLocalSearchPage(request, error = request.validationError())
                    else -> withContext(Dispatchers.IO) { database.withTransaction { search(request) } }
                }
            }

    override suspend fun localSearchCapture(id: String): MobilePendingCapture? {
        if (!readAccess.first()) return null
        return database.withTransaction {
            val server = local.syncState()?.serverId ?: return@withTransaction null
            val record = dao.capture(server, id) ?: return@withTransaction null
            val pending = local.outbox(record.commandId)?.takeIf { it.serverId == server }
            val authority = authority(server, ZoneId.systemDefault().id)
            if (!authority.visible("capture_entry", record.id, day(record.capturedAt, ZoneId.systemDefault()), pending != null)) return@withTransaction null
            pending?.toPendingCapture() ?: MobilePendingCapture(record.commandId, record.body, record.capturedAt,
                "端末に保存した原文です。Desktop受理後も保持しています。", false)
        }
    }

    private data class Authority(
        val seen: Map<Pair<String, String>, String>,
        val days: Map<String, Pair<String, Set<Pair<String, String>>>>,
        val unavailable: Set<Pair<String, String>>,
        val fetchedDays: Int,
        val partialDays: Int,
    ) {
        fun visible(type: String, id: String, date: String, pending: Boolean): Boolean {
            if (pending) return true
            val key = type to id
            if (key in unavailable) return false
            val observed = seen[key] ?: return true
            val snapshot = days[date] ?: return true
            if (Instant.parse(snapshot.first).isBefore(Instant.parse(observed))) return true
            return key in snapshot.second
        }
    }

    private suspend fun authority(server: String, timezone: String): Authority {
        val days = mutableMapOf<String, Pair<String, Set<Pair<String, String>>>>()
        val latest = mutableMapOf<Pair<String, String>, Pair<String, Boolean>>()
        var fetched = 0
        var partial = 0
        batches({ limit, offset -> dao.recallDays(server, timezone, limit, offset) }) { row ->
            if (row.lastFetchedAt != null || row.lastPageFetchedAt != null) fetched++
            if (row.partial) partial++
            val at = row.lastFetchedAt ?: row.lastPageFetchedAt ?: return@batches
            val events = MobileRecallContract.json.decodeFromString<List<MobileRecallEvent>>(
                if (row.lastFetchedAt != null) row.eventsJson else row.stagedEventsJson ?: row.eventsJson)
            if (row.lastFetchedAt != null) days[row.date] = at to events.filter { it.mobile_source.status == "available" }
                .map { it.mobile_source.type to it.mobile_source.id }.toSet()
            events.forEach { event ->
                val key = event.mobile_source.type to event.mobile_source.id
                if (latest[key]?.first?.let { Instant.parse(it).isAfter(Instant.parse(at)) } != true)
                    latest[key] = at to (event.mobile_source.status == "available")
            }
        }
        return Authority(dao.seenSources(server).associate { (it.type to it.sourceId) to it.observedAt }, days,
            latest.filterValues { !it.second }.keys, fetched, partial)
    }

    private data class Candidate(val hit: MobileLocalSearchHit, val matched: Boolean, val version: Int, val pending: Boolean, val fetchedAt: String)

    private suspend fun search(request: MobileLocalSearchRequest): MobileLocalSearchPage {
        val server = local.syncState()?.serverId ?: return MobileLocalSearchPage(request, error = "Desktopへ一度接続すると端末に保存した記録を検索できます。")
        val zone = ZoneId.of(request.timezone)
        val terms = localSearchTerms(request.query)
        val authority = authority(server, request.timezone)
        val pending = dao.pendingCommandIds(server).toSet()
        val candidates = mutableMapOf<Pair<MobileLocalSearchKind, String>, Candidate>()
        val taskThemes = mutableMapOf<String, String?>()
        val captureDates = mutableMapOf<String, String>()

        fun add(hit: MobileLocalSearchHit, body: String, version: Int = 0, isPending: Boolean = false, fetchedAt: String = "") {
            val key = hit.kind to hit.sourceId
            val candidate = Candidate(hit, matchesLocalSearch(body, terms), version, isPending, fetchedAt)
            val previous = candidates[key]
            if (previous == null) candidates[key] = candidate
            else {
                val replace = when {
                    previous.pending != candidate.pending -> candidate.pending
                    previous.version != candidate.version -> candidate.version > previous.version
                    else -> candidate.fetchedAt > previous.fetchedAt
                }
                val winner = if (replace) candidate else previous
                val themes = if (winner.hit.themeFromRelatedTask) (previous.hit.themeIds + candidate.hit.themeIds).distinct() else winner.hit.themeIds
                candidates[key] = winner.copy(hit = winner.hit.copy(themeIds = themes))
            }
        }

        batches(dao::tasks) { row ->
            taskThemes[row.id] = row.themeId
            add(MobileLocalSearchHit(MobileLocalSearchKind.Task, row.id, row.title, "", day(row.updatedAt, zone), "更新日",
                listOf(row.themeId), coverage = if (row.optimisticCommandId != null) "端末の変更を含むTask名" else "取得済みTask名"), row.title,
                isPending = row.optimisticCommandId != null)
        }
        batches({ limit, offset -> dao.workLogs(server, limit, offset) }) { row ->
            val isPending = row.optimisticCommandId in pending
            if (authority.visible("work_log", row.id, row.performedDate, isPending)) {
                add(MobileLocalSearchHit(MobileLocalSearchKind.WorkLog, row.id, localSearchExcerpt(row.body, emptyList(), 80),
                    localSearchExcerpt(row.body, terms), row.performedDate, "実施日", listOf(row.themeId),
                    coverage = if (isPending) "未同期の本文" else "端末保存の本文"), row.body, row.serverVersion ?: 0, isPending)
            }
        }
        batches({ limit, offset -> dao.captures(server, limit, offset) }) { row ->
            val date = day(row.capturedAt, zone)
            val isPending = row.commandId in pending
            if (authority.visible("capture_entry", row.id, date, isPending)) {
                captureDates[row.id] = date
                add(MobileLocalSearchHit(MobileLocalSearchKind.Capture, row.id, localSearchExcerpt(row.body, emptyList(), 80),
                    localSearchExcerpt(row.body, terms), date, "入力日", emptyList(), coverage = if (isPending) "未同期の原文" else "端末保存の原文"),
                    row.body, isPending = isPending)
            }
        }

        val links = mutableMapOf<Triple<String, String, String>, RelatedSummary>()
        val missing = mutableMapOf<Pair<String, String>, String>()
        batches({ limit, offset -> dao.relatedLists(server, limit, offset) }) { row ->
            val state = json.decodeFromString<RelatedDocumentsState>(row.payload)
            state.documents.forEach { summary ->
                links[Triple(row.taskId, summary.type, summary.id)] = summary
                if (summary.status == "not_found" && state.fetchedAt != null) {
                    val key = summary.type to summary.id
                    if (missing[key].orEmpty() < state.fetchedAt) missing[key] = state.fetchedAt
                }
            }
        }
        batches({ limit, offset -> dao.relatedBodies(server, limit, offset) }) { row ->
            val link = links[Triple(row.taskId, row.type, row.documentId)] ?: return@batches
            if (link.status != "available") return@batches
            val body = json.decodeFromString<CachedRelatedBody>(row.payload)
            if (missing[row.type to row.documentId]?.let { it >= body.fetchedAt } == true) return@batches
            if ((row.type to row.documentId) in authority.unavailable) return@batches
            val kind = when (row.type) { "note" -> MobileLocalSearchKind.Note; "capture_entry" -> MobileLocalSearchKind.Capture; else -> return@batches }
            val inputDate = captureDates[row.documentId].takeIf { kind == MobileLocalSearchKind.Capture }
            val scope = when {
                body.document.truncated -> "取得済み本文の先頭${body.document.body.length}文字（全${body.document.totalCharacters}文字）"
                body.document.version != link.version -> "取得済みの保存版・本文に更新あり"
                else -> "取得済み本文"
            }
            add(MobileLocalSearchHit(kind, row.documentId, body.document.title, localSearchExcerpt(body.document.body, terms),
                inputDate ?: day(body.fetchedAt, zone), if (inputDate == null) "本文取得日" else "入力日",
                if (taskThemes.containsKey(row.taskId)) listOf(taskThemes[row.taskId]) else emptyList(), true, scope, row.taskId),
                body.document.body, body.document.version, fetchedAt = body.fetchedAt)
        }
        val all = candidates.values.toList()
        val hits = all.filter { candidate ->
            val hit = candidate.hit
            candidate.matched && (request.themeId == null || hit.themeIds.any { (it ?: "") == request.themeId }) &&
                (request.fromDate.isEmpty() || hit.date >= request.fromDate) &&
                (request.toDate.isEmpty() || hit.date.isNotEmpty() && hit.date <= request.toDate)
        }.map { it.hit }.sortedWith(compareByDescending<MobileLocalSearchHit> { it.date }.thenBy { it.kind.ordinal }.thenBy { it.sourceId })
        val noteIds = all.filter { it.hit.kind == MobileLocalSearchKind.Note }.map { it.hit.sourceId }.toSet()
        val unfetched = links.values.filter { it.type == "note" && it.status == "available" && it.id !in noteIds }
            .map { it.id }.distinct().size
        val counts = all.groupingBy { it.hit.kind }.eachCount()
        return MobileLocalSearchPage(request, hits.drop((request.page.coerceAtLeast(0).toLong() * LOCAL_SEARCH_PAGE_SIZE).coerceAtMost(hits.size.toLong()).toInt()).take(LOCAL_SEARCH_PAGE_SIZE),
            hits.size, MobileLocalSearchCoverage(counts[MobileLocalSearchKind.Task] ?: 0, counts[MobileLocalSearchKind.Capture] ?: 0,
                counts[MobileLocalSearchKind.WorkLog] ?: 0, counts[MobileLocalSearchKind.Note] ?: 0, unfetched, authority.fetchedDays, authority.partialDays))
    }

    private suspend fun <T> batches(load: suspend (Int, Int) -> List<T>, visit: (T) -> Unit) {
        var offset = 0
        while (true) {
            val rows = load(64, offset)
            rows.forEach(visit)
            if (rows.size < 64) return
            offset += rows.size
        }
    }

    private fun day(value: String, timezone: ZoneId): String = runCatching { OffsetDateTime.parse(value).atZoneSameInstant(timezone).toLocalDate().toString() }.getOrDefault("")
}
