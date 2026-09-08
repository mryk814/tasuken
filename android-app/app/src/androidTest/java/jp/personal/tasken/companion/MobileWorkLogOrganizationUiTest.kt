package jp.personal.tasken.companion

import android.graphics.Bitmap
import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.v2.createComposeRule
import androidx.test.platform.app.InstrumentationRegistry
import java.io.File
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.CompletableDeferred
import org.junit.Assert.*
import org.junit.Rule
import org.junit.Test

class MobileWorkLogOrganizationUiTest {
    @get:Rule val compose = createComposeRule()
    private val raw = "条件Aで試したが失敗した。原因は温度が怪しい。次は条件Bを調べる。"
    private val source = WorkLogCacheEntity("source", "fixture", 1, raw, "2026-09-06", "2026-09-06T00:00:00Z", null, null, false, false, null)

    @Test fun loadingCanBeDiscardedWithoutAdoptingLateResult() {
        val repository = Fixture(); repository.hold = CompletableDeferred()
        content(repository)
        compose.onNodeWithTag("work-log-organize").performScrollTo().performClick()
        compose.waitUntil { repository.items.value.organization?.state == "generating" }
        compose.onNodeWithText("この整理を取り消す").performScrollTo().assertIsDisplayed()
        screenshot("loading")
        compose.onNodeWithText("この整理を取り消す").performClick()
        compose.waitUntil { repository.items.value.organization?.state == "discarded" }
        repository.hold!!.complete(Unit)
        compose.waitForIdle()
        compose.onNodeWithTag("work-log-adopt").assertDoesNotExist()
        assertEquals(raw, repository.items.value.record.body)
    }

    @Test fun proposalKeepsOriginalAndRequiresSeparateTaskAction() {
        val repository = Fixture()
        content(repository)
        compose.onNodeWithTag("work-log-organize").performScrollTo().performClick()
        compose.waitUntil { repository.items.value.organization?.state == "proposal" }
        compose.onNodeWithTag("work-log-adopt").performScrollTo().assertIsDisplayed()
        screenshot("proposal")
        assertEquals(raw, repository.items.value.record.body)
        assertEquals(0, repository.taskCreates)
        compose.onNodeWithTag("work-log-adopt").performClick()
        compose.waitUntil { repository.items.value.organization?.state == "adopted" }
        compose.onNodeWithTag("work-log-task-0").performScrollTo().assertIsDisplayed()
        screenshot("adopted-task-choice")
        assertEquals(0, repository.taskCreates)
        compose.onNodeWithTag("work-log-task-0").performClick()
        compose.waitUntil { repository.taskCreates == 1 }
        compose.onNodeWithTag("work-log-task-0").assertIsNotEnabled()
    }

    @Test fun errorAndDiscardKeepSourceAndZeroTaskAdoptionIsComplete() {
        val repository = Fixture(); repository.fail = true
        content(repository)
        compose.onNodeWithTag("work-log-organize").performScrollTo().performClick()
        compose.waitUntil { compose.onAllNodesWithText("fixture整理失敗・原文は保存済み").fetchSemanticsNodes().isNotEmpty() }
        compose.onNodeWithText("fixture整理失敗・原文は保存済み").assertExists()
        screenshot("error")
        repository.fail = false; repository.noTasks = true
        compose.onNodeWithTag("work-log-organize").performClick()
        compose.waitUntil { repository.items.value.organization?.state == "proposal" }
        compose.onNodeWithText("整理案を破棄").performScrollTo().performClick()
        compose.waitUntil { repository.items.value.organization?.state == "discarded" }
        assertEquals(raw, repository.items.value.record.body)
        compose.onNodeWithTag("work-log-organize").performScrollTo().performClick()
        compose.waitUntil { repository.items.value.organization?.state == "proposal" }
        compose.onNodeWithTag("work-log-adopt").performScrollTo().performClick()
        compose.waitUntil { repository.items.value.organization?.state == "adopted" }
        compose.onNodeWithText("明示された次の行動はありません。Taskの追加は不要です。").performScrollTo().assertIsDisplayed()
        screenshot("adopted-no-tasks")
        assertEquals(0, repository.taskCreates)
    }

    private fun content(repository: Fixture) = compose.setContent {
        TaskenTheme { MobileWorkLogSheet(repository, emptyList(), emptyList(), initialRecordId = source.id, onDismiss = {}) }
    }
    private inner class Fixture : MobileWorkLogOrganizationRepository, MobileWorkLogRepository {
        val items = MutableStateFlow(MobileWorkLog(source, null))
        @Volatile var taskCreates = 0
        @Volatile var fail = false
        @Volatile var noTasks = false
        var hold: CompletableDeferred<Unit>? = null
        override fun observeWorkLogs() = items.map { listOf(it) }
        override suspend fun recordWorkLog(draft: MobileWorkLogDraft): String = error("unused")
        override suspend fun deleteWorkLog(id: String) = Unit
        override suspend fun restoreWorkLog(id: String) = Unit
        override suspend fun retryWorkLog(id: String) = Unit
        override suspend fun refreshWorkLog(id: String) = Unit
        override suspend fun organizeWorkLog(id: String) {
            if (fail) error("fixture整理失敗・原文は保存済み")
            if (hold != null) {
                items.value = items.value.copy(organization = WorkLogOrganizationEntity(id, "fixture", 1, "proposal", source.enteredAt, "generating", null))
                hold!!.await()
                if (items.value.organization?.state == "discarded") return
            }
            val proposal = MobileWorkLogOrganization(listOf("条件Aで試したが失敗した。"), emptyList(), listOf("原因は温度が怪しい。"), if (noTasks) emptyList() else listOf("次は条件Bを調べる。"))
            items.value = items.value.copy(organization = WorkLogOrganizationEntity(id, "fixture", 1, "proposal", source.enteredAt, "proposal", MobileWorkLogContract.json.encodeToString(proposal)))
        }
        override suspend fun discardWorkLogOrganization(id: String) { items.value = items.value.copy(organization = items.value.organization!!.copy(state = "discarded")) }
        override suspend fun adoptWorkLogOrganization(id: String) { items.value = items.value.copy(organization = items.value.organization!!.copy(state = "adopted")) }
        override suspend fun createWorkLogNextAction(id: String, index: Int) {
            taskCreates++; items.value = items.value.copy(organization = items.value.organization!!.copy(createdTaskIndices = index.toString()))
        }
    }
    private fun screenshot(name: String) {
        compose.waitForIdle()
        val instrumentation = InstrumentationRegistry.getInstrumentation()
        val form = InstrumentationRegistry.getArguments().getString("workLogForm", "compact")
        val directory = File(instrumentation.targetContext.getExternalFilesDir(null), "work-log-557").apply { mkdirs() }
        val bitmap = requireNotNull(instrumentation.uiAutomation.takeScreenshot())
        File(directory, "$form-$name.png").outputStream().use { check(bitmap.compress(Bitmap.CompressFormat.PNG, 100, it)) }
        bitmap.recycle()
    }
}
