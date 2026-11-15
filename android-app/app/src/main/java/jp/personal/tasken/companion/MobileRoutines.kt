package jp.personal.tasken.companion

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.FilledTonalButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject

/**
 * 続けること（Habit）をTodayに出すread model（#454）。
 *
 * 進み具合と目安はDesktopが導出したものをそのまま見せ、Androidでは再計算しない。
 * Habitは「今日N回・今週n/m回」だけで、連続日数や達成率は出さない。
 * 未知fieldを黙って捨てない（契約が変わったら気づけるようにする）。
 */
@Serializable
data class MobileRoutineHabitDto(
    val habitId: String,
    val title: String,
    val scheduleLabel: String,
    val todayCount: Int,
    val nextSequence: Int?,
    val weekCount: Int,
    val weekTarget: Int,
    val todayLabel: String,
    val weekLabel: String,
    val met: Boolean,
)

@Serializable
data class MobileRoutinesDataDto(
    val date: String,
    val habits: List<MobileRoutineHabitDto> = emptyList(),
    /**
     * 手入れはスマホから外した（#755 束9a）。Gateway が返さなくなる（束9b）までは届くので、
     * 未知 field として断らずに受け取り、中身は見ない。
     */
    val maintenances: List<JsonObject> = emptyList(),
) {
    val isEmpty: Boolean get() = habits.isEmpty()
}

@Serializable
data class MobileRoutinesResponseDto(
    val ok: Boolean,
    val meta: MobileAttentionMetaDto,
    val data: MobileRoutinesDataDto,
)

@Serializable
data class MobileRoutineActionDto(
    /** `RecordHabitEntry`。使わない項目は送らない。 */
    val name: String,
    val performedOn: String,
    val habitId: String? = null,
    val sequence: Int? = null,
    /**
     * `append` は「1回足す」。Desktop はその日の次の空いた回に入れ、commandId で送り直しを見分ける。
     * 圏外の間に PC でも同じ日に記録していても、端末の 1 回が同じ回にぶつかって消えない。[sequence] は端末の数えで、置き場所は Desktop が決める。
     */
    val mode: String? = null,
)

@Serializable
data class MobileRoutineActionEnvelopeDto(
    val apiVersion: Int,
    val schemaVersion: Int,
    val requestId: String,
    val commandId: String,
    val idempotencyKey: String,
    val clientDeviceId: String,
    val issuedAt: String,
    val action: MobileRoutineActionDto,
)

@Serializable
data class MobileRoutineActionDataDto(
    val commandId: String,
    val status: String,
    val nextDueOn: String? = null,
    /** 「1回足す」の受領に付く、保存後のその Habit の数（[MobileRoutineCountsDto.date] の数）。古い Desktop は付けない。 */
    val habit: MobileRoutineCountsDto? = null,
)

/** Desktop が受領で返す、保存後のその Habit の数。端末の写しはこの値で上書きし、+1 で数えない。 */
@Serializable
data class MobileRoutineCountsDto(
    val habitId: String,
    val date: String,
    val todayCount: Int,
    val weekCount: Int,
    val nextSequence: Int? = null,
)

/**
 * 端末の写しの 1 件。数（todayCount・weekCount・nextSequence）は [countsDate] の日の数として持つ。
 * 写しは Desktop から読めた日の物でも、その後に届いた記録の受領で Habit ごとに新しい日の数へ進む。
 * [uncounted] は、受領に数が無い古い Desktop に [uncountedDate] の日に届き、まだ数に入っていない記録の数。
 */
@Serializable
data class MobileRoutineCopyHabit(
    val habit: MobileRoutineHabitDto,
    val countsDate: String,
    val uncountedDate: String? = null,
    val uncounted: Int = 0,
)

/** routine_cache の payloadJson の形（このブランチで足した表で、まだ配っていない）。 */
@Serializable
data class MobileRoutinesCopyPayload(val habits: List<MobileRoutineCopyHabit>)

@Serializable
data class MobileRoutineActionResponseDto(
    val ok: Boolean,
    val meta: MobileAttentionMetaDto,
    val data: MobileRoutineActionDataDto,
)

internal const val ROUTINE_RECORD_APPEND = "append"

object MobileRoutineContract {
    private val json = Json {
        ignoreUnknownKeys = false
        isLenient = false
        coerceInputValues = false
        encodeDefaults = true
        explicitNulls = false
    }

    fun decode(body: String): MobileRoutinesResponseDto = json.decodeFromString(body)

    fun encode(envelope: MobileRoutineActionEnvelopeDto): String = json.encodeToString(envelope)

    fun decodeEnvelope(body: String): MobileRoutineActionEnvelopeDto = json.decodeFromString(body)

    /** 端末の写し（routine_cache）に置く形。手入れは画面に出さないので、写しには持たない。 */
    fun encodeCopy(data: MobileRoutinesDataDto): String =
        encodeCopy(MobileRoutinesCopyPayload(data.habits.map { MobileRoutineCopyHabit(it, countsDate = data.date) }))

    fun encodeCopy(payload: MobileRoutinesCopyPayload): String = json.encodeToString(payload)

    fun decodeCopy(body: String): MobileRoutinesCopyPayload = json.decodeFromString(body)

    fun decodeResponse(body: String): MobileRoutineActionResponseDto = json.decodeFromString(body)

    /**
     * Habitの1回記録（1回足す）。番号は端末の数え（Todayに重ねる時に使う）で、Desktopは次の空いた回に入れる。
     * 送り直しは同じ commandId なので、応答を失った再送でも記録は増えない。
     */
    fun habitAction(habit: MobileRoutineHabitDto, date: String): MobileRoutineActionDto {
        val sequence = habit.nextSequence
        require(sequence != null && sequence in 1..50) { "今日はこれ以上記録できません。" }
        return MobileRoutineActionDto(
            name = "RecordHabitEntry",
            performedOn = date,
            habitId = habit.habitId,
            sequence = sequence,
            mode = ROUTINE_RECORD_APPEND,
        )
    }
}

