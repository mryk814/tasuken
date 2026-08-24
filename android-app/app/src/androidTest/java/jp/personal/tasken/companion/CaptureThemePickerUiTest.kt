package jp.personal.tasken.companion

import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.material3.MaterialTheme
import androidx.compose.runtime.mutableStateOf
import androidx.compose.ui.test.assert
import androidx.compose.ui.test.assertHeightIsEqualTo
import androidx.compose.ui.test.assertIsEnabled
import androidx.compose.ui.test.assertTextContains
import androidx.compose.ui.test.hasStateDescription
import androidx.compose.ui.test.junit4.v2.createComposeRule
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performScrollTo
import androidx.compose.ui.unit.dp
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test

class CaptureThemePickerUiTest {
    @get:Rule
    val composeRule = createComposeRule()

    @Test
    fun quickAddStartsWithNoThemeAndCanSelectThenClear() {
        val baseDraft = MobileCaptureDraft.fresh(text = "Theme付きで追加")
        val selectedThemeId = mutableStateOf<String?>(null)
        val themes = sampleThemes()
        composeRule.setContent {
            MaterialTheme {
                CaptureTaskSheet(
                    draft = baseDraft.copy(projectId = selectedThemeId.value),
                    state = CaptureUiState.Idle,
                    speechState = ShortSpeechUiState.Idle(MobileSpeechRecognitionMode.OnDevice),
                    themes = themes,
                    themeCatalogState = MobileThemeCatalogState.Available(
                        themes = themes,
                        serverId = "server-1",
                        serverRevision = 1,
                        generatedAt = "2026-08-23T00:00:00Z",
                    ),
                    onDraftChanged = {},
                    onThemeSelected = { selectedThemeId.value = it },
                    onKindSelected = {},
                    onSubmit = {},
                    onStartVoice = {},
                    onStopVoice = {},
                    onDismiss = {},
                )
            }
        }

        composeRule.onNodeWithTag("capture-theme-picker")
            .assertIsEnabled()
            .assertTextContains("Themeなし")
            .assert(hasStateDescription("Themeなし"))
            .performClick()
        composeRule.onNodeWithTag("capture-theme-option-theme-research").performClick()

        composeRule.runOnIdle { assertEquals("theme-research", selectedThemeId.value) }
        composeRule.onNodeWithTag("capture-theme-picker")
            .assertTextContains("Research")
            .performClick()
        composeRule.onNodeWithTag("capture-theme-none-option").performClick()
        composeRule.runOnIdle { assertNull(selectedThemeId.value) }
    }

    @Test
    fun quickAddExposesCloseAndContinueCompletionBehaviors() {
        val submitted = mutableListOf<CaptureCompletionBehavior>()
        composeRule.setContent {
            MaterialTheme {
                CaptureTaskSheet(
                    draft = MobileCaptureDraft.fresh(text = "連続入力"),
                    state = CaptureUiState.Idle,
                    speechState = ShortSpeechUiState.Idle(MobileSpeechRecognitionMode.OnDevice),
                    themes = emptyList(),
                    themeCatalogState = MobileThemeCatalogState.Available(
                        themes = emptyList(),
                        serverId = "server-1",
                        serverRevision = 1,
                        generatedAt = "2026-08-23T00:00:00Z",
                    ),
                    onDraftChanged = {},
                    onThemeSelected = {},
                    onKindSelected = {},
                    onSubmit = { submitted += it },
                    onStartVoice = {},
                    onStopVoice = {},
                    onDismiss = {},
                )
            }
        }

        composeRule.onNodeWithTag("capture-submit-continue").performScrollTo().performClick()
        composeRule.onNodeWithTag("capture-submit-close").performScrollTo().performClick()

        composeRule.runOnIdle {
            assertEquals(
                listOf(CaptureCompletionBehavior.Continue, CaptureCompletionBehavior.Close),
                submitted,
            )
        }
    }

