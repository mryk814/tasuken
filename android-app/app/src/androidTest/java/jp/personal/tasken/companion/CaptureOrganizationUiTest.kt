package jp.personal.tasken.companion

import android.graphics.Bitmap
import androidx.compose.runtime.MutableState
import androidx.compose.runtime.mutableStateOf
import androidx.compose.ui.test.assertIsEnabled
import androidx.compose.ui.test.assertIsNotEnabled
import androidx.compose.ui.test.assertIsSelected
import androidx.compose.ui.test.assertTextContains
import androidx.compose.ui.test.assertTextEquals
import androidx.compose.ui.test.junit4.v2.createComposeRule
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performScrollTo
import androidx.compose.ui.test.performTextReplacement
import androidx.test.platform.app.InstrumentationRegistry
import java.io.File
import kotlinx.coroutines.CompletableDeferred
import org.junit.Assert.assertEquals
import org.junit.Rule
import org.junit.Test

class CaptureOrganizationUiTest {
    @get:Rule val composeRule = createComposeRule()
    private val original = "明日は牛乳と卵を買う。朝食用なので忘れないようにしたい。"
    private val proposal = MobileCaptureOrganization(
        title = "牛乳と卵を買う", themeId = "home", startDate = "2026-09-07",
        checklist = listOf("牛乳", "卵"), supplement = "朝食用。", warnings = listOf("日付を確認してください。"),
    )

    @Test
    fun secondCandidateUsesSameEditorAndExcludingFirstKeepsItsIdentity() {
        val draft = freshDraft()
        showSheet(draft, organize = { List(8) { proposal.copy(title = "候補 $it") } })
        composeRule.onNodeWithTag("capture-organize").performScrollTo().performClick()
        composeRule.waitUntil { draft.value.allOrganizations().size == 8 }
        selectCandidate(1)
        composeRule.onNodeWithTag("organization-title").performScrollTo().performTextReplacement("次の候補を編集")
        composeRule.onNodeWithTag("capture-theme-options").performScrollTo()
        composeRule.onNodeWithTag("capture-theme-none-option").performClick()
        composeRule.runOnIdle { assertEquals(null, draft.value.additionalOrganizations.first().themeId) }
        composeRule.onNodeWithTag("organization-end").performScrollTo().performTextReplacement("2026-09-20")
        composeRule.onNodeWithTag("organization-checklist").performScrollTo().performTextReplacement("確認する\n記録する")
        composeRule.onNodeWithTag("organization-supplement").performScrollTo().performTextReplacement("長い補足".repeat(100))
        capture("07-second-candidate-full-editor")
        selectCandidate(0)
        composeRule.onNodeWithTag("organization-select-0").assertIsSelected()
        composeRule.onNodeWithTag("organization-exclude").performScrollTo().performClick()
        composeRule.runOnIdle { assertEquals(true, draft.value.organization?.excluded) }
        selectCandidate(1)
        composeRule.onNodeWithTag("organization-title").assertTextContains("次の候補を編集")
        composeRule.onNodeWithTag("organization-end").assertTextContains("2026-09-20")
        composeRule.onNodeWithTag("organization-checklist").assertTextContains("確認する\n記録する")
        composeRule.runOnIdle {
            val before = draft.value
            draft.value = TodayPaneState.restore(TodayPaneState(captureDraft = before).save()).captureDraft
            assertEquals(before, draft.value)
            assertEquals("${before.draftId}:task:1", draft.value.organizedTaskDrafts().first().draftId)
            assertEquals(null, draft.value.organizedTaskDrafts().first().projectId)
        }
        composeRule.onNodeWithTag("organization-counts").performScrollTo().assertTextContains("追加対象 7件 · 除外 1件")
        capture("08-first-excluded")
        composeRule.runOnIdle {
            draft.value = draft.value.withEditedOrganizations(draft.value.allOrganizations().map { it.copy(excluded = true) })
        }
        composeRule.onNodeWithTag("capture-submit-close").assertIsNotEnabled()
        composeRule.onNodeWithTag("organization-counts").assertTextContains("追加対象 0件 · 除外 8件")
        capture("09-all-excluded")
        composeRule.onNodeWithTag("organization-exclude").performScrollTo().performClick()
        composeRule.onNodeWithTag("capture-submit-close").assertIsEnabled()
    }

