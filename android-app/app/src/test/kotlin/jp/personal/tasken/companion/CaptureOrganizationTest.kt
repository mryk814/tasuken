package jp.personal.tasken.companion

import kotlinx.serialization.json.Json
import kotlinx.serialization.json.jsonObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class CaptureOrganizationTest {
    @Test
    fun plannedTimeSurvivesEditingAndDraftRestorationWithoutInventingDates() {
        val original = "15時、いや16時から30分、図を直す"
        val draft = MobileCaptureDraft.fresh(text = original).withOrganizations(listOf(
            MobileCaptureOrganization("図を直す", plannedStartTime = "16:00", plannedDurationMinutes = 30, plannedTimeSupported = true),
            MobileCaptureOrganization("資料を読む", plannedDurationMinutes = 45, plannedTimeSupported = true),
        ))
        val edited = draft.withEditedOrganizations(listOf(
            draft.organization!!.copy(plannedStartTime = "16:30", plannedDurationMinutes = 60),
        ) + draft.additionalOrganizations)
        val restored = TodayPaneState.restore(TodayPaneState(captureDraft = edited).save()).captureDraft
        assertEquals(edited, restored)
        assertEquals("16:30", restored.organization?.plannedStartTime)
        assertEquals(60, restored.organization?.plannedDurationMinutes)
        assertNull(restored.organizationSchedule())
        assertEquals(45, restored.organizedTaskDrafts()[1].organization?.plannedDurationMinutes)
        assertEquals(original, restored.withoutOrganization().text)
        assertNull(restored.withoutOrganization().organization)
    }

    @Test
    fun legacyDraftsAndInvalidTimeNeverSilentlyBecomeSupportedProposals() {
        val legacy = Json.decodeFromString<MobileCaptureOrganization>("""{"title":"過去の整理案"}""")
        assertFalse(legacy.plannedTimeSupported)
        legacy.validate()
        assertTrue(runCatching { legacy.copy(plannedStartTime = "15:00").validate() }.isFailure)
        val timed = legacy.copy(plannedTimeSupported = true)
        for (time in listOf("24:00", "15:", "3:00", "午後")) {
            assertTrue(runCatching { timed.copy(plannedStartTime = time).validate() }.isFailure)
        }
        for (minutes in listOf(0, -1, 10081)) {
            assertTrue(runCatching { timed.copy(plannedDurationMinutes = minutes).validate() }.isFailure)
        }
        timed.copy(plannedStartTime = "00:00", plannedDurationMinutes = 10080).validate()
    }

    @Test
    fun discardingProposalRestoresSelectedOrUnassignedThemeAfterReorganizationAndRestore() {
        for (themeId in listOf(null, "original-theme")) {
            val draft = MobileCaptureDraft.fresh(text = "原文", projectId = themeId)
                .withOrganization(MobileCaptureOrganization("整理後", themeId = "guessed-theme"))
                .withOrganization(MobileCaptureOrganization("再整理後", themeId = "another-theme"))
            val restored = TodayPaneState.restore(TodayPaneState(captureDraft = draft).save()).captureDraft
            assertEquals(themeId, restored.originalThemeId)
            val original = restored.withoutOrganization()
            assertEquals("原文", original.text)
            assertEquals(themeId, original.projectId)
            assertNull(original.organization)
            assertNull(original.originalThemeId)
            assertEquals(themeId, restored.withKind(MobileCaptureKind.Capture).projectId)
        }
    }

    @Test
    fun warningsHaveTheSameBoundsAsTheDesktopGateway() {
        MobileCaptureOrganization("タイトル", warnings = List(10) { "注意" }).validate()
        assertTrue(runCatching { MobileCaptureOrganization("タイトル", warnings = List(11) { "注意" }).validate() }.isFailure)
        assertTrue(runCatching { MobileCaptureOrganization("タイトル", warnings = listOf("あ".repeat(501))).validate() }.isFailure)
    }

    private val proposal = MobileCaptureOrganization(
        title = "帰りに買い物をする", themeId = "home", startDate = "2026-09-06",
        checklist = listOf("牛乳を買う", "パンを買う"), supplement = "帰宅前に近所のお店へ寄る",
    )

    @Test
    fun adoptionKeepsOriginalAndStableChecklistAcrossTitleAndThemeEdits() {
        val original = "明日帰りに近所で牛乳とパンを買いたい"
        val draft = MobileCaptureDraft.fresh(text = original).withOrganization(proposal)
        val edited = draft.withText("帰りの買い物").withThemeId(null)
        assertEquals(original, edited.originalText)
        assertEquals("帰りの買い物", edited.organization?.title)
        assertNull(edited.organization?.themeId)
        assertEquals(draft.organizationChecklistItems(), edited.organizationChecklistItems())
        assertEquals("# 補足\n帰宅前に近所のお店へ寄る\n\n# 元の入力\n$original", edited.organizationDescription())
        assertEquals("2026-09-06", edited.organizationSchedule()?.startDate)
    }

    @Test
    fun changingKindOrRecordingAgainClearsStaleOrganizationWithoutLosingOriginal() {
        val draft = MobileCaptureDraft.fresh(text = "元の発話").withOrganization(proposal)
        val capture = draft.withKind(MobileCaptureKind.Capture)
        assertEquals("元の発話", capture.text)
        assertNull(capture.organization)
        val recognized = draft.withSpeechResult(
            ShortSpeechRecognitionResult("さらに追加", MobileSpeechRecognitionMode.OnDevice, "ja-JP", null),
            append = true,
        )
        assertEquals("元の発話 さらに追加", recognized.text)
        assertNull(recognized.organization)
        assertNull(recognized.originalText)
    }

    @Test
    fun rejectedOrganizationDoesNotMutateDraft() {
        val draft = MobileCaptureDraft.fresh(text = "入力を保持")
        assertTrue(runCatching { draft.withOrganization(proposal.copy(checklist = List(21) { "項目" })) }.isFailure)
        assertEquals("入力を保持", draft.text)
        assertNull(draft.organization)
    }

    @Test
    fun normalCreateOmitsNewFieldsAndOrganizedCreateRoundTrips() {
        val envelope = MobileCreateTaskEnvelopeDto(
            1, TASKEN_MOBILE_SCHEMA_VERSION, "request", "command", "command", "device", "2026-09-05T00:00:00Z",
            MobileCreateTaskCommandDto("CreateTask", MobileCreateTaskCandidateDto("task", "牛乳を買う")),
        )
        val normal = Json.parseToJsonElement(MobileTaskCommandContract.encode(envelope)).jsonObject.getValue("command").jsonObject
        assertFalse(normal.containsKey("schedule"))
        assertFalse(normal.getValue("task").jsonObject.containsKey("description"))
        assertFalse(normal.getValue("task").jsonObject.containsKey("checklistItems"))
        val draft = MobileCaptureDraft.fresh(text = "原文").withOrganization(proposal)
        val organized = envelope.copy(command = envelope.command.copy(
            task = envelope.command.task.copy(description = draft.organizationDescription(), checklistItems = draft.organizationChecklistItems()),
            schedule = draft.organizationSchedule(),
        ))
        assertEquals(organized, MobileTaskCommandContract.decodeCreateEnvelope(MobileTaskCommandContract.encode(organized)))
    }
}
