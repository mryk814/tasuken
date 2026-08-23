package jp.personal.tasken.companion

import org.junit.Assert.assertEquals
import org.junit.Test

class TodayPaneStateTest {
    @Test
    fun selectionAndScrollRestoreAfterRecreation() {
        val before = TodayPaneState()
        before.selectedTaskId = "10000000-0000-4000-8000-000000000001"
        before.recordScroll(7, 32)
        before.captureDraft = MobileCaptureDraft.fresh(
            text = "折りたたみ後も残す",
            source = MobileCaptureSource.AndroidSpeech,
            now = { java.time.Instant.parse("2026-08-23T00:00:00Z") },
            newId = { "draft-voice" },
        ).copy(
            projectId = "theme-research",
            speech = MobileSpeechProvenance(
                recognitionMode = MobileSpeechRecognitionMode.OnDevice,
                language = "ja-JP",
                confidence = 0.9f,
            ),
        )
        before.openCapture(
            source = MobileCaptureSource.AndroidSpeech,
            requestVoice = true,
            replaceDraft = false,
        )
        before.activeSection = AppSection.Ai
        before.taskSearch = "解析"
        before.taskFilter = TaskListFilter.Done
        before.recordTaskScroll(4, 18)
        before.recordAiScroll(2, 9)

        val restored = TodayPaneState.restore(before.save())

        assertEquals(before.selectedTaskId, restored.selectedTaskId)
        assertEquals(7, restored.listScrollIndex)
        assertEquals(32, restored.listScrollOffset)
        assertEquals("折りたたみ後も残す", restored.captureDraft.text)
        assertEquals("draft-voice", restored.captureDraft.draftId)
        assertEquals("theme-research", restored.captureDraft.projectId)
        assertEquals(MobileCaptureSource.AndroidSpeech, restored.captureDraft.source)
        assertEquals(MobileSpeechRecognitionMode.OnDevice, restored.captureDraft.speech?.recognitionMode)
        assertEquals("ja-JP", restored.captureDraft.speech?.language)
        assertEquals(0.9f, restored.captureDraft.speech?.confidence)
        assertEquals(true, restored.captureOpen)
        assertEquals(true, restored.captureVoiceStartRequested)
        assertEquals(AppSection.Ai, restored.activeSection)
        assertEquals("解析", restored.taskSearch)
        assertEquals(TaskListFilter.Done, restored.taskFilter)
        assertEquals(4, restored.taskListScrollIndex)
        assertEquals(18, restored.taskListScrollOffset)
        assertEquals(2, restored.aiListScrollIndex)
        assertEquals(9, restored.aiListScrollOffset)
    }
}
