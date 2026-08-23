package jp.personal.tasken.companion

import org.junit.Assert.assertEquals
import org.junit.Assert.assertThrows
import org.junit.Test

class MobileSyncContractTest {
    private val meta = """
        "meta": {
          "apiVersion": 1,
          "schemaVersion": 3,
          "serverId": "desktop-home",
          "serverRevision": 42,
          "generatedAt": "2026-08-22T01:00:00Z",
          "truncated": false
        }
    """.trimIndent()

    @Test
    fun decodesBootstrapAndPagedDeltaWithTombstone() {
        val bootstrap = MobileSyncContract.decodeBootstrap(
            """{
              "ok": true,
              $meta,
              "data": {
                "tasks": [{
                  "id": "task-1", "version": 1, "title": "同期Task", "themeId": null,
                  "state": "todo", "workState": null, "todayDate": "2026-08-22", "schedule": null,
                  "updatedAt": "2026-08-22T01:00:00Z"
                }],
                "nextCursor": "2026-08-22T01:00:00Z|task-1",
                "hasMore": false
              }
            }""",
        )
        assertEquals("2026-08-22", bootstrap.data.tasks.single().todayDate)

        val sync = MobileSyncContract.decodeSync(
            """{
              "ok": true,
              $meta,
              "data": {
                "changes": [
                  {"kind": "upsert", "task": {
                    "id": "task-1", "version": 2, "title": "同期Task更新", "themeId": null,
                    "state": "doing", "workState": null, "todayDate": "2026-08-22", "schedule": {
                      "id": "schedule-1", "version": 2, "startDate": null, "endDate": "2026-08-25",
                      "dateKind": "deadline", "rangeSemantics": null, "confidence": "fixed", "granularity": "day"
                    },
                    "updatedAt": "2026-08-22T02:00:00Z"
                  }},
                  {"kind": "tombstone", "entityType": "task", "id": "task-2", "version": 3,
                    "updatedAt": "2026-08-22T03:00:00Z"}
                ],
                "nextCursor": "2026-08-22T03:00:00Z|task-2",
                "hasMore": false
              }
            }""",
        )
        assertEquals(listOf("upsert", "tombstone"), sync.data.changes.map { it.kind })
        assertEquals("2026-08-25", sync.data.changes.first().task?.schedule?.endDate)
    }

    @Test
    fun rejectsAmbiguousChangesAndIncompleteBootstrap() {
        val ambiguous = """{
          "ok": true,
          $meta,
          "data": {
            "changes": [{"kind": "tombstone", "entityType": "task", "id": "task-2", "version": 3,
              "updatedAt": "2026-08-22T03:00:00Z", "task": {
                "id": "task-2", "version": 3, "title": "混在", "themeId": null,
                "state": "todo", "workState": null, "schedule": null,
                "updatedAt": "2026-08-22T03:00:00Z"
              }}],
            "nextCursor": "cursor",
            "hasMore": false
          }
        }"""
        assertThrows(MobileSyncContractException::class.java) { MobileSyncContract.decodeSync(ambiguous) }

        val incomplete = """{
          "ok": true,
          $meta,
          "data": {"tasks": [], "nextCursor": "cursor", "hasMore": true}
        }"""
        assertThrows(MobileSyncContractException::class.java) { MobileSyncContract.decodeBootstrap(incomplete) }
    }
}
