package jp.personal.tasken.companion

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class MobileCapturePhotoContractTest {
    @Test
    fun photoAttachRoundTripsThroughTheCaptureEnvelope() {
        val encoded = MobileCaptureCommandContract.encode(envelope(listOf(photo(1), photo(2))))
        val decoded = MobileCaptureCommandContract.decodeCreateEnvelope(encoded)
        assertEquals(2, decoded.command.capture.images?.size)
        assertEquals("photo-1", decoded.command.capture.images?.first()?.referenceId)
        assertEquals("image/jpeg", decoded.command.capture.images?.first()?.mediaType)
    }

    @Test
    fun photoFieldIsOmittedWhenAbsentForOlderDesktops() {
        val encoded = MobileCaptureCommandContract.encode(envelope(null))
        val decoded = MobileCaptureCommandContract.decodeCreateEnvelope(encoded)
        assertEquals(null, decoded.command.capture.images)
        assertTrue(!encoded.contains("images"))
    }

    @Test
    fun photoValidationRejectsOversizedOrMalformedSets() {
        assertTrue(runCatching {
            MobileCaptureCommandContract.encode(envelope((1..9).map { photo(it) }))
        }.isFailure)
        assertTrue(runCatching {
            MobileCaptureCommandContract.encode(envelope(listOf(photo(1).copy(referenceId = "BAD ID"))))
        }.isFailure)
        assertTrue(runCatching {
            MobileCaptureCommandContract.encode(envelope(listOf(photo(1), photo(1))))
        }.isFailure)
        assertTrue(runCatching {
            MobileCaptureCommandContract.encode(envelope(listOf(photo(1).copy(mediaType = "image/gif"))))
        }.isFailure)
        assertTrue(runCatching {
            MobileCaptureCommandContract.encode(envelope(listOf(photo(1).copy(dataBase64 = ""))))
        }.isFailure)
    }

    @Test
    fun photoReferenceIdsAndDownscaleMathStayStable() {
        assertEquals("photo-1", capturePhotoReferenceId(1))
        assertEquals("photo-8", capturePhotoReferenceId(8))
        assertEquals(4000 to 3000, scaledPhotoDimensions(4000, 3000, 4000))
        assertEquals(2048 to 1536, scaledPhotoDimensions(4000, 3000, 2048))
        assertEquals(1536 to 2048, scaledPhotoDimensions(3000, 4000, 2048))
        assertEquals(1 to 1, scaledPhotoDimensions(1, 1, 2048))
    }

    @Test
    fun draftKeepsPhotoFileNamesWithoutBytes() {
        val draft = MobileCaptureDraft.fresh(kind = MobileCaptureKind.Capture)
            .withPhoto(MobileCapturePhoto("a.jpg"))
            .withPhoto(MobileCapturePhoto("a.jpg"))
            .withPhoto(MobileCapturePhoto("b.jpg"))
        assertEquals(listOf("a.jpg", "b.jpg"), draft.photos.map { it.fileName })
        assertEquals(listOf("b.jpg"), draft.withoutPhoto("a.jpg").photos.map { it.fileName })
    }

    @Test
    fun photoRejectionGuidesDesktopUpdateOnlyFromPairedServer() {
        val json = MobileCaptureCommandContract.encode(envelope(listOf(photo(1))))
        fun error(code: String, serverId: String = "server-1") = GatewayHttpResponse(400,
            """{"ok":false,"meta":{"serverId":"$serverId"},"error":{"code":"$code"}}""")
        assertTrue(isUnsupportedPhotoCapture(json, error("validation_failed"), "server-1"))
        assertTrue(isUnsupportedPhotoCapture(json, error("version_mismatch"), "server-1"))
        assertTrue(isUnsupportedPhotoCapture(json, error("capability_unavailable"), "server-1"))
        assertTrue(!isUnsupportedPhotoCapture(json, error("validation_failed", "different"), "server-1"))
        assertTrue(!isUnsupportedPhotoCapture(json, error("forbidden"), "server-1"))
        assertTrue(!isUnsupportedPhotoCapture(MobileCaptureCommandContract.encode(envelope(null)), error("validation_failed"), "server-1"))
        assertTrue(hasCaptureImages(json))
        assertTrue(!hasCaptureImages(MobileCaptureCommandContract.encode(envelope(null))))
    }

    private fun photo(index: Int) = MobileCaptureImageDto(
        referenceId = capturePhotoReferenceId(index),
        fileName = "photo-$index.jpg",
        mediaType = "image/jpeg",
        dataBase64 = "aGVsbG8=",
    )

    private fun envelope(images: List<MobileCaptureImageDto>?) = MobileCreateCaptureEnvelopeDto(
        TASKEN_MOBILE_API_VERSION, TASKEN_MOBILE_SCHEMA_VERSION,
        "request-photo", "command-photo", "command-photo", "device-test", "2026-09-06T00:00:00Z",
        MobileCreateCaptureCommandDto("CreateCapture", MobileCreateCaptureCandidateDto(
            "capture-photo", "レシピの材料", null, "2026-09-06T00:00:00Z", images = images,
        )),
    )

    @Test
    fun taskPhotoAttachRoundTripsThroughTheTaskEnvelope() {
        val envelope = MobileCreateTaskEnvelopeDto(
            TASKEN_MOBILE_API_VERSION, TASKEN_MOBILE_SCHEMA_VERSION,
            "request-task-photo", "command-task-photo", "command-task-photo", "device-test", "2026-09-06T00:00:00Z",
            MobileCreateTaskCommandDto("CreateTask", MobileCreateTaskCandidateDto(
                "task-photo", "レシピの買い物リスト", images = listOf(photo(1)),
            )),
        )
        val decoded = MobileTaskCommandContract.decodeCreateEnvelope(
            MobileTaskCommandContract.encode(envelope),
        )
        assertEquals(1, decoded.command.task.images?.size)
        assertEquals("photo-1", decoded.command.task.images?.first()?.referenceId)
        assertTrue(runCatching {
            MobileTaskCommandContract.encode(envelope.copy(command = envelope.command.copy(
                task = envelope.command.task.copy(images = listOf(photo(1), photo(1))),
            )))
        }.isFailure)
    }
}
