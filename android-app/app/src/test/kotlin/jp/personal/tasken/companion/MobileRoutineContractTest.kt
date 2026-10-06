package jp.personal.tasken.companion

import kotlinx.serialization.SerializationException
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertThrows
import org.junit.Assert.assertTrue
import org.junit.Test

/** 続けること・手入れ（#454）の読み出しと記録の契約。 */
class MobileRoutineContractTest {
    private val meta = """{"apiVersion":1,"schemaVersion":7,"serverId":"desktop-home","serverRevision":7,"generatedAt":"2026-10-06T09:00:00.000Z","truncated":false}"""

    private val body = """
        {"ok":true,"meta":$meta,"data":{"date":"2026-10-06",
        "habits":[{"habitId":"habit-read","title":"論文を読む","scheduleLabel":"週3回","todayCount":1,"nextSequence":3,"weekCount":1,"weekTarget":3,"todayLabel":"今日1回","weekLabel":"今週1/3回","met":false}],
        "maintenances":[{"maintenanceId":"maint-filter","label":"エアコン / フィルターを掃除する","state":"overdue","dueLabel":"目安を5日過ぎています","nextDueOn":"2026-10-01","lastPerformedOn":"2026-09-01","intervalDays":30}]}}
    """.trimIndent()

    private fun envelope(action: MobileRoutineActionDto) = MobileRoutineActionEnvelopeDto(
        apiVersion = 1,
        schemaVersion = TASKEN_MOBILE_SCHEMA_VERSION,
        requestId = "request-1",
        commandId = "command-1",
        idempotencyKey = "command-1",
        clientDeviceId = "device",
        issuedAt = "2026-10-06T10:00:00Z",
        action = action,
    )

    @Test
    fun desktopRoutinesAreReadAsDerivedWithoutRecalculation() {
        val data = MobileRoutineContract.decode(body).data

        assertEquals("今週1/3回", data.habits.single().weekLabel)
        assertTrue(data.maintenances.single().overdue)
        assertFalse(data.isEmpty)
    }

    @Test
    fun unknownFieldsAreRejectedSoContractChangesAreNoticed() {
        assertThrows(SerializationException::class.java) {
            MobileRoutineContract.decode(body.replace("\"met\":false", "\"met\":false,\"streak\":4"))
        }
    }

    @Test
    fun habitRecordUsesTheNextSequenceOfTheDayAndOmitsUnusedFields() {
        val habit = MobileRoutineContract.decode(body).data.habits.single()
        val json = MobileRoutineContract.encode(envelope(MobileRoutineContract.habitAction(habit, "2026-10-06")))

        assertTrue(
            json.contains(
                "\"action\":{\"name\":\"RecordHabitEntry\",\"performedOn\":\"2026-10-06\",\"habitId\":\"habit-read\",\"sequence\":3}",
            ),
        )
        assertFalse(json.contains("maintenanceId"))
        assertFalse(json.contains("null"))
    }

    @Test
    fun maintenanceRecordCarriesOnlyTheItemAndDate() {
        val item = MobileRoutineContract.decode(body).data.maintenances.single()
        val json = MobileRoutineContract.encode(envelope(MobileRoutineContract.maintenanceAction(item, "2026-10-06")))

        assertTrue(
            json.contains(
                "\"action\":{\"name\":\"RecordMaintenance\",\"performedOn\":\"2026-10-06\",\"maintenanceId\":\"maint-filter\"}",
            ),
        )
        assertFalse(json.contains("sequence"))
    }

    @Test
    fun habitRecordStopsAtTheDesktopLimit() {
        val habit = MobileRoutineContract.decode(body).data.habits.single().copy(nextSequence = null)

        assertThrows(IllegalArgumentException::class.java) { MobileRoutineContract.habitAction(habit, "2026-10-06") }
    }

    @Test
    fun actionResponseCarriesTheNextDueDate() {
        val response = MobileRoutineContract.decodeResponse(
            """{"ok":true,"meta":$meta,"data":{"commandId":"command-1","status":"applied","nextDueOn":"2026-11-05"}}""",
        )

        assertEquals("2026-11-05", response.data.nextDueOn)
    }
}
