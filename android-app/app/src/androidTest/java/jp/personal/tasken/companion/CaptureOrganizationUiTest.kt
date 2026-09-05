package jp.personal.tasken.companion

import android.graphics.Bitmap
import androidx.compose.runtime.MutableState
import androidx.compose.runtime.mutableStateOf
import androidx.compose.ui.test.assertIsEnabled
import androidx.compose.ui.test.assertIsNotEnabled
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
    fun organizedProposalRetainsOriginalAndIsSavedOnlyAfterExplicitAdd() {
        val draft = freshDraft()
        val result = CompletableDeferred<MobileCaptureOrganization>()
        val saved = mutableListOf<MobileCaptureDraft>()
        val requested = mutableListOf<MobileCaptureDraft>()
        showSheet(draft, organize = { requested += it; result.await() }, onSubmit = { saved += it })

        composeRule.onNodeWithTag("capture-organize").performScrollTo().performClick()
        composeRule.onNodeWithTag("capture-organizing").assertExists()
        composeRule.onNodeWithTag("capture-submit-close").assertIsNotEnabled()
        composeRule.runOnIdle {
            assertEquals(original, requested.single().text)
            assertEquals(emptyList<MobileCaptureDraft>(), saved)
            result.complete(proposal)
        }
        composeRule.waitUntil { draft.value.organization != null }
        composeRule.onNodeWithTag("capture-text-input").assertTextContains(proposal.title)
        composeRule.onNodeWithText("日付を確認してください。").assertExists()
        composeRule.onNodeWithTag("capture-text-input").performScrollTo()
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
        showSheet(draft, organize = { proposal })
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
        val result = CompletableDeferred<MobileCaptureOrganization>()
        showSheet(draft, organize = { result.await() })
        composeRule.onNodeWithTag("capture-organize").performScrollTo().performClick()
        val changed = "牛乳は家にあったので、卵だけ買う"
        composeRule.onNodeWithTag("capture-text-input").performScrollTo().performTextReplacement(changed)
        composeRule.runOnIdle { result.complete(proposal) }
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
        organize: suspend (MobileCaptureDraft) -> MobileCaptureOrganization,
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
                        val current = draft.value
                        draft.value = current.copy(
                            text = organized.title, projectId = organized.themeId, kind = MobileCaptureKind.Task,
                            organization = organized, originalText = current.originalText ?: current.text,
                        )
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
