package jp.personal.tasken.companion

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotEquals
import org.junit.Assert.assertThrows
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * agentの質問への短い返答の契約（#601）。
 *
 * Desktopの `ReplyToAgentRequest` と同じ検証をAndroid側でも行い、
 * 送る前に壊れた内容を弾く。応答の表示状態はDesktopの導出結果をそのまま扱う。
 */
class MobileAgentReplyContractTest {
    private val golden =
        requireNotNull(
            javaClass.classLoader?.getResource("attention-response.golden.json"),
        ).readText()

    private fun envelope(
        commandId: String = "command-1",
        body: String = "25℃で進めてください。",
        choiceId: String? = "choice-25c",
        expectedTaskVersion: Long = 12,
    ) = MobileAgentReplyEnvelopeDto(
        apiVersion = TASKEN_MOBILE_API_VERSION,
        schemaVersion = TASKEN_MOBILE_SCHEMA_VERSION,
        requestId = "request-1",
        commandId = commandId,
        idempotencyKey = commandId,
        clientDeviceId = "device-fold-7",
        issuedAt = "2026-09-20T10:00:00.000Z",
        taskId = "task-viscosity",
        questionId = "33333333-3333-4333-8333-333333333333",
        body = body,
        choiceId = choiceId,
        expectedTaskVersion = expectedTaskVersion,
    )

    @Test
    fun roundTripsTheReplyEnvelope() {
        val encoded = MobileAgentReplyContract.encode(envelope())
        val decoded = MobileAgentReplyContract.decodeEnvelope(encoded)

        assertEquals("command-1", decoded.commandId)
        assertEquals("33333333-3333-4333-8333-333333333333", decoded.questionId)
        assertEquals(12L, decoded.expectedTaskVersion)
        assertEquals("choice-25c", decoded.choiceId)
        // JSONとしてapiVersionとschemaVersionを数値で送る。
        assertTrue(encoded.contains("\"apiVersion\":1"))
        assertTrue(encoded.contains("\"schemaVersion\":7"))
    }

    @Test
    fun rejectsAnEnvelopeThatBreaksTheQuestionIdentity() {
        assertThrows(MobileAgentReplyContractException::class.java) {
            MobileAgentReplyContract.encode(envelope(commandId = "command-1").copy(idempotencyKey = "other"))
        }
        assertThrows(MobileAgentReplyContractException::class.java) {
            MobileAgentReplyContract.encode(envelope().copy(questionId = "  "))
        }
        assertThrows(MobileAgentReplyContractException::class.java) {
            MobileAgentReplyContract.encode(envelope(body = "   "))
        }
        assertThrows(MobileAgentReplyContractException::class.java) {
            MobileAgentReplyContract.encode(envelope().copy(schemaVersion = TASKEN_MOBILE_SCHEMA_VERSION - 1))
        }
        assertThrows(MobileAgentReplyContractException::class.java) {
            MobileAgentReplyContract.encode(envelope(expectedTaskVersion = -1))
        }
    }

    @Test
    fun sameQuestionAndBodyProduceTheSameCommandId() {
        val first = agentReplyCommandId("device", "server", "task", "question", 12, "25℃", "choice-25c")
        val again = agentReplyCommandId("device", "server", "task", "question", 12, "25℃", "choice-25c")

        // 応答を失った再送で同じcommandIdを使い、回答を二重に増やさない。
        assertEquals(first, again)
        assertNotEquals(first, agentReplyCommandId("device", "server", "task", "question", 13, "25℃", "choice-25c"))
        assertNotEquals(first, agentReplyCommandId("device", "server", "task", "question", 12, "40℃", "choice-25c"))
        assertNotEquals(first, agentReplyCommandId("device", "server", "task", "other", 12, "25℃", "choice-25c"))
    }

