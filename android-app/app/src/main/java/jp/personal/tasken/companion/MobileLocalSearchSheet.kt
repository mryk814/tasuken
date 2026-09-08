package jp.personal.tasken.companion

import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.platform.LocalFocusManager
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.window.Dialog
import androidx.compose.ui.window.DialogProperties
import java.time.LocalDate
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.catch
import kotlinx.coroutines.launch

@Composable
internal fun MobileLocalSearchSheet(
    repository: MobileLocalSearchRepository,
    themes: List<MobileTheme>,
    onOpen: (MobileLocalSearchHit) -> Unit,
    onDismiss: () -> Unit,
    initialQuery: String = "",
    initialThemeId: String? = null,
    notice: String? = null,
) {
    var query by rememberSaveable { mutableStateOf(initialQuery) }
    var themeId by rememberSaveable { mutableStateOf(initialThemeId) }
    var from by rememberSaveable { mutableStateOf("") }
    var until by rememberSaveable { mutableStateOf("") }
    var pageNumber by rememberSaveable { mutableIntStateOf(0) }
    var filtersOpen by rememberSaveable { mutableStateOf(false) }
    val list = rememberLazyListState()
    val scope = rememberCoroutineScope()
    val focus = LocalFocusManager.current
    val keyboardActions = KeyboardActions(onDone = { focus.clearFocus() })
    val keyboardOptions = KeyboardOptions(imeAction = ImeAction.Done)
    val request = remember(query, themeId, from, until, pageNumber) { MobileLocalSearchRequest(query, themeId, from, until, pageNumber) }
    val collected by produceState<MobileLocalSearchPage?>(null, repository, request) {
        delay(150)
        repository.observeLocalSearch(request).catch { emit(MobileLocalSearchPage(request, error = "端末の記録を検索できませんでした。入力を保ったまま開き直してください。")) }
            .collect { value = it }
    }
    val page = collected?.takeIf { it.request == request }
    fun resetPage() { pageNumber = 0; scope.launch { list.scrollToItem(0) } }

    Dialog(onDismissRequest = onDismiss, properties = DialogProperties(usePlatformDefaultWidth = false)) {
        Surface(Modifier.widthIn(max = 800.dp).fillMaxWidth().fillMaxHeight(0.94f).testTag("local-search"), shape = MaterialTheme.shapes.large) {
            Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
                    Text("端末内の記録を検索", Modifier.weight(1f), style = MaterialTheme.typography.titleLarge)
                    TextButton(onClick = onDismiss) { Text("閉じる") }
                }
                OutlinedTextField(value = query, onValueChange = { query = it; resetPage() }, singleLine = true,
                    keyboardActions = keyboardActions, keyboardOptions = keyboardOptions,
                    label = { Text("本文の言葉・Task名") }, isError = query.length > LOCAL_SEARCH_QUERY_LIMIT,
                    modifier = Modifier.fillMaxWidth().testTag("local-search-query"))
                TextButton(onClick = { filtersOpen = !filtersOpen }, modifier = Modifier.testTag("local-search-filters")) {
                    Text(if (themeId != null || from.isNotEmpty() || until.isNotEmpty()) "Theme・日付で絞り込み中" else "Theme・日付で絞る")
                }
                if (filtersOpen) {
                    LazyRow(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                        item { FilterChip(selected = themeId == null, onClick = { themeId = null; resetPage() }, label = { Text("すべてのTheme") }) }
                        item { FilterChip(selected = themeId == "", onClick = { themeId = ""; resetPage() }, label = { Text("Themeなし") }) }
                        items(themes, key = { it.id }) { theme ->
                            FilterChip(selected = themeId == theme.id, onClick = { themeId = theme.id; resetPage() },
                                label = { Text(theme.title, maxLines = 1, overflow = TextOverflow.Ellipsis) }, modifier = Modifier.widthIn(max = 220.dp).testTag("local-search-theme-${theme.id}"))
                        }
                    }
                    Text("Note・関連資料のThemeは関連Taskで判定します。", style = MaterialTheme.typography.bodySmall)
                    Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                        OutlinedTextField(value = from, onValueChange = { from = it; resetPage() }, label = { Text("開始日") },
                            keyboardActions = keyboardActions, keyboardOptions = keyboardOptions,
                            placeholder = { Text("YYYY-MM-DD") }, singleLine = true, modifier = Modifier.weight(1f).testTag("local-search-from"))
                        OutlinedTextField(value = until, onValueChange = { until = it; resetPage() }, label = { Text("終了日") },
                            keyboardActions = keyboardActions, keyboardOptions = keyboardOptions,
                            placeholder = { Text("YYYY-MM-DD") }, singleLine = true, modifier = Modifier.weight(1f).testTag("local-search-until"))
                    }
                    Row {
                        TextButton(onClick = { from = LocalDate.now().minusDays(6).toString(); until = LocalDate.now().toString(); resetPage() }) { Text("直近7日") }
                        TextButton(onClick = { themeId = null; from = ""; until = ""; resetPage() }) { Text("条件を解除") }
                    }
                }
                if (page == null) LinearProgressIndicator(Modifier.fillMaxWidth().testTag("local-search-loading"))
                (notice ?: page?.error)?.let { Text(it, color = MaterialTheme.colorScheme.error, style = MaterialTheme.typography.bodySmall) }
                LazyColumn(Modifier.weight(1f).testTag("local-search-results"), state = list, verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    if (page != null && page.error == null) {
                        item {
                            Text(page.coverage.description, style = MaterialTheme.typography.bodySmall, modifier = Modifier.testTag("local-search-coverage"))
                            Text(page.coverage.missingDescription, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                            Text(if (query.isBlank()) "検索語なし・日付の新しい順" else "${page.total}件・日付の新しい順", style = MaterialTheme.typography.labelMedium)
                        }
                        if (page.hits.isEmpty()) item { Text("検索した端末内の範囲に一致する記録はありません。", modifier = Modifier.testTag("local-search-empty")) }
                        items(page.hits, key = { it.key }) { hit ->
                            OutlinedCard(onClick = { onOpen(hit) }, modifier = Modifier.fillMaxWidth().testTag("local-search-${hit.key}")) {
                                Column(Modifier.padding(12.dp), verticalArrangement = Arrangement.spacedBy(5.dp)) {
                                    Text("${hit.kind.label} · ${hit.dateMeaning} ${hit.date.ifEmpty { "不明" }}", style = MaterialTheme.typography.labelLarge)
                                    Text(hit.title, style = MaterialTheme.typography.titleSmall, maxLines = 2, overflow = TextOverflow.Ellipsis)
                                    if (hit.excerpt.isNotEmpty() && hit.excerpt != hit.title) Text(hit.excerpt, maxLines = 3, overflow = TextOverflow.Ellipsis)
                                    Text(localSearchThemeLabel(hit, themes), style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                                    Text(hit.coverage, style = MaterialTheme.typography.bodySmall)
                                }
                            }
                        }
                    }
                }
                if (page != null && page.error == null) Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
                    TextButton(enabled = pageNumber > 0, onClick = { pageNumber--; scope.launch { list.scrollToItem(0) } }, modifier = Modifier.testTag("local-search-previous")) { Text("前の50件") }
                    Text("${pageNumber + 1}ページ", style = MaterialTheme.typography.labelMedium)
                    TextButton(enabled = page.hasNext, onClick = { pageNumber++; scope.launch { list.scrollToItem(0) } }, modifier = Modifier.testTag("local-search-next")) { Text("次の50件") }
                }
            }
        }
    }
}

private fun localSearchThemeLabel(hit: MobileLocalSearchHit, themes: List<MobileTheme>): String {
    if (hit.themeIds.isEmpty()) return "Theme未取得"
    val names = hit.themeIds.map { id -> if (id == null) "Themeなし" else themes.firstOrNull { it.id == id }?.title ?: "Theme名未取得" }.distinct()
    return (if (hit.themeFromRelatedTask) "関連TaskのTheme: " else "") + names.joinToString("・")
}