/** 端末に置いた、続けることの写し。[fetchedAt] は Desktop が返した時刻（いつの写しか）。 */
data class MobileRoutinesCopy(val date: String, val habits: List<MobileRoutineCopyHabit>, val fetchedAt: String) {
    /** 読めた日の一覧として見た形（数は Habit ごとの [MobileRoutineCopyHabit.countsDate] の数）。 */
    val routines: MobileRoutinesDataDto get() = MobileRoutinesDataDto(date, habits.map { it.habit })
}

/** 記録の結果。 */
sealed interface MobileRoutineActionResult {
    /** 端末の送信の列に書いた。届くまでは割印で見せ、つながったら送る。 */
    data object Queued : MobileRoutineActionResult

    /** 列に書けなかった（接続の登録が無い・権限が無い・上限）。理由を見せる。 */
    data class Failed(val message: String) : MobileRoutineActionResult
}

/**
 * Todayの「続けること」。1件もなければ何も出さない。
 * 記録は端末の送信の列に先に書き、押した時点で数に足す。届くまでは行の右の端に割印、断られた記録があれば「戻」。
 */
@Composable
internal fun TodayRoutinesSection(
    routines: TodayRoutines,
    savingId: String?,
    onRecordHabit: (MobileRoutineHabitDto) -> Unit,
) {
    if (routines.isEmpty) return
    Column(Modifier.fillMaxWidth().padding(top = 8.dp).testTag("today-routines")) {
        Row(Modifier.fillMaxWidth().heightIn(min = 48.dp), verticalAlignment = Alignment.CenterVertically) {
            Text("続けること", style = MaterialTheme.typography.titleMedium, modifier = Modifier.weight(1f).padding(vertical = 12.dp))
            // Desktop から読めず、端末の写しを見せている時だけ、いつの写しかを日付印で示す（Today の見出しと同じ印）。
            parseInstantOrNull(routines.copyAt)?.let { at ->
                Text(
                    stampAgeLabel(at),
                    style = MaterialTheme.typography.labelLarge,
                    fontWeight = FontWeight.SemiBold,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                    modifier = Modifier.padding(end = 8.dp),
                )
                OflStamp("写し", at, modifier = Modifier.testTag("today-routines-copy-stamp"), scale = 0.8f)
            }
        }
        routines.habits.forEach { item ->
            val habit = item.habit
            RoutineRow(
                title = habit.title,
                // 前の日の写しでは今日の数が分からないので、数の代わりに電波なしの絵を置く（つながると分かる）。
                detail = if (item.countsKnown) "${habit.scheduleLabel} · ${habit.todayLabel} · ${habit.weekLabel}" else habit.scheduleLabel,
                countsUnknown = !item.countsKnown,
                addedToday = item.unsent + item.uncounted,
                actionLabel = "1回記録",
                actionDescription = "${habit.title}を1回記録",
                enabled = savingId == null && habit.nextSequence != null,
                unsent = item.unsent,
                returned = item.returned > 0,
                onAction = { onRecordHabit(habit) },
                tag = "routine-habit-${habit.habitId}",
            )
        }
    }
}

@Composable
private fun RoutineRow(
    title: String,
    detail: String,
    countsUnknown: Boolean,
    /** 数が分からない時に「+N」で見せる、今日押した記録（未送信と、古い Desktop に届いてまだ数に入っていない物）。 */
    addedToday: Int,
    actionLabel: String,
    actionDescription: String,
    enabled: Boolean,
    unsent: Int,
    returned: Boolean,
    onAction: () -> Unit,
    tag: String,
) {
    Box(Modifier.fillMaxWidth().testTag(tag)) {
        Row(
            // 割印を付ける行は、右に 20dp の余白を取り、字や押す所と重ねない（Todayの Task の行と同じ）。
            Modifier.fillMaxWidth().heightIn(min = 56.dp).padding(end = if (unsent > 0) 20.dp else 0.dp, top = 4.dp, bottom = 4.dp),
            horizontalArrangement = Arrangement.spacedBy(12.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(2.dp)) {
                Text(title, style = MaterialTheme.typography.bodyLarge, maxLines = 2, overflow = TextOverflow.Ellipsis)
                Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                    Text(
                        detail,
                        style = MaterialTheme.typography.labelMedium,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                    if (countsUnknown) {
                        // 今日の数の場所に電波なしの絵。押した分だけ「+N」を添える（届くまでは割印も付く）。
                        OflNowave(Modifier.testTag("$tag-counts-unknown"), description = "今日の数はつながると分かります")
                        if (addedToday > 0) {
                            Text(
                                "+$addedToday",
                                style = MaterialTheme.typography.labelLarge.copy(fontFeatureSettings = "tnum"),
                                fontWeight = FontWeight.ExtraBold,
                                color = MaterialTheme.colorScheme.onSurface,
                            )
                        }
                    }
                }
            }
            if (returned) OflModo(Modifier.testTag("$tag-returned"))
            FilledTonalButton(
                onClick = onAction,
                enabled = enabled,
                modifier = Modifier.heightIn(min = 48.dp).semantics { contentDescription = actionDescription },
            ) { Text(actionLabel) }
        }
        if (unsent > 0) {
            OflWariEdge(
                Modifier.align(Alignment.CenterEnd).testTag("$tag-unsent"),
                description = "未送信 $unsent",
            )
        }
    }
}
