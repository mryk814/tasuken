package jp.personal.tasken.companion

import java.net.URLEncoder
import java.time.Instant
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.serialization.json.Json

internal class MobileRelatedDocumentsReader(private val dao: MobileLocalDao, private val request: suspend (String) -> GatewayHttpResponse) {
    private val json = Json { ignoreUnknownKeys = false }
    private val lock = Mutex()
    fun observe(taskId: String) = combine(dao.observeRelatedDocuments(taskId), dao.observeRelatedBodies(taskId), dao.observeSyncState()) { rows, bodies, sync ->
        val state = rows.firstOrNull { it.serverId == sync?.serverId }?.let { json.decodeFromString<RelatedDocumentsState>(it.payload) } ?: RelatedDocumentsState()
        state.copy(bodies = bodies.filter { it.serverId == sync?.serverId }.map { json.decodeFromString<CachedRelatedBody>(it.payload) }
            .filter { body -> state.documents.any { it.type == body.type && it.id == body.id && it.status == "available" } })
    }
    private fun encode(value: String) = URLEncoder.encode(value, Charsets.UTF_8.name())
    private fun base(taskId: String) = "apiVersion=$TASKEN_MOBILE_API_VERSION&schemaVersion=$TASKEN_MOBILE_SCHEMA_VERSION&taskId=${encode(taskId)}"
    private fun validateMeta(meta: MobileResponseMetaDto, serverId: String) {
        require(meta.apiVersion == TASKEN_MOBILE_API_VERSION && meta.schemaVersion == TASKEN_MOBILE_SCHEMA_VERSION && meta.serverId == serverId && meta.serverRevision >= 0)
        Instant.parse(meta.generatedAt)
    }
    private suspend fun update(taskId: String, operation: suspend (String, RelatedDocumentsState) -> RelatedReadUpdate) = lock.withLock {
        val serverId = dao.syncState()?.serverId ?: return@withLock
        val generation = dao.ownerReadGeneration(serverId)
        val previous = (dao.relatedDocuments(serverId, taskId)?.let { json.decodeFromString<RelatedDocumentsState>(it.payload) } ?: RelatedDocumentsState())
            .copy(bodies = dao.relatedBodies(serverId, taskId).map { json.decodeFromString<CachedRelatedBody>(it.payload) })
        var accessRevoked = false
        val next = try { operation(serverId, previous) }
        catch (_: RelatedAccessRevoked) {
            accessRevoked = true
            RelatedReadUpdate(RelatedDocumentsState(error = "接続権限が失効しました。端末の関連資料を削除しました。"))
        }
        catch (cancel: CancellationException) { throw cancel }
        catch (failure: Exception) { RelatedReadUpdate(previous.copy(error = (failure as? IllegalStateException)?.message ?: "取得できません。端末に保存した内容を表示しています。")) }
        dao.saveRelatedDocuments(RelatedDocumentCacheEntity(serverId, taskId, json.encodeToString(next.state)),
            next.state.bodies.map { RelatedBodyCacheEntity(serverId, taskId, it.type, it.id, json.encodeToString(it)) },
            if (accessRevoked) dao.ownerReadGeneration(serverId) else generation, next.missingSources)
    }
    private suspend fun fetch(serverId: String, path: String): GatewayHttpResponse {
        val response = request(path)
        if (response.status == 401 || response.status == 403) {
            val error = runCatching { MobileTaskCommandContract.decodeError(response.body) }.getOrNull()
            if (error?.meta?.serverId == serverId && error.error.code == if (response.status == 401) "unauthorized" else "forbidden") {
                dao.revokeOwnerReadCaches(serverId)
                throw RelatedAccessRevoked()
            }
        }
        check(response.status == 200) { if (response.status == 404 || response.status == 409 || response.status == 422) "このDesktopでは関連資料を取得できません。Desktopを更新してください。" else "Desktopへ接続できません。端末に保存した内容を表示しています。" }
        return response
    }
    suspend fun refresh(taskId: String, nextPage: Boolean) = update(taskId) { serverId, previous ->
        val cursor = if (nextPage) previous.nextCursor ?: return@update RelatedReadUpdate(previous) else null
        val response = json.decodeFromString<RelatedListResponse>(fetch(serverId, "/v1/task-related-documents?${base(taskId)}&limit=50" + (cursor?.let { "&cursor=${encode(it)}" } ?: "")).body)
        require(response.ok && response.meta.serverId == serverId && response.data.taskId == taskId)
        validateMeta(response.meta, serverId)
        val data = response.data
        require(data.status in listOf("available", "not_found", "cursor_stale") && data.documents.size <= 50)
        check(data.status != "cursor_stale") { "関連が変わりました。先頭から再取得してください。" }
        require(data.nextCursor == null || data.nextCursor != cursor)
        require(data.status == "available" || data.documents.isEmpty() && data.nextCursor == null)
        require(data.documents.map { it.type to it.id }.distinct().size == data.documents.size)
        data.documents.forEach {
            require(it.type in listOf("note", "capture_entry") && it.status in listOf("available", "not_found") && it.reasons.size in 1..3 && it.title.length <= 500)
            require(it.id.isNotBlank() && it.id.length <= 200 && it.id == it.id.trim())
            require(if (it.status == "available") it.version != null && it.version > 0 else it.version == null)
            require(it.reasons.all { reason -> reason.predicate.length <= 200 && reason.direction in listOf("from_task", "to_task") })
        }
        val documents = if (cursor == null) data.documents else (previous.documents + data.documents).distinctBy { it.type to it.id }
        RelatedReadUpdate(previous.copy(documents = documents, bodies = previous.bodies.filter { body ->
            val summary = documents.firstOrNull { it.type == body.type && it.id == body.id }
            summary?.status == "available" || summary == null && data.nextCursor != null
        },
            fetchedAt = Instant.now().toString(), nextCursor = data.nextCursor, error = null),
            data.documents.filter { it.status == "not_found" }.map { it.type to it.id }.toSet())
    }
    suspend fun load(taskId: String, type: String, id: String) = update(taskId) { serverId, previous ->
        require(previous.documents.any { it.type == type && it.id == id && it.status == "available" })
        val response = json.decodeFromString<RelatedBodyResponse>(fetch(serverId, "/v1/task-related-document?${base(taskId)}&type=${encode(type)}&id=${encode(id)}").body)
        require(response.ok && response.meta.serverId == serverId && response.data.taskId == taskId && response.data.type == type && response.data.id == id)
        validateMeta(response.meta, serverId)
        val data = response.data
        require(data.status in listOf("available", "not_found", "not_related"))
        require(data.status == "available" || data.document == null)
        val retained = previous.bodies.filterNot { it.type == type && it.id == id }
        if (data.status != "available") RelatedReadUpdate(previous.copy(bodies = retained, documents = previous.documents.filterNot { it.type == type && it.id == id }, error = "参照先の削除または関連の解除を受信しました。"),
            if (data.status == "not_found") setOf(type to id) else emptySet())
        else {
            val body = requireNotNull(data.document)
            require(body.body.length <= 50000 && body.version > 0 && body.totalCharacters >= body.body.length && body.truncated == (body.totalCharacters > body.body.length))
            RelatedReadUpdate(previous.copy(bodies = retained + CachedRelatedBody(type, id, body, Instant.now().toString()), error = null))
        }
    }
}
private class RelatedAccessRevoked : Exception()
private data class RelatedReadUpdate(val state: RelatedDocumentsState, val missingSources: Set<Pair<String, String>> = emptySet())
