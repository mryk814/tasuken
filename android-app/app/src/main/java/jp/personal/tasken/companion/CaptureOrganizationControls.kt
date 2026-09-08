package jp.personal.tasken.companion

import androidx.compose.foundation.layout.*
import androidx.compose.foundation.text.selection.SelectionContainer
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.unit.dp
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Job
import kotlinx.coroutines.launch

/** The organizer only edits a local proposal. The existing Add action is the save confirmation. */
@Composable
internal fun CaptureOrganizationControls(
    draft: MobileCaptureDraft,
    speechState: ShortSpeechUiState,
    enabled: Boolean,
    themes: List<MobileTheme>,
    themeCatalogState: MobileThemeCatalogState,
    organize: suspend (MobileCaptureDraft) -> List<MobileCaptureOrganization>,
    onChange: (List<MobileCaptureOrganization>) -> Unit,
    onRestoreOriginal: () -> Unit,
    onBusyChange: (Boolean) -> Unit,
) {
    val scope = rememberCoroutineScope()
    val context = LocalContext.current
    val directStore = remember(context) { DirectCaptureSettingsStore(context) }
    var directSettings by remember { mutableStateOf(directStore.settings()) }
    val currentDraft by rememberUpdatedState(draft)
    val currentBusyChange by rememberUpdatedState(onBusyChange)
    var pending by remember { mutableStateOf<Job?>(null) }
    var requestNumber by remember { mutableIntStateOf(0) }
    var error by remember(draft.draftId) { mutableStateOf<String?>(null) }
    var autoOrganize by rememberSaveable { mutableStateOf(true) }
    var originalOpen by rememberSaveable(draft.draftId) { mutableStateOf(false) }
    DisposableEffect(Unit) {
        onDispose {
            requestNumber++
            pending?.cancel()
            currentBusyChange(false)
        }
    }
    fun start() {
        val requested = draft
        val request = ++requestNumber
        pending?.cancel()
        error = null
        onBusyChange(true)
        pending = scope.launch {
            try {
                val proposals = organize(requested)
                require(proposals.isNotEmpty() && proposals.size <= 8)
                proposals.forEach(MobileCaptureOrganization::validate)
                if (request == requestNumber && currentDraft == requested) onChange(proposals)
            } catch (cancelled: CancellationException) {
                throw cancelled
            } catch (_: Exception) {
                if (request == requestNumber && currentDraft == requested) error =
                    if (directSettings.enabled) DIRECT_CAPTURE_FAILURE
                    else "AI整理を利用できません。Desktopの設定・接続を確認して再試行してください。通常の追加も使えます。"
            } finally { if (request == requestNumber) { pending = null; onBusyChange(false) } }
        }
    }
    LaunchedEffect(speechState) {
        if (autoOrganize && speechState is ShortSpeechUiState.Result && draft.organization == null && enabled) start()
    }
    Column(verticalArrangement = Arrangement.spacedBy(8.dp), modifier = Modifier.fillMaxWidth()) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Text("音声後にAIで整理", modifier = Modifier.weight(1f))
            Switch(checked = autoOrganize, onCheckedChange = { autoOrganize = it }, enabled = enabled, modifier = Modifier.testTag("capture-auto-organize"))
        }
        Text("文字・録音時刻・Theme名・添付写真を選んだAIへ送ります。", style = MaterialTheme.typography.bodySmall,
            color = MaterialTheme.colorScheme.onSurfaceVariant)
        DirectCaptureSettingsControls(directSettings, directStore, enabled && pending == null) { directSettings = it }
        Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.End) {
            if (pending != null) TextButton(onClick = { requestNumber++; pending?.cancel(); pending = null; onBusyChange(false) }) { Text("整理を中止") }
            else OutlinedButton(onClick = { start() }, enabled = enabled && (draft.originalText ?: draft.text).isNotBlank(),
                modifier = Modifier.testTag("capture-organize")) { Text(if (draft.organization == null) "AIで整理" else "元の入力から再整理") }
        }
        if (pending != null) Text("整理案を作っています…", modifier = Modifier.testTag("capture-organizing"))
        error?.let { Text(it, color = MaterialTheme.colorScheme.error, modifier = Modifier.testTag("capture-organization-error")) }
        draft.organization?.let {
            val proposals = draft.allOrganizations()
            var selectedIndex by rememberSaveable(draft.draftId) { mutableIntStateOf(0) }
            val selected = selectedIndex.coerceIn(proposals.indices)
            val proposal = proposals[selected]
            fun changeCandidate(value: MobileCaptureOrganization) =
                onChange(proposals.mapIndexed { index, existing -> if (index == selected) value else existing })
            Text("AI整理案 · 確認して追加", style = MaterialTheme.typography.titleSmall)
            Text("追加対象 ${proposals.count { !it.excluded }}件 · 除外 ${proposals.count { it.excluded }}件",
                modifier = Modifier.testTag("organization-counts"))
            Text("端末にまとめて保存し、各Taskを個別にDesktopへ同期します。",
                style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
            androidx.compose.foundation.lazy.LazyRow(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                items(proposals.size, key = { it }) { index ->
                    FilterChip(
                        selected = selected == index,
                        onClick = { selectedIndex = index },
                        enabled = enabled,
                        label = { Text("候補 ${index + 1}${if (proposals[index].excluded) " · 除外" else ""}") },
                        modifier = Modifier.testTag("organization-select-$index"),
                    )
                }
            }
            key(draft.draftId, selected) {
                var checklistText by remember(proposal.checklist) { mutableStateOf(proposal.checklist.joinToString("\n")) }
                fun changeDates(start: String?, end: String?) = changeCandidate(proposal.copy(
                    startDate = start, endDate = end,
                    rangeSemantics = if (start != null && end != null && start != end) proposal.rangeSemantics else null,
                ))
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Text("候補 ${selected + 1}", style = MaterialTheme.typography.titleSmall, modifier = Modifier.weight(1f))
                    TextButton(
                        onClick = { changeCandidate(proposal.copy(excluded = !proposal.excluded)) },
                        enabled = enabled, modifier = Modifier.testTag("organization-exclude"),
                    ) { Text(if (proposal.excluded) "追加対象に戻す" else "このTaskを外す") }
                }
                proposal.warnings.forEach { Text(it, style = MaterialTheme.typography.bodySmall) }
                OutlinedTextField(proposal.title, { changeCandidate(proposal.copy(title = it)) },
                    label = { Text("Task名") }, maxLines = 6, enabled = enabled,
                    modifier = Modifier.fillMaxWidth().testTag("organization-title"))
                CaptureThemePicker(
                    themeId = proposal.themeId, themes = themes, catalogState = themeCatalogState,
                    enabled = enabled, onThemeSelected = { changeCandidate(proposal.copy(themeId = it)) },
                )
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    OutlinedTextField(proposal.startDate.orEmpty(), { changeDates(it.ifBlank { null }, proposal.endDate) },
                        label = { Text("開始 YYYY-MM-DD") }, singleLine = true, enabled = enabled,
                        modifier = Modifier.weight(1f).testTag("organization-start"))
                    OutlinedTextField(proposal.endDate.orEmpty(), { changeDates(proposal.startDate, it.ifBlank { null }) },
                        label = { Text("期限 YYYY-MM-DD") }, singleLine = true, enabled = enabled,
                        modifier = Modifier.weight(1f).testTag("organization-end"))
                }
                if (proposal.startDate != null && proposal.endDate != null && proposal.startDate != proposal.endDate) {
                    Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                        FilterChip(proposal.rangeSemantics == "once_within_window", { changeCandidate(proposal.copy(rangeSemantics = "once_within_window")) }, enabled = enabled, label = { Text("期間内に一度") })
                        FilterChip(proposal.rangeSemantics == "ongoing", { changeCandidate(proposal.copy(rangeSemantics = "ongoing")) }, enabled = enabled, label = { Text("期間中継続") })
                    }
                }
                CapturePlannedTimeFields(proposal, enabled, "organization", ::changeCandidate)
                OutlinedTextField(checklistText, { value ->
                    checklistText = value
                    changeCandidate(proposal.copy(checklist = value.lines().filter { it.isNotBlank() }))
                }, label = { Text("チェック項目（1行に1つ）") }, minLines = 2, maxLines = 6, enabled = enabled,
                    modifier = Modifier.fillMaxWidth().testTag("organization-checklist"))
                OutlinedTextField(proposal.supplement, { changeCandidate(proposal.copy(supplement = it)) },
                    label = { Text("補足") }, maxLines = 4, enabled = enabled,
                    modifier = Modifier.fillMaxWidth().testTag("organization-supplement"))
                if (!proposal.excluded && runCatching { proposal.validate() }.isFailure) Text(
                    "Task名（500文字以内）、日付の形式・順序、予定時刻、所要時間、チェック項目（20件・各200文字以内）を確認してください。",
                    color = MaterialTheme.colorScheme.error, modifier = Modifier.testTag("organization-validation-error"))
            }
            Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.End) {
                TextButton(onClick = { originalOpen = !originalOpen }) { Text(if (originalOpen) "元の入力を閉じる" else "元の入力を見る") }
                TextButton(onClick = onRestoreOriginal, enabled = enabled) { Text("整理を取り消す") }
            }
            if (originalOpen) SelectionContainer { Text(draft.originalText.orEmpty(), modifier = Modifier.testTag("organization-original")) }
        }
    }
}

