package jp.personal.tasken.companion

import android.Manifest
import android.app.NotificationChannel
import android.app.NotificationManager
import android.content.Context
import android.os.Build
import androidx.room.Room
import androidx.core.app.NotificationCompat
import androidx.test.core.app.ApplicationProvider
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import kotlinx.coroutines.delay
import kotlinx.coroutines.runBlocking
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotEquals
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith

@RunWith(AndroidJUnit4::class)
class MobileTaskNotificationIsolationTest {
    private lateinit var database: MobileLocalDatabase
    private lateinit var dao: MobileLocalDao

    @Before
    fun setUp() = runBlocking {
        val context = ApplicationProvider.getApplicationContext<Context>()
        database = Room.inMemoryDatabaseBuilder(context, MobileLocalDatabase::class.java)
            .allowMainThreadQueries()
            .build()
        dao = database.mobileDao()
        dao.upsertSyncState(syncState("server-1"))
    }

    @After
    fun tearDown() {
        database.close()
    }

    @Test
    fun pendingDeliveryAndAcknowledgementAreBoundToTheCurrentServer() = runBlocking {
        val serverOne = delivery("delivery-1", "server-1")
        val serverTwo = delivery("delivery-2", "server-2")
        dao.insertTaskNotificationDelivery(serverOne)
        dao.insertTaskNotificationDelivery(serverTwo)

        assertEquals(listOf("delivery-1"), dao.pendingTaskNotificationDeliveries("server-1").map { it.deliveryId })
        assertEquals(
            0,
            dao.markTaskNotificationDelivered("delivery-1", "server-2", "2026-08-30T00:00:02Z"),
        )
        assertEquals(listOf("delivery-1"), dao.pendingTaskNotificationDeliveries("server-1").map { it.deliveryId })

        assertEquals(
            1,
            dao.markTaskNotificationDelivered("delivery-1", "server-1", "2026-08-30T00:00:03Z"),
        )
        assertTrue(dao.pendingTaskNotificationDeliveries("server-1").isEmpty())
        assertEquals(
            listOf("delivery-1"),
            dao.deliveredTaskNotificationDeliveries("server-1").map { it.deliveryId },
        )
        assertEquals(listOf("delivery-2"), dao.pendingTaskNotificationDeliveries("server-2").map { it.deliveryId })
    }

    @Test
    fun deliveredNotificationRemainsCurrentOnlyWhileItsCanonicalSignalExists() {
        val blocked = delivery("blocked-delivery", "server-1").copy(
            state = "delivered",
            deliveredAt = "2026-08-30T00:00:02Z",
        )
        val blockedTask = taskCache(workState = "blocked", receiptId = null)
        assertTrue(blocked.matchesCurrentState(blockedTask, proposal = null))
        assertTrue(blocked.matchesCurrentState(blockedTask.copy(serverVersion = 3), proposal = null))
        assertFalse(blocked.matchesCurrentState(blockedTask.copy(workState = "in_progress"), null))
        assertFalse(blocked.matchesCurrentState(blockedTask.copy(latestReceiptId = "receipt-2"), null))
        assertFalse(blocked.matchesCurrentState(null, null))

        val proposal = blocked.copy(
            deliveryId = "proposal-delivery",
            workState = "pending_proposal",
            receiptId = "proposal-1",
        )
        val matchingProposal = TaskWorkProposalCacheEntity(
            id = "proposal-1",
            taskId = "task-1",
            receivedAt = "2026-08-30T00:00:01Z",
            payloadJson = "{}",
            truncated = false,
            serverId = "server-1",
            serverRevision = 2,
            fetchedAt = "2026-08-30T00:00:01Z",
        )
        assertTrue(proposal.matchesCurrentState(task = null, proposal = matchingProposal))
        assertFalse(proposal.matchesCurrentState(task = null, proposal = null))
        assertFalse(proposal.matchesCurrentState(task = null, proposal = matchingProposal.copy(taskId = "task-2")))
        assertFalse(proposal.matchesCurrentState(task = null, proposal = matchingProposal.copy(serverId = "server-2")))
    }

    @Test
    fun drainCancelsAnActiveNotificationAfterTheCanonicalSignalIsResolved() = runBlocking {
        val context = ApplicationProvider.getApplicationContext<Context>()
        if (Build.VERSION.SDK_INT >= 33) {
            InstrumentationRegistry.getInstrumentation().uiAutomation.grantRuntimePermission(
                context.packageName,
                Manifest.permission.POST_NOTIFICATIONS,
            )
        }
        assertTrue(MobileTaskNotifications.canPost(context))
        val manager = context.getSystemService(NotificationManager::class.java)
        val channelId = "tasken-notification-cancel-test"
        manager.createNotificationChannel(
            NotificationChannel(channelId, "Tasken notification test", NotificationManager.IMPORTANCE_LOW),
        )
        val delivered = delivery("resolved-delivery", "server-1").copy(
            state = "delivered",
            deliveredAt = "2026-08-30T00:00:02Z",
        )
        val tag = MobileTaskNotifications.notificationTag(delivered.serverId, delivered.deliveryId)
        val notificationId = delivered.deliveryId.hashCode()
        try {
            dao.insertTaskNotificationDelivery(delivered)
            dao.upsertTask(taskCache(workState = "in_progress", receiptId = null))
            manager.notify(
                tag,
                notificationId,
                NotificationCompat.Builder(context, channelId)
                    .setSmallIcon(R.drawable.ic_tasken_notification)
                    .setContentTitle("Resolved notification test")
                    .build(),
            )
            delay(100)
            assertTrue(manager.activeNotifications.any { it.tag == tag && it.id == notificationId })

            MobileTaskNotifications.drain(context, dao)
            delay(100)

            assertFalse(manager.activeNotifications.any { it.tag == tag && it.id == notificationId })
            assertTrue(dao.deliveredTaskNotificationDeliveries("server-1").isEmpty())
        } finally {
            manager.cancel(tag, notificationId)
            manager.deleteNotificationChannel(channelId)
        }
    }

