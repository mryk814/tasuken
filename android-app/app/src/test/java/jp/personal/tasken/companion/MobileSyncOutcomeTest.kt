package jp.personal.tasken.companion

import org.junit.Assert.assertEquals
import org.junit.Test

class MobileSyncOutcomeTest {
    @Test
    fun `commands the Desktop failed on their own do not make the background work back off`() {
        val onlyThoseWait = MobileOutboxDrainResult(retryPending = true, connectionFailed = false, triedAll = true)

        assertEquals(MobileSyncOutcome.CommandsWaiting, mobileSyncOutcome(onlyThoseWait, readSettled = true))
    }

    @Test
    fun `an unreachable Desktop, a cut-short round or a failed read retries soon`() {
        val unreachable = MobileOutboxDrainResult(retryPending = true, connectionFailed = true)
        val cutShort = MobileOutboxDrainResult(retryPending = true, connectionFailed = false, triedAll = false)
        val allSent = MobileOutboxDrainResult(retryPending = false, connectionFailed = false)

        assertEquals(MobileSyncOutcome.RetrySoon, mobileSyncOutcome(unreachable, readSettled = true))
        assertEquals(MobileSyncOutcome.RetrySoon, mobileSyncOutcome(cutShort, readSettled = true))
        assertEquals(MobileSyncOutcome.RetrySoon, mobileSyncOutcome(allSent, readSettled = false))
        assertEquals(
            MobileSyncOutcome.RetrySoon,
            mobileSyncOutcome(allSent.copy(retryPending = true, triedAll = true), readSettled = false),
        )
    }

    @Test
    fun `everything sent and read is settled`() {
        val allSent = MobileOutboxDrainResult(retryPending = false, connectionFailed = false)

        assertEquals(MobileSyncOutcome.Settled, mobileSyncOutcome(allSent, readSettled = true))
    }
}