    @Test
    fun quickAddKeepsSubmitActionsAboveBottomSystemInset() {
        composeRule.setContent {
            MaterialTheme {
                CaptureTaskSheet(
                    draft = MobileCaptureDraft.fresh(text = "下端操作を守る"),
                    state = CaptureUiState.Idle,
                    speechState = ShortSpeechUiState.Idle(MobileSpeechRecognitionMode.OnDevice),
                    themes = emptyList(),
                    themeCatalogState = MobileThemeCatalogState.Available(
                        themes = emptyList(),
                        serverId = "server-1",
                        serverRevision = 1,
                        generatedAt = "2026-08-24T00:00:00Z",
                    ),
                    onDraftChanged = {},
                    onThemeSelected = {},
                    onKindSelected = {},
                    onSubmit = {},
                    onStartVoice = {},
                    onStopVoice = {},
                    onDismiss = {},
                    bottomContentInsets = WindowInsets(bottom = 96.dp),
                )
            }
        }

        composeRule.onNodeWithTag("capture-bottom-inset-spacer").performScrollTo()
        val actionBounds = composeRule.onNodeWithTag("capture-submit-row")
            .fetchSemanticsNode().boundsInRoot
        val insetNode = composeRule.onNodeWithTag("capture-bottom-inset-spacer")
        val insetBounds = insetNode.fetchSemanticsNode().boundsInRoot

        insetNode.assertHeightIsEqualTo(96.dp)
        assertTrue(
            "Submit actions must precede the bottom inset: actions=$actionBounds inset=$insetBounds",
            actionBounds.bottom <= insetBounds.top + 1f,
        )
    }

    @Test
    fun quickAddSwitchesBetweenTaskAndCanonicalCapture() {
        val selectedKind = mutableStateOf(MobileCaptureKind.Task)
        composeRule.setContent {
            MaterialTheme {
                CaptureTaskSheet(
                    draft = MobileCaptureDraft.fresh(
                        text = "思いつき",
                        kind = selectedKind.value,
                    ),
                    state = CaptureUiState.Idle,
                    speechState = ShortSpeechUiState.Idle(MobileSpeechRecognitionMode.OnDevice),
                    themes = emptyList(),
                    themeCatalogState = MobileThemeCatalogState.Available(
                        themes = emptyList(),
                        serverId = "server-1",
                        serverRevision = 1,
                        generatedAt = "2026-08-23T00:00:00Z",
                    ),
                    onDraftChanged = {},
                    onThemeSelected = {},
                    onKindSelected = { selectedKind.value = it },
                    onSubmit = {},
                    onStartVoice = {},
                    onStopVoice = {},
                    onDismiss = {},
                )
            }
        }

        composeRule.onNodeWithTag("capture-kind-capture").performClick()

        composeRule.runOnIdle { assertEquals(MobileCaptureKind.Capture, selectedKind.value) }
        composeRule.onNodeWithText("思いついたことをそのまま").assertExists()
    }

    @Test
    fun staleCatalogKeepsMissingSelectionVisibleUntilExplicitReplacement() {
        val selectedThemeId = mutableStateOf<String?>("theme-missing")
        val themes = sampleThemes()
        composeRule.setContent {
            MaterialTheme {
                CaptureThemePicker(
                    draftId = "draft-stale",
                    themeId = selectedThemeId.value,
                    themes = themes,
                    catalogState = MobileThemeCatalogState.Stale(
                        themes = themes,
                        serverId = "server-1",
                        serverRevision = 1,
                        generatedAt = "2026-08-23T00:00:00Z",
                        message = "offline",
                    ),
                    enabled = true,
                    onThemeSelected = { selectedThemeId.value = it },
                )
            }
        }

        composeRule.onNodeWithTag("capture-theme-picker")
            .assertIsEnabled()
            .assertTextContains("選択済みTheme（一覧外）")
            .assert(hasStateDescription("選択中のThemeは一覧外"))
            .performClick()
        composeRule.onNodeWithTag("capture-theme-option-theme-personal").performClick()

        composeRule.runOnIdle { assertEquals("theme-personal", selectedThemeId.value) }
        composeRule.onNodeWithText("オフラインのTheme一覧を使用中です。").assertExists()
    }

    private fun sampleThemes(): List<MobileTheme> = listOf(
        MobileTheme("theme-research", "Research"),
        MobileTheme("theme-personal", "Personal"),
    )
}
