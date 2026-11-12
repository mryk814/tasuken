package jp.personal.tasken.companion

import kotlinx.serialization.json.Json
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

/** AI公開範囲の廃止前後のサーバの、どちらの応答も（欄の厳密な照合のまま）読めること。 */
class MobileTaskContextPreviewAiDtoTest {
    private val json = Json { ignoreUnknownKeys = false }

    @Test
    fun readsTheOldServerResponseThatStillCarriesVisibility() {
        val ai = json.decodeFromString<MobileTaskContextPreviewAiDto>(
            """{"visibility":["coding_agent"],"visibilitySource":"workspace_default","authority":null,"freshness":"unknown","summaryAuthority":null}""",
        )
        assertEquals("unknown", ai.freshness)
    }

    @Test
    fun readsTheNewServerResponseWithoutVisibility() {
        val ai = json.decodeFromString<MobileTaskContextPreviewAiDto>(
            """{"authority":"user_confirmed","freshness":"current","summaryAuthority":"excerpt"}""",
        )
        assertEquals("current", ai.freshness)
        assertNull(ai.visibility)
        assertNull(ai.visibilitySource)
    }
}
