package jp.personal.tasken.companion

import org.junit.Assert.assertEquals
import org.junit.Test

class ContinuousSpeechTranscriptTest {
    @Test
    fun joinsRecognizerChunksAcrossShortPauses() {
        val first = mergeSpeechTranscript("", "来週の金曜日までに資料を作る")
        val complete = mergeSpeechTranscript(first, "そういえば会議室も予約する")

        assertEquals("来週の金曜日までに資料を作る そういえば会議室も予約する", complete)
    }

    @Test
    fun preservesIntentionalRepetitionAcrossIndependentRecognizerChunks() {
        assertEquals("牛乳を買う 牛乳を買う", mergeSpeechTranscript("牛乳を買う", "牛乳を買う"))
        assertEquals(
            "牛乳を買う 牛乳を買う コーヒー豆も買う",
            mergeSpeechTranscript("牛乳を買う", "牛乳を買う コーヒー豆も買う"),
        )
    }
}
