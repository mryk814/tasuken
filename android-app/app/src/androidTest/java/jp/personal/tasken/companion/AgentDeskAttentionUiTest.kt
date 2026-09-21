package jp.personal.tasken.companion

import androidx.compose.material3.MaterialTheme
import androidx.compose.runtime.mutableStateOf
import androidx.compose.ui.semantics.SemanticsProperties
import androidx.compose.ui.test.SemanticsMatcher
import androidx.compose.ui.test.assert
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.assertIsEnabled
import androidx.compose.ui.test.assertIsNotEnabled
import androidx.compose.ui.test.assertTextContains
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performScrollTo
import androidx.compose.ui.test.performTextInput
import androidx.compose.ui.text.AnnotatedString
import org.junit.Assert.assertEquals
import org.junit.Rule
import org.junit.Test

/**
 * Agent Deskの要対応と回答（#601）。
 *
 * Desktopが返した意味を表示するだけで、画面側で件数や状態を作り直さない。
 * 未取得（null）と0件、未送信と正式成功を区別する。
 */
class AgentDeskAttentionUiTest {
    @get:Rule
    val composeRule = createComposeRule()

    private fun pane(
        attention: List<AttentionRow> = listOf(question(), review()),
        counts: MobileAttentionCountsDto? = MobileAttentionCountsDto(needsYou = 2, working = 1, queued = 1),
        online: Boolean = true,
        refreshing: Boolean = false,
        agentReplyState: AgentReplyUiState = AgentReplyUiState.Idle,
        onRefresh: () -> Unit = {},
        onReply: (AttentionRow, String?, String) -> Unit = { _, _, _ -> },
        onReset: () -> Unit = {},
        paneState: TodayPaneState = TodayPaneState(),
    ) {
        composeRule.setContent {
            MaterialTheme {
                AiInboxListPane(
                    uiState = cachedState(),
                    tasks = emptyList(),
                    themes = emptyList(),
                    proposals = emptyList(),
                    paneState = paneState,
                    onRetry = {},
                    onRetryPairing = {},
                    onPair = { _, _ -> },
                    onTaskSelected = {},
                    attention = attention,
                    attentionCounts = counts,
                    attentionFetchedAt = "2026-09-20T08:00:00Z",
                    attentionOnline = online,
                    attentionRefreshing = refreshing,
                    agentReplyState = agentReplyState,
                    onRefreshAttention = onRefresh,
                    onReplyToAgent = onReply,
                    onResetAgentReply = onReset,
                    // 画面と同じく、回答欄の開閉と下書きは paneState が持つ。
                    selectedAttentionId = paneState.selectedAttentionId,
                    onAttentionSelected = { row -> paneState.openAttention(row.attentionId) },
                )
            }
        }
    }

    private fun cachedState() = TodayUiState.Cached(
        tasks = emptyList(),
        generatedAt = "2026-09-20T00:00:00Z",
        message = "Desktopへ接続できません。",
        recovery = TodayUiState.CachedRecovery.Reload,
    )

    @Test
    fun showsTheDesktopCountsAndRowsWithoutRecomputingThem() {
        pane()

        // 件数はDesktopの判断単位の数。画面側で数え直さない。
        composeRule.onNodeWithText("対応待ち 2").assertIsDisplayed()
        composeRule.onNodeWithText("作業中 1").assertIsDisplayed()
        composeRule.onNodeWithText("開始待ち 1").assertIsDisplayed()
        // 開始待ちは「開始は未確認」と示す。取得済みとは書かない。
        composeRule.onNodeWithText("開始は未確認").assertIsDisplayed()
        composeRule.onNodeWithText("回答待ち").assertIsDisplayed()
        composeRule.onNodeWithText("成果確認").assertIsDisplayed()
        composeRule.onNodeWithTag("attention-row-${question().attentionId}").assertIsDisplayed()
        composeRule.onNodeWithTag("attention-row-${review().attentionId}").assertIsDisplayed()
        capture("01-attention-list")
    }