    @Test
    fun timeAndDurationAreEditableForEveryProposalAndInvalidInputCannotBeSaved() {
        val timed = proposal.copy(plannedStartTime = "15:00", plannedDurationMinutes = 30, plannedTimeSupported = true)
        val draft = freshDraft()
        val saved = mutableListOf<MobileCaptureDraft>()
        showSheet(draft, organize = { listOf(timed, timed.copy(title = "資料の図を直す", plannedStartTime = null)) },
            onSubmit = { saved += it })
        composeRule.onNodeWithTag("capture-organize").performScrollTo().performClick()
        composeRule.waitUntil { draft.value.additionalOrganizations.size == 1 }
        composeRule.onNodeWithTag("organization-time").performScrollTo().assertTextContains("15:00")
        capture("05-planned-time-proposal")
        composeRule.onNodeWithTag("organization-time").performTextReplacement("16:")
        composeRule.onNodeWithTag("capture-submit-close").assertIsNotEnabled()
        composeRule.onNodeWithTag("organization-time").performTextReplacement("16:30")
        composeRule.onNodeWithTag("organization-duration").performTextReplacement("0")
        composeRule.onNodeWithTag("capture-submit-close").assertIsNotEnabled()
        composeRule.onNodeWithTag("organization-duration").performTextReplacement("60")
        selectCandidate(1)
        composeRule.onNodeWithTag("organization-duration").performScrollTo().performTextReplacement("45")
        capture("06-planned-time-additional-edited")
        composeRule.runOnIdle {
            assertEquals("16:30", draft.value.organization?.plannedStartTime)
            assertEquals(60, draft.value.organization?.plannedDurationMinutes)
            assertEquals(45, draft.value.additionalOrganizations.single().plannedDurationMinutes)
            draft.value = TodayPaneState.restore(TodayPaneState(captureDraft = draft.value).save()).captureDraft
        }
        composeRule.onNodeWithTag("organization-duration").assertTextContains("45")
        composeRule.onNodeWithTag("capture-submit-close").performScrollTo().assertIsEnabled().performClick()
        composeRule.runOnIdle {
            assertEquals(60, saved.single().organization?.plannedDurationMinutes)
            assertEquals(45, saved.single().additionalOrganizations.single().plannedDurationMinutes)
        }
    }

    @Test
    fun organizedProposalRetainsOriginalAndIsSavedOnlyAfterExplicitAdd() {
        val draft = freshDraft()
        val result = CompletableDeferred<List<MobileCaptureOrganization>>()
        val saved = mutableListOf<MobileCaptureDraft>()
        val requested = mutableListOf<MobileCaptureDraft>()
        showSheet(draft, organize = { requested += it; result.await() }, onSubmit = { saved += it })

        composeRule.onNodeWithTag("capture-organize").performScrollTo().performClick()
        composeRule.onNodeWithTag("capture-organizing").assertExists()
        composeRule.onNodeWithTag("capture-submit-close").assertIsNotEnabled()
        composeRule.runOnIdle {
            assertEquals(original, requested.single().text)
            assertEquals(emptyList<MobileCaptureDraft>(), saved)
            result.complete(listOf(proposal))
        }
        composeRule.waitUntil { draft.value.organization != null }
        composeRule.onNodeWithTag("organization-title").assertTextContains(proposal.title)
        composeRule.onNodeWithText("日付を確認してください。").assertExists()
        composeRule.onNodeWithTag("organization-title").performScrollTo()
        capture("01-organization-proposal")
        composeRule.onNodeWithText("元の入力を見る").performScrollTo().performClick()
        composeRule.onNodeWithTag("organization-original").assertTextEquals(original)
        composeRule.onNodeWithTag("organization-original").performScrollTo()
        capture("02-organization-original")
        composeRule.runOnIdle {
            assertEquals(proposal, draft.value.organization)
            assertEquals(original, draft.value.originalText)
            assertEquals("home", draft.value.projectId)
            assertEquals(emptyList<MobileCaptureDraft>(), saved)
        }
        composeRule.onNodeWithTag("capture-submit-close").performScrollTo().assertIsEnabled().performClick()
        composeRule.runOnIdle {
            assertEquals(proposal, saved.single().organization)
            assertEquals(original, saved.single().originalText)
        }
    }

