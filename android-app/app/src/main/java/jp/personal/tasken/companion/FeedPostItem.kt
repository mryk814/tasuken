package jp.personal.tasken.companion

import android.content.ActivityNotFoundException
import android.content.Intent
import android.net.Uri
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp

/** 長い投稿は先頭だけを見せ、読みたい人だけが広げる。固定の高さで切り捨てない。 */
private const val FEED_COLLAPSED_LINES = 6

/**
 * Feedの投稿1件（AIの投稿・自分の投稿）。
 *
 * AIも人も同じ形で並べ、AIだけを特別に見せない。タップで本文を広げ、
 * 紐づくTaskやリンクは本文の下から開く。長押しで同じ操作のメニューを開ける。
 */
@Composable
internal fun FeedPostItem(
    post: MobileFeedPostDto,
    at: java.time.Instant?,
    isNew: Boolean,
    highlighted: Boolean,
    onOpenTask: ((String) -> Unit)?,
    modifier: Modifier = Modifier,
) {
    var expanded by rememberSaveable(post.postId) { mutableStateOf(false) }
    var overflowing by remember(post.postId) { mutableStateOf(false) }
    val context = LocalContext.current
    val taskId = post.taskId
    val openLink = post.link?.takeIf { safeExternalUri(it.url) != null }?.let { link -> { openExternalLink(context, link.url) } }
    AiPost(
        author = post.authorLabel,
        verb = if (post.isHuman) "" else feedTopicLabel(post.topic),
        at = at,
        isNew = isNew,
        highlighted = highlighted,
        onClick = { expanded = !expanded },
        menu = if (taskId != null && onOpenTask != null || openLink != null) {
            { close ->
                if (taskId != null && onOpenTask != null) {
                    DropdownMenuItem(
                        text = { Text("Taskを開く") },
                        onClick = { close(); onOpenTask(taskId) },
                    )
                }
                if (openLink != null) {
                    DropdownMenuItem(
                        text = { Text("リンクを開く") },
                        onClick = { close(); openLink() },
                    )
                }
            }
        } else {
            null
        },
        modifier = modifier.testTag("feed-post-${post.postId}"),
    ) {
        Text(
            post.body.joinToString("\n\n"),
            style = MaterialTheme.typography.bodyLarge,
            maxLines = if (expanded) Int.MAX_VALUE else FEED_COLLAPSED_LINES,
            overflow = TextOverflow.Ellipsis,
            onTextLayout = { if (!expanded) overflowing = it.hasVisualOverflow },
        )
        if (overflowing || expanded) {
            Text(
                if (expanded) "閉じる" else "もっと読む",
                style = MaterialTheme.typography.labelLarge,
                color = MaterialTheme.colorScheme.primary,
                modifier = Modifier
                    .heightIn(min = 32.dp)
                    .clickable { expanded = !expanded }
                    .testTag("feed-post-toggle-${post.postId}"),
            )
        }
        post.attachment?.let { attachment ->
            FeedAttachmentCard(
                icon = R.drawable.ic_tabler_file_text,
                label = if (attachment.kind == "note_draft") "記事の草稿" else "Note",
                title = attachment.title,
            )
        }
        post.link?.let { link ->
            FeedAttachmentCard(
                icon = R.drawable.ic_tabler_link,
                label = link.label ?: hostOf(link.url),
                title = link.comment ?: "",
                onClick = openLink,
                modifier = Modifier.testTag("feed-post-link-${post.postId}"),
            )
        }
        if (taskId != null || post.themeName != null) {
            FlowRow(
                horizontalArrangement = Arrangement.spacedBy(8.dp),
                verticalArrangement = Arrangement.spacedBy(2.dp),
                itemVerticalAlignment = Alignment.CenterVertically,
            ) {
                post.themeName?.let {
                    Text(it, style = MaterialTheme.typography.labelMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
                }
                if (taskId != null && onOpenTask != null) {
                    Row(
                        modifier = Modifier
                            .heightIn(min = 32.dp)
                            .clickable { onOpenTask(taskId) }
                            .testTag("feed-post-task-${post.postId}"),
                        verticalAlignment = Alignment.CenterVertically,
                        horizontalArrangement = Arrangement.spacedBy(4.dp),
                    ) {
                        Icon(
                            painterResource(R.drawable.ic_tabler_checklist),
                            contentDescription = null,
                            tint = MaterialTheme.colorScheme.primary,
                            modifier = Modifier.size(16.dp),
                        )
                        Text(
                            post.taskTitle ?: "Taskを開く",
                            style = MaterialTheme.typography.labelLarge,
                            color = MaterialTheme.colorScheme.primary,
                            maxLines = 1,
                            overflow = TextOverflow.Ellipsis,
                        )
                    }
                }
            }
        }
    }
}

@Composable
private fun FeedAttachmentCard(
    icon: Int,
    label: String,
    title: String,
    modifier: Modifier = Modifier,
    onClick: (() -> Unit)? = null,
) {
    val content: @Composable () -> Unit = {
        Row(
            modifier = Modifier.padding(horizontal = 12.dp, vertical = 10.dp),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(10.dp),
        ) {
            Icon(painterResource(icon), contentDescription = null, modifier = Modifier.size(20.dp))
            Column(Modifier.weight(1f)) {
                Text(label, style = MaterialTheme.typography.labelMedium, color = MaterialTheme.colorScheme.onSurfaceVariant, maxLines = 1, overflow = TextOverflow.Ellipsis)
                if (title.isNotBlank()) {
                    Text(title, style = MaterialTheme.typography.bodyMedium, fontWeight = FontWeight.SemiBold, maxLines = 2, overflow = TextOverflow.Ellipsis)
                }
            }
        }
    }
    if (onClick != null) {
        Surface(onClick = onClick, shape = RoundedCornerShape(12.dp), color = MaterialTheme.colorScheme.surfaceContainerHigh, modifier = modifier) { content() }
    } else {
        Surface(shape = RoundedCornerShape(12.dp), color = MaterialTheme.colorScheme.surfaceContainerHigh, modifier = modifier) { content() }
    }
}

/** 表示と開く先を同じ判断にそろえる。http(s)以外は開かない。 */
internal fun safeExternalUri(url: String): java.net.URI? =
    runCatching { java.net.URI(url) }.getOrNull()
        ?.takeIf { (it.scheme == "https" || it.scheme == "http") && !it.host.isNullOrBlank() }

private fun hostOf(url: String): String = safeExternalUri(url)?.host ?: url

private fun openExternalLink(context: android.content.Context, url: String) {
    val uri = safeExternalUri(url) ?: return
    try {
        context.startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(uri.toString())).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
    } catch (_: ActivityNotFoundException) {
        // 開けるアプリが無いときは何もしない。
    }
}
