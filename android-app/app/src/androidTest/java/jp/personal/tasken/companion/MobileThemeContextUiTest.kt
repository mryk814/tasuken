package jp.personal.tasken.companion

import android.graphics.Bitmap
import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.v2.createComposeRule
import androidx.test.platform.app.InstrumentationRegistry
import java.io.File
import kotlinx.coroutines.flow.MutableStateFlow
import org.junit.Rule
import org.junit.Test

class MobileThemeContextUiTest {
    @get:Rule val compose = createComposeRule()
    private val repository = FixtureRepository()
    private fun content() { compose.setContent { TaskenTheme { MobileThemeContextSheet(repository, "theme", {}) } } }

    @Test fun fullAndLongCachedContentRemainsReadableWhileOffline() {
        val theme = themeContextFixture()
        repository.state.value = ThemeContextState(ThemeContextContent.Available, theme, "2026-09-06T08:00:00Z", ThemeContextFailure.Offline)
        content()
        compose.onNodeWithText(theme.title).assertIsDisplayed()
        compose.onNodeWithText("端末に保存した内容です。古い可能性があります。").assertIsDisplayed()
        compose.onNodeWithText(theme.charter!!.purpose).assertIsDisplayed()
        screenshot("01-full-cached")
        compose.onNodeWithText(theme.currentState!!.next_frontier).performScrollTo().assertIsDisplayed()
        compose.onNodeWithTag("theme-context-close").assertIsDisplayed()
        screenshot("02-current-state")
        val longPurpose = "測定条件と結果の関係を確かめる。\n".repeat(120)
        compose.runOnIdle { repository.state.value = repository.state.value.copy(theme = theme.copy(charter = theme.charter.copy(purpose = longPurpose))) }
        compose.onNodeWithText(longPurpose).performScrollTo().assertExists()
        screenshot("03-long")
    }

    @Test fun unfetchedUnsupportedUnsetPartialAndRemovedAreDistinct() {
        content()
        compose.onNodeWithText("Themeの目的・現在地は未取得です。").assertIsDisplayed()
        screenshot("04-unfetched")
        compose.runOnIdle { repository.state.value = ThemeContextState(failure = ThemeContextFailure.Unsupported) }
        compose.onNodeWithText("このDesktopはTheme詳細の取得に対応していません。").assertIsDisplayed()
        screenshot("05-unsupported")
        val theme = themeContextFixture()
        compose.runOnIdle { repository.state.value = ThemeContextState(ThemeContextContent.Available, theme.copy(charter = null, currentState = null), "2026-09-06T08:00:00Z") }
        compose.onNodeWithText("目的・到達像は未設定です。").assertIsDisplayed()
        compose.onNodeWithText("現在地は未設定です。").assertIsDisplayed()
        screenshot("06-unset")
        compose.runOnIdle { repository.state.value = repository.state.value.copy(theme = theme.copy(currentState = null)) }
        compose.onNodeWithText(theme.charter!!.purpose).assertIsDisplayed()
        compose.onNodeWithText("現在地は未設定です。").performScrollTo().assertIsDisplayed()
        screenshot("07-partial")
        compose.runOnIdle { repository.state.value = ThemeContextState(ThemeContextContent.Missing, fetchedAt = "2026-09-06T08:00:00Z") }
        compose.onNodeWithText("Themeは削除されたか、見つかりません。保存していた内容は表示していません。").assertIsDisplayed()
        compose.onNodeWithText(theme.title).assertDoesNotExist()
        screenshot("08-deleted")
        compose.runOnIdle { repository.state.value = ThemeContextState(failure = ThemeContextFailure.AccessDenied) }
        compose.onNodeWithText("接続権限が失効しました。端末の閲覧内容を削除しました。").assertIsDisplayed()
        screenshot("09-access-denied")
    }

    private fun screenshot(name: String) {
        compose.waitForIdle()
        val instrumentation = InstrumentationRegistry.getInstrumentation()
        val context = instrumentation.targetContext
        val bitmap = requireNotNull(instrumentation.uiAutomation.takeScreenshot())
        val directory = File(context.getExternalFilesDir(null), "theme-551").apply { mkdirs() }
        File(directory, "${context.resources.configuration.screenWidthDp}-$name.png").outputStream().use { bitmap.compress(Bitmap.CompressFormat.PNG, 100, it) }
        bitmap.recycle()
    }
    private class FixtureRepository : MobileThemeContextRepository {
        val state = MutableStateFlow(ThemeContextState())
        override fun observeThemeContext(themeId: String) = state
        override suspend fun refreshThemeContext(themeId: String) = Unit
    }
}
