package jp.personal.tasken.companion

import androidx.compose.foundation.layout.*
import androidx.compose.foundation.text.selection.SelectionContainer
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
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
    organize: suspend (MobileCaptureDraft) -> MobileCaptureOrganization,
    onChange: (MobileCaptureOrganization) -> Unit,
    onRestoreOriginal: () -> Unit,
    onBusyChange: (Boolean) -> Unit,
) {
    val scope = rememberCoroutineScope()
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
                val proposal = organize(requested)
                proposal.validate()
                if (request == requestNumber && currentDraft == requested) onChange(proposal)
            } catch (cancelled: CancellationException) {
                throw cancelled
            } catch (_: Exception) {
                if (request == requestNumber && currentDraft == requested) error = "AI整理を利用できません。Desktopの設定・接続を確認して再試行してください。通常の追加も使えます。"
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
        Text("文字とTheme名をDesktopで設定したAIへ送ります。", style = MaterialTheme.typography.bodySmall,
            color = MaterialTheme.colorScheme.onSurfaceVariant)
        Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.End) {
            if (pending != null) TextButton(onClick = { requestNumber++; pending?.cancel(); pending = null; onBusyChange(false) }) { Text("整理を中止") }
            else OutlinedButton(onClick = { start() }, enabled = enabled && (draft.originalText ?: draft.text).isNotBlank(),
                modifier = Modifier.testTag("capture-organize")) { Text(if (draft.organization == null) "AIで整理" else "元の入力から再整理") }
        }
        if (pending != null) Text("整理案を作っています…", modifier = Modifier.testTag("capture-organizing"))
        error?.let { Text(it, color = MaterialTheme.colorScheme.error, modifier = Modifier.testTag("capture-organization-error")) }
        draft.organization?.let { proposal ->
            var checklistText by remember(draft.draftId) { mutableStateOf(proposal.checklist.joinToString("\n")) }
            LaunchedEffect(proposal.checklist) {
                if (checklistText.lines().filter { it.isNotBlank() } != proposal.checklist) {
                    checklistText = proposal.checklist.joinToString("\n")
                }
            }
            fun changeDates(start: String?, end: String?) = onChange(proposal.copy(
                startDate = start, endDate = end,
                rangeSemantics = if (start != null && end != null && start != end) proposal.rangeSemantics else null,
            ))
            Text("AI整理案 · 確認して追加", style = MaterialTheme.typography.titleSmall)
            proposal.warnings.forEach { Text(it, style = MaterialTheme.typography.bodySmall) }
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
                    FilterChip(proposal.rangeSemantics == "once_within_window", { onChange(proposal.copy(rangeSemantics = "once_within_window")) }, enabled = enabled, label = { Text("期間内に一度") })
                    FilterChip(proposal.rangeSemantics == "ongoing", { onChange(proposal.copy(rangeSemantics = "ongoing")) }, enabled = enabled, label = { Text("期間中継続") })
                }
            }
            OutlinedTextField(checklistText, { value ->
                checklistText = value
                onChange(proposal.copy(checklist = value.lines().filter { it.isNotBlank() }))
            }, label = { Text("チェック項目（1行に1つ）") }, minLines = 2, maxLines = 6, enabled = enabled,
                modifier = Modifier.fillMaxWidth().testTag("organization-checklist"))
            OutlinedTextField(proposal.supplement, { onChange(proposal.copy(supplement = it)) },
                label = { Text("補足") }, maxLines = 4, enabled = enabled,
                modifier = Modifier.fillMaxWidth().testTag("organization-supplement"))
            if (runCatching { proposal.validate() }.isFailure) Text("日付の形式・順序、チェック項目（20件・各200文字以内）を確認してください。", color = MaterialTheme.colorScheme.error)
            Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.End) {
                TextButton(onClick = { originalOpen = !originalOpen }) { Text(if (originalOpen) "元の入力を閉じる" else "元の入力を見る") }
                TextButton(onClick = onRestoreOriginal, enabled = enabled) { Text("整理を取り消す") }
            }
            if (originalOpen) SelectionContainer { Text(draft.originalText.orEmpty(), modifier = Modifier.testTag("organization-original")) }
        }
    }
}
