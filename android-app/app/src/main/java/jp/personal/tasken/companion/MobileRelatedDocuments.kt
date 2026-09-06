package jp.personal.tasken.companion

import androidx.room.Entity
import kotlinx.coroutines.flow.Flow
import kotlinx.serialization.Serializable
import kotlinx.serialization.Transient

@Serializable data class RelatedReason(val predicate: String, val direction: String)
@Serializable data class RelatedSummary(val type: String, val id: String, val title: String, val version: Int?, val status: String, val reasons: List<RelatedReason>)
@Serializable data class RelatedListData(val taskId: String, val status: String, val documents: List<RelatedSummary>, val nextCursor: String?)
@Serializable data class RelatedListResponse(val ok: Boolean, val meta: MobileResponseMetaDto, val data: RelatedListData)
@Serializable data class RelatedBody(val title: String, val version: Int, val body: String, val totalCharacters: Int, val truncated: Boolean)
@Serializable data class RelatedBodyData(val taskId: String, val type: String, val id: String, val status: String, val document: RelatedBody?)
@Serializable data class RelatedBodyResponse(val ok: Boolean, val meta: MobileResponseMetaDto, val data: RelatedBodyData)
@Serializable data class CachedRelatedBody(val type: String, val id: String, val document: RelatedBody, val fetchedAt: String)
@Serializable data class RelatedDocumentsState(
    val documents: List<RelatedSummary> = emptyList(), @Transient val bodies: List<CachedRelatedBody> = emptyList(),
    val fetchedAt: String? = null, val nextCursor: String? = null, val error: String? = null,
)
@Entity(tableName = "related_document_cache", primaryKeys = ["serverId", "taskId"])
data class RelatedDocumentCacheEntity(val serverId: String, val taskId: String, val payload: String)
/** Keep each bounded body in its own row so several long documents cannot exceed CursorWindow. */
@Entity(tableName = "related_body_cache", primaryKeys = ["serverId", "taskId", "type", "documentId"])
data class RelatedBodyCacheEntity(val serverId: String, val taskId: String, val type: String, val documentId: String, val payload: String)

interface MobileRelatedDocumentsRepository {
    fun observeRelatedDocuments(taskId: String): Flow<RelatedDocumentsState>
    suspend fun refreshRelatedDocuments(taskId: String, nextPage: Boolean = false)
    suspend fun loadRelatedDocument(taskId: String, type: String, id: String)
}
