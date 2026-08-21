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