    @Test
    fun discardingOrganizationRestoresOriginalInput() {
        val draft = freshDraft()
        showSheet(draft, organize = { listOf(proposal) })
        composeRule.onNodeWithTag("capture-organize").performScrollTo().performClick()
        composeRule.waitUntil { draft.value.organization != null }
        composeRule.onNodeWithText("整理を取り消す").performScrollTo().performClick()
        composeRule.onNodeWithTag("capture-text-input").assertTextContains(original)
        composeRule.onNodeWithTag("organization-original").assertDoesNotExist()
        composeRule.runOnIdle {
            assertEquals(original, draft.value.text)
            assertEquals(null, draft.value.organization)
            assertEquals(null, draft.value.originalText)
        }
        composeRule.onNodeWithTag("capture-submit-close").assertIsEnabled()
    }

    @Test
    fun multipleProposalsRemainReviewableAndCanBeRemovedBeforeAdding() {
        val second = MobileCaptureOrganization(
            title = "研究会の会場を予約", themeId = null, endDate = "2026-09-11",
            checklist = listOf("空きを確認", "予約する"), supplement = "",
        )
        val draft = freshDraft()
        showSheet(draft, organize = { listOf(proposal, second) })

        composeRule.onNodeWithTag("capture-organize").performScrollTo().performClick()
        composeRule.waitUntil { draft.value.additionalOrganizations.size == 1 }
        composeRule.onNodeWithTag("organization-counts").performScrollTo().assertTextEquals("追加対象 2件 · 除外 0件")
        selectCandidate(1)
        composeRule.onNodeWithText("研究会の会場を予約").assertExists()
        capture("03-organization-multiple")
        composeRule.onNodeWithText("このTaskを外す").performScrollTo()
        capture("04-organization-multiple-actions")
        composeRule.onNodeWithText("このTaskを外す").performClick()

        composeRule.runOnIdle {
            assertEquals(listOf(proposal), draft.value.organizedTaskDrafts().map { it.organization })
        }
        composeRule.onNodeWithTag("organization-counts").assertTextEquals("追加対象 1件 · 除外 1件")
    }

    @Test
    fun incompleteProposalEditsStayVisibleAndPreventSavingUntilCorrected() {
        val draft = freshDraft()
        showSheet(draft, organize = { listOf(proposal, proposal.copy(title = "別のTask")) })
        composeRule.onNodeWithTag("capture-organize").performScrollTo().performClick()
        composeRule.waitUntil { draft.value.additionalOrganizations.size == 1 }
        selectCandidate(1)
        composeRule.onNodeWithTag("organization-title")
            .performScrollTo().performTextReplacement("")
        composeRule.onNodeWithTag("capture-submit-close").assertIsNotEnabled()
        composeRule.runOnIdle { assertEquals("", draft.value.additionalOrganizations.single().title) }
        composeRule.onNodeWithTag("organization-title")
            .performScrollTo().performTextReplacement("別のTaskを修正")
        composeRule.onNodeWithTag("capture-submit-close").assertIsEnabled()
        selectCandidate(0)
        composeRule.onNodeWithTag("organization-start").performScrollTo().performTextReplacement("2026-")
        composeRule.onNodeWithTag("capture-submit-close").assertIsNotEnabled()
        composeRule.runOnIdle { assertEquals("2026-", draft.value.organization?.startDate) }
        composeRule.onNodeWithTag("organization-start").performTextReplacement("2026-09-08")
        composeRule.onNodeWithTag("capture-submit-close").assertIsEnabled()
    }

