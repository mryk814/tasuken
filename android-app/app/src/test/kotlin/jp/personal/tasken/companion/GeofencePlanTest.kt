package jp.personal.tasken.companion

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class GeofencePlanTest {
    private val a = MobilePlaceReminder("三ノ宮", 34.6937, 135.1956, 300)
    private val b = MobilePlaceReminder("自宅", 34.7, 135.2, 200)

    private fun registered(vararg pairs: Pair<String, MobilePlaceReminder>) =
        pairs.associate { it.first to geofenceSignature(it.second) }

    @Test
    fun nothingChangedMeansNothingIsTouched() {
        val plan = planGeofenceChanges(registered("t1" to a, "t2" to b), listOf("t1" to a, "t2" to b))
        assertTrue(plan.removeIds.isEmpty())
        assertTrue(plan.add.isEmpty())
    }

    @Test
    fun onlyNewChangedAndGoneTasksAreTouchedSoOtherDwellsKeepWaiting() {
        val moved = a.copy(radiusMeters = 500)
        val plan = planGeofenceChanges(
            registered("t1" to a, "t2" to b, "gone" to a),
            listOf("t1" to moved, "t2" to b, "new" to a),
        )
        assertEquals(listOf("gone"), plan.removeIds)
        assertEquals(listOf("t1", "new"), plan.add.map { it.first })
    }

    @Test
    fun renamingDoesNotReRegisterButChangingDaysOrTimeWindowDoes() {
        val renamed = a.copy(name = "三宮駅")
        assertTrue(planGeofenceChanges(registered("t1" to a), listOf("t1" to renamed)).add.isEmpty())
        // 曜日・時間帯を変えたら付け直す（まだ中にいれば、新しい条件のもとで滞在 3 分後に鳴る）。
        val edited = a.copy(days = listOf(1, 5), timeFrom = "17:00", timeTo = "21:00")
        val plan = planGeofenceChanges(registered("t1" to a), listOf("t1" to edited))
        assertTrue(plan.removeIds.isEmpty())
        assertEquals(listOf("t1"), plan.add.map { it.first })
    }

    @Test
    fun emptyRegistrationAddsEverythingAfterARebootClearedIt() {
        val plan = planGeofenceChanges(emptyMap(), listOf("t1" to a, "t2" to b))
        assertTrue(plan.removeIds.isEmpty())
        assertEquals(listOf("t1", "t2"), plan.add.map { it.first })
    }
}
