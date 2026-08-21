package jp.personal.tasken.companion

private val taskStateLabels = mapOf(
    "todo" to "未着手",
    "doing" to "進行中",
    "waiting" to "待ち",
    "review" to "確認待ち",
    "done" to "完了",
    "cancelled" to "中止",
)

fun taskStateLabel(state: String): String = taskStateLabels[state] ?: state