    @Test
    fun failedOrganizationKeepsInputAndAllowsNormalAddWithoutExposingProviderError() {
        val draft = freshDraft()
        val saved = mutableListOf<MobileCaptureDraft>()
        showSheet(draft, organize = { error("private-provider-error") }, onSubmit = { saved += it })
        composeRule.onNodeWithTag("capture-organize").performScrollTo().performClick()
        composeRule.onNodeWithTag("capture-organization-error").assertExists()
        composeRule.onNodeWithText("private-provider-error").assertDoesNotExist()
        composeRule.onNodeWithTag("capture-text-input").assertTextContains(original)
        composeRule.runOnIdle { assertEquals(null, draft.value.organization) }
        composeRule.onNodeWithTag("capture-submit-close").performScrollTo().assertIsEnabled().performClick()
        composeRule.runOnIdle { assertEquals(original, saved.single().text) }
    }

    @Test
    fun delayedOrganizationDoesNotOverwriteTextEditedWhileWaiting() {
        val draft = freshDraft()
        val result = CompletableDeferred<List<MobileCaptureOrganization>>()
        showSheet(draft, organize = { result.await() })
        composeRule.onNodeWithTag("capture-organize").performScrollTo().performClick()
        val changed = "牛乳は家にあったので、卵だけ買う"
        composeRule.onNodeWithTag("capture-text-input").performScrollTo().performTextReplacement(changed)
        composeRule.runOnIdle { result.complete(listOf(proposal)) }
        composeRule.waitForIdle()
        composeRule.onNodeWithTag("capture-organizing").assertDoesNotExist()
        composeRule.onNodeWithTag("capture-text-input").assertTextContains(changed)
        composeRule.runOnIdle {
            assertEquals(changed, draft.value.text)
            assertEquals(null, draft.value.organization)
            assertEquals(null, draft.value.originalText)
        }
        composeRule.onNodeWithTag("capture-submit-close").assertIsEnabled()
    }

    private fun selectCandidate(index: Int) {
        // The chips have their own horizontal scroller; reveal its parent vertically first.
        composeRule.onNodeWithTag("organization-counts").performScrollTo()
        composeRule.onNodeWithTag("organization-select-$index").performScrollTo().performClick()
        composeRule.onNodeWithTag("organization-select-$index").assertIsSelected()
    }

    private fun freshDraft() = mutableStateOf(MobileCaptureDraft.fresh(text = original))

    private fun capture(name: String) {
        composeRule.waitForIdle()
        val instrumentation = InstrumentationRegistry.getInstrumentation()
        val directory = File(instrumentation.targetContext.getExternalFilesDir(null), "ux-organization")
        check(directory.isDirectory || directory.mkdirs())
        val screenshot = checkNotNull(instrumentation.uiAutomation.takeScreenshot())
        File(directory, "$name.png").outputStream().use {
            check(screenshot.compress(Bitmap.CompressFormat.PNG, 100, it))
        }
        screenshot.recycle()
    }

    private fun showSheet(
        draft: MutableState<MobileCaptureDraft>,
        organize: suspend (MobileCaptureDraft) -> List<MobileCaptureOrganization>,
        onSubmit: (MobileCaptureDraft) -> Unit = {},
    ) {
        composeRule.setContent {
            TaskenTheme {
                CaptureTaskSheet(
                    draft = draft.value,
                    state = CaptureUiState.Idle,
                    speechState = ShortSpeechUiState.Idle(MobileSpeechRecognitionMode.OnDevice),
                    themes = listOf(MobileTheme("home", "生活")),
                    themeCatalogState = MobileThemeCatalogState.Available(
                        listOf(MobileTheme("home", "生活")), "fixture", 1, "",
                    ),
                    onDraftChanged = { draft.value = draft.value.withText(it) },
                    onThemeSelected = { draft.value = draft.value.withThemeId(it) },
                    onKindSelected = { draft.value = draft.value.withKind(it) },
                    onOrganize = organize,
                    onOrganizationChanged = { organized ->
                        draft.value = draft.value.withEditedOrganizations(organized)
                    },
                    onOrganizationDiscarded = {
                        val current = draft.value
                        draft.value = current.copy(
                            text = current.originalText ?: current.text, organization = null, originalText = null,
                        )
                    },
                    onSubmit = { onSubmit(draft.value) },
                    onStartVoice = {}, onStopVoice = {}, onDismiss = {},
                )
            }
        }
    }
}