    @Test
    fun theReplyEditorAndTheConflictMessageStayOnScreen() {
        pane(
            attention = listOf(question()),
            agentReplyState = AgentReplyUiState.Conflict(
                question().attentionId,
                "同じIDが既に存在するか、対象が更新済みです。再読み込みして再試行してください。",
            ),
        )

        composeRule.onNodeWithTag("attention-reply-open-${question().attentionId}").performScrollTo().performClick()
        composeRule.onNodeWithTag("attention-reply-text").performTextInput("25℃で進めてください。")
        composeRule.onNodeWithTag("attention-reply-editor").assertIsDisplayed()
        capture("02-attention-reply")
    }

    private fun capture(name: String) {
        composeRule.waitForIdle()
        val instrumentation = androidx.test.platform.app.InstrumentationRegistry.getInstrumentation()
        val directory =
            java.io.File(instrumentation.targetContext.getExternalFilesDir(null), "agent-desk").apply { mkdirs() }
        val screenshot = checkNotNull(instrumentation.uiAutomation.takeScreenshot())
        java.io.File(directory, "$name.png").outputStream().use {
            check(screenshot.compress(android.graphics.Bitmap.CompressFormat.PNG, 100, it))
        }
        screenshot.recycle()
    }

    @Test
    fun anUnfetchedQueueIsNotShownAsZero() {
        pane(attention = emptyList(), counts = null, online = false)

        composeRule.onNodeWithTag("attention-unavailable").assertIsDisplayed()
        composeRule.onNodeWithText("要対応をまだ取得できていません。").assertIsDisplayed()
        // 「0件」と書かない。取得できていない状態を成功として見せない。
        composeRule.onNodeWithText("対応待ち 0").assertDoesNotExist()
        composeRule.onNodeWithTag("attention-empty").assertDoesNotExist()
    }

    @Test
    fun anEmptyQueueIsShownAsZeroWhenItWasFetched() {
        pane(attention = emptyList(), counts = MobileAttentionCountsDto(0, 0, 0))

        composeRule.onNodeWithText("対応待ち 0").assertIsDisplayed()
        composeRule.onNodeWithTag("attention-empty").assertIsDisplayed()
        composeRule.onNodeWithTag("attention-unavailable").assertDoesNotExist()
    }

    @Test
    fun onlyQuestionsOfferAReply() {
        pane()

        // 成果確認は回答ではない。Taskを開いて確認する。
        composeRule.onNodeWithTag("attention-reply-open-${review().attentionId}").assertDoesNotExist()
        composeRule.onNodeWithTag("attention-open-task-${review().attentionId}").assertIsDisplayed()
        composeRule.onNodeWithTag("attention-reply-open-${question().attentionId}").assertIsDisplayed()
    }

    @Test
    fun replyingKeepsTheDraftUntilTheDesktopConfirms() {
        pane(attention = listOf(question()))

        composeRule.onNodeWithTag("attention-reply-open-${question().attentionId}").performScrollTo().performClick()
        composeRule.onNodeWithTag("attention-reply-editor").assertIsDisplayed()
        // 空のままでは送れない。
        composeRule.onNodeWithTag("attention-reply-send").assertIsNotEnabled()
        composeRule.onNodeWithTag("attention-reply-text").performTextInput("25℃で進めてください。")
        composeRule.onNodeWithTag("attention-reply-send").assertIsEnabled()
    }

    @Test
    fun sendingPassesTheQuestionAndTheBody() {
        val sent = mutableListOf<Pair<String, String>>()
        val paneState = TodayPaneState()
        composeRule.setContent {
            MaterialTheme {
                AiInboxListPane(
                    uiState = cachedState(),
                    tasks = emptyList(),
                    themes = emptyList(),
                    proposals = emptyList(),
                    paneState = paneState,
                    onRetry = {},
                    onRetryPairing = {},
                    onPair = { _, _ -> },
                    onTaskSelected = {},
                    attention = listOf(question()),
                    attentionCounts = MobileAttentionCountsDto(needsYou = 1, working = 0, queued = 0),
                    attentionOnline = true,
                    onReplyToAgent = { item, _, body -> sent += item.attentionId to body },
                    selectedAttentionId = paneState.selectedAttentionId,
                    onAttentionSelected = { row -> paneState.openAttention(row.attentionId) },
                )
            }
        }

        composeRule.onNodeWithTag("attention-reply-open-${question().attentionId}").performScrollTo().performClick()
        composeRule.onNodeWithTag("attention-reply-text").performTextInput("25℃で進めてください。")
        composeRule.onNodeWithTag("attention-reply-send").performClick()

        assertEquals(listOf(question().attentionId to "25℃で進めてください。"), sent)
    }

