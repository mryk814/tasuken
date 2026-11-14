package jp.personal.tasken.companion

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class MobileOutboxOrderTest {
    private fun command(
        id: String,
        createdAt: String,
        state: String = OutboxState.Pending,
        taskId: String? = null,
        captureId: String? = null,
        workLogId: String? = null,
        commandName: String = "UpdateTask",
        lastAttemptAt: String? = null,
        dependsOn: String? = null,
        serverId: String = "server-1",
        envelopeJson: String = "",
    ) = OutboxCommandEntity(
        commandId = id, idempotencyKey = id, requestId = "request-$id", clientDeviceId = "device",
        issuedAt = createdAt, commandName = commandName, envelopeJson = envelopeJson, serverId = serverId,
        state = state, attemptCount = if (lastAttemptAt == null) 0 else 1, createdAt = createdAt,
        lastAttemptAt = lastAttemptAt, lastError = null, taskId = taskId, captureId = captureId,
        dependsOnCommandId = dependsOn, workLogId = workLogId,
    )

    @Test
    fun `an unrelated command goes past one set aside this round`() {
        val failing = command("a", "2026-08-22T01:00:01Z", taskId = "task-a")
        val other = command("b", "2026-08-22T01:00:02Z", taskId = "task-b")

        assertEquals(failing, nextSendableCommand(listOf(other, failing), "server-1"))
        assertEquals(other, nextSendableCommand(listOf(other, failing), "server-1", skipped = setOf("a")))
    }

    @Test
    fun `a later command on the same target never overtakes an unsettled earlier one`() {
        val earlier = command("a", "2026-08-22T01:00:01Z", state = OutboxState.RetryWait, taskId = "task-a",
            lastAttemptAt = "2026-08-22T01:01:00Z")
        val laterRoot = command("a2", "2026-08-22T01:00:02Z", taskId = "task-a")
        val sending = command("c", "2026-08-22T01:00:01Z", state = OutboxState.Sending, captureId = "capture-1")
        val laterCapture = command("c2", "2026-08-22T01:00:02Z", captureId = "capture-1", commandName = "DeleteCapture")
        val record = command("w", "2026-08-22T01:00:01Z", state = OutboxState.RetryWait, workLogId = "note-1",
            commandName = "RecordWorkLog", lastAttemptAt = "2026-08-22T01:01:00Z")
        val laterWorkLog = command("w2", "2026-08-22T01:00:02Z", workLogId = "note-1", commandName = "DeleteWorkLog")

        assertNull(nextSendableCommand(listOf(earlier, laterRoot), "server-1", skipped = setOf("a")))
        assertNull(nextSendableCommand(listOf(sending, laterCapture), "server-1"))
        assertNull(nextSendableCommand(listOf(record, laterWorkLog), "server-1", skipped = setOf("w")))
    }

    @Test
    fun `a dependent created in the same instant never holds back the command it waits for`() {
        // One clock reading for several edits: commandId alone would put the child first.
        val root = command("z-root", "2026-09-06T00:00:00Z", taskId = "task-a")
        val child = command("a-child", "2026-09-06T00:00:00Z", taskId = "task-a", dependsOn = "z-root")
        val grandchild = command("0-grandchild", "2026-09-06T00:00:00Z", taskId = "task-a", dependsOn = "a-child")

        assertEquals(root, nextSendableCommand(listOf(grandchild, child, root), "server-1"))
    }

    @Test
    fun `a dependent whose parent was settled holds nothing back`() {
        val dangling = command("a-dangling", "2026-08-22T01:00:01Z", taskId = "task-a", dependsOn = "rejected-parent")
        val root = command("b-root", "2026-08-22T01:00:02Z", taskId = "task-a")

        assertEquals(root, nextSendableCommand(listOf(dangling, root), "server-1"))
    }

    @Test
    fun `a settled earlier command no longer holds the same target`() {
        val rejected = command("a", "2026-08-22T01:00:01Z", state = OutboxState.Rejected, taskId = "task-a")
        val later = command("a2", "2026-08-22T01:00:02Z", taskId = "task-a")

        assertEquals(later, nextSendableCommand(listOf(rejected, later), "server-1"))
    }

    @Test
    fun `a work log naming a Task waits for that Task's unsent creation`() {
        val create = command("create", "2026-08-22T01:00:01Z", state = OutboxState.RetryWait, taskId = "task-new",
            commandName = "CreateTask", lastAttemptAt = "2026-08-22T01:01:00Z")
        val workLog = command("log", "2026-08-22T01:00:02Z", workLogId = "note-1", commandName = "RecordWorkLog",
            envelopeJson = """{"commandId":"log","command":{"name":"RecordWorkLog","body":"x","taskId":"task-new"}}""")
        val unrelated = command("log2", "2026-08-22T01:00:03Z", workLogId = "note-2", commandName = "RecordWorkLog",
            envelopeJson = """{"commandId":"log2","command":{"name":"RecordWorkLog","body":"y","taskId":null}}""")

        assertEquals(unrelated, nextSendableCommand(listOf(create, workLog, unrelated), "server-1", skipped = setOf("create")))
        assertNull(nextSendableCommand(listOf(create, workLog), "server-1", skipped = setOf("create")))
    }

    @Test
    fun `never tried commands keep creation order and the least recently tried comes next`() {
        val triedLate = command("a", "2026-08-22T01:00:01Z", state = OutboxState.RetryWait, taskId = "task-a",
            lastAttemptAt = "2026-08-22T01:05:00Z")
        val triedEarly = command("b", "2026-08-22T01:00:02Z", state = OutboxState.RetryWait, taskId = "task-b",
            lastAttemptAt = "2026-08-22T01:03:00Z")
        val fresh2 = command("d", "2026-08-22T01:00:04Z", taskId = "task-d")
        val fresh1 = command("c", "2026-08-22T01:00:03Z", taskId = "task-c")
        val all = listOf(triedLate, triedEarly, fresh2, fresh1)

        assertEquals(fresh1, nextSendableCommand(all, "server-1"))
        assertEquals(fresh2, nextSendableCommand(all, "server-1", skipped = setOf("c")))
        assertEquals(triedEarly, nextSendableCommand(all, "server-1", skipped = setOf("c", "d")))
    }

    @Test
    fun `dependents and commands of another Desktop are not sent`() {
        val dependent = command("a2", "2026-08-22T01:00:02Z", taskId = "task-a", dependsOn = "gone")
        val otherServer = command("b", "2026-08-22T01:00:01Z", taskId = "task-b", serverId = "server-2")

        assertNull(nextSendableCommand(listOf(dependent, otherServer), "server-1"))
    }
}
