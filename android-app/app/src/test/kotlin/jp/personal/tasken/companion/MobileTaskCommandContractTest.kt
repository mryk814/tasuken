package jp.personal.tasken.companion

import org.junit.Assert.assertEquals
import org.junit.Assert.assertThrows
import org.junit.Test

class MobileTaskCommandContractTest {
    @Test
    fun receiptThemeIdUsesEntityIdTrimSemantics() {
        val response = MobileTaskCommandContract.decodeReceipt(receiptPayload(" theme-receipt "))

        assertEquals("theme-receipt", response.data.task.themeId)
    }

    @Test
    fun conflictThemeIdUsesEntityIdTrimSemantics() {
        val response = MobileTaskCommandContract.decodeError(conflictPayload(" theme-conflict "))

        assertEquals("theme-conflict", response.error.conflict?.currentTask?.themeId)
    }

    @Test
    fun receiptAndConflictRejectWhitespaceOnlyThemeIds() {
        assertThrows(IllegalArgumentException::class.java) {
            MobileTaskCommandContract.decodeReceipt(receiptPayload("   "))
        }
        assertThrows(IllegalArgumentException::class.java) {
            MobileTaskCommandContract.decodeError(conflictPayload("   "))
        }
    }

    private fun receiptPayload(themeId: String): String = """
        {
          "ok": true,
          "meta": {
            "apiVersion": 1,
            "schemaVersion": 1,
            "serverId": "server-1",
            "serverRevision": 8,
            "generatedAt": "2026-08-22T01:00:00Z",
            "truncated": false
          },
          "data": {
            "commandId": "command-1",
            "status": "applied",
            "task": {
              "id": "task-1",
              "version": 8,
              "title": "Task",
              "themeId": "$themeId",
              "state": "todo",
              "workState": null,
              "todayDate": null,
              "updatedAt": "2026-08-22T01:00:00Z"
            }
          }
        }
    """.trimIndent()

    private fun conflictPayload(themeId: String): String = """
        {
          "ok": false,
          "meta": {
            "apiVersion": 1,
            "schemaVersion": 1,
            "serverId": "server-1",
            "serverRevision": 8,
            "generatedAt": "2026-08-22T01:00:00Z",
            "truncated": false
          },
          "error": {
            "code": "version_conflict",
            "message": "Taskが更新されています。",
            "retryable": false,
            "conflict": {
              "currentTask": {
                "id": "task-1",
                "version": 8,
                "title": "Task",
                "themeId": "$themeId",
                "state": "todo",
                "workState": null,
                "todayDate": null,
                "updatedAt": "2026-08-22T01:00:00Z"
              },
              "intendedAction": "UpdateTask",
              "expectedVersion": 7
            }
          }
        }
    """.trimIndent()
}
