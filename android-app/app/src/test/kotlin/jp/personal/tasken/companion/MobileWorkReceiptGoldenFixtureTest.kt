package jp.personal.tasken.companion

import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.jsonObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertThrows
import org.junit.Assert.assertTrue
import org.junit.Test

class MobileWorkReceiptGoldenFixtureTest {
    private val golden = requireNotNull(
        javaClass.classLoader?.getResource("work-receipt-response.golden.json"),
    ).readText()
    private val root = Json.parseToJsonElement(golden).jsonObject

    @Test
    fun decodesCanonicalSafeWorkReceiptDetail() {
        val response = MobileWorkReceiptContract.decodeSuccess(golden)
        val detail = response.toDetail()

        assertTrue(response.ok)
        assertFalse(response.meta.truncated)
        assertEquals("receipt-ai-review", detail.id)
        assertEquals("task-ai-review", detail.taskId)
        assertEquals("Codex", detail.executorLabel)
        assertEquals(listOf("Mobile Gateway detail contract"), detail.completedItems)
        assertEquals("PR #472", detail.externalReferences.single().displayLabel)
    }

    @Test
    fun rejectsUnknownRawFieldsAndUnsafeUrls() {
        val rawOutput = mutateReceipt { receipt ->
            receipt + ("toolOutput" to JsonPrimitive("must stay hidden"))
        }
        val reasoning = mutateReceipt { receipt ->
            receipt + ("reasoning" to JsonPrimitive("must stay hidden"))
        }
        val unsafeUrl = mutateFirstReference { reference ->
            reference + ("url" to JsonPrimitive("http://example.com/result"))
        }
        val oversizedItems = mutateReceipt { receipt ->
            receipt + ("completedItems" to JsonArray(List(21) { JsonPrimitive("item-$it") }))
        }

        listOf(rawOutput, reasoning, unsafeUrl, oversizedItems).forEach { payload ->
            assertThrows(MobileWorkReceiptContractException::class.java) {
                MobileWorkReceiptContract.decodeSuccess(payload.toString())
            }
        }
    }

    private fun mutateReceipt(
        change: (Map<String, kotlinx.serialization.json.JsonElement>) -> Map<String, kotlinx.serialization.json.JsonElement>,
    ): JsonObject {
        val data = root.getValue("data").jsonObject
        val receipt = data.getValue("receipt").jsonObject
        return JsonObject(root + ("data" to JsonObject(data + ("receipt" to JsonObject(change(receipt))))))
    }

    private fun mutateFirstReference(
        change: (Map<String, kotlinx.serialization.json.JsonElement>) -> Map<String, kotlinx.serialization.json.JsonElement>,
    ): JsonObject = mutateReceipt { receipt ->
        val references = receipt.getValue("externalReferences") as JsonArray
        val first = references.first().jsonObject
        receipt + ("externalReferences" to JsonArray(listOf(JsonObject(change(first))) + references.drop(1)))
    }
}
