package jp.personal.tasken.companion

import android.content.Context
import android.content.ContextWrapper
import androidx.room.Room
import androidx.test.platform.app.InstrumentationRegistry
import java.time.LocalDate
import java.util.UUID
import kotlinx.coroutines.runBlocking
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

/**
 * 時刻の欄（reminderAt）が、前からある Task にも届くこと（#753）。
 *
 * 写しの移行（30→31）は列を足すだけで、前からある Task の時刻は空のまま。接続先が時刻を返し始めた後の
 * 最初の同期で、版が変わっていない Task にも時刻が入ることを守る（同期のたびに今の Task を取り直す形に
 * 支えられている。差分だけを読む形に変えると、ここが落ちる）。その取り直しで、未送信の入力は消えない。
 */
class TaskReminderBackfillRepositoryTest {
    private val plainId = "10000000-0000-4000-8000-000000007541"
    private val editedId = "10000000-0000-4000-8000-000000007542"
    private val brokenId = "10000000-0000-4000-8000-000000007543"

    @Test fun existingTasksReceiveTheirReminderOnceTheDesktopReportsItAndUnsentEditsSurvive() = runBlocking {
        val context = object : ContextWrapper(InstrumentationRegistry.getInstrumentation().targetContext) {
            override fun getApplicationContext(): Context = this
        }
        val name = "reminder-backfill-${UUID.randomUUID()}.db"
        val store = MobileGatewayConnectionStore(context)
        store.clearToken(); store.save("https://gateway.test", "t".repeat(43))
        // 古い Desktop は reminderAt の欄を返さない。更新した Desktop は、同じ版のまま欄を付けて返す。
        var desktopReportsReminder = false
        val at = "2026-11-15T08:00:00Z"
        val client = MobileGatewayHttpClient { _, path, _, _, _ ->
            val meta = """{"apiVersion":1,"schemaVersion":$TASKEN_MOBILE_SCHEMA_VERSION,"serverId":"backfill-server","serverRevision":2,"generatedAt":"$at","truncated":false}"""
            fun task(id: String, title: String, reminder: String) =
                """{"id":"$id","version":4,"title":"$title","themeId":null,"state":"todo","workState":"not_delegated","todayDate":"${LocalDate.now()}","schedule":null,"updatedAt":"$at"${if (desktopReportsReminder) ",\"reminderAt\":$reminder" else ""}}"""
            val tasks = listOf(
                task(plainId, "電話する", "\"2026-11-20T09:00:00+09:00\""),
                task(editedId, "Desktop の題名", "\"2026-11-21T09:00\""),
                // 読めない時刻（時差 +19:00）が 1 件あっても、ほかの Task は届く。
                task(brokenId, "読めない時刻", "\"2026-11-22T09:00:00+19:00\""),
            ).joinToString(",")
            when {
                path.startsWith("/v1/commands") -> throw java.io.IOException("offline")
                path.startsWith("/v1/bootstrap") -> GatewayHttpResponse(200, """{"ok":true,"meta":$meta,"data":{"tasks":[$tasks],"nextCursor":"backfill-cursor","hasMore":false}}""")
                path.startsWith("/v1/sync") -> GatewayHttpResponse(200, """{"ok":true,"meta":$meta,"data":{"changes":[],"nextCursor":"backfill-cursor","hasMore":false}}""")
                else -> GatewayHttpResponse(200, """{"ok":true,"meta":$meta,"data":{"themes":[],"nextCursor":null}}""")
            }
        }
        val db = Room.databaseBuilder(context, MobileLocalDatabase::class.java, name).build()
        try {
            val dao = db.mobileDao()
            val repository = AndroidMobileTaskRepository(context, store, db, scheduleOutboxOnStart = false, httpClient = client)
            // 更新の前: 写しに Task はあるが、時刻は無い（移行した直後と同じ）。
            repository.loadToday()
            assertEquals(3, dao.tasks().size)
            assertNull(dao.task(plainId)?.reminderAt)
            // 端末で「後で」にした時刻は、欄を知らない Desktop との同期で消えない。
            dao.upsertTask(requireNotNull(dao.task(brokenId)).copy(reminderAt = "2026-11-19T09:00:00+09:00"))
            repository.loadToday()
            assertEquals("2026-11-19T09:00:00+09:00", dao.task(brokenId)?.reminderAt)

            // 端末で題名を変えて、まだ送れていない（つながらない）。
            repository.enqueueUpdateTaskTitle(editedId, "端末で直した題名")
            assertEquals(1, dao.outboxCount())

            // Desktop が更新され、時刻を返し始めた。版は 4 のまま。
            desktopReportsReminder = true
            repository.loadToday()
            assertEquals("2026-11-20T09:00:00+09:00", dao.task(plainId)?.reminderAt)
            // 未送信の入力がある Task は、端末の内容のまま残る（送るものも消えない）。
            assertEquals("端末で直した題名", dao.task(editedId)?.title)
            assertEquals(1, dao.outboxCount())
            // 読めない時刻は、その Task の時刻だけ「なし」になる。
            assertEquals(3, dao.tasks().size)
            assertNull(dao.task(brokenId)?.reminderAt)
        } finally { db.close(); store.clearToken(); context.deleteDatabase(name) }
    }
}
