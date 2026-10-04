package jp.personal.tasken.companion

import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.safeDrawingPadding
import androidx.compose.material3.Surface
import androidx.compose.ui.Modifier
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.getBoundsInRoot
import androidx.compose.ui.test.hasTestTag
import androidx.compose.ui.test.junit4.v2.createComposeRule
import androidx.compose.ui.test.onAllNodesWithText
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performScrollToNode
import java.time.Instant
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test

/** DesktopのFeed投稿を、AIも自分も同じ流れで読む。 */
class FeedPostsUiTest {
    @get:Rule val composeRule = createComposeRule()

    private val now: Instant = Instant.parse("2026-10-04T09:00:00Z")
    private val long = (1..40).joinToString("") { "測定温度を揃える理由を丁寧に書きます。" }

    private fun posts() = listOf(
        MobileFeedPostDto(
            postId = "own-1", authorKind = "human", authorLabel = "自分", topic = "own_note",
            createdAt = now.minusSeconds(60).toString(), body = listOf("今日は粘度の実験を進める。"),
        ),
        MobileFeedPostDto(
            postId = "ai-1", authorKind = "ai", authorLabel = "Codex", topic = "insight",
            createdAt = now.minusSeconds(600).toString(), body = listOf(long),
            taskId = "task-1", taskTitle = "粘度測定の条件を決める", themeName = "高分子材料評価",
            attachment = MobileFeedAttachmentDto("note_draft", "粘度測定は温度を先に揃える"),
            link = MobileFeedLinkDto("https://example.com/viscosity", "測定ガイド", null),
        ),
    )

    private fun show(seenBefore: Instant? = now.minusSeconds(3600), onTask: (String) -> Unit = {}) {
        composeRule.setContent {
            TaskenTheme {
                Surface(Modifier.fillMaxSize().safeDrawingPadding()) {
                    FeedListPane(
                        uiState = TodayUiState.Success(emptyList(), "2026-10-04T00:00:00Z"),
                        tasks = emptyList(),
                        themes = emptyList(),
                        proposals = emptyList(),
                        feedPosts = posts(),
                        paneState = TodayPaneState(),
                        onRetry = {}, onRetryPairing = {}, onPair = { _, _ -> },
                        onTaskSelected = onTask,
                        attentionOnline = true,
                        seenBefore = seenBefore,
                    )
                }
            }
        }
    }

    @Test
    fun showsAiAndOwnPostsInTheSameStreamNewestFirst() {
        show()
        composeRule.onNodeWithText("今日は粘度の実験を進める。").assertIsDisplayed()
        composeRule.onNodeWithText("自分").assertIsDisplayed()
        composeRule.onNodeWithTag("feed-post-ai-1").assertIsDisplayed()
        composeRule.onNodeWithText("Codex").assertIsDisplayed()
        composeRule.onNodeWithText("気づき").assertIsDisplayed()
        val own = composeRule.onNodeWithTag("feed-post-own-1").getBoundsInRoot().top.value
        val ai = composeRule.onNodeWithTag("feed-post-ai-1").getBoundsInRoot().top.value
        assertTrue(own < ai)
    }

    @Test
    fun ownPostsAreNeverCalledNew() {
        show()
        // 新着の語はAIの投稿だけに付く（自分で書いた投稿は数えない）。
        assertEquals(1, composeRule.onAllNodesWithText("新着").fetchSemanticsNodes().size)
    }

    @Test
    fun aLongPostIsCollapsedUntilTheReaderOpensIt() {
        show()
        composeRule.onNodeWithTag("ai-inbox-list").performScrollToNode(hasTestTag("feed-post-toggle-ai-1"))
        composeRule.onNodeWithText("もっと読む").assertIsDisplayed()
        composeRule.onNodeWithTag("feed-post-toggle-ai-1").performClick()
        // 広げると本文が伸びるので、閉じる操作の位置まで読み進める。
        composeRule.onNodeWithTag("ai-inbox-list").performScrollToNode(hasTestTag("feed-post-toggle-ai-1"))
        composeRule.onNodeWithText("閉じる").assertIsDisplayed()
    }

    @Test
    fun theTaskAndTheLinkAreOneTapAwayWithoutHidingTheBody() {
        var opened: String? = null
        show(onTask = { opened = it })
        composeRule.onNodeWithTag("ai-inbox-list").performScrollToNode(hasTestTag("feed-post-task-ai-1"))
        composeRule.onNodeWithText("粘度測定の条件を決める").assertIsDisplayed()
        composeRule.onNodeWithText("記事の草稿").assertIsDisplayed()
        composeRule.onNodeWithText("測定ガイド").assertIsDisplayed()
        composeRule.onNodeWithTag("feed-post-task-ai-1").performClick()
        assertEquals("task-1", opened)
    }
}
