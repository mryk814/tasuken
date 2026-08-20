package jp.personal.tasken.companion

import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertThrows
import org.junit.Assert.assertTrue
import org.junit.Test

class MobileTodayGoldenFixtureTest {
    private val golden = requireNotNull(
        javaClass.classLoader?.getResource("today-response.golden.json"),
    ).readText()
    private val json = Json.parseToJsonElement(golden).jsonObject

    @Test
    fun decodesCanonicalLanguageNeutralTodayContractFixture() {
        val response = MobileTodayContract.decodeSuccess(golden)

        assertTrue(response.ok)
        assertEquals(1, response.meta.apiVersion)
        assertEquals(1, response.meta.schemaVersion)
        assertFalse(response.meta.truncated)
        assertEquals("2026-08-21", response.data.date)
        assertEquals(null, response.data.nextCursor)
        assertEquals(2, response.data.items.size)
        assertEquals("解析結果を確認する", response.data.items.first().title)
        assertEquals("in_progress", response.data.items.first().workState)
        assertEquals(response.data.items.size, response.toResult().tasks.size)
    }

    @Test
    fun rejectsInvalidSemanticAndShapeMutations() {
        val missingTitle = mutateFirstItem { JsonObject(it - "title") }
        val unknownField = JsonObject(json + ("unexpected" to JsonPrimitive(true)))
        val tooManyItems = mutateData { data ->
            val item = data.getValue("items").jsonArray.first().jsonObject
            JsonObject(data + ("items" to JsonArray(List(51) { index ->
                JsonObject(item + ("id" to JsonPrimitive("task-$index")))
            })))
        }

        val invalidPayloads = listOf(
            mutateRoot { it + ("ok" to JsonPrimitive(false)) },
            mutateMeta { it + ("apiVersion" to JsonPrimitive(2)) },
            mutateMeta { it + ("schemaVersion" to JsonPrimitive(2)) },
            mutateMeta { it + ("serverRevision" to JsonPrimitive(-1)) },
            mutateMeta { it + ("generatedAt" to JsonPrimitive("not-a-timestamp")) },
            mutateData { it + ("date" to JsonPrimitive("2026-02-30")) },
            tooManyItems,
            mutateFirstItem { it + ("id" to JsonPrimitive(" ")) },
            mutateFirstItem { it + ("id" to JsonPrimitive("x".repeat(201))) },
            mutateFirstItem { it + ("state" to JsonPrimitive("invalid")) },
            mutateFirstItem { it + ("workState" to JsonPrimitive("invalid")) },
            mutateFirstItem { it + ("updatedAt" to JsonPrimitive("not-a-timestamp")) },
            missingTitle,
            unknownField,
        )

        invalidPayloads.forEach { payload ->
            assertThrows(MobileTodayContractException::class.java) {
                MobileTodayContract.decodeSuccess(payload.toString())
            }
        }
    }

    @Test
    fun acceptsNonUuidEntityIdsBecauseSharedContractDoesNotRequireUuid() {
        val payload = mutateFirstItem {
            it + mapOf(
                "id" to JsonPrimitive("task-contract-id"),
                "themeId" to JsonPrimitive("theme-contract-id"),
            )
        }
        val response = MobileTodayContract.decodeSuccess(payload.toString())
        assertEquals("task-contract-id", response.data.items.first().id)
    }

    @Test
    fun normalizesPaddedIdsAndTitleLikeTheTypeScriptSchema() {
        val payload = mutateFirstItem {
            it + mapOf(
                "id" to JsonPrimitive("  task-contract-id  "),
                "title" to JsonPrimitive("  Padded title  "),
                "themeId" to JsonPrimitive("  theme-contract-id  "),
            )
        }
        val response = MobileTodayContract.decodeSuccess(payload.toString())
        val item = response.data.items.first()
        assertEquals("task-contract-id", item.id)
        assertEquals("Padded title", item.title)
        assertEquals("theme-contract-id", item.themeId)
        assertEquals("Padded title", response.toResult().tasks.first().title)
    }

    @Test
    fun preservesIndependentTruncationAndNullableCursorV1Contract() {
        val truncatedWithoutCursor = mutateMeta { it + ("truncated" to JsonPrimitive(true)) }
        val cursorWithoutTruncation = mutateData { it + ("nextCursor" to JsonPrimitive("")) }
        assertTrue(MobileTodayContract.decodeSuccess(truncatedWithoutCursor.toString()).meta.truncated)
        assertEquals("", MobileTodayContract.decodeSuccess(cursorWithoutTruncation.toString()).data.nextCursor)
    }

    private fun mutateRoot(change: (Map<String, JsonElement>) -> Map<String, JsonElement>): JsonObject =
        JsonObject(change(json))

    private fun mutateMeta(change: (Map<String, JsonElement>) -> Map<String, JsonElement>): JsonObject =
        mutateRoot { root ->
            val meta = root.getValue("meta").jsonObject
            root + ("meta" to JsonObject(change(meta)))
        }

    private fun mutateData(change: (Map<String, JsonElement>) -> Map<String, JsonElement>): JsonObject =
        mutateRoot { root ->
            val data = root.getValue("data").jsonObject
            root + ("data" to JsonObject(change(data)))
        }

    private fun mutateFirstItem(change: (Map<String, JsonElement>) -> Map<String, JsonElement>): JsonObject =
        mutateData { data ->
            val items = data.getValue("items").jsonArray
            val first = JsonObject(change(items.first().jsonObject))
            data + ("items" to JsonArray(listOf(first) + items.drop(1)))
        }
}