    @Test
    fun decodesTheCanonicalReplyResponse() {
        val response =
            """{"ok":true,"meta":{"apiVersion":1,"schemaVersion":7,"serverId":"desktop-home",""" +
                """"serverRevision":42,"generatedAt":"2026-09-20T10:00:00.000Z","truncated":false},""" +
                """"data":{"commandId":"command-1","commandStatus":"applied","taskId":"task-viscosity",""" +
                """"taskVersion":12,"questionId":"33333333-3333-4333-8333-333333333333",""" +
                """"displayState":"answered_resume_waiting"}}"""

        val decoded = MobileAgentReplyContract.decode(response)

        assertTrue(decoded.ok)
        assertEquals("applied", decoded.data.commandStatus)
        // 表示状態はDesktopの導出結果をそのまま持つ。Android側で作り直さない。
        assertEquals("answered_resume_waiting", decoded.data.displayState)
        assertEquals(12L, decoded.data.taskVersion)
    }

    @Test
    fun rejectsAnUnknownCommandStatusAndUnknownFields() {
        val base =
            """{"ok":true,"meta":{"apiVersion":1,"schemaVersion":7,"serverId":"desktop-home",""" +
                """"serverRevision":42,"generatedAt":"2026-09-20T10:00:00.000Z","truncated":false},""" +
                """"data":{"commandId":"command-1","commandStatus":"applied","taskId":"task-viscosity",""" +
                """"taskVersion":12,"questionId":"33333333-3333-4333-8333-333333333333",""" +
                """"displayState":"answered_resume_waiting"}}"""

        assertThrows(MobileAgentReplyContractException::class.java) {
            MobileAgentReplyContract.decode(base.replace("\"applied\"", "\"queued\""))
        }
        assertThrows(MobileAgentReplyContractException::class.java) {
            MobileAgentReplyContract.decode(base.replace("\"ok\":true", "\"ok\":true,\"hidden\":1"))
        }
    }

    @Test
    fun cachesTheAttentionItemsItCanShowAndReplyTo() {
        val response = MobileAttentionContract.decode(golden)
        val item = response.data.attention.first { it.kind == "answer_request" }

        val cached =
            item.toCacheEntity(serverId = "desktop-home", position = 0, fetchedAt = "2026-09-20T10:01:00Z")
        val row = cached.toRow()

        assertEquals(item.attentionId, row.attentionId)
        assertEquals(AttentionKind.AnswerRequest, row.kind)
        assertEquals(12L, row.taskVersion)
        assertEquals("33333333-3333-4333-8333-333333333333", row.requestId)
        assertTrue(row.canReply)
        assertEquals("desktop-home", cached.serverId)
        assertEquals(0, cached.position)
        // 元のitemを残すので、列を増やしても一覧を取り直さずに表示できる。
        assertEquals(item, MobileAttentionContract.decodeItem(cached.payloadJson))
    }

    @Test
    fun keepsAnUnknownKindThroughTheCache() {
        val response = MobileAttentionContract.decode(golden)
        val unknown = response.data.attention.first().copy(kind = "something_new")

        val row = unknown.toCacheEntity("desktop-home", 3, "2026-09-20T10:01:00Z").toRow()

        // 未知の種類でも要対応から黙って消さない。回答だけをさせない。
        assertEquals(AttentionKind.Unknown, row.kind)
        assertFalse(row.canReply)
    }

    @Test
    fun refusesToReplyWithoutAQuestionOrTaskVersion() {
        val response = MobileAttentionContract.decode(golden)
        val review = response.data.attention.first { it.kind == "review_report" }

        // 成果確認は回答ではない。
        assertFalse(MobileAttentionContract.toRow(review).canReply)
        // 質問IDも版も無い行では、競合を検出できないので回答させない。
        assertFalse(MobileAttentionContract.toRow(review.copy(requestId = null)).canReply)
        assertFalse(MobileAttentionContract.toRow(review.copy(taskVersion = null)).canReply)
    }
}
