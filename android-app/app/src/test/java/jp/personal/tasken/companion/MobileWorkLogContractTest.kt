package jp.personal.tasken.companion

import org.junit.Assert.*
import org.junit.Test

class MobileWorkLogContractTest {
    @Test fun inputPreservesRawTextAndIndependentDateWhileRejectingMalformedUnicode() {
        val draft = MobileWorkLogDraft(id = "stable-note", body = " \n測定した🔬\n  ", performedDate = "2026-09-05", enteredAt = "2026-09-06T23:55:00+09:00")
        val envelope = MobileWorkLogContract.record(draft, "device")
        assertEquals(draft.id, envelope.commandId)
        assertEquals(draft.enteredAt, envelope.issuedAt)
        val decoded = MobileWorkLogContract.json.decodeFromString<MobileWorkLogEnvelope>(MobileWorkLogContract.json.encodeToString(envelope))
        assertEquals(envelope, decoded)
        assertTrue(runCatching { MobileWorkLogContract.record(draft.copy(body = "a\uD800"), "device") }.isFailure)
        assertTrue(runCatching { MobileWorkLogContract.record(draft.copy(performedDate = "2026-02-30"), "device") }.isFailure)
    }

    @Test fun desktopEditedProjectionIsNotRestrictedByMobileInputLength() {
        val record = MobileWorkLogDto("id", 2, "x".repeat(12001), "2026-09-05", "2026-09-06T23:55:00+09:00", null, null, false, false)
        MobileWorkLogContract.validateProjection(record)
        MobileWorkLogContract.validateProjection(record.copy(body = ""))
        assertTrue(runCatching { MobileWorkLogContract.record(MobileWorkLogDraft(body = record.body), "device") }.isFailure)
    }
}
