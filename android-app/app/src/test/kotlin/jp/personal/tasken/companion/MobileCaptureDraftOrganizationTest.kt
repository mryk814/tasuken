package jp.personal.tasken.companion

import org.junit.Assert.assertEquals
import org.junit.Test

class MobileCaptureDraftOrganizationTest {
    @Test
    fun oneSpeechDraftExpandsIntoStableIndependentTaskDrafts() {
        val first = MobileCaptureOrganization(
            title = "比較実験を準備",
            themeId = "research",
            checklist = listOf("データを集める"),
            supplement = "条件を揃える",
        )
        val second = MobileCaptureOrganization(
            title = "牛乳を買う",
            themeId = "home",
            endDate = "2026-09-11",
            checklist = listOf("低脂肪乳を選ぶ"),
            supplement = "",
        )
        val draft = MobileCaptureDraft.fresh(text = "比較実験。そういえば牛乳も買う")
            .withOrganizations(listOf(first, second))

        val tasks = draft.organizedTaskDrafts()

        assertEquals(2, tasks.size)
        assertEquals(draft.draftId, tasks[0].draftId)
        assertEquals("${draft.draftId}:task:1", tasks[1].draftId)
        assertEquals("比較実験を準備", tasks[0].text)
        assertEquals("牛乳を買う", tasks[1].text)
        assertEquals("research", tasks[0].projectId)
        assertEquals("home", tasks[1].projectId)
        assertEquals(draft.originalText, tasks[0].originalText)
        assertEquals(draft.originalText, tasks[1].originalText)
    }
}