    @Test
    fun offlineStopsTheSendAndKeepsTheInput() {
        pane(online = false, attention = listOf(question()))

        composeRule.onNodeWithTag("attention-reply-open-${question().attentionId}").performScrollTo().performClick()
        composeRule.onNodeWithTag("attention-reply-text").performTextInput("25℃で進めてください。")
        // 接続できない間は送らない。入力を消して成功に見せない。
        composeRule.onNodeWithTag("attention-reply-send").assertIsNotEnabled()
        composeRule.onNodeWithText("Desktopへ接続してから回答してください。").assertIsDisplayed()
        composeRule.onNodeWithTag("attention-stale").assertIsDisplayed()
    }

    @Test
    fun aConflictIsShownAndTheAnswerCanBeRetried() {
        pane(
            attention = listOf(question()),
            agentReplyState = AgentReplyUiState.Conflict(
                question().attentionId,
                "同じIDが既に存在するか、対象が更新済みです。再読み込みして再試行してください。",
            ),
        )

        composeRule.onNodeWithTag("attention-reply-open-${question().attentionId}").performScrollTo().performClick()
        composeRule.onNodeWithText("同じIDが既に存在するか、対象が更新済みです。再読み込みして再試行してください。")
            .assertIsDisplayed()
    }

    @Test
    fun anUnknownKindStaysVisibleAndIsNotAnswerable() {
        pane(attention = listOf(review().copy(attentionId = "unknown-1", kind = AttentionKind.Unknown, canReply = false)))

        composeRule.onNodeWithText("要確認").assertIsDisplayed()
        composeRule.onNodeWithTag("attention-row-unknown-1").assertIsDisplayed()
        composeRule.onNodeWithTag("attention-reply-open-unknown-1").assertDoesNotExist()
    }

    /**
     * Foldの展開幅（#601）。一覧の隣の詳細ペインへ開き、回答はそこで書く。
     * 1列のときの行の直下の回答欄と、同じ意味のまま置き場所だけを変える。
     */
    @Test
    fun expandedWidthOpensTheReplyInTheDetailPane() {
        var selected: AttentionRow? = null
        composeRule.setContent {
            MaterialTheme {
                AiInboxListPane(
                    uiState = cachedState(),
                    tasks = emptyList(),
                    themes = emptyList(),
                    proposals = emptyList(),
                    paneState = TodayPaneState(),
                    onRetry = {},
                    onRetryPairing = {},
                    onPair = { _, _ -> },
                    onTaskSelected = {},
                    attention = listOf(question()),
                    attentionCounts = MobileAttentionCountsDto(needsYou = 1, working = 0, queued = 0),
                    attentionOnline = true,
                    attentionInDetailPane = true,
                    selectedAttentionId = question().attentionId,
                    onAttentionSelected = { selected = it },
                )
            }
        }

        composeRule.onNodeWithTag("attention-reply-open-${question().attentionId}").performScrollTo().performClick()

        assertEquals(question().attentionId, selected?.attentionId)
        // 一覧の行の直下には回答欄を置かない（詳細ペインが受け持つ）。
        composeRule.onNodeWithTag("attention-reply-editor").assertDoesNotExist()
    }

    /** 詳細ペインの内容と送信（#601）。表示は Desktop が返した値をそのまま使う。 */
    @Test
    fun detailPaneShowsTheQuestionAndSendsTheReply() {
        var sent = ""
        val body = mutableStateOf("")
        composeRule.setContent {
            MaterialTheme {
                AttentionDetailPane(
                    row = question(),
                    body = body.value,
                    onBodyChange = { body.value = it },
                    state = AgentReplyUiState.Idle,
                    online = true,
                    onSend = { sent = "send" },
                    onOpenTask = {},
                    onBack = {},
                )
            }
        }

        composeRule.onNodeWithTag("attention-detail").assertIsDisplayed()
        composeRule.onNodeWithTag("attention-detail-question").assertIsDisplayed()
        composeRule.onNodeWithText("25℃と40℃のどちらで進めますか。").assertIsDisplayed()
        // 本文が空のままでは送らない。
        composeRule.onNodeWithTag("attention-detail-reply-send").assertIsNotEnabled()
        composeRule.onNodeWithTag("attention-detail-reply-text").performTextInput("25℃で進めてください。")
        composeRule.onNodeWithTag("attention-detail-reply-send").performClick()

        assertEquals("send", sent)
    }

