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

    @Test
    fun migrationTwoToThreePreservesCacheAndOutboxAndAddsConflictStorage() {
        helper.createDatabase(DatabaseName, 2).apply {
            execSQL(
                "INSERT INTO task_cache " +
                    "(id, serverVersion, title, themeId, state, workState, todayDate, updatedAt, optimisticCommandId) " +
                    "VALUES ('task-2', 7, '競合前Task', NULL, 'done', NULL, '2026-08-22', " +
                    "'2026-08-22T01:00:00Z', 'command-2')",
            )
            execSQL(
                "INSERT INTO outbox_command " +
                    "(commandId, idempotencyKey, requestId, clientDeviceId, issuedAt, commandName, " +
                    "envelopeJson, state, attemptCount, createdAt, lastAttemptAt, lastError) " +
                    "VALUES ('command-2', 'command-2', 'request-2', 'device-1', " +
                    "'2026-08-22T01:00:00Z', 'CompleteTask', '{}', 'sending', 1, " +
                    "'2026-08-22T01:00:00Z', '2026-08-22T01:01:00Z', NULL)",
            )
            close()
        }

        helper.runMigrationsAndValidate(DatabaseName, 3, true, MIGRATION_2_3).use { db ->
            db.query("SELECT title, conflictCommandId FROM task_cache WHERE id = 'task-2'").use { cursor ->
                assertTrue(cursor.moveToFirst())
                assertEquals("競合前Task", cursor.getString(0))
                assertTrue(cursor.isNull(1))
            }
            db.query("SELECT state FROM outbox_command WHERE commandId = 'command-2'").use { cursor ->
                assertTrue(cursor.moveToFirst())
                assertEquals("sending", cursor.getString(0))
            }
            db.query("SELECT COUNT(*) FROM task_conflict").use { cursor ->
                assertTrue(cursor.moveToFirst())
                assertEquals(0, cursor.getInt(0))
            }
        }
    }

    @Test
    fun migrationThreeToFourPreservesOutboxAndAddsDependencyColumns() {
        helper.createDatabase(DatabaseName, 3).apply {
            execSQL(
                "INSERT INTO outbox_command " +
                    "(commandId, idempotencyKey, requestId, clientDeviceId, issuedAt, commandName, " +
                    "envelopeJson, state, attemptCount, createdAt, lastAttemptAt, lastError) " +
                    "VALUES ('command-3', 'command-3', 'request-3', 'device-1', " +
                    "'2026-08-22T01:00:00Z', 'CreateTask', '{}', 'pending', 0, " +
                    "'2026-08-22T01:00:00Z', NULL, NULL)",
            )
            close()
        }

        helper.runMigrationsAndValidate(DatabaseName, 4, true, MIGRATION_3_4).use { db ->
            db.query(
                "SELECT state, taskId, dependsOnCommandId FROM outbox_command WHERE commandId = 'command-3'",
            ).use { cursor ->
                assertTrue(cursor.moveToFirst())
                assertEquals("pending", cursor.getString(0))
                assertTrue(cursor.isNull(1))
                assertTrue(cursor.isNull(2))
            }
        }
    }

    @Test
    fun migrationFourToFivePreservesConflictAndAddsLocalTitle() {
        helper.createDatabase(DatabaseName, 4).apply {
            execSQL(
                "INSERT INTO task_conflict " +
                    "(commandId, taskId, intendedAction, expectedVersion, serverVersion, serverState, " +
                    "serverTitle, serverThemeId, serverWorkState, serverUpdatedAt, detectedAt) " +
                    "VALUES ('command-4', 'task-4', 'CompleteTask', 1, 2, 'done', 'Server Task', " +
                    "NULL, NULL, '2026-08-22T01:00:00Z', '2026-08-22T01:01:00Z')",
            )
            close()
        }

        helper.runMigrationsAndValidate(DatabaseName, 5, true, MIGRATION_4_5).use { db ->
            db.query("SELECT serverTitle, localTitle FROM task_conflict WHERE commandId = 'command-4'").use { cursor ->
                assertTrue(cursor.moveToFirst())
                assertEquals("Server Task", cursor.getString(0))
                assertTrue(cursor.isNull(1))
            }
        }
    }

    @Test
    fun migrationFiveToSixPreservesConflictAndAddsTodayDateIntent() {
        helper.createDatabase(DatabaseName, 5).apply {
            execSQL(
                "INSERT INTO task_conflict " +
                    "(commandId, taskId, intendedAction, expectedVersion, serverVersion, serverState, " +
                    "serverTitle, localTitle, serverThemeId, serverWorkState, serverUpdatedAt, detectedAt) " +
                    "VALUES ('command-5', 'task-5', 'UpdateTask', 1, 2, 'todo', 'Server Task', " +
                    "'端末Task', NULL, NULL, '2026-08-22T01:00:00Z', '2026-08-22T01:01:00Z')",
            )
            close()
        }

        helper.runMigrationsAndValidate(DatabaseName, 6, true, MIGRATION_5_6).use { db ->
            db.query(
                "SELECT localTitle, serverTodayDate, localTodayDate, localTodayDateChanged " +
                    "FROM task_conflict WHERE commandId = 'command-5'",
            ).use { cursor ->
                assertTrue(cursor.moveToFirst())
                assertEquals("端末Task", cursor.getString(0))
                assertTrue(cursor.isNull(1))
                assertTrue(cursor.isNull(2))
                assertEquals(0, cursor.getInt(3))
            }
        }
    }

    @Test
    fun migrationSixToSevenPreservesTaskAndOutboxAndAddsThemeStorage() {
        helper.createDatabase(DatabaseName, 6).apply {
            execSQL(
                "INSERT INTO sync_state " +
                    "(id, serverId, apiVersion, schemaVersion, cursor, lastSuccessfulSyncAt, lastAttemptAt, lastError) " +
                    "VALUES (1, 'server-1', 1, 1, 'cursor-1', '2026-08-22T01:00:00Z', " +
                    "'2026-08-22T01:00:00Z', NULL)",
            )
            execSQL(
                "INSERT INTO task_cache " +
                    "(id, serverVersion, title, themeId, state, workState, todayDate, updatedAt, " +
                    "optimisticCommandId, conflictCommandId) VALUES " +
                    "('task-6', 4, 'Theme変更待ち', 'theme-old', 'todo', NULL, '2026-08-22', " +
                    "'2026-08-22T01:00:00Z', 'command-6', NULL)",
            )
            execSQL(
                "INSERT INTO outbox_command " +
                    "(commandId, idempotencyKey, requestId, clientDeviceId, issuedAt, commandName, " +
                    "envelopeJson, state, attemptCount, createdAt, lastAttemptAt, lastError, taskId, " +
                    "dependsOnCommandId) VALUES " +
                    "('command-6', 'command-6', 'request-6', 'device-1', '2026-08-22T01:00:00Z', " +
                    "'UpdateTask', '{}', 'pending', 0, '2026-08-22T01:00:00Z', NULL, NULL, " +
                    "'task-6', NULL)",
            )
            execSQL(
                "INSERT INTO task_conflict " +
                    "(commandId, taskId, intendedAction, expectedVersion, serverVersion, serverState, " +
                    "serverTitle, localTitle, serverTodayDate, localTodayDate, localTodayDateChanged, " +
                    "serverThemeId, serverWorkState, serverUpdatedAt, detectedAt) VALUES " +
                    "('conflict-6', 'task-conflict-6', 'UpdateTask', 3, 4, 'todo', 'Server Task', " +
                    "NULL, NULL, NULL, 0, 'theme-server', NULL, '2026-08-22T01:00:00Z', " +
                    "'2026-08-22T01:01:00Z')",
            )
            close()
        }

        helper.runMigrationsAndValidate(DatabaseName, 7, true, MIGRATION_6_7).use { db ->
            db.query("SELECT themeId, optimisticCommandId FROM task_cache WHERE id = 'task-6'").use { cursor ->
                assertTrue(cursor.moveToFirst())
                assertEquals("theme-old", cursor.getString(0))
                assertEquals("command-6", cursor.getString(1))
            }
            db.query("SELECT state, serverId FROM outbox_command WHERE commandId = 'command-6'").use { cursor ->
                assertTrue(cursor.moveToFirst())
                assertEquals("pending", cursor.getString(0))
                assertEquals("server-1", cursor.getString(1))
            }
            db.query(
                "SELECT serverThemeId, localThemeId, localThemeIdChanged " +
                    "FROM task_conflict WHERE commandId = 'conflict-6'",
            ).use { cursor ->
                assertTrue(cursor.moveToFirst())
                assertEquals("theme-server", cursor.getString(0))
                assertTrue(cursor.isNull(1))
                assertEquals(0, cursor.getInt(2))
            }
            db.query("SELECT COUNT(*) FROM theme_cache").use { cursor ->
                assertTrue(cursor.moveToFirst())
                assertEquals(0, cursor.getInt(0))
            }
            db.query("SELECT COUNT(*) FROM theme_catalog_state").use { cursor ->
                assertTrue(cursor.moveToFirst())
                assertEquals(0, cursor.getInt(0))
            }
            db.query("PRAGMA table_info(theme_cache)").use { cursor ->
                val nameColumn = cursor.getColumnIndexOrThrow("name")
                val columns = buildSet {
                    while (cursor.moveToNext()) add(cursor.getString(nameColumn))
                }
                assertTrue(columns.containsAll(setOf("id", "title", "catalogId")))
            }
        }
    }

    @Test
    fun migrationSixToSevenQuarantinesUnownedOutboxWithoutDataLoss() {
        helper.createDatabase(DatabaseName, 6).apply {
            execSQL(
                "INSERT INTO outbox_command " +
                    "(commandId, idempotencyKey, requestId, clientDeviceId, issuedAt, commandName, " +
                    "envelopeJson, state, attemptCount, createdAt, lastAttemptAt, lastError, taskId, " +
                    "dependsOnCommandId) VALUES " +
                    "('legacy-command', 'legacy-command', 'legacy-request', 'legacy-device', " +
                    "'2026-08-22T01:00:00Z', 'CreateTask', '{\"legacy\":true}', 'pending', 0, " +
                    "'2026-08-22T01:00:00Z', NULL, NULL, 'legacy-task', NULL)",
            )
            close()
        }

        helper.runMigrationsAndValidate(DatabaseName, 7, true, MIGRATION_6_7).use { db ->
            db.query(
                "SELECT serverId, envelopeJson, idempotencyKey, state FROM outbox_command " +
                    "WHERE commandId = 'legacy-command'",
            ).use { cursor ->
                assertTrue(cursor.moveToFirst())
                assertEquals("", cursor.getString(0))
                assertEquals("{\"legacy\":true}", cursor.getString(1))
                assertEquals("legacy-command", cursor.getString(2))
                assertEquals("pending", cursor.getString(3))
            }
        }
    }

    @Test
    fun migrationSevenToEightPreservesOfflineStateAndAddsScheduleStorage() {
        helper.createDatabase(DatabaseName, 7).apply {
            execSQL(
                "INSERT INTO task_cache " +
                    "(id, serverVersion, title, themeId, state, workState, todayDate, updatedAt, " +
                    "optimisticCommandId, conflictCommandId) VALUES " +
                    "('task-7', 5, '予定を保持する', 'theme-1', 'todo', NULL, '2026-08-22', " +
                    "'2026-08-22T01:00:00Z', 'command-7', NULL)",
            )
            execSQL(
                "INSERT INTO outbox_command " +
                    "(commandId, idempotencyKey, requestId, clientDeviceId, issuedAt, commandName, " +
                    "envelopeJson, serverId, state, attemptCount, createdAt, lastAttemptAt, lastError, " +
                    "taskId, dependsOnCommandId) VALUES " +
                    "('command-7', 'command-7', 'request-7', 'device-1', '2026-08-22T01:00:00Z', " +
                    "'UpdateTask', '{\"apiVersion\":1,\"schemaVersion\":1,\"requestId\":\"request-7\"," +
                    "\"commandId\":\"command-7\",\"idempotencyKey\":\"command-7\"," +
                    "\"clientDeviceId\":\"device-1\",\"issuedAt\":\"2026-08-22T01:00:00Z\"," +
                    "\"command\":{\"name\":\"UpdateTask\",\"taskId\":\"task-7\",\"expectedVersion\":4," +
                    "\"expectedScheduleVersion\":null,\"changes\":{\"todayDate\":\"2026-08-22\"}," +
                    "\"base\":{\"todayDate\":null}}}', 'server-1', 'pending', 0, " +
                    "'2026-08-22T01:00:00Z', NULL, NULL, 'task-7', NULL)",
            )
            execSQL(
                "INSERT INTO task_conflict " +
                    "(commandId, taskId, intendedAction, expectedVersion, serverVersion, serverState, " +
                    "serverTitle, localTitle, serverTodayDate, localTodayDate, localTodayDateChanged, " +
                    "serverThemeId, localThemeId, localThemeIdChanged, serverWorkState, serverUpdatedAt, detectedAt) " +
                    "VALUES ('conflict-7', 'task-conflict-7', 'UpdateTask', 4, 5, 'todo', " +
                    "'Server Task', NULL, NULL, NULL, 0, NULL, NULL, 0, NULL, " +
                    "'2026-08-22T01:00:00Z', '2026-08-22T01:01:00Z')",
            )
            close()
        }

        helper.runMigrationsAndValidate(DatabaseName, 8, true, MIGRATION_7_8).use { db ->
            db.query(
                "SELECT title, optimisticCommandId, scheduleId, scheduleVersion, scheduleStartDate, " +
                    "scheduleEndDate, scheduleDateKind, scheduleRangeSemantics, scheduleConfidence, " +
                    "scheduleGranularity FROM task_cache WHERE id = 'task-7'",
            ).use { cursor ->
                assertTrue(cursor.moveToFirst())
                assertEquals("予定を保持する", cursor.getString(0))
                assertEquals("command-7", cursor.getString(1))
                for (index in 2..9) assertTrue(cursor.isNull(index))
            }
            db.query("SELECT envelopeJson, state FROM outbox_command WHERE commandId = 'command-7'").use { cursor ->
                assertTrue(cursor.moveToFirst())
                val envelope = cursor.getString(0)
                assertTrue(envelope.contains("\"schemaVersion\":2"))
                assertEquals("pending", cursor.getString(1))
            }
            db.query(
                "SELECT localScheduleStartDate, localScheduleEndDate, localScheduleRangeSemantics, " +
                    "localScheduleChanged FROM task_conflict WHERE commandId = 'conflict-7'",
            ).use { cursor ->
                assertTrue(cursor.moveToFirst())
                assertTrue(cursor.isNull(0))
                assertTrue(cursor.isNull(1))
                assertTrue(cursor.isNull(2))
                assertEquals(0, cursor.getInt(3))
            }
        }
    }

    @Test
    fun migrationEightToNinePreservesOfflineStateAndAddsPlannedScheduleStorage() {
        helper.createDatabase(DatabaseName, 8).apply {
            execSQL(
                "INSERT INTO task_cache " +
                    "(id, serverVersion, title, themeId, state, workState, todayDate, updatedAt, " +
                    "optimisticCommandId, conflictCommandId, scheduleId, scheduleVersion, " +
                    "scheduleStartDate, scheduleEndDate, scheduleDateKind, scheduleRangeSemantics, " +
                    "scheduleConfidence, scheduleGranularity) VALUES " +
                    "('task-8', 6, '時刻を保持する', 'theme-1', 'todo', NULL, '2026-08-22', " +
                    "'2026-08-22T01:00:00Z', 'command-8', NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL)",
            )
            execSQL(
                "INSERT INTO outbox_command " +
                    "(commandId, idempotencyKey, requestId, clientDeviceId, issuedAt, commandName, " +
                    "envelopeJson, serverId, state, attemptCount, createdAt, lastAttemptAt, lastError, " +
                    "taskId, dependsOnCommandId) VALUES " +
                    "('command-8', 'command-8', 'request-8', 'device-1', '2026-08-22T01:00:00Z', " +
                    "'UpdateTask', '{\"plannedSchedule\":true}', 'server-1', 'pending', 0, " +
                    "'2026-08-22T01:00:00Z', NULL, NULL, 'task-8', NULL)",
            )
            execSQL(
                "INSERT INTO task_conflict " +
                    "(commandId, taskId, intendedAction, expectedVersion, serverVersion, serverState, " +
                    "serverTitle, localTitle, serverTodayDate, localTodayDate, localTodayDateChanged, " +
                    "serverThemeId, localThemeId, localThemeIdChanged, serverWorkState, serverUpdatedAt, " +
                    "detectedAt, localScheduleStartDate, localScheduleEndDate, localScheduleRangeSemantics, " +
                    "localScheduleChanged) VALUES ('conflict-8', 'task-conflict-8', 'UpdateTask', 5, 6, " +
                    "'todo', 'Server Task', NULL, NULL, NULL, 0, NULL, NULL, 0, NULL, " +
                    "'2026-08-22T01:00:00Z', '2026-08-22T01:01:00Z', NULL, NULL, NULL, 0)",
            )
            close()
        }

        helper.runMigrationsAndValidate(DatabaseName, 9, true, MIGRATION_8_9).use { db ->
            db.query(
                "SELECT title, optimisticCommandId, plannedStartTime, plannedDurationMinutes " +
                    "FROM task_cache WHERE id = 'task-8'",
            ).use { cursor ->
                assertTrue(cursor.moveToFirst())
                assertEquals("時刻を保持する", cursor.getString(0))
                assertEquals("command-8", cursor.getString(1))
                assertTrue(cursor.isNull(2))
                assertTrue(cursor.isNull(3))
            }
            db.query("SELECT envelopeJson, state FROM outbox_command WHERE commandId = 'command-8'").use { cursor ->
                assertTrue(cursor.moveToFirst())
                assertEquals("{\"plannedSchedule\":true}", cursor.getString(0))
                assertEquals("pending", cursor.getString(1))
            }
            db.query(
                "SELECT localPlannedStartTime, localPlannedDurationMinutes, localPlannedScheduleChanged " +
                    "FROM task_conflict WHERE commandId = 'conflict-8'",
            ).use { cursor ->
                assertTrue(cursor.moveToFirst())
                assertTrue(cursor.isNull(0))
                assertTrue(cursor.isNull(1))
                assertEquals(0, cursor.getInt(2))
            }
        }
    }

    @Test
    fun migrationNineToTenPreservesCacheAndAddsReceiptSummaryStorage() {
        helper.createDatabase(DatabaseName, 9).apply {
            execSQL(
                "INSERT INTO task_cache " +
                    "(id, serverVersion, title, themeId, state, workState, todayDate, updatedAt, " +
                    "optimisticCommandId, conflictCommandId, scheduleId, scheduleVersion, " +
                    "scheduleStartDate, scheduleEndDate, scheduleDateKind, scheduleRangeSemantics, " +
                    "scheduleConfidence, scheduleGranularity, plannedStartTime, plannedDurationMinutes) VALUES " +
                    "('task-9', 6, 'Receiptを保持する', 'theme-1', 'todo', 'in_progress', '2026-08-22', " +
                    "'2026-08-22T01:00:00Z', NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL)",
            )
            close()
        }

        helper.runMigrationsAndValidate(DatabaseName, 10, true, MIGRATION_9_10).use { db ->
            db.query(
                "SELECT title, workState, latestReceiptId, latestReceiptSummary FROM task_cache WHERE id = 'task-9'",
            ).use { cursor ->
                assertTrue(cursor.moveToFirst())
                assertEquals("Receiptを保持する", cursor.getString(0))
                assertEquals("in_progress", cursor.getString(1))
                assertTrue(cursor.isNull(2))
                assertTrue(cursor.isNull(3))
            }
        }
    }

    @Test
    fun migrationTenToElevenPreservesOfflineStateAndUpgradesChecklistProtocol() {
        helper.createDatabase(DatabaseName, 10).apply {
            execSQL(
                "INSERT INTO sync_state " +
                    "(id, serverId, apiVersion, schemaVersion, cursor, lastSuccessfulSyncAt, lastAttemptAt, lastError) " +
                    "VALUES (1, 'server-1', 1, 2, 'cursor-10', '2026-08-22T01:00:00Z', " +
                    "'2026-08-22T01:00:00Z', NULL)",
            )
            execSQL(
                "INSERT INTO task_cache " +
                    "(id, serverVersion, title, themeId, state, workState, todayDate, updatedAt, " +
                    "optimisticCommandId, conflictCommandId) VALUES " +
                    "('task-10', 7, 'Checklistを保持する', NULL, 'todo', NULL, '2026-08-22', " +
                    "'2026-08-22T01:00:00Z', 'command-10', NULL)",
            )
            execSQL(
                "INSERT INTO outbox_command " +
                    "(commandId, idempotencyKey, requestId, clientDeviceId, issuedAt, commandName, " +
                    "envelopeJson, serverId, state, attemptCount, createdAt, lastAttemptAt, lastError, " +
                    "taskId, dependsOnCommandId) VALUES " +
                    "('command-10', 'command-10', 'request-10', 'device-1', '2026-08-22T01:00:00Z', " +
                    "'UpdateTask', '{\"apiVersion\":1,\"schemaVersion\":2,\"requestId\":\"request-10\"," +
                    "\"commandId\":\"command-10\",\"idempotencyKey\":\"command-10\"," +
                    "\"clientDeviceId\":\"device-1\",\"issuedAt\":\"2026-08-22T01:00:00Z\"," +
                    "\"command\":{\"name\":\"UpdateTask\",\"taskId\":\"task-10\",\"expectedVersion\":7," +
                    "\"expectedScheduleVersion\":null,\"changes\":{\"title\":\"端末Task\"}," +
                    "\"base\":{\"title\":\"Checklistを保持する\"}}}', 'server-1', 'pending', 0, " +
                    "'2026-08-22T01:00:00Z', NULL, NULL, 'task-10', NULL)",
            )
            execSQL(
                "INSERT INTO task_conflict " +
                    "(commandId, taskId, intendedAction, expectedVersion, serverVersion, serverState, " +
                    "serverTitle, localTitle, serverTodayDate, localTodayDate, localTodayDateChanged, " +
                    "serverThemeId, localThemeId, localThemeIdChanged, serverWorkState, serverUpdatedAt, " +
                    "detectedAt, localScheduleStartDate, localScheduleEndDate, localScheduleRangeSemantics, " +
                    "localScheduleChanged, localPlannedStartTime, localPlannedDurationMinutes, " +
                    "localPlannedScheduleChanged) VALUES " +
                    "('conflict-10', 'task-conflict-10', 'UpdateTask', 6, 7, 'todo', 'Server Task', NULL, " +
                    "NULL, NULL, 0, NULL, NULL, 0, NULL, '2026-08-22T01:00:00Z', " +
                    "'2026-08-22T01:01:00Z', NULL, NULL, NULL, 0, NULL, NULL, 0)",
            )
            close()
        }

        helper.runMigrationsAndValidate(DatabaseName, 11, true, MIGRATION_10_11).use { db ->
            db.query("SELECT checklistJson, optimisticCommandId FROM task_cache WHERE id = 'task-10'").use { cursor ->
                assertTrue(cursor.moveToFirst())
                assertEquals("[]", cursor.getString(0))
                assertEquals("command-10", cursor.getString(1))
            }
            db.query("SELECT envelopeJson, state FROM outbox_command WHERE commandId = 'command-10'").use { cursor ->
                assertTrue(cursor.moveToFirst())
                assertTrue(cursor.getString(0).contains("\"schemaVersion\":3"))
                assertEquals("pending", cursor.getString(1))
            }
            db.query("SELECT schemaVersion, cursor FROM sync_state WHERE id = 1").use { cursor ->
                assertTrue(cursor.moveToFirst())
                assertEquals(3, cursor.getInt(0))
                assertEquals("cursor-10", cursor.getString(1))
            }
            db.query(
                "SELECT localChecklistJson, localChecklistChanged FROM task_conflict WHERE commandId = 'conflict-10'",
            ).use { cursor ->
                assertTrue(cursor.moveToFirst())
                assertTrue(cursor.isNull(0))
                assertEquals(0, cursor.getInt(1))
            }
        }
    }

    @Test
    fun migrationElevenToTwelvePreservesChecklistStateAndAddsOfflineReceiptDetailStorage() {
        helper.createDatabase(DatabaseName, 11).apply {
            execSQL(
                "INSERT INTO task_cache " +
                    "(id, serverVersion, title, themeId, state, workState, todayDate, updatedAt, " +
                    "optimisticCommandId, conflictCommandId, scheduleId, scheduleVersion, " +
                    "scheduleStartDate, scheduleEndDate, scheduleDateKind, scheduleRangeSemantics, " +
                    "scheduleConfidence, scheduleGranularity, plannedStartTime, plannedDurationMinutes, " +
                    "latestReceiptId, latestReceiptReportedAt, latestReceiptExecutorLabel, latestReceiptSummary, " +
                    "checklistJson) VALUES " +
                    "('task-11', 8, '詳細を保持する', 'theme-1', 'todo', 'needs_human_review', " +
                    "'2026-08-22', '2026-08-22T01:00:00Z', NULL, NULL, NULL, NULL, NULL, NULL, NULL, " +
                    "NULL, NULL, NULL, NULL, NULL, 'receipt-11', '2026-08-22T01:00:00Z', 'Codex', " +
                    "'確認待ち', '[{\"id\":\"item-1\",\"title\":\"確認する\",\"done\":false," +
                    "\"sortOrder\":0.0,\"completedAt\":null}]')",
            )
            close()
        }

        helper.runMigrationsAndValidate(DatabaseName, 12, true, MIGRATION_11_12).use { db ->
            db.query(
                "SELECT title, latestReceiptId, checklistJson FROM task_cache WHERE id = 'task-11'",
            ).use { cursor ->
                assertTrue(cursor.moveToFirst())
                assertEquals("詳細を保持する", cursor.getString(0))
                assertEquals("receipt-11", cursor.getString(1))
                assertTrue(cursor.getString(2).contains("item-1"))
            }
            db.execSQL(
                "INSERT INTO work_receipt_cache " +
                    "(id, taskId, executorKind, executorLabel, startedAt, reportedAt, reportKind, " +
                    "summary, payloadJson, truncated, serverId, serverRevision, fetchedAt) VALUES " +
                    "('receipt-11', 'task-11', 'ai_agent', 'Codex', NULL, '2026-08-22T01:00:00Z', " +
                    "'report', '確認待ち', '{}', 0, 'desktop-home', 42, '2026-08-22T01:01:00Z')",
            )
            db.query("SELECT taskId, serverId FROM work_receipt_cache WHERE id = 'receipt-11'").use { cursor ->
                assertTrue(cursor.moveToFirst())
                assertEquals("task-11", cursor.getString(0))
                assertEquals("desktop-home", cursor.getString(1))
            }
        }
    }

    @Test
    fun migrationTwelveToThirteenPreservesOfflineStateAndAddsProposalCache() {
        helper.createDatabase(DatabaseName, 12).apply {
            execSQL(
                "INSERT INTO sync_state " +
                    "(id, serverId, apiVersion, schemaVersion, cursor, lastSuccessfulSyncAt, lastAttemptAt, lastError) " +
                    "VALUES (1, 'desktop-home', 1, 3, 'cursor-12', '2026-08-22T01:00:00Z', " +
                    "'2026-08-22T01:00:00Z', NULL)",
            )
            execSQL(
                "INSERT INTO task_cache " +
                    "(id, serverVersion, title, themeId, state, workState, todayDate, updatedAt, " +
                    "optimisticCommandId, conflictCommandId, checklistJson) VALUES " +
                    "('task-12', 4, 'Proposal移行を確認する', NULL, 'todo', 'in_progress', " +
                    "'2026-08-22', '2026-08-22T01:00:00Z', 'command-12', NULL, '[]')",
            )
            execSQL(
                "INSERT INTO outbox_command " +
                    "(commandId, idempotencyKey, requestId, clientDeviceId, issuedAt, commandName, " +
                    "envelopeJson, serverId, state, attemptCount, createdAt, lastAttemptAt, lastError, " +
                    "taskId, dependsOnCommandId) VALUES " +
                    "('command-12', 'command-12', 'request-12', 'device-1', '2026-08-22T01:00:00Z', " +
                    "'CreateTask', '{\"apiVersion\":1,\"schemaVersion\":3,\"requestId\":\"request-12\"," +
                    "\"commandId\":\"command-12\",\"idempotencyKey\":\"command-12\"," +
                    "\"clientDeviceId\":\"device-1\",\"issuedAt\":\"2026-08-22T01:00:00Z\"," +
                    "\"command\":{\"name\":\"CreateTask\",\"task\":{\"id\":\"task-new-12\"," +
                    "\"title\":\"移行後に送る\",\"projectId\":null,\"state\":\"todo\"," +
                    "\"priority\":\"normal\",\"requester\":\"self\",\"intendedExecutor\":\"self\"," +
                    "\"todayDate\":\"2026-08-22\"},\"provenance\":null}}', " +
                    "'desktop-home', 'pending', 0, '2026-08-22T01:00:00Z', NULL, NULL, " +
                    "'task-new-12', NULL)",
            )
            close()
        }

        helper.runMigrationsAndValidate(DatabaseName, 13, true, MIGRATION_12_13).use { db ->
            db.query("SELECT title, optimisticCommandId FROM task_cache WHERE id = 'task-12'").use { cursor ->
                assertTrue(cursor.moveToFirst())
                assertEquals("Proposal移行を確認する", cursor.getString(0))
                assertEquals("command-12", cursor.getString(1))
            }
            db.query("SELECT envelopeJson, state FROM outbox_command WHERE commandId = 'command-12'").use { cursor ->
                assertTrue(cursor.moveToFirst())
                assertTrue(cursor.getString(0).contains("\"schemaVersion\":4"))
                assertEquals("pending", cursor.getString(1))
            }
            db.query("SELECT schemaVersion, cursor FROM sync_state WHERE id = 1").use { cursor ->
                assertTrue(cursor.moveToFirst())
                assertEquals(4, cursor.getInt(0))
                assertEquals("cursor-12", cursor.getString(1))
            }
            db.execSQL(
                "INSERT INTO task_work_proposal_cache " +
                    "(id, taskId, receivedAt, payloadJson, truncated, serverId, serverRevision, fetchedAt) " +
                    "VALUES ('proposal-12', 'task-12', '2026-08-22T01:00:00Z', '{}', 0, " +
                    "'desktop-home', 42, '2026-08-22T01:01:00Z')",
            )
            db.query("SELECT taskId, serverId FROM task_work_proposal_cache WHERE id = 'proposal-12'").use { cursor ->
                assertTrue(cursor.moveToFirst())
                assertEquals("task-12", cursor.getString(0))
                assertEquals("desktop-home", cursor.getString(1))
            }
        }
    }

    @Test
    fun migrationThirteenToFourteenPreservesPendingTaskAndAddsMinimalCaptureReceiptStorage() {
        helper.createDatabase(DatabaseName, 13).apply {
            execSQL(
                "INSERT INTO sync_state " +
                    "(id, serverId, apiVersion, schemaVersion, cursor, lastSuccessfulSyncAt, lastAttemptAt, lastError) " +
                    "VALUES (1, 'desktop-home', 1, 4, 'cursor-13', '2026-08-23T01:00:00Z', " +
                    "'2026-08-23T01:00:00Z', NULL)",
            )
            execSQL(
                "INSERT INTO task_cache " +
                    "(id, serverVersion, title, themeId, state, workState, todayDate, updatedAt, " +
                    "optimisticCommandId, conflictCommandId, checklistJson) VALUES " +
                    "('task-13', NULL, '移行後に送るTask', NULL, 'todo', NULL, NULL, " +
                    "'2026-08-23T01:00:00Z', 'command-13', NULL, '[]')",
            )
            execSQL(
                "INSERT INTO outbox_command " +
                    "(commandId, idempotencyKey, requestId, clientDeviceId, issuedAt, commandName, " +
                    "envelopeJson, serverId, state, attemptCount, createdAt, lastAttemptAt, lastError, " +
                    "taskId, dependsOnCommandId) VALUES " +
                    "('command-13', 'command-13', 'request-13', 'device-1', '2026-08-23T01:00:00Z', " +
                    "'CreateTask', '{\"apiVersion\":1,\"schemaVersion\":4,\"requestId\":\"request-13\"," +
                    "\"commandId\":\"command-13\",\"idempotencyKey\":\"command-13\"," +
                    "\"clientDeviceId\":\"device-1\",\"issuedAt\":\"2026-08-23T01:00:00Z\"," +
                    "\"command\":{\"name\":\"CreateTask\",\"task\":{\"id\":\"task-13\"," +
                    "\"title\":\"移行後に送るTask\",\"projectId\":null,\"state\":\"todo\"," +
                    "\"priority\":\"normal\",\"requester\":\"self\"," +
                    "\"intendedExecutor\":\"self\",\"todayDate\":null},\"provenance\":null}}', " +
                    "'desktop-home', 'pending', 0, '2026-08-23T01:00:00Z', NULL, NULL, " +
                    "'task-13', NULL)",
            )
            close()
        }

        helper.runMigrationsAndValidate(DatabaseName, 14, true, MIGRATION_13_14).use { db ->
            db.query("SELECT title, optimisticCommandId FROM task_cache WHERE id = 'task-13'").use { cursor ->
                assertTrue(cursor.moveToFirst())
                assertEquals("移行後に送るTask", cursor.getString(0))
                assertEquals("command-13", cursor.getString(1))
            }
            db.query(
                "SELECT envelopeJson, state, captureId FROM outbox_command WHERE commandId = 'command-13'",
            ).use { cursor ->
                assertTrue(cursor.moveToFirst())
                assertEquals(5, MobileTaskCommandContract.decodeCreateEnvelope(cursor.getString(0)).schemaVersion)
                assertEquals("pending", cursor.getString(1))
                assertTrue(cursor.isNull(2))
            }
            db.query("SELECT schemaVersion, cursor FROM sync_state WHERE id = 1").use { cursor ->
                assertTrue(cursor.moveToFirst())
                assertEquals(5, cursor.getInt(0))
                assertEquals("cursor-13", cursor.getString(1))
            }
            db.execSQL(
                "INSERT INTO capture_receipt (id, serverVersion, capturedAt, optimisticCommandId) " +
                    "VALUES ('capture-13', NULL, '2026-08-23T01:00:00Z', 'capture-command-13')",
            )
            db.query("SELECT serverVersion, capturedAt FROM capture_receipt WHERE id = 'capture-13'").use { cursor ->
                assertTrue(cursor.moveToFirst())
                assertTrue(cursor.isNull(0))
                assertEquals("2026-08-23T01:00:00Z", cursor.getString(1))
            }
        }
    }

    private companion object {
        const val DatabaseName = "mobile-migration-test"
    }
}
