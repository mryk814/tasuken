package jp.personal.tasken.companion

import androidx.compose.foundation.layout.Arrangement
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
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.Json

/**
 * 続けること（Habit）と手入れ（Maintenance）をTodayに出すread model（#454）。
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
    val weekCount: Int,
    val weekTarget: Int,
    val todayLabel: String,
    val weekLabel: String,
    val met: Boolean,
)

@Serializable
data class MobileRoutineMaintenanceDto(
    val maintenanceId: String,
    val label: String,
    /** `due_soon`（7日以内）または `overdue`（目安を過ぎた）。目安の超過はTaskの期限違反ではない。 */
    val state: String,
    val dueLabel: String,
    val nextDueOn: String,
    val lastPerformedOn: String? = null,
    val intervalDays: Int? = null,
) {
    val overdue: Boolean get() = state == "overdue"
}

@Serializable
data class MobileRoutinesDataDto(
    val date: String,
    val habits: List<MobileRoutineHabitDto> = emptyList(),
    val maintenances: List<MobileRoutineMaintenanceDto> = emptyList(),
) {
    val isEmpty: Boolean get() = habits.isEmpty() && maintenances.isEmpty()
}

@Serializable
data class MobileRoutinesResponseDto(
    val ok: Boolean,
    val meta: MobileAttentionMetaDto,
    val data: MobileRoutinesDataDto,
)

@Serializable
data class MobileRoutineActionDto(
    /** `RecordHabitEntry` または `RecordMaintenance`。使わない項目は送らない。 */
    val name: String,
    val performedOn: String,
    val habitId: String? = null,
    val sequence: Int? = null,
    val maintenanceId: String? = null,
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
data class MobileRoutineActionDataDto(val commandId: String, val status: String, val nextDueOn: String? = null)

@Serializable
data class MobileRoutineActionResponseDto(
    val ok: Boolean,
    val meta: MobileAttentionMetaDto,
    val data: MobileRoutineActionDataDto,
)

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

    fun decodeResponse(body: String): MobileRoutineActionResponseDto = json.decodeFromString(body)

    /**
     * Habitの1回記録。その日の何回目かを読み出し結果（todayCount+1）から決める。
     * Desktopは同じ日・同じ回を同じIDで保存するので、応答を失った再送でも記録は増えない。
     */
    fun habitAction(habit: MobileRoutineHabitDto, date: String): MobileRoutineActionDto {
        val sequence = habit.todayCount + 1
        require(sequence in 1..50) { "今日はこれ以上記録できません。" }
        return MobileRoutineActionDto(
            name = "RecordHabitEntry",
            performedOn = date,
            habitId = habit.habitId,
            sequence = sequence,
        )
    }

    fun maintenanceAction(item: MobileRoutineMaintenanceDto, date: String): MobileRoutineActionDto =
        MobileRoutineActionDto(name = "RecordMaintenance", performedOn = date, maintenanceId = item.maintenanceId)
}

/** 記録の結果。 */
sealed interface MobileRoutineActionResult {
    /** Desktopへ保存した（同じ回の再送で変化がなかった場合を含む）。 */
    data class Saved(val message: String) : MobileRoutineActionResult

    /** 保存できなかった。理由を見せる。 */
    data class Failed(val message: String) : MobileRoutineActionResult
}

/**
 * Todayの「続けること」「手入れ」。どちらも1件もなければ何も出さない。
 * 記録はDesktopへ直接送る（接続できないときは記録しない）。
 */
@Composable
internal fun TodayRoutinesSection(
    routines: MobileRoutinesDataDto,
    savingId: String?,
    onRecordHabit: (MobileRoutineHabitDto) -> Unit,
    onRecordMaintenance: (MobileRoutineMaintenanceDto) -> Unit,
) {
    if (routines.isEmpty) return
    Column(Modifier.fillMaxWidth().padding(top = 8.dp).testTag("today-routines")) {
        if (routines.habits.isNotEmpty()) {
            Text("続けること", style = MaterialTheme.typography.titleMedium, modifier = Modifier.padding(vertical = 12.dp))
            routines.habits.forEach { habit ->
                RoutineRow(
                    title = habit.title,
                    detail = "${habit.scheduleLabel} · ${habit.todayLabel} · ${habit.weekLabel}",
                    detailEmphasis = false,
                    actionLabel = "1回記録",
                    actionDescription = "${habit.title}を1回記録",
                    enabled = savingId == null && habit.todayCount < 50,
                    onAction = { onRecordHabit(habit) },
                    tag = "routine-habit-${habit.habitId}",
                )
            }
        }
        if (routines.maintenances.isNotEmpty()) {
            Text("手入れ", style = MaterialTheme.typography.titleMedium, modifier = Modifier.padding(vertical = 12.dp))
            routines.maintenances.forEach { item ->
                RoutineRow(
                    title = item.label,
                    detail = item.dueLabel,
                    detailEmphasis = item.overdue,
                    actionLabel = "やった",
                    actionDescription = "${item.label}をやったと記録",
                    enabled = savingId == null,
                    onAction = { onRecordMaintenance(item) },
                    tag = "routine-maintenance-${item.maintenanceId}",
                )
            }
        }
    }
}

@Composable
private fun RoutineRow(
    title: String,
    detail: String,
    detailEmphasis: Boolean,
    actionLabel: String,
    actionDescription: String,
    enabled: Boolean,
    onAction: () -> Unit,
    tag: String,
) {
    Row(
        Modifier.fillMaxWidth().heightIn(min = 56.dp).padding(vertical = 4.dp).testTag(tag),
        horizontalArrangement = Arrangement.spacedBy(12.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(2.dp)) {
            Text(title, style = MaterialTheme.typography.bodyLarge, maxLines = 2, overflow = TextOverflow.Ellipsis)
            Text(
                detail,
                style = MaterialTheme.typography.labelMedium,
                color = if (detailEmphasis) MaterialTheme.colorScheme.error else MaterialTheme.colorScheme.onSurfaceVariant,
            )
        }
        FilledTonalButton(
            onClick = onAction,
            enabled = enabled,
            modifier = Modifier.heightIn(min = 48.dp).semantics { contentDescription = actionDescription },
        ) { Text(actionLabel) }
    }
}
