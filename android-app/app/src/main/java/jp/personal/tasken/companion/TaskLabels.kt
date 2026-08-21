package jp.personal.tasken.companion

private val taskStateLabels = mapOf(
    "todo" to "未着手",
    "doing" to "進行中",
    "waiting" to "待ち",
    "review" to "確認待ち",
    "done" to "完了",
    "cancelled" to "中止",
)

private val taskWorkStateLabels = mapOf(
    "not_delegated" to "未委任",
    "delegated" to "委任済み",
    "working" to "作業中",
    "blocked" to "停止中",
    "needs_review" to "確認待ち",
    "completed" to "完了",
)

fun taskStateLabel(state: String): String = taskStateLabels[state] ?: state

fun taskWorkStateLabel(state: String): String = taskWorkStateLabels[state] ?: state
