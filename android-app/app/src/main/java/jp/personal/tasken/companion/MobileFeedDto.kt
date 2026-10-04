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
