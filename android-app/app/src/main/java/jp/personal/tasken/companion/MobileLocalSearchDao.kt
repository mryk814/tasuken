package jp.personal.tasken.companion

import androidx.room.Dao
import androidx.room.Query
import androidx.room.RawQuery
import androidx.sqlite.db.SupportSQLiteQuery
import kotlinx.coroutines.flow.Flow

/** Read existing caches in small batches; there is no second body or search index to invalidate. */
@Dao
abstract class MobileLocalSearchDao {
    @RawQuery(observedEntities = [TaskCacheEntity::class, WorkLogCacheEntity::class, RecallCaptureCacheEntity::class,
        RecallDayCacheEntity::class, RecallSeenSourceEntity::class, RelatedDocumentCacheEntity::class,
        RelatedBodyCacheEntity::class, OutboxCommandEntity::class, SyncStateEntity::class, ThemeCacheEntity::class])
    abstract fun observeChanges(query: SupportSQLiteQuery): Flow<Int>

    @Query("SELECT id, title, themeId, updatedAt, optimisticCommandId FROM task_cache ORDER BY id LIMIT :limit OFFSET :offset")
    abstract suspend fun tasks(limit: Int, offset: Int): List<LocalSearchTask>

    @Query("SELECT * FROM work_log_cache WHERE serverId = :serverId AND deleted = 0 ORDER BY id LIMIT :limit OFFSET :offset")
    abstract suspend fun workLogs(serverId: String, limit: Int, offset: Int): List<WorkLogCacheEntity>

    @Query("SELECT * FROM recall_capture_cache WHERE serverId = :serverId ORDER BY id LIMIT :limit OFFSET :offset")
    abstract suspend fun captures(serverId: String, limit: Int, offset: Int): List<RecallCaptureCacheEntity>

    @Query("SELECT * FROM recall_capture_cache WHERE serverId = :serverId AND id = :id")
    abstract suspend fun capture(serverId: String, id: String): RecallCaptureCacheEntity?

    @Query("SELECT * FROM related_body_cache WHERE serverId = :serverId ORDER BY type, documentId, taskId LIMIT :limit OFFSET :offset")
    abstract suspend fun relatedBodies(serverId: String, limit: Int, offset: Int): List<RelatedBodyCacheEntity>

    @Query("SELECT * FROM related_document_cache WHERE serverId = :serverId ORDER BY taskId LIMIT :limit OFFSET :offset")
    abstract suspend fun relatedLists(serverId: String, limit: Int, offset: Int): List<RelatedDocumentCacheEntity>

    @Query("SELECT * FROM recall_day_cache WHERE serverId = :serverId AND timezone = :timezone ORDER BY date LIMIT :limit OFFSET :offset")
    abstract suspend fun recallDays(serverId: String, timezone: String, limit: Int, offset: Int): List<RecallDayCacheEntity>

    @Query("SELECT * FROM recall_seen_source WHERE serverId = :serverId")
    abstract suspend fun seenSources(serverId: String): List<RecallSeenSourceEntity>

    @Query("SELECT commandId FROM outbox_command WHERE serverId = :serverId")
    abstract suspend fun pendingCommandIds(serverId: String): List<String>
}

data class LocalSearchTask(val id: String, val title: String, val themeId: String?, val updatedAt: String, val optimisticCommandId: String?)
