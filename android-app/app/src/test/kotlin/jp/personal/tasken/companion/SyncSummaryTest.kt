package jp.personal.tasken.companion

import java.io.File
import java.time.ZoneOffset
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

/** 未送信を理由の三つ（つながったら送る・直すと送れる・受け取られなかった）に分ける決まり。 */
class SyncSummaryTest {
    private val syncedAt = "2026-11-14T00:12:00Z"

    private fun task(id: String, conflict: Boolean = false, held: List<MobileHeldTaskChange> = emptyList(), pending: Boolean = false) =
        MobileTask(
            id = id, title = "Task $id", themeId = null, state = "todo", workState = null, updatedAt = syncedAt,
            pending = pending,
            heldChanges = held,
            conflict = if (conflict) {
                MobileTaskConflict(
                    commandId = "c-$id", intendedAction = "UpdateTask", expectedVersion = 1, serverVersion = 2,
                    serverState = "done", detectedAt = syncedAt,
                )
            } else {
                null
            },
        )

    private fun capture(id: String, canRetry: Boolean, needsFix: Boolean = false) =
        MobilePendingCapture(id, "入力 $id\n二行目", syncedAt, "status", canRetry, needsFix)

    @Test
    fun sendableCommandsWaitForTheConnectionWhileTheDeviceIsStillRegistered() {
        val retry = MobileSendRetry(4, "2026-11-14T03:31:00Z", "PC につながりません。")
        val summary = syncSummary(
            TodayUiState.Cached(emptyList(), syncedAt, "PC につながりません。", TodayUiState.CachedRecovery.Reload),
            pending = 3, tasks = emptyList(), captures = emptyList(), recoveredInputs = 0, retry = retry, nextSendAt = 99L,
        )
        assertEquals(3, summary.waiting)
        assertEquals(0, summary.fixable)
        assertEquals(retry, summary.retry)
        assertEquals(99L, summary.nextSendAt)
        assertEquals(3, summary.unsent)
        assertEquals(false, summary.healthy)
    }

    /** 登録が切れている間は、待っても送れない。同じ命令を「直すと送れる」へ移し、次の時刻は言わない。 */
    @Test
    fun sendableCommandsNeedTheOwnerWhenTheRegistrationIsGone() {
        val summary = syncSummary(
            TodayUiState.Cached(emptyList(), syncedAt, "接続が失効しました。", TodayUiState.CachedRecovery.RePair),
            pending = 3, tasks = emptyList(), captures = emptyList(), recoveredInputs = 0,
            retry = MobileSendRetry(2, null, "x"), nextSendAt = 99L,
        )
        assertEquals(0, summary.waiting)
        assertEquals(3, summary.fixable)
        assertEquals("接続が失効しました。", summary.fixReason)
        assertNull(summary.retry)
        assertNull(summary.nextSendAt)
    }

    @Test
    fun refusedAndOvertakenChangesAreReturnedWithAPlaceToDecide() {
        val tasks = listOf(
            task("a", conflict = true),
            task("b", pending = true, held = listOf(MobileHeldTaskChange("c1", "名前", "PCが受け取りませんでした。", rejected = true))),
            task("c", pending = true),
        )
        val summary = syncSummary(
            TodayUiState.Success(tasks, syncedAt),
            pending = 1, tasks = tasks, captures = listOf(capture("x", canRetry = true), capture("y", canRetry = false)),
            recoveredInputs = 0,
        )
        assertEquals(
            listOf(
                SyncReturned("Task a", "PC で先に変わっていました", "a"),
                SyncReturned("Task b", "PCが受け取りませんでした。", "b"),
                SyncReturned("入力 x", "PC が受け取りませんでした", null),
            ),
            summary.returned,
        )
        assertEquals(1, summary.waiting)
        assertEquals(4, summary.unsent)
    }

    /** PC の版が古くて受け取れなかった入力は、捨てる・決めるではなく、本人が PC を新しくすれば送れる。 */
    @Test
    fun inputsRefusedByAnOldDesktopAreFixable() {
        val summary = syncSummary(
            TodayUiState.Success(emptyList(), syncedAt),
            pending = 0, tasks = emptyList(), captures = listOf(capture("x", canRetry = true, needsFix = true)),
            recoveredInputs = 2,
        )
        assertEquals(1, summary.fixable)
        assertEquals(emptyList<SyncReturned>(), summary.returned)
        assertEquals(3, summary.unsent)
    }

    @Test
    fun nothingUnsentWhileConnectedIsHealthy() {
        val summary = syncSummary(TodayUiState.Success(emptyList(), syncedAt), 0, emptyList(), emptyList(), 0)
        assertEquals(true, summary.healthy)
    }

    @Test
    fun labelsSayOnlyWhatIsKnown() {
        assertEquals("4回送った・最後 12:31", retrySummaryLabel(MobileSendRetry(4, "2026-11-14T12:31:00Z", null), ZoneOffset.UTC))
        assertEquals("1回送った", retrySummaryLabel(MobileSendRetry(1, null, null), ZoneOffset.UTC))
        assertNull(retrySummaryLabel(MobileSendRetry(0, null, "途中で止まった"), ZoneOffset.UTC))
        val now = 1_794_660_000_000L
        assertEquals("次は 12:45", nextSendLabel(java.time.Instant.parse("2026-11-14T12:45:00Z").toEpochMilli(), now = 0L, zone = ZoneOffset.UTC))
        // 過ぎた時刻は、通信が戻るのを待っているだけなので言わない。
        assertNull(nextSendLabel(now - 1, now = now, zone = ZoneOffset.UTC))
        assertNull(nextSendLabel(null, now = now, zone = ZoneOffset.UTC))
    }

    @Test
    fun retrySummaryTakesTheLatestAttemptAndReadsBothReasonShapes() {
        fun command(id: String, attempts: Int, at: String?, error: String?) = OutboxCommandEntity(
            commandId = id, idempotencyKey = id, requestId = id, clientDeviceId = "d", issuedAt = syncedAt,
            commandName = "UpdateTask", envelopeJson = "", serverId = "s", state = OutboxState.RetryWait,
            attemptCount = attempts, createdAt = syncedAt, lastAttemptAt = at, lastError = error,
        )
        assertNull(emptyList<OutboxCommandEntity>().toSendRetry())
        val retry = listOf(
            command("a", 4, "2026-11-14T03:00:00Z", "PC につながりません。"),
            command("b", 2, "2026-11-14T03:31:00Z", """{"code":"busy","message":"PC が混んでいます。","retryable":true}"""),
        ).toSendRetry()
        assertEquals(MobileSendRetry(4, "2026-11-14T03:31:00Z", "PC が混んでいます。"), retry)
    }

    /** 朱と薄い墨は、共通の色の写しと同じ値を使う。 */
    @Test
    fun sealAndFaintInkEqualTheSharedTokenCopy() {
        val css = generateSequence(File("").absoluteFile) { it.parentFile }
            .map { File(it, "src/renderer/src/styles/ishou/tokens.css") }
            .first { it.isFile }
            .readText()
        val light = css.substringBefore("@media (prefers-color-scheme: dark)")
        val dark = css.substringAfter(":root[data-theme=\"dark\"]")
        fun value(block: String, name: String) =
            Regex("--color-$name:\\s*(#[0-9a-fA-F]{6})").find(block)!!.groupValues[1].uppercase()
        for ((block, tokens) in listOf(light to TaskenOfflineColorTokens.light, dark to TaskenOfflineColorTokens.dark)) {
            tokens.forEach { (name, hex) -> assertEquals("--color-$name", value(block, name), hex.uppercase()) }
        }
    }
}
