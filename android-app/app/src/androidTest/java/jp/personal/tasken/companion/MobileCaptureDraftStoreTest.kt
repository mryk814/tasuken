package jp.personal.tasken.companion

import android.content.Context
import androidx.test.core.app.ApplicationProvider
import androidx.test.ext.junit.runners.AndroidJUnit4
import java.time.Instant
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith

@RunWith(AndroidJUnit4::class)
class MobileCaptureDraftStoreTest {
    private lateinit var context: Context

    @Before
    fun setUp() {
        context = ApplicationProvider.getApplicationContext()
        MobileCaptureDraftStore(context).clear()
        MobileCaptureDraftStore(context).clearUndoTarget()
    }

    @After
    fun tearDown() {
        MobileCaptureDraftStore(context).clear()
        MobileCaptureDraftStore(context).clearUndoTarget()
    }

    @Test
    fun restoresFullShareDraftAfterProcessRestart() {
        val savedAt = Instant.parse("2026-08-24T10:00:00Z")
        val draft = MobileCaptureDraft(
            draftId = "draft-share-url",
            text = "https://example.com/input-recovery",
            kind = MobileCaptureKind.Capture,
            projectId = "theme-mobile",
            source = MobileCaptureSource.ShareTarget,
            speech = null,
            share = MobileShareProvenance("text/plain"),
            createdAt = "2026-08-24T09:59:00Z",
        )
        MobileCaptureDraftStore(context, now = { savedAt }).save(
            MobileCaptureDraftSnapshot(draft = draft, captureOpen = true),
        )

        val restored = MobileCaptureDraftStore(
            context,
            now = { Instant.parse("2026-08-24T10:01:00Z") },
        ).load()

        assertEquals(MobileCaptureDraftSnapshot(draft = draft, captureOpen = true), restored)
    }

    @Test
    fun removesDraftAfterExplicitReset() {
        val now = Instant.parse("2026-08-24T10:00:00Z")
        val store = MobileCaptureDraftStore(context, now = { now })
        store.save(
            MobileCaptureDraftSnapshot(
                draft = MobileCaptureDraft.fresh(text = "消すDraft", now = { now }, newId = { "draft-reset" }),
                captureOpen = true,
            ),
        )

        store.save(
            MobileCaptureDraftSnapshot(
                draft = MobileCaptureDraft.fresh(now = { now }, newId = { "draft-empty" }),
                captureOpen = false,
            ),
        )

        assertNull(store.load())
    }

    @Test
    fun expiresAbandonedDraftAfterSevenDays() {
        val savedAt = Instant.parse("2026-08-01T10:00:00Z")
        MobileCaptureDraftStore(context, now = { savedAt }).save(
            MobileCaptureDraftSnapshot(
                draft = MobileCaptureDraft.fresh(
                    text = "期限切れDraft",
                    now = { savedAt },
                    newId = { "draft-expired" },
                ),
                captureOpen = true,
            ),
        )

        val restored = MobileCaptureDraftStore(
            context,
            now = { Instant.parse("2026-08-08T10:00:01Z") },
        ).load()

        assertNull(restored)
    }

    @Test
    fun restoresUndoTargetAfterProcessRestart() {
        val savedAt = Instant.parse("2026-08-24T10:00:00Z")
        val target = MobileCaptureUndoTarget(
            entityId = "capture-restart-target",
            kind = MobileCaptureKind.Capture,
        )
        MobileCaptureDraftStore(context, now = { savedAt }).saveUndoTarget(target)

        val restored = MobileCaptureDraftStore(
            context,
            now = { Instant.parse("2026-08-24T10:01:00Z") },
        ).loadUndoTarget()

        assertEquals(target, restored)
    }

    @Test
    fun expiresUndoTargetAfterOneDay() {
        val savedAt = Instant.parse("2026-08-01T10:00:00Z")
        MobileCaptureDraftStore(context, now = { savedAt }).saveUndoTarget(
            MobileCaptureUndoTarget(
                entityId = "task-expired-target",
                kind = MobileCaptureKind.Task,
            ),
        )

        val restored = MobileCaptureDraftStore(
            context,
            now = { Instant.parse("2026-08-02T10:00:01Z") },
        ).loadUndoTarget()

        assertNull(restored)
    }
}
