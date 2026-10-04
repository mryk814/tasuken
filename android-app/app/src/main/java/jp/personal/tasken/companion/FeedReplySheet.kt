package jp.personal.tasken.companion

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.widthIn
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.FilledIconButton
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.Text
import androidx.compose.material3.TextField
import androidx.compose.material3.TextFieldDefaults
import androidx.compose.material3.rememberModalBottomSheetState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp

/**
 * 投稿への返信（自分のメモ）を書く入力。送ると端末へ保存して投稿のスレッドに並び、
 * Desktopへは送れたときに保存される。AIへ返答を求める操作は持たない。
 * 書きかけは、画面を回転しても残る。
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
internal fun FeedReplySheet(
    post: MobileFeedPostDto,
    onSend: (String) -> Unit,
    onDismiss: () -> Unit,
    dictation: ReplyDictation? = null,
) {
    var body by rememberSaveable(post.postId) { mutableStateOf("") }
    val focusRequester = remember { FocusRequester() }
    LaunchedEffect(post.postId) { runCatching { focusRequester.requestFocus() } }
    val trimmed = body.trim()
    val tooLong = trimmed.length > FEED_REPLY_MAX_LENGTH
    ModalBottomSheet(
        onDismissRequest = onDismiss,
        sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true),
        contentWindowInsets = { WindowInsets(0) },
    ) {
        Column(
            modifier = Modifier
                .widthIn(max = 640.dp)
                .fillMaxWidth()
                .padding(horizontal = 16.dp)
                .imePadding()
                .navigationBarsPadding()
                .testTag("feed-reply-sheet"),
            verticalArrangement = Arrangement.spacedBy(8.dp),
        ) {
            // どの投稿への返信かを見失わない。投稿者と冒頭だけを小さく示す。
            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                FeedAvatar(post.authorLabel, Modifier.size(28.dp))
                Column(Modifier.weight(1f)) {
                    Text(post.authorLabel, style = MaterialTheme.typography.labelLarge, fontWeight = FontWeight.Bold)
                    Text(
                        post.body.firstOrNull().orEmpty(),
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                        maxLines = 2,
                        overflow = TextOverflow.Ellipsis,
                    )
                }
            }
            Text(
                "返信は自分のメモとして残ります。",
                style = MaterialTheme.typography.labelMedium,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
            Row(verticalAlignment = Alignment.Bottom) {
                TextField(
                    value = body,
                    onValueChange = { body = it },
                    placeholder = { Text("返信をメモする") },
                    minLines = 2,
                    maxLines = 6,
                    isError = tooLong,
                    supportingText = if (tooLong) {
                        { Text("${trimmed.length} / ${FEED_REPLY_MAX_LENGTH}文字。短くしてください。") }
                    } else {
                        null
                    },
                    colors = TextFieldDefaults.colors(
                        focusedContainerColor = Color.Transparent,
                        unfocusedContainerColor = Color.Transparent,
                        errorContainerColor = Color.Transparent,
                        focusedIndicatorColor = Color.Transparent,
                        unfocusedIndicatorColor = Color.Transparent,
                        errorIndicatorColor = Color.Transparent,
                    ),
                    modifier = Modifier.weight(1f).focusRequester(focusRequester).testTag("feed-reply-input"),
                )
                dictation?.let { voice ->
                    val listening = voice.state is ShortSpeechUiState.Listening || voice.state is ShortSpeechUiState.Partial
                    VoiceToolButton(
                        speechState = voice.state,
                        hasText = trimmed.isNotEmpty(),
                        enabled = voice.state !is ShortSpeechUiState.Processing,
                        onClick = {
                            if (listening) {
                                voice.stop()
                            } else {
                                voice.start { spoken ->
                                    body = if (body.isBlank()) spoken else "${body.trimEnd()} $spoken"
                                }
                            }
                        },
                        modifier = Modifier.testTag("feed-reply-voice"),
                    )
                }
                FilledIconButton(
                    onClick = { onSend(trimmed) },
                    enabled = trimmed.isNotEmpty() && !tooLong,
                    modifier = Modifier.padding(start = 4.dp, bottom = 4.dp).testTag("feed-reply-send"),
                ) {
                    Icon(painterResource(R.drawable.ic_tabler_arrow_up), contentDescription = "返信を残す")
                }
            }
        }
    }
}
