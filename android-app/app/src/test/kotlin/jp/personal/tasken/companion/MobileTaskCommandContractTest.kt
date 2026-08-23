package jp.personal.tasken.companion

import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonArray
import kotlinx.serialization.json.buildJsonObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertThrows
import org.junit.Test

class MobileTaskCommandContractTest {
    @Test
    fun createTaskRoundTripsStrictSpeechProvenance() {
        val provenance = MobileTaskCreationProvenanceDto(
            reportedVia = "android_speech",
            capturedAt = "2026-08-23T00:00:00Z",
            captureMethod = "android_speech",
            recognitionMode = "on_device",
            language = "ja-JP",
            confidence = 0.82f,
            sourceAudioAvailable = false,
        )

        val decoded = MobileTaskCommandContract.decodeCreateEnvelope(
            MobileTaskCommandContract.encode(createEnvelope(provenance)),
        )

        assertEquals(provenance, decoded.command.provenance)
        assertThrows(IllegalArgumentException::class.java) {
            MobileTaskCommandContract.encode(
                createEnvelope(provenance.copy(reportedVia = "widget")),
            )
        }
        assertThrows(IllegalArgumentException::class.java) {
            MobileTaskCommandContract.encode(
                createEnvelope(
                    MobileTaskCreationProvenanceDto(
                        reportedVia = "share_target",
                        capturedAt = "2026-08-23T00:00:00Z",
                    ),
                ),
            )
        }
    }

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
    fun scheduleConflictAcceptsSameTaskVersionWhenScheduleAdvanced() {
        val response = MobileTaskCommandContract.decodeError(scheduleConflictPayload())

        assertEquals("schedule", response.error.conflict?.conflictField)
        assertEquals(7, response.error.conflict?.currentTask?.version)
        assertEquals(5, response.error.conflict?.currentTask?.schedule?.version)
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
    fun validatesStrictChecklistPatchAndDuplicateIds() {
        fun item(id: String, title: String) = buildJsonObject {
            put("id", JsonPrimitive(id))
            put("title", JsonPrimitive(title))
            put("done", JsonPrimitive(false))
            put("sortOrder", JsonPrimitive(0.0))
            put("completedAt", JsonNull)
        }
        fun patch(vararg items: kotlinx.serialization.json.JsonObject) = buildJsonObject {
            put("checklistItems", buildJsonArray { items.forEach(::add) })
        }

        val valid = updateEnvelope(patch(item("check-1", "確認する")), patch(), null)
        val decoded = MobileTaskCommandContract.decodeUpdateEnvelope(MobileTaskCommandContract.encode(valid))
        assertEquals("check-1", decoded.command.changes.getValue("checklistItems").let {
            it as kotlinx.serialization.json.JsonArray
        }.first().let { it as kotlinx.serialization.json.JsonObject }.getValue("id").let {
            it as JsonPrimitive
        }.content)

        assertThrows(IllegalArgumentException::class.java) {
            MobileTaskCommandContract.encode(updateEnvelope(
                patch(item("duplicate", "A"), item("duplicate", "B")),
                patch(),
                null,
            ))
        }
        assertThrows(IllegalArgumentException::class.java) {
            MobileTaskCommandContract.encode(updateEnvelope(patch(item("blank", "   ")), patch(), null))
        }
        assertThrows(IllegalArgumentException::class.java) {
            MobileTaskCommandContract.encode(valid.copy(command = valid.command.copy(expectedScheduleVersion = 1)))
        }
    }

    @Test
    fun deleteTaskUsesVersionedStateEnvelopeAndConflictContract() {
        val envelope = MobileTaskStateEnvelopeDto(
            apiVersion = 1,
            schemaVersion = 4,
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
        schemaVersion = 4,
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

    private fun createEnvelope(provenance: MobileTaskCreationProvenanceDto) = MobileCreateTaskEnvelopeDto(
        apiVersion = 1,
        schemaVersion = 4,
        requestId = "request-create",
        commandId = "command-create",
        idempotencyKey = "command-create",
        clientDeviceId = "device-1",
        issuedAt = "2026-08-23T00:00:00Z",
        command = MobileCreateTaskCommandDto(
            name = "CreateTask",
            task = MobileCreateTaskCandidateDto(
                id = "task-create",
                title = "音声Task",
            ),
            provenance = provenance,
        ),
    )

    private fun receiptPayload(themeId: String): String = """
        {
          "ok": true,
          "meta": {
            "apiVersion": 1,
            "schemaVersion": 4,
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
            "schemaVersion": 4,
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
              "expectedVersion": 7,
              "conflictField": "task",
              "expectedScheduleVersion": null
            }
          }
        }
    """.trimIndent()

    private fun scheduleConflictPayload(): String = """
        {
          "ok": false,
          "meta": {
            "apiVersion": 1,
            "schemaVersion": 4,
            "serverId": "server-1",
            "serverRevision": 8,
            "generatedAt": "2026-08-22T01:00:00Z",
            "truncated": false
          },
          "error": {
            "code": "version_conflict",
            "message": "Scheduleが更新されています。",
            "retryable": false,
            "conflict": {
              "currentTask": {
                "id": "task-1",
                "version": 7,
                "title": "Task",
                "themeId": null,
                "state": "todo",
                "workState": null,
                "todayDate": null,
                "schedule": {
                  "id": "schedule-1",
                  "version": 5,
                  "startDate": "2026-08-23",
                  "endDate": "2026-08-25",
                  "dateKind": "range",
                  "rangeSemantics": null,
                  "confidence": "fixed",
                  "granularity": "day"
                },
                "updatedAt": "2026-08-22T01:00:00Z"
              },
              "intendedAction": "UpdateTask",
              "expectedVersion": 7,
              "conflictField": "schedule",
              "expectedScheduleVersion": 4
            }
          }
        }
    """.trimIndent()
}
