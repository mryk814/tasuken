package jp.personal.tasken.companion

import org.junit.Assert.*
import org.junit.Test

class MobileLocalSearchTest {
    @Test fun japaneseWordsSymbolsAndQuotesAreLiteralAndCanBeCombined() {
        val text = "温度 100% A_B '引用' \"比較\"; DROP TABLE task_cache;"
        for (query in listOf("温度 比較", "100%", "A_B", "'引用'", "\"比較\"", "DROP TABLE"))
            assertTrue(query, matchesLocalSearch(text, localSearchTerms(query)))
        assertFalse(matchesLocalSearch(text, localSearchTerms("100_")))
        assertFalse(matchesLocalSearch(text, localSearchTerms("温度 存在しない")))
        assertTrue(matchesLocalSearch(text, localSearchTerms(" \n ")))
    }

    @Test fun invalidDatesAndOverlongQueriesAreExplainedWithoutTruncatingInput() {
        assertNull(MobileLocalSearchRequest(query = "測".repeat(200)).validationError())
        val request = MobileLocalSearchRequest(query = "測".repeat(201))
        assertNotNull(request.validationError()); assertEquals(201, request.query.length)
        assertNotNull(MobileLocalSearchRequest(fromDate = "2026-02-30").validationError())
        assertNotNull(MobileLocalSearchRequest(fromDate = "2026-09-09", toDate = "2026-09-08").validationError())
        assertNull(MobileLocalSearchRequest(fromDate = "2026-09-08", toDate = "2026-09-08").validationError())
    }

    @Test fun excerptsShowTheMatchWithoutSplittingEmojiOrReturningTheWholeBody() {
        val excerpt = localSearchExcerpt("🐕".repeat(200) + "目的の語" + "📚".repeat(200), listOf("目的の語"))
        assertTrue(excerpt.contains("目的の語")); assertTrue(excerpt.length <= 182)
        assertEquals(excerpt, String(excerpt.toByteArray(Charsets.UTF_8), Charsets.UTF_8))
        assertEquals("", localSearchExcerpt("", emptyList()))
    }
}