    /** 競合しても、詳細ペインの入力と説明を残す（#601）。 */
    @Test
    fun detailPaneKeepsTheInputWhenTheReplyConflicts() {
        composeRule.setContent {
            MaterialTheme {
                AttentionDetailPane(
                    row = question(),
                    body = "25℃で進めてください。",
                    onBodyChange = {},
                    state = AgentReplyUiState.Conflict(
                        question().attentionId,
                        "同じIDが既に存在するか、対象が更新済みです。再読み込みして再試行してください。",
                    ),
                    online = false,
                    onSend = {},
                    onOpenTask = null,
                    onBack = null,
                )
            }
        }

        composeRule.onNodeWithTag("attention-detail-reply-text").assertIsDisplayed()
        composeRule.onNodeWithText("同じIDが既に存在するか、対象が更新済みです。再読み込みして再試行してください。")
            .assertIsDisplayed()
        composeRule.onNodeWithText("Desktopへ接続してから回答してください。").assertIsDisplayed()
        composeRule.onNodeWithTag("attention-detail-reply-send").assertIsNotEnabled()
        // 一覧へ戻る導線は1列のときだけ出す。
        composeRule.onNodeWithTag("attention-detail-back").assertDoesNotExist()
    }

    /**
     * 新着の知らせ（#601）。既定はアプリ内表示で、押すとその判断へ移動する。
     * 行の本文全体は出さず、件数だけを短く示す。
     */
    @Test
    fun showsNewArrivalsInAppAndOpensTheFirstOne() {
        var opened: AttentionRow? = null
        composeRule.setContent {
            MaterialTheme {
                AiInboxListPane(
                    uiState = cachedState(),
                    tasks = emptyList(),
                    themes = emptyList(),
                    proposals = emptyList(),
                    paneState = TodayPaneState(),
                    onRetry = {},
                    onRetryPairing = {},
                    onPair = { _, _ -> },
                    onTaskSelected = {},
                    attention = listOf(question(), review()),
                    attentionCounts = MobileAttentionCountsDto(needsYou = 2, working = 0, queued = 0),
                    attentionOnline = true,
                    attentionNewArrivals = listOf(review()),
                    onOpenNewArrival = { opened = it },
                )
            }
        }

        composeRule.onNodeWithTag("attention-new-arrivals").assertIsDisplayed()
        composeRule.onNodeWithText("新しい対応待ち 1件").assertIsDisplayed()
        composeRule.onNodeWithTag("attention-new-arrivals").performScrollTo().performClick()

        assertEquals(review().attentionId, opened?.attentionId)
    }

    /** 新着が無いときは知らせを出さない（同じ判断の再送で再通知しない）。 */
    @Test
    fun hidesTheNewArrivalNoticeWhenThereIsNothingNew() {
        pane(attention = listOf(question(), review()))

        composeRule.onNodeWithTag("attention-new-arrivals").assertDoesNotExist()
    }

