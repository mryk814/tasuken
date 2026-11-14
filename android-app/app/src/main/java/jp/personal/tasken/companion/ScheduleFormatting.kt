package jp.personal.tasken.companion

import java.time.LocalDate
import java.time.format.TextStyle
import java.util.Locale

/**
 * 予定の日付・時刻・所要時間を、読み手の言葉に直す。
 * 保存値（ISO日付・HH:mm・分）は変えず、表示と入力の補助だけを受け持つ。
 */

/** 「8月24日（月）」。今年以外は年を付け、今日・明日・昨日は語を添える。 */
internal fun scheduleDateLabel(date: LocalDate, today: LocalDate = LocalDate.now()): String {
    val weekday = date.dayOfWeek.getDisplayName(TextStyle.SHORT, Locale.JAPANESE)
    val base = buildString {
        if (date.year != today.year) append("${date.year}年")
        append("${date.monthValue}月${date.dayOfMonth}日（$weekday）")
    }
    val relative = when (date) {
        today -> "今日"
        today.plusDays(1) -> "明日"
        today.minusDays(1) -> "昨日"
        else -> null
    }
    return if (relative == null) base else "$base $relative"
}

/** 「45分」「1時間」「1時間30分」。 */
internal fun durationLabel(minutes: Int): String = when {
    minutes < 60 -> "${minutes}分"
    minutes % 60 == 0 -> "${minutes / 60}時間"
    else -> "${minutes / 60}時間${minutes % 60}分"
}

/**
 * 予定欄を閉じているときの1行。日付の形（実施日・期限・期間）に合わせて言い分ける。
 * 開始時刻はスマホから外した（#755 束9a）ので出さない。
 */
internal fun scheduleSummaryText(
    startDate: LocalDate?,
    endDate: LocalDate?,
    plannedDurationMinutes: Int?,
    today: LocalDate = LocalDate.now(),
): String {
    val dates = when {
        startDate == null && endDate == null -> null
        startDate == null -> "${scheduleDateLabel(endDate!!, today)}まで"
        endDate == null || endDate == startDate -> scheduleDateLabel(startDate, today)
        else -> "${scheduleDateLabel(startDate, today)} 〜 ${scheduleDateLabel(endDate, today)}"
    }
    val duration = plannedDurationMinutes?.let(::durationLabel)
    return listOfNotNull(dates, duration).joinToString("・").ifEmpty { "予定なし" }
}

/** 日付欄の下に出す近い候補。今日・明日・次の月曜。 */
internal fun quickScheduleDates(today: LocalDate = LocalDate.now()): List<Pair<String, LocalDate>> {
    val nextMonday = today.plusDays(((8 - today.dayOfWeek.value) % 7).let { if (it == 0) 7 else it }.toLong())
    return listOf("今日" to today, "明日" to today.plusDays(1), "来週月曜" to nextMonday)
}

/** 所要時間の候補（分）。 */
internal val quickDurations = listOf(15, 30, 60, 120)
