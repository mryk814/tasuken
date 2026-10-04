package jp.personal.tasken.companion

import java.time.Instant
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.Json

/**
 * DesktopのFeed投稿（AIの投稿・自分の投稿）を読むread model。
 *
 * Androidは読むだけで、投稿を作ったり並べ替えたりしない。投稿の範囲と並びはDesktopが決める。
 * 作業報告はAgent Deskの経路（Task）で届くため、ここには含まれない。
 * 未知fieldを黙って捨てない（契約が変わったら気づけるようにする）。
 */
@Serializable
data class MobileFeedAttachmentDto(
    /** `note_draft`（記事の草稿・採用前）または `note`（既存Noteの参照）。 */
    val kind: String,
    val title: String,
)

@Serializable
data class MobileFeedLinkDto(
    val url: String,
    val label: String? = null,
    val comment: String? = null,
)

/** 投稿への返信（自分のメモ・AIの返答）。Desktopの並び（古い順）のまま受け取る。 */
@Serializable
data class MobileFeedReplyDto(
    val replyId: String,
    /** `human`（自分）または `ai`。 */
    val authorKind: String,
    val authorLabel: String,
    val createdAt: String,
    val body: String,
    /** まだDesktopへ届いていない自分の返信。端末の中だけの印で、契約には載らない。 */
    @kotlinx.serialization.Transient val pending: Boolean = false,
) {
    val isHuman: Boolean get() = authorKind == "human"
}

@Serializable
data class MobileFeedPostDto(
    val postId: String,
    /** `human`（自分）または `ai`。AIの特別な見せ方はせず、既存の印の判断だけに使う。 */
    val authorKind: String,
    val authorLabel: String,
    val topic: String,
    val createdAt: String,
    val body: List<String>,
    val taskId: String? = null,
    val taskTitle: String? = null,
    val themeId: String? = null,
    val themeName: String? = null,
    val attachment: MobileFeedAttachmentDto? = null,
    /** 自分が付けた反応（`bookmark` / `interesting`）。 */
    val reactions: List<String> = emptyList(),
    /** 返信（古い順）。 */
    val replies: List<MobileFeedReplyDto> = emptyList(),
    val link: MobileFeedLinkDto? = null,
) {
    val createdInstant: Instant? get() = parseInstantOrNull(createdAt)
    val isHuman: Boolean get() = authorKind == "human"
}

@Serializable
data class MobileFeedDataDto(
    val posts: List<MobileFeedPostDto> = emptyList(),
    val truncated: Boolean,
)

@Serializable
data class MobileFeedResponseDto(
    val ok: Boolean,
    val meta: MobileAttentionMetaDto,
    val data: MobileFeedDataDto,
)

object MobileFeedContract {
    private val json = Json {
        ignoreUnknownKeys = false
        isLenient = false
        coerceInputValues = false
        encodeDefaults = true
        explicitNulls = false
    }

    fun decode(body: String): MobileFeedResponseDto = json.decodeFromString(body)

    /** 保存済みの1件を復号する。未知fieldは契約違反として拒否する。 */
    fun decodePost(payload: String): MobileFeedPostDto = json.decodeFromString(payload)

    internal fun encodePost(post: MobileFeedPostDto): String = json.encodeToString(post)
}

/** 投稿の種類の表示名。Desktopの `FEED_POST_KIND_LABELS` と同じ語を使う。 */
internal fun feedTopicLabel(topic: String): String = when (topic) {
    "work_report" -> "作業報告"
    "insight" -> "気づき"
    "learning" -> "学び"
    "reference" -> "情報紹介"
    "question" -> "質問"
    else -> "メモ"
}

/** 一覧の1件を保存する。投稿全体を `payloadJson` に残し、列は並びと絞り込みに使うものだけにする。 */
internal fun MobileFeedPostDto.toCacheEntity(
    serverId: String,
    position: Int,
    fetchedAt: String,
): FeedCacheEntity = FeedCacheEntity(
    postId = postId,
    serverId = serverId,
    position = position,
    payloadJson = MobileFeedContract.encodePost(this),
    fetchedAt = fetchedAt,
)

internal fun FeedCacheEntity.toPost(): MobileFeedPostDto = MobileFeedContract.decodePost(payloadJson)

