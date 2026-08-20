package jp.personal.tasken.companion

import org.junit.Assert.assertEquals
import org.junit.Test

class ScaffoldIdentityTest {
    @Test
    fun generatedApplicationIdMatchesCompanionPackage() {
        assertEquals("jp.personal.tasken.companion", BuildConfig.APPLICATION_ID)
        assertEquals("Tasken Companion", ScaffoldIdentity.displayName)
        assertEquals("Phase 0B", ScaffoldIdentity.phase)
        assertEquals("Today", ScaffoldIdentity.primaryRoute)
        assertEquals("contracts/mobile/v1/today-response.golden.json", ScaffoldIdentity.contractFixture)
    }
}
