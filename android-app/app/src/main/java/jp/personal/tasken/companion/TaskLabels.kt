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
    "ready_for_agent" to "AI Ready",
    "in_progress" to "作業中",
    "reported_done" to "報告済み",
    "needs_human_review" to "確認待ち",
    "accepted" to "確認済み",
    "blocked" to "停止中",
    "failed" to "失敗",
    "delegated" to "委任済み",
    "working" to "作業中",
    "needs_review" to "確認待ち",
    "completed" to "確認済み",
)

fun taskStateLabel(state: String): String = taskStateLabels[state] ?: state

fun taskWorkStateLabel(state: String): String = taskWorkStateLabels[state] ?: state

fun taskScheduleFilterLabel(filter: TaskScheduleFilter): String = when (filter) {
    TaskScheduleFilter.All -> "予定すべて"
    TaskScheduleFilter.Today -> "今日"
    TaskScheduleFilter.Upcoming -> "これから"
    TaskScheduleFilter.Unscheduled -> "予定なし"
}

fun taskThemeFilterLabel(themeId: String?, themes: List<MobileTheme>): String = when (themeId) {
    null -> "Themeすべて"
    "" -> "Theme未指定"
    else -> themes.firstOrNull { it.id == themeId }?.title ?: "選択中のTheme"
}

fun taskTodayDateLabel(value: String?, today: String = java.time.LocalDate.now().toString()): String = when (value) {
    null -> "未設定"
    today -> "今日"
    else -> value
}