    /** 下書きは面を離れて戻っても、画面が作り直されても残る（#601 の下書き保持）。 */
    @Test
    fun theDraftSurvivesLeavingAndReturningToTheAgentDesk() {
        val paneState = TodayPaneState()
        val showingAgentDesk = mutableStateOf(true)
        composeRule.setContent {
            MaterialTheme {
                if (showingAgentDesk.value) {
                    AiInboxListPane(
                        uiState = cachedState(),
                        tasks = emptyList(),
                        themes = emptyList(),
                        proposals = emptyList(),
                        paneState = paneState,
                        onRetry = {},
                        onRetryPairing = {},
                        onPair = { _, _ -> },
                        onTaskSelected = {},
                        attention = listOf(question()),
                        attentionCounts = MobileAttentionCountsDto(needsYou = 1, working = 0, queued = 0),
                        attentionOnline = true,
                        selectedAttentionId = paneState.selectedAttentionId,
                        onAttentionSelected = { row -> paneState.openAttention(row.attentionId) },
                    )
                } else {
                    androidx.compose.material3.Text("別の面")
                }
            }
        }

        composeRule
            .onNodeWithTag("attention-reply-open-${question().attentionId}")
            .performScrollTo()
            .performClick()
        composeRule.onNodeWithTag("attention-reply-text").performTextInput("25℃で進めてください。")

        // 別の面へ移って戻る。下書きは paneState にあるので消えない。
        composeRule.runOnUiThread { showingAgentDesk.value = false }
        composeRule.waitForIdle()
        composeRule.runOnUiThread { showingAgentDesk.value = true }
        composeRule.waitForIdle()

        composeRule.onNodeWithTag("attention-reply-editor").assertIsDisplayed()
        composeRule.onNodeWithTag("attention-reply-text").assertTextContains("25℃で進めてください。")
        composeRule.onNodeWithTag("attention-reply-send").assertIsEnabled()
        capture("06-attention-draft-restored")
    }

    /** 別の質問へ移ると、前の下書きは混ざらない（取り違えたまま送らない）。 */
    @Test
    fun openingAnotherQuestionDoesNotCarryThePreviousDraft() {
        val paneState = TodayPaneState()
        pane(attention = listOf(question(), secondQuestion()), paneState = paneState)

        composeRule
            .onNodeWithTag("attention-reply-open-${question().attentionId}")
            .performScrollTo()
            .performClick()
        composeRule.onNodeWithTag("attention-reply-text").performTextInput("25℃で進めてください。")

        // 同じ質問を開き直しても下書きは残る。
        composeRule
            .onNodeWithTag("attention-reply-open-${question().attentionId}")
            .performScrollTo()
            .performClick()
        composeRule.onNodeWithTag("attention-reply-text").assertTextContains("25℃で進めてください。")

        // 別の質問へ移ると空から始まる。
        composeRule
            .onNodeWithTag("attention-reply-open-${secondQuestion().attentionId}")
            .performScrollTo()
            .performClick()
        composeRule
            .onNodeWithTag("attention-reply-text")
            .assert(SemanticsMatcher.expectValue(SemanticsProperties.EditableText, AnnotatedString("")))
        composeRule.onNodeWithTag("attention-reply-send").assertIsNotEnabled()
        capture("07-attention-draft-other-question")
    }

    private fun question() = AttentionRow(
        attentionId = "task-work:request:1",
        kind = AttentionKind.AnswerRequest,
        taskId = "task-viscosity",
        taskTitle = "粘度測定の条件を決める",
        taskVersion = 12,
        headline = "測定温度が決まっていません。",
        summary = "測定温度が決まっていません。",
        questionOrAction = "25℃と40℃のどちらで進めますか。",
        agentLabel = "Codex",
        requestId = "33333333-3333-4333-8333-333333333333",
        canReply = true,
    )

    /** 2つ目の質問。下書きが別の判断へ混ざらないことを確かめる。 */
    private fun secondQuestion() = AttentionRow(
        attentionId = "task-work:request:2",
        kind = AttentionKind.AnswerRequest,
        taskId = "task-viscosity",
        taskTitle = "粘度測定の条件を決める",
        taskVersion = 12,
        headline = "サンプル数が決まっていません。",
        summary = "サンプル数が決まっていません。",
        questionOrAction = "何回測りますか。",
        agentLabel = "Codex",
        requestId = "44444444-4444-4444-8444-444444444444",
        canReply = true,
    )

    private fun review() = AttentionRow(        attentionId = "task-work:review:1",
        kind = AttentionKind.ReviewReport,
        taskId = "task-review",
        taskTitle = "比較表の作成",
        taskVersion = 7,
        headline = "3条件の比較表を作成しました。",
        summary = "3条件の比較表を作成しました。",
        questionOrAction = "成果を確認してください。",
        agentLabel = "Codex",
        requestId = null,
        canReply = false,
    )
}
