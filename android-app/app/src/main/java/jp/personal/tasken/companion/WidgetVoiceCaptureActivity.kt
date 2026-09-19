package jp.personal.tasken.companion

import android.content.Context
import android.content.Intent
import android.os.Bundle
import android.speech.RecognizerIntent
import android.util.Log
import android.widget.Toast
import androidx.activity.ComponentActivity
import androidx.activity.result.contract.ActivityResultContracts
import androidx.lifecycle.lifecycleScope
import java.time.Instant
import java.time.LocalDate
import java.util.Locale
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

/**
 * ウィジェットのマイクボタンからアプリ画面を開かずに音声追加するための半透明ゲート。
 *
 * - システムの音声入力ダイアログだけを開き、結果テキストを直接outboxへenqueueする。
 * - MainActivityは開かない。認識不可・空結果・保存失敗時はToastで閉じる。
 * - 権限はシステム側ダイアログに委ね、自前でRECORD_AUDIOは要求しない。
 */
class WidgetVoiceCaptureActivity : ComponentActivity() {
    private var handled = false

    private val recognizeLauncher = registerForActivityResult(
        ActivityResultContracts.StartActivityForResult(),
    ) { result ->
        if (handled) return@registerForActivityResult
        handled = true
        val text = if (result.resultCode == RESULT_OK) {
            result.data?.getStringArrayListExtra(RecognizerIntent.EXTRA_RESULTS)
                ?.firstOrNull()?.trim().orEmpty()
        } else {
            ""
        }
        val confidence = result.data
            ?.getFloatArrayExtra(RecognizerIntent.EXTRA_CONFIDENCE_SCORES)
            ?.firstOrNull()?.takeIf { it >= 0f }
        if (text.isBlank()) {
            if (result.resultCode == RESULT_OK) {
                Toast.makeText(this, "音声を文字にできませんでした。", Toast.LENGTH_SHORT).show()
            }
            finish()
            return@registerForActivityResult
        }
        saveVoiceText(text, confidence)
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        if (handled) {
            finish()
            return
        }
        val recognizerIntent = Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH).apply {
            putExtra(RecognizerIntent.EXTRA_LANGUAGE_MODEL, RecognizerIntent.LANGUAGE_MODEL_FREE_FORM)
            putExtra(RecognizerIntent.EXTRA_LANGUAGE, Locale.getDefault().toLanguageTag())
            putExtra(RecognizerIntent.EXTRA_MAX_RESULTS, 1)
            putExtra(RecognizerIntent.EXTRA_PROMPT, "話してください")
        }
        if (recognizerIntent.resolveActivity(packageManager) == null) {
            Toast.makeText(this, "この端末では音声入力を利用できません。", Toast.LENGTH_SHORT).show()
            finish()
            return
        }
        runCatching { recognizeLauncher.launch(recognizerIntent) }
            .onFailure { error ->
                Log.w("WidgetVoiceCapture", "Voice recognizer could not be launched", error)
                Toast.makeText(this, "音声入力を開始できませんでした。", Toast.LENGTH_SHORT).show()
                handled = true
                finish()
            }
    }

    private fun saveVoiceText(text: String, confidence: Float?) {
        val draft = try {
            buildWidgetVoiceDraft(
                text = text,
                language = Locale.getDefault().toLanguageTag(),
                confidence = confidence,
                capturedAt = Instant.now().toString(),
                timeZone = java.time.ZoneId.systemDefault().id,
            )
        } catch (error: Exception) {
            Log.w("WidgetVoiceCapture", "Voice draft rejected", error)
            Toast.makeText(this, "追加できませんでした。文字数を確認してください。", Toast.LENGTH_LONG).show()
            finish()
            return
        }
        lifecycleScope.launch {
            try {
                withContext(Dispatchers.IO) {
                    val repository = AndroidMobileTaskRepository(applicationContext)
                    if (draft.kind == MobileCaptureKind.Task) {
                        repository.enqueueCreateTask(draft, LocalDate.now())
                    } else {
                        repository.enqueueCreateCapture(draft)
                    }
                }
                withContext(Dispatchers.IO) {
                    TaskenTodayWidget.updateAllNow(applicationContext)
                }
                Toast.makeText(this@WidgetVoiceCaptureActivity, "追加しました。", Toast.LENGTH_SHORT).show()
            } catch (error: Exception) {
                Log.w("WidgetVoiceCapture", "Voice capture enqueue failed", error)
                Toast.makeText(this@WidgetVoiceCaptureActivity, "保存できませんでした。再試行してください。", Toast.LENGTH_LONG).show()
            } finally {
                finish()
            }
        }
    }

    companion object {
        internal const val ACTION_VOICE_CAPTURE = "jp.personal.tasken.companion.action.VOICE_CAPTURE"

        fun voiceCaptureIntent(context: Context): Intent =
            Intent(context, WidgetVoiceCaptureActivity::class.java).setAction(ACTION_VOICE_CAPTURE)
    }
}

/**
 * ウィジェット録音のJVMテスト可能な組立。500文字以内はTask、超える場合はCaptureとして保存する。
 * 空文字は呼び出し側で弾く前提でここでも要求する。
 */
internal fun buildWidgetVoiceDraft(
    text: String,
    language: String,
    confidence: Float?,
    capturedAt: String,
    timeZone: String,
): MobileCaptureDraft {
    val trimmed = text.trim()
    require(trimmed.isNotEmpty()) { "音声結果が空です。" }
    val kind = if (trimmed.length <= MOBILE_TASK_TITLE_MAX_LENGTH) MobileCaptureKind.Task else MobileCaptureKind.Capture
    require(trimmed.length <= MOBILE_CAPTURE_TEXT_MAX_LENGTH) { "12000文字以内で入力してください。" }
    val base = MobileCaptureDraft.fresh(text = "", source = MobileCaptureSource.AndroidSpeech, kind = kind)
    return base.withSpeechResult(
        ShortSpeechRecognitionResult(
            text = trimmed,
            mode = MobileSpeechRecognitionMode.SystemService,
            language = language.ifBlank { Locale.getDefault().toLanguageTag() },
            confidence = confidence,
        ),
        append = false,
        capturedAt = capturedAt,
        timeZone = timeZone,
    )
}
