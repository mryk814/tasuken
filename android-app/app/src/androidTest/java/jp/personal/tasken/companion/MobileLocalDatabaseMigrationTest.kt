package jp.personal.tasken.companion

import androidx.room.testing.MigrationTestHelper
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith

@RunWith(AndroidJUnit4::class)
class MobileLocalDatabaseMigrationTest {
    @get:Rule
    val helper = MigrationTestHelper(
        InstrumentationRegistry.getInstrumentation(),
        MobileLocalDatabase::class.java,
    )

    @After
    fun tearDown() {
        InstrumentationRegistry.getInstrumentation().targetContext.deleteDatabase(DatabaseName)
    }

    @Test
    fun migrationOneToTwoPreservesCacheAndOutbox() {
        helper.createDatabase(DatabaseName, 1).apply {
            execSQL(
                "INSERT INTO task_cache " +
                    "(id, title, themeId, state, workState, todayDate, updatedAt, optimisticCommandId) " +
                    "VALUES ('task-1', '保持するTask', NULL, 'todo', NULL, '2026-08-22', " +
                    "'2026-08-22T01:00:00Z', 'command-1')",
            )
            execSQL(
                "INSERT INTO outbox_command " +
                    "(commandId, idempotencyKey, requestId, clientDeviceId, issuedAt, commandName, " +
                    "envelopeJson, state, attemptCount, createdAt, lastAttemptAt, lastError) " +
                    "VALUES ('command-1', 'command-1', 'request-1', 'device-1', " +
                    "'2026-08-22T01:00:00Z', 'CreateTask', '{}', 'pending', 0, " +
                    "'2026-08-22T01:00:00Z', NULL, NULL)",
            )
            close()
        }

        helper.runMigrationsAndValidate(DatabaseName, 2, true, MIGRATION_1_2).use { db ->
            db.query("SELECT title, serverVersion FROM task_cache WHERE id = 'task-1'").use { cursor ->
                assertTrue(cursor.moveToFirst())
                assertEquals("保持するTask", cursor.getString(0))
                assertTrue(cursor.isNull(1))
            }
            db.query("SELECT COUNT(*) FROM outbox_command WHERE commandId = 'command-1'").use { cursor ->
                assertTrue(cursor.moveToFirst())
                assertEquals(1, cursor.getInt(0))
            }
        }
    }

    private companion object {
        const val DatabaseName = "mobile-migration-test"
    }
}
