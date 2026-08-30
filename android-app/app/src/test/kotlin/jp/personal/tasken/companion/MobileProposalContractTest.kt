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

class MobileProposalContractTest {
    private val golden = requireNotNull(
        javaClass.classLoader?.getResource("task-work-proposals-response.golden.json"),
    ).readText()
    private val root = Json.parseToJsonElement(golden).jsonObject

    @Test
    fun decodesCanonicalSafeProposalPreview() {
        val response = MobileProposalContract.decodeList(golden)
        val proposal = response.data.proposals.single().toProposal(response.meta.truncated)

        assertTrue(response.ok)
        assertFalse(proposal.stale)
        assertEquals("report_done", proposal.action)
        assertEquals("ProposalをAndroidで確認する", proposal.taskTitle)
        assertEquals("Androidから確認できるProposalを実装しました。", proposal.summary)
        assertEquals("PR #472", proposal.externalReferences.single().displayLabel)
    }

    @Test
    fun rejectsUnknownRawFieldsUnsafeUrlsAndOversizedLists() {
        val rawPayload = mutateProposal { proposal ->
            proposal + ("payload" to JsonObject(mapOf("reasoning" to JsonPrimitive("hidden"))))
        }
        val runtimeMetadata = mutateProposal { proposal ->
            proposal + ("runtimeMetadata" to JsonObject(mapOf("provider" to JsonPrimitive("hidden"))))
        }
        val unsafeUrl = mutateFirstReference { reference ->
            reference + ("url" to JsonPrimitive("http://example.com/result"))
        }
        val oversizedItems = mutateProposal { proposal ->
            proposal + ("verification" to JsonArray(List(21) { JsonPrimitive("item-$it") }))
        }

        listOf(rawPayload, runtimeMetadata, unsafeUrl, oversizedItems).forEach { payload ->
            assertThrows(MobileProposalContractException::class.java) {
                MobileProposalContract.decodeList(payload.toString())
            }
        }
    }

    @Test
    fun decisionContractBindsDeviceVersionsAndDecision() {
        val envelope = MobileTaskWorkProposalDecisionEnvelopeDto(
            apiVersion = 1,
            schemaVersion = TASKEN_MOBILE_SCHEMA_VERSION,
            requestId = "request-proposal",
            commandId = "command-proposal",
            idempotencyKey = "command-proposal",
            clientDeviceId = "device-s23",
            issuedAt = "2026-08-21T01:00:00.000Z",
            proposalId = "11111111-1111-5111-8111-111111111111",
            taskId = "task-proposal-review",
            expectedProposalVersion = 1,
            expectedTaskVersion = 3,
            decision = "accept",
        )
        val encoded = MobileProposalContract.encodeDecision(envelope)
        assertTrue(encoded.contains("\"decision\":\"accept\""))
        assertThrows(MobileProposalContractException::class.java) {
            MobileProposalContract.encodeDecision(envelope.copy(idempotencyKey = "different"))
        }
        assertThrows(MobileProposalContractException::class.java) {
            MobileProposalContract.encodeDecision(envelope.copy(decision = "maybe"))
        }
    }

    private fun mutateProposal(
        change: (Map<String, kotlinx.serialization.json.JsonElement>) -> Map<String, kotlinx.serialization.json.JsonElement>,
    ): JsonObject {
        val data = root.getValue("data").jsonObject
        val proposals = data.getValue("proposals") as JsonArray
        val first = proposals.first().jsonObject
        return JsonObject(
            root + ("data" to JsonObject(
                data + ("proposals" to JsonArray(listOf(JsonObject(change(first))) + proposals.drop(1))),
            )),
        )
    }

    private fun mutateFirstReference(
        change: (Map<String, kotlinx.serialization.json.JsonElement>) -> Map<String, kotlinx.serialization.json.JsonElement>,
    ): JsonObject = mutateProposal { proposal ->
        val references = proposal.getValue("externalReferences") as JsonArray
        val first = references.first().jsonObject
        proposal + ("externalReferences" to JsonArray(listOf(JsonObject(change(first))) + references.drop(1)))
    }
}
