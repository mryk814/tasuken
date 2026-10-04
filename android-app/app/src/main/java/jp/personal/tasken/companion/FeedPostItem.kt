package jp.personal.tasken.companion

import android.content.ActivityNotFoundException
import android.content.Intent
import android.net.Uri
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
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
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.semantics.stateDescription
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
    /** 「おもしろい」「ブックマーク」を付け外しする。 */
    onToggleReaction: ((String) -> Unit)? = null,
    /** 返信（自分のメモ）を書く入力を開く。 */
    onReply: (() -> Unit)? = null,
) {
    var expanded by rememberSaveable(post.postId) { mutableStateOf(false) }
    var threadOpen by rememberSaveable(post.postId) { mutableStateOf(false) }
    // 送信待ちの返信が増えたら、自分の返信がスレッドに並んだことを見せる。
    val pendingReplies = post.replies.count { it.pending }
    LaunchedEffect(pendingReplies) { if (pendingReplies > 0) threadOpen = true }
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
        if (onToggleReaction != null || onReply != null) {
            FeedActionBar(
                postId = post.postId,
                replyCount = post.replies.size,
                interesting = FEED_REACTION_INTERESTING in post.reactions,
                bookmarked = FEED_REACTION_BOOKMARK in post.reactions,
                onReply = onReply,
                onToggleReaction = onToggleReaction,
            )
        }
        if (post.replies.isNotEmpty()) {
            Text(
                if (threadOpen) "返信を閉じる" else "返信 ${post.replies.size}件を見る",
                style = MaterialTheme.typography.labelLarge,
                color = MaterialTheme.colorScheme.primary,
                modifier = Modifier
                    .heightIn(min = 32.dp)
                    .clickable { threadOpen = !threadOpen }
                    .testTag("feed-post-thread-toggle-${post.postId}"),
            )
            if (threadOpen) {
                Column(
                    verticalArrangement = Arrangement.spacedBy(10.dp),
                    modifier = Modifier.testTag("feed-post-thread-${post.postId}"),
                ) {
                    post.replies.forEach { reply -> FeedReplyItem(reply) }
                }
            }
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

/**
 * 投稿の下の行動バー（Xと同じ並び）。返信数・おもしろい・ブックマークを、押す前から状態が分かる形で置く。
 * 押すと軽い触覚と、アイコンが弾む動きで付いたことを返す。
 */
@Composable
private fun FeedActionBar(
    postId: String,
    replyCount: Int,
    interesting: Boolean,
    bookmarked: Boolean,
    onReply: (() -> Unit)?,
    onToggleReaction: ((String) -> Unit)?,
) {
    androidx.compose.foundation.layout.Row(
        modifier = Modifier.fillMaxWidth().padding(top = 2.dp),
        horizontalArrangement = Arrangement.spacedBy(8.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        if (onReply != null) {
            FeedActionButton(
                icon = R.drawable.ic_tabler_message_circle,
                label = if (replyCount > 0) replyCount.toString() else null,
                description = "返信を書く。返信${replyCount}件",
                active = false,
                onClick = onReply,
                modifier = Modifier.testTag("feed-post-reply-$postId"),
            )
        }
        if (onToggleReaction != null) {
            FeedActionButton(
                icon = if (interesting) R.drawable.ic_tabler_heart_filled else R.drawable.ic_tabler_heart,
                label = null,
                description = if (interesting) "おもしろいを外す" else "おもしろい",
                active = interesting,
                onClick = { onToggleReaction(FEED_REACTION_INTERESTING) },
                modifier = Modifier.testTag("feed-post-like-$postId"),
            )
            FeedActionButton(
                icon = if (bookmarked) R.drawable.ic_tabler_bookmark_filled else R.drawable.ic_tabler_bookmark,
                label = null,
                description = if (bookmarked) "ブックマークを外す" else "ブックマーク",
                active = bookmarked,
                onClick = { onToggleReaction(FEED_REACTION_BOOKMARK) },
                modifier = Modifier.testTag("feed-post-bookmark-$postId"),
            )
        }
    }
}

@Composable
private fun FeedActionButton(
    icon: Int,
    label: String?,
    description: String,
    active: Boolean,
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
) {
    val haptics = androidx.compose.ui.platform.LocalHapticFeedback.current
    // 付いた瞬間だけ少し弾む。外したときや再表示では動かさない。
    val bounce = remember { androidx.compose.animation.core.Animatable(1f) }
    var first by remember { mutableStateOf(true) }
    LaunchedEffect(active) {
        if (first) {
            first = false
        } else if (active) {
            bounce.snapTo(0.7f)
            bounce.animateTo(
                1f,
                androidx.compose.animation.core.spring(dampingRatio = 0.35f, stiffness = 500f),
            )
        }
    }
    val tint = if (active) MaterialTheme.colorScheme.primary else MaterialTheme.colorScheme.onSurfaceVariant
    Row(
        modifier = modifier
            .heightIn(min = 48.dp)
            .clip(RoundedCornerShape(24.dp))
            .clickable(role = androidx.compose.ui.semantics.Role.Button, onClickLabel = description) {
                haptics.performHapticFeedback(
                    if (active) {
                        androidx.compose.ui.hapticfeedback.HapticFeedbackType.ContextClick
                    } else {
                        androidx.compose.ui.hapticfeedback.HapticFeedbackType.Confirm
                    },
                )
                onClick()
            }
            .padding(horizontal = 12.dp)
            .semantics { contentDescription = description; stateDescription = if (active) "付いています" else "付いていません" },
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(6.dp),
    ) {
        Icon(
            painterResource(icon),
            contentDescription = null,
            tint = tint,
            modifier = Modifier
                .size(22.dp)
                .graphicsLayer { scaleX = bounce.value; scaleY = bounce.value },
        )
        label?.let { Text(it, style = MaterialTheme.typography.labelLarge, color = tint) }
    }
}

/** スレッドの1件。自分のメモもAIの返答も同じ形で並べ、届いていない返信だけ「送信待ち」を添える。 */
@Composable
private fun FeedReplyItem(reply: MobileFeedReplyDto) {
    Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
        FeedAvatar(reply.authorLabel, Modifier.size(28.dp))
        Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(2.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                Text(reply.authorLabel, style = MaterialTheme.typography.labelLarge, fontWeight = FontWeight.Bold)
                parseInstantOrNull(reply.createdAt)?.let {
                    Text(
                        relativeTimeLabel(it),
                        style = MaterialTheme.typography.labelMedium,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                }
                if (reply.pending) {
                    Text(
                        "送信待ち",
                        style = MaterialTheme.typography.labelMedium,
                        color = MaterialTheme.colorScheme.tertiary,
                        modifier = Modifier.testTag("feed-reply-pending-${reply.replyId}"),
                    )
                }
            }
            Text(reply.body, style = MaterialTheme.typography.bodyMedium)
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
