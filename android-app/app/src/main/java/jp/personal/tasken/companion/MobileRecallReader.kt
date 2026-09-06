package jp.personal.tasken.companion

import java.net.URLEncoder
import java.time.Instant
import java.time.LocalDate
import java.time.ZoneId
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock

internal class MobileRecallReader(
    private val dao: MobileLocalDao,
    private val request: suspend (String) -> GatewayHttpResponse,
) {
    private val refreshLock = Mutex()

    fun observe(date: LocalDate, timezone: ZoneId): Flow<MobileRecallDay> = combine(
        dao.observeRecallDays(date.toString(), timezone.id), dao.observeSyncState(),
        dao.observeWorkLogs(), combine(dao.observeRecallCaptures(), dao.observeRecallSeenSources()) { captures, seen -> captures to seen }, dao.observePendingCaptures(),
    ) { days, state, workLogs, localCaptures, commands ->
        val (captures, allSeen) = localCaptures
        val day = days.firstOrNull { it.serverId == state?.serverId }
        // Separate Room flows may emit in either order after one transaction. A newer acknowledgement
        // cannot hide an overlay until this day's published snapshot is at least as recent.
        val seen = allSeen.filter { it.serverId == state?.serverId && day?.lastFetchedAt != null &&
            !Instant.parse(it.observedAt).isAfter(Instant.parse(day.lastFetchedAt)) }.map { it.type to it.sourceId }.toSet()
        val events = day?.let { MobileRecallContract.json.decodeFromString<List<MobileRecallEvent>>(
            if (it.lastFetchedAt == null) it.stagedEventsJson ?: it.eventsJson else it.eventsJson) }.orEmpty()
        val serverSources = events.map { it.mobile_source.type to it.mobile_source.id }.toSet()
        val rows = events.map { event ->
            val capture = captures.firstOrNull { it.serverId == state?.serverId && it.id == event.mobile_source.id && event.mobile_source.type == "capture_entry" }
            MobileRecallRow(event.id, event.mobile_source, event.entity_title,
                event.summary.takeUnless { it == "${event.event_kind}: ${event.entity_title}" }.orEmpty(),
                MobileRecallContract.stageLabel(event.recall.stage, event.event_kind), event.local_date, event.local_time,
                capture = capture?.asDetail(commands))
        }.toMutableList()
        workLogs.filter { it.record.serverId == state?.serverId && !it.record.deleted && it.record.performedDate == date.toString() &&
            ("work_log" to it.record.id) !in serverSources && (it.command != null || ("work_log" to it.record.id) !in seen) }.forEach {
            rows += MobileRecallRow("local-work-log:${it.record.id}", MobileRecallSource("work_log", it.record.id, "available"),
                it.record.body.take(120), it.record.body.take(2000), "作業記録", it.record.performedDate, "", MobileWorkLog(it.record, it.command).status)
        }
        captures.filter { it.serverId == state?.serverId && MobileRecallContract.captureDate(it.capturedAt, timezone) == date.toString() &&
            ("capture_entry" to it.id) !in serverSources && (("capture_entry" to it.id) !in seen || commands.any { command -> command.serverId == it.serverId && command.commandId == it.commandId }) }.forEach {
            val detail = it.asDetail(commands)
            rows += MobileRecallRow("local-capture:${it.id}", MobileRecallSource("capture_entry", it.id, "available"),
                it.body.take(120), it.body.take(2000), "未整理Capture", date.toString(), "", detail.status, detail)
        }
        MobileRecallDay(date.toString(), timezone.id, rows, day?.lastFetchedAt ?: day?.lastPageFetchedAt, day?.partial ?: false,
            day?.nextCursor != null, day?.error, day?.partial == true && day.lastFetchedAt != null)
    }

    private fun RecallCaptureCacheEntity.asDetail(commands: List<OutboxCommandEntity>): MobilePendingCapture =
        commands.firstOrNull { it.serverId == serverId && it.commandId == commandId }?.toPendingCapture()
            ?: MobilePendingCapture(commandId, body, capturedAt, "端末に保存した原文です。Desktop受理後も保持しています。", false)

    suspend fun refresh(date: LocalDate, timezone: ZoneId, nextPage: Boolean) = refreshLock.withLock {
        val serverId = requireNotNull(dao.syncState()?.serverId) { "Desktopへ一度接続してから記録を取得してください。" }
        val previous = dao.recallDay(serverId, date.toString(), timezone.id)
        val cursor = if (nextPage) previous?.nextCursor ?: return@withLock else null
        try {
            val path = "/v1/activity?apiVersion=$TASKEN_MOBILE_API_VERSION&schemaVersion=$TASKEN_MOBILE_SCHEMA_VERSION" +
                "&requestId=recall-${java.util.UUID.randomUUID()}&date=$date&timezone=${encode(timezone.id)}&limit=500" +
                (cursor?.let { "&cursor=${encode(it)}" } ?: "")
            val http = request(path)
            check(http.status == 200) {
                when (http.status) {
                    404, 409, 422 -> "このDesktopでは記録を取得できません。Desktopを更新してください。端末の記録を表示しています。"
                    401, 403 -> "記録を読む接続権限を確認してください。端末の記録を表示しています。"
                    else -> "Desktopに接続できません。端末にある範囲を表示しています。"
                }
            }
            val data = MobileRecallContract.decode(http.body, serverId, date, timezone).data
            check(data.page.status == "ok") { "Desktopの記録が変わりました。「再取得」で先頭から確認してください。端末の記録は保持しています。" }
            if (cursor != null) require(data.page.revision == previous?.revision && data.page.offset ==
                MobileRecallContract.json.decodeFromString<List<MobileRecallEvent>>(requireNotNull(previous?.stagedEventsJson)).size)
            else require(data.page.offset == 0)
            val events = if (cursor == null) data.events else
                (MobileRecallContract.json.decodeFromString<List<MobileRecallEvent>>(requireNotNull(previous?.stagedEventsJson)) + data.events).distinctBy { it.id }
            require(data.page.next_cursor == null || data.page.next_cursor != cursor)
            val now = Instant.now().toString()
            val encoded = MobileRecallContract.json.encodeToString(events)
            dao.saveRecallDay(RecallDayCacheEntity(serverId, date.toString(), timezone.id,
                if (data.truncated) previous?.eventsJson ?: "[]" else encoded,
                if (data.truncated) previous?.lastFetchedAt else now, data.page.next_cursor,
                data.page.revision, null, data.truncated, if (data.truncated) encoded else null, now), cursor)
        } catch (cancel: CancellationException) { throw cancel }
        catch (failure: Exception) {
            if (dao.syncState()?.serverId != serverId) return@withLock
            val message = (failure as? IllegalStateException)?.message
                ?: "記録を取得できません。端末にある範囲を表示しています。"
            dao.saveRecallDay((previous ?: RecallDayCacheEntity(serverId, date.toString(), timezone.id, "[]", null, null, null, null, false))
                .copy(error = message), null)
        }
    }

    private fun encode(value: String) = URLEncoder.encode(value, Charsets.UTF_8.name())
}
