package jp.personal.tasken.companion

import android.content.Context
import android.os.Process
import androidx.test.core.app.ApplicationProvider
import androidx.test.platform.app.InstrumentationRegistry
import org.junit.Assert.*
import org.junit.Assume.assumeTrue
import org.junit.Test

/** Run explicit save/reload phases in separate instrumentation invocations on an owned emulator. */
class DirectCaptureSettingsProcessTest {
    @Test fun saveBeforeProcessExit() {
        assumeTrue("Requires the explicit save phase in a separate process",
            InstrumentationRegistry.getArguments().getString("directCaptureSettingsPhase") == "save")
        val context = ApplicationProvider.getApplicationContext<Context>()
        val store = DirectCaptureSettingsStore(context)
        store.clear()
        store.save(DirectCaptureSettings(enabled = true, provider = CaptureAiProvider.Gemini,
            model = "fixture-model", vocabulary = "測定温度"), "process-fixture-secret")
        check(context.getSharedPreferences("direct-ai-process-fixture", Context.MODE_PRIVATE).edit()
            .putInt("pid", Process.myPid()).commit())
    }

    @Test fun reloadAfterProcessExitAndRemoveFixture() {
        assumeTrue("Requires the explicit reload phase after the save process exits",
            InstrumentationRegistry.getArguments().getString("directCaptureSettingsPhase") == "reload")
        val context = ApplicationProvider.getApplicationContext<Context>()
        val store = DirectCaptureSettingsStore(context)
        val marker = context.getSharedPreferences("direct-ai-process-fixture", Context.MODE_PRIVATE)
        try {
            assertTrue(marker.contains("pid"))
            assertNotEquals(marker.getInt("pid", -1), Process.myPid())
            assertTrue(store.settings().enabled)
            assertEquals(CaptureAiProvider.Gemini, store.settings().provider)
            assertEquals("測定温度", store.settings().vocabulary)
            assertEquals("process-fixture-secret", store.apiKey())
        } finally {
            store.clear()
            check(marker.edit().clear().commit())
        }
    }
}
