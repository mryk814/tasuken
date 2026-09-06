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
}