/* -------------------------------------------------------------------------
 * Feedへの書き込み（反応・自分のメモとしての返信）。
 * 端末の中へ先に保存して送り、応答を失っても同じcommandIdで再送する。
 * ---------------------------------------------------------------------- */

const val FEED_REACTION_BOOKMARK = "bookmark"
const val FEED_REACTION_INTERESTING = "interesting"
const val FEED_REPLY_MAX_LENGTH = 4000

@Serializable
data class MobileFeedActionDto(
    /** `SetFeedReaction` または `PostFeedReply`。使わない項目は送らない。 */
    val name: String,
    val postId: String,
    val kind: String? = null,
    val on: Boolean? = null,
    val replyId: String? = null,
    val body: String? = null,
)

@Serializable
data class MobileFeedActionEnvelopeDto(
    val apiVersion: Int,
    val schemaVersion: Int,
    val requestId: String,
    val commandId: String,
    val idempotencyKey: String,
    val clientDeviceId: String,
    val issuedAt: String,
    val action: MobileFeedActionDto,
)

@Serializable
data class MobileFeedActionDataDto(val commandId: String, val status: String)

@Serializable
data class MobileFeedActionResponseDto(
    val ok: Boolean,
    val meta: MobileAttentionMetaDto,
    val data: MobileFeedActionDataDto,
)

object MobileFeedActionContract {
    private val json = Json {
        ignoreUnknownKeys = false
        isLenient = false
        coerceInputValues = false
        encodeDefaults = true
        explicitNulls = false
    }

    fun encode(envelope: MobileFeedActionEnvelopeDto): String = json.encodeToString(envelope)

    fun decodeEnvelope(payload: String): MobileFeedActionEnvelopeDto = json.decodeFromString(payload)

    fun decodeResponse(payload: String): MobileFeedActionResponseDto = json.decodeFromString(payload)

    fun requireReactionKind(kind: String) {
        require(kind == FEED_REACTION_BOOKMARK || kind == FEED_REACTION_INTERESTING) { "未対応の反応です。" }
    }

    /** 返信の本文を整える。空や長すぎる返信は送らない。 */
    fun normalizeReply(body: String): String {
        val text = body.trim()
        require(text.isNotEmpty()) { "返信を入力してください。" }
        require(text.length <= FEED_REPLY_MAX_LENGTH) { "返信は${FEED_REPLY_MAX_LENGTH}文字以内で入力してください。" }
        return text
    }
}

/** 送信待ちの書き込みの結果。 */
sealed interface MobileFeedActionResult {
    /** 端末に保存した。Desktopへは送信済みか、接続できたときに送る。 */
    data object Queued : MobileFeedActionResult

    /** Desktopが受け付けなかった。送信待ちは外した。 */
    data class Rejected(val message: String) : MobileFeedActionResult

    /** 保存しなかった（権限がない・接続設定がない）。 */
    data class Unavailable(val message: String) : MobileFeedActionResult
}

/**
 * 保存済みの投稿へ、まだDesktopに届いていない書き込みを重ねる。
 * 反応は付け外しを先に見せ、返信は「送信待ち」の印を付けて末尾に並べる。
 */
internal fun applyPendingFeedActions(
    posts: List<MobileFeedPostDto>,
    pending: List<MobileFeedActionEnvelopeDto>,
): List<MobileFeedPostDto> {
    if (pending.isEmpty()) return posts
    val ordered = pending.sortedBy { it.issuedAt }
    return posts.map { post ->
        val mine = ordered.filter { it.action.postId == post.postId }
        if (mine.isEmpty()) return@map post
        val reactions = post.reactions.toMutableList()
        val replies = post.replies.toMutableList()
        for (envelope in mine) {
            val action = envelope.action
            when (action.name) {
                "SetFeedReaction" -> {
                    val kind = action.kind ?: continue
                    if (action.on == true) {
                        if (kind !in reactions) reactions += kind
                    } else {
                        reactions -= kind
                    }
                }
                "PostFeedReply" -> {
                    val replyId = action.replyId ?: continue
                    if (replies.none { it.replyId == replyId }) {
                        replies += MobileFeedReplyDto(
                            replyId = replyId,
                            authorKind = "human",
                            authorLabel = "自分",
                            createdAt = envelope.issuedAt,
                            body = action.body.orEmpty(),
                            pending = true,
                        )
                    }
                }
            }
        }
        post.copy(reactions = reactions, replies = replies)
    }
}
