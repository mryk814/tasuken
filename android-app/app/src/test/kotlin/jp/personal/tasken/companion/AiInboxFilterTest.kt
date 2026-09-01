package jp.personal.tasken.companion

import org.junit.Assert.assertEquals
import org.junit.Test

class AiInboxFilterTest {
    @Test
    fun groupsCanonicalAndLegacyAiWorkStates() {
        val tasks = listOf(
            task("ready", "ready_for_agent"),
            task("working", "in_progress"),
            task("review", "needs_human_review"),
            task("reported", "reported_done"),
            task("blocked", "blocked"),
            task("done", "accepted"),
            task("plain", "not_delegated"),
            task("legacy-working", "working"),
        )

        val sections = filterAiInboxTasks(tasks)

        assertEquals(
            listOf(
                AiInboxSection.InProgress to listOf("working", "legacy-working"),
                AiInboxSection.NeedsReview to listOf("review", "reported"),
                AiInboxSection.Blocked to listOf("blocked"),
                AiInboxSection.RecentlyAccepted to listOf("done"),
            ),
            sections.map { it.first to it.second.map(MobileTask::id) },
        )
    }

    @Test
    fun emptyWhenNoAiRelatedWorkState() {
        assertEquals(emptyList<Pair<AiInboxSection, List<MobileTask>>>(), filterAiInboxTasks(listOf(task("plain", null))))
    }

    private fun task(id: String, workState: String?) = MobileTask(
        id = id,
        title = id,
        themeId = null,
        state = "todo",
        workState = workState,
        updatedAt = "2026-08-22T00:00:00Z",
    )
}
