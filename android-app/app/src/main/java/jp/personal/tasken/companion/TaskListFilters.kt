package jp.personal.tasken.companion

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.items
import androidx.compose.material3.FilterChip
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp

@Composable
internal fun TaskListFilters(paneState: TodayPaneState, themes: List<MobileTheme>) {
    var expanded by rememberSaveable { mutableStateOf(false) }
    val active = paneState.taskScheduleFilter != TaskScheduleFilter.All || paneState.taskThemeId != null
    Column(modifier = Modifier.fillMaxWidth().padding(horizontal = 12.dp)) {
        Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
            if (active || paneState.taskSearch.isNotEmpty() || paneState.taskFilter != TaskListFilter.Open) {
                TextButton(onClick = paneState::resetTaskFilters, modifier = Modifier.testTag("task-filters-reset")) {
                    Text("解除")
                }
            }
            TextButton(
                onClick = { expanded = !expanded },
                modifier = Modifier.weight(1f).testTag("task-filters-toggle"),
            ) {
                Text(
                    if (active) "${taskScheduleFilterLabel(paneState.taskScheduleFilter)} · ${taskThemeFilterLabel(paneState.taskThemeId, themes)}"
                    else if (expanded) "絞り込みを閉じる" else "予定・Themeで絞る",
                    maxLines = 2,
                    overflow = TextOverflow.Ellipsis,
                    modifier = Modifier.fillMaxWidth(),
                    textAlign = TextAlign.End,
                )
            }
        }
        if (expanded) {
            LazyRow(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                items(TaskScheduleFilter.entries) { filter ->
                    FilterChip(
                        selected = paneState.taskScheduleFilter == filter,
                        onClick = { paneState.taskScheduleFilter = filter },
                        label = { Text(taskScheduleFilterLabel(filter)) },
                        modifier = Modifier.testTag("task-schedule-filter-${filter.name}"),
                    )
                }
            }
            Text("Theme", style = MaterialTheme.typography.labelMedium)
            LazyRow(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                item {
                    FilterChip(
                        selected = paneState.taskThemeId == null,
                        onClick = { paneState.taskThemeId = null },
                        label = { Text(taskThemeFilterLabel(null, themes)) },
                        modifier = Modifier.testTag("task-theme-filter-all"),
                    )
                }
                item {
                    FilterChip(
                        selected = paneState.taskThemeId == "",
                        onClick = { paneState.taskThemeId = "" },
                        label = { Text(taskThemeFilterLabel("", themes)) },
                        modifier = Modifier.testTag("task-theme-filter-unassigned"),
                    )
                }
                items(themes, key = { it.id }) { theme ->
                    FilterChip(
                        selected = paneState.taskThemeId == theme.id,
                        onClick = { paneState.taskThemeId = theme.id },
                        label = { Text(theme.title, maxLines = 1, overflow = TextOverflow.Ellipsis) },
                        modifier = Modifier.widthIn(max = 220.dp).testTag("task-theme-filter-${theme.id}"),
                    )
                }
            }
        }
    }
}
