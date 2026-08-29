package jp.personal.tasken.companion

import org.junit.Assert.assertEquals
import org.junit.Assert.assertThrows
import org.junit.Test

class MobileHumanReviewContractTest {
    @Test
    fun returnEnvelopeRequiresCanonicalIdentityAndReviewNote() {
        val envelope = MobileTaskWorkReviewEnvelopeDto(
            apiVersion = 1,
            schemaVersion = 5,
            requestId = "request-1",
            commandId = "command-1",
            idempotencyKey = "command-1",
            clientDeviceId = "device-1",
            issuedAt = "2026-08-26T00:00:00Z",
            taskId = "task-1",
            expectedTaskVersion = 4,
            receiptId = "receipt-1",
            action = "return",
            reviewNote = "検証結果を追記してください。",
        )

        val encoded = MobileHumanReviewContract.encode(envelope)

        assertEquals(true, encoded.contains("\"reviewNote\":\"検証結果を追記してください。\""))
        assertThrows(MobileHumanReviewContractException::class.java) {
            MobileHumanReviewContract.encode(envelope.copy(reviewNote = ""))
        }
        assertThrows(MobileHumanReviewContractException::class.java) {
            MobileHumanReviewContract.encode(envelope.copy(idempotencyKey = "different"))
        }
    }

    @Test
    fun acceptResponseKeepsTaskAndReceiptIdentity() {
        val payload = """
            {
              "ok": true,
              "meta": {
                "apiVersion": 1,
                "schemaVersion": 5,
                "serverId": "desktop-home",
                "serverRevision": 12,
                "generatedAt": "2026-08-26T00:00:01Z",
                "truncated": false
              },
              "data": {
                "commandId": "command-1",
                "commandStatus": "applied",
                "action": "accept",
                "receiptId": "receipt-1",
                "task": {
                  "id": "task-1",
                  "version": 5,
                  "title": "確認する",
                  "themeId": null,
                  "state": "done",
                  "workState": "accepted",
                  "todayDate": null,
                  "plannedStartTime": null,
                  "plannedDurationMinutes": null,
                  "latestWorkReceipt": null,
                  "checklistItems": [],
                  "schedule": null,
                  "updatedAt": "2026-08-26T00:00:01Z"
                }
              }
            }
        """.trimIndent()

        val decoded = MobileHumanReviewContract.decode(payload)

        assertEquals("task-1", decoded.data.task.id)
        assertEquals("receipt-1", decoded.data.receiptId)
        assertEquals("done", decoded.data.task.state)
        assertEquals("accepted", decoded.data.task.workState)
    }
}
