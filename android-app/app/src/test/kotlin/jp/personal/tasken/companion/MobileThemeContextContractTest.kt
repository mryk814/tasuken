package jp.personal.tasken.companion

import kotlinx.serialization.json.Json
import org.junit.Assert.*
import org.junit.Test

class MobileThemeContextContractTest {
    private val golden = requireNotNull(javaClass.classLoader?.getResource("theme-context-response.golden.json")).readText()

    @Test fun gatewayFixtureIncludesAllCanonicalIntentFields() {
        val response = MobileThemeContextContract.decode(golden)
        val theme = requireNotNull(response.data.theme)
        assertEquals("測定方法を見直す", theme.title)
        assertEquals("少量の試料でも再現性のある測定を行う。", theme.charter!!.purpose)
        assertEquals(listOf("生データを残す", "条件を一つずつ変える"), theme.charter.principles)
        assertEquals("別の測定法と比較する。", theme.currentState!!.next_frontier)
        assertEquals(response, MobileThemeContextContract.decode(Json.encodeToString(response)))
    }

    @Test fun limitsVersionsMetadataAndUnknownFieldsAreRejected() {
        val response = MobileThemeContextContract.decode(golden)
        val theme = response.data.theme!!
        val invalid = listOf(
            golden.replace("\"ok\": true", "\"ok\": true, \"secret\": \"no\""),
            Json.encodeToString(response.copy(meta = response.meta.copy(schemaVersion = 999))),
            Json.encodeToString(response.copy(meta = response.meta.copy(truncated = true))),
            Json.encodeToString(response.copy(data = response.data.copy(theme = theme.copy(id = "other")))),
            Json.encodeToString(response.copy(data = response.data.copy(theme = theme.copy(version = 0)))),
            Json.encodeToString(response.copy(data = response.data.copy(theme = theme.copy(charter = theme.charter!!.copy(purpose = "a".repeat(8001)))))),
            Json.encodeToString(response.copy(data = response.data.copy(theme = theme.copy(charter = theme.charter!!.copy(principles = List(21) { "a" }))))),
            Json.encodeToString(response.copy(data = response.data.copy(status = "not_found"))),
        )
        invalid.forEach { payload -> assertThrows(Exception::class.java) { MobileThemeContextContract.decode(payload) } }
        val unset = response.copy(data = response.data.copy(theme = theme.copy(charter = null, currentState = null)))
        assertNull(MobileThemeContextContract.decode(Json.encodeToString(unset)).data.theme!!.charter)
        val missing = response.copy(data = response.data.copy(status = "not_found", theme = null))
        assertNull(MobileThemeContextContract.decode(Json.encodeToString(missing)).data.theme)
    }
}