    @Test
    fun verifiedBootstrapPrunesThePreviousServersNotificationLedger() = runBlocking {
        val oldDelivery = delivery("delivery-old", "server-1").copy(
            state = "delivered",
            deliveredAt = "2026-08-30T00:00:02Z",
        )
        val currentDelivery = delivery("delivery-current", "server-2")
        dao.insertTaskNotificationDelivery(oldDelivery)
        dao.insertTaskNotificationDelivery(currentDelivery)

        assertTrue(dao.applyVerifiedBootstrap(emptyList(), syncState("server-2")))

        assertEquals(listOf("delivery-current"), dao.pendingTaskNotificationDeliveries("server-2").map { it.deliveryId })
        assertTrue(dao.insertTaskNotificationDelivery(oldDelivery) != -1L)
    }

    @Test
    fun pendingIntentAndNotificationIdentityIncludeTheServer() {
        val deliveryId = "same-delivery-id"

        assertNotEquals(
            MobileTaskNotifications.actionIdentity("server-1", deliveryId, "open"),
            MobileTaskNotifications.actionIdentity("server-2", deliveryId, "open"),
        )
        assertNotEquals(
            MobileTaskNotifications.notificationTag("server-1", deliveryId),
            MobileTaskNotifications.notificationTag("server-2", deliveryId),
        )
        assertTrue(
            MobileTaskNotifications.isServerBoundTag(
                MobileTaskNotifications.notificationTag("server-1", deliveryId),
                "server-1",
            ),
        )
        assertFalse(
            MobileTaskNotifications.isServerBoundTag(
                MobileTaskNotifications.notificationTag("server-1", deliveryId),
                "server-2",
            ),
        )
        assertTrue(MobileTaskNotifications.isActiveServer("server-1", "server-1"))
        assertFalse(MobileTaskNotifications.isActiveServer("server-1", "server-2"))
        assertFalse(MobileTaskNotifications.isActiveServer("server-1", null))
    }

    @Test
    fun postedTaskenNotificationUsesTheMonochromeTaskenMark() = runBlocking {
        val context = ApplicationProvider.getApplicationContext<Context>()
        if (Build.VERSION.SDK_INT >= 33) {
            InstrumentationRegistry.getInstrumentation().uiAutomation.grantRuntimePermission(
                context.packageName,
                Manifest.permission.POST_NOTIFICATIONS,
            )
        }
        assertTrue(MobileTaskNotifications.canPost(context))
        val manager = context.getSystemService(NotificationManager::class.java)
        val pending = delivery("tasken-icon-delivery", "server-1")
        val tag = MobileTaskNotifications.notificationTag(pending.serverId, pending.deliveryId)
        val notificationId = pending.deliveryId.hashCode()
        try {
            dao.insertTaskNotificationDelivery(pending)
            MobileTaskNotifications.drain(context, dao)
            delay(100)

            val posted = manager.activeNotifications.firstOrNull {
                it.tag == tag && it.id == notificationId
            }
            assertEquals(R.drawable.ic_tasken_notification, posted?.notification?.smallIcon?.resId)
        } finally {
            manager.cancel(tag, notificationId)
        }
    }

    private fun delivery(deliveryId: String, serverId: String) = TaskNotificationDeliveryEntity(
        deliveryId = deliveryId,
        serverId = serverId,
        taskId = "task-1",
        taskVersion = 2,
        workState = "blocked",
        receiptId = null,
        state = "pending",
        createdAt = "2026-08-30T00:00:01Z",
    )

    private fun taskCache(workState: String, receiptId: String?) = TaskCacheEntity(
        id = "task-1",
        serverVersion = 2,
        title = "Notification task",
        themeId = null,
        state = "todo",
        workState = workState,
        todayDate = null,
        updatedAt = "2026-08-30T00:00:01Z",
        optimisticCommandId = null,
        latestReceiptId = receiptId,
    )

    private fun syncState(serverId: String) = SyncStateEntity(
        id = 1,
        serverId = serverId,
        apiVersion = 1,
        schemaVersion = TASKEN_MOBILE_SCHEMA_VERSION,
        cursor = "cursor-$serverId",
        lastSuccessfulSyncAt = "2026-08-30T00:00:00Z",
        lastAttemptAt = "2026-08-30T00:00:00Z",
        lastError = null,
    )
}
