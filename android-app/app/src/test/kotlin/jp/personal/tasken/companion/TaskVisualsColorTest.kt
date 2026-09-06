package jp.personal.tasken.companion

import androidx.compose.ui.graphics.toArgb
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import org.junit.Assert.assertEquals
import org.junit.Test

class TaskVisualsColorTest {
    @Test
    fun chartColorsMatchDesktopDesignTokensInBothModes() {
        val charts = Json.parseToJsonElement(
            requireNotNull(javaClass.classLoader?.getResource("tokens.json")).readText(),
        ).jsonObject.getValue("chart").jsonObject
        for ((mode, dark) in listOf("light" to false, "dark" to true)) {
            charts.getValue(mode).jsonArray.forEachIndexed { index, value ->
                val expected = (0xFF000000L or value.jsonPrimitive.content.removePrefix("#").toLong(16)).toInt()
                assertEquals(expected, taskenThemeColor("chart-${index + 1}", dark).toArgb())
            }
        }
    }
}
