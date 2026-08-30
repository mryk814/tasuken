package jp.personal.tasken.companion

import android.content.Intent

/** The chooser boundary accepts the server's minimal safe-share projection only. */
object MobileSafeShare {
    fun chooserIntent(share: MobileSafeShareDto): Intent {
        require(share.mimeType == "text/plain")
        require(MobileTaskLocator.isCanonicalTaskId(share.taskId))
        require(share.taskLocator == MobileTaskLocator.format(share.taskId))
        require(share.text.isNotBlank() && share.text.length <= 8_000)
        return Intent.createChooser(
            Intent(Intent.ACTION_SEND)
                .setType("text/plain")
                .putExtra(Intent.EXTRA_TEXT, share.text),
            "安全な共有先を選択",
        )
    }
}
