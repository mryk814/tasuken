package jp.personal.tasken.companion

import kotlinx.serialization.json.Json
import org.junit.Assert.*
import org.junit.Test

class MobileAiOriginContractTest {
    private val json = Json { ignoreUnknownKeys = false }
    private val origin = MobileAiOrigin("Codex", "2026-10-03T08:00:00Z")
    @Test fun strictDtoSupportsOldPayloadAndBoundedReadOnlyOrigin() {
        val old = """{"id":"task","version":1,"title":"確認する","themeId":null,"state":"todo","workState":null,"schedule":null,"updatedAt":"2026-10-03T08:00:00Z"}"""
        val task = json.decodeFromString<MobileTaskSummaryDto>(old)
        assertNull(task.aiOrigin)
        val current = json.decodeFromString<MobileTaskSummaryDto>(old.dropLast(1) + """, "aiOrigin":{"caller":"Codex","receivedAt":"2026-10-03T08:00:00Z","seenAt":null}}""")
        validateMobileAiOrigin(current.aiOrigin)
        assertEquals(origin, current.aiOrigin)
        assertEquals(task.state, current.state)
        assertEquals(task.workState, current.workState)
        assertThrows(IllegalArgumentException::class.java) { validateMobileAiOrigin(origin.copy(caller = "")) }
        assertThrows(Exception::class.java) { json.decodeFromString<MobileAiOrigin>("""{"caller":"Codex","receivedAt":"2026-10-03T08:00:00Z","authority":"user_confirmed"}""") }
    }
    @Test fun oldAndNewRelatedNotePayloadsRemainStrict() {
        val old = """{"type":"note","id":"note","title":"比較メモ","version":1,"status":"available","reasons":[{"predicate":"related_to","direction":"from_task"}]}"""
        assertNull(json.decodeFromString<RelatedSummary>(old).aiOrigin)
        val note = json.decodeFromString<RelatedSummary>(old.dropLast(1) + """, "aiOrigin":{"caller":"Codex","receivedAt":"2026-10-03T08:00:00Z","seenAt":"2026-10-03T09:00:00Z"}}""")
        validateMobileAiOrigin(note.aiOrigin)
        assertEquals("2026-10-03T09:00:00Z", note.aiOrigin?.seenAt)
    }
}
