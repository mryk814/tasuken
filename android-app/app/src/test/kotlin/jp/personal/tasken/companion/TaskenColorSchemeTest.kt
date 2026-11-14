package jp.personal.tasken.companion

import kotlinx.serialization.json.Json
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import org.junit.Assert.assertEquals
import org.junit.Test

class TaskenColorSchemeTest {
    @Test
    fun everyMaterialRoleReferencesTheCheckedInDesignTokenValue() {
        val tokens = Json.parseToJsonElement(
            requireNotNull(javaClass.classLoader?.getResource("tokens.json")).readText(),
        ).jsonObject.getValue("color").jsonObject

        verifyTheme("light", TaskenMaterialColorTokens.light, tokens.getValue("light").jsonObject)
        verifyTheme("dark", TaskenMaterialColorTokens.dark, tokens.getValue("dark").jsonObject)
    }

    /** AI の藍は Material の役割の外に持つので、役割の数（48）とは別に、同じ tokens.json と比べる。 */
    @Test
    fun aiColorsReferenceTheCheckedInDesignTokenValue() {
        val tokens = Json.parseToJsonElement(
            requireNotNull(javaClass.classLoader?.getResource("tokens.json")).readText(),
        ).jsonObject.getValue("color").jsonObject
        for ((name, mapping) in listOf("light" to TaskenAiColorTokens.light, "dark" to TaskenAiColorTokens.dark)) {
            assertEquals("$name ai role count", 4, mapping.size)
            mapping.forEach { (role, reference) ->
                assertEquals(
                    "$name.$role must equal color.$name.${reference.token}",
                    tokens.getValue(name).jsonObject.getValue(reference.token).jsonPrimitive.content.uppercase(),
                    reference.hex.uppercase(),
                )
            }
        }
    }

    private fun verifyTheme(
        name: String,
        mapping: Map<String, TokenColorReference>,
        tokens: Map<String, kotlinx.serialization.json.JsonElement>,
    ) {
        assertEquals("$name role count", 48, mapping.size)
        mapping.forEach { (role, reference) ->
            assertEquals(
                "$name.$role must equal color.$name.${reference.token}",
                tokens.getValue(reference.token).jsonPrimitive.content.uppercase(),
                reference.hex.uppercase(),
            )
        }
    }
}
