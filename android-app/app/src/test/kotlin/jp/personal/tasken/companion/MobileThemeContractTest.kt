package jp.personal.tasken.companion

import org.junit.Assert.assertEquals
import org.junit.Assert.assertThrows
import org.junit.Test

class MobileThemeContractTest {
    @Test
    fun decodesSharedGoldenThemeCatalogFixture() {
        val golden = requireNotNull(
            javaClass.classLoader?.getResource("themes-response.golden.json"),
        ).readText()

        val response = MobileThemeContract.decodePage(golden)

        assertEquals(listOf("研究", "個人"), response.data.themes.map { it.title })
        assertEquals(null, response.data.nextCursor)
    }

    @Test
    fun decodesStrictThemePageAndNormalizesLabels() {
        val response = MobileThemeContract.decodePage(
            """
            {
              "ok": true,
              "meta": {
                "apiVersion": 1,
                "schemaVersion": 5,
                "serverId": " server-1 ",
                "serverRevision": 4,
                "generatedAt": "2026-08-22T01:00:00Z",
                "truncated": true
              },
              "data": {
                "themes": [
                  {"id": " theme-2 ", "title": " Beta "},
                  {"id": "theme-1", "title": "Alpha"}
                ],
                "nextCursor": " theme-1 "
              }
            }
            """.trimIndent(),
        )

        assertEquals("server-1", response.meta.serverId)
        assertEquals(listOf("theme-2", "theme-1"), response.data.themes.map { it.id })
        assertEquals(listOf("Beta", "Alpha"), response.data.themes.map { it.title })
        assertEquals("theme-1", response.data.nextCursor)
    }

    @Test
    fun rejectsDuplicateThemeIdsAfterNormalization() {
        val payload = """
            {
              "ok": true,
              "meta": {
                "apiVersion": 1,
                "schemaVersion": 5,
                "serverId": "server-1",
                "serverRevision": 4,
                "generatedAt": "2026-08-22T01:00:00Z",
                "truncated": false
              },
              "data": {
                "themes": [
                  {"id": "theme-1", "title": "Alpha"},
                  {"id": " theme-1 ", "title": "Duplicate"}
                ],
                "nextCursor": null
              }
            }
        """.trimIndent()

        assertThrows(MobileThemeContractException::class.java) {
            MobileThemeContract.decodePage(payload)
        }
    }

    @Test
    fun rejectsUnknownFieldsAndBlankTitles() {
        val unknown = validEmptyPage().replace("\"nextCursor\": null", "\"nextCursor\": null, \"extra\": true")
        val blankTitle = validEmptyPage().replace(
            "\"themes\": []",
            "\"themes\": [{\"id\": \"theme-1\", \"title\": \"   \"}]",
        )
        val blankCursor = validEmptyPage()
            .replace("\"truncated\": false", "\"truncated\": true")
            .replace("\"nextCursor\": null", "\"nextCursor\": \"   \"")

        assertThrows(MobileThemeContractException::class.java) { MobileThemeContract.decodePage(unknown) }
        assertThrows(MobileThemeContractException::class.java) { MobileThemeContract.decodePage(blankTitle) }
        assertThrows(MobileThemeContractException::class.java) { MobileThemeContract.decodePage(blankCursor) }
    }

    private fun validEmptyPage(): String = """
        {
          "ok": true,
          "meta": {
            "apiVersion": 1,
            "schemaVersion": 5,
            "serverId": "server-1",
            "serverRevision": 4,
            "generatedAt": "2026-08-22T01:00:00Z",
            "truncated": false
          },
          "data": {"themes": [], "nextCursor": null}
        }
    """.trimIndent()
}
