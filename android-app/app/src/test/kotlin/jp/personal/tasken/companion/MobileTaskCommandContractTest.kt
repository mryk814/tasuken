package jp.personal.tasken.companion

import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonObject
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

    @Test
    fun validatesStrictSchedulePatchAndExpectedScheduleVersion() {
        val schedule = buildJsonObject {
            put("schedule", buildJsonObject {
                put("startDate", JsonPrimitive("2026-08-23"))
                put("endDate", JsonPrimitive("2026-08-25"))
                put("rangeSemantics", JsonPrimitive("once_within_window"))
            })
        }
        val noSchedule = buildJsonObject { put("schedule", JsonNull) }
        val initial = updateEnvelope(schedule, noSchedule, expectedScheduleVersion = null)
        assertEquals(
            "2026-08-25",
            MobileTaskCommandContract.decodeUpdateEnvelope(MobileTaskCommandContract.encode(initial))
                .command.changes.getValue("schedule").let { it as kotlinx.serialization.json.JsonObject }
                .getValue("endDate").let { it as JsonPrimitive }.content,
        )

        val existing = updateEnvelope(schedule, schedule, expectedScheduleVersion = 4)
        assertEquals(4, MobileTaskCommandContract.decodeUpdateEnvelope(MobileTaskCommandContract.encode(existing)).command.expectedScheduleVersion)

        assertThrows(IllegalArgumentException::class.java) {
            MobileTaskCommandContract.encode(initial.copy(command = initial.command.copy(expectedScheduleVersion = 1)))
        }
        val invalidRange = buildJsonObject {
            put("schedule", buildJsonObject {
                put("startDate", JsonPrimitive("2026-08-25"))
                put("endDate", JsonPrimitive("2026-08-23"))
                put("rangeSemantics", JsonNull)
            })
        }
        assertThrows(IllegalArgumentException::class.java) {
            MobileTaskCommandContract.encode(updateEnvelope(invalidRange, noSchedule, null))
        }
    }

    @Test
    fun rejectsWithdrawnPlannedSchedulePatch() {
        val planned = buildJsonObject {
            put("plannedSchedule", buildJsonObject {
                put("startTime", JsonPrimitive("10:00"))
                put("durationMinutes", JsonPrimitive(90))
            })
        }
        val empty = buildJsonObject {
            put("plannedSchedule", buildJsonObject {
                put("startTime", JsonNull)
                put("durationMinutes", JsonNull)
            })
        }
        assertThrows(IllegalStateException::class.java) {
            MobileTaskCommandContract.encode(updateEnvelope(planned, empty, null))
        }
    }

    @Test
    fun deleteTaskUsesVersionedStateEnvelopeAndConflictContract() {
        val envelope = MobileTaskStateEnvelopeDto(
            apiVersion = 1,
            schemaVersion = 2,
            requestId = "request-delete",
            commandId = "command-delete",
            idempotencyKey = "command-delete",
            clientDeviceId = "device-1",
            issuedAt = "2026-08-22T01:00:00Z",
            command = MobileTaskStateCommandDto(
                name = "DeleteTask",
                taskId = "task-1",
                expectedVersion = 7,
            ),
        )

        val decoded = MobileTaskCommandContract.decodeStateEnvelope(MobileTaskCommandContract.encode(envelope))
        assertEquals("DeleteTask", decoded.command.name)
        assertEquals(7, decoded.command.expectedVersion)
        assertEquals(
            "DeleteTask",
            MobileTaskCommandContract.decodeError(conflictPayload("theme-1", "DeleteTask"))
                .error.conflict?.intendedAction,
        )
    }

    private fun updateEnvelope(
        changes: kotlinx.serialization.json.JsonObject,
        base: kotlinx.serialization.json.JsonObject,
        expectedScheduleVersion: Int?,
    ) = MobileTaskUpdateEnvelopeDto(
        apiVersion = 1,
        schemaVersion = 2,
        requestId = "request-1",
        commandId = "command-1",
        idempotencyKey = "command-1",
        clientDeviceId = "device-1",
        issuedAt = "2026-08-22T01:00:00Z",
        command = MobileTaskUpdateCommandDto(
            name = "UpdateTask",
            taskId = "task-1",
            expectedVersion = 7,
            expectedScheduleVersion = expectedScheduleVersion,
            changes = changes,
            base = base,
        ),
    )

    private fun receiptPayload(themeId: String): String = """
        {
          "ok": true,
          "meta": {
            "apiVersion": 1,
            "schemaVersion": 2,
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
              "schedule": null,
              "updatedAt": "2026-08-22T01:00:00Z"
            }
          }
        }
    """.trimIndent()

    private fun conflictPayload(themeId: String, intendedAction: String = "UpdateTask"): String = """
        {
          "ok": false,
          "meta": {
            "apiVersion": 1,
            "schemaVersion": 2,
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
                "schedule": null,
                "updatedAt": "2026-08-22T01:00:00Z"
              },
              "intendedAction": "$intendedAction",
              "expectedVersion": 7
            }
          }
        }
    """.trimIndent()
}
