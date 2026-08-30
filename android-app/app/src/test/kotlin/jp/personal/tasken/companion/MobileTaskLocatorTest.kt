package jp.personal.tasken.companion

import java.net.URI
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertSame
import org.junit.Assert.assertThrows
import android.content.Intent
import org.junit.Test

class MobileTaskLocatorTest {
    @Test
    fun formatsAndParsesCanonicalNonUuidIdsExactlyOnce() {
        listOf(
            "legacy/%2F",
            "日本語 space",
            "emoji😀",
            "a/?#%+@!'()*",
            "/abc/",
            "line\nbreak",
        ).forEach { id ->
            val locator = MobileTaskLocator.format(id)
            assertEquals(id, MobileTaskLocator.parse(URI(locator)))
        }
        assertEquals("a/", MobileTaskLocator.parse(URI("tasken://task/a%2F")))
        assertEquals("abc", MobileTaskLocator.parse(URI("tasken://task/abc?source=widget")))
        assertEquals("abc", MobileTaskLocator.parse(URI("tasken://task/abc?source=notification")))
        assertThrows(IllegalArgumentException::class.java) {
            MobileTaskLocator.format("\uD800")
        }
    }

    @Test
    fun rejectsNonCanonicalOrAmbiguousLocators() {
        listOf(
            "tasken://task/abc/",
            "tasken://user@task/abc",
            "tasken://task:7/abc",
            "tasken://task/abc#fragment",
            "tasken://task/%61bc",
            "tasken://task/a%2fb",
            "tasken://task/abc?source=unknown",
        ).forEach { assertNull(MobileTaskLocator.parse(URI(it))) }
        assertSame(
            MobileEntryRequest.None,
            MobileEntryRequestResolver.resolve(Intent.ACTION_VIEW, "tasken://task/%", null, null, 9),
        )
    }
}