@Composable
private fun CapturePlannedTimeFields(
    proposal: MobileCaptureOrganization,
    enabled: Boolean,
    tag: String,
    onChange: (MobileCaptureOrganization) -> Unit,
) {
    if (!proposal.plannedTimeSupported) {
        Text("この整理案は予定時刻・所要時間に未対応です。Desktopを更新して元の入力から再整理してください。",
            style = MaterialTheme.typography.bodySmall)
        return
    }
    Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
        OutlinedTextField(
            value = proposal.plannedStartTime.orEmpty(),
            onValueChange = { onChange(proposal.copy(plannedStartTime = it.ifEmpty { null })) },
            label = { Text("予定開始 HH:mm") }, singleLine = true, enabled = enabled,
            isError = proposal.plannedStartTime?.let(::isPlannedStartTime) == false,
            modifier = Modifier.weight(1f).testTag("$tag-time"),
        )
        OutlinedTextField(
            value = proposal.plannedDurationMinutes?.toString().orEmpty(),
            onValueChange = { value ->
                // Refuse non-numeric/overflow input instead of silently saving it as no duration.
                if (value.isEmpty() || (value.length <= 5 && value.all { it in '0'..'9' })) {
                    onChange(proposal.copy(plannedDurationMinutes = value.toIntOrNull()))
                }
            },
            label = { Text("所要時間（分）") }, singleLine = true, enabled = enabled,
            isError = proposal.plannedDurationMinutes?.let(::isPlannedDurationMinutes) == false,
            modifier = Modifier.weight(1f).testTag("$tag-duration"),
        )
    }
    Text("所要時間は1〜10080分。日付は開始・期限欄で確認してください。",
        style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
}
