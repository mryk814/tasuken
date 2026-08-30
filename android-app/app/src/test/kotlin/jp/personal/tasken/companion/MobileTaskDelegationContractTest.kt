package jp.personal.tasken.companion

import org.junit.Assert.assertEquals
import org.junit.Assert.assertThrows
import org.junit.Test

class MobileTaskDelegationContractTest {
    @Test
    fun immutableEnvelopeKeepsFingerprintAndIssuedAtAcrossDecode() {
        val envelope = MobileTaskDelegationEnvelopeDto(
            apiVersion = TASKEN_MOBILE_API_VERSION,
            schemaVersion = TASKEN_MOBILE_SCHEMA_VERSION,
            requestId = "request-1",
            commandId = "command-1",
            taskId = "task / 日本語",
            expectedTaskVersion = 4,
            agent = "hermes",
            expectedResult = "完了条件",
            instruction = "追加指示",
            contextFingerprint = "sha256:" + "a".repeat(64),
            issuedAt = "2026-08-30T00:00:00Z",
            actorId = "device-1",
        )
        val encoded = MobileTaskDelegationContract.encode(envelope)
        assertEquals(envelope, MobileTaskDelegationContract.decodeEnvelope(encoded))
    }

    @Test
    fun rejectsMissingFingerprintAndNormalizesMentionInput() {
        val invalid = MobileTaskDelegationEnvelopeDto(
            TASKEN_MOBILE_API_VERSION, TASKEN_MOBILE_SCHEMA_VERSION, "request", "command", "task", 1,
            "hermes", null, null, "2026-08-30T00:00:00Z", "device", "",
        )
        assertThrows(IllegalArgumentException::class.java) { MobileTaskDelegationContract.encode(invalid) }
        assertEquals("@\u200beveryone @\u200bhere <@\u200b123>", normalizeDelegationInput("@everyone\r\n@here <@123>"))
    }

    @Test
    fun optionalInputsAreOmittedRatherThanSerializedAsNull() {
        val envelope = MobileTaskDelegationEnvelopeDto(
            TASKEN_MOBILE_API_VERSION, TASKEN_MOBILE_SCHEMA_VERSION, "request", "command", "task", 1,
            "hermes", null, null, "2026-08-30T00:00:00Z", "device", "sha256:" + "b".repeat(64),
        )

        val encoded = MobileTaskDelegationContract.encode(envelope)

        assertEquals(false, encoded.contains("expectedResult"))
        assertEquals(false, encoded.contains("instruction"))
        assertEquals(envelope, MobileTaskDelegationContract.decodeEnvelope(encoded))
    }
}
