package jp.personal.tasken.companion

import android.app.Application

class TaskenCompanionApp : Application() {
    override fun onCreate() {
        super.onCreate()
        MobileOutboxScheduler.ensurePeriodicSync(this)
        MobileTaskNotifications.createChannel(this)
        TaskenTodayWidget.updateAll(this)
    }
}
