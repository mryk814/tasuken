package jp.personal.tasken.companion

import org.junit.Assert.assertEquals
import org.junit.Assert.assertThrows
import org.junit.Test

class MobileTaskImageContractTest {
    private val image = """{"fileName":"photo.jpg","mimeType":"image/jpeg","size":1234,"url":"tasken-attachment://photo.jpg"}"""
    private val meta = """"meta":{"apiVersion":1,"schemaVersion":7,"serverId":"desktop","serverRevision":1,"generatedAt":"2026-09-08T01:00:00Z","truncated":false}"""

    private fun task(images: String?) = """{
        "id":"task-1","version":1,"title":"写真付きTask","themeId":null,
        "state":"todo","workState":null,"schedule":null,"updatedAt":"2026-09-08T01:00:00Z"
        ${images?.let { ",\"images\":$it" } ?: ""}
    }"""

    private fun bootstrap(images: String?) = """{"ok":true,$meta,"data":{"tasks":[${task(images)}],"nextCursor":null,"hasMore":false}}"""
    private fun sync(images: String?) = """{"ok":true,$meta,"data":{"changes":[{"kind":"upsert","task":${task(images)}}],"nextCursor":"cursor","hasMore":false}}"""
    private fun today(images: String?) = """{"ok":true,$meta,"data":{"date":"2026-09-08","items":[${task(images)}],"nextCursor":null}}"""

    @Test
    fun acceptsGatewayPhotoMetadataAcrossTodayBootstrapAndDelta() {
        listOf(null, "[]", "[$image]").forEach { images ->
            val expected = if (images == "[$image]") listOf(MobileTaskImageSummaryDto("photo.jpg", "image/jpeg", 1234, "tasken-attachment://photo.jpg")) else emptyList()
            assertEquals(expected, MobileSyncContract.decodeBootstrap(bootstrap(images)).data.tasks.single().images)
            assertEquals(expected, MobileSyncContract.decodeSync(sync(images)).data.changes.single().task!!.images)
            assertEquals(expected, MobileTodayContract.decodeSuccess(today(images)).data.items.single().images)
        }
    }

    @Test
    fun rejectsInvalidMetadataAndUnknownFieldsWithoutRelaxingStrictDecoding() {
        val invalidImages = listOf(
            "[${image.replace("photo.jpg", "")}]",
            "[${image.replace("image/jpeg", "image/gif")}]",
            "[${image.replace("1234", "0")}]",
            "[${image.replace("1234", "12582913")}]",
            "[${image.replace("1234", "1.5")}]",
            "[${image.replace("tasken-attachment://photo.jpg", "")}]",
            "[${image.dropLast(1)},\"unexpected\":true}]",
            List(9) { image }.joinToString(prefix = "[", postfix = "]"),
        )
        invalidImages.forEach { images ->
            assertThrows(MobileSyncContractException::class.java) { MobileSyncContract.decodeBootstrap(bootstrap(images)) }
            assertThrows(MobileSyncContractException::class.java) { MobileSyncContract.decodeSync(sync(images)) }
            assertThrows(MobileTodayContractException::class.java) { MobileTodayContract.decodeSuccess(today(images)) }
        }
    }
}
