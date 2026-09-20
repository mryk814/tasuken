package jp.personal.tasken.companion

import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertThrows
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * DesktopとAndroidが同じ要対応の意味を共有することの確認（#601）。
 * goldenは `contracts/mobile/v1/attention-response.golden.json` を共有する。
 */
class MobileAttentionGoldenTest {
    private val golden =
        requireNotNull(
            javaClass.classLoader?.getResource("attention-response.golden.json"),
        ).readText()

    @Test
    fun decodesCanonicalAttentionReadModel() {
        val response = MobileAttentionContract.decode(golden)
        val rows = MobileAttentionContract.toRows(response)

        assertTrue(response.ok)
        assertEquals(3, rows.size)
        // 件数は判断単位。Desktopのbadgeと同じ数え方。
        assertEquals(3, response.data.counts.needsYou)
        assertEquals(rows.size, response.data.counts.needsYou)
        assertEquals(1, response.data.counts.working)
        assertEquals(1, response.data.counts.queued)
        assertFalse(response.data.truncated)
    }

    @Test
    fun keepsTheSameKindsAndOrderAsDesktop() {
        val rows = MobileAttentionContract.toRows(MobileAttentionContract.decode(golden))
        // Desktopの並び（回答待ち → 成果確認 → 変更案）をそのまま使う。
        assertEquals(
            listOf(
                AttentionKind.AnswerRequest,
                AttentionKind.ReviewReport,
                AttentionKind.ProposalPending,
            ),
            rows.map { it.kind },
        )
    }

    @Test
    fun carriesTheQuestionIdAndTaskVersionNeededToReply() {
        val rows = MobileAttentionContract.toRows(MobileAttentionContract.decode(golden))
        val question = rows.first { it.kind == AttentionKind.AnswerRequest }

        assertEquals("33333333-3333-4333-8333-333333333333", question.requestId)
        assertEquals("task-viscosity", question.taskId)
        assertEquals(12L, question.taskVersion)
        assertTrue(question.canReply)
        // 回答以外は、回答できてもいけない。
        val review = rows.first { it.kind == AttentionKind.ReviewReport }
        assertFalse(review.canReply)
    }

    @Test
    fun tasklessProposalIsStillShown() {
        val rows = MobileAttentionContract.toRows(MobileAttentionContract.decode(golden))
        val taskless = rows.first { it.kind == AttentionKind.ProposalPending }

        assertNull(taskless.taskId)
        assertNull(taskless.taskVersion)
        assertNull(taskless.requestId)
        assertFalse(taskless.canReply)
        assertEquals("Noteの変更案", taskless.headline)
    }

    @Test
    fun unknownKindIsKeptInsteadOfDropped() {
        val mutated = replaceFirstAttentionField("kind", JsonPrimitive("something_new"))
        val rows = MobileAttentionContract.toRows(MobileAttentionContract.decode(mutated))
        // 未知の種類でも行として残す。要対応から黙って消さない。
        assertEquals(3, rows.size)
        assertEquals(AttentionKind.Unknown, rows.first().kind)
        assertFalse(rows.first().canReply)
    }

    @Test
    fun rejectsUnknownFields() {
        val mutated = addFirstAttentionField("hiddenReasoning", JsonPrimitive("secret"))
        assertThrows(Exception::class.java) { MobileAttentionContract.decode(mutated) }
    }

    @Test
    fun rejectsWrongTypes() {
        // 数値であるべきfieldへobjectが来たら拒否する。
        val mutated =
            editFirstAttention {
                JsonObject(it + ("taskVersion" to JsonObject(mapOf("value" to JsonPrimitive(12)))))
            }
        assertThrows(Exception::class.java) { MobileAttentionContract.decode(mutated) }
    }

    private fun replaceFirstAttentionField(
        field: String,
        value: JsonPrimitive,
    ): String = editFirstAttention { JsonObject(it + (field to value)) }

    private fun addFirstAttentionField(
        field: String,
        value: JsonPrimitive,
    ): String = editFirstAttention { JsonObject(it + (field to value)) }

    private fun editFirstAttention(transform: (JsonObject) -> JsonObject): String {
        val root = Json.parseToJsonElement(golden).jsonObject
        val data = root["data"]!!.jsonObject
        val items = data["attention"]!!.jsonArray
        val updated = JsonArray(listOf(transform(items[0].jsonObject)) + items.drop(1))
        return JsonObject(root + ("data" to JsonObject(data + ("attention" to updated)))).toString()
    }
}
