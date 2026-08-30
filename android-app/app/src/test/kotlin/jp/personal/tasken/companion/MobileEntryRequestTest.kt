package jp.personal.tasken.companion

import android.content.Intent
import org.junit.Assert.assertEquals
import org.junit.Assert.assertSame
import org.junit.Test

class MobileEntryRequestTest {
    @Test
    fun resolves_shortcut_capture_to_common_capture_request() {
        val result = MobileEntryRequestResolver.resolve(
            action = Intent.ACTION_VIEW,
            data = "tasken://capture/new?source=app_shortcut",
            mimeType = null,
            sharedText = null,
            token = 1,
        )

        assertEquals(MobileEntryRequest.Capture(1, MobileEntrySource.AppShortcut), result)
    }

    @Test
    fun resolves_voice_shortcut_to_confirmed_speech_capture() {
        val result = MobileEntryRequestResolver.resolve(
            action = Intent.ACTION_VIEW,
            data = "tasken://capture/new?source=android_speech",
            mimeType = null,
            sharedText = null,
            token = 7,
        )

        assertEquals(
            MobileEntryRequest.Capture(
                token = 7,
                source = MobileEntrySource.AndroidSpeech,
                startVoice = true,
            ),
            result,
        )
    }

    @Test
    fun resolves_widget_task_and_today_links() {
        assertEquals(
            MobileEntryRequest.Today(2, MobileEntrySource.Widget),
            MobileEntryRequestResolver.resolve(Intent.ACTION_VIEW, "tasken://today?source=widget", null, null, 2),
        )
        assertEquals(
            MobileEntryRequest.Task(3, MobileEntrySource.Widget, "44da65a3-a216-4b8c-87d6-8e468ceaed6a"),
            MobileEntryRequestResolver.resolve(
                Intent.ACTION_VIEW,
                "tasken://task/44da65a3-a216-4b8c-87d6-8e468ceaed6a?source=widget",
                null,
                null,
                3,
            ),
        )
    }

    @Test
    fun resolves_nonempty_plain_text_share_without_mutating_input() {
        val shared = "https://example.com/read-later\n共有メモ"
        assertEquals(
            MobileEntryRequest.Capture(
                token = 4,
                source = MobileEntrySource.ShareTarget,
                draft = shared,
                sharedMimeType = "text/plain",
            ),
            MobileEntryRequestResolver.resolve(Intent.ACTION_SEND, null, "text/plain", "  $shared  ", 4),
        )
    }

    @Test
    fun rejects_empty_share_unknown_scheme_and_ambiguous_task_locator() {
        assertSame(MobileEntryRequest.None, MobileEntryRequestResolver.resolve(Intent.ACTION_SEND, null, "text/plain", " ", 5))
        assertSame(MobileEntryRequest.None, MobileEntryRequestResolver.resolve(Intent.ACTION_VIEW, "https://example.com", null, null, 6))
        assertEquals(
            MobileEntryRequest.Task(7, MobileEntrySource.DeepLink, "not-an-id"),
            MobileEntryRequestResolver.resolve(Intent.ACTION_VIEW, "tasken://task/not-an-id", null, null, 7),
        )
        assertSame(MobileEntryRequest.None, MobileEntryRequestResolver.resolve(Intent.ACTION_VIEW, "tasken://task/a/b", null, null, 8))
    }
}
