package jp.personal.tasken.companion

import kotlinx.serialization.json.Json
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive

private val unfinishedStates = setOf(OutboxState.Pending, OutboxState.Sending, OutboxState.RetryWait)
private val sendableStates = setOf(OutboxState.Pending, OutboxState.RetryWait)

/**
 * Picks the next command to send from the unfinished outbox, so one command the Desktop keeps refusing
 * to settle does not hold back unrelated ones (#761).
 *
 * Order matters only between commands on the same target: the Desktop checks expectedVersion, so a later
 * edit of the same Task sent first would apply on the old version and turn the earlier one into a version
 * conflict. Later edits normally wait through dependsOnCommandId; the same-target check below keeps that
 * true even for a root command whose older sibling is still unsettled. A work log naming a Task waits for
 * that Task's unsent CreateTask, because the Desktop records the link even when the Task is not there yet.
 *
 * Among commands free to go, the least recently tried goes first: never-tried commands keep creation
 * order, and a command that failed last time no longer opens every round.
 */
internal fun nextSendableCommand(
    unfinished: List<OutboxCommandEntity>,
    serverId: String,
    skipped: Set<String> = emptySet(),
): OutboxCommandEntity? {
    val open = unfinished.filter { it.state in unfinishedStates }
    val byId = open.associateBy(OutboxCommandEntity::commandId)
    // Commands are compared by the head of their dependsOn chain: createdAt can tie (one clock reading for
    // several edits), and a dependent must never be counted as earlier than the command it waits for.
    val heads = HashMap<String, OutboxCommandEntity>(open.size)
    fun head(command: OutboxCommandEntity): OutboxCommandEntity = heads.getOrPut(command.commandId) {
        var current = command
        val seen = mutableSetOf(current.commandId)
        while (true) {
            val parent = current.dependsOnCommandId?.let(byId::get) ?: break
            if (!seen.add(parent.commandId)) break
            current = parent
        }
        current
    }
    val order = compareBy(OutboxCommandEntity::createdAt, OutboxCommandEntity::commandId)
    // For each target, the chains still touching it, by their heads. A head still waiting on a settled
    // parent can never be sent, so it holds nothing back.
    val headsByTarget = HashMap<String, MutableSet<OutboxCommandEntity>>()
    open.forEach { command ->
        val commandHead = head(command)
        if (commandHead.dependsOnCommandId == null) {
            command.targets().forEach { headsByTarget.getOrPut(it) { mutableSetOf() } += commandHead }
        }
    }
    val earliestHeadsByTarget = headsByTarget.mapValues { (_, value) -> value.sortedWith(order).take(2) }
    val tasksBeingCreated = open.filter { it.commandName == "CreateTask" }.mapNotNullTo(HashSet()) { it.taskId }

    fun heldBack(command: OutboxCommandEntity): Boolean {
        val earlierOnSameTarget = command.targets().any { target ->
            earliestHeadsByTarget[target].orEmpty().firstOrNull { it.commandId != command.commandId }
                ?.let { order.compare(it, command) < 0 } == true
        }
        // A work log naming a Task waits for that Task's unsent CreateTask whatever the times say: its
        // createdAt is the draft's enteredAt, which can be older than a Task picked later from a restored draft.
        return earlierOnSameTarget ||
            (command.commandName == "RecordWorkLog" && command.referencedTaskId() in tasksBeingCreated)
    }

    return open.filter { command ->
        command.serverId == serverId && command.state in sendableStates && command.dependsOnCommandId == null &&
            command.commandId !in skipped && !heldBack(command)
    }.minWithOrNull(
        compareBy<OutboxCommandEntity, String?>(nullsFirst()) { it.lastAttemptAt }
            .thenBy { it.createdAt }
            .thenBy { it.commandId },
    )
}

private fun OutboxCommandEntity.targets(): List<String> = listOfNotNull(
    taskId?.let { "task:$it" },
    captureId?.let { "capture:$it" },
    workLogId?.let { "workLog:$it" },
)

private fun OutboxCommandEntity.referencedTaskId(): String? = runCatching {
    Json.parseToJsonElement(envelopeJson).jsonObject["command"]?.jsonObject?.get("taskId")?.jsonPrimitive?.contentOrNull
}.getOrNull()
