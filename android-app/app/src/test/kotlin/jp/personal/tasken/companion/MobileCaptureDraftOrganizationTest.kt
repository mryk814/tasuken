package jp.personal.tasken.companion

import org.junit.Assert.assertEquals
import org.junit.Test

class MobileCaptureDraftOrganizationTest {
    @Test
    fun exclusionRetainsSlotsAndEditsAcrossEightCandidatesAndRecreation() {
        val original = "長い原文".repeat(1000)
        val draft = MobileCaptureDraft.fresh(text = original).withOrganizations(
            List(8) { MobileCaptureOrganization("候補 $it") },
        )
        val originalIds = draft.organizedTaskDrafts().map { it.draftId }
        val edited = draft.withEditedOrganizations(draft.allOrganizations().mapIndexed { index, item ->
            when (index) {
                0 -> item.copy(excluded = true, title = "")
                1 -> item.copy(themeId = "research", endDate = "2026-09-15",
                    checklist = listOf("確認", "記録"), supplement = "補足を保持",
                    plannedStartTime = "09:00", plannedDurationMinutes = 45, plannedTimeSupported = true)
                else -> item
            }
        })
        val restored = TodayPaneState.restore(TodayPaneState(captureDraft = edited).save()).captureDraft
        assertEquals(edited, restored)
        assertEquals(original, restored.originalText)
        val tasks = restored.organizedTaskDrafts()
        assertEquals(originalIds.drop(1), tasks.map { it.draftId })
        assertEquals("research", tasks.first().projectId)
        assertEquals("2026-09-15", tasks.first().organizationSchedule()?.endDate)
        assertEquals(listOf("確認", "記録"), tasks.first().organizationChecklistItems()?.map { it.title })
        assertEquals(45, tasks.first().organization?.plannedDurationMinutes)
        assertEquals(emptyList<MobileCaptureDraft>(), restored.withEditedOrganizations(
            restored.allOrganizations().map { it.copy(excluded = true) },
        ).organizedTaskDrafts())
        assertEquals(originalIds, restored.withEditedOrganizations(
            restored.allOrganizations().map { it.copy(excluded = false) },
        ).organizedTaskDrafts().map { it.draftId })
    }

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
